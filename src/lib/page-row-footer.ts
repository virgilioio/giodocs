/**
 * Footer text for a sidebar page-row menu — the ONE place where the edit
 * timestamp and the verify timestamp appear side by side, which is why they
 * carry different verbs.
 *
 * Format (spec):
 *   "Edited {rel} by {firstName} · verified {rel}"
 *
 * Rules:
 *  - If `editedRel` is falsy, return an empty string — the caller omits.
 *  - `firstName` is optional; when absent, the "by …" fragment drops.
 *  - `verifiedRel` is optional; when absent, the "· verified …" clause
 *    drops. The rest of the footer still renders.
 *
 * Pure string builder: caller supplies pre-formatted relative strings so
 * this file has no time or locale dependency. Mirrors `areaMenuFooter` and
 * `personalViewFooter`.
 */

export type PageRowFooterInput = {
  editedRel: string | null | undefined;
  firstName?: string | null;
  verifiedRel?: string | null;
};

export function pageRowFooter(input: PageRowFooterInput): string {
  const edited = (input.editedRel ?? "").trim();
  if (!edited) return "";
  const first = (input.firstName ?? "").trim();
  const verified = (input.verifiedRel ?? "").trim();
  const a = first ? `Edited ${edited} by ${first}` : `Edited ${edited}`;
  return verified ? `${a} · verified ${verified}` : a;
}
