/* Home: the person's start page. Pure helpers, so the rules are tested
 * apart from the screen (src/components/home-view.tsx). */

export type StartPage = "home" | "last";

export type HomePrefs = {
  nickname: string | null;
  emoji: string | null;
  start_page: StartPage;
  hidden: string[];
  pinned_views: string[];
  /** Pages the person starred, in the order they starred them. */
  favorite_pages: string[];
};

export const DEFAULT_HOME_PREFS: HomePrefs = {
  nickname: null,
  emoji: null,
  start_page: "home",
  hidden: [],
  pinned_views: [],
  favorite_pages: [],
};

export type PageVisit = { page_id: string; visited_at: string };

/** How many pages Recently visited shows. */
export const RECENT_LIMIT = 12;

/** "Good morning" before noon, "Good afternoon" until 5pm, then
 *  "Good evening" (and through the night, until 5am). */
export function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}

/** The name the greeting uses: the nickname set on Home, else the first
 *  word of the person's name, else the start of their email. */
export function greetingName(
  nickname: string | null | undefined,
  fullName: string | null | undefined,
  email: string | null | undefined,
): string {
  const nick = nickname?.trim();
  if (nick) return nick;
  const first = fullName?.trim().split(/\s+/)[0];
  if (first) return first;
  return email?.split("@")[0]?.trim() ?? "";
}

/** The pages a person visited, newest first, limited to the ones they can
 *  still open (the pages list leaves out deleted, archived and template
 *  pages, and pages they lost access to). */
export function recentPages<P extends { id: string }>(
  visits: readonly PageVisit[],
  pages: readonly P[],
  limit = RECENT_LIMIT,
): Array<P & { visited_at: string }> {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: Array<P & { visited_at: string }> = [];
  const seen = new Set<string>();
  for (const v of visits) {
    if (seen.has(v.page_id)) continue;
    const p = byId.get(v.page_id);
    if (!p) continue;
    seen.add(v.page_id);
    out.push({ ...p, visited_at: v.visited_at });
    if (out.length >= limit) break;
  }
  return out;
}

/** Where the app opens at "/": Home, or the last page visited when the
 *  person chose that and there is one they can still open. */
export function startTarget<P extends { id: string }>(
  startPage: StartPage,
  visits: readonly PageVisit[],
  pages: readonly P[],
): { to: "home" } | { to: "page"; id: string } {
  if (startPage === "last") {
    const [last] = recentPages(visits, pages, 1);
    if (last) return { to: "page", id: last.id };
  }
  return { to: "home" };
}

/** A visit recorded locally: the page moves to the front. */
export function withVisit(visits: readonly PageVisit[], pageId: string, at: string): PageVisit[] {
  return [{ page_id: pageId, visited_at: at }, ...visits.filter((v) => v.page_id !== pageId)];
}

/** Reads a home_prefs row defensively. */
export function readHomePrefs(row: Partial<Record<keyof HomePrefs, unknown>> | null | undefined): HomePrefs {
  if (!row) return DEFAULT_HOME_PREFS;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    nickname: typeof row.nickname === "string" ? row.nickname : null,
    emoji: typeof row.emoji === "string" ? row.emoji : null,
    start_page: row.start_page === "last" ? "last" : "home",
    hidden: strs(row.hidden),
    pinned_views: strs(row.pinned_views),
    favorite_pages: strs(row.favorite_pages),
  };
}

/** Pins a view to Home, or unpins it. Newest pins go last. */
export function togglePinned(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Stars a page, or unstars it. Newest stars go last; at most 200. */
export function toggleFavorite(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-200);
}

/** The starred pages the person can open, in starred order. */
export function favoritePages<P extends { id: string; archived_at?: string | null }>(
  ids: readonly string[],
  pages: readonly P[],
): P[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is P => !!p && !p.archived_at);
}

/** Hides a Home section, or shows it again. */
export function toggleHidden(list: readonly string[], section: string): string[] {
  return list.includes(section) ? list.filter((x) => x !== section) : [...list, section];
}

export type HomeSection = "recent" | "tasks" | "views" | "updated" | "templates";

export const HOME_SECTIONS: Array<{ id: HomeSection; label: string }> = [
  { id: "recent", label: "Recently visited" },
  { id: "tasks", label: "My tasks" },
  { id: "views", label: "Pinned views" },
  { id: "updated", label: "Recently updated" },
  { id: "templates", label: "Templates" },
];

/** The pages edited most recently in the workspace, newest first. */
export function recentlyUpdated<P extends { id: string; edited_at?: string | null; is_database?: boolean }>(
  pages: readonly P[],
  limit = 6,
): P[] {
  return [...pages]
    .filter((p) => !!p.edited_at)
    .sort((a, b) => (b.edited_at ?? "").localeCompare(a.edited_at ?? ""))
    .slice(0, limit);
}
