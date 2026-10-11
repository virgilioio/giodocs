import type { IconKey } from "./menu-icons";
import type { PreviewKey } from "@/components/block-previews";

/* The slash menu's rows (2026-10-11): Suggested (recent picks, per device),
 * then Basic blocks, Media, Database and Advanced. Pure, apart from the
 * recent-picks memory in localStorage (a convenience, never needed). */

export type SlashGroup = "basic" | "media" | "database" | "advanced";

export const SLASH_GROUP_LABELS: Record<SlashGroup | "suggested", string> = {
  suggested: "Suggested",
  basic: "Basic blocks",
  media: "Media",
  database: "Database",
  advanced: "Advanced",
};

export const ORDER: SlashGroup[] = ["basic", "media", "database", "advanced"];

export type SlashItemLike = {
  type: string;
  name: string;
  ic: IconKey;
  group: SlashGroup;
  pv: PreviewKey;
  md?: string;
  kw?: string;
  count?: number;
  lang?: string;
};

export type SlashEntry<T extends SlashItemLike> = T & {
  section: SlashGroup | "suggested";
  key: string;
};

export function slashKey(m: { type: string; count?: number; lang?: string }): string {
  return `${m.type}|${m.count ?? ""}|${m.lang ?? ""}`;
}

/* Recent picks: a per-device convenience (localStorage), never needed. */
const RECENT_KEY = "gio.slash.recent";
function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function rememberSlashPick(m: { type: string; count?: number; lang?: string }): void {
  try {
    const k = slashKey(m);
    const next = [k, ...readRecent().filter((x) => x !== k)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

function matches(m: SlashItemLike, q: string): boolean {
  return (
    m.name.toLowerCase().includes(q) ||
    m.type.includes(q) ||
    (m.kw != null && m.kw.includes(q)) ||
    (m.count != null && `col${m.count}`.includes(q))
  );
}

/** The menu's rows in order: Suggested (recent picks, only with nothing
 *  typed), then each section; typing filters within sections, and names
 *  that start with what's typed come first in their section. */
export function slashEntries<T extends SlashItemLike>(
  items: readonly T[],
  query: string,
  recent: readonly string[] = readRecent(),
): SlashEntry<T>[] {
  const q = query.toLowerCase().trim();
  const out: SlashEntry<T>[] = [];
  if (!q) {
    const byKey = new Map(items.map((m) => [slashKey(m), m]));
    for (const k of recent.slice(0, 4)) {
      const m = byKey.get(k);
      if (m) out.push({ ...m, section: "suggested", key: `s:${k}` });
    }
  }
  for (const g of ORDER) {
    const inGroup = items.filter((m) => m.group === g && (!q || matches(m, q)));
    if (q) inGroup.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)));
    for (const m of inGroup) out.push({ ...m, section: g, key: `${g}:${slashKey(m)}` });
  }
  return out;
}

