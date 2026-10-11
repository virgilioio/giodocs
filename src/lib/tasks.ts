/* Task databases and My tasks (Home). A database becomes a task database
 * by naming three of its properties (pages.task_config, checked by the
 * guard_task_config trigger): what says a task is done, who it's assigned
 * to and when it's due. Pure helpers, tested apart from the screens. */

import { addDaysKey, dateSpan } from "./due-date";

export type TaskConfig = {
  /** A status, select or checkbox property. */
  done: string;
  /** For a status or select: the options that count as done. */
  done_values?: string[];
  /** A person property. */
  assignee: string;
  /** A date property. */
  due: string;
};

export type TaskDefLike = {
  key: string;
  label: string;
  type: string;
  database_id: string | null;
  archived_at?: string | null;
  options?: unknown;
};

export const DONE_TYPES = ["status", "select", "checkbox"] as const;

/** Reads pages.task_config defensively; null when it isn't one. */
export function readTaskConfig(raw: unknown): TaskConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.done !== "string" || typeof r.assignee !== "string" || typeof r.due !== "string") {
    return null;
  }
  const dv = Array.isArray(r.done_values)
    ? r.done_values.filter((x): x is string => typeof x === "string")
    : undefined;
  return { done: r.done, assignee: r.assignee, due: r.due, ...(dv ? { done_values: dv } : {}) };
}

type Opt = { value: string; label: string };
export function optionList(def: { options?: unknown } | undefined): Opt[] {
  const raw = def?.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({
      value: String(o.value ?? o.label ?? ""),
      label: String(o.label ?? o.value ?? ""),
    }))
    .filter((o) => o.value);
}

const DONE_WORDS = /^(done|complete|completed|finished|closed|shipped|resolved|live|hired|published)$/i;

/** The options that look finished, by name. */
export function suggestDoneValues(def: { options?: unknown } | undefined): string[] {
  // A status says which of its options are Complete (status-groups.ts);
  // the names decide for anything not grouped.
  const raw = Array.isArray(def?.options) ? (def!.options as Array<{ value?: string; group?: unknown }>) : [];
  return optionList(def)
    .filter((o) => {
      const g = raw.find((r) => r && r.value === o.value)?.group;
      if (g === "todo" || g === "doing") return false;
      return g === "done" || DONE_WORDS.test(o.label.trim()) || DONE_WORDS.test(o.value.trim());
    })
    .map((o) => o.value);
}

function pick<D extends TaskDefLike>(defs: D[], types: readonly string[], prefer: RegExp): D | undefined {
  const fit = defs.filter((d) => types.includes(d.type));
  return fit.find((d) => prefer.test(d.label)) ?? fit[0];
}

/** A first guess at a database's task settings from its live properties.
 *  Missing kinds are left empty for the person to add. */
export function suggestTaskConfig<D extends TaskDefLike>(
  databaseId: string,
  defs: D[],
): { done?: string; done_values: string[]; assignee?: string; due?: string } {
  const own = defs.filter((d) => d.database_id === databaseId && !d.archived_at);
  const done =
    pick(own, ["status"], /status|state/i) ??
    pick(own, ["select"], /status|state|stage/i) ??
    pick(own, ["checkbox"], /done|complete/i);
  const assignee = pick(own, ["person"], /assign/i) ?? pick(own, ["person"], /owner/i);
  const due = pick(own, ["date"], /due|deadline|date/i);
  return {
    done: done?.key,
    done_values: done && done.type !== "checkbox" ? suggestDoneValues(done) : [],
    assignee: assignee?.key,
    due: due?.key,
  };
}

/** Whether a row's done property says it's finished. */
export function isTaskDone(value: unknown, doneType: string, cfg: TaskConfig): boolean {
  if (doneType === "checkbox") return value === true;
  return typeof value === "string" && (cfg.done_values ?? []).includes(value);
}

/** The value that marks a task done, and the one that reopens it. */
export function doneValueFor(doneType: string, cfg: TaskConfig): unknown {
  if (doneType === "checkbox") return true;
  return cfg.done_values?.[0] ?? null;
}

/** Whether a person property holds this person (one id, or a list). */
export function assignedTo(value: unknown, userId: string): boolean {
  if (typeof value === "string") return value === userId;
  if (Array.isArray(value)) return value.includes(userId);
  return false;
}

export type TaskBucket = "overdue" | "today" | "week" | "later" | "none";

export const BUCKET_LABELS: Record<TaskBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  later: "Later",
  none: "No date",
};

export const BUCKET_ORDER: TaskBucket[] = ["overdue", "today", "week", "later", "none"];

/** Local "YYYY-MM-DD" for a moment. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Which group a due date falls in. A range is overdue once its end has
 *  passed and due today while today is inside it. */
export function taskBucket(due: unknown, today: string): TaskBucket {
  const s = dateSpan(due);
  if (!s) return "none";
  if (s.end < today) return "overdue";
  if (s.start <= today) return "today";
  if (s.start <= addDaysKey(today, 7)) return "week";
  return "later";
}

export type TaskRow<P> = {
  page: P;
  databaseId: string;
  due: unknown;
  bucket: TaskBucket;
};

type PageLike = {
  id: string;
  title?: string | null;
  database_id?: string | null;
  is_database?: boolean;
  props?: unknown;
  task_config?: unknown;
};

/** The open tasks assigned to a person across every task database they
 *  can open, in groups by due date, soonest first. */
export function myTasks<P extends PageLike>(
  pages: readonly P[],
  defs: readonly TaskDefLike[],
  userId: string,
  today: string,
  opts: { databases?: ReadonlySet<string> } = {},
): TaskRow<P>[] {
  const typeOf = new Map(defs.filter((d) => !d.archived_at).map((d) => [`${d.database_id}:${d.key}`, d.type]));
  const configs = new Map<string, { cfg: TaskConfig; doneType: string }>();
  for (const p of pages) {
    if (!p.is_database) continue;
    const cfg = readTaskConfig(p.task_config);
    if (!cfg) continue;
    if (opts.databases && !opts.databases.has(p.id)) continue;
    const doneType = typeOf.get(`${p.id}:${cfg.done}`);
    if (!doneType) continue;
    configs.set(p.id, { cfg, doneType });
  }
  const out: TaskRow<P>[] = [];
  for (const p of pages) {
    const c = p.database_id ? configs.get(p.database_id) : undefined;
    if (!c) continue;
    const props = (p.props && typeof p.props === "object" ? p.props : {}) as Record<string, unknown>;
    if (!assignedTo(props[c.cfg.assignee], userId)) continue;
    if (isTaskDone(props[c.cfg.done], c.doneType, c.cfg)) continue;
    const due = props[c.cfg.due];
    out.push({ page: p, databaseId: p.database_id!, due, bucket: taskBucket(due, today) });
  }
  const startOf = (v: unknown) => dateSpan(v)?.start ?? "9999";
  out.sort(
    (a, b) =>
      BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) ||
      startOf(a.due).localeCompare(startOf(b.due)) ||
      (a.page.title ?? "").localeCompare(b.page.title ?? ""),
  );
  return out;
}
