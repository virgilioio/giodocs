/* What someone is assigned to, across every database: a row counts when
 * any of its database's person properties holds them (Owner, Assignee,
 * Reviewer… whatever that database calls it). Pure. Used by Settings
 * (People, Profile) and Home's My tasks. */

import type { PageListItem } from "./types";

type DefLike = { key: string; type: string; database_id: string | null; archived_at?: string | null };

export type Assignments = {
  pages: PageListItem[];
  /** Per database, most rows first, with the person property that holds
   *  this person on most of them (what a view filters on). */
  byDb: Array<{ databaseId: string; key: string; count: number }>;
};

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

export function personKeysByDb(defs: DefLike[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const d of defs) {
    if (d.type !== "person" || d.archived_at || !d.database_id) continue;
    m.set(d.database_id, [...(m.get(d.database_id) ?? []), d.key]);
  }
  return m;
}

export function assignmentsOf(pages: PageListItem[], defs: DefLike[], userId: string): Assignments {
  const keys = personKeysByDb(defs);
  const out: PageListItem[] = [];
  const per = new Map<string, Map<string, number>>();
  for (const p of pages) {
    if (!p.database_id || p.archived_at || p.is_database) continue;
    const ks = keys.get(p.database_id);
    if (!ks) continue;
    const props = propsOf(p);
    const hit = ks.filter((k) => props[k] === userId);
    if (!hit.length) continue;
    out.push(p);
    const byKey = per.get(p.database_id) ?? new Map<string, number>();
    for (const k of hit) byKey.set(k, (byKey.get(k) ?? 0) + 1);
    per.set(p.database_id, byKey);
  }
  const byDb = [...per.entries()]
    .map(([databaseId, byKey]) => {
      const [key, count] = [...byKey.entries()].sort((a, b) => b[1] - a[1])[0];
      const rows = out.filter((p) => p.database_id === databaseId).length;
      return { databaseId, key, count: Math.max(count, rows) };
    })
    .sort((a, b) => b.count - a.count);
  return { pages: out, byDb };
}
