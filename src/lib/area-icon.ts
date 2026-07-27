/**
 * Area icons live on the `area` property_def's options array — never a table.
 * These helpers are pure so they can be tested independently of Supabase.
 *
 *   options: [{ value, label, icon?, dot?, tint?, ink? }, …]
 */

export type AreaOption = {
  value: string;
  label?: string;
  icon?: string;
  dot?: string;
  tint?: string;
  ink?: string;
  [k: string]: unknown;
};

/**
 * Patch (or append) the `icon` for a given area value.
 *
 * - If an option with `value === area` exists → set/remove its `icon`.
 * - If none exists (e.g. an area created after seeding, like "Legal") →
 *   append a new option with sensible defaults.
 * - Passing `null` for emoji removes the `icon` key from the existing entry
 *   (leaving the option intact); if no entry existed, nothing is appended.
 */
export function applyAreaIcon(
  options: AreaOption[] | undefined | null,
  area: string,
  emoji: string | null,
): AreaOption[] {
  const list = Array.isArray(options) ? options.map((o) => ({ ...o })) : [];
  const idx = list.findIndex((o) => o.value === area);

  if (idx >= 0) {
    const entry = { ...list[idx] };
    if (emoji === null || emoji === "") delete entry.icon;
    else entry.icon = emoji;
    list[idx] = entry;
    return list;
  }

  // Not found: only append when we have an emoji to set.
  if (emoji === null || emoji === "") return list;
  list.push({
    value: area,
    label: area,
    icon: emoji,
    dot: "whisper",
    tint: "sunken",
    ink: "secondary",
  });
  return list;
}

/**
 * Extract the first grapheme from a user-supplied string, so multi-codepoint
 * emoji (family, flag, ZWJ sequences) survive intact. Falls back to code
 * points when `Intl.Segmenter` is not available.
 */
export function firstGrapheme(s: string): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  const S = (globalThis as { Intl?: { Segmenter?: unknown } }).Intl?.Segmenter as
    | (new (locale?: string, opts?: { granularity: string }) => {
        segment: (s: string) => Iterable<{ segment: string }>;
      })
    | undefined;
  if (S) {
    const seg = new S(undefined, { granularity: "grapheme" });
    for (const g of seg.segment(t)) return g.segment;
    return "";
  }
  return Array.from(t)[0] ?? "";
}
