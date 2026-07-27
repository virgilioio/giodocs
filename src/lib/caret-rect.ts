/* Textarea caret geometry via a hidden mirror.
 *
 * A textarea's selection is a pair of integer offsets with NO geometry —
 * unlike a contentEditable, there is no Range and getBoundingClientRect
 * is unavailable. So we build an aria-hidden mirror div whose typography
 * and box match the live textarea exactly, insert the pre-selection text,
 * a marker <span> for the selected range, then the remainder, and read
 * the span's client rect. The mirror is positioned at the textarea's own
 * page coordinates so the returned rect is already in viewport space
 * (minus the textarea's own scrollTop).
 *
 * This lives in its own module so any future caret-anchored UI (link
 * hovercard, inline mention menu, …) reuses ONE measurement path instead
 * of inlining the mirror in a component.
 */

const COPY_PROPS = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "textIndent",
  "textAlign",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordWrap",
  "overflowWrap",
] as const;

export type CaretRect = {
  /** Viewport-space bounding box of the FIRST line of the selection. */
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** Measure the client rect of `[selStart, selEnd]` within `el`. Returns
 * null if measurement is impossible (SSR / detached element). */
export function textareaCaretRect(
  el: HTMLTextAreaElement,
  selStart: number,
  selEnd: number,
): CaretRect | null {
  if (typeof window === "undefined" || !el.isConnected) return null;

  const value = el.value;
  const s = Math.max(0, Math.min(selStart, value.length));
  const e = Math.max(s, Math.min(selEnd, value.length));

  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  const ms = mirror.style;
  ms.position = "absolute";
  ms.visibility = "hidden";
  ms.pointerEvents = "none";
  ms.top = `${rect.top + window.scrollY}px`;
  ms.left = `${rect.left + window.scrollX}px`;
  ms.margin = "0";
  ms.overflow = "hidden";
  for (const p of COPY_PROPS) {
    // getComputedStyle values are already strings; assigning back is safe.
    (ms as unknown as Record<string, string>)[p as string] =
      (cs as unknown as Record<string, string>)[p as string];
  }
  // Ensure the mirror wraps like the live textarea; forcing these guards
  // against sites that reset white-space globally.
  ms.whiteSpace = "pre-wrap";
  ms.wordWrap = "break-word";

  const before = document.createTextNode(value.slice(0, s));
  const marker = document.createElement("span");
  marker.textContent = value.slice(s, e) || "\u200b"; // ZWSP → non-empty box
  const after = document.createTextNode(value.slice(e) || " ");

  mirror.appendChild(before);
  mirror.appendChild(marker);
  mirror.appendChild(after);
  document.body.appendChild(mirror);

  const mrect = marker.getBoundingClientRect();
  const parent = mirror.getBoundingClientRect();

  // First-line rect within the mirror (client-space).
  let firstLineTop = mrect.top;
  let firstLineHeight = mrect.height;
  const rects = marker.getClientRects();
  if (rects.length > 0) {
    const r0 = rects[0];
    firstLineTop = r0.top;
    firstLineHeight = r0.height;
  }

  const scrollTop = el.scrollTop;
  const scrollLeft = el.scrollLeft;

  const top = rect.top + (firstLineTop - parent.top) - scrollTop;
  const left = rect.left + (mrect.left - parent.left) - scrollLeft;
  const width = mrect.width;
  const height = firstLineHeight;

  document.body.removeChild(mirror);

  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}
