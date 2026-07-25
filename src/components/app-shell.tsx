import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import {
  useCreatePage,
  useCreateView,
  useDeleteView,
  useForkView,
  useUpdateView,
  usePublishView,
} from "@/hooks/use-page-mutations";

import { useToast } from "@/lib/toast";
import type { PageListItem } from "@/lib/types";
import { MainView } from "./main-view";
import { PageEditor } from "./page-view";

type Selection =
  | { kind: "view"; id: string }
  | { kind: "area"; area: string }
  | { kind: "page"; id: string }
  | null;

const COLLAPSE_KEY = "gio.sidebar.collapsed";
const SECTION_KEY = "gio.sidebar.sections"; // JSON { my:boolean, team:boolean, areas:boolean }

function useSelection(): Selection {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const viewParams = useParams({ strict: false }) as {
    viewId?: string;
    area?: string;
    pageId?: string;
  };
  if (pathname.startsWith("/v/") && viewParams.viewId) {
    return { kind: "view", id: viewParams.viewId };
  }
  if (pathname.startsWith("/a/") && viewParams.area) {
    return { kind: "area", area: decodeURIComponent(viewParams.area) };
  }
  if (pathname.startsWith("/p/") && viewParams.pageId) {
    return { kind: "page", id: viewParams.pageId };
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
  const propDefs = shell.propDefs.data ?? [];
  const { user, profile } = useAuth();
  const staleDays = workspace?.stale_days ?? 30;
  const memberCount = shell.members.data?.length ?? 0;
  const workspaceName = workspace?.name ?? "";

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

  const areaIcons = useMemo(() => {
    const m = new Map<string, string>();
    const def = propDefs.find((d) => d.key === "area");
    const opts = (def?.options as unknown as
      | Array<{ value: string; icon?: string }>
      | undefined) ?? [];
    for (const o of opts) if (o.icon) m.set(o.value, o.icon);
    return m;
  }, [propDefs]);

  const breadcrumb = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "view") {
      const v = views.find((x) => x.id === selection.id);
      if (!v) return null;
      const section =
        v.scope === "team" ? "Team views" : "My views";
      return { section, name: v.name };
    }
    if (selection.kind === "area") {
      return { section: "Areas", name: selection.area };
    }
    const p = pages.find((x) => x.id === selection.id);
    return { section: "Page", name: p?.title || "Untitled" };
  }, [selection, views, pages]);


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
            areaIcons={areaIcons}
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
          {breadcrumb && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-ui text-secondary">{breadcrumb.section}</span>
              <span className="text-ui text-rule">/</span>
              <span className="min-w-0 truncate text-ui text-body">
                {breadcrumb.name}
              </span>
            </div>
          )}
        </header>

        <main className="min-w-0 flex-1 bg-canvas overflow-y-auto">
          {selection && selection.kind === "page" ? (
            <PageEditor pageId={selection.id} />
          ) : selection ? (
            <MainView selection={selection} />
          ) : (
            <div className="mx-auto max-w-view px-6 py-10">
              <p className="text-meta text-muted">Loading…</p>
            </div>
          )}
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
  icon: string | null;
  owner_id: string;
};

type SectionKey = "my" | "team" | "areas";
type SectionState = Record<SectionKey, boolean>;

function useSectionState(): [SectionState, (k: SectionKey) => void] {
  const [state, setState] = useState<SectionState>(() => {
    if (typeof window === "undefined") return { my: true, team: true, areas: true };
    try {
      const raw = window.localStorage.getItem(SECTION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SectionState>;
        return {
          my: parsed.my !== false,
          team: parsed.team !== false,
          areas: parsed.areas !== false,
        };
      }
    } catch {
      /* ignore */
    }
    return { my: true, team: true, areas: true };
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SECTION_KEY, JSON.stringify(state));
    }
  }, [state]);
  const toggle = (k: SectionKey) =>
    setState((prev) => ({ ...prev, [k]: !prev[k] }));
  return [state, toggle];
}

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
  areaIcons,
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
  areaIcons: Map<string, string>;
  onSignOut: () => void;
}) {
  const [sections, toggleSection] = useSectionState();
  const { user } = useAuth();

  const personal = views
    .filter((v) => v.scope === "personal")
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const team = views
    .filter((v) => v.scope === "team")
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

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

  const renderCount = (c: number | "!", sizeClass: string) =>
    c === "!" ? (
      <span
        className={`tnum ${sizeClass} text-amberInk`}
        title="This view's filter is invalid"
      >
        !
      </span>
    ) : (
      <span className={`tnum ${sizeClass} text-whisper`}>{c}</span>
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
            <SectionHeader
              label="My views"
              open={sections.my}
              onToggle={() => toggleSection("my")}
              trailing={
                <button
                  type="button"
                  title="New view — coming soon"
                  className="grid h-5 w-5 place-items-center rounded-sm text-faint hover:bg-railHover hover:text-secondary"
                >
                  <Glyph path="M12 5v14M5 12h14" className="h-3.5 w-3.5" />
                </button>
              }
            />
            {sections.my && (
              <ul>
                {personal.map((v) => (
                  <MyViewRow
                    key={v.id}
                    v={v}
                    active={viewActive(v.id)}
                    count={countFor(v)}
                    renderCount={renderCount}
                  />
                ))}
              </ul>
            )}

            {/* Team views */}
            <SectionHeader
              label="Team views"
              open={sections.team}
              onToggle={() => toggleSection("team")}
            />
            {sections.team && (
              <>
                <ul>
                  {team.map((v) => (
                    <TeamViewRow
                      key={v.id}
                      v={v}
                      active={viewActive(v.id)}
                      count={countFor(v)}
                      renderCount={renderCount}
                    />
                  ))}
                </ul>
                <p className="px-2 pt-1 text-caption italic text-faint">
                  Published from My views — open a view's ⋯ menu.
                </p>
              </>
            )}

            {/* Areas */}
            <SectionHeader
              label="Areas"
              open={sections.areas}
              onToggle={() => toggleSection("areas")}
              trailing={
                <button
                  type="button"
                  title="New page in an area — use an area's ⋯ menu"
                  className="grid h-5 w-5 place-items-center rounded-sm text-faint hover:bg-railHover hover:text-secondary"
                >
                  <Glyph path="M12 5v14M5 12h14" className="h-3.5 w-3.5" />
                </button>
              }
            />
            {sections.areas && (
              <ul>
                {areas.map(({ area, count }) => {
                  const open = openAreas.has(area);
                  const items = areaPages.get(area) ?? [];
                  return (
                    <AreaLi
                      key={area}
                      area={area}
                      count={count}
                      icon={areaIcons.get(area)}
                      open={open}
                      onToggle={() => toggleArea(area)}
                      active={areaActive(area)}
                      items={items}
                      isStale={isStale}
                      me={user?.id ?? ""}
                    />
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Divider + aside + footer, in that order */}
      <p className="border-t border-line px-3 py-2 text-caption italic text-secondary">
        No folders. A page lives wherever its properties say it does.
      </p>

      <div className="border-t border-line px-2.5 py-2">
        <FooterAccount
          profile={profile}
          userEmail={userEmail}
          initials={initials}
          workspaceName={workspaceName}
          memberCount={memberCount}
          onSignOut={onSignOut}
        />
      </div>
    </>
  );
}

/* ─────────────────── View rows w/ hover ⋯ menus ─────────────────── */

function MyViewRow({
  v,
  active,
  count,
  renderCount,
}: {
  v: ViewRow;
  active: boolean;
  count: number | "!";
  renderCount: (c: number | "!", size: string) => ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(v.name);
  const updateView = useUpdateView();
  const createView = useCreateView();
  const deleteView = useDeleteView();
  const publishView = usePublishView();
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const wsName = shell.workspace.data?.name ?? "the workspace";
  const wsMembers = shell.members.data?.length ?? 0;
  const navigate = useNavigate();


  const showMenu = hover || menu;

  return (
    <li
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative"
    >
      <Link
        to="/v/$viewId"
        params={{ viewId: v.id }}
        style={{ height: "var(--spacing-rowMy)" }}
        className={rowClass(active)}
        onClick={(e) => {
          if (renaming) e.preventDefault();
        }}
      >
        {v.icon ? (
          <span className="text-row leading-none">{v.icon}</span>
        ) : (
          <LayoutGlyph layout={v.layout} />
        )}
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (name.trim() && name !== v.name)
                updateView.mutate({ id: v.id, patch: { name: name.trim() } });
              else setName(v.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(v.name);
                setRenaming(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-row focus:outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-row">{v.name}</span>
        )}
        <span className="relative flex h-5 min-w-[20px] items-center justify-end">
          {showMenu ? (
            <MoreButton
              open={menu}
              onOpen={() => setMenu(true)}
              onClose={() => setMenu(false)}
              menu={
                <>
                  <MenuItem
                    onClick={() => {
                      setMenu(false);
                      navigate({ to: "/v/$viewId", params: { viewId: v.id } });
                    }}
                  >
                    Open
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenu(false);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenu(false);
                      createView.mutate({
                        name: `${v.name} copy`,
                        icon: v.icon,
                        filter: (v.filter ?? []) as Filter[],
                        sort: (v.sort ?? { prop: "edited", dir: "desc" }) as SortSpec,
                        layout: v.layout,
                      });
                    }}
                  >
                    Duplicate
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenu(false);
                      if (
                        window.confirm(
                          `Publish "${v.name}" to Team views? It moves out of My views into Team views for all ${wsMembers} people at ${wsName}. Publishing is the only way a view becomes shared.`,
                        )
                      ) {
                        publishView.mutate(v.id);
                      }
                    }}
                  >
                    Publish to team
                  </MenuItem>

                  <MenuDivider />
                  <MenuItem
                    danger
                    onClick={() => {
                      setMenu(false);
                      if (window.confirm(`Delete view "${v.name}"?`)) {
                        deleteView.mutate(v.id);
                      }
                    }}
                  >
                    Delete
                  </MenuItem>
                </>
              }
            />
          ) : (
            renderCount(count, "text-row")
          )}
        </span>
      </Link>
    </li>
  );
}

function TeamViewRow({
  v,
  active,
  count,
  renderCount,
}: {
  v: ViewRow;
  active: boolean;
  count: number | "!";
  renderCount: (c: number | "!", size: string) => ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
  const fork = useForkView();
  const navigate = useNavigate();
  const showMenu = hover || menu;
  return (
    <li
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative"
    >
      <Link
        to="/v/$viewId"
        params={{ viewId: v.id }}
        style={{ height: "var(--spacing-rowTeam)" }}
        className={rowClass(active)}
      >
        <Glyph
          path="M8 12a3 3 0 100-6 3 3 0 000 6zm8 0a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 6-5s6 2 6 5m2 0c0-2 2-4 4-4s4 2 4 4"
          className="h-3.5 w-3.5 shrink-0 text-muted"
        />
        <span className="min-w-0 flex-1 truncate text-meta text-secondary">
          {v.name}
        </span>
        <span className="relative flex h-5 min-w-[20px] items-center justify-end">
          {showMenu ? (
            <MoreButton
              open={menu}
              onOpen={() => setMenu(true)}
              onClose={() => setMenu(false)}
              menu={
                <>
                  <MenuItem
                    onClick={() => {
                      setMenu(false);
                      navigate({ to: "/v/$viewId", params: { viewId: v.id } });
                    }}
                  >
                    Open
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenu(false);
                      fork.mutate({
                        viewId: v.id,
                        name: `${v.name} copy`,
                        filter: (v.filter ?? []) as Filter[],
                        sort: (v.sort ?? { prop: "edited", dir: "desc" }) as SortSpec,
                        layout: v.layout,
                      });
                    }}
                  >
                    Duplicate into My views
                  </MenuItem>
                </>
              }
            />
          ) : (
            renderCount(count, "text-meta")
          )}
        </span>
      </Link>
    </li>
  );
}

function AreaLi({
  area,
  count,
  icon,
  open,
  onToggle,
  active,
  items,
  isStale,
  me: _me,
}: {
  area: string;
  count: number;
  icon: string | undefined;
  open: boolean;
  onToggle: () => void;
  active: boolean;
  items: PageListItem[];
  isStale: (p: PageListItem) => boolean;
  me: string;
}) {
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
  const createPage = useCreatePage();
  const createView = useCreateView();
  const navigate = useNavigate();
  const showMenu = hover || menu;

  return (
    <li
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Collapse ${area}` : `Expand ${area}`}
          className="grid h-6 w-6 place-items-center rounded-sm text-muted hover:bg-railHover"
        >
          <Glyph
            path="M9 6l6 6-6 6"
            className="h-3.5 w-3.5"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          />
        </button>
        <Link
          to="/a/$area"
          params={{ area }}
          style={{ height: "var(--spacing-rowArea)" }}
          className={
            "flex flex-1 items-center gap-2 rounded-md px-1 " +
            (active
              ? "bg-selected font-bold text-noir"
              : "text-body hover:bg-railHover")
          }
        >
          {icon && <span className="text-row leading-none">{icon}</span>}
          <span className="min-w-0 flex-1 truncate text-row">{area}</span>
          <span className="relative flex h-5 min-w-[20px] items-center justify-end">
            {showMenu ? (
              <MoreButton
                open={menu}
                onOpen={() => setMenu(true)}
                onClose={() => setMenu(false)}
                width={240}
                menu={
                  <>
                    <div className="px-2 py-1 text-label uppercase text-faint">
                      {area} · {count} {count === 1 ? "PAGE" : "PAGES"}
                    </div>
                    <MenuDivider />
                    <MenuItem
                      right={<span className="text-caption text-faint">↵</span>}
                      onClick={() => {
                        setMenu(false);
                        navigate({ to: "/a/$area", params: { area } });
                      }}
                    >
                      Open area
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setMenu(false);
                        if (!open) onToggle();
                      }}
                    >
                      Show pages
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setMenu(false);
                        createPage.mutate({ seedProps: { area } });
                      }}
                    >
                      New page here
                    </MenuItem>
                    <MenuItem
                      disabled
                      title="Coming soon — rewrites the property on every page"
                    >
                      Rename area
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem
                      right={
                        <span className="text-caption text-faint">personal</span>
                      }
                      onClick={() => {
                        setMenu(false);
                        createView.mutate({
                          name: area,
                          filter: [{ op: "eq", prop: "area", value: area }],
                          sort: { prop: "edited", dir: "desc" },
                          layout: "table",
                        });
                      }}
                    >
                      Save as my view
                    </MenuItem>
                  </>
                }
              />
            ) : (
              <span className="tnum text-row text-whisper">{count}</span>
            )}
          </span>
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
              onClick={() => createPage.mutate({ seedProps: { area } })}
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
}

/* ─────────────────── Footer + account dropdown ─────────────────── */

function FooterAccount({
  profile,
  userEmail,
  initials,
  workspaceName,
  memberCount,
  onSignOut,
}: {
  profile: { full_name: string; avatar_tint: string; avatar_ink: string } | null;
  userEmail: string;
  initials: string;
  workspaceName: string;
  memberCount: number;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const wsInitial = workspaceName ? workspaceName[0].toUpperCase() : "?";

  return (
    <div ref={wrapRef} className="relative">
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
            {memberCount ? ` · ${memberCount} people` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Account menu"
          aria-expanded={open}
          className="grid h-7 w-7 place-items-center rounded-md text-secondary hover:bg-railHover hover:text-strong"
        >
          <Glyph
            path="M7 15l5-5 5 5M7 9l5 5 5-5"
            className="h-4 w-4"
          />
        </button>
      </div>

      {open && (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-line bg-surface p-1 shadow-popover animate-popIn"
        >
          {/* Workspace card */}
          <div className="flex items-center gap-2 rounded-lg px-2 py-2">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sunken text-row font-bold text-noir"
              aria-hidden
            >
              {wsInitial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-row font-bold text-noir">
                {workspaceName}
              </div>
              <div className="truncate text-caption text-muted">
                MVP plan · {memberCount} members
              </div>
            </div>
          </div>
          <MenuDivider />
          <MenuItem
            disabled
            title="Coming soon"
            right={<span className="font-mono text-caption text-faint">⌘,</span>}
          >
            Settings
          </MenuItem>
          <MenuItem disabled title="Coming soon">
            Invite members
          </MenuItem>
          <MenuDivider />
          <div className="px-2 py-1 text-caption text-muted truncate">
            {userEmail}
          </div>
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-row text-body">
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-sunken text-caption font-bold text-noir"
              aria-hidden
            >
              {wsInitial}
            </span>
            <span className="min-w-0 flex-1 truncate">{workspaceName}</span>
            <Glyph path="M5 12l5 5 9-11" className="h-3.5 w-3.5 text-accent" />
          </div>
          <MenuDivider />
          <MenuItem
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Log out
          </MenuItem>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Menu primitives ─────────────────── */

function MoreButton({
  open,
  onOpen,
  onClose,
  menu,
  width = 200,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  menu: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open ? onClose() : onOpen();
        }}
        className="grid h-5 w-5 place-items-center rounded-sm text-secondary hover:bg-railHover hover:text-strong"
      >
        <Glyph
          path="M6 12a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2z"
          className="h-4 w-4"
        />
      </button>
      {open && (
        <div
          style={{ width }}
          className="absolute right-0 top-full z-40 mt-1 rounded-lg border border-line bg-surface p-1 shadow-popover animate-popIn"
          onClick={(e) => e.stopPropagation()}
        >
          {menu}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  right,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  right?: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      }}
      className={
        "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-row " +
        (disabled
          ? "cursor-not-allowed text-faint"
          : danger
            ? "text-danger hover:bg-dangerTint"
            : "text-body hover:bg-rail")
      }
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-lineSoft" />;
}

function rowClass(active: boolean) {
  return (
    "flex items-center gap-2 rounded-md px-2 " +
    (active ? "bg-selected font-bold text-noir" : "text-body hover:bg-railHover")
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
  trailing,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="mt-4 flex items-center justify-between px-2 pb-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
        className="flex items-center gap-1 text-label uppercase text-faint hover:text-secondary"
      >
        <Glyph
          path="M6 9l6 6 6-6"
          className="h-3 w-3"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        {label}
      </button>
      {trailing}
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
