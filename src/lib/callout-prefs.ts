/**
 * The last callout style you picked — its emoji and colour — so the next
 * callout you create starts the same way. A per-device convenience, kept in
 * localStorage like emoji favourites; a page never depends on it.
 */
import { CALLOUT_COLORS, type CalloutColor } from "./callout-color";

const KEY = "gio.callout.last";
const DEFAULT_ICON = "💡";

export type CalloutDefaults = { icon: string; color?: CalloutColor };

function read(): CalloutDefaults {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { icon: DEFAULT_ICON };
    const v = JSON.parse(raw) as { icon?: unknown; color?: unknown };
    const icon = typeof v.icon === "string" && v.icon && v.icon.length <= 64 ? v.icon : DEFAULT_ICON;
    const color =
      typeof v.color === "string" && (CALLOUT_COLORS as readonly string[]).includes(v.color)
        ? (v.color as CalloutColor)
        : undefined;
    return { icon, color };
  } catch {
    return { icon: DEFAULT_ICON };
  }
}

export function getCalloutDefaults(): CalloutDefaults {
  return read();
}

export function rememberCallout(patch: { icon?: string; color?: CalloutColor }): void {
  try {
    const next = { ...read(), ...patch };
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

/** Give a new callout the remembered emoji and colour, without overriding
 *  ones it already has. Mutates and returns `b`. */
export function applyCalloutDefaults<T extends { icon?: unknown; color?: unknown }>(b: T): T {
  const d = read();
  if (!b.icon) (b as { icon?: unknown }).icon = d.icon;
  if (b.color === undefined && d.color && d.color !== "neutral") (b as { color?: unknown }).color = d.color;
  return b;
}
