/**
 * Avatar system — three flat axes: colour, portrait, skin tone.
 *
 * A worn portrait is a picture of a person. A photograph does not dim at dusk,
 * so when face > 0 the disc resolves to a fixed LIGHT pastel literal via
 * TINT_LIT — it must NOT take a dark-mode token value. Hair is chosen against
 * pastel discs; letting the disc go dark collapses hair-on-disc contrast to
 * near-invisibility and every portrait would read as the same bald head. See
 * the spec doc for the failed first attempt. Initials do theme normally —
 * they are type, not a picture.
 *
 * The ten skin/hair hexes below are the ONLY sanctioned exception to the
 * no-literal-colour rule alongside export.ts, because they are not brand
 * tokens; they render human skin and hair and must stay identical in light
 * and dark themes.
 */

export const TINT_LIT: Record<string, string> = {
  accentTint: "#DCFBE9",
  amberRing:  "#FCE7C8",
  blueWash:   "#DCEAFE",
  purpleTint: "#EDE4FF",
  pinkTint:   "#FBE0EE",
  yellowTint: "#FAF4C4",
};

/** Defaults used when a profile row is missing avatar_tint / avatar_ink. */
export const DEFAULT_TINT = TINT_LIT.blueWash;
export const DEFAULT_INK = "#2563EB";

/** The six palette entries offered by the colour swatch row. Both raw hex
 *  values (as stored in profiles.avatar_tint / avatar_ink) and the token
 *  key are kept, so the picker can preview by either. */
export const PALETTE: Array<{ tint: string; ink: string; name: string }> = [
  { tint: "#DCFBE9", ink: "#0B7A57", name: "accentTint" },
  { tint: "#FCE7C8", ink: "#B45309", name: "amberRing" },
  { tint: "#DCEAFE", ink: "#2563EB", name: "blueWash" },
  { tint: "#EDE4FF", ink: "#5B21B6", name: "purpleTint" },
  { tint: "#FBE0EE", ink: "#BE185D", name: "pinkTint" },
  { tint: "#FAF4C4", ink: "#7A6A10", name: "yellowTint" },
];

/** [skin, hair] pairs. Hair is always darker than its skin so it reads on the
 *  pastel disc at 9.5px cell sizes. */
export const SKIN: ReadonlyArray<readonly [string, string]> = [
  ["#F4D7BE", "#6B4A2B"],
  ["#E8BE97", "#3A2A1B"],
  ["#C98D5F", "#2E2118"],
  ["#96603A", "#241A12"],
  ["#5E3A24", "#241610"],
];

const BUST =
  "M4.6 32c.9-6.7 5.5-11.1 11.4-11.1S26.5 25.3 27.4 32z";
const HEAD =
  '<circle cx="16" cy="13" r="7.3" fill="%S"/>';
const CAP =
  '<path d="M16 4.8c-4.2 0-7.5 3-7.5 6.9 0 .6.1 1.2.2 1.8 1-2.7 3.8-4 7.3-4s6.3 1.3 7.3 4c.1-.6.2-1.2.2-1.8 0-3.9-3.3-6.9-7.5-6.9z" fill="%H"/>';

export type Face = { name: string; svg: (() => string) | null };

/** Nine entries. Index 0 is Initials (no SVG); 1..8 are the eight portraits.
 *  Names describe hair, not gender — see spec §3. */
export const FACES: Face[] = [
  { name: "Initials", svg: null },
  { name: "Crop",  svg: () => HEAD + CAP },
  { name: "Coils", svg: () => '<circle cx="16" cy="10.8" r="9.6" fill="%H"/>' + HEAD },
  { name: "Locs",  svg: () => HEAD + CAP +
      '<rect x="6.4" y="11.6" width="2.7" height="13" rx="1.35" fill="%H"/>' +
      '<rect x="22.9" y="11.6" width="2.7" height="13" rx="1.35" fill="%H"/>' },
  { name: "Long",  svg: () => HEAD +
      '<path d="M7.6 12.4C7.6 7.4 11.4 4 16 4s8.4 3.4 8.4 8.4V26.5h-3.3V13.6c0-2.4-2.3-3.8-5.1-3.8s-5.1 1.4-5.1 3.8V26.5H7.6z" fill="%H"/>' },
  { name: "Bun",   svg: () => '<circle cx="16" cy="3.6" r="3.1" fill="%H"/>' + HEAD + CAP },
  { name: "Curls", svg: () =>
      '<circle cx="10.2" cy="8.6" r="3.5" fill="%H"/>' +
      '<circle cx="16" cy="6.4" r="3.8" fill="%H"/>' +
      '<circle cx="21.8" cy="8.6" r="3.5" fill="%H"/>' +
      HEAD + CAP },
  { name: "Wrap",  svg: () =>
      '<path d="M8.2 13.2C8.2 7.9 11.7 4.4 16 4.4s7.8 3.5 7.8 8.8c0 2.2-.5 4-1.3 5.3l2.2 4.3H7.1l1.9-4.5c-.5-1.4-.8-3-.8-5.1z" fill="%H"/>' +
      '<ellipse cx="16" cy="13.8" rx="5.1" ry="6.1" fill="%S"/>' },
  { name: "Beard", svg: () => HEAD + CAP +
      '<path d="M9.6 14.9c0 5.2 2.9 9 6.4 9s6.4-3.8 6.4-9c-.7 3-3 4.6-6.4 4.6s-5.7-1.6-6.4-4.6z" fill="%H"/>' },
];

/** Compose the CSS `background` value that ships a portrait inside the same
 *  field that used to carry a plain colour. When face is 0/null, returns the
 *  bare tint (which themes normally). When face > 0, returns
 *  `url("data:image/svg+xml,…") …, <ground>` where <ground> is fixed to the
 *  light hex from TINT_LIT so the disc does not follow dark mode. */
export function avaBg(
  tint: string,
  face?: number | null,
  skin?: number | null,
): string {
  const fi = face ?? 0;
  const f = FACES[fi] ?? FACES[0];
  if (!f.svg) return tint;
  const ground = TINT_LIT[tint] ?? tint;
  const si = Math.max(0, Math.min(SKIN.length - 1, skin ?? 0));
  const [s, h] = SKIN[si];
  const body =
    (`<path d="${BUST}" fill="%S"/>` + f.svg())
      .split("%S").join(s)
      .split("%H").join(h);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center/100% 100% no-repeat, ${ground}`;
}

/** Transform a raw profile-shaped record so `avatar_tint` carries the composed
 *  background and `avatar_ink` is `'transparent'` when a portrait is worn.
 *  Initials keep their real ink so screen readers and copy-paste still work
 *  — the letters stay in the DOM in every avatar site. */
export function applyAvatarRender<
  P extends {
    avatar_tint?: string | null;
    avatar_ink?: string | null;
    avatar_face?: number | null;
    avatar_skin?: number | null;
  } | null | undefined,
>(profile: P): P {
  if (!profile) return profile;
  const face = profile.avatar_face ?? 0;
  if (face === 0) return profile;
  const tint = profile.avatar_tint ?? "#DCEAFE";
  return {
    ...profile,
    avatar_tint: avaBg(tint, face, profile.avatar_skin ?? 0),
    avatar_ink: "transparent",
  };
}
