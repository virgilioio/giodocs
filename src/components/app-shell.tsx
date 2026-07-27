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
  useCreatePageAndOpen,

  useCreateView,
  useDeleteView,
  useDeletePage,
  useRestorePage,

  
  useForkView,
  useUnpublishView,

  useMovePageToArea,
  useRenameArea,
  useSetPageProperty,
  useUpdateView,
  usePublishView,
  useVerifyPage,
  useSetAreaIcon,
  useRegisterArea,
  useClearArea,


} from "@/hooks/use-page-mutations";

import { useToast } from "@/lib/toast";
import { formatTimestamp } from "@/lib/format";
import type { PageListItem } from "@/lib/types";
import { MainView } from "./main-view";
import { PageEditor } from "./page-view";
import { PageTopbarActions } from "./page-topbar-actions";
import { CommandPalette } from "./command-palette";
import { SettingsModal, type SettingsPane } from "./settings-modal";
import { AddMembersModal } from "./add-members-modal";
import { useWorkspaceInvites, useCancelInvite } from "@/hooks/use-invites";
import { Popover } from "./popover";
import { EmojiPicker } from "./emoji-picker";
import {
  RowMenuProvider,
  SpecMenuTrigger,
  type MenuSpec,
  type MenuRow,
} from "./row-menu";
import { areaMenuFooter } from "@/lib/area-menu-footer";
import { pageRowFooter } from "@/lib/page-row-footer";
import {
  buildPageRowSpec,
  firstNameOf,
  initialsOf,
  type MemberLite,
} from "@/lib/page-row-spec";
import { personalViewFooter } from "@/lib/personal-view-footer";
import { layoutOf, type ViewLayout } from "@/lib/view-drafts";
import { useDrafts, patchDraft as storePatchDraft } from "@/lib/view-drafts-store";


import { useAllowedDomains, useMembers, usePropDefs } from "@/hooks/use-workspace-data";
import { usePrefs } from "@/lib/preferences";


type Selection =
  | { kind: "view"; id: string }
  | { kind: "area"; area: string }
  | { kind: "page"; id: string }
  | null;

const COLLAPSE_KEY = "gio.sidebar.collapsed";
const SECTION_KEY = "gio.sidebar.sections"; // JSON { my:boolean, team:boolean, areas:boolean }
const SIDEBAR_W_KEY = "gio.sidebarWidth";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 460;
const SIDEBAR_DEFAULT = 240;

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

  // Resizable sidebar. Width lives in ONE CSS variable (--gio-sidebar-w) that
  // both the pane and the main column read; clamp to [MIN,MAX] during the
  // drag so the user feels the limit; persist under gio.sidebarWidth; an
  // out-of-range stored value is clamped rather than trusted. Collapse-to-0
  // preserves the chosen width — expanding restores it, not the default.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 240;
    const raw = window.localStorage.getItem(SIDEBAR_W_KEY);
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return 240;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
  });
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_W_KEY, String(sidebarWidth));
    }
  }, [sidebarWidth]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("preferences");
  const [membersTab, setMembersTab] = useState<"members" | "guests">("members");
  const [accountMenu, setAccountMenu] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const invitesQ = useWorkspaceInvites();
  const pendingInvites = invitesQ.data ?? [];
  const cancelInvite = useCancelInvite();
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
    return null;
  }, [selection, views]);

  // On page routes, the breadcrumb is replaced by a back-arrow + origin label.
  const pageBack = useMemo(() => {
    if (!selection || selection.kind !== "page") return null;
    const origin = getPageOrigin(selection.id);
    if (origin) {
      if (origin.kind === "view") {
        return {
          label: origin.viewName,
          to: "/v/$viewId" as const,
          params: { viewId: origin.viewId },
        };
      }
      if (origin.kind === "area") {
        return {
          label: origin.area,
          to: "/a/$area" as const,
          params: { area: encodeURIComponent(origin.area) },
        };
      }
    }
    // Fall back to "All pages" (home) when the origin is unknown.
    return {
      label: "All pages",
      to: "/" as const,
      params: {} as Record<string, string>,
    };
  }, [selection]);




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
    <div className="flex h-screen overflow-hidden bg-canvas">
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
          {pageBack ? (
            <Link
              to={pageBack.to}
              params={pageBack.params as never}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-secondary hover:bg-rail hover:text-strong"
              title={`Back to ${pageBack.label}`}
            >
              <Glyph path="M15 6l-6 6 6 6" className="h-4 w-4" />
              <span className="min-w-0 truncate">{pageBack.label}</span>
            </Link>
          ) : breadcrumb ? (
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
          ) : null}

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
            <PageEditor key={selection.id} pageId={selection.id} />
          ) : selection ? (
            <MainView
              key={
                selection.kind === "view"
                  ? `v:${selection.id}`
                  : `a:${selection.area}`
              }
              selection={selection}
            />
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
        onRevokeInvite={(email) => cancelInvite.mutate(email)}
        onOpenInvite={() => setInviteOpen(true)}
        membersTab={membersTab}
        onMembersTabChange={setMembersTab}
      />
      <AddMembersModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        workspaceName={workspaceName}
        allowedDomains={allowedDomains}
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
  const wsId = useWorkspaceId();
  const members = (useMembers(wsId).data ?? []) as MemberLite[];
  const propDefs = (usePropDefs(wsId).data ?? []) as Array<{
    key: string;
    label: string;
    options: unknown;
  }>;
  const verifyPage = useVerifyPage();
  const setPageProperty = useSetPageProperty();
  const moveToArea = useMovePageToArea();
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
  const unhideAllTeamViews = () => {
    setHiddenTeamViews(new Set());
    if (hideKey && typeof window !== "undefined")
      window.localStorage.removeItem(hideKey);
  };

  const isWorkspaceOwner = !!user?.id && members.some(
    (m) => m.user_id === user.id && m.role === "owner",
  );

  const personal = views
    .filter((v) => v.scope === "personal")
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const teamAll = views.filter((v) => v.scope === "team");
  const team = teamAll
    .filter((v) => !hiddenTeamViews.has(v.id))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const hiddenTeamCount = teamAll.filter((v) => hiddenTeamViews.has(v.id)).length;


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
                    wsName={workspaceName}
                    wsMembers={memberCount}
                    isWorkspaceOwner={isWorkspaceOwner}
                    pages={pages}
                    ctx={ctx}
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
                      isOwner={v.owner_id === user?.id}
                      isWorkspaceOwner={isWorkspaceOwner}
                      memberCount={memberCount}
                      pages={pages}
                      ctx={ctx}
                      onHide={hideTeamView}
                    />
                  ))}
                  {hiddenTeamCount > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={unhideAllTeamViews}
                        style={{ height: "var(--spacing-rowTeam)" }}
                        className="flex w-full items-center gap-2 rounded-md px-2 text-meta text-faint italic hover:bg-railHover"
                      >
                        <span className="min-w-0 flex-1 truncate text-left">
                          {hiddenTeamCount} hidden
                        </span>
                      </button>
                    </li>
                  )}
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
                      propDefs={propDefs}
                      members={members}
                      me={user?.id ?? ""}
                      onVerify={(id) => verifyPage.mutate(id)}
                      setPageProperty={setPageProperty}
                      moveToArea={moveToArea}
                      deletePage={deletePage}
                      navigate={navigate}
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

/* MemberLite + initialsOf + firstNameOf now live in @/lib/page-row-spec. */

/* Personal view row — hover reveals ⋯ in place of the count. */
/* Sort label used by the personal-view menu footer. Matches the labels
 * shown by the toolbar's sort picker in MainView. */
function sortLabelFor(sort: { prop: string; dir: string } | null | undefined): string {
  if (!sort) return "";
  const key = `${sort.prop}:${sort.dir}`;
  switch (key) {
    case "edited:desc": return "Newest edits";
    case "edited:asc":  return "Oldest edits";
    case "created:desc": return "Newest first";
    case "created:asc":  return "Oldest first";
    case "verified:asc": return "Stalest verification";
    case "title:asc":    return "Title A→Z";
    default: return "";
  }
}

/* The three layout choices with their sub-line copy. Used by the layout
 * submenu on both personal and team view rows. */
const LAYOUT_ROWS: Array<{ layout: ViewLayout; label: string; sub: string; icon: string }> = [
  { layout: "table", label: "Table", sub: "rows + properties", icon: "layout" },
  { layout: "board", label: "Board", sub: "grouped by select", icon: "board" },
  { layout: "list",  label: "List",  sub: "title + sub-line", icon: "list" },
];

function buildLayoutSubmenu(
  current: ViewLayout,
  onPick: (l: ViewLayout) => void,
  ctxClose: () => void,
): MenuSpec {
  return {
    title: "Change layout",
    footer: "Same query, different arrangement — no page moves.",
    rows: LAYOUT_ROWS.map((r) => ({
      kind: "row",
      label: r.label,
      icon: r.icon,
      hint: { text: r.sub },
      checked: r.layout === current,
      onPick: () => {
        if (r.layout !== current) onPick(r.layout);
        ctxClose();
      },
    })),
  };
}

function copyViewLink(id: string): string {
  const origin =
    typeof window !== "undefined" && window.location ? window.location.origin : "";
  return `${origin}/v/${id}`;
}

function MyViewRow({
  v,
  active,
  count,
  renderCount,
  wsName,
  wsMembers,
  isWorkspaceOwner,
  pages,
  ctx,
}: {
  v: ViewRow;
  active: boolean;
  count: number | "!";
  renderCount: (c: number | "!", size: string) => ReactNode;
  wsName: string;
  wsMembers: number;
  isWorkspaceOwner: boolean;
  pages: PageListItem[];
  ctx: { me: string; staleDays: number };
}) {
  const [hover, setHover] = useState(false);
  const updateView = useUpdateView();
  const createView = useCreateView();
  const deleteView = useDeleteView();
  const publishView = usePublishView();
  const navigate = useNavigate();
  const toast = useToast();
  const drafts = useDrafts();

  const effectiveLayout = layoutOf(v, drafts);

  const build = (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }): MenuSpec => {
    const filters = (v.filter ?? []) as Filter[];
    const sort = (v.sort as SortSpec | null) ?? { prop: "edited", dir: "desc" };
    const total = pages.length;
    const matched = runView(pages, { filter: filters, sort }, ctx).length;
    const footer = personalViewFooter({
      matchCount: matched,
      totalCount: total,
      sortLabel: sortLabelFor(sort),
    });

    const rows: MenuRow[] = [
      {
        kind: "row",
        label: "Open view",
        icon: "open",
        hint: { text: "↵", mono: true },
        onPick: () => {
          navigate({ to: "/v/$viewId", params: { viewId: v.id } });
          mctx.close();
        },
      },
      { kind: "sep" },
      {
        kind: "row",
        label: "Rename",
        icon: "pencil",
        hint: { text: "⌘⇧R", mono: true },
        onPick: () =>
          mctx.setSpec({
            title: "Rename view",
            rows: [],
            input: {
              placeholder: "View name",
              initial: v.name,
              selectOnFocus: true,
              onCommit: (name) => {
                if (name && name !== v.name)
                  updateView.mutate({ id: v.id, patch: { name } });
              },
            },
          }),
      },
      {
        kind: "row",
        label: "Change layout",
        icon: "layout",
        hint: { text: LAYOUT_ROWS.find((r) => r.layout === effectiveLayout)?.label ?? "Table" },
        onPick: () =>
          mctx.setSpec(
            buildLayoutSubmenu(effectiveLayout, (l) => {
              updateView.mutate({ id: v.id, patch: { layout: l } });
            }, mctx.close),
          ),
      },
      {
        kind: "row",
        label: "Duplicate",
        icon: "dup",
        hint: { text: "⌘D", mono: true },
        onPick: () => {
          createView.mutate({
            name: `${v.name} copy`,
            icon: v.icon,
            filter: filters,
            sort,
            layout: v.layout,
          });
          mctx.close();
        },
      },
      {
        kind: "row",
        label: "Copy link",
        icon: "link",
        hint: { text: "⌘⌥L", mono: true },
        onPick: () => {
          void navigator.clipboard?.writeText?.(copyViewLink(v.id));
          toast.push(`Copied link to "${v.name}"`);
          mctx.close();
        },
      },
      ...(isWorkspaceOwner
        ? ([
            { kind: "sep" },
            {
              kind: "row",
              label: "Publish to team",
              icon: "people",
              hint: { text: "shared" },
              onPick: () =>
                mctx.setSpec({
                  title: `Publish "${v.name}"?`,
                  rows: [],
                  confirm: {
                    title: `Publish "${v.name}" to the team?`,
                    body: `It moves out of My views into Team views for all ${wsMembers} people at ${wsName}. Publishing is the only way a view becomes shared.`,
                    cta: "Publish",
                    onConfirm: () => publishView.mutate(v.id),
                  },
                }),
            },
          ] satisfies MenuRow[])
        : []),
      { kind: "sep" },
      {
        kind: "row",
        label: "Delete view",
        icon: "trash",
        danger: true,
        onPick: () =>
          mctx.setSpec({
            title: `Delete "${v.name}"?`,
            rows: [],
            confirm: {
              title: `Delete "${v.name}"?`,
              body: "The view disappears from your sidebar — the pages it filtered are untouched.",
              cta: "Delete view",
              danger: true,
              onConfirm: () => deleteView.mutate(v.id),
            },
          }),
      },
    ];

    return { title: "My view", rows, footer };
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
        <ViewIconSlot
          view={v}
          effectiveLayout={effectiveLayout}
          onSet={(icon) => updateView.mutate({ id: v.id, patch: { icon } })}
        />
        <span className="min-w-0 flex-1 truncate text-row">{v.name}</span>
        <span
          className="relative flex items-center justify-end"
          style={{ height: 17, minWidth: 17 }}
        >
          {hover ? (
            <SpecMenuTrigger size="sm" build={build} />
          ) : (
            renderCount(count, "text-row")
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * Clickable icon slot for a personal view — opens the shared emoji picker
 * in a portalled popover. Clicks stopPropagation so the enclosing row
 * doesn't navigate.
 */
function ViewIconSlot({
  view,
  effectiveLayout,
  onSet,
}: {
  view: ViewRow;
  effectiveLayout: ViewLayout;
  onSet: (icon: string | null) => void;
}) {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Popover
        width={264}
        trigger={({ open, onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            aria-label="Change view icon"
            aria-expanded={open}
            onClick={(e) => {
              e.preventDefault();
              onClick();
            }}
            className="grid place-items-center rounded-sm hover:bg-sunken"
            style={{ width: 18, height: 18 }}
          >
            {view.icon ? (
              <span className="text-row leading-none">{view.icon}</span>
            ) : (
              <LayoutGlyph layout={effectiveLayout} />
            )}
          </button>
        )}
      >
        {(close) => (
          <EmojiPicker
            removable
            onPick={(e) => {
              onSet(e);
              close();
            }}
          />
        )}
      </Popover>
    </span>
  );
}

/* Team view row — non-owners get a short menu; owners also get Unpublish. */
function TeamViewRow({
  v,
  active,
  count,
  renderCount,
  isOwner,
  isWorkspaceOwner,
  memberCount,
  pages,
  ctx,
  onHide,
}: {
  v: ViewRow;
  active: boolean;
  count: number | "!";
  renderCount: (c: number | "!", size: string) => ReactNode;
  isOwner: boolean;
  isWorkspaceOwner: boolean;
  memberCount: number;
  pages: PageListItem[];
  ctx: { me: string; staleDays: number };
  onHide: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const fork = useForkView();
  const unpublish = useUnpublishView();
  const navigate = useNavigate();
  const toast = useToast();
  const drafts = useDrafts();

  const effectiveLayout = layoutOf(v, drafts);

  const build = (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }): MenuSpec => {
    const filters = (v.filter ?? []) as Filter[];
    const sort = (v.sort as SortSpec | null) ?? { prop: "edited", dir: "desc" };
    const total = pages.length;
    const matched = runView(pages, { filter: filters, sort }, ctx).length;
    const footer = personalViewFooter({
      matchCount: matched,
      totalCount: total,
      sortLabel: sortLabelFor(sort),
    });

    const rows: MenuRow[] = [
      {
        kind: "row",
        label: "Open view",
        icon: "open",
        hint: { text: "↵", mono: true },
        onPick: () => {
          navigate({ to: "/v/$viewId", params: { viewId: v.id } });
          mctx.close();
        },
      },
      { kind: "sep" },
      {
        kind: "row",
        label: "Change layout",
        icon: "layout",
        hint: { text: LAYOUT_ROWS.find((r) => r.layout === effectiveLayout)?.label ?? "Table" },
        onPick: () =>
          mctx.setSpec(
            buildLayoutSubmenu(effectiveLayout, (l) => {
              // Team views: session-only draft, never persisted from the row.
              storePatchDraft(v.id, { layout: l }, {
                filter: filters,
                sort,
                layout: v.layout,
                group_by: null,
              });
            }, mctx.close),
          ),
      },
      {
        kind: "row",
        label: "Duplicate into My views",
        icon: "dup",
        hint: { text: "personal" },
        onPick: () => {
          fork.mutate({
            viewId: v.id,
            name: `${v.name} copy`,
            filter: filters,
            sort,
            layout: v.layout,
          });
          mctx.close();
        },
      },
      {
        kind: "row",
        label: "Copy link",
        icon: "link",
        hint: { text: "⌘⌥L", mono: true },
        onPick: () => {
          void navigator.clipboard?.writeText?.(copyViewLink(v.id));
          toast.push(`Copied link to "${v.name}"`);
          mctx.close();
        },
      },
      { kind: "sep" },
      {
        kind: "row",
        label: "Hide from my sidebar",
        icon: "eyeOff",
        onPick: () => {
          onHide(v.id);
          mctx.close();
        },
      },
      ...(isOwner && isWorkspaceOwner
        ? ([
            { kind: "sep" },
            {
              kind: "row",
              label: "Unpublish",
              icon: "arrow",
              hint: { text: "back to mine" },
              danger: true,
              onPick: () =>
                mctx.setSpec({
                  title: `Unpublish "${v.name}"?`,
                  rows: [],
                  confirm: {
                    title: `Unpublish "${v.name}"?`,
                    body: `The view leaves Team views and returns to your My views. The pages it filtered are untouched. Only workspace owners can publish or unpublish team views. (${memberCount} members)`,
                    cta: "Unpublish",
                    danger: true,
                    onConfirm: () => unpublish.mutate(v.id),
                  },
                }),
            },
          ] satisfies MenuRow[])
        : []),
    ];

    return { title: "Team view", rows, footer };
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
        style={{ height: "var(--spacing-rowTeam)" }}
        className={rowClass(active)}
      >
        <span
          className="grid place-items-center"
          style={{ width: 18, height: 18 }}
        >
          <LayoutGlyph layout={effectiveLayout} />
        </span>
        <span className="min-w-0 flex-1 truncate text-meta text-secondary">
          {v.name}
        </span>
        <span
          className="relative flex items-center justify-end"
          style={{ height: 17, minWidth: 17 }}
        >
          {hover ? (
            <SpecMenuTrigger size="sm" build={build} />
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
  deletePage: ReturnType<typeof useDeletePage>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [hover, setHover] = useState(false);
  const toast = useToast();
  const createAndOpen = useCreatePageAndOpen();
  const createView = useCreateView();
  const renameArea = useRenameArea();
  const setAreaIcon = useSetAreaIcon();
  const clearArea = useClearArea();
  const [emojiOpen, setEmojiOpen] = useState(false);

  const staleCount = items.reduce((n, p) => n + (isStale(p) ? 1 : 0), 0);
  const footer = areaMenuFooter({
    pages: items.map((p) => ({ edited_at: p.edited_at, edited_by: p.edited_by })),
    members: members.map((m) => ({
      user_id: m.user_id,
      full_name: m.profiles?.full_name ?? null,
      email: m.profiles?.email ?? null,
    })),
    needsReverify: staleCount,
  });

  const buildAreaSpec = (ctx: { setSpec: (s: MenuSpec) => void; close: () => void }): MenuSpec => {
    const listSpec: MenuSpec = {
      title: `${area} · ${count} ${count === 1 ? "page" : "pages"}`,
      footer: footer || undefined,
      rows: [
        {
          kind: "row",
          label: "Open area",
          icon: "open",
          hint: { text: "↵", mono: true },
          onPick: () => {
            navigate({ to: "/a/$area", params: { area } });
            ctx.close();
          },
        },
        {
          kind: "row",
          label: open ? "Collapse pages" : "Show pages",
          icon: open ? "chevUp" : "chevDown",
          hint: { text: String(count) },
          onPick: () => {
            onToggle();
            ctx.close();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: "New page here",
          icon: "plus",
          hint: { text: "area preset" },
          onPick: () => {
            void createAndOpen({ seedProps: { area } });
            ctx.close();
          },
        },
        {
          kind: "row",
          label: "Rename area",
          icon: "pencil",
          hint: { text: `${count} ${count === 1 ? "page" : "pages"} follow` },
          onPick: () =>
            ctx.setSpec({
              title: `Rename "${area}"`,
              rows: [],
              input: {
                placeholder: "Area name",
                initial: area,
                selectOnFocus: true,
                onCommit: (v) => {
                  if (v && v !== area) renameArea.mutate({ from: area, to: v });
                },
              },
              footer: "Every page with this area follows.",
            }),
        },
        {
          kind: "row",
          label: "Save as my view",
          icon: "bookmark",
          hint: { text: "personal" },
          onPick: () => {
            createView.mutate({
              name: area,
              filter: [{ op: "eq", prop: "area", value: area }],
              sort: { prop: "edited", dir: "desc" },
              layout: "table",
            });
            ctx.close();
          },
        },
        {
          kind: "row",
          label: "Copy link",
          icon: "link",
          hint: { text: "⌘⌥L", mono: true },
          onPick: () => {
            const origin =
              typeof window !== "undefined" && window.location ? window.location.origin : "";
            const url = `${origin}/a/${encodeURIComponent(area)}`;
            void navigator.clipboard?.writeText?.(url);
            toast.push(`Copied link to "${area}"`);
            ctx.close();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: `Clear area on ${count} ${count === 1 ? "page" : "pages"}`,
          icon: "clear",
          danger: true,
          onPick: () =>
            ctx.setSpec({
              title: listSpec.title,
              rows: [],
              confirm: {
                title: `Clear "${area}"?`,
                body:
                  count === 0
                    ? "The area has no pages — it will just disappear from your sidebar."
                    : `The area is removed from ${count} ${count === 1 ? "page" : "pages"}. The pages themselves are kept.`,
                cta: "Clear area",
                danger: true,
                onConfirm: () => clearArea.mutate(area),
              },
            }),
        },
      ],
    };
    return listSpec;
  };



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
          <AreaEmojiSlot
            icon={icon}
            emojiOpen={emojiOpen}
            setEmojiOpen={setEmojiOpen}
            hoverRow={hover}
            onPick={(e) => setAreaIcon.mutate({ area, emoji: e })}
          />

          <span className="min-w-0 flex-1 truncate text-row">{area}</span>
          <span
            className="relative flex items-center justify-end"
            style={{ height: 17, minWidth: 17 }}
          >
            {hover ? (
              <SpecMenuTrigger size="sm" build={buildAreaSpec} />
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
              deletePage={deletePage}
              navigate={navigate}
            />
          ))}
          <li>
            <button
              type="button"
              onClick={() => void createAndOpen({ seedProps: { area } })}
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

// AreaMenu now lives inline as `buildAreaSpec` inside AreaLi (chunk 2a).



/**
 * Emoji slot for an area row — clickable target that opens the shared
 * picker. On rows with no emoji, a subtle dashed 18px placeholder appears
 * only when the outer row is hovered. `emojiOpen` is controlled by the
 * area row so the "Change emoji" menu item can open the picker without a
 * click on the slot.
 */
function AreaEmojiSlot({
  icon,
  emojiOpen,
  setEmojiOpen,
  hoverRow,
  onPick,
}: {
  icon: string | null | undefined;
  emojiOpen: boolean;
  setEmojiOpen: (v: boolean) => void;
  hoverRow: boolean;
  onPick: (emoji: string | null) => void;
}) {
  return (
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Popover
        onOpenChange={setEmojiOpen}
        width={264}
        trigger={({ onClick, ref }) => {
          // Sync external open request from the menu.
          if (emojiOpen && !ref) return null;
          return (
            <button
              ref={ref}
              type="button"
              aria-label="Change area emoji"
              onClick={(e) => {
                e.preventDefault();
                onClick();
              }}
              className="grid place-items-center rounded-sm hover:bg-sunken"
              style={{ width: 18, height: 18 }}
            >
              {icon ? (
                <span className="text-row leading-none">{icon}</span>
              ) : hoverRow ? (
                <span
                  aria-hidden
                  className="inline-block rounded-full border border-dashed border-line"
                  style={{ width: 12, height: 12 }}
                />
              ) : null}
            </button>
          );
        }}
      >
        {(close) => (
          <EmojiPicker
            removable
            onPick={(e) => {
              onPick(e);
              close();
            }}
          />
        )}
      </Popover>
    </span>
  );
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
  deletePage: ReturnType<typeof useDeletePage>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [hover, setHover] = useState(false);
  const toast = useToast();
  const restorePage = useRestorePage();
  const onDeleteWithUndo = (row: PageListItem) => {
    const snap = row;
    deletePage.mutate(row.id, {
      onSuccess: () => {
        toast.push({
          message: "Page deleted — it left every view at once.",
          action: {
            label: "Undo",
            onClick: () => restorePage.mutate({ pageId: snap.id, row: snap }),
          },
          durationMs: 10_000,
        });
      },
    });
  };
  const props =
    p.props && typeof p.props === "object" && !Array.isArray(p.props)
      ? (p.props as Record<string, unknown>)
      : {};

  const editedByFirstName = firstNameOf(
    members.find((m) => m.user_id === p.edited_by),
  );

  const build = (mctx: {
    setSpec: (s: MenuSpec) => void;
    close: () => void;
  }): MenuSpec =>
    buildPageRowSpec(
      {
        p,
        isStale,
        propDefs,
        members,
        editedByFirstName,
        onOpen: () =>
          navigate({ to: "/p/$pageId", params: { pageId: p.id } }),
        onVerify: () => onVerify(p.id),
        onSetStatus: (v) =>
          setPageProperty.mutate({ pageId: p.id, key: "status", value: v }),
        onSetOwner: (uid) =>
          setPageProperty.mutate({ pageId: p.id, key: "owner", value: uid }),
        onMoveArea: (a) => moveToArea.mutate({ pageId: p.id, area: a }),
        onDelete: () => onDeleteWithUndo(p),
      },
      mctx,
    );
  void me;
  void props;
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
          {hover ? (
            <SpecMenuTrigger
              size="sm"
              ariaLabel="Page actions"
              build={build}
            />
          ) : null}
        </span>
      </Link>
    </li>
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

/* Legacy MoreButton / MenuItem / MenuDivider removed: the whole product now
   goes through <RowMenuProvider> + <MoreButton> + <RowMenuList> in
   src/components/row-menu.tsx. If a surface needs a ⋯ dropdown, import
   MoreButton from there — do NOT reintroduce a local variant. */

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
  const registerArea = useRegisterArea();
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
      // Register the area in property_defs. No page is created — areas
      // are queries over pages, not containers. The area view will render
      // its empty state until a page's props.area matches.
      await registerArea.mutateAsync(trimmed);

      onClose();
      navigate({ to: "/a/$area", params: { area: trimmed } });
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
