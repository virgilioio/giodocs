/**
 * Compute the footer text for an area-row menu. The rule (spec):
 *
 *   "Newest edit {rel} by {firstName} · {k} needs re-verifying"
 *
 * with these corrections:
 *  - Drop clause 2 entirely when k === 0.
 *  - Pluralise the verb: 1 needs / N need.
 *  - When there are no pages, or no `edited_at` at all, return an empty
 *    string — the caller omits the footer.
 *  - Missing member name falls back to the empty first name; the "by …"
 *    fragment is dropped in that case.
 */

import { formatTimestamp } from "./format";

export type AreaFooterPage = {
  edited_at: string | null;
  edited_by: string | null;
};

export type AreaFooterMember = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

function firstNameOf(m: AreaFooterMember | undefined): string {
  if (!m) return "";
  const raw = m.full_name || m.email || "";
  if (!raw) return "";
  // Prefer the leading token of full name; for emails, use the local part.
  const local = m.full_name ? raw : raw.split("@")[0] ?? raw;
  return local.trim().split(/\s+/)[0] ?? "";
}

export function areaMenuFooter(input: {
  pages: ReadonlyArray<AreaFooterPage>;
  members: ReadonlyArray<AreaFooterMember>;
  needsReverify: number;
}): string {
  const { pages, members, needsReverify } = input;
  if (pages.length === 0) return "";

  // Pick the freshest edit.
  let newest: AreaFooterPage | null = null;
  for (const p of pages) {
    if (!p.edited_at) continue;
    if (!newest || p.edited_at > newest.edited_at!) newest = p;
  }
  if (!newest || !newest.edited_at) return "";

  const rel = formatTimestamp(newest.edited_at, "relative");
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const first = newest.edited_by ? firstNameOf(memberById.get(newest.edited_by)) : "";

  const clause1 = first ? `Newest edit ${rel} by ${first}` : `Newest edit ${rel}`;
  if (needsReverify <= 0) return clause1;
  const verb = needsReverify === 1 ? "needs" : "need";
  return `${clause1} · ${needsReverify} ${verb} re-verifying`;
}
