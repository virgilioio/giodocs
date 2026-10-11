import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useTemplates, useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useViewRuntime } from "@/hooks/use-view-runtime";
import { useHomePrefs, useSaveHomePrefs } from "@/hooks/use-home";
import { useNewPageFromTemplate } from "@/hooks/use-templates";
import { useCreatePageAndOpen } from "@/hooks/use-page-mutations";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import { HOME_SECTIONS, recentlyUpdated, toggleHidden, togglePinned } from "@/lib/home";
import { useFormatDate } from "@/lib/format";
import { setPageOrigin } from "@/lib/page-origin";
import { useToast } from "@/lib/toast";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";
import { SpecMenuTrigger, type MenuSpec } from "./row-menu";
import { Ico } from "./emoji-icon";

/* Home's further sections: pinned views, what changed lately, templates,
 * quick links, and the menu that shows or hides each section. */

type ViewRow = Database["public"]["Tables"]["views"]["Row"];

const ROWS_PER_VIEW = 5;

/* ─────────────── Customize ─────────────── */

export function CustomizeHome() {
  const prefsQ = useHomePrefs();
  const save = useSaveHomePrefs();
  const build = (hidden: string[], mctx: { setSpec: (s: MenuSpec) => void }): MenuSpec => ({
    title: "Show on Home",
    rows: HOME_SECTIONS.map((s) => ({
      kind: "row" as const,
      label: s.label,
      checked: !hidden.includes(s.id),
      onPick: () => {
        const next = toggleHidden(hidden, s.id);
        save.mutate({ hidden: next });
        mctx.setSpec(build(next, mctx));
      },
    })),
    footer: "Only you see these. Where the app opens is in Settings › Preferences.",
  });
  return (
    <SpecMenuTrigger
      size="toolbar"
      ariaLabel="Customize Home"
      build={(mctx) => build(prefsQ.data?.hidden ?? [], mctx)}
    />
  );
}

/* ─────────────── Pinned views ─────────────── */

export function PinnedViews() {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const prefsQ = useHomePrefs();
  const ids = prefsQ.data?.pinned_views ?? [];
  const views = useMemo(() => (shell.views.data ?? []) as ViewRow[], [shell.views.data]);
  const pinned = ids
    .map((id) => views.find((v) => v.id === id))
    .filter((v): v is ViewRow => !!v);

  if (pinned.length === 0) {
    return (
      <p className="text-meta text-muted">
        Pin a view to see its first rows here: open the view's ⋯ menu and choose Pin to Home.
      </p>
    );
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
      {pinned.map((v) => (
        <PinnedViewCard key={v.id} view={v} />
      ))}
    </div>
  );
}

function PinnedViewCard({ view }: { view: ViewRow }) {
  const rt = useViewRuntime(view.database_id);
  const navigate = useNavigate();
  const prefsQ = useHomePrefs();
  const save = useSaveHomePrefs();
  const toast = useToast();
  const rows = useMemo(
    () =>
      runView(
        rt.pages,
        {
          filter: (view.filter ?? []) as Filter[],
          sort: (view.sort ?? { prop: "edited", dir: "desc" }) as SortSpec | SortSpec[],
        },
        rt.runCtx,
      ),
    [rt.pages, view.filter, view.sort, rt.runCtx],
  );
  const dbTitle = rt.database?.title?.trim() || "Untitled";
  const unpin = () => {
    const before = prefsQ.data?.pinned_views ?? [];
    save.mutate({ pinned_views: togglePinned(before, view.id) });
    toast.push({
      message: `Unpinned "${view.name}" from Home.`,
      action: { label: "Undo", onClick: () => save.mutate({ pinned_views: before }) },
    });
  };
  return (
    <section aria-label={`${view.name} in ${dbTitle}`} className="flex flex-col rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-lineSoft px-3.5" style={{ height: 40 }}>
        <Ico icon={rt.database?.icon || "🗂️"} size={16} />
        <Link
          to="/p/$pageId"
          params={{ pageId: view.database_id }}
          search={{ v: view.id }}
          className="min-w-0 flex-1 truncate text-ui font-bold text-strong hover:underline"
        >
          {view.name}
          <span className="ml-1.5 font-normal text-faint">{dbTitle}</span>
        </Link>
        <span className="tnum text-caption text-faint">{rows.length}</span>
        <button
          type="button"
          onClick={unpin}
          aria-label={`Unpin ${view.name} from Home`}
          title="Unpin from Home"
          className="grid place-items-center rounded-md text-whisper hover:bg-sunken hover:text-strong"
          style={{ width: 24, height: 24 }}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="px-3.5 py-3 text-meta text-muted">No rows match this view.</p>
      ) : (
        <ul className="py-1">
          {rows.slice(0, ROWS_PER_VIEW).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setPageOrigin(p.id, { kind: "database", databaseId: view.database_id, viewId: view.id, name: view.name });
                  void navigate({ to: "/p/$pageId", params: { pageId: p.id } });
                }}
                className="flex w-full items-center gap-2 px-3.5 text-left hover:bg-track"
                style={{ height: 32 }}
              >
                <Ico icon={p.icon || "📄"} size={15} />
                <span className="min-w-0 truncate text-ui text-body">{p.title?.trim() || "Untitled"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > ROWS_PER_VIEW ? (
        <Link
          to="/p/$pageId"
          params={{ pageId: view.database_id }}
          search={{ v: view.id }}
          className="mt-auto border-t border-lineSoft px-3.5 py-2 text-meta text-muted hover:bg-track hover:text-strong"
        >
          Open the view ({rows.length - ROWS_PER_VIEW} more)
        </Link>
      ) : null}
    </section>
  );
}

/* ─────────────── Recently updated ─────────────── */

export function RecentlyUpdated() {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const { user } = useAuth();
  const navigate = useNavigate();
  const fmt = useFormatDate();
  const pages = useMemo(() => (shell.pages.data ?? []) as PageListItem[], [shell.pages.data]);
  const list = useMemo(() => recentlyUpdated(pages), [pages]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (shell.members.data ?? []) as unknown as Array<{
      user_id: string;
      profiles: { full_name: string | null; email: string | null } | null;
    }>) {
      m.set(r.user_id, r.profiles?.full_name?.trim().split(/\s+/)[0] || r.profiles?.email?.split("@")[0] || "Someone");
    }
    return m;
  }, [shell.members.data]);

  if (!shell.pages.data) return null;
  if (list.length === 0) return <p className="text-meta text-muted">Nothing has changed yet.</p>;
  return (
    <ul className="rounded-xl border border-line bg-surface py-1">
      {list.map((p) => {
        const who = p.edited_by === user?.id ? "you" : (p.edited_by && names.get(p.edited_by)) || "someone";
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => {
                setPageOrigin(p.id, { kind: "search" });
                void navigate({ to: "/p/$pageId", params: { pageId: p.id } });
              }}
              className="flex w-full items-center gap-2.5 px-4 text-left hover:bg-track"
              style={{ height: 36 }}
            >
              <Ico icon={p.icon || (p.is_database ? "🗂️" : "📄")} size={16} />
              <span className="min-w-0 flex-1 truncate text-ui text-body">{p.title?.trim() || "Untitled"}</span>
              <span className="shrink-0 text-caption text-faint">
                {p.edited_at ? `${fmt(p.edited_at)} by ${who}` : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ─────────────── Templates ─────────────── */

export function TemplatesSection() {
  const ws = useWorkspaceId();
  const q = useTemplates(ws);
  const start = useNewPageFromTemplate();
  const shell = useWorkspaceShell(ws);
  if (!q.data) return null;
  if (q.data.length === 0) {
    return (
      <p className="text-meta text-muted">
        Make any page a template from its ⋯ menu (Use as template), and start new pages from it here.
      </p>
    );
  }
  const dbName = (id: string | null) =>
    id ? ((shell.pages.data ?? []) as PageListItem[]).find((p) => p.id === id)?.title?.trim() || "Untitled" : null;
  return (
    <div className="flex flex-wrap gap-2">
      {q.data.slice(0, 8).map((t) => {
        const where = dbName(t.database_id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => void start(t.id)}
            title={where ? `New row of ${where} from this template` : "New page from this template"}
            className="gio-press flex items-center gap-2 rounded-lg border border-line bg-surface px-3 text-left hover:bg-track"
            style={{ height: 36, maxWidth: 280 }}
          >
            <Ico icon={t.icon || "📄"} size={16} />
            <span className="min-w-0 truncate text-ui text-body">{t.title?.trim() || "Untitled"}</span>
            {where ? <span className="shrink-0 truncate text-caption text-faint" style={{ maxWidth: 100 }}>{where}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────── Quick links ─────────────── */

export function QuickLinks({
  onOpenPalette,
  onOpenSettings,
}: {
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}) {
  const createAndOpen = useCreatePageAndOpen();
  const items: Array<{ label: string; icon: string; hint?: string; run: () => void }> = [
    { label: "New page", icon: "M7 3h7l5 5v13H7zM14 3v5h5", run: () => void createAndOpen({ seedProps: {} }) },
    {
      label: "New database",
      icon: "M4 5h16v14H4zM4 10h16M10 10v9",
      run: () => void createAndOpen({ seedProps: {}, isDatabase: true }),
    },
    { label: "Search", icon: "M11 4a7 7 0 100 14 7 7 0 000-14zm5.5 12.5l4 4", hint: "⌘K", run: onOpenPalette },
    {
      label: "Settings",
      icon: "M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
      hint: "⌘,",
      run: onOpenSettings,
    },
  ];
  return (
    <nav aria-label="Quick links" className="flex flex-wrap gap-2">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={it.run}
          className="gio-press flex items-center gap-2 rounded-lg border border-line bg-surface px-3 text-ui text-body hover:bg-track"
          style={{ height: 34 }}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-muted">
            <path d={it.icon} />
          </svg>
          {it.label}
          {it.hint ? <span className="font-mono text-caption text-faint">{it.hint}</span> : null}
        </button>
      ))}
    </nav>
  );
}
