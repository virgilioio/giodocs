import { useContext, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FRESH_VIEW_BLOCKS, type Blk } from "@/lib/block-ops";
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
import { useAuth } from "@/lib/auth-context";
import { IC } from "@/lib/menu-icons";
import { BoardBody, ListBody, QueryToolbar } from "./main-view";
import { ViewTable } from "./view-table";
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

const LAYOUT_CHOICES: Array<{ layout: InlineLayout; label: string; icon: string }> = [
  { layout: "table", label: "Table", icon: IC.bTable },
  { layout: "board", label: "Board", icon: IC.board },
  { layout: "list", label: "List", icon: IC.list },
];

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden fill="none">
      <path d={d} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
        onPick={(v) => {
          FRESH_VIEW_BLOCKS.delete(block.id);
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
  onPick,
  onCancel,
}: {
  autoFocus: boolean;
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
  const newDatabaseHere = async () => {
    if (!hostPageId || busy) return;
    setBusy(true);
    try {
      const made = await create.mutateAsync({
        seedProps: {},
        parentId: hostPageId,
        isDatabase: true,
        quiet: true,
      });
      onPick({ ...defaultInlineView(made.id), name: "" });
    } catch {
      setBusy(false);
    }
  };
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

  const rows = useMemo(
    () => runView(rt.pages, { filter: view.filter, sort }, rt.runCtx),
    [rt.pages, view.filter, sort, rt.runCtx],
  );
  const staleThreshold = Date.now() - rt.staleDays * 24 * 60 * 60 * 1000;
  const areas = useMemo(() => {
    const s = new Set<string>();
    for (const p of rt.pages) {
      const props = p.props as Record<string, unknown> | null;
      const a = props?.area;
      if (typeof a === "string" && a) s.add(a);
    }
    return [...s].sort();
  }, [rt.pages]);
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

  const open = (id: string) => navigate({ to: "/p/$pageId", params: { pageId: id } });
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
    body =
      rows.length === 0 ? (
        <Empty />
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
  } else if (view.layout === "list") {
    const shown = showAll ? rows : rows.slice(0, ROW_LIMIT);
    body =
      rows.length === 0 ? (
        <Empty />
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
        areas={areas}
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
        selectable={false}
        rowLimit={showAll ? undefined : ROW_LIMIT}
        onShowAll={() => setShowAll(true)}
      />
    );
  }

  return (
    <div data-view-block className="min-w-0" style={{ padding: "4px 0" }}>
      <div className="flex items-center" style={{ gap: 8 }}>
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
            placeholder="Untitled view"
            aria-label="View name"
            className="min-w-0 flex-1 rounded-sm border border-transparent bg-transparent font-display text-subhead text-noir focus:border-accent"
            style={{ fontWeight: 700, padding: "0 4px", marginLeft: -5 }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-display text-subhead text-noir" style={{ fontWeight: 700 }}>
            {view.name || "Untitled view"}
          </span>
        )}
        {rt.database ? (
          <button
            type="button"
            onClick={() => void navigate({ to: "/p/$pageId", params: { pageId: rt.database!.id } })}
            className="shrink-0 truncate rounded-sm text-meta text-faint hover:bg-sunken hover:text-strong"
            style={{ maxWidth: 160, padding: "1px 5px" }}
            title={`Open ${rt.database.title?.trim() || "Untitled"}`}
          >
            {rt.database.title?.trim() || "Untitled"}
          </button>
        ) : null}
        <span className="tnum shrink-0 text-meta text-faint">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
        {editable ? (
          <div role="group" aria-label="Layout" className="flex shrink-0 items-center rounded-md border border-line" style={{ padding: 2, gap: 2 }}>
            {LAYOUT_CHOICES.map((c) => (
              <button
                key={c.layout}
                type="button"
                aria-pressed={view.layout === c.layout}
                aria-label={c.label}
                title={c.label}
                onClick={() => patch({ layout: c.layout })}
                className={`grid place-items-center rounded-sm ${view.layout === c.layout ? "bg-sunken text-strong" : "text-muted hover:text-strong"}`}
                style={{ width: 26, height: 24 }}
              >
                <Glyph d={c.icon} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <QueryToolbar
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
        menuSpec={() => ({
          title: view.name || "This view",
          rows: [],
          footer:
            "A view inside a page keeps its own filters and settings. They save with the page.",
        })}
      />
      {body}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-lg border border-lineSoft text-meta text-secondary" style={{ padding: "18px 16px" }}>
      Nothing matches this view yet. Rows appear here the moment their properties match.
    </div>
  );
}
