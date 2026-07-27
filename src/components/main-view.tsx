import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/preferences";
import { formatTimestamp } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell, pageQuery } from "@/hooks/use-workspace-data";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import { PageOriginContext, useSetPageOrigin } from "@/lib/page-origin";

import { Popover } from "./popover";
import {
  SelectPicker,
  OwnerPicker,
  AreaPicker,
  TagsPicker,
  MiniAvatar,
  type SelectOption,
} from "./property-pickers";
import {
  MoreButton as RowMoreButton,
  RowMenuList,
  RowMenuConfirm,
  Sc,
  Val,
} from "./row-menu";
import {
  useSetPageProperty,
  useRenamePage,
  useCreatePage,
  useCreatePageAndOpen,
  useUpdateView,
  useCreateView,
  useForkView,
  usePublishView,
  useDeleteView,
} from "@/hooks/use-page-mutations";
import { ExportViewDialog } from "./export-view-dialog";
import type { ExportViewRow } from "@/lib/export";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";

type Layout = "table" | "board" | "list";



type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];
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

export type Selection =
  | { kind: "view"; id: string }
  | { kind: "area"; area: string };

const TINTS: Array<{ tint: string; ink: string }> = [
  { tint: "accentTint", ink: "accent" },
  { tint: "amberTint", ink: "amberInk" },
  { tint: "blueTint", ink: "blueInk" },
  { tint: "purpleTint", ink: "purple" },
  { tint: "pinkTint", ink: "pinkInk" },
  { tint: "yellowTint", ink: "yellowInk" },
];

function hashTag(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

let _dateMode: "relative" | "absolute" = "relative";
export function setDateModeForMainView(m: "relative" | "absolute") {
  _dateMode = m;
}
function relTime(iso: string): string {
  return formatTimestamp(iso, _dateMode);
}


function LayoutGlyph({ layout }: { layout: string }) {
  const path =
    layout === "board"
      ? "M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v16h-4z"
      : layout === "list"
        ? "M4 6h16M4 12h16M4 18h16"
        : "M4 5h16v14H4zM4 10h16M9 5v14";
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Glyph({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-4 w-4"} aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─────────────────────────── Filter description ─────────────────────────── */

export function describeFilter(f: Filter, propDefs: PropDef[], staleDays: number): string {
  const def = propDefs.find((d) => d.key === f.prop);
  const label = def?.label ?? f.prop ?? "";
  switch (f.op) {
    case "eq":
      return `${label} is "${f.value}"`;
    case "includes":
      return `tagged "${f.value}"`;
    case "is_me":
      return f.prop === "owner" ? "owner is you" : `${label} is you`;
    case "not_empty":
      return `${label} is set`;
    case "stale":
      return `not verified in ${staleDays} days`;
    case "edited_within":
      return `edited in the last ${f.value} days`;
  }
}


/* ─────────────────────────── View header ─────────────────────────── */

function ViewHeader({
  selection,
  view,
  rowCount,
  onNewPage,
  layout,
  onChangeLayout,
  renaming,
  onRenameCommit,
  onRenameCancel,
}: {
  selection: Selection;
  view: ViewRow | null;
  rowCount: number;
  onNewPage: () => void;
  layout: Layout;
  onChangeLayout: (l: Layout) => void;
  renaming: boolean;
  onRenameCommit: (v: string) => void;
  onRenameCancel: () => void;
}) {
  let scopeLabel: ReactNode = "AREA";
  let name = "";
  if (selection.kind === "view" && view) {
    scopeLabel = view.scope === "team" ? (
      <span className="inline-flex items-center gap-1">
        <Glyph path="M8 12a3 3 0 100-6 3 3 0 000 6zm8 0a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 6-5s6 2 6 5m2 0c0-2 2-4 4-4s4 2 4 4" className="h-3 w-3" />
        TEAM VIEW
      </span>
    ) : "PERSONAL VIEW";
    name = view.name;
  } else if (selection.kind === "area") {
    name = selection.area;
  }
  const countLabel = `${rowCount} ${rowCount === 1 ? "page" : "pages"}`;

  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-label uppercase text-faint">{scopeLabel}</div>
        <h1 className="mt-1 font-display text-title text-noir truncate">
          {renaming ? (
            <input
              autoFocus
              defaultValue={name}
              onBlur={(e) => onRenameCommit(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  e.preventDefault();
                  onRenameCancel();
                }
              }}
              className="w-full min-w-0 bg-transparent font-display text-title text-noir focus:outline-none"
              style={{ letterSpacing: "-0.035em" }}
            />
          ) : (
            <>
              {name}
              <span className="ml-3 align-baseline text-ui text-faint font-normal tracking-normal">
                {countLabel}
              </span>
            </>
          )}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div
          className="flex items-center overflow-hidden rounded-lg border border-line"
          style={{ height: 30 }}
        >
          {(["table", "board", "list"] as const).map((l, i) => {
            const active = l === layout;
            return (
              <button
                key={l}
                type="button"
                title={l}
                aria-label={l}
                onClick={() => onChangeLayout(l)}
                className={
                  "grid place-items-center " +
                  (i > 0 ? "border-l border-line " : "") +
                  (active ? "bg-selected text-noir" : "text-faint hover:bg-sunken")
                }
                style={{ height: 30, width: 32 }}
              >
                <LayoutGlyph layout={l} />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onNewPage}
          className="inline-flex items-center gap-1.5 rounded-lg bg-noir text-track"
          style={{ height: 30, padding: "0 13px", fontSize: 13.5, fontWeight: 700 }}
        >
          <Glyph path="M12 5v14M5 12h14" className="h-3 w-3" />
          New page
        </button>

      </div>
    </div>
  );
}




/* ─────────────────────────── Query toolbar ─────────────────────────── */

function QueryToolbar({
  filters,
  sort,
  onChangeFilters,
  onChangeSort,
  propDefs,
  staleDays,
  editable,
  fixedFilterIndex,
  pages,
  verbose,
  menuBuild,
}: {
  filters: Filter[];
  sort: SortSpec;
  onChangeFilters: (next: Filter[]) => void;
  onChangeSort: (s: SortSpec) => void;
  propDefs: PropDef[];
  staleDays: number;
  editable: boolean;
  fixedFilterIndex?: number;
  pages: PageListItem[];
  verbose: boolean;
  menuBuild: () => ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-lineSoft pb-3">
      {verbose && <span className="text-meta text-muted">Pages where</span>}
      {verbose && filters.length === 0 && (
        <span className="italic text-meta text-secondary">anything — every page</span>
      )}

      {filters.map((f, i) => {
        const fixed = i === fixedFilterIndex;
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-sm border border-line bg-sunken px-2 py-0.5 text-meta"
            title={fixed ? "This chip defines the area" : undefined}
          >
            {describeFilter(f, propDefs, staleDays)}
            {editable && !fixed && (
              <button
                type="button"
                aria-label="Remove filter"
                className="text-faint hover:text-strong"
                onClick={() =>
                  onChangeFilters(filters.filter((_, idx) => idx !== i))
                }
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      {editable && (
        <AddFilterButton
          propDefs={propDefs}
          pages={pages}
          onAdd={(f) => onChangeFilters([...filters, f])}
        />
      )}
      <div className="ml-auto flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-4 w-px bg-line"
        />
        <div className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 text-meta text-secondary">
          <Glyph
            path="M7 4v12m0 0l-3-3m3 3l3-3M17 20V8m0 0l-3 3m3-3l3 3"
            className="h-3.5 w-3.5 text-muted"
          />
          <select
            className="bg-transparent focus:outline-none"
            value={`${sort.prop}:${sort.dir}`}
            disabled={!editable}
            onChange={(e) => {
              const [prop, dir] = e.target.value.split(":") as [
                SortSpec["prop"],
                SortSpec["dir"],
              ];
              onChangeSort({ prop, dir });
            }}
          >
            <option value="edited:desc">Newest edits</option>
            <option value="edited:asc">Oldest edits</option>
            <option value="verified:desc">Recently verified</option>
            <option value="verified:asc">Least recently verified</option>
            <option value="title:asc">Title A–Z</option>
            <option value="title:desc">Title Z–A</option>
          </select>
        </div>
        <RowMoreButton
          size="view"
          ariaLabel="View options"
          build={menuBuild}
        />
      </div>

    </div>
  );
}

function AddFilterButton({
  propDefs,
  pages,
  onAdd,
}: {
  propDefs: PropDef[];
  pages: PageListItem[];
  onAdd: (f: Filter) => void;
}) {
  return (
    <Popover
      width={260}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="rounded-sm border border-dashed border-lineStrong px-2 py-0.5 text-meta text-muted hover:bg-sunken"
        >
          + Filter
        </button>
      )}
    >
      {(close) => (
        <FilterBuilder
          propDefs={propDefs}
          pages={pages}
          onPick={(f) => {
            onAdd(f);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function FilterBuilder({
  propDefs,
  pages,
  onPick,
}: {
  propDefs: PropDef[];
  pages: PageListItem[];
  onPick: (f: Filter) => void;
}) {
  const [step, setStep] = useState<
    | { kind: "root" }
    | { kind: "prop"; def: PropDef }
    | { kind: "special"; which: "stale" | "edited_within" }
  >({ kind: "root" });

  if (step.kind === "root") {
    return (
      <div className="max-h-72 overflow-y-auto">
        {propDefs.map((d) => (
          <button
            key={d.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
            onClick={() => setStep({ kind: "prop", def: d })}
          >
            <span className="text-faint">{d.type[0].toUpperCase()}</span>
            <span>{d.label}</span>
          </button>
        ))}
        <div className="my-1 border-t border-lineSoft" />
        <button
          type="button"
          className="w-full rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
          onClick={() => onPick({ op: "stale", prop: "verified" })}
        >
          Stale (not verified recently)
        </button>
        <button
          type="button"
          className="w-full rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
          onClick={() => setStep({ kind: "special", which: "edited_within" })}
        >
          Edited within…
        </button>
      </div>
    );
  }

  if (step.kind === "special") {
    return (
      <EditedWithinPicker onPick={(days) => onPick({ op: "edited_within", prop: "edited", value: days })} />
    );
  }

  const d = step.def;
  if (d.type === "select" || d.type === "status") {
    const opts = (d.options as unknown as Array<{ value: string; label: string; tint: string; ink: string }>) ?? [];
    return (
      <div className="max-h-72 overflow-y-auto">
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
            onClick={() => onPick({ op: "eq", prop: d.key, value: o.value })}
          >
            <StatusChip label={o.label} tint={o.tint} ink={o.ink} />
          </button>
        ))}
      </div>
    );
  }
  if (d.type === "person") {
    return (
      <button
        type="button"
        className="w-full rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
        onClick={() => onPick({ op: "is_me", prop: d.key })}
      >
        {d.label} is you
      </button>
    );
  }
  if (d.type === "multi_select") {
    const values = new Set<string>();
    for (const p of pages) {
      const v = propsOf(p)[d.key];
      if (Array.isArray(v)) v.forEach((x) => values.add(String(x)));
    }
    return (
      <div className="max-h-72 overflow-y-auto">
        {[...values].sort().map((v) => (
          <button
            key={v}
            type="button"
            className="w-full rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
            onClick={() => onPick({ op: "includes", prop: d.key, value: v })}
          >
            {v}
          </button>
        ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="w-full rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
      onClick={() => onPick({ op: "not_empty", prop: d.key })}
    >
      {d.label} is set
    </button>
  );
}

function EditedWithinPicker({ onPick }: { onPick: (days: number) => void }) {
  const [n, setN] = useState(30);
  return (
    <div className="flex items-center gap-2 p-2">
      <input
        type="number"
        min={1}
        max={365}
        value={n}
        onChange={(e) => setN(Number(e.target.value) || 30)}
        className="w-16 rounded-sm border border-line bg-surface px-2 py-1 text-meta"
      />
      <span className="text-meta text-muted">days</span>
      <button
        type="button"
        onClick={() => onPick(n)}
        className="ml-auto rounded-sm bg-noir px-2 py-1 text-meta font-bold text-canvas"
      >
        Add
      </button>
    </div>
  );
}

function StatusChip({ label, tint, ink }: { label: string; tint: string; ink: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption"
      style={{ background: `var(--color-${tint})`, color: `var(--color-${ink})` }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `var(--color-${ink})` }}
      />
      {label}
    </span>
  );
}

/* ─────────────────────────── Table cells ─────────────────────────── */

function PageTitleCell({
  page,
  onSave,
}: {
  page: PageListItem;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(page.title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setOrigin = useSetPageOrigin();

  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="text-row">{page.icon || "📄"}</span>
      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (value !== page.title) onSave(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setValue(page.title ?? "");
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-row font-bold focus:outline-none"
        />
      ) : (
        <>
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-row font-bold hover:underline"
            onClick={() => {
              setOrigin(page.id);
              navigate({ to: "/p/$pageId", params: { pageId: page.id } });
            }}

            onMouseEnter={() => {
              qc.prefetchQuery(pageQuery(page.id));
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              setValue(page.title ?? "");
              setEditing(true);
            }}
            title="Click to open · double-click to rename"
          >
            {page.title || <span className="text-faint italic">Untitled</span>}
          </button>
          <button
            type="button"
            aria-label="Rename"
            onClick={() => {
              setValue(page.title ?? "");
              setEditing(true);
            }}
            className="shrink-0 rounded-sm px-1 text-caption text-faint opacity-0 hover:bg-rail hover:text-muted group-hover:opacity-100"
          >
            ✎
          </button>
        </>
      )}
    </div>
  );
}


function StatusCell({
  page,
  def,
  onPick,
}: {
  page: PageListItem;
  def: PropDef | undefined;
  onPick: (value: string | null) => void;
}) {
  if (!def) return <span className="text-faint">—</span>;
  const opts =
    (def.options as unknown as SelectOption[]) ?? [];
  const v = propsOf(page)[def.key];
  const cur = opts.find((o) => o.value === v);
  return (
    <SelectPicker
      value={typeof v === "string" ? v : null}
      options={opts}
      onPick={onPick}
      trigger={({ onClick, ref }) => (
        <button ref={ref} type="button" onClick={onClick} className="text-left">
          {cur ? (
            <StatusChip label={cur.label} tint={cur.tint} ink={cur.ink} />
          ) : (
            <span className="text-faint">—</span>
          )}
        </button>
      )}
    />
  );
}

function OwnerCell({
  page,
  members,
  onPick,
}: {
  page: PageListItem;
  members: MemberRow[];
  onPick: (userId: string | null) => void;
}) {
  const owner = propsOf(page)["owner"];
  const current = members.find((m) => m.user_id === owner);
  return (
    <OwnerPicker
      value={typeof owner === "string" ? owner : null}
      members={members}
      onPick={onPick}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {current ? (
            <>
              <MiniAvatar profile={current.profiles} />
              <span className="min-w-0 truncate text-meta text-body hidden md:inline">
                {current.profiles?.full_name}
              </span>
            </>
          ) : (
            <span className="text-faint">No owner</span>
          )}
        </button>
      )}
    />
  );
}

function AreaCell({
  page,
  areas,
  onPick,
}: {
  page: PageListItem;
  areas: string[];
  onPick: (v: string | null) => void;
}) {
  const value = propsOf(page)["area"];
  return (
    <AreaPicker
      value={typeof value === "string" ? value : null}
      areas={areas}
      onPick={onPick}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="text-left text-meta"
        >
          {typeof value === "string" && value ? (
            value
          ) : (
            <span className="text-faint">—</span>
          )}
        </button>
      )}
    />
  );
}

function TagsCell({
  page,
  onSet,
  pages,
  allOverride,
}: {
  page: PageListItem;
  onSet: (tags: string[]) => void;
  pages: PageListItem[];
  allOverride?: string[];
}) {
  const raw = propsOf(page)["tags"];
  const tags = Array.isArray(raw) ? raw.map(String) : [];
  const derived = useMemo(() => {
    if (allOverride) return allOverride;
    const s = new Set<string>();
    for (const p of pages) {
      const t = propsOf(p)["tags"];
      if (Array.isArray(t)) t.forEach((x) => s.add(String(x)));
    }
    return [...s].sort();
  }, [pages, allOverride]);
  const shown = tags.slice(0, 2);
  const extra = tags.length - shown.length;
  return (
    <TagsPicker
      value={tags}
      options={derived}
      onSet={onSet}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="flex flex-nowrap items-center gap-1 overflow-hidden"
        >
          {shown.map((t) => {
            const c = hashTag(t);
            return (
              <span
                key={t}
                className="rounded-sm px-1.5 py-0.5 text-caption"
                style={{
                  background: `var(--color-${c.tint})`,
                  color: `var(--color-${c.ink})`,
                }}
              >
                {t}
              </span>
            );
          })}
          {extra > 0 && (
            <span
              className="rounded-sm px-1.5 py-0.5 text-caption"
              style={{ color: "var(--color-whisper)" }}
            >
              +{extra}
            </span>
          )}
          {tags.length === 0 && <span className="text-faint">—</span>}
        </button>
      )}
    />
  );
}


/* ─────────────────────────── Main view ─────────────────────────── */

export function MainView({ selection }: { selection: Selection }) {
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const shell = useWorkspaceShell(ws);
  const navigate = useNavigate();

  const setProp = useSetPageProperty();
  const rename = useRenamePage();
  const create = useCreatePage();
  const createAndOpen = useCreatePageAndOpen();
  const updateView = useUpdateView();
  const createView = useCreateView();
  const forkView = useForkView();
  const publishView = usePublishView();
  const deleteView = useDeleteView();

  const pages = (shell.pages.data ?? []) as PageListItem[];
  const views = (shell.views.data ?? []) as ViewRow[];
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const propDefs = (shell.propDefs.data ?? []) as PropDef[];
  const workspace = shell.workspace.data;
  const staleDays = workspace?.stale_days ?? 30;
  const memberCount = members.length;

  const view = selection.kind === "view" ? views.find((v) => v.id === selection.id) ?? null : null;
  const isOwnerOfView = !!view && view.owner_id === user?.id && view.scope === "personal";
  const isTeamView = !!view && view.scope === "team";
  const isWorkspaceOwner = !!user?.id && members.some(
    (m) => m.user_id === user.id && m.role === "owner",
  );

  // Local session-only overrides layered on top of the view/area base.
  const [localFilters, setLocalFilters] = useState<Filter[] | null>(null);
  const [localSort, setLocalSort] = useState<SortSpec | null>(null);
  const [localLayout, setLocalLayout] = useState<Layout | null>(null);
  const [localGroupBy, setLocalGroupBy] = useState<string | null | undefined>(undefined);
  const [renaming, setRenaming] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Header ⋯ menu is now handled by the unified RowMenu popover; no local anchor state.

  const baseFilters: Filter[] = useMemo(() => {
    if (selection.kind === "area") return [{ op: "eq", prop: "area", value: selection.area }];
    return ((view?.filter ?? []) as Filter[]);
  }, [selection, view]);
  const baseSort: SortSpec = useMemo(
    () => ((view?.sort as SortSpec | null) ?? { prop: "edited", dir: "desc" }),
    [view],
  );
  const baseLayout: Layout = (view?.layout as Layout | undefined) ?? "table";
  const baseGroupBy: string | null = view?.group_by ?? null;

  const filters = localFilters ?? baseFilters;
  const sort = localSort ?? baseSort;
  const layout: Layout = localLayout ?? baseLayout;
  const groupBy: string = (localGroupBy !== undefined ? localGroupBy : baseGroupBy) ?? "status";
  const fixedFilterIndex = selection.kind === "area" ? 0 : undefined;

  const rows = useMemo(
    () => runView(pages, { filter: filters, sort }, { me: user?.id ?? "", staleDays }),
    [pages, filters, sort, user?.id, staleDays],
  );

  const areas = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      const a = propsOf(p)["area"];
      if (typeof a === "string" && a) s.add(a);
    }
    return [...s].sort();
  }, [pages]);

  const staleThreshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const onChangeFilters = (next: Filter[]) => {
    if (selection.kind === "area") { setLocalFilters(next); return; }
    if (isOwnerOfView && view) {
      setLocalFilters(null);
      updateView.mutate({ id: view.id, patch: { filter: next } });
    } else setLocalFilters(next);
  };
  const onChangeSort = (s: SortSpec) => {
    if (selection.kind === "area") { setLocalSort(s); return; }
    if (isOwnerOfView && view) {
      setLocalSort(null);
      updateView.mutate({ id: view.id, patch: { sort: s } });
    } else setLocalSort(s);
  };
  const onChangeLayout = (l: Layout) => {
    if (selection.kind === "area") { setLocalLayout(l); return; }
    if (isOwnerOfView && view) {
      setLocalLayout(null);
      updateView.mutate({ id: view.id, patch: { layout: l } });
    } else setLocalLayout(l);
  };
  const onChangeGroupBy = (g: string) => {
    if (selection.kind === "area") { setLocalGroupBy(g); return; }
    if (isOwnerOfView && view) {
      setLocalGroupBy(undefined);
      updateView.mutate({ id: view.id, patch: { group_by: g } });
    } else setLocalGroupBy(g);
  };

  const filterEq = JSON.stringify(filters) !== JSON.stringify(baseFilters);
  const sortEq = JSON.stringify(sort) !== JSON.stringify(baseSort);
  const layoutEq = layout !== baseLayout;
  const groupEq = groupBy !== (baseGroupBy ?? "status");
  const isModified = isTeamView && (filterEq || sortEq || layoutEq || groupEq);

  const statusDef = propDefs.find((d) => d.key === "status");

  const groupableDefs = propDefs.filter(
    (d) => d.type === "select" || d.type === "status",
  );

  const onNewPage = () => {
    const seed: Record<string, unknown> = {};
    for (const f of baseFilters) {
      if (f.op === "eq" && f.prop && f.value !== undefined) seed[f.prop] = f.value;
      if (f.op === "is_me" && f.prop && user?.id) seed[f.prop] = user.id;
    }
    if (selection.kind === "area") seed.area = selection.area;
    void createAndOpen({ seedProps: seed });
  };


  const editable = selection.kind === "area" || isOwnerOfView;

  const doSaveAsMyView = () => {
    if (!view) return;
    forkView.mutate(
      {
        viewId: view.id,
        name: `${view.name} (my copy)`,
        filter: filters,
        sort,
        layout,
        groupBy: layout === "board" ? groupBy : null,
      },
      {
        onSuccess: (row) => {
          setLocalFilters(null);
          setLocalSort(null);
          setLocalLayout(null);
          setLocalGroupBy(undefined);
          navigate({ to: "/v/$viewId", params: { viewId: row.id } });
        },
      },
    );
  };
  const doDiscard = () => {
    setLocalFilters(null);
    setLocalSort(null);
    setLocalLayout(null);
    setLocalGroupBy(undefined);
  };
  const doPublish = () => {
    if (!view) return;
    publishView.mutate(view.id);
  };
  const doUnpublish = () => {
    if (!view) return;
    updateView.mutate({ id: view.id, patch: { scope: "personal" } });
  };
  const doDelete = () => {
    if (!view) return;
    deleteView.mutate(view.id, {
      onSuccess: () => {
        // Navigate to the first remaining personal view owned by me.
        const first = views
          .filter(
            (v) =>
              v.id !== view.id &&
              v.scope === "personal" &&
              v.owner_id === user?.id,
          )
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
        if (first) navigate({ to: "/v/$viewId", params: { viewId: first.id } });
        else navigate({ to: "/" });
      },
    });
  };
  const doDuplicatePersonal = () => {
    if (!view) return;
    createView.mutate(
      {
        name: `${view.name} copy`,
        icon: view.icon,
        filter: (view.filter ?? []) as Filter[],
        sort: (view.sort ?? { prop: "edited", dir: "desc" }) as SortSpec,
        layout: view.layout as Layout,
      },
      {
        onSuccess: (row) =>
          navigate({ to: "/v/$viewId", params: { viewId: row.id } }),
      },
    );
  };
  const doDuplicateTeam = () => {
    if (!view) return;
    forkView.mutate(
      {
        viewId: view.id,
        name: `${view.name} copy`,
        filter: (view.filter ?? []) as Filter[],
        sort: (view.sort ?? { prop: "edited", dir: "desc" }) as SortSpec,
        layout: view.layout as Layout,
      },
      {
        onSuccess: (row) =>
          navigate({ to: "/v/$viewId", params: { viewId: row.id } }),
      },
    );
  };
  const doAreaSaveAsView = () => {
    if (selection.kind !== "area") return;
    createView.mutate(
      {
        name: selection.area,
        filter: [{ op: "eq", prop: "area", value: selection.area }],
        sort: { prop: "edited", dir: "desc" },
        layout: "table",
      },
      {
        onSuccess: (row) =>
          navigate({ to: "/v/$viewId", params: { viewId: row.id } }),
      },
    );
  };
  const doRenameCommit = (v: string) => {
    setRenaming(false);
    if (!view) return;
    const next = v.trim();
    if (next && next !== view.name) {
      updateView.mutate({ id: view.id, patch: { name: next } });
    }
  };


  const emptyBody = (
    <div className="grid place-items-center py-20 text-center">
      <div className="font-display text-subhead text-noir">
        Nothing matches this view yet.
      </div>
      <p className="mt-2 text-meta text-secondary">
        A view is just a query — pages appear here the moment their properties match.
      </p>
    </div>
  );

  let body: ReactNode;
  if (rows.length === 0) body = emptyBody;
  else if (layout === "board")
    body = (
      <BoardBody
        rows={rows}
        groupBy={groupBy}
        propDefs={propDefs}
        members={members}
        staleThreshold={staleThreshold}
        onMove={(pageId, value) =>
          setProp.mutate({ pageId, key: groupBy, value })
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
      />
    );
  else
    body = (
      <TableBody
        rows={rows}
        pages={pages}
        members={members}
        areas={areas}
        statusDef={statusDef}
        staleThreshold={staleThreshold}
        rename={rename}
        setProp={setProp}
      />
    );

  const { prefs } = usePrefs();
  useEffect(() => {
    setDateModeForMainView(prefs.dateFormat);
  }, [prefs.dateFormat]);

  const originValue: import("@/lib/page-origin").PageOrigin =
    selection.kind === "area"
      ? { kind: "area", area: selection.area }
      : view
        ? {
            kind: "view",
            viewId: view.id,
            viewName: view.name,
            scope: view.scope === "team" ? "team" : "personal",
          }
        : { kind: "search" };

  return (
    <PageOriginContext.Provider value={originValue}>
    <div
      className="mx-auto"
      style={{ maxWidth: "var(--container-view)", padding: "34px 40px" }}
    >
      <ViewHeader
        selection={selection}
        view={view}
        rowCount={rows.length}
        onNewPage={onNewPage}
        layout={layout}
        onChangeLayout={onChangeLayout}
        renaming={renaming}
        onRenameCommit={doRenameCommit}
        onRenameCancel={() => setRenaming(false)}
      />


      <QueryToolbar
        filters={filters}
        sort={sort}

        onChangeFilters={onChangeFilters}
        onChangeSort={onChangeSort}
        propDefs={propDefs}
        staleDays={staleDays}
        editable={editable}
        fixedFilterIndex={fixedFilterIndex}
        pages={pages}
        verbose={prefs.explainQuery}
        menuBuild={() => (
          <ViewHeaderMenu
            view={view}
            selection={selection}
            isWorkspaceOwner={isWorkspaceOwner}
            isOwnerOfView={isOwnerOfView}
            isTeamView={isTeamView}
            workspaceName={workspace?.name ?? "the workspace"}
            memberCount={memberCount}
            onRename={() => setRenaming(true)}
            onDuplicatePersonal={doDuplicatePersonal}
            onDuplicateTeam={doDuplicateTeam}
            onPublish={doPublish}
            onUnpublish={doUnpublish}
            onExport={() => setExportOpen(true)}
            onDelete={doDelete}
            onAreaSaveAsView={doAreaSaveAsView}
          />
        )}
      />

      {layout === "board" && (
        <div className="-mt-1 mb-4 flex items-center gap-2 text-meta text-muted">
          <span>Grouped by</span>
          <select
            className="rounded-sm border border-line bg-surface px-2 py-1 text-meta text-body focus:outline-none"
            value={groupBy}
            onChange={(e) => onChangeGroupBy(e.target.value)}
          >
            {groupableDefs.map((d) => (
              <option key={d.id} value={d.key}>
                {d.label}
              </option>
            ))}
            {groupableDefs.length === 0 && <option value="status">Status</option>}
          </select>
        </div>
      )}

      {isModified && (
        <ModifiedBanner
          viewName={view!.name}
          workspaceName={workspace?.name ?? "the workspace"}
          onSave={doSaveAsMyView}
          onDiscard={doDiscard}
        />
      )}

      {body}

      {exportOpen && (
        <ExportViewDialog
          name={selection.kind === "area" ? selection.area : view?.name ?? "view"}
          rows={rows.map<ExportViewRow>((p) => {
            const pp = (p.props ?? {}) as Record<string, unknown>;
            const area = typeof pp.area === "string" ? pp.area : null;
            const ownerId = typeof pp.owner === "string" ? pp.owner : null;
            const statusVal = typeof pp.status === "string" ? pp.status : null;
            const statusOpts =
              (statusDef?.options as unknown as Array<{
                value: string;
                label: string;
              }>) ?? [];
            const status =
              statusOpts.find((o) => o.value === statusVal)?.label ??
              statusVal;
            const tags = Array.isArray(pp.tags)
              ? (pp.tags as unknown[]).filter(
                  (t): t is string => typeof t === "string",
                )
              : [];
            return {
              title: p.title ?? null,
              area,
              ownerId,
              status,
              tags,
              verifiedAt: p.verified_at ?? null,
              editedAt: p.edited_at ?? null,
            };
          })}
          resolveOwner={(id) => {
            if (!id) return "";
            const m = members.find((mm) => mm.user_id === id);
            return m?.profiles?.full_name || m?.profiles?.email || "";
          }}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
    </PageOriginContext.Provider>
  );

}

/* ─────────────────────────── Modified banner ─────────────────────────── */

function ModifiedBanner({
  viewName,
  workspaceName,
  onSave,
  onDiscard,
}: {
  viewName: string;
  workspaceName: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amberRing bg-amberTint px-3 py-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-amberDot" aria-hidden />
        <span className="font-display text-label uppercase text-amberInk">MODIFIED</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            className="rounded-md bg-noir px-3 py-1 text-meta font-bold text-canvas"
          >
            Save as my view
          </button>
          <button
            type="button"
            aria-label="Discard changes"
            onClick={onDiscard}
            className="grid h-7 w-7 place-items-center rounded-md text-amberInk hover:bg-amberRing"
          >
            ×
          </button>
        </div>
      </div>
      <p className="mt-1 px-1 text-caption text-amberInk">
        You&apos;re looking at unsaved changes. <b>{viewName}</b> is untouched for everyone
        else at {workspaceName} — saving makes a copy in <b>My views</b>.
      </p>
    </div>
  );
}

/* ─────────────────────────── Header options menu ─────────────────────────── */

function ViewHeaderMenu({
  view,
  selection,
  isWorkspaceOwner,
  isOwnerOfView,
  isTeamView,
  workspaceName,
  memberCount,
  onRename,
  onDuplicatePersonal,
  onDuplicateTeam,
  onPublish,
  onUnpublish,
  onExport,
  onDelete,
  onAreaSaveAsView,
}: {
  view: ViewRow | null;
  selection: Selection;
  isWorkspaceOwner: boolean;
  isOwnerOfView: boolean;
  isTeamView: boolean;
  workspaceName: string;
  memberCount: number;
  onRename: () => void;
  onDuplicatePersonal: () => void;
  onDuplicateTeam: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onExport: () => void;
  onDelete: () => void;
  onAreaSaveAsView: () => void;
}) {
  const [mode, setMode] = useState<"list" | "publish" | "delete">("list");

  const name = view?.name ?? (selection.kind === "area" ? selection.area : "");
  const title =
    selection.kind === "area"
      ? "Area"
      : isTeamView
        ? "Team view"
        : "My view";

  if (mode === "publish") {
    return (
      <RowMenuConfirm
        title="Publish to the whole team?"
        body={`It moves out of My views into Team views for all ${memberCount} people at ${workspaceName}.`}
        confirmLabel="Publish"
        variant="publish"
        onConfirm={onPublish}
      />
    );
  }
  if (mode === "delete") {
    return (
      <RowMenuConfirm
        title={`Delete "${name}"?`}
        body="The view disappears — the pages it filtered are untouched."
        confirmLabel="Delete view"
        variant="danger"
        onConfirm={onDelete}
      />
    );
  }

  type Item =
    | { kind: "divider" }
    | {
        id: string;
        label: string;
        hint?: ReactNode;
        danger?: boolean;
        submenu?: true;
        keepOpen?: true;
        disabled?: boolean;
        onSelect?: () => void;
      };
  const items: Item[] = [];

  if (selection.kind === "area") {
    items.push({
      id: "save-as-view",
      label: "Save as my view",
      hint: <Val>personal</Val>,
      onSelect: onAreaSaveAsView,
    });
    items.push({
      id: "export",
      label: "Export view",
      hint: <Val>CSV, Markdown</Val>,
      onSelect: onExport,
    });
  } else if (isOwnerOfView) {
    items.push({
      id: "rename",
      label: "Rename view",
      onSelect: onRename,
    });
    items.push({
      id: "duplicate",
      label: "Duplicate",
      hint: <Val>personal</Val>,
      onSelect: onDuplicatePersonal,
    });
    if (isWorkspaceOwner) {
      items.push({
        id: "publish",
        label: "Publish to team",
        hint: <Val>shared</Val>,
        submenu: true,
        keepOpen: true,
        onSelect: () => setMode("publish"),
      });
    }
    items.push({
      id: "export",
      label: "Export view",
      hint: <Val>CSV, Markdown</Val>,
      onSelect: onExport,
    });
    items.push({ kind: "divider" });
    items.push({
      id: "delete",
      label: "Delete view",
      danger: true,
      submenu: true,
      keepOpen: true,
      onSelect: () => setMode("delete"),
    });
  } else if (isTeamView) {
    items.push({
      id: "duplicate",
      label: "Duplicate into My views",
      hint: <Val>personal</Val>,
      onSelect: onDuplicateTeam,
    });
    items.push({
      id: "export",
      label: "Export view",
      hint: <Val>CSV, Markdown</Val>,
      onSelect: onExport,
    });
    if (isWorkspaceOwner) {
      items.push({ kind: "divider" });
      items.push({
        id: "unpublish",
        label: "Unpublish to personal",
        hint: <Val>personal</Val>,
        onSelect: onUnpublish,
      });
      items.push({
        id: "delete",
        label: "Delete view",
        danger: true,
        submenu: true,
        keepOpen: true,
        onSelect: () => setMode("delete"),
      });
    }
  }

  if (!items.length)
    items.push({ id: "none", label: "No actions available", disabled: true });
  return <RowMenuList title={title} items={items} />;
}


/* ─────────────────────────── Table body ─────────────────────────── */

function useStableStringArray(arr: string[]): string[] {
  const ref = useRef(arr);
  const prev = ref.current;
  if (prev.length !== arr.length || prev.some((x, i) => x !== arr[i])) {
    ref.current = arr;
  }
  return ref.current;
}

type SetPropFn = ReturnType<typeof useSetPageProperty>["mutate"];
type RenameFn = ReturnType<typeof useRenamePage>["mutate"];

const TableRow = memo(function TableRow({
  p,
  isStale,
  areas,
  allTags,
  members,
  statusDef,
  rename,
  setProp,
  pagesForTitleCell,
}: {
  p: PageListItem;
  isStale: boolean;
  areas: string[];
  allTags: string[];
  members: MemberRow[];
  statusDef: PropDef | undefined;
  rename: RenameFn;
  setProp: SetPropFn;
  pagesForTitleCell: PageListItem[];
}) {
  return (
    <RowGroup>
      <Cell>
        <PageTitleCell
          page={p}
          onSave={(t) => rename({ pageId: p.id, title: t })}
        />
      </Cell>
      <Cell className="hidden xs:block">
        <AreaCell
          page={p}
          areas={areas}
          onPick={(v) => setProp({ pageId: p.id, key: "area", value: v })}
        />
      </Cell>
      <Cell>
        <OwnerCell
          page={p}
          members={members}
          onPick={(uid) => setProp({ pageId: p.id, key: "owner", value: uid })}
        />
      </Cell>
      <Cell>
        <StatusCell
          page={p}
          def={statusDef}
          onPick={(v) => setProp({ pageId: p.id, key: "status", value: v })}
        />
      </Cell>
      <Cell className="hidden sm:block">
        <TagsCellMemo
          page={p}
          allTags={allTags}
          onSet={(tags) => setProp({ pageId: p.id, key: "tags", value: tags })}
        />
      </Cell>
      <Cell className="hidden md:block">
        {isStale ? (
          <span className="inline-flex items-center gap-1 font-bold text-amberInk">
            ⚠ {relTime(p.verified_at)}
          </span>
        ) : (
          <span className="text-meta text-muted">{relTime(p.verified_at)}</span>
        )}
      </Cell>
      <Cell>
        <span className="text-meta text-muted">{relTime(p.edited_at)}</span>
      </Cell>
      {/* keep prop referenced so lint stays quiet — hover prefetch lives in PageTitleCell */}
      <span hidden data-count={pagesForTitleCell.length} />
    </RowGroup>
  );
});

/** Tag cell that takes a stable options list instead of the whole pages array. */
const TagsCellMemo = memo(function TagsCellMemo({
  page,
  allTags,
  onSet,
}: {
  page: PageListItem;
  allTags: string[];
  onSet: (tags: string[]) => void;
}) {
  return <TagsCell page={page} onSet={onSet} pages={[]} allOverride={allTags} />;
});

function TableBody({
  rows,
  pages,
  members,
  areas,
  statusDef,
  staleThreshold,
  rename,
  setProp,
}: {
  rows: PageListItem[];
  pages: PageListItem[];
  members: MemberRow[];
  areas: string[];
  statusDef: PropDef | undefined;
  staleThreshold: number;
  rename: ReturnType<typeof useRenamePage>;
  setProp: ReturnType<typeof useSetPageProperty>;
}) {
  // Stable tag options: recompute from pages, but keep the same array ref
  // when contents are unchanged so memoized rows don't re-render.
  const tagsRaw = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      const t = (p.props && typeof p.props === "object" && !Array.isArray(p.props)
        ? (p.props as Record<string, unknown>)["tags"]
        : undefined);
      if (Array.isArray(t)) t.forEach((x) => s.add(String(x)));
    }
    return [...s].sort();
  }, [pages]);
  const allTags = useStableStringArray(tagsRaw);
  const stableAreas = useStableStringArray(areas);
  const renameMutate = rename.mutate;
  const setPropMutate = setProp.mutate;

  return (
    <div className="overflow-x-auto">
      <div
        role="table"
        className="min-w-full text-row"
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,0.9fr) minmax(0,0.9fr)",
        }}
      >
        <HeaderCell>Page</HeaderCell>
        <HeaderCell className="hidden xs:block">Area</HeaderCell>
        <HeaderCell>Owner</HeaderCell>
        <HeaderCell>Status</HeaderCell>
        <HeaderCell className="hidden sm:block">Tags</HeaderCell>
        <HeaderCell className="hidden md:block">Verified</HeaderCell>
        <HeaderCell>Edited</HeaderCell>

        {rows.map((p) => (
          <TableRow
            key={p.id}
            p={p}
            isStale={new Date(p.verified_at).getTime() < staleThreshold}
            areas={stableAreas}
            allTags={allTags}
            members={members}
            statusDef={statusDef}
            rename={renameMutate}
            setProp={setPropMutate}
            pagesForTitleCell={pages}
          />
        ))}
      </div>
    </div>
  );
}


/* ─────────────────────────── Board body ─────────────────────────── */

function BoardBody({
  rows,
  groupBy,
  propDefs,
  members,
  staleThreshold,
  onMove,
}: {
  rows: PageListItem[];
  groupBy: string;
  propDefs: PropDef[];
  members: MemberRow[];
  staleThreshold: number;
  onMove: (pageId: string, value: string) => void;
}) {
  const navigate = useNavigate();
  const setOrigin = useSetPageOrigin();

  const def = propDefs.find((d) => d.key === groupBy);
  const opts =
    (def?.options as unknown as Array<{
      value: string;
      label: string;
      tint: string;
      ink: string;
    }>) ?? [];

  const columns = useMemo(() => {
    const groups = new Map<string, PageListItem[]>();
    for (const p of rows) {
      const v = propsOf(p)[groupBy];
      const key = typeof v === "string" && v ? v : "__none";
      const arr = groups.get(key);
      if (arr) arr.push(p);
      else groups.set(key, [p]);
    }
    const ordered: Array<{ value: string; opt?: (typeof opts)[number]; pages: PageListItem[] }> = [];
    for (const o of opts) ordered.push({ value: o.value, opt: o, pages: groups.get(o.value) ?? [] });
    // Extra values not in options
    for (const [k, pgs] of groups)
      if (k !== "__none" && !opts.some((o) => o.value === k))
        ordered.push({ value: k, pages: pgs });
    return ordered;
  }, [rows, opts, groupBy]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <div
          key={col.value}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("text/pageId");
            if (id) onMove(id, col.value);
          }}
          className="shrink-0 rounded-xl bg-rail p-[10px]"
          style={{ width: "var(--container-boardCol)" }}
        >
          <div className="mb-2 flex items-center gap-2 px-1 text-meta">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--color-${col.opt?.ink ?? "muted"})` }}
              aria-hidden
            />
            <span className="font-bold text-body">{col.opt?.label ?? col.value}</span>
            <span className="ml-auto text-faint">{col.pages.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {col.pages.map((p) => {
              const isStale = new Date(p.verified_at).getTime() < staleThreshold;
              const ownerId = propsOf(p)["owner"];
              const owner =
                typeof ownerId === "string"
                  ? members.find((m) => m.user_id === ownerId)?.profiles
                  : null;
              return (
                <button
                  key={p.id}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/pageId", p.id)}
                  onClick={() => { setOrigin(p.id); navigate({ to: "/p/$pageId", params: { pageId: p.id } }); }}

                  className="rounded-lg border border-line bg-surface p-2 text-left shadow-card transition hover:shadow-cardHover"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-row leading-none">{p.icon ?? "📄"}</span>
                    <span className="min-w-0 flex-1 truncate text-row font-bold text-noir">
                      {p.title || "Untitled"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-caption">
                    {owner && (
                      <span
                        className="grid h-5 w-5 place-items-center rounded-full text-caption font-bold"
                        style={{
                          background: `var(--color-${owner.avatar_tint ?? "sunken"})`,
                          color: `var(--color-${owner.avatar_ink ?? "body"})`,
                        }}
                      >
                        {(owner.full_name ?? owner.email ?? "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {isStale ? (
                      <span className="ml-auto font-display text-label uppercase text-amberInk">
                        STALE
                      </span>
                    ) : (
                      <span className="ml-auto text-muted">{relTime(p.edited_at)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {columns.length === 0 && (
        <div className="text-meta text-muted">Pick a property with options to group by.</div>
      )}
    </div>
  );
}

/* ─────────────────────────── List body ─────────────────────────── */

function ListBody({
  rows,
  members,
  propDefs,
  staleThreshold,
}: {
  rows: PageListItem[];
  members: MemberRow[];
  propDefs: PropDef[];
  staleThreshold: number;
}) {
  const navigate = useNavigate();
  const setOrigin = useSetPageOrigin();

  const statusDef = propDefs.find((d) => d.key === "status");
  const statusOpts =
    (statusDef?.options as unknown as Array<{ value: string; label: string }>) ?? [];

  return (
    <div style={{ maxWidth: 800 }}>
      {rows.map((p, idx) => {
        const props = propsOf(p);
        const isStale = new Date(p.verified_at).getTime() < staleThreshold;
        const ownerId = props["owner"];
        const owner =
          typeof ownerId === "string"
            ? members.find((m) => m.user_id === ownerId)?.profiles
            : null;
        const status = statusOpts.find((o) => o.value === props["status"])?.label;
        const area = typeof props["area"] === "string" ? props["area"] : null;
        const ownerName = owner?.full_name ?? owner?.email ?? null;
        const parts = [area, ownerName, status].filter(Boolean) as string[];
        const isLast = idx === rows.length - 1;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => { setOrigin(p.id); navigate({ to: "/p/$pageId", params: { pageId: p.id } }); }}
            className={
              "grid w-full items-center gap-[11px] rounded-lg text-left hover:bg-sunken " +
              (isLast ? "" : "border-b border-lineSoft ")
            }
            style={{
              gridTemplateColumns: "20px minmax(0,1fr) auto",
              minHeight: "var(--gio-list-row, 44px)",
              padding: "7px 10px",
            }}
          >
            <span className="text-row leading-none">{p.icon ?? "📄"}</span>
            <div className="min-w-0">
              <div className="truncate text-row font-bold text-noir">
                {p.title || "Untitled"}
              </div>
              {parts.length > 0 && (
                <div className="truncate text-caption text-muted" style={{ marginTop: 1 }}>
                  {parts.map((s, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-rule"> · </span>}
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {isStale ? (
              <span className="shrink-0 text-caption font-bold text-amberInk tnum">
                ⚠ {relTime(p.verified_at)}
              </span>
            ) : (
              <span className="shrink-0 text-caption text-faint tnum">
                {relTime(p.edited_at)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}




function HeaderCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={
        "border-b border-line bg-canvas px-[11px] py-1 text-label uppercase text-faint " +
        (className ?? "")
      }
    >
      {children}
    </div>
  );
}


function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={
        "min-w-0 border-b border-lineSoft px-[11px] gio-cell-pad flex items-center whitespace-nowrap overflow-hidden " +
        (className ?? "")
      }
    >
      {children}
    </div>
  );
}

function RowGroup({ children }: { children: ReactNode }) {
  // grid subrow container that highlights on hover across its 7 cells.
  return <div className="contents group hover:[&>div]:bg-sunken">{children}</div>;
}
