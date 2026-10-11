/* Templates grouped by where they make pages: plain pages first, then
 * each database's row templates, databases by name. Search matches the
 * template's title or its database's name. */

export type TemplateLike = { id: string; title: string | null; icon: string | null; database_id: string | null };

export type TemplateGroup<T> = { key: string; label: string; databaseId: string | null; items: T[] };

export function groupTemplates<T extends TemplateLike>(
  templates: readonly T[],
  pages: readonly { id: string; title?: string | null }[],
  query = "",
): TemplateGroup<T>[] {
  const q = query.trim().toLowerCase();
  const dbName = (id: string) => pages.find((p) => p.id === id)?.title?.trim() || "Untitled";
  const byKey = new Map<string, TemplateGroup<T>>();
  for (const t of templates) {
    const db = t.database_id ?? null;
    const label = db ? `Rows of ${dbName(db)}` : "Pages";
    const title = (t.title ?? "").trim() || "Untitled";
    if (q && !title.toLowerCase().includes(q) && !(db && dbName(db).toLowerCase().includes(q))) continue;
    const key = db ?? "pages";
    const g = byKey.get(key) ?? { key, label, databaseId: db, items: [] };
    g.items.push(t);
    byKey.set(key, g);
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.items.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  }
  return groups.sort((a, b) =>
    a.databaseId === null ? -1 : b.databaseId === null ? 1 : a.label.localeCompare(b.label),
  );
}
