import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useCreatePage, useSetPageProperty } from "@/hooks/use-page-mutations";
import { useToast } from "@/lib/toast";
import { setPageOrigin } from "@/lib/page-origin";
import { dueLabel } from "@/lib/due-date";
import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  dayKey,
  doneValueFor,
  myTasks,
  readTaskConfig,
  type TaskBucket,
  type TaskDefLike,
} from "@/lib/tasks";
import type { PageListItem } from "@/lib/types";
import { Ico } from "./emoji-icon";

/* My tasks (Notion's Home): the open rows of every task database the
 * person can open that are assigned to them, grouped by when they're due.
 * Ticking one marks it done (with Undo); a filter narrows it to one
 * database; a task can be added straight from here. */

const SHOW = 12;

export function MyTasks({ now }: { now: Date }) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const { user } = useAuth();
  const me = user?.id ?? "";
  const navigate = useNavigate();
  const toast = useToast();
  const setProp = useSetPageProperty();
  const createPage = useCreatePage();

  const pages = useMemo(() => (shell.pages.data ?? []) as PageListItem[], [shell.pages.data]);
  const defs = useMemo(() => (shell.propDefs.data ?? []) as unknown as TaskDefLike[], [shell.propDefs.data]);
  const taskDbs = useMemo(
    () => pages.filter((p) => p.is_database && readTaskConfig(p.task_config)),
    [pages],
  );
  const [onlyDb, setOnlyDb] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState("");
  const filterDb = onlyDb && taskDbs.some((d) => d.id === onlyDb) ? onlyDb : null;

  const today = dayKey(now);
  const rows = useMemo(
    () =>
      myTasks(pages, defs, me, today, filterDb ? { databases: new Set([filterDb]) } : {}),
    [pages, defs, me, today, filterDb],
  );
  const dbName = (id: string) => pages.find((p) => p.id === id)?.title?.trim() || "Untitled";
  const typeOf = (dbId: string, key: string) =>
    defs.find((d) => d.database_id === dbId && d.key === key && !d.archived_at)?.type ?? "";

  if (!shell.pages.data || !shell.propDefs.data) return null;

  if (taskDbs.length === 0) {
    return (
      <p className="text-meta text-muted">
        Open a database's ⋯ menu and choose Turn into task database. Its rows assigned to you show here
        until they're done.
      </p>
    );
  }

  const complete = (p: PageListItem, dbId: string) => {
    const db = pages.find((x) => x.id === dbId);
    const cfg = readTaskConfig(db?.task_config);
    if (!cfg) return;
    const doneType = typeOf(dbId, cfg.done);
    const value = doneValueFor(doneType, cfg);
    if (value === null) {
      toast.push(`"${dbName(dbId)}" has no option that counts as done. Pick one in its task settings.`);
      return;
    }
    const before = ((p.props ?? {}) as Record<string, unknown>)[cfg.done] ?? null;
    const title = p.title?.trim() || "Untitled";
    setProp.mutate(
      { pageId: p.id, key: cfg.done, value, quiet: true },
      {
        onSuccess: () =>
          toast.push({
            message: `Marked "${title}" done.`,
            action: {
              label: "Undo",
              onClick: () => setProp.mutate({ pageId: p.id, key: cfg.done, value: before, quiet: true }),
            },
          }),
      },
    );
  };

  const addTask = () => {
    const title = draft.trim();
    if (!title) return;
    const dbId = filterDb ?? taskDbs[0].id;
    const cfg = readTaskConfig(taskDbs.find((d) => d.id === dbId)?.task_config);
    if (!cfg) return;
    setDraft("");
    createPage.mutate(
      { title, parentId: dbId, seedProps: { [cfg.assignee]: me }, quiet: true },
      { onSuccess: () => toast.push(`Added "${title}" to "${dbName(dbId)}".`) },
    );
  };

  const shown = showAll ? rows : rows.slice(0, SHOW);
  const groups = BUCKET_ORDER.map((b) => ({ b, items: shown.filter((r) => r.bucket === b) })).filter(
    (g) => g.items.length > 0,
  );
  const addTo = filterDb ?? taskDbs[0].id;

  return (
    <div>
      {taskDbs.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Show tasks from">
          {[{ id: null as string | null, title: "All" }, ...taskDbs.map((d) => ({ id: d.id as string | null, title: d.title?.trim() || "Untitled" }))].map((d) => {
            const on = filterDb === d.id;
            return (
              <button
                key={d.id ?? "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setOnlyDb(d.id)}
                className={`rounded-md px-2 text-meta ${on ? "bg-selected text-strong" : "text-secondary hover:bg-sunken"}`}
                style={{ height: 26 }}
              >
                {d.title}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-xl border border-line bg-surface">
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-meta text-muted">
            Nothing assigned to you is open{filterDb ? ` in "${dbName(filterDb)}"` : ""}.
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.b} aria-label={BUCKET_LABELS[g.b]}>
              <h3
                className={`px-4 pb-1 pt-2.5 text-caption font-bold ${g.b === "overdue" ? "text-danger" : "text-muted"}`}
              >
                {BUCKET_LABELS[g.b]}
                <span className="tnum ml-1.5 font-normal text-faint">
                  {rows.filter((r) => r.bucket === g.b).length}
                </span>
              </h3>
              <ul>
                {g.items.map((r) => (
                  <TaskLine
                    key={r.page.id}
                    page={r.page}
                    dbName={taskDbs.length > 1 && !filterDb ? dbName(r.databaseId) : null}
                    due={r.due}
                    bucket={r.bucket}
                    now={now}
                    onDone={() => complete(r.page, r.databaseId)}
                    onOpen={() => {
                      setPageOrigin(r.page.id, { kind: "search" });
                      void navigate({ to: "/p/$pageId", params: { pageId: r.page.id } });
                    }}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
        {rows.length > SHOW ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full px-4 py-2 text-left text-meta text-muted hover:bg-track hover:text-strong"
          >
            {showAll ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        ) : null}
        <form
          className="flex items-center gap-2 border-t border-lineSoft px-4"
          style={{ height: 40 }}
          onSubmit={(e) => {
            e.preventDefault();
            addTask();
          }}
        >
          <span aria-hidden className="text-muted">
            +
          </span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Add a task to "${dbName(addTo)}"`}
            aria-label={`Add a task to ${dbName(addTo)}`}
            className="min-w-0 flex-1 bg-transparent text-ui text-body outline-none placeholder:text-faint"
          />
        </form>
      </div>
    </div>
  );
}

function TaskLine({
  page,
  dbName,
  due,
  bucket,
  now,
  onDone,
  onOpen,
}: {
  page: PageListItem;
  dbName: string | null;
  due: unknown;
  bucket: TaskBucket;
  now: Date;
  onDone: () => void;
  onOpen: () => void;
}) {
  const title = page.title?.trim() || "Untitled";
  const d = dueLabel(due, now);
  return (
    <li className="group/task flex items-center gap-2.5 px-4 hover:bg-track" style={{ minHeight: 36 }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={false}
        aria-label={`Mark "${title}" done`}
        title="Mark done"
        onClick={onDone}
        className="gio-press grid shrink-0 place-items-center rounded border border-lineStrong bg-surface text-transparent hover:border-accent hover:text-accent"
        style={{ width: 16, height: 16 }}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
        <Ico icon={page.icon || "📄"} size={16} />
        <span className="min-w-0 truncate text-ui text-body group-hover/task:text-strong">{title}</span>
        {dbName ? <span className="shrink-0 truncate text-caption text-faint" style={{ maxWidth: 160 }}>{dbName}</span> : null}
      </button>
      {d.text ? (
        <span className={`tnum shrink-0 text-caption ${bucket === "overdue" ? "text-danger" : "text-muted"}`}>
          {d.text}
        </span>
      ) : null}
    </li>
  );
}
