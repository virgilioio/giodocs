/* Related links — pure logic.
 *
 * MODEL: `props.related` is a flat `string[]`. Each entry is EITHER a page
 * id OR a URL. There is NO tagged union, NO `page:` prefix, NO join table.
 * Internal-vs-external is decided by RESOLUTION at read time: a stored
 * discriminator goes stale the moment a page is deleted, and would keep
 * claiming "this is a page" while pointing at nothing. Resolution is
 * self-healing.
 *
 * THREE states, never four. A page the reader may not open and a page that
 * was deleted are INDISTINGUISHABLE from the client: RLS removes both from
 * the visible page list identically. Both are `unresolved`. Do not attempt
 * to tell them apart, and never label one "Deleted page".
 *
 * No React, no Supabase. */

export type LinkKind = { label: string; tint: string; ink: string };

/** Host of a bare-or-schemed URL-ish string, lowercased, `www.` dropped. */
export function hostOf(v: string): string {
  let s = v.trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.toLowerCase();
  return s.startsWith("www.") ? s.slice(4) : s;
}

/** Path of a URL-ish string, always leading-slashed (or "" when absent). */
function pathOf(v: string): string {
  const s = v.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const i = s.search(/[/?#]/);
  if (i < 0) return "";
  const rest = s.slice(i);
  return rest.startsWith("/") ? rest : "";
}

const HOSTISH = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/** True for `https?://…` and for a bare `host.tld` with or without a path. */
export function isUrlish(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return HOSTISH.test(hostOf(s));
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false;
  return HOSTISH.test(hostOf(s));
}

/** Absolute href for an external entry — bare hosts get https://. */
export function hrefOf(v: string): string {
  const s = v.trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function endsWith(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/** Label + token pair for an external link. Tokens come from the existing
 * @theme set only — no new colour is introduced here. */
export function linkKind(url: string): LinkKind {
  const host = hostOf(url);
  if (endsWith(host, "figma.com"))
    return { label: "Figma", tint: "purpleTint", ink: "purple" };
  if (endsWith(host, "notion.so") || endsWith(host, "notion.site"))
    return { label: "Notion", tint: "sunken", ink: "strong" };
  if (endsWith(host, "loom.com"))
    return { label: "Loom", tint: "pinkTint", ink: "pinkInk" };
  if (host === "docs.google.com") {
    const p = pathOf(url);
    if (p.startsWith("/spreadsheets"))
      return { label: "Sheet", tint: "accentTint", ink: "accent" };
    if (p.startsWith("/presentation"))
      return { label: "Slide", tint: "amberTint", ink: "amberInk" };
    return { label: "Doc", tint: "blueTint", ink: "blueInk" };
  }
  if (endsWith(host, "dropbox.com"))
    return { label: "Dropbox", tint: "blueTint", ink: "blue" };
  return { label: host, tint: "sunken", ink: "secondary" };
}

export type RelPage = { id: string; title: string | null; icon: string | null };

export type RelResolved<P extends RelPage> =
  | { kind: "page"; page: P }
  | { kind: "url"; url: string }
  | { kind: "unresolved" };

/** Resolve ONE entry against the reader's own visible page list. That list
 * has already been filtered by RLS — this is the only permission rule. */
export function relResolve<P extends RelPage>(
  v: unknown,
  pages: readonly P[],
): RelResolved<P> {
  if (typeof v !== "string" || !v.trim()) return { kind: "unresolved" };
  const s = v.trim();
  const page = pages.find((p) => p.id === s);
  if (page) return { kind: "page", page };
  if (isUrlish(s)) return { kind: "url", url: s };
  return { kind: "unresolved" };
}

/** The stored array, defensively normalised. */
export function relList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && !!x.trim());
}
