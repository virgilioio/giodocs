/* One-line text for a property value, for the collapsed property strip.
 *
 * Pure: no React, no Supabase. Returns null when the value is empty, so the
 * caller can skip it. Option values show their label, people their name,
 * dates in short form, lists joined, links as a count. */

export type SummaryDef = {
  type: string;
  options?: unknown;
};

type Opt = { value?: unknown; label?: unknown };

function optionLabel(def: SummaryDef | undefined, v: string): string {
  const opts = Array.isArray(def?.options) ? (def!.options as Opt[]) : [];
  const hit = opts.find((o) => o && o.value === v);
  return typeof hit?.label === "string" && hit.label ? hit.label : v;
}

function shortDate(v: string): string {
  // Date-only values ("2026-10-09") are calendar days, not instants: read
  // them in local time so they never shift a day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function summarizeProp(
  value: unknown,
  def: SummaryDef | undefined,
  label: string,
  personName: (id: string) => string | null,
): string | null {
  if (value === null || value === undefined) return null;
  const type = def?.type ?? "text";
  switch (type) {
    case "checkbox":
      return value === true ? label : null;
    case "multi_select": {
      if (!Array.isArray(value) || value.length === 0) return null;
      return value
        .filter((x): x is string => typeof x === "string")
        .map((x) => optionLabel(def, x))
        .join(", ");
    }
    case "links": {
      if (!Array.isArray(value) || value.length === 0) return null;
      return value.length === 1 ? "1 link" : `${value.length} links`;
    }
    case "person": {
      if (typeof value !== "string" || !value) return null;
      return personName(value);
    }
    case "date":
      return typeof value === "string" && value ? shortDate(value) : null;
    case "number":
      return typeof value === "number" ? value.toLocaleString() : null;
    case "select":
    case "status":
      return typeof value === "string" && value ? optionLabel(def, value) : null;
    default: {
      if (typeof value !== "string") return null;
      const s = value.trim();
      return s ? s : null;
    }
  }
}
