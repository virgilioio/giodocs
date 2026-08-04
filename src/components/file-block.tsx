/**
 * The `file` block — a document that stays with the page.
 *
 * Storage reuses the page-images bucket under a `files/` prefix, so the
 * bucket's existing can_read_page policies apply unchanged: a file on a
 * restricted page is exactly as restricted as the page, with no second
 * rule to keep in sync. The block stores the STORAGE PATH; a signed URL is
 * minted for reading and never written back.
 *
 * Two states: the dashed empty target, and the filled card. The card shows
 * IMMEDIATELY on pick with the local filename, size and type while the
 * upload runs behind it — never a spinner over an empty box.
 */

import { useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Blk } from "@/lib/block-ops";
import { PageImageCtx } from "@/components/image-block";
import { signPath, uploadFile, gcImagePaths } from "@/lib/images";
import { useAuth } from "@/lib/auth-context";
import { useFormatDate } from "@/lib/format";
import { useToast } from "@/lib/toast";
import {
  badgeLabel,
  displayFileName,
  fileKind,
  fileMetaLine,
  fileTone,
  isOpenable,
  rejectFileReason,
  type FileKind,
} from "@/lib/file-ops";

/* ────────────── Glyphs: one per file KIND ────────────── */

const KIND_ICON: Record<FileKind, string> = {
  doc: "M13.4 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.1zM13.4 3.5v5.6H19",
  sheet:
    "M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM3.5 9.5h17M3.5 14.5h17M9.5 4.5v15",
  image:
    "M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5zM3 15.4l5-4.4 4.6 4M15.6 8.4h.01",
  zip: "M13.4 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.1zM13.4 3.5v5.6H19M11 6h2M11 9h2M11 12h2M11 15h2",
  code: "M9.2 8.4 5.6 12l3.6 3.6M14.8 8.4 18.4 12l-3.6 3.6",
  video:
    "M4.5 5.5h11A1.5 1.5 0 0 1 17 7v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 17V7a1.5 1.5 0 0 1 1.5-1.5zM17 10l4-2.5v9L17 14",
  audio: "M14.5 4.5v11.2M14.5 4.5 8.5 6v8.2M8.5 14.2a2.2 2.2 0 1 1-2.2 2.2 2.2 2.2 0 0 1 2.2-2.2zM14.5 15.7a2.2 2.2 0 1 1-2.2 2.2 2.2 2.2 0 0 1 2.2-2.2z",
  generic:
    "M13.4 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.1zM13.4 3.5v5.6H19",
};

function Ico({ d, size = 19 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const OPEN_ICON = "M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10";
const DOWNLOAD_ICON = "M12 3v12M7.5 10.5 12 15l4.5-4.5M4 19h16";
const REPLACE_ICON =
  "M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6M17.5 3v3.6h-3.6M6.5 21v-3.6h3.6";
const REMOVE_ICON =
  "M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3";

/* ────────────── Empty state ────────────── */

function EmptyState({
  onFile,
  locked,
}: {
  onFile: (f: File) => void;
  locked: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Attach a file"
      onClick={() => {
        if (!locked) inputRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const f = e.dataTransfer?.files?.[0];
        if (f && !locked) onFile(f);
      }}
      className="flex w-full cursor-pointer items-center"
      style={{
        margin: "12px 0",
        border: `1.5px dashed var(--color-${over ? "rule" : "lineStrong"})`,
        borderRadius: 10,
        background: `var(--color-${over ? "sunken" : "track"})`,
        padding: "14px 15px",
        gap: 11,
      }}
    >
      <span className="text-whisper">
        <Ico d={KIND_ICON.generic} size={19} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-row font-bold text-secondary">
          Attach a file
        </span>
        <span className="block text-caption text-faint">
          Drop it here, or click to browse. It stays with this page.
        </span>
      </span>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

/* ────────────── Action button ────────────── */

function ActionBtn({
  title,
  d,
  onPick,
  disabled,
  hidden,
}: {
  title: string;
  d: string;
  onPick: () => void;
  disabled?: boolean;
  hidden?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onPick();
      }}
      className="grid place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong disabled:opacity-40"
      style={{
        height: 28,
        width: 28,
        border: 0,
        background: "transparent",
        cursor: disabled ? "default" : "pointer",
        visibility: hidden ? "hidden" : undefined,
      }}
    >
      <Ico d={d} size={16} />
    </button>
  );
}

/* ────────────── The block ────────────── */

export function FileBlock({
  block,
  locked,
  onChange,
  onDelete,
}: {
  block: Blk;
  locked: boolean;
  onChange: (patch: Partial<Blk>) => void;
  onDelete: () => void;
}) {
  const ctx = useContext(PageImageCtx);
  const { profile } = useAuth();
  const fmtDate = useFormatDate();
  const toast = useToast();
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [failed, setFailed] = useState<File | null>(null);

  const path = ((block as { path?: string }).path ?? null) as string | null;
  const rawName = ((block as { fname?: string }).fname ?? pending?.name ?? "") as string;
  // A block that lost its metadata still names its type honestly from the
  // storage path rather than rendering an empty card.
  const fname = displayFileName(rawName, path);
  const fsize = Number((block as { fsize?: number }).fsize ?? pending?.size ?? 0);
  const fby = ((block as { fby?: string }).fby ?? null) as string | null;
  const fat = ((block as { fat?: string }).fat ?? null) as string | null;

  const uploading = !!pending;
  const tone = fileTone(fname);
  const kind = fileKind(fname);

  const upload = useCallback(
    (file: File, oldPath: string | null) => {
      const bad = rejectFileReason(file);
      if (bad) {
        toast.push(bad);
        return;
      }
      if (!ctx) {
        toast.push("This page cannot accept files yet.");
        return;
      }
      // The card appears immediately from the LOCAL file; the upload runs
      // behind it.
      setPending(file);
      setFailed(null);
      const meta: Partial<Blk> = {
        fname: file.name,
        fsize: file.size,
        fmime: file.type || "application/octet-stream",
        fby: profile?.full_name ?? undefined,
        fat: new Date().toISOString(),
      } as Partial<Blk>;
      onChange({ ...meta, path: undefined } as Partial<Blk>);
      uploadFile(file, ctx.workspaceId, ctx.pageId)
        .then((p) => {
          setPending(null);
          // The completion patch REPEATS the metadata. It lands one network
          // round-trip later, so it must be self-sufficient — a patch that
          // carried only `path` could merge into a pre-upload snapshot and
          // erase the name and size that were already written.
          onChange({ ...meta, path: p } as Partial<Blk>);
          // Replace deletes the object it superseded — the previous file is
          // no longer reachable from any block.
          if (oldPath) void gcImagePaths(ctx.pageId, [oldPath]);
        })
        .catch(() => {
          setPending(null);
          setFailed(file);
        });
    },
    [ctx, onChange, profile?.full_name, toast],
  );


  const openIt = useCallback(async () => {
    if (!path) return;
    try {
      const url = await signPath(path);
      window.open(url, "_blank", "noopener");
    } catch {
      toast.push("Could not open that file.");
    }
  }, [path, toast]);

  const downloadIt = useCallback(async () => {
    if (!path) return;
    try {
      const url = await signPath(path);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname || "download";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.push(`Downloading ${fname}`);
    } catch {
      toast.push("Could not download that file.");
    }
  }, [path, fname, toast]);

  const meta = useMemo(() => {
    if (uploading) return `Uploading… · ${fileMetaLine(fsize)}`;
    if (failed) return "Upload failed — try again";
    return fileMetaLine(fsize, fby, fat ? fmtDate(fat) : null);
  }, [uploading, failed, fsize, fby, fat, fmtDate]);

  if (!path && !uploading && !failed) {
    return <EmptyState onFile={(f) => upload(f, null)} locked={locked} />;
  }

  const inert = uploading || !path;
  const showEdit = hover && !locked;

  return (
    <div
      className="flex items-center bg-surface"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        // A failed card IS the retry target.
        if (failed && !locked) upload(failed, null);
      }}
      style={{
        margin: "12px 0",
        gap: 12,
        border: `1px solid var(--color-${hover ? "rule" : "line"})`,
        borderRadius: 10,
        padding: "11px 12px",
        boxShadow: hover ? "var(--shadow-cardHover)" : "var(--shadow-card)",
        cursor: failed ? "pointer" : undefined,
        transition: "border-color 120ms ease, box-shadow 120ms ease",
      }}
    >
      <span
        className="grid shrink-0 place-items-center"
        style={{
          height: 38,
          width: 38,
          borderRadius: 9,
          background: `var(--color-${tone.tint})`,
          color: `var(--color-${tone.ink})`,
        }}
      >
        <Ico d={KIND_ICON[kind]} size={19} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center" style={{ gap: 7 }}>
          <span className="min-w-0 truncate font-display text-row font-bold text-noir">
            {fname}
          </span>
          <span
            className="shrink-0 font-display text-nano font-bold"
            style={{
              borderRadius: 5,
              padding: "1px 5px",
              background: `var(--color-${tone.tint})`,
              color: `var(--color-${tone.ink})`,
            }}
          >
            {badgeLabel(fname)}
          </span>
        </span>
        <span
          className="block truncate text-caption"
          style={{ color: failed ? "var(--color-amberInk)" : "var(--color-faint)" }}
        >
          {meta}
        </span>
      </span>

      <span className="flex shrink-0 items-center" style={{ gap: 2 }}>
        {isOpenable(fname) ? (
          <ActionBtn title="Open" d={OPEN_ICON} onPick={openIt} disabled={inert} />
        ) : null}
        <ActionBtn
          title="Download"
          d={DOWNLOAD_ICON}
          onPick={downloadIt}
          disabled={inert}
        />
        <ActionBtn
          title="Replace"
          d={REPLACE_ICON}
          hidden={!showEdit}
          disabled={!showEdit}
          onPick={() => replaceRef.current?.click()}
        />
        <ActionBtn
          title="Remove"
          d={REMOVE_ICON}
          hidden={!showEdit}
          disabled={!showEdit}
          onPick={onDelete}
        />
      </span>

      <input
        ref={replaceRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(f, path);
        }}
      />
    </div>
  );
}
