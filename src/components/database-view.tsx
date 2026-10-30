import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isPeekOpen } from "@/lib/peek";
import { useNavigate } from "@tanstack/react-router";
import { primaryMod } from "@/lib/platform";
import { toClipboard } from "@/lib/clipboard";
import { usePrefs } from "@/lib/preferences";
import { useAuth } from "@/lib/auth-context";
import { usePage, usePageAccess } from "@/hooks/use-workspace-data";
import { runView, sortsOf, type Filter, type SortSpec } from "@/lib/run-view";
import {
  allPropKeys,
  labelOfProp,
  readConfig,
  shownProps,
  tableGroupChoices as tableGroupChoicesFor,
  type ViewConfig,
} from "@/lib/view-config";
import { sortLabel as sortLabelOf } from "@/lib/sort-label";
import { seedForGroup, seedFromFilters } from "@/lib/view-seed";
import { ViewTable } from "./view-table";
import { useViewRuntime } from "@/hooks/use-view-runtime";
import { PageOriginContext, type PageOrigin } from "@/lib/page-origin";
import { currentView, type ViewBase, type ViewDraft } from "@/lib/view-drafts";
import {
  useDrafts,
  patchDraft as storePatchDraft,
  clearDraft as storeClearDraft,
} from "@/lib/view-drafts-store";
import { useToast } from "@/lib/toast";
import { Popover } from "./popover";
import { EmojiPicker } from "./emoji-picker";
import { Ico } from "./emoji-icon";
import { RowMenu, type MenuSpec, type MenuRow, type MenuBuildCtx } from "./row-menu";
import { useTemplates } from "@/hooks/use-workspace-data";
import { useNewPageFromTemplate, useSetTemplate } from "@/hooks/use-templates";
import { useWorkspaceId } from "@/lib/workspace-context";
import { personalViewFooter } from "@/lib/personal-view-footer";
import { rangeSelect } from "@/lib/row-selection";
import {
  useSetPageProperty,
  useRenamePage,
  useSetPageIcon,
  useCreatePage,
  useCreatePageAndOpen,
  useUpdateView,
  useCreateView,
  useForkView,
  usePublishView,
  useDeleteView,
  useUnpublishView,
  useVerifyPage,
  useDeletePage,
  useRestorePage,
  useArchivePage,
} from "@/hooks/use-page-mutations";
import { useRowActions } from "@/hooks/use-row-actions";
import { BulkBar } from "./bulk-bar";
import { nextValue } from "@/lib/prop-actions";
import { CalendarViewBody } from "./calendar-view";
import { ExportViewDialog } from "./export-view-dialog";
import { useDelayedPending } from "./sk";
import { ViewSkeleton, BoardSkeleton } from "./skeletons";
import {
  QueryToolbar,
  BoardBody,
  ListBody,
  LayoutGlyph,
  Glyph,
  setDateModeForMainView,
} from "./main-view";
import type { ExportViewColumn, ExportViewRow } from "@/lib/export";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";
import { isTypingTarget } from "@/lib/is-typing";
import { DatabaseToolbar } from "./database-toolbar";
import { useViewSettings } from "./view-settings";
import { useHomePrefs, useSaveHomePrefs } from "@/hooks/use-home";
import { togglePinned } from "@/lib/home";

/* The database page: its title, its views as tabs, and the chosen view
 * over its rows. Replaces the old MainView (views over one pool
 * of pages). Everything a view needs comes from useViewRuntime(databaseId),
 * shared with views placed inside pages. */

type Layout = "table" | "board" | "list" | "calendar";
type ViewRow = Database["public"]["Tables"]["views"]["Row"];
type MemberRow = {
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

const EMPTY_CONFIG: ViewConfig = {};
const DEFAULT_SORT: SortSpec = { prop: "edited", dir: "desc" };

export type DatabaseSelection = { kind: "database"; id: string; viewId: string | null };

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

/** The view a database opens on: the one in the URL, else its first shared
 * view, else its first view. */
function pickView(views: readonly ViewRow[], viewId: string | null): ViewRow | null {
  if (viewId) {
    const hit = views.find((v) => v.id === viewId);
    if (hit) return hit;
  }
  return views.find((v) => v.scope === "team") ?? views[0] ?? null;
}

/* ─────────────────────────── Database header ─────────────────────────── */

function DatabaseHeader({
  database,
  canEdit,
  rowCount,
  onRename,
  onSetIcon,
  onNewRow,
  layout,
  onChangeLayout,
}: {
  database: PageListItem;
  canEdit: boolean;
  rowCount: number;
  onRename: (title: string) => void;
  onSetIcon: (icon: string) => void;
  onNewRow: () => void;
  layout: Layout;
  onChangeLayout: (l: Layout) => void;
}) {
  const title = database.title ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  // A database just made opens with its title ready to type.
  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("gio.focus-title") === database.id) {
        sessionStorage.removeItem("gio.focus-title");
        titleRef.current?.focus();
      }
    } catch {
      /* storage unavailable */
    }
  }, [database.id]);
  const countLabel = `${rowCount} ${rowCount === 1 ? "row" : "rows"}`;
  const icon = (
    <span className="grid place-items-center" style={{ width: 34, height: 34 }}>
      <Ico icon={database.icon ?? "🗂️"} size={26} />
    </span>
  );
  return (
    // On a narrow screen the layout switch and New wrap under the title.
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-[min(100%,240px)] flex-1 items-center gap-2">
        {canEdit ? (
          <Popover
            width={328}
            trigger={({ open, onClick, ref }) => (
              <button
                ref={ref}
                type="button"
                aria-label="Change database icon"
                aria-expanded={open}
                onClick={onClick}
                className="shrink-0 rounded-md hover:bg-sunken"
              >
                {icon}
              </button>
            )}
          >
            {(close) => (
              <EmojiPicker
                onPick={(e) => {
                  if (e) onSetIcon(e);
                  close();
                }}
              />
            )}
          </Popover>
        ) : (
          <span className="shrink-0">{icon}</span>
        )}
        <h1
          className="min-w-0 flex-1 font-display text-title text-noir"
          style={{ height: 34, lineHeight: "34px" }}
        >
          <input
            ref={titleRef}
            aria-label="Database title"
            value={draft ?? title}
            readOnly={!canEdit}
            placeholder="Untitled"
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={() => {
              if (draft !== null && draft.trim() !== title) onRename(draft.trim());
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-full min-w-0 bg-transparent font-display text-title text-noir focus:outline-none"
            style={{ letterSpacing: "-0.035em", height: 34, lineHeight: "34px" }}
          />
        </h1>
        <span className="shrink-0 text-ui text-faint">{countLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* The layout is chosen in View settings (Notion's way). */}
        {canEdit && (
          <div className="inline-flex items-stretch overflow-hidden rounded-lg bg-btn text-btnFg" style={{ height: 30 }}>
            <button
              type="button"
              onClick={onNewRow}
              className="inline-flex items-center gap-1.5"
              style={{ padding: "0 11px 0 13px", fontSize: 13.5, fontWeight: 700 }}
            >
              <Glyph path="M12 5v14M5 12h14" className="h-3 w-3" />
              New
            </button>
            <NewFromTemplateButton databaseId={database.id} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The ▾ beside New: start a row from one of this database's templates, or
 *  make a new template (a row of this database marked as one). */
function NewFromTemplateButton({ databaseId }: { databaseId: string }) {
  const ws = useWorkspaceId();
  const templates = (useTemplates(ws).data ?? []).filter((t) => t.database_id === databaseId);
  const startFrom = useNewPageFromTemplate();
  const create = useCreatePage();
  const setTemplate = useSetTemplate();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const spec: MenuSpec = {
    title: "Templates",
    footer: templates.length
      ? "A row started from a template gets a copy of its content, icon and properties."
      : "No templates in this database yet.",
    rows: [
      ...templates.map<MenuRow>((t) => ({
        kind: "row",
        label: t.title?.trim() || "Untitled",
        icon: "M5 4h14v5H5zM5 13h6v7H5zM15 13h4M15 17h4",
        onPick: () => {
          close();
          void startFrom(t.id);
        },
      })),
      ...(templates.length ? [{ kind: "sep" as const }] : []),
      {
        kind: "row",
        label: "New template",
        icon: "M12 5v14M5 12h14",
        onPick: async () => {
          close();
          const row = await create.mutateAsync({ seedProps: {}, parentId: databaseId, title: "", quiet: true });
          await setTemplate.mutateAsync({ pageId: row.id, title: "", on: true, quiet: true });
          await navigate({ to: "/p/$pageId", params: { pageId: row.id } });
        },
      },
    ],
  };
  return (
    <>
      <button
        type="button"
        aria-label="New from a template"
        title="New from a template"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
        className="grid place-items-center"
        style={{ width: 26, borderLeft: "1px solid rgba(255,255,255,.18)" }}
      >
        <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
        </svg>
      </button>
      <RowMenu spec={anchor ? spec : null} anchor={anchor} onClose={close} />
    </>
  );
}

/* ─────────────────────────── View tabs ─────────────────────────── */

function ViewTabs({
  views,
  activeId,
  drafts,
  onPick,
  onAdd,
  renamingId,
  onRenameCommit,
  onRenameCancel,
}: {
  views: readonly ViewRow[];
  activeId: string | null;
  drafts: Record<string, ViewDraft>;
  onPick: (id: string) => void;
  onAdd: (() => void) | null;
  renamingId: string | null;
  onRenameCommit: (id: string, name: string) => void;
  onRenameCancel: () => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Views"
      className="mb-2 flex items-center gap-1 border-b border-line"
      data-view-tabs
    >
      {views.map((v) => {
        const active = v.id === activeId;
        const layout = (drafts[v.id]?.layout ?? v.layout ?? "table") as Layout;
        const renaming = renamingId === v.id;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={v.scope === "personal" ? `${v.name} — only you see this view` : v.name}
            onClick={() => onPick(v.id)}
            onDoubleClick={active ? undefined : () => onPick(v.id)}
            className={
              "relative inline-flex items-center gap-1.5 rounded-t-md px-2 text-ui " +
              (active ? "text-noir" : "text-faint hover:bg-sunken hover:text-secondary")
            }
            style={{ height: 32, fontWeight: active ? 600 : 500 }}
          >
            {v.icon ? <Ico icon={v.icon} size={14} /> : <LayoutGlyph layout={layout} />}
            {renaming ? (
              <input
                autoFocus
                aria-label="View name"
                defaultValue={v.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => onRenameCommit(v.id, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onRenameCancel();
                  }
                }}
                className="bg-transparent text-ui text-noir focus:outline-none"
                style={{ width: Math.max(60, v.name.length * 8) }}
              />
            ) : (
              <span className="max-w-48 truncate">{v.name}</span>
            )}
            {v.scope === "personal" && (
              <Glyph
                path="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9c0-4 3-6 7-6s7 2 7 6"
                className="h-3 w-3 text-faint"
              />
            )}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-1 bottom-0 rounded-full bg-noir"
                style={{ height: 2 }}
              />
            )}
          </button>
        );
      })}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add view"
          title="Add view"
          className="inline-flex items-center gap-1 rounded-md px-2 text-ui text-faint hover:bg-sunken hover:text-secondary"
          style={{ height: 28 }}
        >
          <Glyph path="M12 5v14M5 12h14" className="h-3 w-3" />
          <span>Add view</span>
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── The database page ─────────────────────────── */

export function DatabaseView({ selection }: { selection: DatabaseSelection }) {
  const { user } = useAuth();
  const me = user?.id ?? "";
  const databaseId = selection.id;
  const {
    shell,
    database,
    pages,
    views,
    members: tableMembers,
    propDefs,
    staleDays,
    runCtx,
    tableRelations,
    people,
  } = useViewRuntime(databaseId);
  const members = tableMembers as unknown as MemberRow[];
  const pagesPending = shell.pages.isPending && !shell.pages.data;
  const showSkeleton = useDelayedPending(pagesPending);
  const navigate = useNavigate();
  const toast = useToast();

  // Who can change the database page itself (its rows, its shared views):
  // the database's rule, can_edit_page.
  const dbQ = usePage(databaseId);
  const accessQ = usePageAccess(databaseId);
  const isWorkspaceOwner = members.some((m) => m.user_id === me && m.role === "owner");
  const canEditDb = useMemo(() => {
    const full = dbQ.data;
    if (!full) return false;
    if (full.access_type === "workspace" && (full.ws_role !== "view" || isWorkspaceOwner)) return true;
    return (accessQ.data ?? []).some((a) => a.user_id === me && a.capability === "write");
  }, [dbQ.data, accessQ.data, me, isWorkspaceOwner]);

  const setProp = useSetPageProperty();
  const rename = useRenamePage();
  const setIcon = useSetPageIcon();
  const create = useCreatePage();
  const createAndOpen = useCreatePageAndOpen();
  const updateView = useUpdateView();
  const createView = useCreateView();
  const forkView = useForkView();
  const publishView = usePublishView();
  const deleteView = useDeleteView();
  const unpublishView = useUnpublishView();
  const verifyPage = useVerifyPage();
  const deletePage = useDeletePage();
  const restorePage = useRestorePage();
  const archivePage = useArchivePage();

  const view = useMemo(() => pickView(views, selection.viewId), [views, selection.viewId]);
  const [filterAsk, setFilterAsk] = useState<{ prop: string; n: number } | null>(null);
  const { prefs } = usePrefs();
  const homePrefs = useHomePrefs();
  const saveHomePrefs = useSaveHomePrefs();
  const pinnedViews = homePrefs.data?.pinned_views ?? [];
  const isTeamView = !!view && view.scope === "team";
  const isOwnerOfView = !!view && view.owner_id === me && view.scope === "personal";
  // Changes save straight to a view I own, or to a shared view of a database
  // I can edit; anything else is a draft until "Save as my view".
  const canPersist = !!view && (isOwnerOfView || (isTeamView && (canEditDb || isWorkspaceOwner)));
  const canManageView = canPersist;

  const drafts = useDrafts();
  const [renamingView, setRenamingView] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [selPages, setSelPages] = useState<string[]>([]);
  const [selPageAnchor, setSelPageAnchor] = useState<string | null>(null);

  const goToView = useCallback(
    (viewId: string | null, replace = false) =>
      navigate({
        to: "/p/$pageId",
        params: { pageId: databaseId },
        search: viewId ? { v: viewId } : {},
        replace,
      }),
    [navigate, databaseId],
  );

  // A database with no view yet shows a plain table; saving it makes the
  // first view.
  const base: ViewBase = useMemo(() => {
    if (view)
      return {
        id: view.id,
        name: view.name,
        scope: view.scope === "team" ? "team" : "personal",
        layout: (view.layout as ViewBase["layout"]) ?? "table",
        filter: (view.filter ?? []) as Filter[],
        sort: (view.sort as SortSpec | SortSpec[] | null) ?? DEFAULT_SORT,
        group_by: view.group_by ?? null,
        config: readConfig(view.config),
      };
    return {
      id: `default:${databaseId}`,
      name: "Table",
      scope: "team",
      layout: "table",
      filter: [],
      sort: DEFAULT_SORT,
      group_by: null,
      config: {},
    };
  }, [view, databaseId]);

  const current = useMemo(() => currentView(base, drafts), [base, drafts]);
  const filters: Filter[] = current.filter;
  const sort: SortSpec | SortSpec[] = current.sort;
  const layout: Layout = (current.layout as Layout) ?? "table";
  const storedGroupBy: string = current.group_by ?? "status";
  const viewConfig: ViewConfig = current.config ?? EMPTY_CONFIG;

  const patchDraft = (patch: ViewDraft) =>
    storePatchDraft(base.id, patch, {
      filter: base.filter,
      sort: base.sort,
      layout: base.layout,
      group_by: base.group_by,
      config: base.config,
    });
  const clearDraft = (id: string) => storeClearDraft(id);

  // Search (the toolbar's): a passing filter on the title, never saved.
  const [search, setSearch] = useState("");
  const [queryOpen, setQueryOpen] = useState(false);
  const [sortAsk, setSortAsk] = useState(0);
  const rows = useMemo(
    () =>
      runView(
        pages,
        {
          filter: search.trim() ? [...filters, { op: "contains", prop: "@title", value: search.trim() } as Filter] : filters,
          sort,
        },
        runCtx,
      ),
    [pages, filters, sort, runCtx, search],
  );

  /* --- selection ------------------------------------------------------- */
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const selectedSet = useMemo(() => new Set(selPages), [selPages]);
  const anySelection = selPages.length > 0;
  const toggleOne = (id: string) => {
    setSelPages((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSelPageAnchor(id);
  };
  const toggleShift = (id: string) => {
    setSelPages((prev) => rangeSelect(rowIds, selPageAnchor, id, prev));
    setSelPageAnchor(id);
  };
  const checkboxRef = useRef({ toggleOne, toggleShift });
  checkboxRef.current = { toggleOne, toggleShift };
  const onCheckboxClick = useCallback((id: string, shift: boolean) => {
    if (shift) checkboxRef.current.toggleShift(id);
    else checkboxRef.current.toggleOne(id);
  }, []);
  const clearSelection = () => {
    setSelPages([]);
    setSelPageAnchor(null);
  };
  const selectAllState: "none" | "some" | "all" =
    selPages.length === 0
      ? "none"
      : rowIds.length > 0 && rowIds.every((id) => selectedSet.has(id))
        ? "all"
        : "some";
  const onHeaderCheckboxClick = () => {
    if (selectAllState === "none") {
      setSelPages(rowIds);
      setSelPageAnchor(rowIds[rowIds.length - 1] ?? null);
    } else clearSelection();
  };
  useEffect(() => {
    if (!anySelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (isPeekOpen()) return; // the page in the dialog owns the keys
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anySelection]);


  const unfilteredCount = useMemo(() => pages.filter((p) => !p.archived_at).length, [pages]);
  const staleThreshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  /* --- view changes ---------------------------------------------------- */
  const persistOrDraft = (patch: ViewDraft) => {
    if (canPersist && view) {
      clearDraft(base.id);
      const dbPatch: Parameters<typeof updateView.mutate>[0]["patch"] = {};
      if ("filter" in patch) dbPatch.filter = patch.filter ?? [];
      if ("sort" in patch) dbPatch.sort = patch.sort ?? DEFAULT_SORT;
      if ("layout" in patch) dbPatch.layout = patch.layout as ViewBase["layout"];
      if ("group_by" in patch) dbPatch.group_by = patch.group_by ?? null;
      if ("config" in patch) dbPatch.config = patch.config ?? {};
      updateView.mutate({ id: view.id, patch: dbPatch });
    } else {
      patchDraft(patch);
    }
  };
  const onChangeFilters = (next: Filter[]) => persistOrDraft({ filter: next });
  const onChangeSort = (s: SortSpec | SortSpec[]) => persistOrDraft({ sort: s });
  const onChangeLayout = (l: Layout) => persistOrDraft({ layout: l });
  const onChangeGroupBy = (g: string) => persistOrDraft({ group_by: g });
  const onChangeConfig = (next: ViewConfig) => persistOrDraft({ config: next });

  const tableGroupChoices = useMemo(() => tableGroupChoicesFor(propDefs), [propDefs]);
  const tableGroup: string | null =
    viewConfig.group && tableGroupChoices.some((c) => c.key === viewConfig.group)
      ? viewConfig.group
      : null;

  const groupableDefs = propDefs.filter((d) => !d.archived_at && (d.type === "select" || d.type === "status"));
  const dateDefs = propDefs.filter((d) => !d.archived_at && d.type === "date");
  const groupBy: string =
    propDefs.length === 0
      ? storedGroupBy
      : layout === "calendar"
        ? dateDefs.some((d) => d.key === storedGroupBy)
          ? storedGroupBy
          : dateDefs[0]?.key ?? ""
        : groupableDefs.some((d) => d.key === storedGroupBy)
          ? storedGroupBy
          : // Any database: its first status property, else its first select.
            (groupableDefs.find((d) => d.type === "status") ?? groupableDefs[0])?.key ?? "";
  const groupByDef = propDefs.find((d) => d.key === groupBy);

  /* --- new rows -------------------------------------------------------- */
  const seedForView = (): Record<string, unknown> => seedFromFilters(filters, propDefs, me);
  const onNewPage = () => {
    void createAndOpen({ seedProps: seedForView(), parentId: databaseId });
  };
  /** A row made in the table: "+ New page" at the foot (of a group), or "+"
   *  beside a row (`placeBefore`). In manual order it's placed where it was
   *  asked for (last for the foot), else it would land among the unplaced. */
  const onNewRow = async (
    groupValue: string | null | undefined,
    placeBefore?: string | null,
  ): Promise<string | null> => {
    const seed = {
      ...seedForView(),
      ...(groupValue !== undefined ? seedForGroup(tableGroup, groupValue, propDefs) : {}),
    };
    try {
      const row = await create.mutateAsync({ seedProps: seed, parentId: databaseId, quiet: true });
      const listed = { ...(row as unknown as PageListItem), database_id: databaseId };
      const fits = runView([listed], { filter: filters, sort }, runCtx).length > 0;
      rowActions.placeNewRow(row.id, placeBefore);
      if (!fits) {
        toast.push({
          message: "Row added. It doesn’t match this view’s filters, so it isn’t listed here.",
          action: {
            label: "Open",
            onClick: () => navigate({ to: "/p/$pageId", params: { pageId: row.id } }),
          },
        });
        return null;
      }
      return row.id;
    } catch {
      return null;
    }
  };

  const isModified = current._modified && !canPersist;

  /* --- view operations ------------------------------------------------- */
  const newViewName = (layoutName: Layout) => {
    const label = layoutName === "table" ? "Table" : layoutName === "board" ? "Board" : layoutName === "list" ? "List" : "Calendar";
    const taken = new Set(views.map((v) => v.name));
    if (!taken.has(label)) return label;
    let n = 2;
    while (taken.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  };
  const doAddView = () => {
    createView.mutate(
      {
        databaseId,
        scope: canEditDb ? "team" : "personal",
        name: newViewName("table"),
        filter: [],
        sort: DEFAULT_SORT,
        layout: "table",
      },
      { onSuccess: (row) => void goToView(row.id) },
    );
  };
  const doSaveAsMyView = () => {
    if (!isModified) return;
    const baseName = base.name;
    createView.mutate(
      {
        databaseId,
        scope: "personal",
        name: view ? `${baseName} (mine)` : newViewName(layout),
        icon: null,
        filter: filters,
        sort,
        layout,
        groupBy: layout === "board" || layout === "calendar" ? groupBy || null : null,
        config: viewConfig,
      },
      {
        onSuccess: (row) => {
          clearDraft(base.id);
          void goToView(row.id);
          if (view) toast.push(`Saved as your own view — "${baseName}" is unchanged for everyone else.`);
        },
      },
    );
  };
  const doDiscard = () => clearDraft(base.id);
  const doPublish = () => {
    if (!view) return;
    publishView.mutate(view.id);
  };
  const doUnpublish = () => {
    if (!view) return;
    unpublishView.mutate(view.id);
  };
  const doDelete = () => {
    if (!view) return;
    deleteView.mutate(view.id, {
      onSuccess: () => {
        const next = pickView(views.filter((v) => v.id !== view.id), null);
        void goToView(next?.id ?? null, true);
      },
    });
  };
  const doDuplicatePersonal = () => {
    if (!view) return;
    createView.mutate(
      {
        databaseId,
        scope: "personal",
        name: `${view.name} copy`,
        icon: view.icon,
        filter: (view.filter ?? []) as Filter[],
        sort: (view.sort ?? DEFAULT_SORT) as SortSpec | SortSpec[],
        layout: view.layout as Layout,
        groupBy: view.group_by ?? null,
        config: readConfig(view.config),
      },
      { onSuccess: (row) => void goToView(row.id) },
    );
  };
  const doDuplicateTeam = () => {
    if (!view) return;
    forkView.mutate(
      {
        viewId: view.id,
        name: `${view.name} copy`,
        filter: (view.filter ?? []) as Filter[],
        sort: (view.sort ?? DEFAULT_SORT) as SortSpec | SortSpec[],
        layout: view.layout as Layout,
        groupBy: view.group_by ?? null,
        config: readConfig(view.config),
      },
      { onSuccess: (row) => void goToView(row.id) },
    );
  };
  const doRenameCommit = (id: string, v: string) => {
    setRenamingView(null);
    const target = views.find((x) => x.id === id);
    if (!target) return;
    const next = v.trim();
    if (next && next !== target.name) updateView.mutate({ id, patch: { name: next } });
  };

  const sortLabel = useMemo(() => sortLabelOf(sort, propDefs), [sort, propDefs]);
  const publisherName = useMemo(() => {
    if (!view || view.scope !== "team" || !view.owner_id) return "";
    const m = members.find((mm) => mm.user_id === view.owner_id);
    return m?.profiles?.full_name || m?.profiles?.email || "";
  }, [view, members]);

  const copyLinkHere = () => {
    const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
    const url = view ? `${origin}/p/${databaseId}?v=${view.id}` : `${origin}/p/${databaseId}`;
    toClipboard(url);
    toast.push(`Copied link to "${view?.name ?? database?.title ?? "this database"}"`);
  };

  // View settings (the toolbar's): this view, then the database.
  const usedKeys = useMemo(() => {
    const u = new Set<string>();
    for (const p of pages) {
      const pr = p.props as Record<string, unknown> | null;
      if (pr) for (const [k, v] of Object.entries(pr)) if (v !== null && v !== "" && !(Array.isArray(v) && !v.length)) u.add(k);
    }
    return u;
  }, [pages]);
  const shownNow = shownProps(viewConfig, propDefs, usedKeys);
  const openFilter = () => {
    setQueryOpen(true);
    setFilterAsk((a) => ({ prop: "", n: (a?.n ?? 0) + 1 }));
  };
  const openSort = () => {
    setQueryOpen(true);
    setSortAsk((n) => n + 1);
  };
  const viewSettings = useViewSettings({
    databaseId,
    name: view?.name ?? "",
    onRename: view && canManageView ? (n) => doRenameCommit(view.id, n) : undefined,
    layout,
    onLayout: onChangeLayout,
    visibility:
      layout === "table"
        ? {
            shown: shownNow,
            allKeys: allPropKeys(shownNow, propDefs),
            labelOf: (k) => labelOfProp(k, propDefs),
            onChange: (next) => onChangeConfig({ ...viewConfig, props: next }),
          }
        : undefined,
    onFilter: openFilter,
    onSort: openSort,
    group:
      layout === "table"
        ? { title: "Group", value: tableGroup, choices: tableGroupChoices, onChange: (g) => onChangeConfig({ ...viewConfig, group: g }), allowNone: true }
        : layout === "board"
          ? { title: "Group", value: groupBy || null, choices: groupableDefs.map((d) => ({ key: d.key, label: d.label })), onChange: (g) => g && onChangeGroupBy(g), allowNone: false }
          : layout === "calendar"
            ? { title: "Show by", value: groupBy || null, choices: dateDefs.map((d) => ({ key: d.key, label: d.label })), onChange: (g) => g && onChangeGroupBy(g), allowNone: false }
            : undefined,
    onCopyLink: copyLinkHere,
    canEditDatabase: canEditDb,
    more: (mctx) => viewMenuSpecRef.current(mctx),
  });
  // The saved-view actions, built where the page has them all.
  const viewMenuSpecRef = useRef<(mctx: MenuBuildCtx) => MenuSpec>(() => ({ title: "", rows: [] }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPeekOpen()) return; // the page in the dialog owns the keys
      if (isTypingTarget(e.target)) return;
      if (!primaryMod(e)) return;
      const k = e.key.toLowerCase();
      if (e.code === "KeyL" && e.altKey) {
        e.preventDefault();
        copyLinkHere();
        return;
      }
      if (k === "d" && !e.altKey && !e.shiftKey && view) {
        e.preventDefault();
        if (isTeamView) doDuplicateTeam();
        else doDuplicatePersonal();
        return;
      }
      if (k === "r" && e.shiftKey && !e.altKey && view && canManageView) {
        e.preventDefault();
        setRenamingView(view.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isTeamView, canManageView]);

  /* --- rows' menus ----------------------------------------------------- */
  const rowActions = useRowActions({
    databaseId,
    databaseTitle: database?.title ?? null,
    rows,
    sort,
    groupKey: tableGroup,
    propDefs,
    members,
    staleThreshold,
    canEdit: canEditDb,
    origin: {
      kind: "database",
      databaseId,
      viewId: view?.id ?? null,
      name: database?.title || "Untitled",
    },
    onChangeSort: (s) => onChangeSort(s),
  });
  const manualOrder = rowActions.manualOrder;
  const onMoveRow = rowActions.onMoveRow;
  const getPageMenuBuild = rowActions.getMenu;
  const menuBuildRef = useRef(getPageMenuBuild);
  menuBuildRef.current = getPageMenuBuild;
  const stableMenuBuild = useCallback(
    (p: PageListItem) => (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }) =>
      menuBuildRef.current(p)(mctx),
    [],
  );

  const emptyBody =
    unfilteredCount === 0 ? (
      <div className="grid place-items-center py-20 text-center">
        <div className="font-display text-subhead text-noir">No rows yet.</div>
        <p className="mt-2 text-meta text-secondary">
          Add the first one with New. Every row is a page of its own.
        </p>
      </div>
    ) : (
      <div className="grid place-items-center py-20 text-center">
        <div className="font-display text-subhead text-noir">Nothing matches this view yet.</div>
        <p className="mt-2 text-meta text-secondary">
          A view is a query over this database&apos;s rows — they appear here the moment their properties match.
        </p>
      </div>
    );

  let body: ReactNode;
  if (rows.length === 0 && layout !== "table") body = emptyBody;
  else if (layout === "calendar")
    body = (
      <CalendarViewBody
        rows={rows}
        dateKey={groupBy || null}
        dateLabel={groupByDef?.label ?? "Date"}
        onMove={(pageId, date) => setProp.mutate({ pageId, key: groupBy, value: date })}
      />
    );
  else if (layout === "board")
    body = (
      <BoardBody
        rows={rows}
        groupBy={groupBy}
        propDefs={propDefs}
        members={members}
        staleThreshold={staleThreshold}
        onMove={(pageId, value) => setProp.mutate({ pageId, key: groupBy, value })}
        selectedSet={selectedSet}
        anySelection={anySelection}
        onCheckboxClick={onCheckboxClick}
        getPageMenuBuild={getPageMenuBuild}
        onNewCard={(value) =>
          void createAndOpen({
            seedProps: { ...seedForView(), ...seedForGroup(groupBy, value, propDefs) },
            parentId: databaseId,
          })
        }
      />
    );
  else if (layout === "list")
    body = (
      <ListBody
        rows={rows}
        members={members}
        propDefs={propDefs}
        staleThreshold={staleThreshold}
        selectedSet={selectedSet}
        anySelection={anySelection}
        onCheckboxClick={onCheckboxClick}
        getPageMenuBuild={getPageMenuBuild}
      />
    );
  else
    body = (
      <ViewTable
        rows={rows}
        pages={pages}
        members={members}
        staleThreshold={staleThreshold}
        rename={rename}
        setProp={setProp}
        selectedSet={selectedSet}
        anySelection={anySelection}
        onCheckboxClick={onCheckboxClick}
        selectAllState={selectAllState}
        onHeaderCheckboxClick={onHeaderCheckboxClick}
        getPageMenuBuild={stableMenuBuild}
        propDefs={propDefs}
        config={viewConfig}
        onConfig={onChangeConfig}
        canArrange
        sorts={sortsOf(sort)}
        onSort={onChangeSort}
        groupKey={tableGroup}
        onNewRow={canEditDb ? onNewRow : undefined}
        onMoveRow={canEditDb ? onMoveRow : undefined}
        manualOrder={manualOrder}
        relations={tableRelations}
        databaseId={canEditDb ? databaseId : undefined}
        isOwner={isWorkspaceOwner}
        onFilter={(k) => {
          setQueryOpen(true);
          setFilterAsk({ prop: k, n: Date.now() });
        }}
      />
    );

  // Exporting a view writes the columns the view shows, in its order, in
  // words (option labels, names, titles), whatever the database calls them.
  const exportKeys = useMemo(() => {
    const used = new Set<string>();
    for (const p of pages) for (const k of Object.keys(propsOf(p))) used.add(k);
    return shownProps(viewConfig, propDefs, used);
  }, [pages, propDefs, viewConfig]);
  const exportColumns = useMemo<ExportViewColumn[]>(
    () => [
      { key: "title", label: "Page" },
      ...exportKeys.map((k) => ({
        key: k,
        label: labelOfProp(k, propDefs),
        date: k === "@created" || k === "@edited" || k === "@verified",
      })),
    ],
    [exportKeys, propDefs],
  );
  const exportRow = (p: PageListItem): ExportViewRow => {
    const out: Record<string, string> = { title: p.title ?? "" };
    for (const k of exportKeys) {
      if (k === "@created") out[k] = p.created_at ?? "";
      else if (k === "@edited") out[k] = p.edited_at ?? "";
      else if (k === "@verified") out[k] = p.verified_at ?? "";
      else {
        const v = k.startsWith("@")
          ? k === "@created_by"
            ? p.created_by
            : p.edited_by
          : tableRelations.readValue(p, k);
        const def = propDefs.find((d) => d.key === k);
        out[k] =
          def?.type === "date" && typeof v === "string"
            ? v.replace("/", " – ")
            : tableRelations.words(v, k).join("; ");
      }
    }
    return out;
  };

  useEffect(() => {
    setDateModeForMainView(prefs.dateFormat);
  }, [prefs.dateFormat]);

  const originValue: PageOrigin = {
    kind: "database",
    databaseId,
    viewId: view?.id ?? null,
    name: database?.title || "Untitled",
  };

  if (pagesPending) {
    if (!showSkeleton) return null;
    if (layout === "board") return <BoardSkeleton />;
    return <ViewSkeleton layout={layout === "list" ? "list" : "table"} />;
  }
  if (!database) {
    return (
      <div className="mx-auto" style={{ maxWidth: 780, padding: "42px 44px" }}>
        <h1 className="font-display text-title text-noir">Database not found</h1>
        <p className="mt-2 text-meta text-muted">It may have been deleted, or you don&apos;t have access.</p>
      </div>
    );
  }

  viewMenuSpecRef.current = (mctx: MenuBuildCtx): MenuSpec => viewMenuSpec(mctx);
  function viewMenuSpec(mctx: MenuBuildCtx): MenuSpec {
    return buildViewToolbarSpec(
              {
                scope: view ? (isTeamView ? "team" : "personal") : "none",
                isModified,
                canManage: canManageView,
                canShare: isOwnerOfView && (canEditDb || isWorkspaceOwner),
                name: view?.name ?? base.name,
                databaseName: database?.title || "Untitled",
                publisherName,
                layout,
                rowCount: rows.length,
                unfilteredCount,
                sortLabel,
                onSaveAsMyView: doSaveAsMyView,
                onDiscard: doDiscard,
                onDuplicate: isTeamView ? doDuplicateTeam : doDuplicatePersonal,
                onChangeLayout,
                onCopyLink: copyLinkHere,
                onRename: () => view && setRenamingView(view.id),
                onPublish: doPublish,
                onUnpublish: doUnpublish,
                onDelete: doDelete,
                onExportView: () => setExportOpen(true),
                pinned: view ? pinnedViews.includes(view.id) : undefined,
                onTogglePin: view
                  ? () => {
                      const on = !pinnedViews.includes(view.id);
                      saveHomePrefs.mutate({ pinned_views: togglePinned(pinnedViews, view.id) });
                      toast.push(on ? `Pinned "${view.name}" to Home.` : `Unpinned "${view.name}" from Home.`);
                    }
                  : undefined,
              },
              mctx,
            );
  }

  return (
    <PageOriginContext.Provider value={originValue}>
      <div className="mx-auto" style={{ maxWidth: "var(--container-view)", padding: "34px 40px" }}>
        <DatabaseHeader
          database={database}
          canEdit={canEditDb}
          rowCount={unfilteredCount}
          onRename={(title) => rename.mutate({ pageId: databaseId, title })}
          onSetIcon={(icon) => setIcon.mutate({ pageId: databaseId, icon })}
          onNewRow={onNewPage}
          layout={layout}
          onChangeLayout={onChangeLayout}
        />

        <div className="flex items-end" style={{ gap: 8 }}>
          <div className="min-w-0 flex-1">
            <ViewTabs
              views={views}
              activeId={view?.id ?? null}
              drafts={drafts}
              onPick={(id) => void goToView(id)}
              onAdd={doAddView}
              renamingId={renamingView}
              onRenameCommit={doRenameCommit}
              onRenameCancel={() => setRenamingView(null)}
            />
          </div>
          <div style={{ paddingBottom: 6 }}>
            <DatabaseToolbar
              always
              onFilter={() => {
                setQueryOpen(true);
                setFilterAsk((a) => ({ prop: "", n: (a?.n ?? 0) + 1 }));
              }}
              onSort={() => {
                setQueryOpen(true);
                setSortAsk((n) => n + 1);
              }}
              search={search}
              onSearch={setSearch}
              settings={viewSettings.build}
            />
          </div>
        </div>

        <QueryToolbar
          compact={!prefs.explainQuery}
          open={queryOpen}
          sortAsk={sortAsk}
          filters={filters}
          sort={sort}
          groupBy={groupBy}
          layout={layout}
          onChangeFilters={onChangeFilters}
          onChangeSort={onChangeSort}
          onChangeGroupBy={onChangeGroupBy}
          tableGroup={tableGroup}
          tableGroupChoices={tableGroupChoices}
          onChangeTableGroup={(g) => onChangeConfig({ ...viewConfig, group: g })}
          propDefs={propDefs}
          people={people}
          staleDays={staleDays}
          editable
          pages={pages}
          verbose={prefs.explainQuery}
          filterAsk={filterAsk}
          pill={isModified ? <ModifiedPill onSave={doSaveAsMyView} onDiscard={doDiscard} /> : null}
          menuSpec={viewSettings.build}
        />

        {viewSettings.dialog}
        {isModified && <ModifiedBand baseName={base.name} saved={!!view} />}

        {rows.length < unfilteredCount && (
          <div style={{ marginTop: 6, marginBottom: 4, fontSize: 12.5, color: "var(--color-whisper)" }}>
            {rows.length} of {unfilteredCount} rows
          </div>
        )}

        <BulkBar
          pages={pages}
          selectedIds={selPages}
          propDefs={propDefs}
          members={members}
          views={views}
          onClear={clearSelection}
          actions={{
            staleDays,
            meId: me,
            verify: async (ids) => {
              await Promise.all(ids.map((id) => verifyPage.mutateAsync(id)));
            },
            setValue: async (ids, def, picked) => {
              await Promise.all(
                ids.map((id) => {
                  const p = pages.find((x) => x.id === id);
                  const value = nextValue(def, propsOf(p ?? ({} as PageListItem))[def.key], picked);
                  return setProp.mutateAsync({ pageId: id, key: def.key, value });
                }),
              );
            },
            archive: async (ids) => {
              await Promise.all(ids.map((id) => archivePage.mutateAsync({ pageId: id, archived: true })));
            },
            unarchive: async (ids) => {
              await Promise.all(ids.map((id) => archivePage.mutateAsync({ pageId: id, archived: false })));
            },
            deletePages: async (ids) => {
              await Promise.all(ids.map((id) => deletePage.mutateAsync(id)));
            },
            restorePages: async (rows) => {
              await Promise.all(rows.map((row) => restorePage.mutateAsync({ pageId: row.id, row })));
            },
            toast: (message, undo) =>
              toast.push(
                undo
                  ? { message, action: { label: "Undo", onClick: undo }, durationMs: 10_000 }
                  : message,
              ),
          }}
        />

        {body}

        {exportOpen && (
          <ExportViewDialog
            name={view?.name ?? database.title ?? "view"}
            columns={exportColumns}
            rows={rows.map<ExportViewRow>((p) => exportRow(p))}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>
    </PageOriginContext.Provider>
  );
}

/* ─────────────────────────── Modified pill + band ─────────────────────────── */

function ModifiedPill({ onSave, onDiscard }: { onSave: () => void; onDiscard: () => void }) {
  return (
    <span
      className="inline-flex items-center animate-fadeIn"
      style={{
        gap: 8,
        background: "var(--color-amberTint)",
        border: "1px solid var(--color-amberRing)",
        borderRadius: 9,
        padding: "3px 5px 3px 10px",
      }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: 999, background: "var(--color-amberDot)" }}
      />
      <span
        className="font-display uppercase"
        style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.05em", color: "var(--color-amberInk)" }}
      >
        MODIFIED
      </span>
      <button
        type="button"
        onClick={onSave}
        className="font-display"
        style={{
          background: "var(--color-noir)",
          color: "var(--color-track)",
          fontSize: 12.5,
          fontWeight: 700,
          borderRadius: 6,
          padding: "2px 8px",
        }}
      >
        Save as my view
      </button>
      <button
        type="button"
        aria-label="Discard changes"
        onClick={onDiscard}
        className="grid place-items-center hover:bg-amberRing"
        style={{ width: 20, height: 20, borderRadius: 4, color: "var(--color-amberInk)", fontSize: 14, lineHeight: 1 }}
      >
        ×
      </button>
    </span>
  );
}

function ModifiedBand({ baseName, saved }: { baseName: string; saved: boolean }) {
  return (
    <div
      role="status"
      className="flex items-start animate-fadeIn"
      style={{
        marginTop: 10,
        gap: 10,
        background: "var(--color-amberTint)",
        border: "1px solid var(--color-amberRing)",
        borderRadius: 9,
        padding: "9px 13px",
        fontSize: 13.5,
        color: "var(--color-amberInk)",
      }}
    >
      <svg
        aria-hidden
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 2 }}
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>
        {saved ? (
          <>
            You&apos;re looking at unsaved changes. <b>{baseName}</b> is untouched for everyone
            else — saving makes a view of your own.
          </>
        ) : (
          <>These changes aren&apos;t saved yet — save them as a view to keep them.</>
        )}
      </span>
    </div>
  );
}

/* ─────────────────────────── View toolbar ⋯ spec ─────────────────────────── */

/** The view toolbar's ⋯ menu. Pure builder — no React state. */
function buildViewToolbarSpec(
  args: {
    scope: "team" | "personal" | "none";
    isModified: boolean;
    /** Rename, share or delete this view: its owner, or an editor of the
     *  database for a shared view. */
    canManage: boolean;
    /** Offer "Share with everyone": my own view, on a database I can edit. */
    canShare: boolean;
    name: string;
    databaseName: string;
    publisherName: string;
    layout: Layout;
    rowCount: number;
    unfilteredCount: number;
    sortLabel: string;
    onSaveAsMyView: () => void;
    onDiscard: () => void;
    onDuplicate: () => void;
    onChangeLayout: (l: Layout) => void;
    onCopyLink: () => void;
    onRename: () => void;
    onPublish: () => void;
    onUnpublish: () => void;
    onDelete: () => void;
    onExportView: () => void;
    /** Pinned to the person's Home (saved views only). */
    pinned?: boolean;
    onTogglePin?: () => void;
  },
  mctx: { setSpec: (s: MenuSpec) => void; close: () => void },
): MenuSpec {
  const { scope, isModified, canManage, canShare, name, databaseName, publisherName, layout, rowCount, unfilteredCount, sortLabel } = args;

  const title = scope === "team" ? "Shared view" : scope === "personal" ? "My view" : "View";
  const footer =
    scope === "team"
      ? `Shared with everyone who can open "${databaseName}"${publisherName ? ` · added by ${publisherName}` : ""}.`
      : scope === "none"
        ? "This database has no saved view yet. Change anything and save it as a view."
        : personalViewFooter({ matchCount: rowCount, totalCount: unfilteredCount, sortLabel });

  const layoutSubmenu = (): MenuSpec => ({
    title: "Change layout",
    rows: (["table", "board", "list", "calendar"] as const).map((l) => ({
      kind: "row" as const,
      label: l === "table" ? "Table" : l === "board" ? "Board" : l === "list" ? "List" : "Calendar",
      icon: l === "table" ? "layout" : l === "board" ? "board" : l === "list" ? "list" : "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
      checked: l === layout,
      onPick: () => {
        args.onChangeLayout(l);
        mctx.close();
      },
    })),
  });

  const rows: MenuRow[] = [];
  if (isModified) {
    rows.push({
      kind: "row",
      label: "Save as my view",
      icon: "bookmark",
      hint: { text: "only you" },
      onPick: () => {
        args.onSaveAsMyView();
        mctx.close();
      },
    });
    rows.push({
      kind: "row",
      label: "Discard my changes",
      icon: "clear",
      hint: { text: "back to saved" },
      onPick: () => {
        args.onDiscard();
        mctx.close();
      },
    });
  } else if (scope !== "none") {
    rows.push({
      kind: "row",
      label: "Duplicate as my view",
      icon: "dup",
      hint: { text: "⌘D", mono: true },
      onPick: () => {
        args.onDuplicate();
        mctx.close();
      },
    });
  }
  if (rows.length > 0) rows.push({ kind: "sep" });

  rows.push({
    kind: "row",
    label: "Change layout",
    icon: "layout",
    hint: { text: layout },
    onPick: () => mctx.setSpec(layoutSubmenu()),
  });
  rows.push({
    kind: "row",
    label: "Copy link",
    icon: "link",
    hint: { text: "⌘⌥L", mono: true },
    onPick: () => {
      args.onCopyLink();
      mctx.close();
    },
  });
  rows.push({
    kind: "row",
    label: "Export view",
    icon: "download",
    hint: { text: "CSV, Markdown" },
    onPick: () => {
      args.onExportView();
      mctx.close();
    },
  });
  if (args.onTogglePin) {
    rows.push({
      kind: "row",
      label: args.pinned ? "Unpin from Home" : "Pin to Home",
      icon: "M12 17v4M8 3h8l-1 6 3 4H6l3-4z",
      hint: { text: "only you" },
      onPick: () => {
        args.onTogglePin?.();
        mctx.close();
      },
    });
  }

  if (scope !== "none" && canManage) {
    rows.push({ kind: "sep" });
    rows.push({
      kind: "row",
      label: "Rename view",
      icon: "pencil",
      hint: { text: "⌘⇧R", mono: true },
      onPick: () => {
        args.onRename();
        mctx.close();
      },
    });
    if (scope === "personal" && canShare) {
      rows.push({
        kind: "row",
        label: "Share with everyone",
        icon: "people",
        hint: { text: "a tab for all" },
        onPick: () =>
          mctx.setSpec({
            title,
            rows: [],
            confirm: {
              title: `Share "${name}"?`,
              body: `Everyone who can open "${databaseName}" gets this view as a tab. Editors of the database can change it.`,
              cta: "Share",
              onConfirm: args.onPublish,
            },
          }),
      });
    }
    if (scope === "team") {
      rows.push({
        kind: "row",
        label: "Make it my view",
        icon: "eyeOff",
        hint: { text: "only you" },
        onPick: () => {
          args.onUnpublish();
          mctx.close();
        },
      });
    }
    rows.push({ kind: "sep" });
    rows.push({
      kind: "row",
      label: "Delete view",
      icon: "trash",
      danger: true,
      onPick: () =>
        mctx.setSpec({
          title,
          rows: [],
          confirm: {
            title: `Delete "${name}"?`,
            body: "The view disappears — the rows it showed are untouched.",
            cta: "Delete view",
            danger: true,
            onConfirm: args.onDelete,
          },
        }),
    });
  }

  return { title, rows, footer: footer || undefined };
}
