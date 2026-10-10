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

/** Enough of a property definition to name it and its options. */
export type DefForFilterLabel = {
  key: string;
  label: string;
  type: string;
  options?: unknown;
};

export type FilterLabelCtx = {
  people: ProfileForFilterLabel[];
  staleDays: number;
  /** When given, properties read by their name and options by their
   *  label ("hiring manager is Ana", "priority is “High”"). */
  defs?: DefForFilterLabel[];
};

function optionLabel(def: DefForFilterLabel | undefined, v: unknown): string {
  const opts = Array.isArray(def?.options)
    ? (def!.options as Array<{ value?: unknown; label?: unknown }>)
    : [];
  const hit = opts.find((o) => o && o.value === v);
  return typeof hit?.label === "string" && hit.label ? hit.label : String(v);
}

export function filterLabel(f: Filter, ctx: FilterLabelCtx): string {
  const def = ctx.defs?.find((d) => d.key === f.prop);
  const name = def ? def.label.toLowerCase() : (f.prop ?? "");
  const person = (id: unknown) =>
    ctx.people.find((p) => p.id === id)?.full_name ?? "someone";
  switch (f.op) {
    case "eq":
      if (f.prop === "owner") return `owner is ${person(f.value)}`;
      if (def?.type === "person") return `${name} is ${person(f.value)}`;
      if (def?.type === "checkbox") return String(f.value) === "true" ? `${name} is checked` : `${name} is not checked`;
      return `${def ? name : f.prop} is \u201C${def ? optionLabel(def, f.value) : f.value}\u201D`;
    case "includes":
      if (f.prop === "tags" || !def) return `tagged \u201C${f.value}\u201D`;
      return `${name} includes \u201C${f.value}\u201D`;
    case "is_me":
      return f.prop === "owner" || !def ? "owner is you" : `${name} is you`;
    case "not_empty":
      return `has a ${def ? name : f.prop}`;
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
