import { parseTyped } from "./prop-actions";
import { personIds } from "./person-value";
import { toDateValue, toDueString } from "./due-date";

/* A table cell as text and back (2026-10-30): what copying cells puts on
 * the clipboard, and what pasting, filling right or typing a value across
 * columns writes. Pure. The rules follow the cells' own: a date is read as
 * the date field reads it, a link as the link field checks it. */

/** The title column's key (view-config's TITLE_KEY). */
const TITLE = "title";

export type CellOption = { value: string; label?: string };
export type CellPerson = { id: string; name: string; email: string };

/** Types a paste or fill can write. Everything else (formulas, rollups,
 *  IDs, relations, files, the built-in columns) is worked out or needs its
 *  own picker, so it's skipped. */
const WRITABLE = new Set([
  "text",
  "number",
  "date",
  "checkbox",
  "select",
  "status",
  "multi_select",
  "person",
  "url",
  "email",
  "phone",
]);

export function cellWritable(key: string, type: string | undefined): boolean {
  if (key === TITLE) return true;
  if (key.startsWith("@")) return false;
  return !!type && WRITABLE.has(type);
}

const YES = new Set(["yes", "true", "1", "x", "✓", "✔", "checked", "done", "y", "on"]);
const NO = new Set(["no", "false", "0", "", "unchecked", "n", "off", "☐"]);

export type TextCtx = {
  options?: CellOption[];
  people?: CellPerson[];
};

/** A stored value as one line of text. */
export function cellText(
  key: string,
  type: string | undefined,
  raw: unknown,
  ctx: TextCtx = {},
): string {
  if (raw === null || raw === undefined) return "";
  if (key === TITLE) return String(raw);
  switch (type) {
    case "checkbox":
      return raw === true || raw === "true" ? "Yes" : "No";
    case "select":
    case "status": {
      const o = ctx.options?.find((x) => x.value === raw);
      return o?.label ?? String(raw);
    }
    case "multi_select":
      return Array.isArray(raw) ? raw.map(String).join(", ") : String(raw);
    case "person":
      // Someone no longer in the workspace reads "Unknown" in the cell:
      // their id is no use to a spreadsheet, so they're left out.
      return personIds(raw)
        .map((id) => ctx.people?.find((p) => p.id === id)?.name ?? "")
        .filter(Boolean)
        .join(", ");
    case "number":
      return typeof raw === "number" ? String(raw) : String(raw);
    default:
      return typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(", ") : String(raw);
  }
}

export type ParseCtx = TextCtx & {
  /** Whoever pastes, for "me". */
  me?: string;
  /** A person property that holds one person. */
  onePerson?: boolean;
  today?: Date;
};

export type ParseResult =
  | { ok: true; value: unknown }
  /** A select's value that isn't an option yet: the caller may add it. */
  | { ok: "new-option"; label: string }
  | { ok: false; reason: string };

/** Text pasted or filled into a column, as the value it stores. Empty text
 *  empties the cell. */
export function parseCell(
  key: string,
  type: string | undefined,
  text: string,
  ctx: ParseCtx = {},
): ParseResult {
  const t = text.trim();
  if (key === TITLE) return { ok: true, value: t };
  if (!cellWritable(key, type))
    return { ok: false, reason: "worked out, or set with its own picker" };
  switch (type) {
    case "text":
      return { ok: true, value: t || null };
    case "checkbox": {
      const w = t.toLowerCase();
      if (YES.has(w)) return { ok: true, value: true };
      if (NO.has(w)) return { ok: true, value: false };
      return { ok: false, reason: "not yes or no" };
    }
    case "date": {
      if (!t) return { ok: true, value: null };
      const range = /^(\d{4}-\d{2}-\d{2})\s*(?:\/|–|—|\s-\s|→)\s*(\d{4}-\d{2}-\d{2})$/.exec(t);
      if (range && toDueString(range[1]) && toDueString(range[2]))
        return { ok: true, value: toDateValue(range[1], range[2]) };
      const r = parseTyped({ key, type, label: key }, t, ctx.today);
      return r.ok ? { ok: true, value: r.value } : { ok: false, reason: "not a date" };
    }
    case "number":
    case "url":
    case "email":
    case "phone": {
      // A number may arrive formatted ("$1,200", "12%").
      const src = type === "number" ? t.replace(/^[$€£¥]\s*|\s*%$/g, "") : t;
      const r = parseTyped({ key, type, label: key }, src, ctx.today);
      return r.ok
        ? { ok: true, value: r.value }
        : {
            ok: false,
            reason: `not ${type === "email" ? "an email" : type === "url" ? "a link" : `a ${type}`}`,
          };
    }
    case "select":
    case "status": {
      if (!t) return { ok: true, value: null };
      const w = t.toLowerCase();
      const o = ctx.options?.find(
        (x) => (x.label ?? x.value).toLowerCase() === w || x.value.toLowerCase() === w,
      );
      if (o) return { ok: true, value: o.value };
      return type === "select"
        ? { ok: "new-option", label: t.slice(0, 60) }
        : { ok: false, reason: "not one of its statuses" };
    }
    case "multi_select": {
      const parts = [
        ...new Set(
          t
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      return { ok: true, value: parts };
    }
    case "person": {
      if (!t) return { ok: true, value: ctx.onePerson ? null : [] };
      const ids: string[] = [];
      for (const part of t
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        const w = part.toLowerCase();
        const p =
          (w === "me" && ctx.me ? { id: ctx.me } : null) ??
          ctx.people?.find((x) => x.name.toLowerCase() === w || x.email.toLowerCase() === w);
        if (!p) return { ok: false, reason: "not someone in this workspace" };
        if (!ids.includes(p.id)) ids.push(p.id);
      }
      if (ctx.onePerson)
        return ids.length > 1
          ? { ok: false, reason: "holds one person" }
          : { ok: true, value: ids[0] };
      return { ok: true, value: ids };
    }
  }
  return { ok: false, reason: "can't be pasted into" };
}

/** Two columns hold the same kind of value, so a value moves between them
 *  as it is (a status keeps its option, a person their id). */
export function sameKind(
  a: { key: string; type?: string },
  b: { key: string; type?: string },
): boolean {
  if (a.key === TITLE || b.key === TITLE) return a.key === b.key;
  if (a.type !== b.type) return false;
  // Options belong to their property.
  if (a.type === "select" || a.type === "status") return a.key === b.key;
  return true;
}
