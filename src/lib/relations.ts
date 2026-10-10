import type { PageListItem } from "./types";
import { relList } from "./related-links";
import { propValue } from "./run-view";
import {
  calcValue,
  calculateRaw,
  formatCalc,
  isCalcId,
  type CalcId,
  type CalcRaw,
} from "./view-calc";

/* Relations and rollups (2026-10-10). Pure.
 *
 * A relation property stores the ids of the pages it links to. Its far side
 * (a two-way relation's partner, config { of: <relation key> }) stores
 * nothing: which pages link here is worked out from the near side, so the
 * two can never disagree. A rollup (config { relation, target, calc }) is a
 * figure worked out from the related pages. Both are computed from the
 * reader's own page list, so a page someone can't open never shows or
 * counts for them. */

export type RelDefLike = {
  key: string;
  type: string;
  label?: string | null;
  config?: unknown;
  options?: unknown;
};

export type RelationConfig = { viewId: string | null; back: string | null; of: string | null };

/** "show" lists the related pages' values instead of calculating. */
export type RollupCalc = CalcId | "show";
export type RollupConfig = { relation: string; target: string; calc: RollupCalc };

function cfgOf(def: RelDefLike | undefined): Record<string, unknown> {
  const c = def?.config;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function relationConfig(def: RelDefLike | undefined): RelationConfig {
  const c = cfgOf(def);
  return { viewId: str(c.view_id), back: str(c.back), of: str(c.of) };
}

export function rollupConfig(def: RelDefLike | undefined): RollupConfig | null {
  if (def?.type !== "rollup") return null;
  const c = cfgOf(def);
  const relation = str(c.relation);
  const target = str(c.target);
  const calc = str(c.calc);
  if (!relation || !target || !calc) return null;
  if (calc !== "show" && !isCalcId(calc)) return null;
  return { relation, target, calc: calc as RollupCalc };
}

export function isBackRelation(def: RelDefLike | undefined): boolean {
  return def?.type === "relation" && !!relationConfig(def).of;
}

/** Worked out rather than stored: never written to a page. */
export function isComputedDef(def: RelDefLike | undefined): boolean {
  return def?.type === "rollup" || isBackRelation(def);
}

export type RelationIndex = {
  byId: Map<string, PageListItem>;
  defs: Map<string, RelDefLike>;
  /** relation key → linked page id → the pages that link to it */
  incoming: Map<string, Map<string, string[]>>;
};

export function buildRelationIndex(pages: PageListItem[], defs: RelDefLike[]): RelationIndex {
  const byId = new Map<string, PageListItem>();
  for (const p of pages) if (!p.archived_at) byId.set(p.id, p);
  const defMap = new Map(defs.map((d) => [d.key, d]));
  const incoming = new Map<string, Map<string, string[]>>();
  // Only relations someone pairs with a far side need the reverse lookup.
  const paired = new Set(
    defs.filter((d) => isBackRelation(d)).map((d) => relationConfig(d).of as string),
  );
  for (const key of paired) {
    const fwd = defMap.get(key);
    if (!fwd || fwd.type !== "relation" || isBackRelation(fwd)) continue;
    const m = new Map<string, string[]>();
    for (const p of byId.values()) {
      for (const id of new Set(relList(propsOf(p)[key]))) {
        if (!byId.has(id)) continue;
        const list = m.get(id);
        if (list) list.push(p.id);
        else m.set(id, [p.id]);
      }
    }
    incoming.set(key, m);
  }
  return { byId, defs: defMap, incoming };
}

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

/** The pages a relation (either side) links this page to, that the reader
 *  can open, in their stored order. */
export function relatedIds(page: PageListItem, key: string, idx: RelationIndex): string[] {
  const def = idx.defs.get(key);
  if (!def || def.type !== "relation") return [];
  const { of } = relationConfig(def);
  if (of) return idx.incoming.get(of)?.get(page.id) ?? [];
  const seen = new Set<string>();
  return relList(propsOf(page)[key]).filter(
    (id) => idx.byId.has(id) && !seen.has(id) && !!seen.add(id),
  );
}

export function relatedPages(page: PageListItem, key: string, idx: RelationIndex): PageListItem[] {
  return relatedIds(page, key, idx).map((id) => idx.byId.get(id)!);
}

/* A rollup's target is read like any value, except a relation reads as its
 * linked pages (so "count of their tasks" works) and a rollup of a rollup
 * reads as nothing (no loops). */
function targetValueOf(idx: RelationIndex) {
  return (p: PageListItem, k: string): unknown => {
    const d = idx.defs.get(k);
    if (d?.type === "relation") return relatedIds(p, k, idx);
    if (d?.type === "rollup") return null;
    return propValue(p, k);
  };
}

export function rollupRaw(page: PageListItem, def: RelDefLike, idx: RelationIndex): CalcRaw {
  const cfg = rollupConfig(def);
  if (!cfg || cfg.calc === "show") return null;
  return calculateRaw(
    cfg.calc,
    relatedPages(page, cfg.relation, idx),
    cfg.target,
    targetValueOf(idx),
  );
}

/** "Show values": the related pages' values for the target, as words. */
export function rollupShown(
  page: PageListItem,
  def: RelDefLike,
  idx: RelationIndex,
  words: (value: unknown, targetKey: string) => string[],
): string[] {
  const cfg = rollupConfig(def);
  if (!cfg) return [];
  const read = targetValueOf(idx);
  const out: string[] = [];
  for (const p of relatedPages(page, cfg.relation, idx)) {
    const v = cfg.target === "title" ? p.title || "Untitled" : read(p, cfg.target);
    out.push(...words(v, cfg.target));
  }
  return out;
}

export function rollupText(
  page: PageListItem,
  def: RelDefLike,
  idx: RelationIndex,
  words: (value: unknown, targetKey: string) => string[],
  now: Date = new Date(),
): string {
  const cfg = rollupConfig(def);
  if (!cfg) return "";
  if (cfg.calc === "show") return rollupShown(page, def, idx, words).join(", ");
  return formatCalc(rollupRaw(page, def, idx), now);
}

/** The value views see for any property: relations as their linked pages
 *  (both sides), rollups as their figure (a number, a day, or the shown
 *  values), everything else as stored. Hand it to runView as readValue. */
export function readValueWith(
  idx: RelationIndex,
  words: (value: unknown, targetKey: string) => string[] = (v) =>
    v === null || v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)],
) {
  return (page: PageListItem, key: string): unknown => {
    const def = idx.defs.get(key);
    if (def?.type === "relation") return relatedIds(page, key, idx);
    if (def?.type === "rollup") {
      const cfg = rollupConfig(def);
      if (!cfg) return null;
      if (cfg.calc === "show") {
        const shown = rollupShown(page, def, idx, words);
        return shown.length ? shown : null;
      }
      return calcValue(rollupRaw(page, def, idx));
    }
    return propValue(page, key);
  };
}

/** What a rollup's figure behaves like, for sorting, filters and cells. */
export function rollupKind(def: RelDefLike | undefined): "number" | "date" | "text" {
  const cfg = rollupConfig(def);
  if (!cfg || cfg.calc === "show") return "text";
  if (cfg.calc === "earliest" || cfg.calc === "latest") return "date";
  return "number";
}
