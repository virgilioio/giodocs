/**
 * Pure helpers for the two image block types.
 *
 * Nothing here touches Supabase, the DOM, or React — the storage calls
 * live in src/lib/images.ts and the rendering in
 * src/components/image-block.tsx. Everything in this file is unit-tested.
 *
 * THE ONE RULE: a block stores a STORAGE PATH
 * ({workspace_id}/{page_id}/{uuid}.{ext}), never a signed URL. Signed
 * URLs expire in an hour; a block carrying one would break silently a
 * week later.
 */

import type { Blk } from "./block-ops";

export const IMAGE_BUCKET = "page-images";
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_EDGE = 2400;
export const IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

export const W_MIN = 25;
export const W_MAX = 100;

export type ImageAlign = "left" | "center" | "right" | "full";

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIME as readonly string[]).includes(mime);
}

/** Gate a file BEFORE any upload work. Returns null when acceptable. */
export function rejectReason(file: { type: string; size: number }): string | null {
  if (!isImageMime(file.type)) return "That file is not an image.";
  if (file.size > IMAGE_MAX_BYTES) return "Images have to be under 10 MB.";
  return null;
}

export function extForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

export function storagePath(
  workspaceId: string,
  pageId: string,
  uuid: string,
  ext: string,
): string {
  return `${workspaceId}/${pageId}/${uuid}.${ext}`;
}

export function clampW(n: number): number {
  if (!Number.isFinite(n)) return W_MAX;
  return Math.max(W_MIN, Math.min(W_MAX, Math.round(n)));
}

/**
 * Width after a resize drag.
 *
 * `dx` is the pointer delta in px; `containerW` the column width. A
 * CENTRE-aligned image moves both edges, so the visible change is twice
 * the pointer delta — without the ×2 a centred image feels like it is
 * sliding rather than scaling. `edge` is which grip is held: dragging the
 * left grip rightwards shrinks.
 */
export function resizeW(
  startW: number,
  dx: number,
  containerW: number,
  align: ImageAlign,
  edge: "left" | "right",
): number {
  if (!containerW || containerW <= 0) return clampW(startW);
  const dir = edge === "left" ? -1 : 1;
  const factor = align === "center" ? 2 : 1;
  const deltaPct = ((dx * dir) / containerW) * 100 * factor;
  return clampW(startW + deltaPct);
}

/** Dragging a `full` image drops it to `center` at the dragged width. */
export function alignAfterResize(align: ImageAlign): ImageAlign {
  return align === "full" ? "center" : align;
}

export function readAlign(b: unknown): ImageAlign {
  const a = (b as { align?: unknown } | null)?.align;
  return a === "left" || a === "right" || a === "full" ? a : "center";
}

export function readW(b: unknown): number {
  const w = (b as { w?: unknown } | null)?.w;
  return typeof w === "number" ? clampW(w) : W_MAX;
}

/** Image-row column count. Only 2 or 3 — this is not a column system. */
export function readCols(b: unknown): 2 | 3 {
  return (b as { cols?: unknown } | null)?.cols === 3 ? 3 : 2;
}

export function readPaths(b: unknown): (string | null)[] {
  const raw = (b as { paths?: unknown } | null)?.paths;
  const cols = readCols(b);
  const arr = Array.isArray(raw) ? raw : [];
  const out: (string | null)[] = [];
  for (let i = 0; i < cols; i++) {
    const v = arr[i];
    out.push(typeof v === "string" && v ? v : null);
  }
  return out;
}

/** Every storage path referenced anywhere in a block tree. */
export function collectImagePaths(blocks: readonly Blk[] | undefined): string[] {
  const out: string[] = [];
  const walk = (list: readonly Blk[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const b of list) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "image") {
        const p = (b as { path?: unknown }).path;
        if (typeof p === "string" && p) out.push(p);
      }
      if (b.type === "imagerow") {
        for (const p of readPaths(b)) if (p) out.push(p);
      }
      if (Array.isArray(b.children)) walk(b.children as Blk[]);
      if (Array.isArray(b.cols)) {
        for (const col of b.cols as Blk[][]) walk(col);
      }
    }
  };
  walk(blocks);
  return out;
}

/** Paths present before an edit and gone after it — the GC candidates. */
export function droppedImagePaths(
  prev: readonly Blk[] | undefined,
  next: readonly Blk[] | undefined,
): string[] {
  const after = new Set(collectImagePaths(next));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of collectImagePaths(prev)) {
    if (after.has(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
