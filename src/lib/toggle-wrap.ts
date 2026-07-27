/* Pure toggle-wrap for inline-formatting shortcuts and the floating
 * toolbar. Both the keyboard shortcut path in block-key-handler.ts and
 * the toolbar buttons call this — never their own local logic — so the
 * two paths cannot drift.
 *
 * Semantics:
 *   - Collapsed caret (start === end): insert `open + close` and place
 *     the caret between them, so typing continues inside the formatting.
 *   - Selection already wrapped in the delimiter (either the selection
 *     itself is `open…close` or the characters IMMEDIATELY OUTSIDE it
 *     are `open`…`close`): unwrap. Toggling twice returns the original
 *     string byte-for-byte and the same words remain selected.
 *   - Otherwise: wrap. Returned range keeps the same words selected.
 */

export type WrapResult = { text: string; start: number; end: number };

export function toggleWrap(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string = open,
): WrapResult {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));

  // Collapsed caret → insert a pair and place caret between.
  if (s === e) {
    const next = text.slice(0, s) + open + close + text.slice(s);
    return { text: next, start: s + open.length, end: s + open.length };
  }

  const sel = text.slice(s, e);

  // Case A: the selection itself is `open…close`.
  if (
    sel.length >= open.length + close.length &&
    sel.startsWith(open) &&
    sel.endsWith(close)
  ) {
    const inner = sel.slice(open.length, sel.length - close.length);
    const next = text.slice(0, s) + inner + text.slice(e);
    return { text: next, start: s, end: s + inner.length };
  }

  // Case B: the characters immediately OUTSIDE the selection are the pair.
  if (
    s - open.length >= 0 &&
    e + close.length <= text.length &&
    text.slice(s - open.length, s) === open &&
    text.slice(e, e + close.length) === close
  ) {
    const next =
      text.slice(0, s - open.length) + sel + text.slice(e + close.length);
    return { text: next, start: s - open.length, end: e - open.length };
  }

  // Default: wrap.
  const next = text.slice(0, s) + open + sel + close + text.slice(e);
  return {
    text: next,
    start: s + open.length,
    end: e + open.length,
  };
}

/* isWrapped — used by the toolbar to render an ACTIVE button state so
 * the toolbar REPORTS current formatting rather than just applying it.
 * Mirrors the two "already-wrapped" branches of toggleWrap. */
export function isWrapped(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string = open,
): boolean {
  if (start === end) return false;
  const sel = text.slice(start, end);
  if (
    sel.length >= open.length + close.length &&
    sel.startsWith(open) &&
    sel.endsWith(close)
  ) {
    return true;
  }
  if (
    start - open.length >= 0 &&
    end + close.length <= text.length &&
    text.slice(start - open.length, start) === open &&
    text.slice(end, end + close.length) === close
  ) {
    return true;
  }
  return false;
}
