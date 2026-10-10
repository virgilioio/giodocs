/* Pages inside pages — the pure layer.
 *
 * STORAGE IS THE COLUMN: parenthood is `pages.parent_id`, never `props.parent`
 * and never a property_defs row. A jsonb key cannot carry a foreign key, be
 * indexed for the tree walk, or be guarded by trg_guard_page_parent.
 *
 * No React, no Supabase, no fetching. Every function takes a `pages` array —
 * the reader's OWN visible list, already filtered by RLS — and returns data.
 * That means two readers legitimately see different trees.
 */

const MAX_HOPS = 50;

export type TreePage = {
  id: string;
  title?: string | null;
  icon?: string | null;
  parent_id?: string | null;
  edited_at?: string | null;
  props?: unknown;
  /** Order among siblings (pages.position); unordered pages come after. */
  position?: number | null;
};

/** Sibling order, as move_page keeps it: by position (unordered last),
 *  then newest edit first, then id. */
export function bySiblingOrder<P extends TreePage>(a: P, b: P): number {
  const pa = a.position ?? null;
  const pb = b.position ?? null;
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }
  const e = String(b.edited_at ?? "").localeCompare(String(a.edited_at ?? ""));
  return e !== 0 ? e : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
const byEditedDesc = bySiblingOrder;


function indexById<P extends TreePage>(pages: readonly P[]): Map<string, P> {
  const m = new Map<string, P>();
  for (const p of pages) m.set(p.id, p);
  return m;
}

/** Direct children, in sibling order. */
export function childrenOf<P extends TreePage>(
  id: string,
  pages: readonly P[],
): P[] {
  return pages.filter((p) => p.parent_id === id).sort(byEditedDesc);
}

/** Full recursive descendant set. Defends against cyclic client arrays. */
export function descendantsOf(id: string, pages: readonly TreePage[]): Set<string> {
  const kids = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.parent_id) continue;
    const list = kids.get(p.parent_id);
    if (list) list.push(p.id);
    else kids.set(p.parent_id, [p.id]);
  }
  const out = new Set<string>();
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === id || out.has(cur)) continue; // visited set terminates cycles
    out.add(cur);
    for (const k of kids.get(cur) ?? []) stack.push(k);
  }
  return out;
}

/** What the placement picker must exclude: the whole subtree plus the page. */
export function blockedParents(id: string, pages: readonly TreePage[]): Set<string> {
  const s = descendantsOf(id, pages);
  s.add(id);
  return s;
}

/** Ordered root-first, excluding the page itself. Stops at the first parent the
 * reader cannot see and returns the partial chain — never throws. */
export function ancestorsOf<P extends TreePage>(
  id: string,
  pages: readonly P[],
): P[] {
  const map = indexById(pages);
  const chain: P[] = [];
  const seen = new Set<string>([id]);
  let cur = map.get(id)?.parent_id ?? null;
  let hops = 0;
  while (cur && hops++ < MAX_HOPS) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const parent = map.get(cur);
    if (!parent) break; // unresolvable — partial chain
    chain.push(parent);
    cur = parent.parent_id ?? null;
  }
  return chain.reverse();
}

/** Root is 0. */
export function depthOf(id: string, pages: readonly TreePage[]): number {
  return ancestorsOf(id, pages).length;
}

export type TreeRow<P extends TreePage> = {
  page: P;
  depth: number;
  hasKids: boolean;
  expanded: boolean;
};

/** One FLAT list carrying its own depth.
 *
 * A page whose parent_id is SET but whose parent is absent from `pages` is
 * OMITTED, along with its subtree: rendering it would name or imply a hidden
 * parent. No placeholder, no hidden count. */
export function flattenTree<P extends TreePage>(
  pages: readonly P[],
  expanded: Set<string>,
): Array<TreeRow<P>> {
  const roots = pages.filter((p) => !p.parent_id).sort(byEditedDesc);
  const out: Array<TreeRow<P>> = [];
  const seen = new Set<string>();

  const walk = (page: P, depth: number) => {
    if (seen.has(page.id) || depth > MAX_HOPS) return;
    seen.add(page.id);
    const kids = childrenOf(page.id, pages);
    const open = expanded.has(page.id);
    out.push({ page, depth, hasKids: kids.length > 0, expanded: open });
    if (!open) return;
    for (const k of kids) walk(k, depth + 1);
  };

  for (const r of roots) walk(r, 0);
  return out;
}

export type PlacementRow<P extends TreePage> =
  | { kind: "page"; page: P; hint: string }
  | { kind: "create"; title: string };

/** The picker's row list, pure. Chunk 2 only renders it.
 *
 * ORDERING: matches lead, create sinks. Enter picks the first row, so pinning
 * create to the top makes typing an existing page's name create a duplicate. */
export function placementRows<P extends TreePage>(
  query: string,
  pages: readonly P[],
  currentPageId: string,
  opts?: { limit?: number },
): Array<PlacementRow<P>> {
  const limit = opts?.limit ?? 7;
  const blocked = blockedParents(currentPageId, pages);
  const map = indexById(pages);
  const q = query.trim().toLowerCase();

  const candidates = pages.filter(
    (p) => !blocked.has(p.id) && p.parent_id !== currentPageId,
  );

  const matches = candidates
    .filter((p) => {
      if (!q) return true;
      const t = String(p.title ?? "").toLowerCase();
      // Its own title, or the page it sits in ("Roadmap" finds its rows).
      const parent = p.parent_id ? map.get(p.parent_id) : undefined;
      return t.includes(q) || String(parent?.title ?? "").toLowerCase().includes(q);
    })
    .sort(byEditedDesc)
    .slice(0, limit);

  const rows: Array<PlacementRow<P>> = [];
  const createRow: PlacementRow<P> = { kind: "create", title: query.trim() };
  const exact =
    !!q &&
    candidates.some((p) => String(p.title ?? "").trim().toLowerCase() === q);

  // ONE assembly for both the empty and the typed query: with no query the
  // picker still offers "Create a new page here", and it still SINKS below
  // the matches. Enter picks the first row.
  if (!matches.length) rows.push(createRow);
  for (const p of matches)
    rows.push({ kind: "page", page: p, hint: hintFor(p, map) });
  if (matches.length && !exact) rows.push(createRow);
  return rows;
}

function hintFor<P extends TreePage>(page: P, map: Map<string, P>): string {
  const parent = page.parent_id ? map.get(page.parent_id) : undefined;
  const title = parent ? String(parent.title ?? "").trim() : "";
  return title || "unfiled";
}

/* ─────────────── Moving a page in the tree (sidebar drag) ─────────────── */

/** Where a dragged page lands, relative to the row it's over. */
export type DropZone = "before" | "inside" | "after";

/** What move_page needs: the new parent and the sibling it goes before
 *  (null: last). */
export type MoveTarget = { parentId: string | null; beforeId: string | null };

/** The zone from the pointer's height within the row: top quarter before,
 *  bottom quarter after, the middle inside. */
export function dropZoneAt(offsetY: number, height: number): DropZone {
  if (height <= 0) return "inside";
  const f = offsetY / height;
  return f < 0.25 ? "before" : f > 0.75 ? "after" : "inside";
}

/** Turn "over this row, in this zone" into a move. Null when it isn't a
 *  move at all: onto itself, into its own subtree, or back where it is. */
export function moveTargetFor<P extends TreePage>(
  dragged: string,
  over: P,
  zone: DropZone,
  pages: readonly P[],
  expanded: Set<string>,
): MoveTarget | null {
  if (over.id === dragged) return null;
  if (descendantsOf(dragged, pages).has(over.id)) return null;
  const me = pages.find((p) => p.id === dragged);
  let target: MoveTarget;
  if (zone === "inside") {
    target = { parentId: over.id, beforeId: null };
  } else if (zone === "before") {
    target = { parentId: over.parent_id ?? null, beforeId: over.id };
  } else {
    const kids = childrenOf(over.id, pages).filter((k) => k.id !== dragged);
    if (expanded.has(over.id) && kids.length > 0) {
      // Below an open page with children: its first child.
      target = { parentId: over.id, beforeId: kids[0]!.id };
    } else {
      const sibs = siblingsOf(over, pages).filter((x) => x.id !== dragged);
      const i = sibs.findIndex((x) => x.id === over.id);
      target = { parentId: over.parent_id ?? null, beforeId: sibs[i + 1]?.id ?? null };
    }
  }
  if (me && isSameSpot(me, target, pages)) return null;
  return target;
}

function siblingsOf<P extends TreePage>(page: P, pages: readonly P[]): P[] {
  const parent = page.parent_id ?? null;
  return pages.filter((p) => (p.parent_id ?? null) === parent).sort(bySiblingOrder);
}

/** True when the move leaves the page exactly where it is. */
function isSameSpot<P extends TreePage>(me: P, t: MoveTarget, pages: readonly P[]): boolean {
  if ((me.parent_id ?? null) !== t.parentId) return false;
  const sibs = siblingsOf(me, pages);
  const i = sibs.findIndex((x) => x.id === me.id);
  const next = sibs[i + 1]?.id ?? null;
  return t.beforeId === next || t.beforeId === me.id;
}

/** The list as it will look after a move (for the optimistic update):
 *  the page's parent changes and its new siblings are renumbered. */
export function applyMove<P extends TreePage>(
  pages: readonly P[],
  pageId: string,
  t: MoveTarget,
): P[] {
  const me = pages.find((p) => p.id === pageId);
  if (!me) return [...pages];
  const sibs = pages
    .filter((p) => (p.parent_id ?? null) === t.parentId && p.id !== pageId)
    .sort(bySiblingOrder);
  const at = t.beforeId ? sibs.findIndex((x) => x.id === t.beforeId) : -1;
  const order = at < 0 ? [...sibs, me] : [...sibs.slice(0, at), me, ...sibs.slice(at)];
  const pos = new Map(order.map((p, i) => [p.id, i + 1]));
  return pages.map((p) => {
    if (p.id === pageId) return { ...p, parent_id: t.parentId, position: pos.get(p.id)! };
    const n = pos.get(p.id);
    return n !== undefined && n !== p.position ? { ...p, position: n } : p;
  });
}
