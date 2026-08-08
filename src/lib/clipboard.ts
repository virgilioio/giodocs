/**
 * THE ONE CLIPBOARD WRITE PATH.
 *
 * ⚠ navigator.clipboard.writeText() returns a PROMISE, and a synchronous
 * try/catch CANNOT catch its rejection. In a sandboxed frame — which is
 * exactly how a preview iframe runs — the permissions policy rejects every
 * call, so every "copy" throws an UNHANDLED REJECTION into the console even
 * though the surrounding code looks defensive.
 *
 * Every clipboard write in the product goes through this helper: copy link,
 * copy shortcode, copy-as-Markdown, the block-selection copy, the table
 * row/column copy and the sheet's cell copy. There is deliberately no second
 * path — a bare navigator.clipboard call anywhere is a bug.
 */

export function toClipboard(text: string): void {
  try {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const p = nav?.clipboard?.writeText?.(text);
    void (p as Promise<void> | undefined)?.catch?.(() => {});
  } catch {
    /* No clipboard in this frame. A copy that cannot happen is not an error. */
  }
}

/** Same discipline for a rich (multi-flavour) write: never let the promise
 *  escape unhandled, and fall back to plain text when the richer API is
 *  missing or refused. */
export function toClipboardRich(markdown: string, html: string): void {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const clip = nav?.clipboard as (Clipboard & { write?: Clipboard["write"] }) | undefined;
  const CI = (globalThis as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (clip && typeof CI === "function" && typeof clip.write === "function") {
    try {
      const item = new CI({
        "text/plain": new Blob([markdown], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      void clip.write([item]).catch(() => toClipboard(markdown));
      return;
    } catch {
      /* fall through to plain text */
    }
  }
  toClipboard(markdown);
}

/**
 * READ the system clipboard. Same promise discipline in reverse: a refused
 * or unsupported read resolves to "" instead of rejecting, so a paste path
 * never has to guard twice.
 */
export async function fromClipboard(): Promise<string> {
  try {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const read = nav?.clipboard?.readText;
    if (typeof read !== "function") return "";
    return (await read.call(nav!.clipboard)) ?? "";
  } catch {
    return "";
  }
}
