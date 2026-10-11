/* A Files & media property's value (2026-10-11): a list of files, each
 * { path, name, size, mime }, uploaded to the page-images bucket under the
 * row's own folder (<workspace>/<row>/files/…), so the row's readers are
 * exactly the files' readers. validate_page_props checks the shape (at
 * most 50, only those keys). Read defensively. */

export type FileValue = { path: string; name: string; size: number; mime: string };

export const FILES_MAX = 50;

export function readFileList(raw: unknown): FileValue[] {
  if (!Array.isArray(raw)) return [];
  const out: FileValue[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object" || Array.isArray(f)) continue;
    const r = f as Record<string, unknown>;
    if (typeof r.path !== "string" || !r.path) continue;
    out.push({
      path: r.path,
      name: typeof r.name === "string" && r.name ? r.name : (r.path.split("/").pop() ?? "File"),
      size: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0,
      mime: typeof r.mime === "string" ? r.mime : "",
    });
  }
  return out;
}

/** One line for a cell: "brief.pdf", or "brief.pdf +2". */
export function filesSummary(files: readonly FileValue[]): string {
  if (files.length === 0) return "";
  return files.length === 1 ? files[0].name : `${files[0].name} +${files.length - 1}`;
}

/** The list with a file added (at most FILES_MAX) or one taken off. */
export function withFile(files: readonly FileValue[], f: FileValue): FileValue[] {
  return [...files.filter((x) => x.path !== f.path), f].slice(-FILES_MAX);
}

export function withoutFile(files: readonly FileValue[], path: string): FileValue[] {
  return files.filter((x) => x.path !== path);
}
