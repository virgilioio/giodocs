/* Status groups (Notion's To-do / In progress / Complete). An option says
 * its group (set from the column menu, set_property_option_group); an
 * option that hasn't been grouped is placed by its name. "Complete" is
 * what makes a row finished: its overdue dates stop warning, and a task
 * database counts it done. */

export type StatusGroup = "todo" | "doing" | "done";

export const GROUP_LABELS: Record<StatusGroup, string> = {
  todo: "To-do",
  doing: "In progress",
  done: "Complete",
};

const DONE = /^(done|complete|completed|finished|closed|shipped|resolved|live|hired|published|cancell?ed|archived)$/i;
const DOING = /(progress|doing|review|working|active|started|blocked|waiting|testing|qa)/i;

type OptionLike = { value?: string; label?: string; group?: unknown };

export function groupOf(o: OptionLike): StatusGroup {
  if (o.group === "todo" || o.group === "doing" || o.group === "done") return o.group;
  const name = (o.label ?? o.value ?? "").trim();
  if (DONE.test(name) || DONE.test((o.value ?? "").trim())) return "done";
  if (/^(not|to)\b/i.test(name)) return "todo";
  if (DOING.test(name)) return "doing";
  return "todo";
}

/** The group of a status value, given its property's options. */
export function groupOfValue(value: unknown, options: unknown): StatusGroup | null {
  if (typeof value !== "string" || !value) return null;
  const list = Array.isArray(options) ? (options as OptionLike[]) : [];
  const o = list.find((x) => x && x.value === value);
  return groupOf(o ?? { value, label: value });
}

type DefLike = { key: string; type: string; options?: unknown; archived_at?: string | null };

/** Whether a row is finished: one of its database's statuses is in the
 *  Complete group. */
export function isFinished(props: Record<string, unknown>, defs: Iterable<DefLike>): boolean {
  for (const d of defs) {
    if (d.type !== "status" || d.archived_at) continue;
    if (groupOfValue(props[d.key], d.options) === "done") return true;
  }
  return false;
}
