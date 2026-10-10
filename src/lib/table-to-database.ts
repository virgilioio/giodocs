/* Turn a simple table (the grid block) into a database, Notion's way:
 * the first column becomes each row's title, every other column a text
 * property named after its header cell, and every row below the header
 * a page of the new database. Pure: the plan only. */

import { cellPlainText } from "./table-selection";

export type GridToDatabasePlan = {
  /** One text property per column after the first, in column order. */
  labels: string[];
  records: Array<{ title: string; values: string[] }>;
};

export function planGridToDatabase(rows: string[][], headerRow: boolean): GridToDatabasePlan {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const head = headerRow ? (rows[0] ?? []) : [];
  const used = new Map<string, number>();
  const labels: string[] = [];
  for (let c = 1; c < width; c++) {
    const raw = cellPlainText(head[c] ?? "").replace(/\s+/g, " ").trim() || `Column ${c + 1}`;
    const n = (used.get(raw.toLowerCase()) ?? 0) + 1;
    used.set(raw.toLowerCase(), n);
    labels.push(n === 1 ? raw : `${raw} ${n}`);
  }
  const body = headerRow ? rows.slice(1) : rows;
  const records = body
    .map((r) => ({
      title: cellPlainText(r[0] ?? "").replace(/\s+/g, " ").trim(),
      values: Array.from({ length: width - 1 }, (_, i) => cellPlainText(r[i + 1] ?? "").trim()),
    }))
    // A row with nothing in it isn't worth a page.
    .filter((x) => x.title || x.values.some(Boolean));
  return { labels, records };
}
