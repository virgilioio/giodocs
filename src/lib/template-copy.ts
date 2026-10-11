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

/** Only the values a row of this database can hold: its properties that
 *  store something (archived ones included: their values are kept) (never IDs, formulas, rollups or a relation's far
 *  side). A row carried into a database from elsewhere can keep values for
 *  properties that database doesn't have; copying them into a new row
 *  would be refused ("Unknown property"), so a copy leaves them behind. */
export function keepStoredProps(
  props: unknown,
  defs: ReadonlyArray<{ key: string; type: string; config?: unknown; archived_at?: string | null }>,
): Rec {
  const src = props && typeof props === "object" && !Array.isArray(props) ? (props as Rec) : {};
  const ok = new Set(
    defs
      .filter((d) => !["rollup", "formula", "unique_id"].includes(d.type))
      .filter((d) => {
        const c = d.config;
        return !(d.type === "relation" && c && typeof c === "object" && typeof (c as Rec).of === "string");
      })
      .map((d) => d.key),
  );
  const out: Rec = {};
  for (const [k, v] of Object.entries(src)) if (ok.has(k)) out[k] = v;
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

/** Where a copied template file lives in the new page:
 *  "{ws}/{templateId}/x.png" → "{ws}/{pageId}/x.png" (files/ kept). Paths
 *  that aren't in a page folder (or are already in this page's) are left. */
export function pathForPage(path: string, pageId: string): string | null {
  const parts = path.split("/");
  if (parts.length < 3 || parts[1] === "emoji" || parts[1] === pageId) return null;
  return [parts[0], pageId, ...parts.slice(2)].join("/");
}

/** The block tree with every image and file path swapped through `map`
 *  (paths missing from `map` stay as they are). */
export function retargetBlockPaths(blocks: unknown, map: ReadonlyMap<string, string>): unknown[] {
  if (!Array.isArray(blocks)) return [];
  const swap = (p: unknown) => (typeof p === "string" && map.has(p) ? map.get(p)! : p);
  return blocks.map((b) => {
    if (!b || typeof b !== "object" || Array.isArray(b)) return b;
    const out: Rec = { ...(b as Rec) };
    if (out.type === "image" || out.type === "file") out.path = swap(out.path);
    if (out.type === "imagerow" && Array.isArray(out.paths)) out.paths = (out.paths as unknown[]).map(swap);
    if (Array.isArray(out.children)) out.children = retargetBlockPaths(out.children, map);
    if (Array.isArray(out.cols)) out.cols = (out.cols as unknown[]).map((c) => retargetBlockPaths(c, map));
    return out;
  });
}
