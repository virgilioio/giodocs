/* Lines and lists inside a simple-table cell. A cell's source may hold
 * "\n" (Shift+Enter); a line that starts with "• " is a bullet and one
 * that starts with "1. " (any number) is numbered. The marks are plain
 * characters in the source, so the caret map, copy and export need no
 * special case: what you see is the text.
 *
 * Pure: TableBlock reads the caret, calls these, writes the result. */

export type CellEdit = { text: string; caret: number };

const BULLET = "• ";
const NUMBERED = /^(\d{1,3})\. /;

const lineStartAt = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;

/** "- " or "* " typed at the start of a line becomes a bullet. Called with
 *  the text BEFORE the space is inserted; null when it isn't a list
 *  start, so the space types normally. */
export function bulletOnSpace(text: string, caret: number): CellEdit | null {
  const ls = lineStartAt(text, caret);
  const before = text.slice(ls, caret);
  if (before !== "-" && before !== "*") return null;
  return { text: text.slice(0, ls) + BULLET + text.slice(caret), caret: ls + BULLET.length };
}

/** Shift+Enter: a new line. Inside a list it continues the list (the next
 *  number for a numbered line); on an empty item it ends the list
 *  instead, leaving a plain empty line. */
export function newLine(text: string, start: number, end: number): CellEdit {
  const ls = lineStartAt(text, start);
  const line = text.slice(ls, start);
  const num = NUMBERED.exec(line);
  const own = line.startsWith(BULLET) ? BULLET : num ? num[0] : "";
  const mark = line.startsWith(BULLET) ? BULLET : num ? `${Number(num[1]) + 1}. ` : "";
  const n = text.indexOf("\n", end);
  const rest = text.slice(end, n === -1 ? text.length : n);
  if (own && start === end && line === own && !rest) {
    // Empty item: the mark comes off, no new line.
    return { text: text.slice(0, ls) + text.slice(start), caret: ls };
  }
  const ins = "\n" + mark;
  return { text: text.slice(0, start) + ins + text.slice(end), caret: start + ins.length };
}

/** Backspace right after a list mark turns the line back into text. */
export function unlistOnBackspace(text: string, caret: number): CellEdit | null {
  const ls = lineStartAt(text, caret);
  const head = text.slice(ls, caret);
  const isMark = head === BULLET || (NUMBERED.test(head) && NUMBERED.exec(head)![0] === head);
  if (!isMark) return null;
  return { text: text.slice(0, ls) + text.slice(caret), caret: ls };
}
