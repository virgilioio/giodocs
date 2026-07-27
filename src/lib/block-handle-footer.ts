/**
 * Footer text for the block-handle menu — the page's edited stamp,
 * attributed to the person who last edited it. Mirrors `pageRowFooter`
 * and `areaMenuFooter`; a pure string builder with no time/locale dep.
 *
 * Format (spec):
 *   "Edited {rel} by {firstName}"
 *
 * Rules:
 *  - If `editedRel` is falsy, return an empty string — caller omits.
 *  - `firstName` is optional; when absent, drop the "by …" fragment.
 */

export type BlockHandleFooterInput = {
  editedRel: string | null | undefined;
  firstName?: string | null;
};

export function blockHandleFooter(input: BlockHandleFooterInput): string {
  const edited = (input.editedRel ?? "").trim();
  if (!edited) return "";
  const first = (input.firstName ?? "").trim();
  return first ? `Edited ${edited} by ${first}` : `Edited ${edited}`;
}
