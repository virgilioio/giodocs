import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import type { PageListItem } from "@/lib/types";

type Selection =
  | { kind: "view"; id: string }
  | { kind: "area"; area: string }
  | null;

const COLLAPSE_KEY = "gio.sidebar.collapsed";

function useSelection(): Selection {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const viewParams = useParams({ strict: false }) as {
    viewId?: string;
    area?: string;
  };
  if (pathname.startsWith("/v/") && viewParams.viewId) {
    return { kind: "view", id: viewParams.viewId };
  }
  if (pathname.startsWith("/a/") && viewParams.area) {
    return { kind: "area", area: decodeURIComponent(viewParams.area) };
  }
  return null;
}

export function AppShell() {
  const workspaceId = useWorkspaceId();
  const shell = useWorkspaceShell(workspaceId);
  const selection = useSelection();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    }
  }, [collapsed]);

  const pages = (shell.pages.data ?? []) as PageListItem[];
  const views = shell.views.data ?? [];
  const workspace = shell.workspace.data;
  const { user, profile } = useAuth();
  const staleDays = workspace?.stale_days ?? 30;
  const memberCount = shell.members.data?.length ?? 0;
  const workspaceName = workspace?.name ?? "";

  // Default redirect on "/" — pick first personal view (by position, then name).
  useEffect(() => {
    if (selection !== null) return;
    if (shell.views.isLoading) return;
    const first = [...views]
      .filter((v) => v.scope === "personal")
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))[0];
    if (first) {
      navigate({ to: "/v/$viewId", params: { viewId: first.id }, replace: true });
    }
  }, [selection, views, shell.views.isLoading, navigate]);

  const ctx = useMemo(
    () => ({ me: user?.id ?? "", staleDays }),
    [user?.id, staleDays],
  );

  const breadcrumb = useMemo(() => {
    if (!selection) return "";
    if (selection.kind === "view") {
      return views.find((v) => v.id === selection.id)?.name ?? "";
    }
    return selection.area;
  }, [selection, views]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  const initials = (profile?.full_name || user?.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const loading =
    shell.pages.isLoading || shell.views.isLoading || shell.workspace.isLoading;

  return (
    <div className="flex min-h-screen bg-canvas">
      <div
        style={{
          width: collapsed ? 0 : "var(--spacing-sidebar)",
          transition: "width 180ms ease",
        }}
        className="shrink-0 overflow-hidden border-r border-line bg-rail"
      >
        <div
          style={{ width: "var(--spacing-sidebar)" }}
          className="flex h-screen flex-col"
        >
          <SidebarBody
            loading={loading}
            pages={pages}
            views={views}
            ctx={ctx}
            selection={selection}
            profile={profile}
            userEmail={user?.email ?? ""}
            initials={initials}
            workspaceName={workspaceName}
            memberCount={memberCount}
            onSignOut={handleSignOut}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          style={{ height: "var(--spacing-topbar)" }}
          className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3"
        >
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid h-7 w-7 place-items-center rounded-md text-secondary hover:bg-rail hover:text-strong"
          >
            <Glyph path="M4 6h16M4 12h16M4 18h16" />
          </button>
          <span className="text-ui text-body">{breadcrumb}</span>
        </header>

        <main className="min-w-0 flex-1 bg-canvas">
          <div className="mx-auto max-w-view px-6 py-10">
            <p className="text-label uppercase text-faint">
              {selection?.kind === "area" ? "Area" : "View"}
            </p>
            <h1 className="mt-2 font-display text-title text-noir">
              {breadcrumb || "—"}
            </h1>
            <p className="mt-3 text-meta text-muted">
              Table, board and list rendering land in the next phase.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

type ViewRow = {
  id: string;
  name: string;
  scope: "personal" | "team";
  layout: "table" | "board" | "list";
  position: number;
  filter: unknown;
  sort: unknown;
};

function SidebarBody({
  loading,
  pages,
  views,
  ctx,
  selection,
  profile,
  userEmail,
  initials,
  workspaceName,
  memberCount,
  onSignOut,
}: {
  loading: boolean;
  pages: PageListItem[];
  views: ViewRow[];
  ctx: { me: string; staleDays: number };
  selection: Selection;
  profile: { full_name: string; avatar_tint: string; avatar_ink: string } | null;
  userEmail: string;
  initials: string;
  workspaceName: string;
  memberCount: number;
  onSignOut: () => void;
}) {
  const personal = views
    .filter((v) => v.scope === "personal")
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const team = views
    .filter((v) => v.scope === "team")
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  // Derived areas + stale-page lookup, all from the pages cache.
  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pages) {
      const props =
        p.props && typeof p.props === "object" && !Array.isArray(p.props)
          ? (p.props as Record<string, unknown>)
          : {};
      const a = props.area;
      if (typeof a === "string" && a) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return Array.from(counts, ([area, count]) => ({ area, count })).sort((a, b) =>
      a.area.localeCompare(b.area),
    );
  }, [pages]);

  const areaPages = useMemo(() => {
    const m = new Map<string, PageListItem[]>();
    for (const p of pages) {
      const props =
        p.props && typeof p.props === "object" && !Array.isArray(p.props)
          ? (p.props as Record<string, unknown>)
          : {};
      const a = props.area;
      if (typeof a === "string" && a) {
        const arr = m.get(a) ?? [];
        arr.push(p);
        m.set(a, arr);
      }
    }
    for (const [, arr] of m) {
      arr.sort((x, y) => (x.title ?? "").localeCompare(y.title ?? ""));
    }
    return m;
  }, [pages]);

  const staleThreshold = Date.now() - ctx.staleDays * 24 * 60 * 60 * 1000;
  const isStale = (p: PageListItem) =>
    new Date(p.verified_at).getTime() < staleThreshold;

  const countFor = (v: ViewRow): number | "!" => {
    try {
      return runView(
        pages,
        {
          filter: (v.filter ?? []) as Filter[],
          sort: (v.sort ?? { prop: "edited", dir: "desc" }) as SortSpec,
        },
        ctx,
      ).length;
    } catch (err) {
      console.error(`[view ${v.id} "${v.name}"] invalid filter:`, err);
      return "!";
    }
  };

  const renderCount = (c: number | "!") =>
    c === "!" ? (
      <span
        className="tnum text-whisper text-amberInk"
        title="This view's filter is invalid"
      >
        !
      </span>
    ) : (
      <span className="tnum text-whisper">{c}</span>
    );

  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set());
  const toggleArea = (a: string) =>
    setOpenAreas((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });

  const viewActive = (id: string) =>
    selection?.kind === "view" && selection.id === id;
  const areaActive = (a: string) =>
    selection?.kind === "area" && selection.area === a;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-3">
        {/* Search */}
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-ui text-secondary hover:bg-railHover"
        >
          <Glyph path="M11 4a7 7 0 100 14 7 7 0 000-14zm5.5 12.5l4 4" className="h-4 w-4 text-muted" />
          <span className="flex-1 text-left">Search</span>
          <span className="rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-label text-muted">
            ⌘K
          </span>
        </button>

        {loading ? (
          <SkeletonList />
        ) : (
          <>
            {/* My views */}
            <SectionHeader label="My views">
              <button
                type="button"
                title="New view — coming soon"
                className="grid h-5 w-5 place-items-center rounded-sm text-faint hover:bg-railHover hover:text-secondary"
              >
                <Glyph path="M12 5v14M5 12h14" className="h-3.5 w-3.5" />
              </button>
            </SectionHeader>
            <ul>
              {personal.map((v) => (
                <li key={v.id}>
                  <Link
                    to="/v/$viewId"
                    params={{ viewId: v.id }}
                    style={{ height: "var(--spacing-rowMy)" }}
                    className={rowClass(viewActive(v.id))}
                  >
                    <LayoutGlyph layout={v.layout} />
                    <span className="min-w-0 flex-1 truncate text-row">{v.name}</span>
                    {renderCount(countFor(v))}
                  </Link>
                </li>
              ))}
            </ul>

            {/* Team views */}
            <SectionHeader label="Team views" />
            <ul>
              {team.map((v) => (
                <li key={v.id}>
                  <Link
                    to="/v/$viewId"
                    params={{ viewId: v.id }}
                    style={{ height: "var(--spacing-rowTeam)" }}
                    className={rowClass(viewActive(v.id))}
                  >
                    <Glyph
                      path="M8 12a3 3 0 100-6 3 3 0 000 6zm8 0a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 6-5s6 2 6 5m2 0c0-2 2-4 4-4s4 2 4 4"
                      className="h-3.5 w-3.5 shrink-0 text-muted"
                    />
                    <span className="min-w-0 flex-1 truncate text-meta text-secondary">
                      {v.name}
                    </span>
                    {renderCount(countFor(v))}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="px-2 pt-1 text-caption italic text-faint">
              Published from My views
            </p>

            {/* Areas */}
            <SectionHeader label="Areas" />
            <ul>
              {areas.map(({ area, count }) => {
                const open = openAreas.has(area);
                const items = areaPages.get(area) ?? [];
                return (
                  <li key={area}>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => toggleArea(area)}
                        aria-label={open ? `Collapse ${area}` : `Expand ${area}`}
                        className="grid h-6 w-6 place-items-center rounded-sm text-muted hover:bg-railHover"
                      >
                        <Glyph
                          path="M9 6l6 6-6 6"
                          className="h-3.5 w-3.5"
                          style={{
                            transform: open ? "rotate(90deg)" : "rotate(0deg)",
                          }}
                        />
                      </button>
                      <Link
                        to="/a/$area"
                        params={{ area }}
                        style={{ height: "var(--spacing-rowArea)" }}
                        className={
                          "flex flex-1 items-center gap-2 rounded-md px-1 " +
                          (areaActive(area)
                            ? "bg-selected font-bold text-noir"
                            : "text-body hover:bg-railHover")
                        }
                      >
                        <span className="min-w-0 flex-1 truncate text-row">
                          {area}
                        </span>
                        <span className="tnum text-whisper">{count}</span>
                      </Link>
                    </div>
                    {open && (
                      <ul className="ml-6">
                        {items.map((p) => (
                          <li key={p.id}>
                            <div
                              style={{ height: "var(--spacing-rowPage)" }}
                              className="flex cursor-default items-center gap-2 rounded-md px-2 text-meta text-secondary hover:bg-railHover"
                            >
                              {isStale(p) && (
                                <span
                                  aria-label="Stale"
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-amberDot"
                                />
                              )}
                              <span className="min-w-0 flex-1 truncate">
                                {p.title || "Untitled"}
                              </span>
                            </div>
                          </li>
                        ))}
                        <li>
                          <button
                            type="button"
                            title="Coming soon"
                            style={{ height: "var(--spacing-rowPage)" }}
                            className="flex w-full items-center gap-2 rounded-md px-2 text-meta text-faint hover:bg-railHover"
                          >
                            <Glyph path="M12 5v14M5 12h14" className="h-3 w-3" />
                            <span>New page</span>
                          </button>
                        </li>
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-line px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-label"
            style={{
              background: profile?.avatar_tint ?? "var(--color-sunken)",
              color: profile?.avatar_ink ?? "var(--color-noir)",
            }}
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-row text-body">
              {profile?.full_name || userEmail}
            </div>
            <div className="truncate text-caption text-muted">
              {workspaceName}
              {memberCount ? ` · ${memberCount} members` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            className="grid h-7 w-7 place-items-center rounded-md text-secondary hover:bg-railHover hover:text-strong"
          >
            <Glyph
              path="M15 4v-1a2 2 0 00-2-2H5a2 2 0 00-2 2v16a2 2 0 002 2h8a2 2 0 002-2v-1M10 12h11m0 0l-4-4m4 4l-4 4"
              className="h-4 w-4"
            />
          </button>
        </div>
      </div>
      <p className="border-t border-line px-3 py-2 text-caption italic text-secondary">
        No folders. A page lives wherever its properties say it does.
      </p>
    </>
  );
}

function rowClass(active: boolean) {
  return (
    "flex items-center gap-2 rounded-md px-2 " +
    (active ? "bg-selected font-bold text-noir" : "text-body hover:bg-railHover")
  );
}

function SectionHeader({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-4 flex items-center justify-between px-2 pb-1">
      <span className="text-label uppercase text-faint">{label}</span>
      {children}
    </div>
  );
}

function LayoutGlyph({ layout }: { layout: "table" | "board" | "list" }) {
  const path =
    layout === "board"
      ? "M4 5v14M10 5v14M16 5v14"
      : layout === "list"
        ? "M4 6h16M4 12h16M4 18h16"
        : "M3 6h18M3 12h18M3 18h18M9 6v12M15 6v12";
  return <Glyph path={path} className="h-3.5 w-3.5 shrink-0 text-muted" />;
}

function Glyph({
  path,
  className,
  style,
}: {
  path: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

function SkeletonList() {
  const rows = [
    "var(--spacing-rowMy)",
    "var(--spacing-rowMy)",
    "var(--spacing-rowMy)",
    "var(--spacing-rowTeam)",
    "var(--spacing-rowTeam)",
    "var(--spacing-rowArea)",
    "var(--spacing-rowArea)",
    "var(--spacing-rowArea)",
  ];
  return (
    <div className="mt-4 space-y-1.5 px-1">
      {rows.map((h, i) => (
        <div
          key={i}
          style={{ height: h }}
          className="rounded-sm bg-sunken"
          aria-hidden
        />
      ))}
    </div>
  );
}
