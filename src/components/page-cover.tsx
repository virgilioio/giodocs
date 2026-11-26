import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";
import { useSignedImageUrl, uploadImage } from "@/lib/images";
import { rejectReason } from "@/lib/image-ops";
import {
  COVER_GALLERY,
  canReposition,
  coverObjectPosition,
  coverOverflow,
  dragPosition,
  galleryCover,
  linkCover,
  type PageCover,
} from "@/lib/page-cover";
import { Popover } from "./popover";

/* Page covers (Allan, 2026-11-25), Notion's: the image across the top of a
 * page, its controls on hover (Change cover · Reposition · Remove), the
 * drag to reposition, and the picker (Gallery · Upload · Link). What a
 * cover is lives in src/lib/page-cover.ts; saving is useSetPageCover. */

type Tab = "gallery" | "upload" | "link";

/** The picker: Gio's colours and gradients, an image from your computer
 *  (into the page's own folder), or an image's web address. */
export function CoverPicker({
  workspaceId,
  pageId,
  cover,
  onPick,
  onRemove,
}: {
  workspaceId: string;
  pageId: string;
  cover: PageCover | null;
  onPick: (c: PageCover) => void;
  onRemove?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(
    cover?.kind === "link" ? "link" : cover?.kind === "upload" ? "upload" : "gallery",
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(cover?.kind === "link" ? cover.value : "");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const why = rejectReason(file);
    if (why) {
      setProblem(why);
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const path = await uploadImage(file, workspaceId, pageId);
      onPick({ kind: "upload", value: path, position: 50 });
    } catch {
      setProblem("Couldn’t upload the image. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitLink = () => {
    const r = linkCover(link);
    if (r.problem) {
      setProblem(r.problem);
      return;
    }
    setProblem(null);
    onPick(r.cover!);
  };

  const tabBtn = (t: Tab, label: string) => (
    <button
      key={t}
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => {
        setTab(t);
        setProblem(null);
      }}
      className="gio-cover-tab"
      data-active={tab === t ? "true" : undefined}
    >
      {label}
    </button>
  );

  return (
    <div className="gio-cover-picker" data-cover-picker>
      <div className="gio-cover-tabs" role="tablist" aria-label="Cover">
        {tabBtn("gallery", "Gallery")}
        {tabBtn("upload", "Upload")}
        {tabBtn("link", "Link")}
        <span className="flex-1" />
        {cover && onRemove ? (
          <button type="button" onClick={onRemove} className="gio-cover-tab">
            Remove
          </button>
        ) : null}
      </div>

      {tab === "gallery" ? (
        <div className="gio-cover-grid">
          {COVER_GALLERY.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-label={g.label}
              title={g.label}
              aria-pressed={cover?.kind === "gallery" && cover.value === g.id}
              onClick={() => onPick({ kind: "gallery", value: g.id })}
              className="gio-cover-swatch"
              style={{ background: g.css }}
            />
          ))}
        </div>
      ) : tab === "upload" ? (
        <div
          className="gio-cover-drop"
          data-drag-over={dragOver ? "true" : undefined}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void upload(e.dataTransfer.files?.[0]);
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-md border border-line bg-surface text-row text-strong hover:bg-rail disabled:opacity-60"
            style={{ height: 32, fontWeight: 700 }}
          >
            {busy ? "Uploading…" : "Upload an image"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              void upload(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <p className="mt-2 text-center text-caption text-faint">
            Or drop one here. Images wider than 1500 pixels work best; under 10 MB.
          </p>
        </div>
      ) : (
        <form
          className="gio-cover-link"
          onSubmit={(e) => {
            e.preventDefault();
            submitLink();
          }}
        >
          <input
            value={link}
            onChange={(e) => {
              setLink(e.currentTarget.value);
              if (problem) setProblem(null);
            }}
            placeholder="Paste an image link…"
            aria-label="Image link"
            aria-invalid={problem ? true : undefined}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface text-row text-body focus:border-accent focus:outline-none"
            style={{ height: 32, padding: "0 10px" }}
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-btn text-row text-btnFg"
            style={{ height: 32, padding: "0 12px", fontWeight: 700 }}
          >
            Use image
          </button>
        </form>
      )}
      {tab === "link" ? (
        <p className="mt-1.5 text-caption text-faint">Works with any image on the web.</p>
      ) : null}
      {/* Reserved: a problem never moves the picker. */}
      <p className="gio-cover-problem" role={problem ? "alert" : undefined}>
        {problem ?? ""}
      </p>
    </div>
  );
}

/** "Add cover": shown above the title of a page without one. */
export function AddCoverButton({ onAdd, visible }: { onAdd: () => void; visible: boolean }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="gio-cover-add"
      data-visible={visible ? "true" : undefined}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 16 5-5 4 4 3-3 6 6" />
        <circle cx="15.5" cy="9.5" r="1.5" />
      </svg>
      Add cover
    </button>
  );
}

/** The cover itself, with its controls for people who can edit the page. */
export function PageCoverBanner({
  pageId,
  workspaceId,
  cover,
  editable,
  onChange,
  onRemove,
}: {
  pageId: string;
  workspaceId: string;
  cover: PageCover;
  editable: boolean;
  onChange: (c: PageCover) => void;
  onRemove: () => void;
}) {
  const signed = useSignedImageUrl(cover.kind === "upload" ? cover.value : null);
  const src =
    cover.kind === "upload" ? (signed.data ?? null) : cover.kind === "link" ? cover.value : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  // Reposition: the image follows the pointer; Save keeps it, Cancel or
  // Esc puts it back.
  const [moving, setMoving] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ y: number; start: number; overflow: number; height: number } | null>(null);
  const position = draft ?? cover.position ?? 50;

  const cancel = useCallback(() => {
    setMoving(false);
    setDraft(null);
  }, []);
  useEffect(() => {
    if (!moving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [moving, cancel]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!moving || e.button !== 0) return;
    // The Save and Cancel buttons keep their own clicks.
    if ((e.target as HTMLElement).closest("[data-cover-controls]")) return;
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    drag.current = {
      y: e.clientY,
      start: position,
      height: box.clientHeight,
      overflow: img
        ? coverOverflow(
            { w: img.naturalWidth, h: img.naturalHeight },
            { w: box.clientWidth, h: box.clientHeight },
          )
        : 0,
    };
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setDraft(dragPosition(d.start, e.clientY - d.y, d.overflow, d.height));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const image = cover.kind !== "gallery";
  return (
    <div
      ref={boxRef}
      className="gio-cover"
      data-cover-kind={cover.kind}
      data-moving={moving ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={cover.kind === "gallery" ? { background: galleryCover(cover.value).css } : undefined}
    >
      {image && src && !failed ? (
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="gio-cover-img"
          style={{ objectPosition: coverObjectPosition({ ...cover, position }) }}
        />
      ) : null}
      {image && failed ? (
        <span className="gio-cover-missing">This image couldn’t be loaded.</span>
      ) : null}
      {moving ? <span className="gio-cover-hint">Drag the image to reposition</span> : null}

      {editable ? (
        <div className="gio-cover-controls" data-cover-controls>
          {moving ? (
            <>
              <button
                type="button"
                className="gio-cover-btn"
                onClick={() => {
                  if (draft !== null) onChange({ ...cover, position: draft });
                  cancel();
                }}
              >
                Save position
              </button>
              <button type="button" className="gio-cover-btn" onClick={cancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <Popover
                width={420}
                align="end"
                trigger={({ open, onClick, ref }) => (
                  <button
                    ref={ref}
                    type="button"
                    aria-expanded={open}
                    onClick={onClick}
                    className="gio-cover-btn"
                  >
                    Change cover
                  </button>
                )}
              >
                {(close) => (
                  <CoverPicker
                    workspaceId={workspaceId}
                    pageId={pageId}
                    cover={cover}
                    onPick={(c) => {
                      onChange(c);
                      close();
                    }}
                    onRemove={() => {
                      onRemove();
                      close();
                    }}
                  />
                )}
              </Popover>
              {canReposition(cover) && src && !failed ? (
                <button type="button" className="gio-cover-btn" onClick={() => setMoving(true)}>
                  Reposition
                </button>
              ) : null}
              <button type="button" className="gio-cover-btn" onClick={onRemove}>
                Remove
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
