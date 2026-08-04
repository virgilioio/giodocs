/**
 * Pure helpers for the `file` block.
 *
 * Nothing here touches Supabase, the DOM or React — the storage calls live
 * in src/lib/images.ts (the shared page-images bucket layer) and the
 * rendering in src/components/file-block.tsx. Everything in this file is
 * unit-tested.
 *
 * THE ONE RULE, same as images: a block stores a STORAGE PATH
 * ({workspace_id}/{page_id}/files/{uuid}.{ext}), never a signed URL. Signed
 * URLs expire in an hour; a block carrying one would break silently a week
 * later.
 *
 * Size, not type, is what we validate. The bucket accepts any mime; the
 * 25 MB ceiling is the product judgement — a 200 MB video in a wiki page is
 * a symptom, not a use case.
 */

export const FILE_MAX_BYTES = 25 * 1024 * 1024;

/** The four glyph families a file card can wear. */
export type FileKind = "doc" | "sheet" | "image" | "zip" | "generic";

/** A tint/ink pair, both EXISTING palette token names — no new colour
 *  values enter the system for this block. */
export type FileTone = { tint: string; ink: string };

type Mapping = { kind: FileKind; tone: FileTone };

const DOC_DANGER: Mapping = { kind: "doc", tone: { tint: "dangerTint", ink: "danger" } };
const DOC_BLUE: Mapping = { kind: "doc", tone: { tint: "blueTint", ink: "blueInk" } };
const DOC_PLAIN: Mapping = { kind: "doc", tone: { tint: "sunken", ink: "secondary" } };
const SHEET: Mapping = { kind: "sheet", tone: { tint: "accentTint", ink: "accent" } };
const IMAGE: Mapping = { kind: "image", tone: { tint: "purpleTint", ink: "purple" } };
const ZIP: Mapping = { kind: "zip", tone: { tint: "amberTint", ink: "amberInk" } };
const DECK: Mapping = { kind: "doc", tone: { tint: "pinkTint", ink: "pink" } };
const GENERIC: Mapping = { kind: "generic", tone: { tint: "sunken", ink: "secondary" } };

const BY_EXT: Record<string, Mapping> = {
  pdf: DOC_DANGER,
  doc: DOC_BLUE,
  docx: DOC_BLUE,
  txt: DOC_PLAIN,
  md: DOC_PLAIN,
  csv: SHEET,
  xls: SHEET,
  xlsx: SHEET,
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  gif: IMAGE,
  svg: IMAGE,
  zip: ZIP,
  key: DECK,
  pptx: DECK,
};

/**
 * Formats the browser can actually DISPLAY in a tab.
 *
 * Open is deliberately conditional. Clicking "Open" on a .docx does not
 * open anything — the browser downloads it, so the user gets a file in
 * their downloads folder having asked to LOOK at something, and cannot
 * tell whether the button is broken or the file is. An action that
 * silently becomes a different action is worse than not offering it.
 */
export const OPENABLE_EXTS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "txt",
  "md",
  "csv",
] as const;

const OPENABLE = new Set<string>(OPENABLE_EXTS);

/** Lowercased extension with no dot. "" when the name carries none. */
export function extOfName(name: string): string {
  const n = String(name ?? "");
  const i = n.lastIndexOf(".");
  if (i <= 0 || i === n.length - 1) return "";
  return n
    .slice(i + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isOpenable(name: string): boolean {
  return OPENABLE.has(extOfName(name));
}

export function fileMapping(name: string): Mapping {
  return BY_EXT[extOfName(name)] ?? GENERIC;
}

export function fileKind(name: string): FileKind {
  return fileMapping(name).kind;
}

export function fileTone(name: string): FileTone {
  return fileMapping(name).tone;
}

/** The type badge. Never blank: an unknown extension shows uppercased and
 *  truncated to four characters, and a name with no extension reads FILE. */
export function badgeLabel(name: string): string {
  const ext = extOfName(name);
  if (!ext) return "FILE";
  return ext.toUpperCase().slice(0, 4);
}

/** B under 1 KB, KB under 1 MB, one decimal MB above. */
export function formatBytes(n: number): string {
  const b = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns null when the file is acceptable. Size only — never type. */
export function rejectFileReason(file: { size: number }): string | null {
  if (file.size > FILE_MAX_BYTES) return "That file is over 25 MB — link it instead.";
  return null;
}

/** {workspace_id}/{page_id}/files/{uuid}.{ext} — the second segment is a
 *  page id, so the bucket's existing can_read_page policies apply and a
 *  file on a restricted page is exactly as restricted as the page. */
export function filesStoragePath(
  workspaceId: string,
  pageId: string,
  uuid: string,
  ext: string,
): string {
  const suffix = ext ? `.${ext}` : "";
  return `${workspaceId}/${pageId}/files/${uuid}${suffix}`;
}

/** "2.3 MB · added by Priya · 4d ago" — each segment omitted when unknown. */
export function fileMetaLine(
  fsize: number,
  by?: string | null,
  when?: string | null,
): string {
  const parts = [formatBytes(fsize)];
  if (by) parts.push(`added by ${by}`);
  if (when) parts.push(when);
  return parts.join(" · ");
}

/** Does this block tree hold a file block anywhere (columns, callouts
 *  included)? Drives the export dialog's one-hour shelf-life note. */
export function hasFileBlock(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const rec = b as { type?: unknown; children?: unknown; cols?: unknown };
    if (rec.type === "file") return true;
    if (hasFileBlock(rec.children)) return true;
    if (Array.isArray(rec.cols)) {
      for (const col of rec.cols) if (hasFileBlock(col)) return true;
    }
  }
  return false;
}
