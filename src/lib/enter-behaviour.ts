/* Pure decision function for the Enter key while the caret is inside a
 * column of a `columns` block. Extracted so the behaviour is testable and
 * the (identical) call sites at the top level and inside columns cannot
 * drift apart.
 *
 * The list-escape pattern is the same shape as at top level:
 *   - Enter on a content block            → split.
 *   - Enter on an empty bullet/numbered/todo → convert the block to text
 *     (the caller will need a second Enter to escape).
 *   - Enter on an empty TEXT block that is the LAST block of its column
 *     → escape the column, promoting focus to a top-level block after
 *       the columns block. `removeEmpty` tells the caller whether the
 *       now-orphaned empty block should be dropped (`true`) or kept in
 *       place because it is the column's ONLY block and a column must
 *       always retain at least one block (columns part-1 rule).
 *   - Enter on an empty text block that is NOT last → split (which is a
 *     plain insert-below in that case).
 */

export type EnterAction =
  | { kind: "split" }
  | { kind: "convert-to-text" }
  | { kind: "escape-column"; removeEmpty: boolean };

type MinBlk = { type: string; text?: string };

const LIST_TYPES = new Set(["bullet", "numbered", "todo"]);

export function enterAction(
  col: MinBlk[],
  index: number,
  _caret: number,
  text: string,
): EnterAction {
  // Guard: an out-of-range index should never happen at runtime, but if
  // it does, fall back to the safe "split" behaviour rather than firing
  // an escape from nowhere.
  if (index < 0 || index >= col.length) return { kind: "split" };
  const b = col[index];
  const isEmpty = (text ?? "") === "";

  // A non-empty block always splits, regardless of position or type.
  if (!isEmpty) return { kind: "split" };

  // Empty list-like block: consume the Enter by converting to text.
  // The user's next Enter, on the now-empty text block, is what actually
  // escapes.
  if (LIST_TYPES.has(b.type)) return { kind: "convert-to-text" };

  // Empty non-text, non-list block (e.g. heading, quote, callout): treat
  // like the list case — convert to text so the next Enter escapes with
  // the same three-press shape the user learns for lists.
  if (b.type !== "text") return { kind: "convert-to-text" };

  // Empty text block. Escape only from the LAST position.
  const isLast = index === col.length - 1;
  if (!isLast) return { kind: "split" };

  return { kind: "escape-column", removeEmpty: col.length > 1 };
}
