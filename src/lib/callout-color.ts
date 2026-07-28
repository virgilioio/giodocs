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
  neutral: "var(--color-sunken)",
  green: "var(--color-accentTint)",
  amber: "var(--color-amberTint)",
  blue: "var(--color-blueTint)",
  purple: "var(--color-purpleTint)",
  pink: "var(--color-pinkTint)",
  red: "var(--color-dangerTint)",
  yellow: "var(--color-yellowTint)",
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

export function calloutLabel(color: unknown): string {
  return isCalloutColor(color) ? LABELS[color] : LABELS.neutral;
}
