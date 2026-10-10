/* The first user-perceived character of a string (an emoji with its
 * modifiers counts as one). */

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
