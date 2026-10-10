/* Copying a template's content into a page. Pure. */

type Rec = Record<string, unknown>;

function freshId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `blk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}

/** A deep copy of a block tree with a new id on every block, nested ones
 *  (callout and toggle children, column contents) included, so the copy
 *  never shares a block id with its template. */
export function cloneBlocksFresh(blocks: unknown): unknown[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((b) => {
    if (!b || typeof b !== "object" || Array.isArray(b)) return b;
    const out: Rec = { ...(b as Rec), id: freshId() };
    if (Array.isArray(out.children)) out.children = cloneBlocksFresh(out.children);
    if (Array.isArray(out.cols)) out.cols = (out.cols as unknown[]).map((c) => cloneBlocksFresh(c));
    return out;
  });
}

/** The template's properties, under whatever the page already has: a page
 *  started in a view keeps the values that view gave it. */
export function mergeTemplateProps(pageProps: unknown, templateProps: unknown): Rec {
  const base = templateProps && typeof templateProps === "object" && !Array.isArray(templateProps) ? (templateProps as Rec) : {};
  const mine = pageProps && typeof pageProps === "object" && !Array.isArray(pageProps) ? (pageProps as Rec) : {};
  const out: Rec = { ...base };
  for (const [k, v] of Object.entries(mine)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}

/** A page nobody has written in yet: no title and no words in any block. */
export function isBlankPage(title: string | null | undefined, blocks: unknown): boolean {
  if ((title ?? "").trim()) return false;
  if (!Array.isArray(blocks)) return true;
  return blocks.every((b) => {
    if (!b || typeof b !== "object") return true;
    const r = b as Rec;
    return r.type === "text" && !String(r.text ?? "").trim() && !Array.isArray(r.children);
  });
}
