/**
 * filter-label — the SINGLE source of filter chip text.
 *
 * Every filter chip in the product must go through `filterLabel`. Curly
 * quotes, lowercase property names, no operator jargon.
 *
 * The replacement rule for adding a filter (`applyFilterReplacement`) also
 * lives here so both the picker and any programmatic caller share one path.
 */
import type { Filter } from "./run-view";

/** Just enough profile shape to render "owner is {full_name}". */
export type ProfileForFilterLabel = {
  id: string;
  full_name: string | null;
};

export type FilterLabelCtx = {
  people: ProfileForFilterLabel[];
  staleDays: number;
};

export function filterLabel(f: Filter, ctx: FilterLabelCtx): string {
  switch (f.op) {
    case "eq":
      return f.prop === "owner"
        ? `owner is ${
            ctx.people.find((p) => p.id === f.value)?.full_name ?? "someone"
          }`
        : `${f.prop} is \u201C${f.value}\u201D`;
    case "includes":
      return `tagged \u201C${f.value}\u201D`;
    case "is_me":
      return "owner is you";
    case "not_empty":
      return `has a ${f.prop}`;
    case "stale":
      return `not verified in ${ctx.staleDays}+ days`;
    case "edited_within":
      return `edited in the last ${f.value} days`;
    default:
      return "";
  }
}

/**
 * Adding a filter removes any existing filter with the same prop+op —
 * EXCEPT op "includes", which accumulates. Exact rule per B1 spec §3.
 */
export function applyFilterReplacement(prev: Filter[], picked: Filter): Filter[] {
  return prev
    .filter(
      (f) =>
        !(f.prop === picked.prop && f.op === picked.op) || f.op === "includes",
    )
    .concat([picked]);
}
