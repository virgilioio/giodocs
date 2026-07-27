/**
 * Footer text for the personal-view row menu (⋯ on a My-views row).
 *
 * Format (spec):
 *   "{k} of {total} pages match · {sort name lowercased} first"
 *
 * Rules:
 *  - `k` is how many non-archived pages match the view's filter (client-side
 *    via `runView` — same engine as everywhere else). The caller passes it
 *    already computed so this stays a pure string builder.
 *  - `total` is the count of non-archived pages in the workspace.
 *  - Sort name comes from the four intent choices; we lowercase whatever the
 *    label is (Newest edits → "newest edits").
 *  - Plurals: "1 of 12 page match" reads oddly, so the noun follows `total`
 *    (which is essentially always ≥ k, since the filter narrows). For total
 *    === 1 we use "page"; for 0 we omit the sort clause entirely.
 */

export type PersonalFooterInput = {
  matchCount: number;
  totalCount: number;
  sortLabel: string;
};

export function personalViewFooter(input: PersonalFooterInput): string {
  const { matchCount, totalCount, sortLabel } = input;
  if (totalCount <= 0) return "No pages yet";
  const noun = totalCount === 1 ? "page" : "pages";
  const clause1 = `${matchCount} of ${totalCount} ${noun} match`;
  const sortClean = sortLabel.trim().toLowerCase();
  if (!sortClean) return clause1;
  return `${clause1} · ${sortClean} first`;
}
