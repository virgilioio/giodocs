/* The "@" menu: when it opens, and what it offers. Pure. */

export type MentionCandidate =
  | { kind: "user"; id: string; name: string }
  | { kind: "page"; id: string; title: string; icon: string | null };

/** "@" at the start of the text or after a space or "(", then up to 30
 *  characters with no line break or bracket. An e-mail address ("a@b")
 *  never opens it. */
export function shouldOpenMentionTrigger(before: string): { open: boolean; at: number; query: string } {
  const NO = { open: false, at: -1, query: "" };
  const at = before.lastIndexOf("@");
  if (at < 0) return NO;
  if (at > 0 && !/[\s(]/.test(before[at - 1])) return NO;
  const query = before.slice(at + 1);
  if (query.length > 30) return NO;
  if (/[\n[\]()]/.test(query)) return NO;
  if (/^\s/.test(query)) return NO;
  // Three words at most: past that it's a sentence, not a name.
  if (query.split(/\s+/).filter(Boolean).length > 3 || /\s{2,}/.test(query)) return NO;
  return { open: true, at, query };
}

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** 0 = no match; higher is better. A word that starts with the query beats
 *  a match in the middle of a word. */
function score(text: string, query: string): number {
  const t = fold(text);
  const q = fold(query.trim());
  if (!q) return 1;
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s\-_/.]+/).some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

export function mentionCandidates(
  query: string,
  users: ReadonlyMap<string, string>,
  pages: ReadonlyMap<string, { title: string; icon: string | null }>,
  opts: { meId?: string | null; maxUsers?: number; maxPages?: number } = {},
): MentionCandidate[] {
  const maxUsers = opts.maxUsers ?? 5;
  const maxPages = opts.maxPages ?? 6;
  const people: Array<{ c: MentionCandidate; s: number }> = [];
  for (const [id, name] of users) {
    const s = score(name, query);
    if (s > 0) people.push({ c: { kind: "user", id, name }, s: s + (id === opts.meId ? -0.5 : 0) });
  }
  people.sort((a, b) => b.s - a.s || (a.c as { name: string }).name.localeCompare((b.c as { name: string }).name));
  const docs: Array<{ c: MentionCandidate; s: number; i: number }> = [];
  let i = 0;
  for (const [id, p] of pages) {
    const s = score(p.title || "Untitled", query);
    if (s > 0) docs.push({ c: { kind: "page", id, title: p.title, icon: p.icon }, s, i: i++ });
  }
  // Ties keep the directory's order (most recently edited first).
  docs.sort((a, b) => b.s - a.s || a.i - b.i);
  return [...people.slice(0, maxUsers).map((x) => x.c), ...docs.slice(0, maxPages).map((x) => x.c)];
}
