// Cosmetic slug + short-id helpers for /p/{slug}-{id6}.
// Routing is authoritative on the id — the slug is decoration and can drift
// when a page is renamed without breaking old links.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

export function slugify(title: string | null | undefined): string {
  const raw = (title ?? "").toLowerCase().normalize("NFKD");
  const collapsed = raw
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = collapsed.slice(0, 28).replace(/-+$/g, "");
  return trimmed || "untitled";
}

export function shortId(fullId: string): string {
  return fullId.replace(/-/g, "").slice(0, 6);
}

export function pageUrl(fullId: string, title: string | null): string {
  const origin =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "";
  return `${origin}/p/${slugify(title)}-${shortId(fullId)}`;
}

/** Resolve a route param that may be a full UUID or a "slug-id6" form. */
export function resolvePageIdParam(
  param: string,
  pages: ReadonlyArray<{ id: string }>,
): string {
  if (isUUID(param)) return param;
  const tail = param.split("-").pop() ?? "";
  if (tail.length < 4) return param;
  const flatTail = tail.toLowerCase();
  const match = pages.find(
    (p) => p.id.replace(/-/g, "").toLowerCase().startsWith(flatTail),
  );
  return match?.id ?? param;
}
