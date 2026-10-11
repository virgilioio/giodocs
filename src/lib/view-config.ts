/* How a view shows its pages (views.config), separate from what it shows
 * (filter, sort). Pure: no React, no Supabase.
 *
 *   props   the properties a table shows, in order. The page title is
 *           always first and is not in the list. Unset means "the default
 *           set", so views saved before 2026-10-10 look as they did.
 *   widths  px per property key ("title" for the page title).
 *   calcs   what the Calculate row shows under each property.
 *   group   the property a table is grouped by (null: not grouped).
 *
 * Built-in properties start with "@" (see run-view.ts). */

export type ViewConfig = {
  props?: string[];
  widths?: Record<string, number>;
  calcs?: Record<string, string>;
  group?: string | null;
  /** Properties whose cells wrap onto several lines instead of cutting off. */
  wrap?: string[];
  /** Freeze: the table's properties up to and including this one stay put
   *  while it scrolls sideways (Notion's Freeze). */
  freeze?: string | null;
};

export type ConfigPropDef = {
  key: string;
  type: string;
  label?: string | null;
  is_system?: boolean | null;
  position?: number | null;
};

export const TITLE_KEY = "title";

export const BUILT_IN_LABELS: Record<string, string> = {
  "@created": "Created",
  "@created_by": "Created by",
  "@edited": "Edited",
  "@edited_by": "Edited by",
  "@verified": "Verified",
};

/** The type a built-in behaves as, for cells, sorting and calculations. */
export const BUILT_IN_TYPES: Record<string, string> = {
  "@created": "timestamp",
  "@edited": "timestamp",
  "@verified": "timestamp",
  "@created_by": "person",
  "@edited_by": "person",
};

export function isBuiltIn(key: string): boolean {
  return key in BUILT_IN_LABELS;
}

export const MIN_WIDTH = 60;
export const MAX_WIDTH = 800;

const TYPE_WIDTHS: Record<string, number> = {
  checkbox: 90,
  number: 110,
  date: 130,
  timestamp: 120,
  person: 160,
  select: 140,
  status: 140,
  multi_select: 180,
  links: 200,
  url: 180,
  email: 200,
  phone: 150,
  text: 200,
  relation: 200,
  rollup: 120,
};

export function defaultWidth(key: string, type: string | undefined): number {
  if (key === TITLE_KEY) return 300;
  return TYPE_WIDTHS[type ?? "text"] ?? 160;
}

function clampWidth(n: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)));
}

export function widthOf(config: ViewConfig, key: string, type: string | undefined): number {
  const w = config.widths?.[key];
  return typeof w === "number" && Number.isFinite(w) ? clampWidth(w) : defaultWidth(key, type);
}

/** The narrowest a property's column gets before the table scrolls
 *  sideways, while it has no width of its own. */
export function minWidthOf(key: string, type: string | undefined): number {
  if (key === TITLE_KEY) return 200;
  if (type === "timestamp") return 92;
  if (type === "checkbox" || type === "number") return 80;
  if (
    type === "text" ||
    type === "links" ||
    type === "url" ||
    type === "email" ||
    type === "relation"
  )
    return 110;
  return 90;
}

/** A property's grid track. A width someone set is exact; otherwise the
 *  column shares the table's width in proportion to its default size and
 *  never gets narrower than its minimum (then the table scrolls). */
export function trackOf(
  config: ViewConfig,
  key: string,
  type: string | undefined,
): { css: string; min: number; fixed: boolean } {
  const w = config.widths?.[key];
  if (typeof w === "number" && Number.isFinite(w)) {
    const px = clampWidth(w);
    return { css: `${px}px`, min: px, fixed: true };
  }
  const min = minWidthOf(key, type);
  const fr = defaultWidth(key, type) / 100;
  return { css: `minmax(${min}px, ${fr}fr)`, min, fixed: false };
}

/** A stored config, read defensively: anything malformed is dropped. */
export function readConfig(raw: unknown): ViewConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: ViewConfig = {};
  if (Array.isArray(r.props)) {
    const seen = new Set<string>();
    out.props = r.props.filter(
      (k): k is string => typeof k === "string" && k !== TITLE_KEY && !seen.has(k) && !!seen.add(k),
    );
  }
  if (r.widths && typeof r.widths === "object" && !Array.isArray(r.widths)) {
    const w: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.widths as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) w[k] = clampWidth(v);
    }
    out.widths = w;
  }
  if (r.calcs && typeof r.calcs === "object" && !Array.isArray(r.calcs)) {
    const c: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.calcs as Record<string, unknown>)) {
      if (typeof v === "string" && v) c[k] = v;
    }
    out.calcs = c;
  }
  if (typeof r.group === "string" && r.group) out.group = r.group;
  else if (r.group === null) out.group = null;
  if (Array.isArray(r.wrap)) {
    const w = [...new Set(r.wrap.filter((k): k is string => typeof k === "string" && !!k))];
    if (w.length) out.wrap = w;
  }
  if (typeof r.freeze === "string" && r.freeze) out.freeze = r.freeze;
  return out;
}

/* Which properties a table shows when the view hasn't chosen: the "Pages"
 * database's original four (their keys exist only there) and Verified,
 * Edited, then
 * date, number, text and checkbox properties, then newer kinds once a page
 * uses them, so a table doesn't fill with empty columns as a team adds
 * properties. */
const DEFAULT_LEAD = ["area", "owner", "status", "tags", "@verified", "@edited"];
const ALWAYS_TYPES = new Set(["date", "number", "text", "checkbox"]);

function isNewKind(d: ConfigPropDef): boolean {
  return (
    d.type === "url" ||
    d.type === "email" ||
    d.type === "phone" ||
    d.type === "relation" ||
    (!d.is_system && (d.type === "select" || d.type === "status"))
  );
}

export function defaultProps(defs: ConfigPropDef[], usedKeys?: ReadonlySet<string>): string[] {
  const live = new Set(defs.map((d) => d.key));
  const lead = DEFAULT_LEAD.filter((k) => isBuiltIn(k) || live.has(k));
  const extras = [...defs]
    .filter((d) => !DEFAULT_LEAD.includes(d.key))
    .filter((d) => ALWAYS_TYPES.has(d.type) || (isNewKind(d) && (!usedKeys || usedKeys.has(d.key))))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((d) => d.key);
  return [...lead, ...extras];
}

/** The properties a table shows, in order: the view's own list (minus any
 *  property that has since been archived), or the default set. */
export function shownProps(
  config: ViewConfig,
  defs: ConfigPropDef[],
  usedKeys?: ReadonlySet<string>,
): string[] {
  if (!config.props) return defaultProps(defs, usedKeys);
  const live = new Set(defs.map((d) => d.key));
  return config.props.filter((k) => isBuiltIn(k) || live.has(k));
}

/** Every property a table could show, for the Properties menu: shown ones
 *  first in their order, then the rest (properties by position, then the
 *  built-ins). */
export function allPropKeys(shown: string[], defs: ConfigPropDef[]): string[] {
  const rest = [
    ...[...defs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((d) => d.key),
    ...Object.keys(BUILT_IN_LABELS),
  ].filter((k) => !shown.includes(k));
  return [...shown, ...rest];
}

export function hideProp(shown: string[], key: string): string[] {
  return shown.filter((k) => k !== key);
}

export function showProp(shown: string[], key: string): string[] {
  return shown.includes(key) ? shown : [...shown, key];
}

/** Move `key` so it sits at `index` in the result. */
export function moveProp(shown: string[], key: string, index: number): string[] {
  const from = shown.indexOf(key);
  if (from === -1) return shown;
  const rest = shown.filter((k) => k !== key);
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

export function setWidth(config: ViewConfig, key: string, px: number | null): ViewConfig {
  const widths = { ...(config.widths ?? {}) };
  if (px === null) delete widths[key];
  else widths[key] = clampWidth(px);
  return { ...config, widths };
}

/** Two configs are the same view, ignoring column widths: resizing is a
 *  convenience and never marks a team view as changed. */
export function sameIgnoringWidths(a: ViewConfig, b: ViewConfig): boolean {
  const strip = (c: ViewConfig) => {
    const { widths: _w, ...rest } = c;
    return JSON.stringify({
      props: rest.props ?? null,
      calcs: rest.calcs && Object.keys(rest.calcs).length ? rest.calcs : null,
      group: rest.group ?? null,
      wrap: rest.wrap && rest.wrap.length ? [...rest.wrap].sort() : null,
    });
  };
  return strip(a) === strip(b);
}

export function labelOfProp(key: string, defs: ConfigPropDef[]): string {
  if (key === TITLE_KEY) return "Page";
  if (isBuiltIn(key)) return BUILT_IN_LABELS[key];
  const d = defs.find((x) => x.key === key);
  return d?.label || key;
}

export function typeOfProp(key: string, defs: ConfigPropDef[]): string | undefined {
  if (key === TITLE_KEY) return "title";
  if (isBuiltIn(key)) return BUILT_IN_TYPES[key];
  return defs.find((x) => x.key === key)?.type;
}

/** The name a sort is saved under for a property key. */
export function sortNameOf(key: string): string {
  if (key === TITLE_KEY) return "title";
  if (key === "@edited") return "edited";
  if (key === "@verified") return "verified";
  if (isBuiltIn(key)) return key;
  return `p:${key}`;
}

/** Wraps a property's cells in this view, or stops wrapping them. */
export function toggleWrap(config: ViewConfig, key: string): ViewConfig {
  const cur = config.wrap ?? [];
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  const out = { ...config };
  if (next.length) out.wrap = next;
  else delete out.wrap;
  return out;
}

/** Puts a property into the shown list at an index (Insert left / right). */
export function insertProp(shown: string[], key: string, index: number): string[] {
  const rest = shown.filter((k) => k !== key);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}
