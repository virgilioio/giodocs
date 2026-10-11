/* How a database's rows show their properties when opened as pages
 * (pages.page_layout on the database, checked by guard_database_settings):
 * an order, and per property "always" (even when empty), "filled" (Hide
 * when empty) or "never" (kept in the "N more properties" fold). Without a
 * layout: the first three always, the rest when filled (rollups never
 * among the first three: they hold nothing to fill in). */

export type ShowRule = "always" | "filled" | "never";
export type PageLayout = { order?: string[]; show?: Record<string, ShowRule> };

export const SHOW_LABELS: Record<ShowRule, string> = {
  always: "Always show",
  filled: "Hide when empty",
  never: "Always hide",
};

const RULES: readonly ShowRule[] = ["always", "filled", "never"];

export function readPageLayout(raw: unknown): PageLayout {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: PageLayout = {};
  if (Array.isArray(r.order)) {
    out.order = [...new Set(r.order.filter((k): k is string => typeof k === "string" && !!k))];
  }
  if (r.show && typeof r.show === "object" && !Array.isArray(r.show)) {
    const s: Record<string, ShowRule> = {};
    for (const [k, v] of Object.entries(r.show as Record<string, unknown>)) {
      if (RULES.includes(v as ShowRule)) s[k] = v as ShowRule;
    }
    out.show = s;
  }
  return out;
}

type DefLike = { key: string; type: string; position?: number | null; archived_at?: string | null };

/** The database's live properties in the page's order: the layout's order
 *  first, then the rest by position. */
export function orderedKeys(defs: readonly DefLike[], layout: PageLayout): string[] {
  const live = defs.filter((d) => !d.archived_at);
  const known = new Set(live.map((d) => d.key));
  const fromLayout = (layout.order ?? []).filter((k) => known.has(k));
  const seen = new Set(fromLayout);
  const rest = [...live]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((d) => d.key)
    .filter((k) => !seen.has(k));
  return [...fromLayout, ...rest];
}

/** A property's rule: the layout's, else the default (the first three
 *  non-rollup properties always, the rest when filled). */
export function ruleOf(key: string, defs: readonly DefLike[], layout: PageLayout): ShowRule {
  const set = layout.show?.[key];
  if (set) return set;
  const firstThree = orderedKeys(defs, layout)
    .filter((k) => defs.find((d) => d.key === k)?.type !== "rollup")
    .slice(0, 3);
  return firstThree.includes(key) ? "always" : "filled";
}

/** Which properties the strip shows, and which wait in the fold. */
export function arrangeStrip(
  defs: readonly DefLike[],
  layout: PageLayout,
  filled: ReadonlySet<string>,
): { shown: string[]; folded: string[] } {
  const shown: string[] = [];
  const folded: string[] = [];
  for (const k of orderedKeys(defs, layout)) {
    const rule = ruleOf(k, defs, layout);
    if (rule === "always" || (rule === "filled" && filled.has(k))) shown.push(k);
    else folded.push(k);
  }
  return { shown, folded };
}

/** A new layout with one property's rule set. */
export function withRule(layout: PageLayout, key: string, rule: ShowRule): PageLayout {
  return { ...layout, show: { ...(layout.show ?? {}), [key]: rule } };
}

/** A new layout with a property moved to an index of the full order. The
 *  order written is the whole current order, so it stays put afterwards. */
export function withMove(
  layout: PageLayout,
  defs: readonly DefLike[],
  key: string,
  to: number,
): PageLayout {
  const order = orderedKeys(defs, layout).filter((k) => k !== key);
  const at = Math.max(0, Math.min(to, order.length));
  // Rules that were defaults are written down, so moving a property never
  // changes what shows (the default depends on the order).
  const show: Record<string, ShowRule> = {};
  for (const k of orderedKeys(defs, layout)) show[k] = ruleOf(k, defs, layout);
  return { order: [...order.slice(0, at), key, ...order.slice(at)], show };
}

/** Moves a property just before or after another one (a drag in the strip). */
export function withMoveBeside(
  layout: PageLayout,
  defs: readonly DefLike[],
  key: string,
  target: string,
  after: boolean,
): PageLayout {
  if (key === target) return layout;
  const order = orderedKeys(defs, layout).filter((k) => k !== key);
  const i = order.indexOf(target);
  if (i < 0) return layout;
  return withMove(layout, defs, key, after ? i + 1 : i);
}
