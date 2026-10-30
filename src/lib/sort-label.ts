import { sortsOf, type SortSpec } from "./run-view";
import { BUILT_IN_LABELS } from "./view-config";

/* The words a view's sort reads as ("Newest edits", "Due ↓, then Effort ↑"),
 * for the toolbar and the view menus. Pure. */

const NAMED: Record<string, string> = {
  "edited:desc": "Newest edits",
  "edited:asc": "Oldest edits",
  "verified:asc": "Oldest verification",
  "verified:desc": "Newest verification",
  "title:asc": "Title A–Z",
  "title:desc": "Title Z–A",
  "@created:desc": "Newest first",
  "@created:asc": "Oldest first",
  "manual:asc": "Manual order",
};

type LabelDef = { key: string; label: string };

function nameOf(prop: string, defs: LabelDef[]): string {
  if (prop === "edited") return "Edited";
  if (prop === "verified") return "Verified";
  if (prop === "title") return "Title";
  if (BUILT_IN_LABELS[prop]) return BUILT_IN_LABELS[prop];
  const key = prop.startsWith("p:") ? prop.slice(2) : prop;
  return defs.find((d) => d.key === key)?.label ?? key;
}

export function sortLabel(
  sort: SortSpec | SortSpec[] | null | undefined,
  defs: LabelDef[],
): string {
  const list = sortsOf(sort);
  if (list[0]?.prop === "manual") return "Manual order";
  if (list.length === 1) {
    const named = NAMED[`${list[0].prop}:${list[0].dir}`];
    if (named) return named;
  }
  return list.map((s) => `${nameOf(s.prop, defs)} ${s.dir === "asc" ? "↑" : "↓"}`).join(", then ");
}
