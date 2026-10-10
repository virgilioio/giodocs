/**
 * The two image blocks: `image` (one image, aligned and resizable) and
 * `imagerow` (two or three images side by side).
 *
 * IMAGEROW IS NOT A COLUMN SYSTEM — it holds 2 or 3 images and nothing
 * else. Layout nesting is what the `columns` block is for.
 *
 * Both store STORAGE PATHS. A signed URL is resolved for rendering and
 * cached by path; nothing signed is ever written back into the block.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Blk } from "@/lib/block-ops";
import { useSignedImageUrl, uploadImage } from "@/lib/images";
import {
  clampW,
  readAlign,
  readCols,
  readPaths,
  readW,
  rejectReason,
  resizeW,
  alignAfterResize,
  type ImageAlign,
} from "@/lib/image-ops";

/* ────────────── Page context (workspace + page for the path) ───────── */

export type PageImageCtxValue = { workspaceId: string; pageId: string };
export const PageImageCtx = createContext<PageImageCtxValue | null>(null);

/* ────────────── Icons ────────────── */

const ALIGN_ICON: Record<ImageAlign, string> = {
  left: "M3 5.5h18M3 18.5h18M3 9.8h11v4.4H3z",
  center: "M3 5.5h18M3 18.5h18M6.5 9.8h11v4.4h-11z",
  right: "M3 5.5h18M3 18.5h18M10 9.8h11v4.4H10z",
  full: "M3 5.5h18M3 18.5h18M2 9.6h20v4.8H2z",
};
const CAPTION_ICON =
  "M4 5.5h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM6 19h8";
const TRASH_ICON =
  "M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3";
const IMAGE_ICON =
  "M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-12a1.5 1.5 0 0 1 1.5-1.5zM8.6 9.4a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM3 16.2l4.8-4.2 4.4 3.9 3.3-2.9L21 17.6";

function Ico({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/* ────────────── The one dark floating bar ────────────── */

const BAR: React.CSSProperties = {
  position: "absolute",
  top: 8,
  left: "50%",
  // translate, not transform, so the pop-in scale doesn't knock it off centre.
  translate: "-50% 0",
  transformOrigin: "top center",
  zIndex: 6,
  background: "var(--color-btn)",
  borderRadius: 9,
  padding: 4,
  gap: 2,
  display: "flex",
  alignItems: "center",
  boxShadow: "0 8px 24px rgba(0,0,0,.22)",
  animation: "var(--animate-popIn)",
};

const BTN: React.CSSProperties = {
  height: 26,
  width: 26,
  display: "grid",
  placeItems: "center",
  borderRadius: 6,
  border: 0,
  cursor: "pointer",
  background: "transparent",
  color: "var(--color-whisper)",
};

const ACTIVE: React.CSSProperties = {
  background: "rgba(255,255,255,.18)",
  color: "var(--color-btnFg)",
};

function BarBtn({
  title,
  d,
  active,
  danger,
  onPick,
  children,
}: {
  title: string;
  d?: string;
  active?: boolean;
  danger?: boolean;
  onPick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        ...BTN,
        ...(active ? ACTIVE : null),
        ...(danger ? { color: "var(--color-dangerDot)" } : null),
        ...(children ? { width: "auto", padding: "0 8px" } : null),
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPick();
      }}
    >
      {children ?? (d ? <Ico d={d} /> : null)}
    </button>
  );
}

const Divider = () => (
  <span
    aria-hidden
    style={{
      display: "inline-block",
      width: 1,
      height: 18,
      margin: "0 4px",
      background: "rgba(255,255,255,.18)",
    }}
  />
);

/* ────────────── Empty state / drop target ────────────── */

function EmptyState({
  onFile,
  locked,
  compact,
}: {
  onFile: (f: File) => void;
  locked: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add an image"
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
      onDragLeave={(e) => {
        // Moving over a child element fires dragleave on the parent: only
        // clear when the pointer really left (no flicker).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const f = e.dataTransfer?.files?.[0];
        if (f && !locked) onFile(f);
      }}
      className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 bg-track text-secondary"
      style={{
        border: `1px dashed var(--color-${over ? "accentDot" : "lineStrong"})`,
        borderRadius: 9,
        minHeight: compact ? 112 : 168,
      }}
    >
      <span className="text-whisper">
        <Ico d={IMAGE_ICON} size={20} />
      </span>
      <span className="text-meta text-secondary">
        Drop an image, or click to browse
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
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

/* ────────────── Upload state shared by both blocks ────────────── */

type Slot = {
  preview: string | null;
  failed: boolean;
  file: File | null;
};

function useUploader(onDone: (path: string, slot: number) => void) {
  const ctx = useContext(PageImageCtx);
  const [slots, setSlots] = useState<Record<number, Slot>>({});
  const previews = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const u of previews.current) URL.revokeObjectURL(u);
    },
    [],
  );

  const start = useCallback(
    (file: File, slot = 0): string | null => {
      const bad = rejectReason(file);
      if (bad) return bad;
      if (!ctx) return "This page cannot accept images yet.";
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      setSlots((s) => ({ ...s, [slot]: { preview, failed: false, file } }));
      uploadImage(file, ctx.workspaceId, ctx.pageId)
        .then((path) => {
          onDone(path, slot);
          setSlots((s) => ({ ...s, [slot]: { preview, failed: false, file: null } }));
        })
        .catch(() => {
          // Keep the local preview — losing a pasted screenshot to a
          // network blip mid-migration is the worst available outcome.
          setSlots((s) => ({ ...s, [slot]: { preview, failed: true, file } }));
        });
      return null;
    },
    [ctx, onDone],
  );

  const clearSlot = useCallback((slot: number) => {
    setSlots((s) => {
      const n = { ...s };
      delete n[slot];
      return n;
    });
  }, []);

  return { slots, start, clearSlot };
}

/* ────────────── Resolved <img> ────────────── */

/* Remember each image's shape so its block holds that height while the
   signed URL resolves and the file decodes, instead of growing from zero
   and pushing the page down. Per-device cache only; nothing is written to
   the block. */
const RATIO_KEY = "gio.image.ratios";
const RATIO_MAX = 400;
let ratios: Map<string, number> | null = null;
function ratioCache(): Map<string, number> {
  if (ratios) return ratios;
  ratios = new Map();
  try {
    const raw = localStorage.getItem(RATIO_KEY);
    if (raw) for (const [k, v] of JSON.parse(raw) as [string, number][]) ratios.set(k, v);
  } catch {
    /* private mode or bad data: start empty */
  }
  return ratios;
}
function rememberRatio(path: string, ratio: number) {
  const m = ratioCache();
  if (m.get(path) === ratio) return;
  m.delete(path);
  m.set(path, ratio);
  while (m.size > RATIO_MAX) m.delete(m.keys().next().value as string);
  try {
    localStorage.setItem(RATIO_KEY, JSON.stringify([...m]));
  } catch {
    /* quota or private mode */
  }
}

function StoredImage({
  path,
  preview,
  alt,
  onLoaded,
}: {
  path?: string | null;
  preview?: string | null;
  alt: string;
  onLoaded?: () => void;
}) {
  const q = useSignedImageUrl(path);
  const src = q.data ?? preview ?? "";
  // Once any source has shown, keep showing: the switch from the upload
  // preview to the signed URL, or a refreshed signed URL, must not blink
  // back to the placeholder.
  const [loaded, setLoaded] = useState(false);
  const ratioRef = useRef<number | null>(null);
  useEffect(() => {
    // The preview loads before the upload has a path; remember its shape
    // once the path arrives.
    if (path && ratioRef.current) rememberRatio(path, ratioRef.current);
  }, [path]);
  useEffect(() => {
    if (q.data && preview && onLoaded) onLoaded();
  }, [q.data, preview, onLoaded]);
  const known = path ? ratioCache().get(path) : undefined;
  const onImg = (img: HTMLImageElement) => {
    if (img.naturalWidth && img.naturalHeight) {
      ratioRef.current = img.naturalWidth / img.naturalHeight;
      if (path) rememberRatio(path, ratioRef.current);
    }
    setLoaded(true);
  };
  return (
    <div
      style={{
        position: "relative",
        borderRadius: "inherit",
        // Until the file is in, hold the remembered shape (or 16:9).
        aspectRatio: loaded ? undefined : String(known ?? 16 / 9),
        background: loaded ? undefined : "var(--color-sunken)",
      }}
    >
      {src ? (
        <img
          ref={(el) => {
            // A cached image can finish before React attaches onLoad.
            if (el?.complete && el.naturalWidth) onImg(el);
          }}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => onImg(e.currentTarget)}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            borderRadius: "inherit",
            opacity: loaded ? 1 : 0,
            transition: "opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        />
      ) : null}
    </div>
  );
}

/* ────────────── Caption ────────────── */

function Caption({
  value,
  onChange,
  locked,
}: {
  value: string;
  onChange: (v: string) => void;
  locked: boolean;
}) {
  return (
    <input
      value={value}
      readOnly={locked}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Describe this image…"
      aria-label="Image caption"
      className="w-full border-0 bg-transparent text-center text-caption text-muted outline-none placeholder:text-faint"
      style={{ marginTop: 7 }}
    />
  );
}

/* ────────────── Image block ────────────── */

export function ImageBlock({
  block,
  locked,
  onChange,
  onDelete,
  onUndoMark,
}: {
  block: Blk;
  locked: boolean;
  onChange: (patch: Partial<Blk>) => void;
  onDelete: () => void;
  onUndoMark?: () => void;
}) {
  // While resizing, the width lives here (only this image re-renders); the
  // block is written once, on release — one save and one undo step, not
  // one per pixel.
  const [draft, setDraft] = useState<{ w: number; align: ReturnType<typeof readAlign> } | null>(null);
  const align = draft?.align ?? readAlign(block);
  const w = draft?.w ?? readW(block);
  const path = (block as { path?: string }).path ?? null;
  const cap = ((block as { cap?: string }).cap ?? "") as string;
  const [hover, setHover] = useState(false);
  const [capOn, setCapOn] = useState(!!cap);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const onDone = useCallback(
    (p: string) => {
      onChange({ path: p } as Partial<Blk>);
    },
    [onChange],
  );
  const { slots, start } = useUploader(onDone);
  const slot = slots[0];

  const take = useCallback(
    (f: File) => {
      const bad = start(f, 0);
      setErr(bad);
    },
    [start],
  );

  /* Resize — listeners on WINDOW, since the pointer leaves a shrinking image.
   * Pointer events (mouse, pen and touch); Esc puts the width back. */
  const beginResize = (edge: "left" | "right", ev: React.PointerEvent) => {
    if (locked) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX;
    const startWidth = w;
    const startAlign = align;
    const containerW = wrapRef.current?.offsetWidth ?? 640;
    let last: { w: number; align: ReturnType<typeof readAlign> } | null = null;
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const move = (e: PointerEvent) => {
      const next = resizeW(startWidth, e.clientX - startX, containerW, startAlign, edge);
      last = { w: next, align: alignAfterResize(startAlign) };
      setDraft(last);
    };
    const stop = (commitIt: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      document.body.style.userSelect = prevSelect;
      setDraft(null);
      if (commitIt && last && (last.w !== startWidth || last.align !== startAlign)) {
        onUndoMark?.();
        onChange({ w: last.w, align: last.align } as unknown as Partial<Blk>);
      }
    };
    const onUp = () => stop(true);
    const onCancel = () => stop(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      stop(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  const empty = !path && !slot?.preview;
  const show = hover && !locked;

  const justify =
    align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  const full = align === "full";

  return (
    <div
      ref={wrapRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={(e) => {
        if (empty) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f && !locked) {
          e.preventDefault();
          e.stopPropagation();
          take(f);
        }
      }}
      style={{
        display: "flex",
        justifyContent: justify,
        margin: full ? "18px -44px" : "14px 0",
      }}
    >
      <div
        style={{
          position: "relative",
          width: full ? "calc(100% + 88px)" : `${clampW(w)}%`,
          // A full-bleed image with rounded corners reads as a card that
          // failed to fit, so `full` squares its corners.
          borderRadius: full ? 0 : 9,
        }}
      >
        {empty ? (
          <EmptyState onFile={take} locked={locked} />
        ) : (
          <StoredImage
            path={path}
            preview={slot?.preview ?? null}
            alt={((block as { alt?: string }).alt ?? cap ?? "") as string}
          />
        )}

        {err ? <p className="text-meta text-amber">{err}</p> : null}
        {slot?.failed ? (
          <p className="text-meta text-amber">
            Upload failed — the image is still here,{" "}
            <button
              type="button"
              className="underline"
              onClick={() => slot.file && take(slot.file)}
            >
              try again
            </button>
            .
          </p>
        ) : null}

        {show && !empty ? (
          <>
            <div style={BAR}>
              {(["left", "center", "right", "full"] as ImageAlign[]).map((a) => (
                <BarBtn
                  key={a}
                  title={a === "full" ? "Full width" : `Align ${a}`}
                  d={ALIGN_ICON[a]}
                  active={align === a}
                  onPick={() => onChange({ align: a } as unknown as Partial<Blk>)}
                />
              ))}
              <Divider />
              <span
                className="font-mono text-whisper"
                style={{ fontSize: 11, padding: "0 4px" }}
              >
                {full ? "Full" : `${clampW(w)}%`}
              </span>
              <BarBtn
                title="Caption"
                d={CAPTION_ICON}
                active={capOn}
                onPick={() => setCapOn((v) => !v)}
              />
              <BarBtn title="Delete" d={TRASH_ICON} danger onPick={onDelete} />
            </div>
            {(["left", "right"] as const).map((edge) => (
              <span
                key={edge}
                role="separator"
                aria-label={`Resize from the ${edge}`}
                onPointerDown={(e) => beginResize(edge, e)}
                style={{
                  touchAction: "none",
                  position: "absolute",
                  [edge]: 5,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 5,
                  height: 38,
                  borderRadius: 99,
                  background: "var(--color-btn)",
                  opacity: 0.55,
                  cursor: "ew-resize",
                  zIndex: 6,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
              />
            ))}
          </>
        ) : null}

        {capOn ? (
          <Caption
            value={cap}
            locked={locked}
            onChange={(v) => onChange({ cap: v } as Partial<Blk>)}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ────────────── Image row block ────────────── */

export function ImageRowBlock({
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
  const cols = readCols(block);
  const paths = readPaths(block);
  const cap = ((block as { cap?: string }).cap ?? "") as string;
  const [hover, setHover] = useState(false);
  const [capOn, setCapOn] = useState(!!cap);
  const [err, setErr] = useState<string | null>(null);

  const onDone = useCallback(
    (p: string, slot: number) => {
      const next = readPaths(block).slice();
      next[slot] = p;
      onChange({ paths: next } as Partial<Blk>);
    },
    [block, onChange],
  );
  const { slots, start } = useUploader(onDone);

  const setCols = (n: 2 | 3) => {
    const next = readPaths(block).slice(0, n);
    while (next.length < n) next.push(null);
    onChange({ cols: n, paths: next } as unknown as Partial<Blk>);
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: "relative", margin: "14px 0" }}
    >
      <div
        style={{
          display: "grid",
          // minmax(0,1fr): plain 1fr lets a wide image push its track past
          // its share.
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: 10,
        }}
      >
        {paths.map((p, i) => {
          const s = slots[i];
          return (
            <div key={i} style={{ borderRadius: 9, overflow: "hidden" }}>
              {p || s?.preview ? (
                <StoredImage path={p} preview={s?.preview ?? null} alt={cap} />
              ) : (
                <EmptyState
                  compact
                  locked={!!locked}
                  onFile={(f) => setErr(start(f, i))}
                />
              )}
              {s?.failed ? (
                <p className="text-meta text-amber">
                  Upload failed — the image is still here,{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => s.file && setErr(start(s.file, i))}
                  >
                    try again
                  </button>
                  .
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {err ? <p className="text-meta text-amber">{err}</p> : null}

      {hover && !locked ? (
        <div style={BAR}>
          {([2, 3] as const).map((n) => (
            <BarBtn
              key={n}
              title={`${n} up`}
              active={cols === n}
              onPick={() => setCols(n)}
            >
              <span className="text-meta">{n} up</span>
            </BarBtn>
          ))}
          <Divider />
          <BarBtn
            title="Caption"
            d={CAPTION_ICON}
            active={capOn}
            onPick={() => setCapOn((v) => !v)}
          />
          <BarBtn title="Delete" d={TRASH_ICON} danger onPick={onDelete} />
        </div>
      ) : null}

      {capOn ? (
        <Caption
          value={cap}
          locked={locked}
          onChange={(v) => onChange({ cap: v } as Partial<Blk>)}
        />
      ) : null}
    </div>
  );
}
