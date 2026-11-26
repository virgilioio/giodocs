/* Page covers (Allan, 2026-11-25): Notion's image across the top of a page.
 * A cover is one of Gio's colours or gradients (gallery), an image
 * uploaded into the page's own folder (upload: a storage path, signed when
 * shown, so exactly the people who can open the page see it) or an image
 * on the web (link). `position` is how far down an image is shown, 0 to
 * 100. The database checks the same shape (page_cover_ok); this file is
 * the browser's half of that rule. Pure. */

export type CoverKind = "gallery" | "upload" | "link";
export type PageCover = { kind: CoverKind; value: string; position?: number };

export type GalleryCover = { id: string; label: string; css: string };

const v = (token: string) => `var(--color-${token})`;
const grad = (angle: number, ...stops: string[]) =>
  `linear-gradient(${angle}deg, ${stops.map(v).join(", ")})`;

/** Gio's colours and gradients, from the design tokens (they follow the
 *  theme, and exported or public documents define the same tokens). */
export const COVER_GALLERY: readonly GalleryCover[] = [
  { id: "sand", label: "Sand", css: v("sunken") },
  { id: "mint", label: "Mint", css: v("accentTint") },
  { id: "honey", label: "Honey", css: v("amberTint") },
  { id: "lemon", label: "Lemon", css: v("yellowTint") },
  { id: "sky", label: "Sky", css: v("blueTint") },
  { id: "lilac", label: "Lilac", css: v("purpleTint") },
  { id: "blush", label: "Blush", css: v("pinkTint") },
  { id: "rose", label: "Rose", css: v("dangerTint") },
  { id: "forest", label: "Forest", css: v("accent") },
  { id: "ocean", label: "Ocean", css: v("blue") },
  { id: "plum", label: "Plum", css: v("purple") },
  { id: "ink", label: "Ink", css: v("noir") },
  { id: "dawn", label: "Dawn", css: grad(120, "amberTint", "pinkTint") },
  { id: "lagoon", label: "Lagoon", css: grad(120, "accentTint", "blueTint") },
  { id: "dusk", label: "Dusk", css: grad(120, "purpleTint", "blueTint") },
  { id: "citrus", label: "Citrus", css: grad(120, "yellowTint", "accentTint") },
  { id: "ember", label: "Ember", css: grad(120, "amberDot", "dangerDot") },
  { id: "aurora", label: "Aurora", css: grad(120, "accent", "blue", "purple") },
  { id: "berry", label: "Berry", css: grad(120, "pink", "purple") },
  { id: "midnight", label: "Midnight", css: grad(160, "noir", "purple") },
];

const GALLERY_ID = /^[a-z][a-z0-9-]{0,30}$/;
const LINK = /^https?:\/\/\S+$/i;

/** A gallery entry by id; an unknown one (from a later version) reads as
 *  the first colour rather than nothing. */
export function galleryCover(id: string): GalleryCover {
  return COVER_GALLERY.find((g) => g.id === id) ?? COVER_GALLERY[0];
}

export function clampPosition(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 50;
  return Math.round(Math.min(100, Math.max(0, x)) * 10) / 10;
}

/** A stored cover, read defensively (null when there is none or it isn't
 *  one this version understands). */
export function readCover(raw: unknown): PageCover | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const value = typeof r.value === "string" ? r.value : "";
  if (!value || value.length > 2000) return null;
  const position = r.position === undefined ? undefined : clampPosition(r.position);
  if (r.kind === "gallery" && GALLERY_ID.test(value)) return { kind: "gallery", value };
  if (r.kind === "upload" && !value.includes(".."))
    return { kind: "upload", value, ...(position === undefined ? {} : { position }) };
  if (r.kind === "link" && LINK.test(value))
    return { kind: "link", value, ...(position === undefined ? {} : { position }) };
  return null;
}

/** Can this cover be moved up and down? (Images only.) */
export function canReposition(c: PageCover | null): boolean {
  return !!c && c.kind !== "gallery";
}

/** What "Add cover" puts on: a gallery colour, a different one each time. */
export function randomGalleryCover(rand: () => number = Math.random): PageCover {
  const pick = COVER_GALLERY[Math.floor(rand() * COVER_GALLERY.length) % COVER_GALLERY.length];
  return { kind: "gallery", value: pick.id };
}

/** A pasted image address as a link cover, or why it can't be one. */
export function linkCover(
  text: string,
): { cover: PageCover; problem: null } | { cover: null; problem: string } {
  const t = text.trim();
  if (!t) return { cover: null, problem: "Paste the address of an image." };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  if (!LINK.test(withScheme) || withScheme.length > 2000)
    return { cover: null, problem: "That isn’t a web address. It should start with https://" };
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:")
      return { cover: null, problem: "Only web addresses (https://) work as a cover." };
    return { cover: { kind: "link", value: u.toString(), position: 50 }, problem: null };
  } catch {
    return { cover: null, problem: "That isn’t a web address. It should start with https://" };
  }
}

/** The new position after dragging an image `dy` pixels down (Notion's
 *  way: dragging down shows more of the top). `overflow` is how much
 *  taller the image is drawn than the cover; with none, the cover's own
 *  height is used so the drag still answers. */
export function dragPosition(start: number, dy: number, overflow: number, height: number): number {
  const range = overflow > 4 ? overflow : Math.max(height, 1);
  return clampPosition(start - (dy / range) * 100);
}

/** How much taller than the box an image is drawn with object-fit: cover. */
export function coverOverflow(
  natural: { w: number; h: number },
  box: { w: number; h: number },
): number {
  if (!natural.w || !natural.h || !box.w || !box.h) return 0;
  const scale = Math.max(box.w / natural.w, box.h / natural.h);
  return Math.max(0, natural.h * scale - box.h);
}

/** The cover as a CSS background for a gallery cover, or the image's
 *  object-position for an image. */
export function coverObjectPosition(c: PageCover): string {
  return `50% ${clampPosition(c.position ?? 50)}%`;
}

/** The storage path an uploaded cover takes when it's copied to another
 *  page (a template's, a duplicate's): the same file in that page's
 *  folder. Null when it's already there or isn't a page's file. */
export function coverPathForPage(path: string, pageId: string): string | null {
  const parts = path.split("/");
  if (parts.length < 3 || parts[1] === "emoji" || parts[1] === pageId) return null;
  return [parts[0], pageId, ...parts.slice(2)].join("/");
}

/** The cover a copy of the page should carry, with an uploaded image's
 *  new path (the file itself is copied by the caller). */
export function coverForCopy(
  c: PageCover | null,
  pageId: string,
): {
  cover: PageCover | null;
  copy: { from: string; to: string } | null;
} {
  if (!c) return { cover: null, copy: null };
  if (c.kind !== "upload") return { cover: c, copy: null };
  const to = coverPathForPage(c.value, pageId);
  if (!to) return { cover: c, copy: null };
  return { cover: { ...c, value: to }, copy: { from: c.value, to } };
}
