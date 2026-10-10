/* Property kinds — what a team can create, and the rules for the new
 * link / email / phone values.
 *
 * Pure: no React, no Supabase. The value checks mirror validate_page_props
 * in the database (migration 20261010015844_custom_properties), so a value
 * the UI accepts is never rejected on save. */

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "status"
  | "multi_select"
  | "person"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "links";

export type PropertyKind = {
  type: PropertyType;
  label: string;
  hint: string;
  /** 15px single-path icon (RowMenu `icon`). */
  icon: string;
};

/** The types offered when creating a property, in menu order. */
export const PROPERTY_KINDS: PropertyKind[] = [
  { type: "text", label: "Text", hint: "A line of text", icon: "M5 6h14M12 6v13" },
  { type: "number", label: "Number", hint: "Counts, amounts", icon: "M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" },
  { type: "select", label: "Select", hint: "One option from a list", icon: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.5 12l2.5 2.5 4.5-5" },
  { type: "status", label: "Status", hint: "Where something stands", icon: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 3.5v17" },
  { type: "multi_select", label: "Multi-select", hint: "Several tags", icon: "M4 7h10M4 12h16M4 17h7" },
  { type: "person", label: "Person", hint: "Someone in the workspace", icon: "M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.6v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" },
  { type: "date", label: "Date", hint: "A day", icon: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4" },
  { type: "checkbox", label: "Checkbox", hint: "Yes or no", icon: "M5 5h14v14H5zM8.5 12l2.5 2.5 4.5-5" },
  { type: "url", label: "Link", hint: "A web address", icon: "M10.5 13.5a3.4 3.4 0 0 0 4.8 0l3-3a3.4 3.4 0 0 0-4.8-4.8l-1 1M13.5 10.5a3.4 3.4 0 0 0-4.8 0l-3 3a3.4 3.4 0 0 0 4.8 4.8l1-1" },
  { type: "email", label: "Email", hint: "An email address", icon: "M4 6h16v12H4zM4 7l8 6 8-6" },
  { type: "phone", label: "Phone", hint: "A phone number", icon: "M6.6 3.5h2.8l1.4 4.2-2 1.4a11 11 0 0 0 6.1 6.1l1.4-2 4.2 1.4v2.8a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" },
  { type: "links", label: "Related pages", hint: "Links to pages or URLs", icon: "M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" },
];

export function kindLabel(type: string): string {
  return PROPERTY_KINDS.find((k) => k.type === type)?.label ?? type;
}

/** A database key for a new property: lowercase, starts with a letter,
 *  letters/digits/underscores, at most 31 characters (property_defs.key
 *  check), and not already taken. */
export function keyForLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(base)) base = "p_" + base;
  base = base.replace(/_+$/g, "").slice(0, 28) || "prop";
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const k = `${base.slice(0, 31 - String(i).length - 1)}_${i}`;
    if (!used.has(k)) return k;
  }
  return `${base.slice(0, 20)}_${Date.now().toString(36)}`.slice(0, 31);
}

export type CheckResult = { ok: true; value: string } | { ok: false; error: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[0-9 ().-]{4,32}$/;

/** Check (and lightly normalise) a link / email / phone value before saving.
 *  Mirrors the database rules; messages are written for the person typing. */
export function checkTypedValue(type: string, raw: string): CheckResult {
  const v = raw.trim();
  if (type === "url") {
    if (!v) return { ok: false, error: "Paste or type a link." };
    if (/\s/.test(v)) return { ok: false, error: "A link can't contain spaces." };
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
    if (withScheme.length > 2048) return { ok: false, error: "That link is too long." };
    if (!/^(https?|mailto|tel):/i.test(withScheme)) {
      return { ok: false, error: "Use a web link (https://…)." };
    }
    if (/^https?:/i.test(withScheme)) {
      try {
        const u = new URL(withScheme);
        if (!u.hostname.includes(".") && u.hostname !== "localhost") {
          return { ok: false, error: "That doesn't look like a web address." };
        }
      } catch {
        return { ok: false, error: "That doesn't look like a web address." };
      }
    }
    return { ok: true, value: withScheme };
  }
  if (type === "email") {
    const e = v.replace(/^mailto:/i, "");
    if (!EMAIL_RE.test(e)) return { ok: false, error: "That doesn't look like an email address." };
    return { ok: true, value: e };
  }
  if (type === "phone") {
    const p = v.replace(/^tel:/i, "");
    if (!PHONE_RE.test(p)) {
      return { ok: false, error: "Use digits, spaces, + ( ) - and . only." };
    }
    return { ok: true, value: p };
  }
  return { ok: true, value: v };
}

/** Where a link / email / phone value goes when opened. */
export function hrefFor(type: string, value: string): string | null {
  if (!value) return null;
  if (type === "url") {
    // Only web, mail and phone links open; anything else written through
    // the API (data:, javascript:, …) stays plain text.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return `https://${value}`;
    return /^(https?|mailto|tel):/i.test(value) ? value : null;
  }
  if (type === "email") return `mailto:${value}`;
  if (type === "phone") return `tel:${value.replace(/[^0-9+]/g, "")}`;
  return null;
}

/** Short display text: a link shows its host and path without the scheme. */
export function displayFor(type: string, value: string): string {
  if (type !== "url") return value;
  return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** Types whose values are a typed string (link, email, phone). */
export function isTypedString(type: string | undefined): type is "url" | "email" | "phone" {
  return type === "url" || type === "email" || type === "phone";
}
