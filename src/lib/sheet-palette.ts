/**
 * Cell fill / ink for the `sheet` block. A cell stores a palette KEY
 * (bg / fg in sheet-model), never a hex — a stored hex would survive a
 * theme change as the wrong colour and would bypass the token guard.
 *
 * ONE map, read by the renderer and by export, so a sheet cannot look one
 * colour on screen and another in a PDF.
 */

export const SHEET_FILLS = [
  "none",
  "grey",
  "green",
  "amber",
  "blue",
  "purple",
  "pink",
  "red",
  "yellow",
] as const;

export type SheetFill = (typeof SHEET_FILLS)[number];

const FILL_TOKENS: Record<SheetFill, string> = {
  none: "transparent",
  grey: "var(--color-rail)",
  green: "var(--color-accentTint)",
  amber: "var(--color-amberTint)",
  blue: "var(--color-blueTint)",
  purple: "var(--color-purpleTint)",
  pink: "var(--color-pinkTint)",
  red: "var(--color-dangerTint)",
  yellow: "var(--color-yellowTint)",
};

export const SHEET_INKS = [
  "body",
  "muted",
  "green",
  "amber",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type SheetInk = (typeof SHEET_INKS)[number];

const INK_TOKENS: Record<SheetInk, string> = {
  body: "var(--color-body)",
  muted: "var(--color-muted)",
  green: "var(--color-accentInk)",
  amber: "var(--color-amberInk)",
  blue: "var(--color-blueInk)",
  purple: "var(--color-purple)",
  pink: "var(--color-pink)",
  red: "var(--color-danger)",
};

/** Resolve a stored fill key. An unknown key resolves to no fill rather
 *  than throwing — data outlives the code that wrote it. */
export function fillToken(key: string | undefined): string | undefined {
  if (!key || key === "none") return undefined;
  return FILL_TOKENS[key as SheetFill];
}

/** Resolve a stored ink key. Unknown resolves to undefined (inherit). */
export function inkToken(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return INK_TOKENS[key as SheetInk];
}
