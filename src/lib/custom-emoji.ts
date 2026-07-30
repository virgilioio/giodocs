/**
 * Custom emoji — the resolver, and nothing else.
 *
 * THE MODEL: `pages.icon` (and `views.icon`, and an area option's `icon`)
 * stays ONE string. A unicode char is itself; a custom emoji is a
 * shortcode — ":ship-it:". The leading colon is self-describing, so the
 * resolver is three lines rather than a join, and every existing read
 * site already handles a string.
 *
 * Icons render in a dozen places. Branching at each site is how this
 * becomes a week of bugs, so each site renders ONE span carrying BOTH a
 * background image and a text child:
 *
 *   backgroundImage: icoBg(icon, set)   → url(…) for custom, 'none' otherwise
 *   children:        icoCh(icon, set)   → '' for custom, the char otherwise
 *
 * A unicode icon paints the char with no background; a custom one paints
 * the image with an empty text node. Same element, same box, one code
 * path — the technique the avatar portraits already use.
 *
 * The span MUST carry explicit width, height and a matching line-height:
 * a text-only span has no intrinsic box for a background image to fill,
 * so a custom icon would render invisibly. See <Ico> in
 * src/components/emoji-icon.tsx, which is the only sanctioned way to
 * render an icon.
 */

export type CustomEmoji = {
  name: string;
  description: string;
  path: string;
  /** Resolved signed URL for `path`. Empty while the batch sign is in flight. */
  url: string;
  created_by: string | null;
  created_at: string;
};

/** True when the string is a shortcode rather than a unicode grapheme. */
export function isShortcode(icon: string | null | undefined): boolean {
  return !!icon && icon.length > 2 && icon[0] === ":" && icon.endsWith(":");
}

/** The custom emoji an icon string names, or null when it is unicode. */
export type IconEmoji = { name: string; url: string };

export function customFor(
  icon: string | null | undefined,
  set: readonly IconEmoji[],
): IconEmoji | null {
  if (!isShortcode(icon)) return null;
  const name = icon!.slice(1, -1);
  return set.find((e) => e.name === name) ?? null;
}

/** `background-image` for an icon span. */
export function icoBg(
  icon: string | null | undefined,
  set: readonly IconEmoji[],
): string {
  const c = customFor(icon, set);
  return c && c.url ? `url("${c.url}")` : "none";
}

/** The text child of an icon span — empty for a custom emoji. */
export function icoCh(
  icon: string | null | undefined,
  set: readonly IconEmoji[],
): string {
  return customFor(icon, set) ? "" : (icon ?? "");
}

/* ───────────────────────── naming ───────────────────────── */

export const EMOJI_NAME_MAX = 24;

/**
 * Lowercase, non-alphanumerics → "-", collapse runs, strip leading
 * hyphens, cap at 24. Matches the database's
 * ^[a-z0-9][a-z0-9-]{0,23}$ check, so a sanitised name never round-trips
 * into a constraint violation.
 */
export function sanitizeEmojiName(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, EMOJI_NAME_MAX)
    .replace(/-+$/, "");
}

/** "Ship It@2x.png" → "ship-it-2x". Turns a two-field form into one click. */
export function nameFromFilename(filename: string): string {
  const stem = (filename ?? "").replace(/\.[a-z0-9]+$/i, "");
  return sanitizeEmojiName(stem);
}

export function isValidEmojiName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(name);
}

/** {workspace_id}/emoji/{name}.png inside the existing page-images bucket. */
export function emojiStoragePath(workspaceId: string, name: string): string {
  return `${workspaceId}/emoji/${name}.png`;
}

/* ───────────────────────── the hint line ───────────────────────── */

export type HintTone = "secondary" | "danger" | "accent";
export type ComposerHint = { text: string; tone: HintTone };

/**
 * Six states, each answering a different question. Pure so the copy is
 * testable without a DOM.
 */
export function composerHint(input: {
  hasImage: boolean;
  name: string;
  taken: boolean;
  editing: boolean;
  originalName?: string;
}): ComposerHint {
  const { hasImage, name, taken, editing, originalName } = input;
  if (!hasImage)
    return {
      text: "A square image works best — it is cropped to a square and scaled to 128px.",
      tone: "secondary",
    };
  if (!name)
    return {
      text: "Give it a name. That name is how it is typed and searched.",
      tone: "secondary",
    };
  if (taken) return { text: `:${name}: is taken. Pick another name.`, tone: "danger" };
  if (!editing)
    return {
      text: `Ready. It will appear as :${name}: in the picker and in search.`,
      tone: "accent",
    };
  if (originalName === name)
    return { text: "Saving updates it everywhere it is used.", tone: "accent" };
  return { text: `Renaming to :${name}: updates every page wearing it.`, tone: "accent" };
}
