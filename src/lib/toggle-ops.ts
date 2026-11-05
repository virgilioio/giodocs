import { newBlock, type Blk } from "./block-ops";

/* Toggles that hold blocks (2026-11-05), Notion's way. A toggle's `text` is
 * its title; what it holds is `children` (an older import's `body` text
 * reads as one text block until the toggle is first edited). An open toggle
 * shows its blocks under the title; a closed one hides them. Pure: the
 * editor applies the lists and moves the caret. */

/** What a toggle holds, as blocks. */
export function toggleKids(b: Blk): Blk[] {
  if (Array.isArray(b.children)) return b.children;
  if (typeof b.body === "string" && b.body !== "")
    return [{ id: `${b.id}-body`, type: "text", text: b.body }];
  return [];
}

export type ToggleKey = {
  /** The list to write, or null when only the caret moves. */
  next: Blk[] | null;
  focus: { id: string; caret: "start" | "end" | number };
};

/** The block the caret lands on coming up into `b` from below: the last
 *  block an open toggle shows (inside toggles inside it too), else `b`. */
export function lastShownId(b: Blk): string {
  if (b.type !== "toggle" || !b.open) return b.id;
  const kids = toggleKids(b);
  return kids.length ? lastShownId(kids[kids.length - 1]) : b.id;
}

/**
 * The toggle keys, before the editor's usual ones:
 *  - Enter in an open toggle's title starts its first block (what follows
 *    the caret moves into it).
 *  - ↓ or → at the end of an open toggle's title steps into its first
 *    block.
 *  - Tab right below a toggle tucks the block into it, at the end (and
 *    opens it).
 * Null: the usual keys apply.
 */
export function toggleKey(
  list: Blk[],
  id: string,
  e: { key: string; shift: boolean; meta: boolean; alt: boolean },
  selStart: number,
  selEnd: number,
): ToggleKey | null {
  const idx = list.findIndex((b) => b.id === id);
  if (idx < 0 || e.meta || e.alt) return null;
  const b = list[idx];
  const text = b.text ?? "";

  if (b.type === "toggle" && b.open && !e.shift) {
    const kids = toggleKids(b);
    if (e.key === "Enter") {
      const child = newBlock("text", text.slice(selEnd));
      const next = [...list];
      const t = { ...b, text: text.slice(0, selStart), children: [child, ...kids] };
      delete t.body;
      next[idx] = t;
      return { next, focus: { id: child.id, caret: "start" } };
    }
    const atEnd = selStart === selEnd && selEnd === text.length;
    if ((e.key === "ArrowDown" || e.key === "ArrowRight") && atEnd && kids.length)
      return { next: null, focus: { id: kids[0].id, caret: "start" } };
  }

  if (e.key === "Tab" && !e.shift && idx > 0 && list[idx - 1].type === "toggle") {
    const host = list[idx - 1];
    const next = list.filter((x) => x.id !== id);
    const t = { ...host, open: true, children: [...toggleKids(host), { ...b, indent: undefined }] };
    delete t.body;
    next[idx - 1] = t;
    return { next, focus: { id, caret: selStart } };
  }
  return null;
}
