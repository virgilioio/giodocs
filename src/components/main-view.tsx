import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell, pageQuery } from "@/hooks/use-workspace-data";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import { Popover } from "./popover";
import {
  useSetPageProperty,
  useRenamePage,
  useCreatePage,
  useUpdateView,
  useForkView,
  usePublishView,
  useDeleteView,
} from "@/hooks/use-page-mutations";
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

function relTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
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

function describeFilter(f: Filter, propDefs: PropDef[], staleDays: number): string {
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
  onOpenMenu,
}: {
  selection: Selection;
  view: ViewRow | null;
  rowCount: number;
  onNewPage: () => void;
  layout: Layout;
  onChangeLayout: (l: Layout) => void;
  onOpenMenu: (btn: HTMLElement) => void;
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
          {name}
          <span className="ml-3 align-baseline text-ui text-faint font-normal tracking-normal">
            {countLabel}
          </span>
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center rounded-md border border-line bg-surface">
          {(["table", "board", "list"] as const).map((l) => {
            const active = l === layout;
            return (
              <button
                key={l}
                type="button"
                title={l}
                aria-label={l}
                onClick={() => onChangeLayout(l)}
                className={
                  "grid h-8 w-8 place-items-center " +
                  (active ? "bg-selected text-noir" : "text-muted hover:bg-rail")
                }
              >
                <LayoutGlyph layout={l} />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onNewPage}
          className="inline-flex items-center gap-1 rounded-lg bg-noir px-3 text-ui font-bold text-canvas"
          style={{ height: 36 }}
        >
          <Glyph path="M12 5v14M5 12h14" className="h-3.5 w-3.5" />
          New page
        </button>
        <button
          type="button"
          aria-label="View options"
          onClick={(e) => onOpenMenu(e.currentTarget)}
          className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-muted hover:bg-rail"
        >
          <Glyph
            path="M6 12a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2z"
            className="h-4 w-4"
          />
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
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-lineSoft pb-3">
      <span className="text-meta text-muted">Pages where</span>
      {filters.length === 0 && (
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
        <button
          type="button"
          title="View options — coming soon"
          aria-label="View options"
          className="grid h-7 w-7 place-items-center rounded-sm text-muted hover:bg-sunken"
        >
          <Glyph
            path="M6 12a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2z"
            className="h-4 w-4"
          />
        </button>
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
            onClick={() =>
              navigate({ to: "/p/$pageId", params: { pageId: page.id } })
            }
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
  const opts = (def.options as unknown as Array<{ value: string; label: string; tint: string; ink: string }>) ?? [];
  const v = propsOf(page)[def.key];
  const current = opts.find((o) => o.value === v);
  return (
    <Popover
      width={200}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="text-left"
        >
          {current ? (
            <StatusChip label={current.label} tint={current.tint} ink={current.ink} />
          ) : (
            <span className="text-faint">—</span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div>
          {opts.map((o) => (
            <button
              key={o.value}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-1 text-left hover:bg-rail"
              onClick={() => {
                onPick(o.value);
                close();
              }}
            >
              <StatusChip label={o.label} tint={o.tint} ink={o.ink} />
            </button>
          ))}
          <div className="my-1 border-t border-lineSoft" />
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-rail"
            onClick={() => {
              onPick(null);
              close();
            }}
          >
            Clear
          </button>
        </div>
      )}
    </Popover>
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
    <Popover
      width={240}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {current ? (
            <>
              <Avatar profile={current.profiles} />
              <span className="min-w-0 truncate text-meta text-body hidden md:inline">
                {current.profiles?.full_name}
              </span>
            </>
          ) : (
            <span className="text-faint">No owner</span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-72 overflow-y-auto">
          {members.map((m) => (
            <button
              key={m.user_id}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-rail"
              onClick={() => {
                onPick(m.user_id);
                close();
              }}
            >
              <Avatar profile={m.profiles} />
              <span className="text-meta">{m.profiles?.full_name}</span>
            </button>
          ))}
          <div className="my-1 border-t border-lineSoft" />
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-rail"
            onClick={() => {
              onPick(null);
              close();
            }}
          >
            No owner
          </button>
        </div>
      )}
    </Popover>
  );
}

function Avatar({ profile }: { profile: MemberRow["profiles"] }) {
  const initials = (profile?.full_name || profile?.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-caption"
      style={{
        background: profile?.avatar_tint ?? "var(--color-sunken)",
        color: profile?.avatar_ink ?? "var(--color-noir)",
      }}
    >
      {initials}
    </span>
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
  const [neu, setNeu] = useState("");
  return (
    <Popover
      width={220}
      trigger={({ onClick, ref }) => (
        <button ref={ref} type="button" onClick={onClick} className="text-left text-meta">
          {typeof value === "string" && value ? value : <span className="text-faint">—</span>}
        </button>
      )}
    >
      {(close) => (
        <div>
          {areas.map((a) => (
            <button
              key={a}
              type="button"
              className="w-full rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
              onClick={() => {
                onPick(a);
                close();
              }}
            >
              {a}
            </button>
          ))}
          <div className="my-1 border-t border-lineSoft" />
          <div className="flex gap-1 p-1">
            <input
              value={neu}
              onChange={(e) => setNeu(e.target.value)}
              placeholder="Move to new area…"
              className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-meta"
            />
            <button
              type="button"
              disabled={!neu.trim()}
              onClick={() => {
                onPick(neu.trim());
                close();
              }}
              className="rounded-sm bg-noir px-2 text-meta font-bold text-canvas disabled:opacity-40"
            >
              Set
            </button>
          </div>
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-rail"
            onClick={() => {
              onPick(null);
              close();
            }}
          >
            Clear
          </button>
        </div>
      )}
    </Popover>
  );
}

function TagsCell({
  page,
  onSet,
  pages,
}: {
  page: PageListItem;
  onSet: (tags: string[]) => void;
  pages: PageListItem[];
}) {
  const raw = propsOf(page)["tags"];
  const tags = Array.isArray(raw) ? raw.map(String) : [];
  const all = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      const t = propsOf(p)["tags"];
      if (Array.isArray(t)) t.forEach((x) => s.add(String(x)));
    }
    return [...s].sort();
  }, [pages]);
  const [neu, setNeu] = useState("");
  const shown = tags.slice(0, 3);
  const extra = tags.length - shown.length;
  return (
    <Popover
      width={240}
      trigger={({ onClick, ref }) => (
        <button ref={ref} type="button" onClick={onClick} className="flex flex-wrap items-center gap-1">
          {shown.map((t) => {
            const c = hashTag(t);
            return (
              <span
                key={t}
                className="rounded-sm px-1.5 py-0.5 text-caption"
                style={{ background: `var(--color-${c.tint})`, color: `var(--color-${c.ink})` }}
              >
                {t}
              </span>
            );
          })}
          {extra > 0 && <span className="text-caption text-muted">+{extra}</span>}
          {tags.length === 0 && <span className="text-faint">—</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-72 overflow-y-auto">
          {all.map((t) => {
            const on = tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                className="flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
                onClick={() => {
                  const next = on ? tags.filter((x) => x !== t) : [...tags, t];
                  onSet(next);
                }}
              >
                <span>{t}</span>
                {on && <span className="text-accent">✓</span>}
              </button>
            );
          })}
          <div className="my-1 border-t border-lineSoft" />
          <div className="flex gap-1 p-1">
            <input
              value={neu}
              onChange={(e) => setNeu(e.target.value)}
              placeholder="New tag…"
              className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-meta"
            />
            <button
              type="button"
              disabled={!neu.trim()}
              onClick={() => {
                onSet([...tags, neu.trim()]);
                setNeu("");
                close();
              }}
              className="rounded-sm bg-noir px-2 text-meta font-bold text-canvas disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </Popover>
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
  const updateView = useUpdateView();
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

  // Local session-only overrides layered on top of the view/area base.
  const [localFilters, setLocalFilters] = useState<Filter[] | null>(null);
  const [localSort, setLocalSort] = useState<SortSpec | null>(null);
  const [localLayout, setLocalLayout] = useState<Layout | null>(null);
  const [localGroupBy, setLocalGroupBy] = useState<string | null | undefined>(undefined);
  const [headerMenuAnchor, setHeaderMenuAnchor] = useState<HTMLElement | null>(null);

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
    create.mutate({ seedProps: seed });
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
    if (
      !window.confirm(
        `Publish "${view.name}" to Team views? It moves out of My views into Team views for all ${memberCount} people at ${workspace?.name ?? "the workspace"}. Publishing is the only way a view becomes shared.`,
      )
    )
      return;
    publishView.mutate(view.id);
  };
  const doDelete = () => {
    if (!view) return;
    if (window.confirm(`Delete view "${view.name}"?`)) deleteView.mutate(view.id);
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

  return (
    <div className="mx-auto max-w-view px-6 py-6">
      <ViewHeader
        selection={selection}
        view={view}
        rowCount={rows.length}
        onNewPage={onNewPage}
        layout={layout}
        onChangeLayout={onChangeLayout}
        onOpenMenu={(btn) => setHeaderMenuAnchor(btn)}
      />

      {headerMenuAnchor && (
        <HeaderMenu
          anchor={headerMenuAnchor}
          onClose={() => setHeaderMenuAnchor(null)}
          canPublish={isOwnerOfView}
          canDelete={isOwnerOfView}
          canSaveAs={isTeamView}
          onPublish={doPublish}
          onSaveAs={doSaveAsMyView}
          onDelete={doDelete}
        />
      )}

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
    </div>
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

function HeaderMenu({
  anchor,
  onClose,
  canPublish,
  canDelete,
  canSaveAs,
  onPublish,
  onSaveAs,
  onDelete,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  canPublish: boolean;
  canDelete: boolean;
  canSaveAs: boolean;
  onPublish: () => void;
  onSaveAs: () => void;
  onDelete: () => void;
}) {
  const rect = anchor.getBoundingClientRect();
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 min-w-[180px] rounded-md border border-line bg-surface shadow-popover"
        style={{ top: rect.bottom + 6, left: rect.right - 180 }}
      >
        {canSaveAs && (
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-meta hover:bg-rail"
            onClick={() => { onClose(); onSaveAs(); }}
          >
            Save as my view
          </button>
        )}
        {canPublish && (
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-meta hover:bg-rail"
            onClick={() => { onClose(); onPublish(); }}
          >
            Publish to team
          </button>
        )}
        {canDelete && (
          <>
            <div className="my-1 border-t border-lineSoft" />
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-meta text-danger hover:bg-dangerTint"
              onClick={() => { onClose(); onDelete(); }}
            >
              Delete view
            </button>
          </>
        )}
        {!canSaveAs && !canPublish && !canDelete && (
          <div className="px-3 py-2 text-meta text-muted">No actions available</div>
        )}
      </div>
    </>
  );
}

/* ─────────────────────────── Table body ─────────────────────────── */

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
  return (


      {rows.length === 0 ? (
        <div className="grid place-items-center py-20 text-center">
          <div className="font-display text-subhead text-noir">
            Nothing matches this view yet.
          </div>
          <p className="mt-2 text-meta text-secondary">
            A view is just a query — pages appear here the moment their properties match.
          </p>
        </div>
      ) : (
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

            {rows.map((p) => {
              const isStale = new Date(p.verified_at).getTime() < staleThreshold;
              return (
                <RowGroup key={p.id}>
                  <Cell>
                    <PageTitleCell
                      page={p}
                      onSave={(t) => rename.mutate({ pageId: p.id, title: t })}
                    />
                  </Cell>
                  <Cell className="hidden xs:block">
                    <AreaCell
                      page={p}
                      areas={areas}
                      onPick={(v) =>
                        setProp.mutate({ pageId: p.id, key: "area", value: v })
                      }
                    />
                  </Cell>
                  <Cell>
                    <OwnerCell
                      page={p}
                      members={members}
                      onPick={(uid) =>
                        setProp.mutate({ pageId: p.id, key: "owner", value: uid })
                      }
                    />
                  </Cell>
                  <Cell>
                    <StatusCell
                      page={p}
                      def={statusDef}
                      onPick={(v) =>
                        setProp.mutate({ pageId: p.id, key: "status", value: v })
                      }
                    />
                  </Cell>
                  <Cell className="hidden sm:block">
                    <TagsCell
                      page={p}
                      pages={pages}
                      onSet={(tags) =>
                        setProp.mutate({ pageId: p.id, key: "tags", value: tags })
                      }
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
                </RowGroup>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function HeaderCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={
        "border-b border-line px-[11px] py-1 text-label uppercase text-faint " +
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
        "min-w-0 border-b border-lineSoft px-[11px] py-[10px] " + (className ?? "")
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
