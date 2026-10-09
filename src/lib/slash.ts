/**
 * When typing "/" opens the block menu, and what it removes when an item is
 * picked. Shared by the page and the column/callout editors.
 *
 * The menu opens only for a "/" at the start of the block or after a space
 * ("24/7", "and/or" and URLs never open it), never in a code block, and
 * picking an item removes just the "/query" that was typed — the rest of
 * the line stays.
 */
export type SlashTrigger = { at: number; query: string };

export function slashTrigger(
  text: string,
  caret: number,
  blockType: string | undefined,
): SlashTrigger | null {
  if (blockType === "code") return null;
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("/");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query) || query.length > 24) return null;
  return { at, query };
}

/** Remove the "/query" typed at `at`. Falls back to the text unchanged if
 *  it no longer matches (the user edited around it). */
export function stripSlash(text: string, at: number, query: string): string {
  const seg = "/" + query;
  if (text.slice(at, at + seg.length) === seg) {
    return text.slice(0, at) + text.slice(at + seg.length);
  }
  const i = text.lastIndexOf(seg);
  if (i >= 0) return text.slice(0, i) + text.slice(i + seg.length);
  return text;
}
