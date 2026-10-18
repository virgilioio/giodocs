import { useRef, useState } from "react";
import { Popover } from "./popover";
import { MenuSep } from "./menu-parts";
import { useToast } from "@/lib/toast";
import { useWorkspaceId } from "@/lib/workspace-context";
import { signPath, uploadFile } from "@/lib/images";
import { formatBytes, rejectFileReason } from "@/lib/file-ops";
import {
  FILES_MAX,
  filesSummary,
  readFileList,
  withFile,
  withoutFile,
  type FileValue,
} from "@/lib/file-values";

/* A Files & media property's value, in a table cell or a row's strip: the
 * file names, and a popover that lists them (open, remove) and uploads
 * more. Files go to the row's own folder, so they're exactly as private as
 * the row. Without onSet it's read-only (open only). */

type Variant = "strip" | "cell";

export function FilesValue({
  pageId,
  value,
  onSet,
  variant = "cell",
  emptyLabel = "Empty",
  triggerClassName = "",
}: {
  pageId: string;
  value: unknown;
  onSet?: (files: FileValue[] | null) => void;
  variant?: Variant;
  emptyLabel?: string;
  triggerClassName?: string;
}) {
  const files = readFileList(value);
  return (
    <Popover
      width={280}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className={`min-w-0 truncate text-left ${triggerClassName}`}
          aria-label={files.length ? `Files: ${files.map((f) => f.name).join(", ")}` : "Add files"}
        >
          {files.length ? (
            <span className={variant === "cell" ? "text-meta text-body" : "text-strong"}>
              {filesSummary(files)}
            </span>
          ) : variant === "cell" ? (
            <span className="text-faint">—</span>
          ) : (
            <span className="text-whisper">{emptyLabel}</span>
          )}
        </button>
      )}
    >
      {() => <FilesBody pageId={pageId} files={files} onSet={onSet} />}
    </Popover>
  );
}

function FilesBody({
  pageId,
  files,
  onSet,
}: {
  pageId: string;
  files: FileValue[];
  onSet?: (files: FileValue[] | null) => void;
}) {
  const workspaceId = useWorkspaceId();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Uploads finish one by one: each adds to the newest list, not the one
  // the popover opened with.
  const latest = useRef(files);
  latest.current = files;

  const write = (next: FileValue[]) => {
    latest.current = next;
    onSet?.(next.length ? next : null);
  };

  const add = async (list: FileList | null) => {
    if (!list || !onSet) return;
    setError(null);
    for (const file of Array.from(list)) {
      const bad = rejectFileReason(file);
      if (bad) {
        setError(bad);
        continue;
      }
      if (latest.current.length >= FILES_MAX) {
        setError(`A property holds at most ${FILES_MAX} files.`);
        break;
      }
      setBusy((n) => n + 1);
      try {
        const path = await uploadFile(file, workspaceId, pageId);
        write(
          withFile(latest.current, {
            path,
            name: file.name,
            size: file.size,
            mime: file.type || "application/octet-stream",
          }),
        );
      } catch {
        setError(`Couldn't upload ${file.name}. Try again.`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const open = async (f: FileValue) => {
    try {
      window.open(await signPath(f.path), "_blank", "noopener");
    } catch {
      toast.push("Could not open that file.");
    }
  };

  return (
    <div>
      <div className="max-h-56 overflow-y-auto">
        {files.map((f) => (
          <div key={f.path} className="gio-mrow group">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => void open(f)}
            >
              {f.name}
            </button>
            {f.size > 0 ? <span className="gio-mrow-hint">{formatBytes(f.size)}</span> : null}
            {onSet ? (
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                title={`Remove ${f.name}`}
                className="rounded-sm px-1 text-meta text-faint opacity-0 hover:text-body group-hover:opacity-100 focus:opacity-100"
                onClick={() => write(withoutFile(latest.current, f.path))}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        {files.length === 0 ? <p className="gio-mfoot">No files yet.</p> : null}
      </div>
      {onSet ? (
        <>
          <MenuSep />
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy > 0}
            className="gio-mrow"
            onClick={() => input.current?.click()}
          >
            <span className="truncate">{busy > 0 ? "Uploading…" : "Upload a file"}</span>
          </button>
          <p className="min-h-[18px] px-2 text-meta text-danger" role="status">
            {error ?? ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
