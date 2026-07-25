import { useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import { qk } from "@/lib/query-keys";
import { Popover } from "./popover";
import {
  useSetPageProperty,
  useRenamePage,
  useCreatePage,
} from "@/hooks/use-page-mutations";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";

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
}: {
  selection: Selection;
  view: ViewRow | null;
  rowCount: number;
  onNewPage: () => void;
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
            const active = l === (view?.layout ?? "table");
            const disabled = l !== "table";
            return (
              <button
                key={l}
                type="button"
                disabled={disabled}
                title={disabled ? "Coming in a later phase" : l}
                aria-label={l}
                className={
                  "grid h-8 w-8 place-items-center " +
                  (active ? "bg-selected text-noir" : "text-muted") +
                  (disabled ? " opacity-40 cursor-not-allowed" : " hover:bg-rail")
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
        <span className="italic text-meta text-whisper">anything — every page</span>
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
      <div className="ml-auto">
        <select
          className="rounded-sm border border-line bg-surface px-2 py-1 text-meta text-secondary"
          value={`${sort.prop}:${sort.dir}`}
          disabled={!editable}
          onChange={(e) => {
            const [prop, dir] = e.target.value.split(":") as [SortSpec["prop"], SortSpec["dir"]];
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
  return (
    <div className="flex min-w-0 items-center gap-2">
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
          className="min-w-0 flex-1 bg-transparent text-row focus:outline-none"
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-row"
          onClick={() => {
            setValue(page.title ?? "");
            setEditing(true);
          }}
        >
          {page.title || <span className="text-faint italic">Untitled</span>}
        </button>
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
  const qc = useQueryClient();
  const setProp = useSetPageProperty();
  const rename = useRenamePage();
  const create = useCreatePage();

  const pages = (shell.pages.data ?? []) as PageListItem[];
  const views = (shell.views.data ?? []) as ViewRow[];
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const propDefs = (shell.propDefs.data ?? []) as PropDef[];
  const workspace = shell.workspace.data;
  const staleDays = workspace?.stale_days ?? 30;

  const view = selection.kind === "view" ? views.find((v) => v.id === selection.id) ?? null : null;
  const isOwnerOfView = !!view && view.owner_id === user?.id && view.scope === "personal";
  const isTeamView = !!view && view.scope === "team";

  // Local session-only filter/sort layered on top of the view/area base.
  const [localFilters, setLocalFilters] = useState<Filter[] | null>(null);
  const [localSort, setLocalSort] = useState<SortSpec | null>(null);

  const baseFilters: Filter[] = useMemo(() => {
    if (selection.kind === "area") return [{ op: "eq", prop: "area", value: selection.area }];
    return ((view?.filter ?? []) as Filter[]);
  }, [selection, view]);
  const baseSort: SortSpec = useMemo(
    () => ((view?.sort as SortSpec | null) ?? { prop: "edited", dir: "desc" }),
    [view],
  );

  const filters = localFilters ?? baseFilters;
  const sort = localSort ?? baseSort;
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

  async function persistViewChange(next: { filter?: Filter[]; sort?: SortSpec }) {
    if (!view || !isOwnerOfView) return;
    const patch: Partial<ViewRow> = {};
    if (next.filter) patch.filter = next.filter as never;
    if (next.sort) patch.sort = next.sort as never;
    qc.setQueryData<ViewRow[]>(qk.views(ws), (prev) =>
      prev ? prev.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) : prev,
    );
    const { error } = await supabase.from("views").update(patch).eq("id", view.id);
    if (error) qc.invalidateQueries({ queryKey: qk.views(ws) });
  }

  const onChangeFilters = (next: Filter[]) => {
    if (selection.kind === "area") {
      setLocalFilters(next);
      return;
    }
    if (isOwnerOfView) {
      setLocalFilters(null);
      void persistViewChange({ filter: next });
    } else {
      setLocalFilters(next);
    }
  };
  const onChangeSort = (s: SortSpec) => {
    if (selection.kind === "area") {
      setLocalSort(s);
      return;
    }
    if (isOwnerOfView) {
      setLocalSort(null);
      void persistViewChange({ sort: s });
    } else {
      setLocalSort(s);
    }
  };

  const statusDef = propDefs.find((d) => d.key === "status");

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

  return (
    <div className="mx-auto max-w-view px-6 py-6">
      <ViewHeader
        selection={selection}
        view={view}
        areaCount={selection.kind === "area" ? rows.length : undefined}
        onNewPage={onNewPage}
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
      />
      {isTeamView && (
        <p className="mb-3 text-caption text-muted">
          Team view — filtering forks to a personal copy (next phase)
        </p>
      )}

      {rows.length === 0 ? (
        <div className="grid place-items-center py-20 text-center">
          <div className="font-display text-subhead text-noir">
            Nothing matches this view yet.
          </div>
          <p className="mt-2 text-meta text-faint">
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
        "min-w-0 border-b border-lineSoft px-[11px] py-[5px] " + (className ?? "")
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
