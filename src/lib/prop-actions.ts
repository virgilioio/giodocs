/* Setting a property from a menu — the row ⋯ menu and the bulk bar.
 *
 * Every database has its own properties (AGENTS.md, Product model), so the
 * menus never look for a property by name ("status", "owner"): they offer
 * each property a menu can set, by TYPE, and build the value rows from the
 * property's own options. One builder for both surfaces, so they can't
 * drift. Pure: returns MenuRow data, no React. */

import type { MenuRow } from "@/components/row-menu";

export type ActionDef = {
  key: string;
  label: string | null;
  type: string;
  options?: unknown;
  archived_at?: string | null;
};

export type ActionMember = {
  user_id: string;
  profiles: {
    full_name: string | null;
    email: string | null;
    avatar_tint: string | null;
    avatar_ink: string | null;
  } | null;
};

type Opt = { value: string; label: string; tint?: string; ink?: string };

/** The types a menu can set in one pick. */
const SETTABLE = new Set(["status", "select", "person", "multi_select", "checkbox"]);

/** The properties a menu offers, in the database's order: settable types,
 *  not archived, never a built-in ("@edited"…). */
export function actionableDefs<D extends ActionDef>(defs: D[]): D[] {
  return defs.filter((d) => SETTABLE.has(d.type) && !d.archived_at && !d.key.startsWith("@"));
}

export function optionsOf(def: ActionDef): Opt[] {
  const raw = Array.isArray(def.options) ? (def.options as unknown[]) : [];
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({
      value: String(o.value ?? ""),
      label: typeof o.label === "string" && o.label ? o.label : String(o.value ?? ""),
      tint: typeof o.tint === "string" ? o.tint : undefined,
      ink: typeof o.ink === "string" ? o.ink : undefined,
    }))
    .filter((o) => o.value);
}

const nameOf = (m: ActionMember) => m.profiles?.full_name || m.profiles?.email || "Someone";
const initials = (m: ActionMember) =>
  nameOf(m)
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** The menu row that opens a property's value list, e.g. "Status · Doing". */
export function actionLabel(def: ActionDef): string {
  const name = def.label || def.key;
  return def.type === "multi_select" ? `Add ${name}` : name;
}

/** What a value reads as, for hints and toasts. */
export function valueLabel(def: ActionDef, value: unknown, members: ActionMember[]): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (def.type === "checkbox") return value === true ? "Checked" : "Unchecked";
  if (def.type === "person") {
    const m = members.find((x) => x.user_id === value);
    return m ? nameOf(m) : "someone";
  }
  if (Array.isArray(value)) return value.map((v) => valueLabel(def, v, members)).join(", ");
  const hit = optionsOf(def).find((o) => o.value === value);
  return hit?.label ?? String(value);
}

/**
 * The value rows for one property. `current` marks the checked row (pass
 * undefined for a selection with mixed values). `pick(value, label)` gets
 * the value to WRITE: for a multi-select that is the single option to add —
 * the caller merges it into each page's list.
 */
export function valueRows(
  def: ActionDef,
  current: unknown,
  members: ActionMember[],
  pick: (value: unknown, label: string) => void,
  extraValues: string[] = [],
): MenuRow[] {
  const clear = (label: string): MenuRow => ({
    kind: "row",
    label,
    icon: "clear",
    onPick: () => pick(null, "empty"),
  });
  switch (def.type) {
    case "checkbox":
      return [
        { kind: "row", label: "Checked", checked: current === true, onPick: () => pick(true, "Checked") },
        { kind: "row", label: "Unchecked", checked: current === false, onPick: () => pick(false, "Unchecked") },
      ];
    case "person": {
      const rows: MenuRow[] = members.map((m) => ({
        kind: "row",
        label: nameOf(m),
        person: {
          initials: initials(m),
          tint: `var(--color-${m.profiles?.avatar_tint ?? "sunken"})`,
          ink: `var(--color-${m.profiles?.avatar_ink ?? "body"})`,
        },
        checked: current === m.user_id,
        onPick: () => pick(m.user_id, nameOf(m)),
      }));
      return [...rows, { kind: "sep" }, clear(`Clear ${def.label || def.key}`)];
    }
    case "multi_select": {
      const opts = optionsOf(def);
      const known = new Set(opts.map((o) => o.value));
      const extra = extraValues.filter((v) => v && !known.has(v)).sort();
      const have = Array.isArray(current) ? (current as unknown[]) : [];
      return [
        ...opts.map<MenuRow>((o) => ({
          kind: "row",
          label: o.label,
          dot: `var(--color-${o.ink ?? "muted"})`,
          checked: have.includes(o.value),
          onPick: () => pick(o.value, o.label),
        })),
        ...extra.map<MenuRow>((v) => ({
          kind: "row",
          label: v,
          icon: "tag",
          checked: have.includes(v),
          onPick: () => pick(v, v),
        })),
      ];
    }
    default: {
      const rows = optionsOf(def).map<MenuRow>((o) => ({
        kind: "row",
        label: o.label,
        dot: `var(--color-${o.ink ?? "muted"})`,
        checked: current === o.value,
        onPick: () => pick(o.value, o.label),
      }));
      return [...rows, { kind: "sep" }, clear(`Clear ${def.label || def.key}`)];
    }
  }
}

/** A multi-select pick adds to the list; everything else replaces. */
export function nextValue(def: ActionDef, existing: unknown, picked: unknown): unknown {
  if (def.type !== "multi_select" || picked === null) return picked;
  const arr = Array.isArray(existing) ? existing.filter((x): x is string => typeof x === "string") : [];
  return typeof picked === "string" && !arr.includes(picked) ? [...arr, picked] : arr;
}

/** The icon for a property's menu row. */
export function actionIcon(def: ActionDef): string {
  switch (def.type) {
    case "person":
      return "person";
    case "multi_select":
      return "tag";
    case "checkbox":
      return "shield";
    default:
      return "dot";
  }
}
