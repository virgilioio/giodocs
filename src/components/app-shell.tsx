import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { COMPACT_QUERY, useIsCompact, useIsPhone } from "@/lib/use-media";
import {
  BottomSheet,
  PhoneBottomBar,
  PhoneTopTabs,
  RecentsCard,
  SheetGroup,
  SheetRow,
  type PhoneTab,
} from "./phone-shell";
import { primaryMod } from "@/lib/platform";
import { toClipboard } from "@/lib/clipboard";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useRealtimeWorkspace } from "@/hooks/use-realtime";
import { getPageOrigin, setPageOrigin } from "@/lib/page-origin";
import { Ico } from "./emoji-icon";
import { PageBreadcrumb } from "./page-breadcrumb";
import { SidebarTreeView, useTreeExpanded, type TreeNode } from "./sidebar-tree";
import { DRAG_TYPE, draggedPage } from "@/lib/page-drag";
import type { MoveTarget } from "@/lib/page-tree";
import { useEmojiSet } from "@/hooks/use-custom-emoji";
import { setInlineEmojiSet } from "@/lib/emoji-registry";
import { mentionPage, setMentionDirectory } from "@/lib/mention-directory";
import { InboxButton, InboxPanel } from "./inbox";
import { useInboxUnread } from "@/hooks/use-visible-inbox";
import { TemplatesButton, TemplatesPanel } from "./templates-panel";
import { TrashPanel } from "./trash-panel";
import { FavoritesList } from "./favorites-list";
import { useFavoritePages } from "@/hooks/use-favorites";
import { useInboxRealtime } from "@/hooks/use-inbox";
import { describeNotification, openNotificationTarget } from "@/lib/inbox-text";
import { openComments } from "@/lib/comments-store";
import { resolvePageIdParam } from "@/lib/slug";

import {
  useCreatePageAndOpen,
  useDeletePage,
  useMovePage,
  useRestorePage,
  useShareToWorkspace,
} from "@/hooks/use-page-mutations";

import { useToast } from "@/lib/toast";
import type { PageListItem } from "@/lib/types";
import { DatabaseView } from "./database-view";
import { PageSkeleton, ViewSkeleton } from "./skeletons";
import { PhoneHomeSkeleton, PhonePageButtonsSkeleton, PhoneRecentRowsSkeleton } from "./phone-skeletons";
import { useDelayedPending } from "./sk";
import { PageEditor } from "./page-view";
import { PageTopbarActions } from "./page-topbar-actions";
import { CommandPalette } from "./command-palette";
import { SettingsModal, type SettingsPane } from "./settings-modal";
import { AddMembersModal } from "./add-members-modal";
import { useWorkspaceInvites, useCancelInvite } from "@/hooks/use-invites";
import { RowMenuProvider, SpecMenuTrigger, type MenuSpec } from "./row-menu";
import { descendantsOf } from "@/lib/page-tree";
import { useAllowedDomains } from "@/hooks/use-workspace-data";
import { isTypingTarget } from "@/lib/is-typing";
import { exitOnly } from "@/lib/exit-motion";
import { HomeView } from "./home-view";
import { PagePeek } from "./page-peek";
import { usePeek } from "@/lib/peek";
import { useHomePrefs, useRecentVisits, useRecordVisit, useToggleFavorite } from "@/hooks/use-home";
import { recentPages, startTarget } from "@/lib/home";

const HOME_GLYPH = "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10";

/* What the URL points at. A database page and a plain page share /p/:id;
 * the pages list says which it is. /v/:id and /a/:area are old links that
 * redirect. */
type Selection =
  | { kind: "database"; id: string; viewId: string | null }
  | { kind: "page"; id: string }
  | { kind: "old-view"; id: string }
  | { kind: "old-area" }
  | { kind: "home" }
  | null;

// gio.sidebarOpen — boolean, default true. Renamed from an earlier
// "collapsed" flag: the topbar toggle and ⌘\ keybind read/write this,
// and the rendered rail width is `open ? sidebarWidth : 0`. Preserving
// the user's chosen width across a collapse is the point — see R1 in
// the task brief.
const SIDEBAR_OPEN_KEY = "gio.sidebarOpen";
const SECTION_KEY = "gio.sidebar.sections"; // JSON { private, workspace }
const SIDEBAR_W_KEY = "gio.sidebarWidth";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 460;
const SIDEBAR_DEFAULT = 240;

/** The route's page id and `?v=` view, before the pages list says what
 * kind of page it is. */
function useRouteTarget(): { pageId: string; viewId: string | null } | { oldView: string } | "old-area" | "home" | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as { v?: unknown };
  const viewParams = useParams({ strict: false }) as {
    viewId?: string;
    area?: string;
    pageId?: string;
  };
  if (pathname.startsWith("/v/") && viewParams.viewId) return { oldView: viewParams.viewId };
  if (pathname.startsWith("/a/")) return "old-area";
  if (pathname === "/home") return "home";
  if (pathname.startsWith("/p/") && viewParams.pageId) {
    return { pageId: viewParams.pageId, viewId: typeof search.v === "string" ? search.v : null };
  }
  return null;
}


export function AppShell() {
  const workspaceId = useWorkspaceId();
  // The inline layer (tokenizer + offset map + renderer) reads the custom
  // emoji set from ONE module registry so its consumers cannot disagree.
  // This is the single writer, fed by the same query every <Ico> reads.
  const emojiSet = useEmojiSet();
  useEffect(() => {
    setInlineEmojiSet(emojiSet);
  }, [emojiSet]);
  const shell = useWorkspaceShell(workspaceId);
  // @mentions show live names and titles from one module directory; this
  // is its single writer (src/lib/mention-directory.ts).
  useEffect(() => {
    if (!shell.members.data || !shell.pages.data) return;
    const members = shell.members.data as unknown as Array<{
      user_id: string;
      profiles: { full_name: string | null; email: string | null } | null;
    }>;
    const users = new Map<string, string>();
    for (const m of members) {
      const name = m.profiles?.full_name?.trim() || m.profiles?.email?.split("@")[0] || "";
      if (name) users.set(m.user_id, name);
    }
    const pages = new Map<string, { title: string; icon: string | null }>();
    for (const p of shell.pages.data as PageListItem[]) {
      pages.set(p.id, { title: p.title ?? "", icon: p.icon ?? null });
    }
    setMentionDirectory({ users, pages });
  }, [shell.members.data, shell.pages.data]);
  useRealtimeWorkspace(workspaceId);
  // A mention arrives live: the inbox updates and a toast offers to open it.
  const { user: me } = useAuth();
  const inboxToast = useToast();
  const inboxNavigate = useNavigate();
  useInboxRealtime(me?.id, (n) => {
    if (!mentionPage(n.page_id)) return; // a page they can't open
    const d = describeNotification(n);
    inboxToast.push({
      message: `${d.who} ${d.what} ${d.page}`,
      action: {
        label: "Open",
        onClick: () => openNotificationTarget(n, inboxNavigate, openComments),
      },
    });
  });
  const target = useRouteTarget();
  const pagesData = shell.pages.data;
  const pagesForResolve = useMemo(() => (pagesData ?? []) as PageListItem[], [pagesData]);
  const pagesLoaded = !!pagesData;
  const selection = useMemo<Selection>(() => {
    if (target === null) return null;
    if (target === "old-area") return { kind: "old-area" };
    if (target === "home") return { kind: "home" };
    if ("oldView" in target) return { kind: "old-view", id: target.oldView };
    // The URL may be the raw UUID or the cosmetic slug-shortId form emitted
    // by Copy link. Resolve to the canonical id so downstream queries hit.
    const resolved = resolvePageIdParam(target.pageId, pagesForResolve);
    const listed = pagesForResolve.find((p) => p.id === resolved);
    if (listed?.is_database) return { kind: "database", id: resolved, viewId: target.viewId };
    return { kind: "page", id: resolved };
  }, [target, pagesForResolve]);
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    // Default OPEN when the key is absent — new users see the rail.
    const raw = window.localStorage.getItem(SIDEBAR_OPEN_KEY);
    return raw === null ? true : raw === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_OPEN_KEY, sidebarOpen ? "1" : "0");
    }
  }, [sidebarOpen]);

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
  const shellRootRef = useRef<HTMLDivElement | null>(null);
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
  const [sidebarPopover, setSidebarPopover] = useState<"new" | null>(null);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  // Phones get their own frame; tablets and narrow windows keep the
  // desktop one with the sidebar over the page (closed until opened).
  const phone = useIsPhone();
  const compact = useIsCompact() && !phone;
  const [railOpen, setRailOpen] = useState(false);
  const [recentsOpen, setRecentsOpen] = useState(false);
  const [accountSheet, setAccountSheet] = useState(false);
  const [trashSheet, setTrashSheet] = useState(false);
  const phoneTab = useRouterState({
    select: (s) => (s.location.search as { tab?: unknown }).tab,
  }) as unknown;
  const newPage = useCreatePageAndOpen();
  const inboxUnread = useInboxUnread();

  const domainsQ = useAllowedDomains(workspaceId);
  const allowedDomains = domainsQ.data ?? [];

  const openSettings = (p: SettingsPane = "preferences") => {
    setSettingsPane(p);
    setSettingsOpen(true);
  };
  const closeSettings = () => setSettingsOpen(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (primaryMod(e) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (primaryMod(e) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
        return;
      }
      // ⌘\ toggles the sidebar. Guard against typing targets so it does
      // not fire while editing text — same rule as every other global
      // shortcut in this handler.
      if (primaryMod(e) && e.key === "\\") {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        setSidebarPopover(null);
        setAccountMenu(false);
        if (window.matchMedia?.(COMPACT_QUERY).matches) setRailOpen((v) => !v);
        else setSidebarOpen((v) => !v);
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

  const pages = pagesForResolve;
  const viewsData = shell.views.data;
  const views = useMemo(() => viewsData ?? [], [viewsData]);
  const workspace = shell.workspace.data;
  const { user, profile } = useAuth();
  const memberCount = shell.members.data?.length ?? 0;
  const workspaceName = workspace?.name ?? "";

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The root URL opens the start page the person chose: Home (the default)
  // or the last page they visited. Old /v and /a links go to the database
  // their view belongs to. On /p we never redirect: a transient null
  // selection during router transitions used to bounce the user back to
  // the previous view.
  const homePrefsQ = useHomePrefs();
  const visitsQ = useRecentVisits(workspaceId);
  const startPage = homePrefsQ.data?.start_page ?? (homePrefsQ.isError ? "home" : null);
  useRecordVisit(
    workspaceId,
    selection?.kind === "page" || selection?.kind === "database" ? selection.id : null,
  );
  useEffect(() => {
    if (!pagesLoaded) return;
    if (pathname === "/") {
      if (startPage === null) return;
      if (startPage === "last" && visitsQ.isLoading) return;
      const to = startTarget(startPage, visitsQ.data ?? [], pages);
      if (to.to === "page") navigate({ to: "/p/$pageId", params: { pageId: to.id }, replace: true });
      else navigate({ to: "/home", replace: true });
      return;
    }
    if (selection?.kind === "old-view") {
      if (shell.views.isLoading) return;
      const v = views.find((x) => x.id === selection.id);
      if (v) {
        navigate({
          to: "/p/$pageId",
          params: { pageId: v.database_id },
          search: { v: v.id },
          replace: true,
        });
      } else navigate({ to: "/", replace: true });
      return;
    }
    if (selection?.kind === "old-area") navigate({ to: "/", replace: true });
  }, [pathname, pages, pagesLoaded, views, shell.views.isLoading, selection, navigate, startPage, visitsQ.isLoading, visitsQ.data]);

  // On page routes, a back arrow returns to the database view the page was
  // opened from, when there is one; the breadcrumb shows where it lives.
  const pageBack = useMemo(() => {
    if (!selection || selection.kind !== "page") return null;
    const origin = getPageOrigin(selection.id);
    if (origin?.kind === "database") {
      return {
        label: origin.name,
        to: "/p/$pageId" as const,
        params: { pageId: origin.databaseId },
        search: origin.viewId ? { v: origin.viewId } : {},
      };
    }
    return null;
  }, [selection]);




  // The sidebar over the page closes when a page opens (here or in the
  // dialog).
  const selectionKey = selection ? JSON.stringify(selection) : "";
  const peekId = usePeek()?.id ?? null;
  useEffect(() => {
    setRailOpen(false);
    setRecentsOpen(false);
    setPageMenuOpen(false);
  }, [selectionKey, peekId]);

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

  const showShellSkeleton = useDelayedPending(!selection || !pagesLoaded);

  const loading = shell.pages.isLoading || shell.workspace.isLoading;

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarOpen) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setResizing(true);
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }
    // Follow the pointer by writing the CSS variable directly: the whole
    // app shell doesn't re-render (and localStorage isn't written) on every
    // pixel. React state and storage are updated once, on release.
    let lastW = startW;
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)),
      );
      lastW = next;
      shellRootRef.current?.style.setProperty("--gio-sidebar-w", `${next}px`);
    };
    const onUp = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setResizing(false);
      setSidebarWidth(lastW);
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const sidebarProps = {
    loading,
    pages,
    selection,
    profile,
    userEmail: user?.email ?? "",
    initials,
    workspaceName,
    workspaceIcon: workspace?.icon ?? "📄",
    memberCount,
    accountMenu,
    onOpenAccountMenu: () => setAccountMenu(true),
    onCloseAccountMenu: () => setAccountMenu(false),
    onSignOut: handleSignOut,
    onOpenSettings: () => openSettings("preferences"),
    onOpenInvite: () => {
      setAccountMenu(false);
      openSettings("people");
      setMembersTab("members");
      // Managed in Gio OS: People opens without the add dialog (it says where to go).
      if (!(workspace as { members_managed_by_os?: boolean } | null | undefined)?.members_managed_by_os) setInviteOpen(true);
    },
    onOpenPalette: () => setPaletteOpen(true),
  };
  const modals = (
    <>
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
    </>
  );

  if (phone) {
    // The address decides the frame, so a page keeps its floating buttons
    // while the page list is still on its way.
    const pageSel = selection?.kind === "page" || selection?.kind === "database" ? selection : null;
    const onPage =
      !!pageSel ||
      pathname.startsWith("/p/") ||
      pathname.startsWith("/v/");
    const tab: PhoneTab = phoneTab === "inbox" || phoneTab === "templates" ? phoneTab : "home";
    return (
      <RowMenuProvider>
        <div className="flex h-dvh flex-col bg-surface" data-phone-shell>
          {onPage ? null : (
            <PhoneTopTabs
              tab={tab}
              unread={inboxUnread}
              workspaceIcon={workspace?.icon ?? "📄"}
              workspaceName={workspaceName}
              onAccount={() => setAccountSheet(true)}
            />
          )}
          <main
            className={`gio-phone-main min-w-0 flex-1 overflow-y-auto bg-surface ${onPage ? "gio-phone-page" : ""}`}
            data-phone-main
          >
            {selection?.kind === "database" ? (
              <DatabaseView key={`d:${selection.id}`} selection={selection} />
            ) : selection?.kind === "page" && pagesLoaded ? (
              <PageEditor key={selection.id} pageId={selection.id} />
            ) : selection?.kind === "home" ? (
              tab === "inbox" ? (
                <div className="gio-phone-panel px-3 pt-1">
                  <InboxPanel close={() => undefined} page />
                </div>
              ) : tab === "templates" ? (
                <div className="gio-phone-panel px-3 pt-1">
                  <TemplatesPanel close={() => undefined} />
                </div>
              ) : pagesLoaded && pages.length === 0 ? (
                <EmptyWorkspace />
              ) : (
                <SidebarBody {...sidebarProps} phone />
              )
            ) : showShellSkeleton ? (
              onPage ? <PageSkeleton /> : <PhoneHomeSkeleton />
            ) : null}
          </main>
          {onPage && !pageSel ? <PhonePageButtonsSkeleton /> : null}
          {pageSel ? (
            <PageTopbarActions
              phone
              pageId={pageSel.id}
              menuOpen={pageMenuOpen}
              onMenuOpen={() => setPageMenuOpen(true)}
              onMenuClose={() => setPageMenuOpen(false)}
            />
          ) : null}
          <PhoneBottomBar
            onMenu={onPage ? () => setRecentsOpen(true) : undefined}
            onSearch={() => setPaletteOpen(true)}
            onNew={() => void newPage({ seedProps: {} })}
          />
          {recentsOpen ? (
            <RecentsCard
              onClose={() => setRecentsOpen(false)}
              onSearch={() => setPaletteOpen(true)}
              currentId={pageSel?.id}
            />
          ) : null}
          {accountSheet ? (
            <BottomSheet title={workspaceName || "Workspace"} onClose={() => setAccountSheet(false)}>
              <SheetGroup>
                <div className="flex items-center" style={{ gap: 14, padding: "12px 16px" }}>
                  <span
                    className="grid shrink-0 place-items-center rounded-full"
                    style={{
                      width: 40,
                      height: 40,
                      fontSize: 14,
                      fontWeight: 700,
                      background: profile?.avatar_tint ? `var(--color-${profile.avatar_tint})` : "var(--color-sunken)",
                      color: profile?.avatar_ink ? `var(--color-${profile.avatar_ink})` : "var(--color-strong)",
                    }}
                  >
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-strong" style={{ fontSize: 17, fontWeight: 700 }}>
                      {profile?.full_name || user?.email}
                    </span>
                    <span className="block truncate text-ui text-muted">
                      {workspaceName} · {memberCount} {memberCount === 1 ? "person" : "people"}
                    </span>
                  </span>
                </div>
              </SheetGroup>
              <SheetGroup>
                <SheetRow
                  icon="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
                  label="Settings"
                  onClick={() => {
                    setAccountSheet(false);
                    openSettings("preferences");
                  }}
                />
                <SheetRow
                  icon="M9 3.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM2 20.4v-1.8a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1.8M19 8v6M16 11h6"
                  label="Invite people"
                  onClick={() => {
                    setAccountSheet(false);
                    sidebarProps.onOpenInvite();
                  }}
                />
              </SheetGroup>
              <SheetGroup>
                <SheetRow
                  icon="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"
                  label="Trash"
                  onClick={() => {
                    setAccountSheet(false);
                    setTrashSheet(true);
                  }}
                />
              </SheetGroup>
              <SheetGroup>
                <SheetRow
                  icon="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"
                  label="Log out"
                  danger
                  onClick={() => {
                    setAccountSheet(false);
                    void handleSignOut();
                  }}
                />
              </SheetGroup>
            </BottomSheet>
          ) : null}
          {trashSheet ? (
            <BottomSheet title="Trash" onClose={() => setTrashSheet(false)}>
              <div className="gio-phone-panel">
                <TrashPanel page close={() => setTrashSheet(false)} />
              </div>
            </BottomSheet>
          ) : null}
          {modals}
        </div>
      </RowMenuProvider>
    );
  }

  const railShown = compact ? railOpen : sidebarOpen;
  const toggleRail = () => {
    setSidebarPopover(null);
    setAccountMenu(false);
    if (compact) setRailOpen((v) => !v);
    else setSidebarOpen((v) => !v);
  };

  return (
    <RowMenuProvider>
    <div
      ref={shellRootRef}
      className="flex h-screen overflow-hidden bg-canvas"
      style={{ "--gio-sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
    >
      {compact && railOpen ? (
        <div
          ref={exitOnly("fade")}
          className="fixed inset-0 z-40 animate-fadeIn"
          style={{ background: "rgba(13,13,9,.18)" }}
          onClick={() => setRailOpen(false)}
          aria-hidden
        />
      ) : null}
      {compact && !railOpen ? null : (
      <div
        ref={compact ? exitOnly("rail") : undefined}
        style={
          compact
            ? { width: "var(--gio-sidebar-w)" }
            : {
                width: sidebarOpen ? "var(--gio-sidebar-w)" : 0,
                transition: resizing ? "none" : "width var(--dur-sidebar) var(--ease-in-out)",
              }
        }
        data-sidebar={compact ? "over" : "beside"}
        className={
          compact
            ? "gio-rail-over fixed inset-y-0 left-0 z-50 overflow-hidden border-r border-line bg-rail"
            : "relative shrink-0 overflow-hidden border-r border-line bg-rail"
        }
      >
        <div
          style={{ width: "var(--gio-sidebar-w)" }}
          className="flex h-screen flex-col"
        >
          <SidebarBody {...sidebarProps} />
        </div>
        {sidebarOpen && !compact && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={startResize}
            onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
            className="group absolute inset-y-0 z-20"
            style={{
              right: -2,
              width: 5,
              cursor: "col-resize",
              touchAction: "none",
            }}
          >
            <span
              aria-hidden
              className={
                "absolute inset-y-0 left-1/2 -translate-x-1/2 " +
                (resizing
                  ? "bg-lineStrong"
                  : "bg-transparent group-hover:bg-lineStrong")
              }
              style={{ width: 1 }}
            />
          </div>
        )}
      </div>
      )}


      <div className="flex min-w-0 flex-1 flex-col">
        <header
          style={{ height: "var(--spacing-topbar)" }}
          className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3"
        >
          {/* Sidebar toggle — first child, present on views AND pages, never
              moves. Same panel glyph in both states: a chevron would
              promise a direction the button does not deliver. */}
          <button
            type="button"
            // Close popovers anchored to sidebar rows — their anchor is
            // about to move or vanish.
            onClick={toggleRail}
            aria-expanded={railShown}
            aria-label={railShown ? "Hide sidebar" : "Show sidebar"}
            title={railShown ? "Hide sidebar  ⌘\\" : "Show sidebar  ⌘\\"}
            className="inline-flex items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ width: 26, height: 26, flex: "none", cursor: "pointer" }}
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
          {pageBack ? (
            <Link
              to={pageBack.to}
              params={pageBack.params}
              search={pageBack.search}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-secondary hover:bg-rail hover:text-strong"
              title={`Back to ${pageBack.label}`}
            >
              <Glyph path="M15 6l-6 6 6 6" className="h-4 w-4" />
              <span className="min-w-0 truncate">{pageBack.label}</span>
            </Link>
          ) : null}
          {selection && (selection.kind === "page" || selection.kind === "database") ? (
            <PageBreadcrumb pageId={selection.id} pages={pages} />
          ) : selection?.kind === "home" ? (
            <span className="flex items-center gap-1.5 px-1.5 text-ui text-strong">
              <Glyph path={HOME_GLYPH} className="h-4 w-4 text-muted" />
              Home
            </span>
          ) : null}

          {selection && (selection.kind === "page" || selection.kind === "database") ? (
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
          {selection?.kind === "database" ? (
            <DatabaseView key={`d:${selection.id}`} selection={selection} />
          ) : selection?.kind === "page" && pagesLoaded ? (
            <PageEditor key={selection.id} pageId={selection.id} />
          ) : selection?.kind === "home" ? (
            <HomeView
              empty={pagesLoaded && pages.length === 0 ? <EmptyWorkspace /> : undefined}
              onOpenPalette={() => setPaletteOpen(true)}
              onOpenSettings={() => openSettings("preferences")}
            />
          ) : showShellSkeleton ? (
            <ViewSkeleton layout="table" />
          ) : null}
        </main>
      </div>
      {modals}
      <PagePeek />

    </div>
    </RowMenuProvider>
  );
}



/* ─────────────────── Sidebar: the page tree ─────────────────── */

type SectionKey = "private" | "workspace";
type SectionState = Record<SectionKey | "favorites" | "recents", boolean>;

function useSectionState(): [SectionState, (k: SectionKey | "favorites" | "recents") => void] {
  const [state, setState] = useState<SectionState>(() => {
    if (typeof window === "undefined") return { private: true, workspace: true, favorites: true, recents: true };
    try {
      const raw = window.localStorage.getItem(SECTION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SectionState>;
        return {
          private: parsed.private !== false,
          workspace: parsed.workspace !== false,
          favorites: parsed.favorites !== false,
          recents: parsed.recents !== false,
        };
      }
    } catch {
      /* ignore */
    }
    return { private: true, workspace: true, favorites: true, recents: true };
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SECTION_KEY, JSON.stringify(state));
    }
  }, [state]);
  const toggle = (k: SectionKey | "favorites" | "recents") => setState((prev) => ({ ...prev, [k]: !prev[k] }));
  return [state, toggle];
}

/** The "+" beside a section: a page or a database at the top level. */
function NewTopLevelMenu({
  section,
  onCreate,
}: {
  section: SectionKey;
  onCreate: (kind: "page" | "database") => void;
}) {
  const where = section === "workspace" ? "everyone in the workspace" : "only you, until shared";
  return (
    <SpecMenuTrigger
      size="sm"
      ariaLabel={section === "workspace" ? "New in Workspace" : "New in Private"}
      build={(mctx) => ({
        title: section === "workspace" ? "New in Workspace" : "New in Private",
        rows: [
          {
            kind: "row",
            label: "New page",
            icon: "bPage",
            onPick: () => {
              onCreate("page");
              mctx.close();
            },
          },
          {
            kind: "row",
            label: "New database",
            icon: "bTable",
            hint: { text: "rows, properties, views" },
            onPick: () => {
              onCreate("database");
              mctx.close();
            },
          },
        ],
        footer: `Visible to ${where}.`,
      })}
    />
  );
}

function SidebarBody({
  loading,
  pages,
  selection,
  profile,
  userEmail,
  initials,
  workspaceName,
  workspaceIcon,
  memberCount,
  accountMenu,
  onOpenAccountMenu,
  onCloseAccountMenu,
  onSignOut,
  onOpenSettings,
  onOpenInvite,
  onOpenPalette,
  phone = false,
}: {
  /** The phone's Home tab: Recents, Favorites, Workspace and Private as
   *  big touch rows, without the sidebar's search, links and account. */
  phone?: boolean;
  loading: boolean;
  pages: PageListItem[];
  selection: Selection;
  profile: { full_name: string; avatar_tint: string; avatar_ink: string } | null;
  userEmail: string;
  initials: string;
  workspaceName: string;
  workspaceIcon: string;
  memberCount: number;
  accountMenu: boolean;
  onOpenAccountMenu: () => void;
  onCloseAccountMenu: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
  onOpenInvite: () => void;
  onOpenPalette: () => void;
}) {
  const [sections, toggleSection] = useSectionState();
  const navigate = useNavigate();
  const toast = useToast();
  const createAndOpen = useCreatePageAndOpen();
  const deletePage = useDeletePage();
  const restorePage = useRestorePage();
  const shareToWorkspace = useShareToWorkspace();
  const movePage = useMovePage();
  const [expanded, toggleExpanded, openExpanded] = useTreeExpanded();
  const [headerOver, setHeaderOver] = useState<SectionKey | null>(null);
  const favorites = useFavoritePages();
  const favoriteIds = useHomePrefs().data?.favorite_pages ?? [];
  const toggleFavorite = useToggleFavorite();

  /* A drag in the tree. Top level means the section's: a private page
   * dropped at the top of Workspace is shared with everyone; a shared page
   * isn't made private by a drag (that's a change of who can see it, made
   * from Share). Deeper moves keep who can see the page. */
  const titleOf = (p: PageListItem | undefined) => p?.title?.trim() || "Untitled";
  const onMove = (section: SectionKey, pageId: string, target: MoveTarget) => {
    const p = pages.find((x) => x.id === pageId);
    if (!p) return;
    const shared = p.access_type === "workspace";
    let share = false;
    if (target.parentId === null) {
      if (section === "private" && shared) {
        toast.push(
          `"${titleOf(p)}" is shared with everyone. To make it private, change who can see it from Share first.`,
        );
        return;
      }
      share = section === "workspace" && !shared;
    }
    const parent = target.parentId ? pages.find((x) => x.id === target.parentId) : undefined;
    const fromDb = p.database_id ? pages.find((x) => x.id === p.database_id) : undefined;
    const sameParent = (p.parent_id ?? null) === target.parentId;
    const message = share
      ? `Moved "${titleOf(p)}" to Workspace. Everyone in the workspace can open it now.`
      : sameParent
      ? `Moved "${titleOf(p)}".`
      : parent?.is_database
        ? `"${titleOf(p)}" is now a row of "${titleOf(parent)}".`
        : fromDb
          ? `"${titleOf(p)}" left "${titleOf(fromDb)}", so it has no properties now. Undo brings them back.`
          : parent
            ? `Moved "${titleOf(p)}" into "${titleOf(parent)}".`
            : `Moved "${titleOf(p)}" to the top.`;
    if (target.parentId) openExpanded(target.parentId);
    movePage.mutate(
      { pageId, target, message },
      { onSuccess: () => (share ? shareToWorkspace.mutate(pageId) : undefined) },
    );
  };
  // A section header takes a page at the end of that section's top level.
  const headerDrop = (section: SectionKey) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!draggedPage() || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (headerOver !== section) setHeaderOver(section);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeaderOver(null);
    },
    onDrop: (e: React.DragEvent) => {
      const id = draggedPage();
      setHeaderOver(null);
      if (!id) return;
      e.preventDefault();
      onMove(section, id, { parentId: null, beforeId: null });
    },
  });

  const live = useMemo(() => pages.filter((p) => !p.archived_at), [pages]);
  const nonRoots = useMemo(() => live.filter((p) => !!p.parent_id), [live]);
  const privateTree = useMemo(
    () => [...live.filter((p) => !p.parent_id && p.access_type !== "workspace"), ...nonRoots],
    [live, nonRoots],
  );
  const workspaceTree = useMemo(
    () => [...live.filter((p) => !p.parent_id && p.access_type === "workspace"), ...nonRoots],
    [live, nonRoots],
  );
  const activeId =
    selection?.kind === "page" || selection?.kind === "database" ? selection.id : undefined;

  // The open page's ancestors stay expanded, so the tree shows where you are.
  useEffect(() => {
    if (!activeId) return;
    const byId = new Map(pages.map((p) => [p.id, p]));
    let cur = byId.get(activeId)?.parent_id ?? null;
    let hops = 0;
    while (cur && hops++ < 50) {
      openExpanded(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, pages.length]);

  const createTop = (section: SectionKey, kind: "page" | "database") => {
    void (async () => {
      const created = await createAndOpen({ seedProps: {}, isDatabase: kind === "database" });
      if (section === "workspace") shareToWorkspace.mutate(created.id);
    })();
  };
  const addInside = (p: PageListItem, kind: "page" | "database" = "page") => {
    openExpanded(p.id);
    void createAndOpen({ seedProps: {}, parentId: p.id, isDatabase: kind === "database" });
  };
  const deleteWithUndo = (p: PageListItem) => {
    const inside = descendantsOf(p.id, pages).size;
    deletePage.mutate(p.id, {
      onSuccess: () => {
        toast.push({
          message:
            inside > 0
              ? `Deleted "${p.title || "Untitled"}" and the ${inside} ${inside === 1 ? "page" : "pages"} inside it.`
              : `Deleted "${p.title || "Untitled"}".`,
          action: { label: "Undo", onClick: () => restorePage.mutate({ pageId: p.id, row: p }) },
          durationMs: 10_000,
        });
        if (activeId === p.id) void navigate({ to: "/" });
      },
    });
  };
  const copyLink = (p: PageListItem) => {
    const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
    toClipboard(`${origin}/p/${p.id}`);
    toast.push(`Copied link to "${p.title || "Untitled"}"`);
  };
  const menuFor = (p: TreeNode & PageListItem) => (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }): MenuSpec => {
    const title = p.title || "Untitled";
    const inside = descendantsOf(p.id, pages).size;
    return {
      title: p.is_database ? "Database" : "Page",
      rows: [
        {
          kind: "row",
          label: "Open",
          icon: "open",
          onPick: () => {
            void navigate({ to: "/p/$pageId", params: { pageId: p.id } });
            mctx.close();
          },
        },
        {
          kind: "row",
          label: p.is_database ? "New row" : "New page inside",
          icon: "bPage",
          onPick: () => {
            addInside(p, "page");
            mctx.close();
          },
        },
        ...(p.is_database
          ? []
          : [
              {
                kind: "row" as const,
                label: "New database inside",
                icon: "bTable",
                onPick: () => {
                  addInside(p, "database");
                  mctx.close();
                },
              },
            ]),
        { kind: "sep" },
        {
          kind: "row",
          label: favoriteIds.includes(p.id) ? "Remove from Favorites" : "Add to Favorites",
          icon: "star",
          onPick: () => {
            toggleFavorite(p.id, p.title ?? "");
            mctx.close();
          },
        },
        {
          kind: "row",
          label: "Copy link",
          icon: "link",
          onPick: () => {
            copyLink(p);
            mctx.close();
          },
        },
        { kind: "sep" },
        {
          kind: "row",
          label: p.is_database ? "Delete database" : "Delete",
          icon: "trash",
          danger: true,
          onPick: () =>
            mctx.setSpec({
              title: p.is_database ? "Database" : "Page",
              rows: [],
              confirm: {
                title: `Delete "${title}"?`,
                body:
                  inside > 0
                    ? `The ${inside} ${inside === 1 ? "page" : "pages"} inside it go too. You can undo for a moment afterwards.`
                    : "You can undo for a moment afterwards.",
                cta: p.is_database ? "Delete database" : "Delete page",
                danger: true,
                onConfirm: () => deleteWithUndo(p),
              },
            }),
        },
      ],
    };
  };

  const sectionEmpty = (section: SectionKey) => (
    <p className="px-2 py-1 text-caption italic text-faint">
      {section === "workspace" ? "Nothing shared with everyone yet." : "No private pages."}
    </p>
  );

  return (
    <>
      <div className={phone ? "px-3 pb-4" : "flex-1 overflow-y-auto px-2 pb-2 pt-3"}>
        {phone ? (
          <PhoneRecents
            open={sections.recents}
            onToggle={() => toggleSection("recents")}
            pages={pages}
          />
        ) : null}
        {phone ? null : (
          <>
        {/* Search, and New page (Notion's ✎): a new page inside the page
            you're on, else in Private; it opens in a dialog. */}
        <div className="flex items-center" style={{ gap: 4 }}>
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-ui text-secondary hover:bg-railHover"
        >
          <Glyph path="M11 4a7 7 0 100 14 7 7 0 000-14zm5.5 12.5l4 4" className="h-4 w-4 text-muted" />
          <span className="flex-1 text-left">Search</span>
          <span className="rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-label text-muted">
            ⌘K
          </span>
        </button>
        <button
          type="button"
          aria-label="New page"
          title="New page"
          data-sidebar-new-page
          onClick={() => {
            const here = selection && (selection.kind === "page" || selection.kind === "database") ? selection.id : null;
            void (async () => {
              try {
                await createAndOpen({ seedProps: {}, parentId: here });
              } catch {
                // Not allowed to add inside this page: make it in Private.
                if (here) await createAndOpen({ seedProps: {} }).catch(() => undefined);
              }
            })();
          }}
          className="grid shrink-0 place-items-center rounded-md text-muted hover:bg-railHover hover:text-strong"
          style={{ width: 32, height: 32 }}
        >
          <Glyph path="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" className="h-4 w-4" />
        </button>
        </div>
        <Link
          to="/home"
          aria-current={selection?.kind === "home" ? "page" : undefined}
          className={`mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-ui hover:bg-railHover ${selection?.kind === "home" ? "bg-selected text-strong" : "text-secondary"}`}
        >
          <Glyph path={HOME_GLYPH} className="h-4 w-4 text-muted" />
          <span className="flex-1 text-left">Home</span>
        </Link>
        <InboxButton />
        <TemplatesButton />
          </>
        )}

        {loading ? (
          phone ? <PhoneHomeSkeleton inner /> : <SkeletonList />
        ) : (
          <>
            {favorites.length ? (
              <>
                <SectionHeader
                  label="Favorites"
                  open={sections.favorites}
                  onToggle={() => toggleSection("favorites")}
                  phone={phone}
                />
                {sections.favorites ? <FavoritesList activeId={activeId} phone={phone} /> : null}
              </>
            ) : null}
            <div
              data-section-drop="workspace"
              {...headerDrop("workspace")}
              className="rounded-md"
              style={{ boxShadow: headerOver === "workspace" ? "inset 0 0 0 1px var(--color-accent)" : undefined }}
            >
              <SectionHeader
                label="Workspace"
                phone={phone}
                open={sections.workspace}
                onToggle={() => toggleSection("workspace")}
                trailing={<NewTopLevelMenu section="workspace" onCreate={(k) => createTop("workspace", k)} />}
              />
            </div>
            {sections.workspace && (
              <SidebarTreeView
                pages={workspaceTree}
                expanded={expanded}
                activeId={activeId}
                onToggle={toggleExpanded}
                onOpen={(id) => void navigate({ to: "/p/$pageId", params: { pageId: id } })}
                onAddInside={(p) => addInside(p)}
                menuFor={menuFor}
                empty={sectionEmpty("workspace")}
                phone={phone}
                onMove={(id, t) => onMove("workspace", id, t)}
                onExpand={openExpanded}
              />
            )}

            <div
              data-section-drop="private"
              {...headerDrop("private")}
              className="rounded-md"
              style={{ boxShadow: headerOver === "private" ? "inset 0 0 0 1px var(--color-accent)" : undefined }}
            >
              <SectionHeader
                label="Private"
                phone={phone}
                open={sections.private}
                onToggle={() => toggleSection("private")}
                trailing={<NewTopLevelMenu section="private" onCreate={(k) => createTop("private", k)} />}
              />
            </div>
            {sections.private && (
              <SidebarTreeView
                pages={privateTree}
                expanded={expanded}
                activeId={activeId}
                onToggle={toggleExpanded}
                onOpen={(id) => void navigate({ to: "/p/$pageId", params: { pageId: id } })}
                onAddInside={(p) => addInside(p)}
                menuFor={menuFor}
                empty={sectionEmpty("private")}
                phone={phone}
                onMove={(id, t) => onMove("private", id, t)}
                onExpand={openExpanded}
              />
            )}
          </>
        )}
      </div>

      {phone ? null : <FooterAccount
        userEmail={userEmail}
        workspaceName={workspaceName}
        workspaceIcon={workspaceIcon}
        memberCount={memberCount}
        open={accountMenu}
        onOpen={onOpenAccountMenu}
        onClose={onCloseAccountMenu}
        onSignOut={onSignOut}
        onOpenSettings={onOpenSettings}
        onOpenInvite={onOpenInvite}
      />}
    </>
  );
}

/** The root URL with nothing to open yet. */
/** The phone's Recents: the pages you opened last, newest first. */
function PhoneRecents({
  open,
  onToggle,
  pages,
}: {
  open: boolean;
  onToggle: () => void;
  pages: PageListItem[];
}) {
  const ws = useWorkspaceId();
  const visitsQ = useRecentVisits(ws);
  const navigate = useNavigate();
  const recent = useMemo(() => recentPages(visitsQ.data ?? [], pages, 8), [visitsQ.data, pages]);
  // Loading isn't empty: the section holds its place until the visits arrive.
  if (visitsQ.isPending)
    return (
      <>
        <SectionHeader label="Recents" open={open} onToggle={onToggle} phone />
        {open ? <PhoneRecentRowsSkeleton /> : null}
      </>
    );
  if (recent.length === 0) return null;
  return (
    <>
      <SectionHeader label="Recents" open={open} onToggle={onToggle} phone />
      {open ? (
        <ul aria-label="Recents">
          {recent.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center rounded-md text-left text-strong active:bg-sunken"
                style={{ gap: 14, minHeight: 48, padding: "0 6px", fontSize: 17 }}
                onClick={() => {
                  setPageOrigin(p.id, { kind: "search" });
                  void navigate({ to: "/p/$pageId", params: { pageId: p.id } });
                }}
              >
                <Ico icon={p.icon || (p.is_database ? "🗂️" : "📄")} size={22} />
                <span className="min-w-0 flex-1 truncate">{p.title?.trim() || "Untitled"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function EmptyWorkspace() {
  const createAndOpen = useCreatePageAndOpen();
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="font-display text-subhead text-noir">No pages yet.</div>
      <p className="mt-2 text-meta text-secondary">
        Start with a page, or a database for things that come in rows.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void createAndOpen({ seedProps: {} })}
          className="rounded-lg bg-btn px-3 text-btnFg"
          style={{ height: 30, fontSize: 13.5, fontWeight: 700 }}
        >
          New page
        </button>
        <button
          type="button"
          onClick={() => void createAndOpen({ seedProps: {}, isDatabase: true })}
          className="rounded-lg border border-line bg-surface px-3 text-body"
          style={{ height: 30, fontSize: 13.5, fontWeight: 700 }}
        >
          New database
        </button>
      </div>
    </div>
  );
}


/* ─────────────────── Footer + account dropdown ─────────────────── */

function FooterAccount({
  userEmail,
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
  userEmail: string;
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
  const navigate = useNavigate();
  const [apps, setApps] = useState(false);
  const [trash, setTrash] = useState(false);
  useEffect(() => {
    if (!apps && !trash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setApps(false);
      setTrash(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apps, trash]);
  // Notion's corner (2026-10-11): the workspace (its menu: settings,
  // invites, the account, log out) and, beside it, the apps (Trash,
  // My tasks). The person themself lives in Settings › My profile.
  return (
    <>
      <div className="flex items-center border-t border-line" style={{ padding: "6px 8px", gap: 4 }} data-sidebar-footer>
        <button
          type="button"
          onClick={() => (open ? onClose() : onOpen())}
          aria-label={`${workspaceName || "Workspace"}: settings and account`}
          aria-expanded={open}
          data-workspace-menu
          className={"flex min-w-0 flex-1 items-center rounded-md text-left " + (open ? "bg-railHover" : "hover:bg-railHover")}
          style={{ padding: "6px 6px", gap: 8, cursor: "pointer" }}
        >
          <span
            className="grid shrink-0 place-items-center bg-sunken"
            style={{ width: 22, height: 22, borderRadius: 6 }}
            aria-hidden
          >
            <Ico icon={workspaceIcon} size={14} />
          </span>
          <span className="min-w-0 truncate text-body" style={{ fontSize: 14, fontWeight: 700 }} title={workspaceName}>
            {workspaceName || "Workspace"}
          </span>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round"
            strokeLinejoin="round" className="shrink-0 text-whisper" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => {
            setTrash(false);
            setApps((v) => !v);
          }}
          aria-label="More: Trash and My tasks"
          title="Trash, My tasks"
          aria-expanded={apps}
          data-apps-button
          className={"grid shrink-0 place-items-center rounded-md text-muted hover:bg-railHover hover:text-strong " + (apps || trash ? "bg-railHover text-strong" : "")}
          style={{ width: 30, height: 30 }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" />
          </svg>
        </button>
      </div>

      {apps ? (
        <>
          <div className="fixed inset-0" style={{ zIndex: 95 }} onClick={() => setApps(false)} aria-hidden />
          <div
            ref={exitOnly("pop")}
            role="menu"
            aria-label="Trash and My tasks"
            className="fixed bg-surface animate-popIn"
            style={{
              zIndex: 96,
              left: 10,
              bottom: 52,
              transformOrigin: "bottom left",
              width: 220,
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              padding: 5,
              boxShadow: "var(--shadow-popover)",
            }}
          >
            <DropdownRow
              icon="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
              onClick={() => {
                setApps(false);
                void navigate({ to: "/home" });
              }}
            >
              My tasks
            </DropdownRow>
            <DropdownRow
              icon="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"
              onClick={() => {
                setApps(false);
                setTrash(true);
              }}
            >
              Trash
            </DropdownRow>
          </div>
        </>
      ) : null}

      {trash ? (
        <>
          <div className="fixed inset-0" style={{ zIndex: 95 }} onClick={() => setTrash(false)} aria-hidden />
          <div
            ref={exitOnly("pop")}
            className="fixed bg-surface animate-popIn"
            style={{
              zIndex: 96,
              left: 10,
              bottom: 52,
              transformOrigin: "bottom left",
              width: 420,
              maxWidth: "calc(100vw - 20px)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              padding: "4px 4px 10px",
              boxShadow: "var(--shadow-popover)",
            }}
          >
            <TrashPanel close={() => setTrash(false)} />
          </div>
        </>
      ) : null}

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
            ref={exitOnly("pop")}
            className="fixed bg-surface animate-popIn"
            style={{
              zIndex: 96,
              left: 10,
              bottom: 56,
              transformOrigin: "bottom left",
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
                <Ico icon={workspaceIcon} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate font-display text-noir"
                  style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}
                >
                  {workspaceName}
                </div>
                <div className="truncate text-muted" style={{ fontSize: 12.5 }}>
                  {memberCount} member{memberCount === 1 ? "" : "s"}
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
                  <Ico icon={workspaceIcon} size={12} />
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

function SectionHeader({
  label,
  open,
  onToggle,
  trailing,
  phone = false,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
  /** Notion's phone headers: normal case, 17px, chevron after the label. */
  phone?: boolean;
}) {
  if (phone)
    return (
      <div className="mt-5 flex items-center justify-between px-1.5 pb-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          className="flex items-center gap-1.5 text-muted"
          style={{ fontSize: 17, minHeight: 40 }}
        >
          {label}
          <Glyph
            path="M6 9l6 6 6-6"
            className="h-4 w-4"
            style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          />
        </button>
        {trailing}
      </div>
    );
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

