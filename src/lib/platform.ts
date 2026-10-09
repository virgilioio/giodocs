/**
 * The platform's primary shortcut modifier: ⌘ on a Mac, Ctrl elsewhere.
 *
 * Treating either key as "meta" everywhere took over the Mac's own Ctrl
 * text shortcuts (Ctrl+A/E jump to line start/end, Ctrl+D deletes forward,
 * Ctrl+K deletes to the end of the line) and turned them into select-all,
 * inline code, duplicate and the command palette.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const p =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad|ipod/i.test(p);
}

/** On a Mac only ⌘ counts. Elsewhere Ctrl (and the rarely-used Windows/
 *  Super key, which the OS mostly keeps for itself). */
export function primaryMod(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac() ? e.metaKey : e.ctrlKey || e.metaKey;
}
