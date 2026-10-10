import { formatTimestamp } from "./format";

/* How views show timestamps (Edited, Verified, Created): relative or
 * absolute, from the reader's preferences. Set once by MainView. */
let mode: "relative" | "absolute" = "relative";

export function setViewDateMode(m: "relative" | "absolute"): void {
  mode = m;
}

export function viewTime(iso: string): string {
  return formatTimestamp(iso, mode);
}
