/* The page list views filter their rows from must hold every live page:
 * Supabase returns at most 1000 rows a request, so a single capped read
 * silently dropped old rows from views, counts and exports (2026-10-30). */
import { describe, expect, it, vi } from "vitest";

const TOTAL = 2345;
const rows = Array.from({ length: TOTAL }, (_, i) => ({
  id: `p${String(i).padStart(5, "0")}`,
  edited_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
}));
const ranges: Array<[number, number]> = [];

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order"]) b[m] = () => b;
    b.range = async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    };
    return b;
  };
  return { supabase: { from: () => builder() } };
});

describe("fetchPages", () => {
  it("reads every page past Supabase's 1000-row cap, newest edit first", async () => {
    const { fetchPages } = await import("./use-workspace-data");
    const out = await fetchPages("ws");
    expect(out).toHaveLength(TOTAL);
    expect(new Set(out.map((p) => p.id)).size).toBe(TOTAL);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(out[0].id).toBe(`p${String(TOTAL - 1).padStart(5, "0")}`);
    expect(out[TOTAL - 1].id).toBe("p00000");
  });
});
