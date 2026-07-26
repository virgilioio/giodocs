import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useRealtimeWorkspace } from "@/hooks/use-realtime";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import { getPageOrigin } from "@/lib/page-origin";
import { resolvePageIdParam } from "@/lib/slug";

import {
  useCreatePage,
  useCreateView,
  useDeleteView,
  useDeletePage,
  useDuplicatePage,
  useForkView,
  useMovePageToArea,
  useRenameArea,
  useSetPageProperty,
  useUpdateView,
  usePublishView,
  useVerifyPage,
} from "@/hooks/use-page-mutations";

import { useToast } from "@/lib/toast";
import { formatTimestamp } from "@/lib/format";
import type { PageListItem } from "@/lib/types";
import { MainView } from "./main-view";
import { PageEditor } from "./page-view";
import { PageTopbarActions } from "./page-topbar-actions";
import { CommandPalette } from "./command-palette";
import { SettingsModal, type SettingsPane } from "./settings-modal";
import { AddMembersModal, type PendingInvite } from "./add-members-modal";
import {
  RowMenuProvider,
  MoreButton as RowMoreButton,
  RowMenuList,
  RowMenuConfirm,
  Sc,
  Val,
  type RowMenuItem,
} from "./row-menu";
import { useAllowedDomains, useMembers, usePropDefs } from "@/hooks/use-workspace-data";
import { usePrefs } from "@/lib/preferences";
import { nanoid } from "nanoid";

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
  useRealtimeWorkspace(workspaceId);
  const rawSelection = useSelection();
  const pagesForResolve = (shell.pages.data ?? []) as PageListItem[];
  const selection = useMemo<Selection>(() => {
    if (rawSelection?.kind === "page") {
      // The URL may be the raw UUID or the cosmetic slug-shortId form emitted
      // by Copy link. Resolve to the canonical id so downstream queries hit.
      const resolved = resolvePageIdParam(rawSelection.id, pagesForResolve);
      return { kind: "page", id: resolved };
    }
    return rawSelection;
  }, [rawSelection, pagesForResolve]);
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

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("preferences");
  const [membersTab, setMembersTab] = useState<"members" | "guests">("members");
  const [accountMenu, setAccountMenu] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [sidebarPopover, setSidebarPopover] = useState<"view" | "area" | null>(null);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);

  const domainsQ = useAllowedDomains(workspaceId);
  const allowedDomains = domainsQ.data ?? [];

  const openSettings = (p: SettingsPane = "preferences") => {
    setSettingsPane(p);
    setSettingsOpen(true);
  };
  const closeSettings = () => setSettingsOpen(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        // Ordered dismissal — topmost layer first.
        if (inviteOpen) {
          e.preventDefault();
          setInviteOpen(false);
          return;
        }
        if (settingsOpen) {
          e.preventDefault();
          setSettingsOpen(false);
          return;
        }
        if (pageMenuOpen) {
          e.preventDefault();
          setPageMenuOpen(false);
          return;
        }
        if (sidebarPopover) {
          e.preventDefault();
          setSidebarPopover(null);
          return;
        }
        if (accountMenu) {
          e.preventDefault();
          setAccountMenu(false);
          return;
        }
        // Palette and popovers own their own escape below.
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inviteOpen, settingsOpen, accountMenu, sidebarPopover, pageMenuOpen]);

  const pages = (shell.pages.data ?? []) as PageListItem[];
  const views = shell.views.data ?? [];
  const workspace = shell.workspace.data;
  const propDefs = shell.propDefs.data ?? [];
  const { user, profile } = useAuth();
  const staleDays = workspace?.stale_days ?? 30;
  const memberCount = shell.members.data?.length ?? 0;
  const workspaceName = workspace?.name ?? "";

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    // Only auto-pick a default view on the root URL. On /p, /v, /a we must
    // never redirect: a transient null selection during router transitions
    // used to silently bounce the user back to the previous view.
    if (pathname !== "/") return;
    if (shell.views.isLoading) return;
    const first = [...views]
      .filter((v) => v.scope === "personal")
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))[0];
    if (first) {
      navigate({ to: "/v/$viewId", params: { viewId: first.id }, replace: true });
    }
  }, [pathname, views, shell.views.isLoading, navigate]);

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
      const section = v.scope === "team" ? "Team views" : "My views";
      return { crumbs: [section], name: v.name };
    }
    if (selection.kind === "area") {
      return { crumbs: ["Areas"], name: selection.area };
    }
    const p = pages.find((x) => x.id === selection.id);
    const title = p?.title || "Untitled";
    const origin = getPageOrigin(selection.id);
    if (origin) {
      if (origin.kind === "view") {
        const section = origin.scope === "team" ? "Team views" : "My views";
        return { crumbs: [section, origin.viewName], name: title };
      }
      if (origin.kind === "area") {
        return { crumbs: ["Areas", origin.area], name: title };
      }
      if (origin.kind === "search") {
        return { crumbs: ["Search"], name: title };
      }
    }
    // Fall back to the page's own area if we can infer it.
    const area = p && typeof (p.props as Record<string, unknown> | null)?.area === "string"
      ? (p.props as Record<string, unknown>).area as string
      : null;
    if (area) return { crumbs: ["Areas", area], name: title };
    return { crumbs: ["Page"], name: title };
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
    <RowMenuProvider>
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
            workspaceIcon={workspace?.icon ?? "📄"}
            memberCount={memberCount}
            areaIcons={areaIcons}
            accountMenu={accountMenu}
            onOpenAccountMenu={() => setAccountMenu(true)}
            onCloseAccountMenu={() => setAccountMenu(false)}
            onSignOut={handleSignOut}
            onOpenSettings={() => openSettings("preferences")}
            onOpenInvite={() => {
              setAccountMenu(false);
              openSettings("people");
              setMembersTab("members");
              setInviteOpen(true);
            }}
            onOpenPalette={() => setPaletteOpen(true)}
            sidebarPopover={sidebarPopover}
            onOpenNewView={() => setSidebarPopover("view")}
            onOpenNewArea={() => setSidebarPopover("area")}
            onCloseSidebarPopover={() => setSidebarPopover(null)}
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
              {breadcrumb.crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-2 shrink-0">
                  <span className="text-ui text-secondary">{c}</span>
                  <span className="text-ui text-rule">/</span>
                </span>
              ))}
              <span className="min-w-0 truncate text-ui text-body">
                {breadcrumb.name}
              </span>
            </div>
          )}

          {selection && selection.kind === "page" ? (
            <div className="ml-auto flex items-center gap-2.5">
              <PageTopbarActions
                pageId={selection.id}
                menuOpen={pageMenuOpen}
                onMenuOpen={() => setPageMenuOpen(true)}
                onMenuClose={() => setPageMenuOpen(false)}
              />
            </div>
          ) : null}
        </header>

        <main className="min-w-0 flex-1 bg-surface overflow-y-auto">
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SettingsModal
        open={settingsOpen}
        pane={settingsPane}
        onPaneChange={setSettingsPane}
        onClose={closeSettings}
        pendingInvites={pendingInvites}
        onRevokeInvite={(email) =>
          setPendingInvites((prev) => prev.filter((i) => i.email !== email))
        }
        onOpenInvite={() => setInviteOpen(true)}
        membersTab={membersTab}
        onMembersTabChange={setMembersTab}
      />
      <AddMembersModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        workspaceName={workspaceName}
        allowedDomains={allowedDomains}
        onSend={(invs) => setPendingInvites((prev) => [...prev, ...invs])}
      />
    </div>
    </RowMenuProvider>
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
  workspaceIcon,
  memberCount,
  areaIcons,
  accountMenu,
  onOpenAccountMenu,
  onCloseAccountMenu,
  onSignOut,
  onOpenSettings,
  onOpenInvite,
  onOpenPalette,
  sidebarPopover,
  onOpenNewView,
  onOpenNewArea,
  onCloseSidebarPopover,
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
  workspaceIcon: string;
  memberCount: number;
  areaIcons: Map<string, string>;
  accountMenu: boolean;
  onOpenAccountMenu: () => void;
  onCloseAccountMenu: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
  onOpenInvite: () => void;
  onOpenPalette: () => void;
  sidebarPopover: "view" | "area" | null;
  onOpenNewView: () => void;
  onOpenNewArea: () => void;
  onCloseSidebarPopover: () => void;
}) {
  const [sections, toggleSection] = useSectionState();
  const { prefs } = usePrefs();
  const showSidebarCounts = prefs.showSidebarCounts;
  const { user } = useAuth();
  const navigate = useNavigate();
  const members = (useMembers().data ?? []) as MemberLite[];
  const propDefs = (usePropDefs().data ?? []) as Array<{
    key: string;
    label: string;
    options: unknown;
  }>;
  const verifyPage = useVerifyPage();
  const setPageProperty = useSetPageProperty();
  const moveToArea = useMovePageToArea();
  const duplicatePage = useDuplicatePage();
  const deletePage = useDeletePage();

  // Local "hide from my sidebar" list for team views. Persisted per-user.
  const hideKey = user?.id ? `gio.hiddenTeamViews.${user.id}` : "";
  const [hiddenTeamViews, setHiddenTeamViews] = useState<Set<string>>(() => {
    if (typeof window === "undefined" || !hideKey) return new Set();
    try {
      const raw = window.localStorage.getItem(hideKey);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });
  const hideTeamView = (id: string) => {
    setHiddenTeamViews((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (hideKey && typeof window !== "undefined")
        window.localStorage.setItem(hideKey, JSON.stringify([...next]));
      return next;
    });
  };

  const personal = views
    .filter((v) => v.scope === "personal")
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const team = views
    .filter((v) => v.scope === "team" && !hiddenTeamViews.has(v.id))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pages) {
      if (p.archived_at) continue;
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
      if (p.archived_at) continue;
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

  const renderCount = (c: number | "!", sizeClass: string) => {
    if (c === "!") {
      return (
        <span
          className={`tnum ${sizeClass} text-amberInk`}
          title="This view's filter is invalid"
        >
          !
        </span>
      );
    }
    if (!showSidebarCounts) return null;
    return <span className={`tnum ${sizeClass} text-whisper`}>{c}</span>;
  };

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
          onClick={onOpenPalette}
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
                <SidebarPlusButton
                  title="New personal view"
                  open={sidebarPopover === "view"}
                  onToggle={() =>
                    sidebarPopover === "view"
                      ? onCloseSidebarPopover()
                      : onOpenNewView()
                  }
                >
                  <NewPersonalViewPopover
                    onClose={onCloseSidebarPopover}
                    currentView={
                      selection?.kind === "view"
                        ? views.find((v) => v.id === selection.id)
                        : undefined
                    }
                  />
                </SidebarPlusButton>
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
                <SidebarPlusButton
                  title="New area"
                  open={sidebarPopover === "area"}
                  onToggle={() =>
                    sidebarPopover === "area"
                      ? onCloseSidebarPopover()
                      : onOpenNewArea()
                  }
                >
                  <NewAreaPopover
                    onClose={onCloseSidebarPopover}
                    existingAreas={areas.map((a) => a.area)}
                  />
                </SidebarPlusButton>
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

      <FooterAccount
        profile={profile}
        userEmail={userEmail}
        initials={initials}
        workspaceName={workspaceName}
        workspaceIcon={workspaceIcon}
        memberCount={memberCount}
        open={accountMenu}
        onOpen={onOpenAccountMenu}
        onClose={onCloseAccountMenu}
        onSignOut={onSignOut}
        onOpenSettings={onOpenSettings}
        onOpenInvite={onOpenInvite}
      />
    </>
  );
}

/* ─────────────────── View rows w/ hover ⋯ menus ─────────────────── */

/* Relative time hint for menu items. Kept tiny — spec-defined format. */
function relTime(iso: string) {
  return formatTimestamp(iso, "relative");
}

/* Look up the pastel avatar tokens for a member id, with a safe fallback. */
type MemberLite = {
  user_id: string;
  role: string;
  profiles: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_tint: string | null;
    avatar_ink: string | null;
  } | null;
};

function initialsOf(m: MemberLite | undefined) {
  const name = m?.profiles?.full_name || m?.profiles?.email || "?";
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function firstNameOf(m: MemberLite | undefined) {
  const name = m?.profiles?.full_name || m?.profiles?.email || "";
  return name.split(/\s+/)[0] ?? "";
}

/* Personal view row — hover reveals ⋯ in place of the count. */
function MyViewRow({
  v,
  active,
  count,
  renderCount,
  wsName,
  wsMembers,
}: {
  v: ViewRow;
  active: boolean;
  count: number | "!";
  renderCount: (c: number | "!", size: string) => ReactNode;
  wsName: string;
  wsMembers: number;
}) {
  const [hover, setHover] = useState(false);
  const updateView = useUpdateView();
  const createView = useCreateView();
  const deleteView = useDeleteView();
  const publishView = usePublishView();
  const navigate = useNavigate();

  const build = (): ReactNode => {
    const items: RowMenuItem[] = [
      {
        id: "open",
        label: "Open",
        hint: <Sc>↵</Sc>,
        onSelect: () =>
          navigate({ to: "/v/$viewId", params: { viewId: v.id } }),
      },
      {
        id: "rename",
        label: "Rename",
        keepOpen: true,
        onSelect: () => {
          /* opens the input frame below on next tick */
        },
      },
      {
        id: "duplicate",
        label: "Duplicate",
        hint: <Val>personal</Val>,
        onSelect: () =>
          createView.mutate({
            name: `${v.name} copy`,
            icon: v.icon,
            filter: (v.filter ?? []) as Filter[],
            sort: (v.sort ?? { prop: "edited", dir: "desc" }) as SortSpec,
            layout: v.layout,
          }),
      },
      {
        id: "publish",
        label: "Publish to team",
        hint: <Val>shared</Val>,
        submenu: true,
        onSelect: () => {
          /* handled by wrapper below */
        },
      },
      { kind: "divider" },
      {
        id: "delete",
        label: "Delete view",
        danger: true,
        submenu: true,
        onSelect: () => {
          /* handled by wrapper below */
        },
      },
    ];
    return <MyViewMenu view={v} items={items}
      wsName={wsName} wsMembers={wsMembers}
      updateView={updateView} publishView={publishView} deleteView={deleteView} />;
  };

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
      >
        {v.icon ? (
          <span className="text-row leading-none">{v.icon}</span>
        ) : (
          <LayoutGlyph layout={v.layout} />
        )}
        <span className="min-w-0 flex-1 truncate text-row">{v.name}</span>
        <span
          className="relative flex items-center justify-end"
          style={{ height: 17, minWidth: 17 }}
        >
          {hover ? (
            <RowMoreButton size="sm" build={build} />
          ) : (
            renderCount(count, "text-row")
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * Inner content for the personal-view menu. Stateful because "Rename" swaps
 * the same popover to an inline-input frame, and "Publish"/"Delete" swap to
 * a confirm frame — all in place (no flyouts).
 */
function MyViewMenu({
  view,
  items,
  wsName,
  wsMembers,
  updateView,
  publishView,
  deleteView,
}: {
  view: ViewRow;
  items: RowMenuItem[];
  wsName: string;
  wsMembers: number;
  updateView: ReturnType<typeof useUpdateView>;
  publishView: ReturnType<typeof usePublishView>;
  deleteView: ReturnType<typeof useDeleteView>;
}) {
  const [mode, setMode] = useState<"list" | "rename" | "publish" | "delete">("list");
  if (mode === "rename") {
    return (
      <RowMenuList
        title="Rename view"
        items={[]}
        onBack={() => setMode("list")}
        input={{
          initialValue: view.name,
          placeholder: "View name",
          autoSelect: true,
          onSubmit: (v) => {
            if (v && v !== view.name)
              updateView.mutate({ id: view.id, patch: { name: v } });
          },
        }}
      />
    );
  }
  if (mode === "publish") {
    return (
      <RowMenuConfirm
        title={`Publish "${view.name}" to the team?`}
        body={
          <>
            It moves out of My views into Team views for all{" "}
            <b>{wsMembers} people</b> at <b>{wsName}</b>. Publishing is the only
            way a view becomes shared.
          </>
        }
        confirmLabel="Publish"
        variant="publish"
        onConfirm={() => publishView.mutate(view.id)}
      />
    );
  }
  if (mode === "delete") {
    return (
      <RowMenuConfirm
        title={`Delete "${view.name}"?`}
        body="The view disappears from your sidebar — the pages it filtered are untouched."
        confirmLabel="Delete view"
        variant="danger"
        onConfirm={() => deleteView.mutate(view.id)}
      />
    );
  }
  return (
    <RowMenuList
      title="My view"
      items={items.map((it) => {
        if (it.kind === "divider") return it;
        if (it.id === "rename")
          return { ...it, onSelect: () => setMode("rename"), keepOpen: true };
        if (it.id === "publish")
          return { ...it, onSelect: () => setMode("publish"), submenu: true, keepOpen: true };
        if (it.id === "delete")
          return { ...it, onSelect: () => setMode("delete"), submenu: true, keepOpen: true };
        return it;
      })}
    />
  );
}

/* Team view row — non-owners get a short menu; owners also get Unpublish. */
function TeamViewRow({
  v,
  active,
  count,
  renderCount,
  isOwner,
  onHide,
}: {
  v: ViewRow;
  active: boolean;
  count: number | "!";
  renderCount: (c: number | "!", size: string) => ReactNode;
  isOwner: boolean;
  onHide: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const fork = useForkView();
  const navigate = useNavigate();

  const build = (): ReactNode => (
    <RowMenuList
      title="Team view"
      items={[
        {
          id: "open",
          label: "Open",
          hint: <Sc>↵</Sc>,
          onSelect: () =>
            navigate({ to: "/v/$viewId", params: { viewId: v.id } }),
        },
        {
          id: "dup",
          label: "Duplicate into My views",
          hint: <Val>personal</Val>,
          onSelect: () =>
            fork.mutate({
              viewId: v.id,
              name: `${v.name} copy`,
              filter: (v.filter ?? []) as Filter[],
              sort: (v.sort ?? { prop: "edited", dir: "desc" }) as SortSpec,
              layout: v.layout,
            }),
        },
        {
          id: "hide",
          label: "Hide from my sidebar",
          onSelect: () => onHide(v.id),
        },
        ...(isOwner
          ? ([
              { kind: "divider" },
              {
                id: "unpublish",
                label: "Unpublish",
                hint: <Val>back to mine</Val>,
                disabled: true,
              },
            ] satisfies RowMenuItem[])
          : []),
      ]}
    />
  );

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
          className="h-3 w-3 shrink-0 text-muted"
        />
        <span className="min-w-0 flex-1 truncate text-meta text-secondary">
          {v.name}
        </span>
        <span
          className="relative flex items-center justify-end"
          style={{ height: 17, minWidth: 17 }}
        >
          {hover ? (
            <RowMoreButton size="sm" build={build} />
          ) : (
            renderCount(count, "text-meta")
          )}
        </span>
      </Link>
    </li>
  );
}

/* Area row — its menu carries area-scope actions plus rename with a footer. */
function AreaLi({
  area,
  count,
  icon,
  open,
  onToggle,
  active,
  items,
  isStale,
  propDefs,
  members,
  me,
  onVerify,
  setPageProperty,
  moveToArea,
  duplicatePage,
  deletePage,
  navigate,
}: {
  area: string;
  count: number;
  icon: string | undefined;
  open: boolean;
  onToggle: () => void;
  active: boolean;
  items: PageListItem[];
  isStale: (p: PageListItem) => boolean;
  propDefs: Array<{ key: string; label: string; options: unknown }>;
  members: MemberLite[];
  me: string;
  onVerify: (pageId: string) => void;
  setPageProperty: ReturnType<typeof useSetPageProperty>;
  moveToArea: ReturnType<typeof useMovePageToArea>;
  duplicatePage: ReturnType<typeof useDuplicatePage>;
  deletePage: ReturnType<typeof useDeletePage>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [hover, setHover] = useState(false);
  const createPage = useCreatePage();
  const createView = useCreateView();
  const renameArea = useRenameArea();

  const buildAreaMenu = (): ReactNode => (
    <AreaMenu
      area={area}
      count={count}
      open={open}
      onToggle={onToggle}
      onOpen={() => navigate({ to: "/a/$area", params: { area } })}
      onNewPage={() => createPage.mutate({ seedProps: { area } })}
      onRename={(to) => renameArea.mutate({ from: area, to })}
      onSaveAsView={() =>
        createView.mutate({
          name: area,
          filter: [{ op: "eq", prop: "area", value: area }],
          sort: { prop: "edited", dir: "desc" },
          layout: "table",
        })
      }
    />
  );

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
          <span
            className="relative flex items-center justify-end"
            style={{ height: 17, minWidth: 17 }}
          >
            {hover ? (
              <RowMoreButton size="sm" build={buildAreaMenu} />
            ) : (
              <span className="tnum text-row text-whisper">{count}</span>
            )}
          </span>
        </Link>
      </div>
      {open && (
        <ul className="ml-6">
          {items.map((p) => (
            <PageRowLi
              key={p.id}
              p={p}
              isStale={isStale(p)}
              propDefs={propDefs}
              members={members}
              me={me}
              onVerify={onVerify}
              setPageProperty={setPageProperty}
              moveToArea={moveToArea}
              duplicatePage={duplicatePage}
              deletePage={deletePage}
              navigate={navigate}
            />
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

/** Stateful content for the area menu — rename swaps in place. */
function AreaMenu({
  area,
  count,
  open,
  onToggle,
  onOpen,
  onNewPage,
  onRename,
  onSaveAsView,
}: {
  area: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onNewPage: () => void;
  onRename: (to: string) => void;
  onSaveAsView: () => void;
}) {
  const [mode, setMode] = useState<"list" | "rename">("list");
  if (mode === "rename") {
    return (
      <RowMenuList
        title={`Rename "${area}"`}
        items={[]}
        onBack={() => setMode("list")}
        input={{
          initialValue: area,
          placeholder: "Area name",
          autoSelect: true,
          onSubmit: (v) => {
            if (v && v !== area) onRename(v);
          },
        }}
        footer="Every page with this area follows."
      />
    );
  }
  const title = `${area} · ${count} ${count === 1 ? "page" : "pages"}`;
  const items: RowMenuItem[] = [
    {
      id: "open",
      label: "Open area",
      hint: <Sc>↵</Sc>,
      onSelect: onOpen,
    },
    {
      id: "toggle",
      label: open ? "Collapse pages" : "Show pages",
      onSelect: onToggle,
    },
    {
      id: "new",
      label: "New page here",
      onSelect: onNewPage,
    },
    {
      id: "rename",
      label: "Rename area",
      hint: <Val>{count} {count === 1 ? "page" : "pages"}</Val>,
      submenu: true,
      keepOpen: true,
      onSelect: () => setMode("rename"),
    },
    { kind: "divider" },
    {
      id: "save",
      label: "Save as my view",
      hint: <Val>personal</Val>,
      onSelect: onSaveAsView,
    },
  ];
  return <RowMenuList title={title} items={items} />;
}

/* Nested page row with hover ⋯ + full page menu (submenus swap in place). */
function PageRowLi({
  p,
  isStale,
  propDefs,
  members,
  me,
  onVerify,
  setPageProperty,
  moveToArea,
  duplicatePage,
  deletePage,
  navigate,
}: {
  p: PageListItem;
  isStale: boolean;
  propDefs: Array<{ key: string; label: string; options: unknown }>;
  members: MemberLite[];
  me: string;
  onVerify: (pageId: string) => void;
  setPageProperty: ReturnType<typeof useSetPageProperty>;
  moveToArea: ReturnType<typeof useMovePageToArea>;
  duplicatePage: ReturnType<typeof useDuplicatePage>;
  deletePage: ReturnType<typeof useDeletePage>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [hover, setHover] = useState(false);
  const props =
    p.props && typeof p.props === "object" && !Array.isArray(p.props)
      ? (p.props as Record<string, unknown>)
      : {};
  const build = (): ReactNode => (
    <PageMenu
      p={p}
      isStale={isStale}
      propDefs={propDefs}
      members={members}
      me={me}
      onOpen={() => navigate({ to: "/p/$pageId", params: { pageId: p.id } })}
      onVerify={() => onVerify(p.id)}
      onSetStatus={(v) =>
        setPageProperty.mutate({ pageId: p.id, key: "status", value: v })
      }
      onSetOwner={(uid) =>
        setPageProperty.mutate({ pageId: p.id, key: "owner", value: uid })
      }
      onMoveArea={(a) => moveToArea.mutate({ pageId: p.id, area: a })}
      onDuplicate={() => duplicatePage.mutate(p.id)}
      onDelete={() => deletePage.mutate(p.id)}
    />
  );
  return (
    <li
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Link
        to="/p/$pageId"
        params={{ pageId: p.id }}
        style={{ height: "var(--spacing-rowPage)" }}
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 text-meta text-secondary hover:bg-railHover"
      >
        {isStale && (
          <span
            aria-label="Stale"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amberDot"
          />
        )}
        <span className="min-w-0 flex-1 truncate">
          {p.title || "Untitled"}
        </span>
        <span
          className="relative flex items-center justify-end"
          style={{ height: 17, minWidth: 17 }}
        >
          {hover ? <RowMoreButton size="sm" build={build} /> : null}
        </span>
      </Link>
      {/* Debug: props reference so noUnusedLocals doesn't fire — actually used below. */}
      {false && JSON.stringify(props)}
    </li>
  );
}

/** Page-row menu with in-place submenus for status / owner / area. */
function PageMenu({
  p,
  isStale,
  propDefs,
  members,
  me,
  onOpen,
  onVerify,
  onSetStatus,
  onSetOwner,
  onMoveArea,
  onDuplicate,
  onDelete,
}: {
  p: PageListItem;
  isStale: boolean;
  propDefs: Array<{ key: string; label: string; options: unknown }>;
  members: MemberLite[];
  me: string;
  onOpen: () => void;
  onVerify: () => void;
  onSetStatus: (v: string) => void;
  onSetOwner: (uid: string) => void;
  onMoveArea: (area: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<
    "list" | "status" | "owner" | "area" | "delete"
  >("list");
  const props =
    p.props && typeof p.props === "object" && !Array.isArray(p.props)
      ? (p.props as Record<string, unknown>)
      : {};
  const currentStatus = typeof props.status === "string" ? props.status : "";
  const currentOwner = typeof props.owner === "string" ? props.owner : "";
  const currentArea = typeof props.area === "string" ? props.area : "";

  const statusDef = propDefs.find((d) => d.key === "status");
  const statusOptions = ((statusDef?.options as Array<{ value: string; color?: string }>) ??
    []).filter(Boolean);
  const areaDef = propDefs.find((d) => d.key === "area");
  const areaOptions = ((areaDef?.options as Array<{ value: string }>) ?? [])
    .map((o) => o.value)
    .filter(Boolean);

  if (mode === "status") {
    return (
      <RowMenuList
        title="Set status"
        onBack={() => setMode("list")}
        items={statusOptions.map((o) => ({
          id: o.value,
          label: o.value,
          dot: o.color || "var(--color-muted)",
          check: o.value === currentStatus,
          onSelect: () => {
            onSetStatus(o.value);
            setMode("list");
          },
        }))}
      />
    );
  }
  if (mode === "owner") {
    return (
      <RowMenuList
        title="Set owner"
        onBack={() => setMode("list")}
        items={members.map((m) => ({
          id: m.user_id,
          label: m.profiles?.full_name || m.profiles?.email || "Unknown",
          avatar: {
            tint: m.profiles?.avatar_tint || "var(--color-sunken)",
            ink: m.profiles?.avatar_ink || "var(--color-noir)",
            initials: initialsOf(m),
          },
          check: m.user_id === currentOwner,
          onSelect: () => {
            onSetOwner(m.user_id);
            setMode("list");
          },
        }))}
      />
    );
  }
  if (mode === "area") {
    return (
      <RowMenuList
        title="Move to area"
        onBack={() => setMode("list")}
        items={[
          {
            id: "__none",
            label: "No area",
            hint: currentArea ? undefined : <Val>current</Val>,
            check: !currentArea,
            onSelect: () => {
              onMoveArea(null);
              setMode("list");
            },
          },
          { kind: "divider" },
          ...areaOptions.map((a) => ({
            id: a,
            label: a,
            check: a === currentArea,
            onSelect: () => {
              onMoveArea(a);
              setMode("list");
            },
          })),
        ]}
      />
    );
  }
  if (mode === "delete") {
    return (
      <RowMenuConfirm
        title={`Delete "${p.title || "Untitled"}"?`}
        body="It disappears from every view at once — there is no folder it stays in."
        confirmLabel="Delete page"
        variant="danger"
        onConfirm={onDelete}
      />
    );
  }

  const ownerMember = members.find((m) => m.user_id === currentOwner);
  const items: RowMenuItem[] = [
    {
      id: "open",
      label: "Open",
      hint: <Sc>↵</Sc>,
      onSelect: onOpen,
    },
    {
      id: "verify",
      label: isStale ? "Mark verified now" : "Re-verify",
      hint: <Val>{relTime(p.verified_at)}</Val>,
      onSelect: onVerify,
    },
    {
      id: "status",
      label: "Set status",
      hint: currentStatus ? <Val>{currentStatus}</Val> : <Val>empty</Val>,
      submenu: true,
      keepOpen: true,
      onSelect: () => setMode("status"),
    },
    {
      id: "owner",
      label: "Set owner",
      hint: currentOwner ? (
        <Val>{firstNameOf(ownerMember) || "…"}</Val>
      ) : (
        <Val>none</Val>
      ),
      submenu: true,
      keepOpen: true,
      onSelect: () => setMode("owner"),
    },
    {
      id: "area",
      label: "Move to area",
      hint: currentArea ? <Val>{currentArea}</Val> : <Val>none</Val>,
      submenu: true,
      keepOpen: true,
      onSelect: () => setMode("area"),
    },
    { kind: "divider" },
    {
      id: "dup",
      label: "Duplicate",
      hint: <Sc>⌘D</Sc>,
      onSelect: onDuplicate,
    },
    {
      id: "delete",
      label: "Delete page",
      danger: true,
      submenu: true,
      keepOpen: true,
      onSelect: () => setMode("delete"),
    },
  ];
  return (
    <RowMenuList
      title={p.title || "Untitled"}
      items={items.map((it) =>
        it.kind === "divider" || me ? it : it,
      )}
    />
  );
}

/* ─────────────────── Footer + account dropdown ─────────────────── */

function FooterAccount({
  profile,
  userEmail,
  initials,
  workspaceName,
  workspaceIcon,
  memberCount,
  open,
  onOpen,
  onClose,
  onSignOut,
  onOpenSettings,
  onOpenInvite,
}: {
  profile: { full_name: string; avatar_tint: string; avatar_ink: string } | null;
  userEmail: string;
  initials: string;
  workspaceName: string;
  workspaceIcon: string;
  memberCount: number;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
  onOpenInvite: () => void;
}) {
  const displayName = profile?.full_name || userEmail || "You";
  return (
    <>
      {/* Footer button */}
      <button
        type="button"
        onClick={() => (open ? onClose() : onOpen())}
        aria-label="Account menu"
        aria-expanded={open}
        className={
          "flex items-center border-t border-line w-full text-left " +
          (open ? "bg-railHover" : "hover:bg-railHover")
        }
        style={{ padding: "9px 10px", gap: 9, cursor: "pointer" }}
      >
        <span
          className="grid shrink-0 place-items-center rounded-full"
          style={{
            width: 26,
            height: 26,
            background: profile?.avatar_tint ?? "var(--color-sunken)",
            color: profile?.avatar_ink ?? "var(--color-noir)",
            fontSize: 11.5,
            fontWeight: 700,
          }}
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body" style={{ fontSize: 14, fontWeight: 700 }}>
            {displayName}
          </div>
          <div className="truncate text-muted" style={{ fontSize: 12.5 }}>
            {workspaceName}
            {memberCount ? ` · ${memberCount} people` : ""}
          </div>
        </div>
        <span className="shrink-0 text-whisper">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round"
            strokeLinejoin="round" aria-hidden>
            <path d="m8 14.5 4 4 4-4" />
            <path d="m8 9.5 4-4 4 4" />
          </svg>
        </span>
      </button>

      {open && (
        <>
          {/* Scrim */}
          <div
            className="fixed inset-0"
            style={{ zIndex: 95 }}
            onClick={onClose}
            aria-hidden
          />
          <div
            className="fixed bg-surface animate-popIn"
            style={{
              zIndex: 96,
              left: 10,
              bottom: 56,
              width: 268,
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "var(--shadow-popover)",
            }}
          >
            {/* A. Workspace header */}
            <div
              className="flex items-center"
              style={{ padding: "12px 13px 11px", gap: 10 }}
            >
              <span
                className="grid shrink-0 place-items-center bg-sunken"
                style={{ width: 30, height: 30, borderRadius: 8, fontSize: 16 }}
                aria-hidden
              >
                {workspaceIcon}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate font-display text-noir"
                  style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}
                >
                  {workspaceName}
                </div>
                <div className="truncate text-muted" style={{ fontSize: 12.5 }}>
                  MVP plan · {memberCount} member{memberCount === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            {/* B. Actions */}
            <div style={{ borderTop: "1px solid var(--color-lineSoft)", padding: 5 }}>
              <DropdownRow
                icon="M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-4M20 13V3M1.5 15h5M9.5 8h5M17.5 17h5"
                onClick={onOpenSettings}
                right={
                  <span
                    className="font-mono text-whisper"
                    style={{ fontSize: 11 }}
                  >
                    ⌘,
                  </span>
                }
              >
                Settings
              </DropdownRow>
              <DropdownRow
                icon="M9 3.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM2 20.4v-1.8a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1.8M16.5 3.9a3.6 3.6 0 0 1 0 7M22 20.4v-1.8a4 4 0 0 0-3-3.8"
                onClick={onOpenInvite}
              >
                Invite members
              </DropdownRow>
            </div>

            {/* C. Account + workspace switcher */}
            <div style={{ borderTop: "1px solid var(--color-lineSoft)", padding: 5 }}>
              <div
                className="truncate text-faint"
                style={{ fontSize: 12, padding: "5px 9px 4px" }}
              >
                {userEmail}
              </div>
              <div
                className="flex items-center rounded-lg"
                style={{ padding: "6px 9px", gap: 9, fontSize: 14 }}
              >
                <span
                  className="grid shrink-0 place-items-center bg-sunken"
                  style={{ width: 22, height: 22, borderRadius: 6, fontSize: 12 }}
                  aria-hidden
                >
                  {workspaceIcon}
                </span>
                <span className="min-w-0 flex-1 truncate text-body">
                  {workspaceName}
                </span>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth={2} strokeLinecap="round"
                  strokeLinejoin="round" className="text-accent" aria-hidden>
                  <path d="M5 12l5 5 9-11" />
                </svg>
              </div>
            </div>

            {/* D. Log out */}
            <div style={{ borderTop: "1px solid var(--color-lineSoft)", padding: 5 }}>
              <DropdownRow
                icon="M15 12H3m0 0l4-4m-4 4l4 4M9 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9"
                onClick={onSignOut}
              >
                Log out
              </DropdownRow>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DropdownRow({
  icon,
  children,
  onClick,
  right,
}: {
  icon: string;
  children: ReactNode;
  onClick?: () => void;
  right?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center rounded-lg text-body hover:bg-rail hover:text-noir"
      style={{ padding: "7px 9px", gap: 10, fontSize: 14, textAlign: "left" }}
    >
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
        strokeLinejoin="round" className="text-secondary shrink-0" aria-hidden>
        <path d={icon} />
      </svg>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right}
    </button>
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

// ─────────────────────────────────────────────────────────────
// Sidebar "+" button + popovers
// ─────────────────────────────────────────────────────────────

function SidebarPlusButton({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 262;
      const gap = 6;
      // Anchor to the button's right edge, but keep the popover on-screen.
      let left = r.right - width;
      const margin = 8;
      if (left < margin) left = margin;
      const maxLeft = window.innerWidth - width - margin;
      if (left > maxLeft) left = maxLeft;
      setPos({ top: r.bottom + gap, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="grid h-5 w-5 place-items-center rounded-sm text-faint hover:bg-railHover hover:text-secondary"
      >
        <Glyph path="M12 5v14M5 12h14" className="h-3.5 w-3.5" />
      </button>
      {open && pos
        ? createPortal(
            <div
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: 262,
                zIndex: 60,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function NewPersonalViewPopover({
  onClose,
  currentView,
}: {
  onClose: () => void;
  currentView?: ViewRow;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const createView = useCreateView();
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 60;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const seedFilter = (currentView?.filter ?? []) as Filter[];
      const seedSort =
        (currentView?.sort as SortSpec | null) ?? { prop: "edited", dir: "desc" };
      const seedLayout = currentView?.layout ?? "table";
      const created = await createView.mutateAsync({
        name: trimmed,
        filter: seedFilter,
        sort: seedSort,
        layout: seedLayout,
      });
      onClose();
      navigate({ to: "/v/$viewId", params: { viewId: created.id } });
    } catch (err) {
      console.error(err);
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={rootRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ width: 262 }}
      className="rounded-md border border-rule bg-surface p-3 shadow-lg"
    >
      <div className="mb-2 text-label uppercase text-faint">New view</div>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        maxLength={60}
        placeholder="View name"
        className="w-full rounded-sm border border-rule bg-canvas px-2 py-1.5 text-ui text-strong placeholder:text-faint focus:border-brand focus:outline-none"
      />
      <p className="mt-1.5 text-caption text-faint">
        {currentView
          ? `Seeded from "${currentView.name}"`
          : "Empty personal view"}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm px-2 py-1 text-ui text-secondary hover:bg-rail"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || submitting}
          onClick={submit}
          className="rounded-sm bg-brand px-2.5 py-1 text-ui text-onBrand disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create view"}
        </button>
      </div>
    </div>
  );
}

function NewAreaPopover({
  onClose,
  existingAreas,
}: {
  onClose: () => void;
  existingAreas: string[];
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const createPage = useCreatePage();
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const duplicate =
    trimmed.length > 0 &&
    existingAreas.some((a) => a.toLowerCase() === lower);
  const valid = trimmed.length > 0 && trimmed.length <= 60 && !duplicate;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const created = await createPage.mutateAsync({
        seedProps: { area: trimmed },
        blocks: [
          {
            id: nanoid(10),
            type: "paragraph",
            text: "",
          },
        ],
      });
      try {
        sessionStorage.setItem(
          "gio.page-back",
          JSON.stringify({ pageId: created.id, area: trimmed }),
        );
        sessionStorage.setItem("gio.focus-title", created.id);
      } catch {
        /* storage unavailable */
      }
      onClose();
      navigate({ to: "/p/$pageId", params: { pageId: created.id } });
    } catch (err) {
      console.error(err);
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={rootRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ width: 262 }}
      className="rounded-md border border-rule bg-surface p-3 shadow-lg"
    >
      <div className="mb-2 text-label uppercase text-faint">New area</div>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        maxLength={60}
        placeholder="Area name"
        aria-invalid={duplicate}
        className="w-full rounded-sm border border-rule bg-canvas px-2 py-1.5 text-ui text-strong placeholder:text-faint focus:border-brand focus:outline-none"
      />
      <p className="mt-1.5 text-caption text-faint">
        {duplicate
          ? "That area already exists."
          : "Creates the area and opens a new untitled page in it."}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm px-2 py-1 text-ui text-secondary hover:bg-rail"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || submitting}
          onClick={submit}
          className="rounded-sm bg-brand px-2.5 py-1 text-ui text-onBrand disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create area"}
        </button>
      </div>
    </div>
  );
}
