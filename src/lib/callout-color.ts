/**
 * Callout colour: stored as a SEMANTIC NAME on the block, resolved to a
 * design token at render time. Never a hex — a stored hex would survive
 * a theme change as the wrong colour and would bypass the token guard.
 *
 * The eight options all map to existing pale surface tokens in
 * src/styles.css so tinted callouts stay readable with the body text
 * unchanged. Absent === "neutral", which is exactly today's appearance.
 */

export const CALLOUT_COLORS = [
  "neutral",
  "green",
  "amber",
  "blue",
  "purple",
  "pink",
  "red",
  "yellow",
] as const;

export type CalloutColor = (typeof CALLOUT_COLORS)[number];

/** Map every colour to its CSS token expression. Neutral matches today's
 *  bg-sunken. A total map — no `neutral` fallback pretending to be an
 *  option; the fallback lives in the resolver below. */
const TOKENS: Record<CalloutColor, string> = {
  neutral: "var(--color-rail)",
  green: "var(--color-accentTint)",
  amber: "var(--color-amberTint)",
  blue: "var(--color-blueTint)",
  purple: "var(--color-purpleTint)",
  pink: "var(--color-pinkTint)",
  red: "var(--color-dangerTint)",
  yellow: "var(--color-yellowTint)",
};

/** The 1px edge each tint is paired with. Four exist as tokens; the other
 *  four are DERIVED with color-mix against each tint's own ink, so a
 *  callout can never introduce a hue the palette does not already have,
 *  and every pair inverts correctly in dark mode with no second set of
 *  values. */
const RINGS: Record<CalloutColor, string> = {
  neutral: "var(--color-line)",
  green: "var(--color-accentRing)",
  amber: "var(--color-amberRing)",
  red: "var(--color-dangerRing)",
  yellow: "color-mix(in oklab, var(--color-yellowTint) 74%, var(--color-yellowInk))",
  blue: "color-mix(in oklab, var(--color-blueTint) 78%, var(--color-blueInk))",
  purple: "color-mix(in oklab, var(--color-purpleTint) 78%, var(--color-purple))",
  pink: "color-mix(in oklab, var(--color-pinkTint) 78%, var(--color-pink))",
};

const LABELS: Record<CalloutColor, string> = {
  neutral: "Neutral",
  green: "Green",
  amber: "Amber",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
  yellow: "Yellow",
};

export function isCalloutColor(v: unknown): v is CalloutColor {
  return typeof v === "string" && (CALLOUT_COLORS as readonly string[]).includes(v);
}

/** Resolve a colour name (or absent/unknown) to its token expression.
 *  Total: every CalloutColor resolves; anything else falls back to
 *  neutral. Never throws. */
export function calloutBg(color: unknown): string {
  return isCalloutColor(color) ? TOKENS[color] : TOKENS.neutral;
}

/** The ring paired with a colour. Same totality guarantee as calloutBg. */
export function calloutRing(color: unknown): string {
  return isCalloutColor(color) ? RINGS[color] : RINGS.neutral;
}

export function calloutLabel(color: unknown): string {
  return isCalloutColor(color) ? LABELS[color] : LABELS.neutral;
}

