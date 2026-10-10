import { nanoid } from "nanoid";

/* Blocks copied or cut in this tab, kept as they are. The system clipboard
 * only carries Markdown and HTML, which can't hold everything a block is
 * (a view inside a page has no text at all). When what's pasted is exactly
 * what was copied here, the paste uses these blocks, with fresh ids, so a
 * cut and paste moves a block whole. Anything else pastes as before. */

let last: { markdown: string; blocks: unknown[] } | null = null;

/* Blocks that point at files stored with their page (images, files) or at
 * another page (a page block) paste as before: a copy in another page
 * would point at something its readers may not be able to open. */
const KEEP_OUT = new Set(["image", "imagerow", "file", "page"]);

function holdsStored(b: unknown): boolean {
  if (Array.isArray(b)) return b.some(holdsStored);
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  if (typeof o.type === "string" && KEEP_OUT.has(o.type)) return true;
  return holdsStored(o.cols) || holdsStored(o.children);
}

export function rememberCopied(markdown: string, blocks: readonly unknown[]): void {
  last =
    markdown.trim() && !holdsStored(blocks)
      ? { markdown: markdown.trim(), blocks: structuredCloneSafe([...blocks]) }
      : null;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Fresh ids all the way down (columns, callout children), so a pasted
 *  copy never shares an id with its original. */
function freshIds(b: unknown): unknown {
  if (Array.isArray(b)) return b.map(freshIds);
  if (!b || typeof b !== "object") return b;
  const o = { ...(b as Record<string, unknown>) };
  if (typeof o.id === "string") o.id = nanoid(10);
  if (Array.isArray(o.cols)) o.cols = (o.cols as unknown[]).map(freshIds);
  if (Array.isArray(o.children)) o.children = (o.children as unknown[]).map(freshIds);
  return o;
}

/** The copied blocks, if this paste is exactly what was copied here. */
export function recallCopied(plain: string): unknown[] | null {
  if (!last || !plain || plain.trim() !== last.markdown) return null;
  return freshIds(last.blocks) as unknown[];
}

export function __resetCopiedForTest(): void {
  last = null;
}
