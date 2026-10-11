import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { openPageSomewhere } from "@/lib/peek";
import { useNavigate } from "@tanstack/react-router";
import { FRESH_NEW_DATABASES, FRESH_VIEW_BLOCKS, type Blk } from "@/lib/block-ops";
import { PageImageCtx } from "@/components/image-block";
import {
  defaultInlineView,
  inlineFromView,
  readInlineView,
  type InlineLayout,
  type InlineView,
} from "@/lib/inline-view";
import { runView, sortsOf, type Filter, type SortSpec } from "@/lib/run-view";
import { seedForGroup, seedFromFilters } from "@/lib/view-seed";
import { useViewRuntime } from "@/hooks/use-view-runtime";
import {
  useCreatePage,
  useCreatePageAndOpen,
  useRenamePage,
  useSetPageProperty,
} from "@/hooks/use-page-mutations";
import { useToast } from "@/lib/toast";
import { useAddPropertyOption, useCreateProperty } from "@/hooks/use-property-mutations";
import { CalendarViewBody } from "./calendar-view";
import { useAuth } from "@/lib/auth-context";
import { IC } from "@/lib/menu-icons";
import { BoardBody, ListBody, QueryToolbar } from "./main-view";
import { ViewTable } from "./view-table";
import { DatabaseToolbar } from "./database-toolbar";
import { useViewSettings } from "./view-settings";
import { allPropKeys, labelOfProp, shownProps } from "@/lib/view-config";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useTemplates } from "@/hooks/use-workspace-data";
import { useNewPageFromTemplate } from "@/hooks/use-templates";
import type { MenuSpec } from "./row-menu";
import type { PageListItem } from "@/lib/types";

/* A view placed inside a page: a live table, board or list of one
 * database's rows with its own filters, sort and properties. Its settings
 * live in the block (src/lib/inline-view.ts) and save with the page; what
 * it lists is each reader's own rows, so it never shows someone a page
 * they can't open. People who can edit the page change it; everyone else
 * reads it. */

const ROW_LIMIT = 25;
const EMPTY_SET = new Set<string>();
const noop = () => {};


export function ViewBlock({
  block,
  locked,
  onChange,
  onDelete,
}: {
  block: Blk;
  locked: boolean;
  onChange: (patch: Partial<Blk>) => void;
  onDelete: () => void;
}) {
  const view = readInlineView(block.view);
  if (!view || !view.database_id) {
    return locked ? null : (
      <StartFrom
        autoFocus={FRESH_VIEW_BLOCKS.has(block.id)}
        autoNew={FRESH_NEW_DATABASES.get(block.id)}
        onPick={(v) => {
          FRESH_VIEW_BLOCKS.delete(block.id);
          FRESH_NEW_DATABASES.delete(block.id);
          onChange({ view: v });
        }}
        onCancel={onDelete}
      />
    );
  }
  return <InlineViewBody view={view} locked={locked} onChange={(v) => onChange({ view: v })} />;
}

/** Where a new view starts: a new database inside this page, a database's
 * rows, or a copy of one of its saved views. */
function StartFrom({
  autoFocus,
  autoNew,
  onPick,
  onCancel,
}: {
  autoFocus: boolean;
  /** "Table view", "Board view"…: make the new database at once, in this
   *  layout ("table", "board", "list", "calendar"). */
  autoNew?: string;
  onPick: (v: InlineView) => void;
  onCancel: () => void;
}) {
  const { allPages, allViews } = useViewRuntime(null);
  const { user } = useAuth();
  const hostPageId = useContext(PageImageCtx)?.pageId ?? null;
  const create = useCreatePage();
  const [busy, setBusy] = useState(false);
  const databases = allPages
    .filter((p) => p.is_database && !p.archived_at)
    .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  const [picked, setPicked] = useState<string | null>(null);
  const db = picked ? databases.find((d) => d.id === picked) : undefined;
  const viewsOf = (id: string) =>
    allViews.filter(
      (v) => v.database_id === id && (v.scope === "team" || v.owner_id === user?.id),
    );
  const createProperty = useCreateProperty();
  const addOption = useAddPropertyOption();
  const newDatabaseHere = async (layout: InlineLayout = "table") => {
    if (!hostPageId || busy) return;
    setBusy(true);
    try {
      const made = await create.mutateAsync({
        seedProps: {},
        parentId: hostPageId,
        isDatabase: true,
        quiet: true,
      });
      // A board needs a Status to group by, a calendar a Date to place
      // rows on (like starting a database on a blank page).
      let groupBy: string | null = null;
      if (layout === "board") {
        const def = await createProperty.mutateAsync({ databaseId: made.id, label: "Status", type: "status" });
        for (const label of ["Not started", "In progress", "Done"]) await addOption.mutateAsync({ id: def.id, label });
        groupBy = def.key;
      } else if (layout === "calendar") {
        const def = await createProperty.mutateAsync({ databaseId: made.id, label: "Date", type: "date" });
        groupBy = def.key;
      }
      onPick({ ...defaultInlineView(made.id), name: "", layout, group_by: groupBy });
    } catch {
      setBusy(false);
    }
  };
  // "Table view" from the slash menu: no question, the database is made
  // here. Once per block (the ref survives re-renders while it's made).
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoNew || autoRan.current || !hostPageId) return;
    autoRan.current = true;
    void newDatabaseHere(
      (["table", "board", "list", "calendar"].includes(autoNew) ? autoNew : "table") as InlineLayout,
    );
    // newDatabaseHere is recreated each render; running it once is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNew, hostPageId]);
  const row = (label: string, onClick: () => void, key: string, first = false, hint?: string) => (
    <button
      key={key}
      type="button"
      autoFocus={autoFocus && first}
      onClick={onClick}
      className="flex w-full items-center rounded-md text-left text-row text-body hover:bg-rail"
      style={{ gap: 8, padding: "6px 10px" }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-caption text-faint">{hint}</span> : null}
    </button>
  );
  return (
    <div
      data-view-block-start
      className="rounded-lg border border-line bg-surface"
      style={{ padding: 8, maxWidth: 420 }}
    >
      {db ? (
        <>
          <div className="text-label uppercase text-faint" style={{ padding: "4px 10px 6px" }}>
            {db.title?.trim() || "Untitled"}
          </div>
          {row(
            "All rows",
            () => onPick({ ...defaultInlineView(db.id), name: db.title?.trim() || "" }),
            "all",
            true,
          )}
          {viewsOf(db.id).length ? (
            <div className="text-caption text-faint" style={{ padding: "8px 10px 2px" }}>
              A copy of one of its views
            </div>
          ) : null}
          {viewsOf(db.id).map((v) =>
            row(v.name, () => onPick(inlineFromView(v)), v.id, false, v.scope === "team" ? "shared" : "mine"),
          )}
          <div className="mt-1 flex justify-between" style={{ padding: "4px 6px 0" }}>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="rounded-md text-meta text-muted hover:bg-sunken hover:text-strong"
              style={{ padding: "3px 9px" }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md text-meta text-muted hover:bg-sunken hover:text-strong"
              style={{ padding: "3px 9px" }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="text-label uppercase text-faint" style={{ padding: "4px 10px 6px" }}>
            Show rows from
          </div>
          {hostPageId
            ? row(busy ? "Making a database…" : "A new database inside this page", () => void newDatabaseHere(), "new", true, "table")
            : null}
          {databases.length ? (
            <div className="text-caption text-faint" style={{ padding: "8px 10px 2px" }}>
              An existing database
            </div>
          ) : null}
          {databases.map((d, i) =>
            row(d.title?.trim() || "Untitled", () => setPicked(d.id), d.id, !hostPageId && i === 0),
          )}
          <div className="mt-1 flex justify-end" style={{ padding: "4px 6px 0" }}>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md text-meta text-muted hover:bg-sunken hover:text-strong"
          style={{ padding: "3px 9px" }}
        >
          Cancel
        </button>
      </div>
        </>
      )}
      <p className="text-caption text-faint" style={{ padding: "4px 10px 2px" }}>
        It keeps its own filters from here on. Changing it never changes the view it came from.
      </p>
    </div>
  );
}

function InlineViewBody({
  view,
  locked,
  onChange,
}: {
  view: InlineView;
  locked: boolean;
  onChange: (v: InlineView) => void;
}) {
  const rt = useViewRuntime(view.database_id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const setProp = useSetPageProperty();
  const rename = useRenamePage();
  const create = useCreatePage();
  const createAndOpen = useCreatePageAndOpen();
  const [showAll, setShowAll] = useState(false);
  const editable = !locked;
  const patch = (p: Partial<InlineView>) => onChange({ ...view, ...p });
  // Someone who can only read the page can still sort it for themselves;
  // that stays on their screen and never saves into the page.
  const [readerSort, setReaderSort] = useState<SortSpec | SortSpec[] | null>(null);
  const sort = editable ? view.sort : (readerSort ?? view.sort);
  const changeSort = (s: SortSpec | SortSpec[]) =>
    editable ? patch({ sort: s }) : setReaderSort(s);
  // The name saves when you leave the field, as one change.
  const [name, setName] = useState(view.name);
  const [nameFor, setNameFor] = useState(view.name);
  if (nameFor !== view.name) {
    setNameFor(view.name);
    setName(view.name);
  }

  // Search (the toolbar's): a passing filter on the title, never saved.
  const [search, setSearch] = useState("");
  const [queryOpen, setQueryOpen] = useState(false);
  const [filterAsk, setFilterAsk] = useState<{ prop: string; n: number } | null>(null);
  const [sortAsk, setSortAsk] = useState(0);
  const rows = useMemo(
    () =>
      runView(
        rt.pages,
        {
          filter: search.trim() ? [...view.filter, { op: "contains", prop: "@title", value: search.trim() } as Filter] : view.filter,
          sort,
        },
        rt.runCtx,
      ),
    [rt.pages, view.filter, sort, rt.runCtx, search],
  );
  const ws = useWorkspaceId();
  const templatesQ = useTemplates(ws);
  const fromTemplate = useNewPageFromTemplate();
  const staleThreshold = Date.now() - rt.staleDays * 24 * 60 * 60 * 1000;
  const groupable = rt.propDefs.filter((d) => d.type === "select" || d.type === "status");
  const boardGroup =
    view.group_by && groupable.some((d) => d.key === view.group_by)
      ? view.group_by
      : (groupable.find((d) => d.key === "status") ?? groupable[0])?.key ?? "status";
  const tableGroupChoices = useMemo(
    () => [
      ...rt.propDefs
        .filter((d) => ["select", "status", "person", "checkbox"].includes(d.type))
        .map((d) => ({ key: d.key, label: d.label })),
      { key: "@created_by", label: "Created by" },
    ],
    [rt.propDefs],
  );
  const tableGroup =
    view.config.group && tableGroupChoices.some((c) => c.key === view.config.group)
      ? view.config.group
      : null;

  const open = (id: string) => openPageSomewhere(navigate, id);
  const menuFor = (p: PageListItem) => () =>
    ({
      title: p.title || "Untitled",
      rows: [{ kind: "row", label: "Open", icon: "open", onPick: () => open(p.id) }],
    }) as MenuSpec;

  const seed = () => seedFromFilters(view.filter, rt.propDefs, user?.id);
  const onNewRow = async (groupValue: string | null | undefined): Promise<string | null> => {
    try {
      const seedProps = {
        ...seed(),
        ...(groupValue !== undefined ? seedForGroup(tableGroup, groupValue, rt.propDefs) : {}),
      };
      const row = await create.mutateAsync({
        seedProps,
        parentId: view.database_id,
        quiet: true,
      });
      const listed = { ...(row as unknown as PageListItem), database_id: view.database_id };
      const fits = runView([listed], { filter: view.filter, sort }, rt.runCtx).length > 0;
      if (!fits) {
        toast.push({
          message: "Row added. It doesn’t match this view’s filters, so it isn’t listed here.",
          action: { label: "Open", onClick: () => open(row.id) },
        });
        return null;
      }
      return row.id;
    } catch {
      return null;
    }
  };

  let body;
  if (view.layout === "board") {
    // A board shows its columns even before it has rows (Notion's way).
    body =
      rows.length === 0 && (view.filter.length > 0 || search.trim()) ? (
        <Empty filtered />
      ) : (
        <BoardBody
          rows={rows}
          groupBy={boardGroup}
          propDefs={rt.propDefs}
          members={rt.members}
          staleThreshold={staleThreshold}
          onMove={(pageId, value) => setProp.mutate({ pageId, key: boardGroup, value })}
          selectedSet={EMPTY_SET}
          anySelection={false}
          onCheckboxClick={noop}
          getPageMenuBuild={menuFor}
          onNewCard={
            editable
              ? (value) =>
                  void createAndOpen({
                    seedProps: { ...seed(), [boardGroup]: value },
                    parentId: view.database_id,
                  })
              : undefined
          }
        />
      );
  } else if (view.layout === "calendar") {
    const dates = rt.propDefs.filter((d) => d.type === "date");
    const dateDef = dates.find((d) => d.key === view.group_by) ?? dates[0];
    body = (
      <CalendarViewBody
        rows={rows}
        dateKey={dateDef?.key ?? null}
        dateLabel={dateDef?.label ?? "Date"}
        onMove={(pageId, date) => {
          if (dateDef) setProp.mutate({ pageId, key: dateDef.key, value: date });
        }}
      />
    );
  } else if (view.layout === "list") {
    const shown = showAll ? rows : rows.slice(0, ROW_LIMIT);
    body =
      rows.length === 0 ? (
        <Empty filtered={view.filter.length > 0 || !!search.trim()} />
      ) : (
        <>
          <ListBody
            rows={shown}
            members={rt.members}
            propDefs={rt.propDefs}
            staleThreshold={staleThreshold}
            selectedSet={EMPTY_SET}
            anySelection={false}
            onCheckboxClick={noop}
            getPageMenuBuild={menuFor}
          />
          {rows.length > shown.length ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-1 w-full rounded-md text-left text-meta text-muted hover:bg-sunken hover:text-strong"
              style={{ padding: "7px 10px" }}
            >
              Show all {rows.length} rows
            </button>
          ) : null}
        </>
      );
  } else {
    body = (
      <ViewTable
        rows={rows}
        pages={rt.pages}
        members={rt.members}
        staleThreshold={staleThreshold}
        rename={rename}
        setProp={setProp}
        selectedSet={EMPTY_SET}
        anySelection={false}
        onCheckboxClick={noop}
        selectAllState="none"
        onHeaderCheckboxClick={noop}
        getPageMenuBuild={menuFor}
        propDefs={rt.propDefs}
        config={view.config}
        onConfig={(config) => patch({ config })}
        canArrange={editable}
        sorts={sortsOf(sort)}
        onSort={(s: SortSpec) => changeSort(s)}
        groupKey={tableGroup}
        onNewRow={editable ? onNewRow : undefined}
        relations={rt.tableRelations}
        databaseId={view.database_id ?? undefined}
        selectable={false}
        rowLimit={showAll ? undefined : ROW_LIMIT}
        onShowAll={() => setShowAll(true)}
      />
    );
  }

  const dbTemplates = (templatesQ.data ?? []).filter((t) => t.database_id === view.database_id);
  const usedKeys = useMemo(() => {
    const u = new Set<string>();
    for (const p of rt.pages) {
      const pr = p.props as Record<string, unknown> | null;
      if (pr) for (const [k, v] of Object.entries(pr)) if (v !== null && v !== "" && !(Array.isArray(v) && !v.length)) u.add(k);
    }
    return u;
  }, [rt.pages]);
  const shownNow = shownProps(view.config, rt.propDefs, usedKeys);
  const openFilter = () => {
    setQueryOpen(true);
    setFilterAsk((a) => ({ prop: "", n: (a?.n ?? 0) + 1 }));
  };
  const openSort = () => {
    setQueryOpen(true);
    setSortAsk((n) => n + 1);
  };
  const dateDefs = rt.propDefs.filter((d) => d.type === "date");
  const settings = useViewSettings({
    databaseId: view.database_id,
    name: view.name,
    onRename: editable ? (n) => patch({ name: n.slice(0, 200) }) : undefined,
    layout: view.layout,
    onLayout: editable ? (l) => patch({ layout: l }) : undefined,
    visibility:
      editable && view.layout === "table"
        ? {
            shown: shownNow,
            allKeys: allPropKeys(shownNow, rt.propDefs),
            labelOf: (k) => labelOfProp(k, rt.propDefs),
            onChange: (next) => patch({ config: { ...view.config, props: next } }),
          }
        : undefined,
    onFilter: editable ? openFilter : undefined,
    onSort: openSort,
    group: !editable
      ? undefined
      : view.layout === "table"
        ? { title: "Group", value: tableGroup, choices: tableGroupChoices, onChange: (g) => patch({ config: { ...view.config, group: g } }), allowNone: true }
        : view.layout === "board"
          ? { title: "Group", value: boardGroup, choices: groupable.map((d) => ({ key: d.key, label: d.label })), onChange: (g) => g && patch({ group_by: g }), allowNone: false }
          : view.layout === "calendar"
            ? { title: "Show by", value: view.group_by ?? dateDefs[0]?.key ?? null, choices: dateDefs.map((d) => ({ key: d.key, label: d.label })), onChange: (g) => g && patch({ group_by: g }), allowNone: false }
            : undefined,
    canEditDatabase: editable,
  });
  return (
    <div data-view-block className="gio-db-host min-w-0" style={{ padding: "4px 0" }}>
      <div className="flex items-center" style={{ gap: 8, minHeight: 36 }}>
        {editable ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== view.name) patch({ name: name.slice(0, 200) });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(view.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={rt.database?.title?.trim() || "New database"}
            aria-label="View name"
            className={`min-w-0 flex-1 rounded-sm border border-transparent bg-transparent font-display text-h3 text-noir focus:border-accent ${rt.database?.title?.trim() ? "placeholder:text-noir" : "placeholder:text-whisper"}`}
            style={{ fontWeight: 700, padding: "0 4px", marginLeft: -5 }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-display text-h3 text-noir" style={{ fontWeight: 700 }}>
            {view.name || rt.database?.title?.trim() || "Untitled"}
          </span>
        )}
        <DatabaseToolbar
          onFilter={editable ? openFilter : undefined}
          onSort={openSort}
          search={search}
          onSearch={setSearch}
          onOpenFull={rt.database ? () => void navigate({ to: "/p/$pageId", params: { pageId: rt.database!.id } }) : undefined}
          settings={settings.build}
          onNew={
            editable && view.database_id
              ? () => void createAndOpen({ seedProps: seed(), parentId: view.database_id })
              : undefined
          }
          newMenu={
            editable && view.database_id
              ? () => ({
                  title: "New",
                  rows: [
                    {
                      kind: "row" as const,
                      label: "Empty page",
                      icon: IC.bPage,
                      onPick: () => void createAndOpen({ seedProps: seed(), parentId: view.database_id }),
                    },
                    ...(dbTemplates.length ? [{ kind: "sep" as const }] : []),
                    ...dbTemplates.map((t) => ({
                      kind: "row" as const,
                      label: t.title?.trim() || "Untitled",
                      icon: IC.bPage,
                      onPick: () => void fromTemplate(t.id),
                    })),
                  ],
                  footer: dbTemplates.length ? undefined : "No templates yet. Make one from a row's ⋯ menu (Use as template).",
                })
              : undefined
          }
        />
      </div>
      <QueryToolbar
        compact
        open={queryOpen}
        sortAsk={sortAsk}
        filterAsk={filterAsk}
        filters={view.filter}
        sort={sort}
        groupBy={boardGroup}
        layout={view.layout}
        onChangeFilters={(filter: Filter[]) => patch({ filter })}
        onChangeSort={changeSort}
        onChangeGroupBy={(g) => patch({ group_by: g })}
        tableGroup={tableGroup}
        tableGroupChoices={tableGroupChoices}
        onChangeTableGroup={(g) => patch({ config: { ...view.config, group: g } })}
        propDefs={rt.propDefs}
        people={rt.people}
        staleDays={rt.staleDays}
        editable={editable}
        pages={rt.pages}
        verbose
        menuSpec={settings.build}
      />
      {settings.dialog}
      {body}
    </div>
  );
}

function Empty({ filtered = false }: { filtered?: boolean }) {
  return (
    <div className="rounded-lg border border-lineSoft text-meta text-secondary" style={{ padding: "18px 16px" }}>
      {filtered
        ? "Nothing matches this view yet. Rows appear here the moment their properties match."
        : "No rows yet. Add one with New."}
    </div>
  );
}
