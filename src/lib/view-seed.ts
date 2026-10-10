import type { Filter } from "./run-view";
import { rangeOf } from "./run-view";
import { isComputedDef } from "./relations";

/* What a page made from inside a view starts with, so it lands in the view
 * it was made from: the values the view's filters ask for (and the group it
 * was added to). Filters that don't name one value (contains, above,
 * before…) seed nothing. Pure. */

type SeedDef = { key: string; type: string; config?: unknown };

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function seedFromFilters(
  filters: Filter[],
  defs: SeedDef[],
  me: string | null | undefined,
  now: Date = new Date(),
): Record<string, unknown> {
  const seed: Record<string, unknown> = {};
  const typeOf = (k: string) => defs.find((d) => d.key === k)?.type;
  for (const f of filters) {
    const k = f.prop;
    // Built-ins (@created, …) and unknown properties can't be set.
    if (!k || k.startsWith("@") || !typeOf(k)) continue;
    // Worked-out properties (a relation's far side, rollups) can't be set.
    if (isComputedDef(defs.find((d) => d.key === k))) continue;
    const t = typeOf(k);
    switch (f.op) {
      case "eq":
        if (f.value === undefined) break;
        seed[k] =
          t === "checkbox"
            ? String(f.value) === "true"
            : t === "number"
              ? Number(f.value)
              : f.value;
        break;
      case "is_me":
        if (me) seed[k] = t === "multi_select" ? [me] : me;
        break;
      case "includes": {
        const prev = Array.isArray(seed[k]) ? (seed[k] as unknown[]) : [];
        if (f.value !== undefined && !prev.includes(f.value)) seed[k] = [...prev, f.value];
        break;
      }
      case "unchecked":
        if (t === "checkbox") seed[k] = false;
        break;
      case "date_is": {
        if (t !== "date") break;
        const v = String(f.value ?? "");
        if (v === "today" || v === "tomorrow") seed[k] = rangeOf(v, now)![0];
        else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) seed[k] = v;
        else if (v === "this_week" || v === "next_7" || v === "upcoming") seed[k] = localDay(now);
        break;
      }
      default:
        break;
    }
  }
  return seed;
}

/** The value a page added to a group gets for the grouped property. */
export function seedForGroup(
  key: string | null | undefined,
  value: string | null,
  defs: SeedDef[],
): Record<string, unknown> {
  if (!key || key.startsWith("@") || value === null) return {};
  const def = defs.find((d) => d.key === key);
  const t = def?.type;
  if (!t || isComputedDef(def)) return {};
  if (t === "checkbox") return { [key]: value === "true" };
  if (t === "multi_select") return { [key]: [value] };
  return { [key]: value };
}
