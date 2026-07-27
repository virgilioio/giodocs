import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/preferences";
import { formatTimestamp } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell, pageQuery } from "@/hooks/use-workspace-data";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import { applyFilterReplacement, filterLabel } from "@/lib/filter-label";
import { PageOriginContext, useSetPageOrigin } from "@/lib/page-origin";
import { areaBaseView, currentView, type ViewBase, type ViewDraft } from "@/lib/view-drafts";
import {
  useDrafts,
  patchDraft as storePatchDraft,
  clearDraft as storeClearDraft,
} from "@/lib/view-drafts-store";

import { useToast } from "@/lib/toast";

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
  SpecMenuTrigger,
  type MenuSpec,
  type MenuRow,
} from "./row-menu";
import { personalViewFooter } from "@/lib/personal-view-footer";
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
import { EmojiPicker } from "./emoji-picker";
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

/* describeFilter — REMOVED. Every filter chip text now flows through
 * filterLabel() in @/lib/filter-label. See B1 spec §1. */



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

/**
 * QueryToolbar — the sentence. See B1 spec §2.
 *
 * One flex-wrap row. Order:
 *   "Pages where" · chips · [italic empty-label] · +Filter
 *   · vertical divider · sort · group (board only) · spacer · ⋯
 *
 * Chips render text via filterLabel(). Adding/replacing filters go through
 * applyFilterReplacement — no other place computes chip text or the rule.
 */

type PersonForLabel = { id: string; full_name: string | null };

function QueryToolbar({
  filters,
  sort,
  groupBy,
  layout,
  onChangeFilters,
  onChangeSort,
  onChangeGroupBy,
  propDefs,
  people,
  staleDays,
  editable,
  fixedFilterIndex,
  pages,
  verbose,
  pill,
  menuSpec,
}: {
  filters: Filter[];
  sort: SortSpec;
  groupBy: string;
  layout: Layout;
  onChangeFilters: (next: Filter[]) => void;
  onChangeSort: (s: SortSpec) => void;
  onChangeGroupBy: (g: string) => void;
  propDefs: PropDef[];
  people: PersonForLabel[];
  staleDays: number;
  editable: boolean;
  fixedFilterIndex?: number;
  pages: PageListItem[];
  verbose: boolean;
  pill?: ReactNode;
  menuSpec: (ctx: { setSpec: (s: MenuSpec) => void; close: () => void }) => MenuSpec;
}) {
  const pickFilter = (picked: Filter) =>
    onChangeFilters(applyFilterReplacement(filters, picked));
  const groupableDefs = propDefs.filter(
    (d) => d.type === "select" || d.type === "status",
  );

  return (
    <div
      className="flex flex-wrap items-center"
      style={{ marginTop: 14, gap: 7 }}
    >
      {verbose && (
        <>
          <span style={{ fontSize: 13, color: "var(--color-faint)" }}>
            Pages where
          </span>
          {filters.map((f, i) => {
            const fixed = i === fixedFilterIndex;
            const clickable = editable && !fixed;
            return (
              <FilterChip
                key={i}
                label={filterLabel(f, { people, staleDays })}
                clickable={clickable}
                removable={clickable}
                onRemove={() =>
                  onChangeFilters(filters.filter((_, idx) => idx !== i))
                }
                renderPicker={
                  clickable
                    ? (close) => (
                        <FilterBuilderContent
                          propDefs={propDefs}
                          pages={pages}
                          people={people}
                          staleDays={staleDays}
                          startAt={{ prop: f.prop, op: f.op }}
                          onPick={(picked) => {
                            pickFilter(picked);
                            close();
                          }}
                        />
                      )
                    : undefined
                }
              />
            );
          })}
          {filters.length === 0 && (
            <span
              className="italic"
              style={{ fontSize: 14, color: "var(--color-whisper)" }}
            >
              anything — every page
            </span>
          )}
          {editable && (
            <AddFilterButton
              propDefs={propDefs}
              pages={pages}
              people={people}
              staleDays={staleDays}
              onPick={pickFilter}
            />
          )}
        </>
      )}

      <span
        aria-hidden
        className="inline-block bg-line"
        style={{ width: 1, height: 16 }}
      />

      <SortControl sort={sort} onChange={onChangeSort} />

      {layout === "board" && (
        <GroupControl
          groupBy={groupBy}
          defs={groupableDefs}
          onChange={onChangeGroupBy}
        />
      )}

      <div style={{ flex: 1, minWidth: 8 }} />

      {pill}

      <SpecMenuTrigger
        size="toolbar"
        ariaLabel="View options"
        build={menuSpec}
      />
    </div>
  );
}

/* ─────────────────────────── Filter chip ─────────────────────────── */

function FilterChip({
  label,
  clickable,
  removable,
  onRemove,
  renderPicker,
}: {
  label: string;
  clickable: boolean;
  removable: boolean;
  onRemove: () => void;
  renderPicker?: (close: () => void) => ReactNode;
}) {
  const chipStyle: React.CSSProperties = {
    fontSize: 13,
    color: "var(--color-secondary)",
    padding: "3px 5px 3px 9px",
    background: "var(--color-sunken)",
    border: "1px solid var(--color-line)",
    borderRadius: 7,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };

  const removeBtn = removable ? (
    <button
      type="button"
      aria-label="Remove filter"
      title="Remove filter"
      onClick={onRemove}
      className="hover:bg-selected"
      style={{
        display: "grid",
        placeItems: "center",
        width: 14,
        height: 14,
        borderRadius: 4,
        color: "var(--color-whisper)",
        border: "none",
        background: "transparent",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.color = "var(--color-noir)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.color = "var(--color-whisper)")
      }
    >
      <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden>
        <path
          d="M2 2 L8 8 M8 2 L2 8"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      </svg>
    </button>
  ) : null;

  if (!clickable || !renderPicker) {
    return (
      <span style={chipStyle}>
        <span>{label}</span>
        {removeBtn}
      </span>
    );
  }

  return (
    <Popover
      width={264}
      trigger={({ onClick, ref }) => (
        <span style={chipStyle}>
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              font: "inherit",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
          {removeBtn}
        </span>
      )}
    >
      {(close) => renderPicker(close)}
    </Popover>
  );
}

/* ─────────────────────────── +Filter button ─────────────────────────── */

function AddFilterButton({
  propDefs,
  pages,
  people,
  staleDays,
  onPick,
}: {
  propDefs: PropDef[];
  pages: PageListItem[];
  people: PersonForLabel[];
  staleDays: number;
  onPick: (f: Filter) => void;
}) {
  return (
    <Popover
      width={264}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            color: "var(--color-muted)",
            padding: "3px 9px",
            border: "1px dashed var(--color-lineStrong)",
            borderRadius: 7,
            background: "transparent",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--color-noir)";
            e.currentTarget.style.borderColor = "var(--color-whisper)";
            e.currentTarget.style.background = "var(--color-rail)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--color-muted)";
            e.currentTarget.style.borderColor = "var(--color-lineStrong)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden>
            <path
              d="M5 1v8 M1 5h8"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
          Filter
        </button>
      )}
    >
      {(close) => (
        <FilterBuilderContent
          propDefs={propDefs}
          pages={pages}
          people={people}
          staleDays={staleDays}
          onPick={(f) => {
            onPick(f);
            close();
          }}
        />
      )}
    </Popover>
  );
}

/* ─────────────────────────── Filter builder (two-step, in place) ─────────── */

type BuilderStep = { kind: "root" } | { kind: "prop"; propKey: string };

function FilterBuilderContent({
  propDefs,
  pages,
  people,
  staleDays,
  onPick,
  startAt,
}: {
  propDefs: PropDef[];
  pages: PageListItem[];
  people: PersonForLabel[];
  staleDays: number;
  onPick: (f: Filter) => void;
  startAt?: { prop?: string; op?: Filter["op"] };
}) {
  // Chips reopen at their property's step 2. Freshness ops reopen at the
  // synthetic "__freshness" group.
  const initialStep: BuilderStep = (() => {
    if (!startAt) return { kind: "root" };
    if (startAt.op === "stale" || startAt.op === "edited_within") {
      return { kind: "prop", propKey: "__freshness" };
    }
    if (startAt.prop) return { kind: "prop", propKey: startAt.prop };
    return { kind: "root" };
  })();
  const [step, setStep] = useState<BuilderStep>(initialStep);

  const ROOT_ICON: Record<string, string> = {
    area: "M4 12h14m-5-5 5 5-5 5",
    owner:
      "M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.6v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2",
    status: "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z",
    stage: "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z",
    priority: "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z",
    tags:
      "M20.4 13.6 13.6 20.4a2 2 0 0 1-2.8 0L3.6 13.2V4.4a.8.8 0 0 1 .8-.8h8.8l7.2 7.2a2 2 0 0 1 0 2.8zM7.6 7.6h.01",
    __freshness: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3.2 1.9",
  };
  const rootItems: Array<{ key: string; label: string }> = [];
  for (const k of ["area", "owner", "status", "stage", "priority", "tags"]) {
    const def = propDefs.find((d) => d.key === k);
    if (!def) continue;
    rootItems.push({ key: k, label: k === "tags" ? "Tag" : def.label });
  }
  rootItems.push({ key: "__freshness", label: "Freshness" });

  if (step.kind === "root") {
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle>Filter by</StepTitle>
        {rootItems.map((it) => (
          <BuilderRow
            key={it.key}
            leading={
              <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden style={{ flex: "none", color: "var(--color-muted)" }}>
                <path d={ROOT_ICON[it.key] ?? ""} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            onClick={() => setStep({ kind: "prop", propKey: it.key })}
            trailing={<span className="font-mono" style={{ color: "var(--color-whisper)", fontSize: 11.5 }}>›</span>}
          >
            {it.label}
          </BuilderRow>
        ))}
        <div
          style={{
            borderTop: "1px solid var(--color-lineSoft)",
            margin: "4px 4px 0",
            padding: "8px 7px 4px",
            fontSize: 12.5,
            lineHeight: 1.45,
            color: "var(--color-whisper)",
          }}
        >
          Filters combine with and. Two filters on one property replace each other.
        </div>
      </div>
    );
  }

  const key = step.propKey;
  const back = () => setStep({ kind: "root" });

  if (key === "__freshness") {
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>Freshness</StepTitle>
        <BuilderRow onClick={() => onPick({ op: "stale", prop: "verified" })}>
          Not verified in {staleDays}+ days
        </BuilderRow>
        <BuilderRow
          onClick={() =>
            onPick({ op: "edited_within", prop: "edited", value: 14 })
          }
        >
          Edited in the last 14 days
        </BuilderRow>
      </div>
    );
  }

  const def = propDefs.find((d) => d.key === key);
  if (!def) {
    return (
      <div style={{ padding: 10, fontSize: 13, color: "var(--color-muted)" }}>
        Property no longer exists.
      </div>
    );
  }

  if (key === "area") {
    const areas = new Set<string>();
    for (const p of pages) {
      const a = propsOf(p)["area"];
      if (typeof a === "string" && a) areas.add(a);
    }
    const list = [...areas].sort();
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        {list.length === 0 && <EmptyValues />}
        {list.map((a) => (
          <BuilderRow
            key={a}
            onClick={() => onPick({ op: "eq", prop: "area", value: a })}
          >
            {a}
          </BuilderRow>
        ))}
      </div>
    );
  }

  if (key === "owner") {
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        <BuilderRow onClick={() => onPick({ op: "is_me", prop: "owner" })}>
          Me
        </BuilderRow>
        {people.map((p) => (
          <BuilderRow
            key={p.id}
            onClick={() => onPick({ op: "eq", prop: "owner", value: p.id })}
          >
            {p.full_name ?? "Someone"}
          </BuilderRow>
        ))}
      </div>
    );
  }

  if (def.type === "select" || def.type === "status") {
    const opts =
      (def.options as unknown as Array<{
        value: string;
        label: string;
        tint: string;
        ink: string;
      }>) ?? [];
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        {key === "stage" && (
          <BuilderRow
            onClick={() => onPick({ op: "not_empty", prop: "stage" })}
          >
            Has any stage
          </BuilderRow>
        )}
        {opts.map((o) => (
          <BuilderRow
            key={o.value}
            leading={
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: `var(--color-${o.ink})`,
                  flex: "none",
                }}
              />
            }
            onClick={() => onPick({ op: "eq", prop: def.key, value: o.value })}
          >
            {o.label}
          </BuilderRow>
        ))}
      </div>
    );
  }

  if (key === "tags") {
    const tagSet = new Set<string>();
    for (const p of pages) {
      const t = propsOf(p)["tags"];
      if (Array.isArray(t)) t.forEach((x) => tagSet.add(String(x)));
    }
    const tags = [...tagSet].sort();
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>Tag</StepTitle>
        {tags.length === 0 && <EmptyValues />}
        {tags.map((t) => (
          <BuilderRow
            key={t}
            onClick={() => onPick({ op: "includes", prop: "tags", value: t })}
          >
            {t}
          </BuilderRow>
        ))}
      </div>
    );
  }

  return <EmptyValues />;
}

function EmptyValues() {
  return (
    <div style={{ padding: 10, fontSize: 13, color: "var(--color-muted)" }}>
      No values yet.
    </div>
  );
}

function StepTitle({
  children,
  onBack,
}: {
  children: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1"
      style={{
        padding: "7px 10px 3px",
        fontFamily: "var(--font-display)",
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color: "var(--color-faint)",
      }}
    >
      {onBack && (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="grid place-items-center rounded-sm hover:bg-rail"
          style={{ width: 16, height: 16, marginRight: 2 }}
        >
          <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden>
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <span className="truncate">{children}</span>
    </div>
  );
}

function BuilderRow({
  children,
  leading,
  trailing,
  onClick,
}: {
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center rounded-lg text-left hover:bg-rail"
      style={{ padding: "7px 10px", gap: 9, color: "var(--color-body)" }}
    >
      {leading}
      <span
        className="truncate"
        style={{ flex: 1, minWidth: 0, fontSize: 14 }}
      >
        {children}
      </span>
      {trailing}
    </button>
  );
}

/* ─────────────────────────── Sort + Group controls ─────────────────────────── */

type SortChoice = { key: string; label: string; spec: SortSpec };

const SORT_CHOICES: SortChoice[] = [
  { key: "edited:desc", label: "Newest edits", spec: { prop: "edited", dir: "desc" } },
  { key: "edited:asc", label: "Oldest edits", spec: { prop: "edited", dir: "asc" } },
  { key: "verified:asc", label: "Oldest verification", spec: { prop: "verified", dir: "asc" } },
  { key: "title:asc", label: "Title A–Z", spec: { prop: "title", dir: "asc" } },
];

function SortControl({
  sort,
  onChange,
}: {
  sort: SortSpec;
  onChange: (s: SortSpec) => void;
}) {
  const currentKey = `${sort.prop}:${sort.dir}`;
  const current =
    SORT_CHOICES.find((c) => c.key === currentKey) ?? SORT_CHOICES[0];
  return (
    <Popover
      width={220}
      trigger={({ onClick, ref }) => (
        <ToolbarBorderlessButton
          innerRef={ref}
          onClick={onClick}
          iconPath="M7 4v12m0 0l-3-3m3 3l3-3M17 20V8m0 0l-3 3m3-3l3 3"
          label={current.label}
        />
      )}
    >
      {(close) => (
        <div style={{ padding: "2px 0" }}>
          <StepTitle>Sort by</StepTitle>
          {SORT_CHOICES.map((c) => (
            <BuilderRow
              key={c.key}
              onClick={() => {
                onChange(c.spec);
                close();
              }}
              trailing={c.key === current.key ? <CheckIcon /> : null}
            >
              {c.label}
            </BuilderRow>
          ))}
        </div>
      )}
    </Popover>
  );
}

function GroupControl({
  groupBy,
  defs,
  onChange,
}: {
  groupBy: string;
  defs: PropDef[];
  onChange: (key: string) => void;
}) {
  const current = defs.find((d) => d.key === groupBy) ?? defs[0] ?? null;
  return (
    <Popover
      width={220}
      trigger={({ onClick, ref }) => (
        <ToolbarBorderlessButton
          innerRef={ref}
          onClick={onClick}
          iconPath="M6 4v16 M12 4v16 M18 4v16"
          label={current ? current.label : "Status"}
        />
      )}
    >
      {(close) => (
        <div style={{ padding: "2px 0" }}>
          <StepTitle>Group by</StepTitle>
          {defs.length === 0 && (
            <div
              style={{ padding: 10, fontSize: 13, color: "var(--color-muted)" }}
            >
              Add a select property to group.
            </div>
          )}
          {defs.map((d) => (
            <BuilderRow
              key={d.key}
              onClick={() => {
                onChange(d.key);
                close();
              }}
              trailing={d.key === (current?.key ?? "") ? <CheckIcon /> : null}
            >
              {d.label}
            </BuilderRow>
          ))}
        </div>
      )}
    </Popover>
  );
}

function ToolbarBorderlessButton({
  innerRef,
  onClick,
  iconPath,
  label,
}: {
  innerRef: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  iconPath: string;
  label: string;
}) {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      className="hover:bg-rail"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 13,
        color: "var(--color-secondary)",
        padding: "3px 8px",
        borderRadius: 7,
        border: "none",
        background: "transparent",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.color = "var(--color-noir)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.color = "var(--color-secondary)")
      }
    >
      <svg
        viewBox="0 0 24 24"
        width={11}
        height={11}
        aria-hidden
        style={{ color: "var(--color-whisper)" }}
      >
        <path
          d={iconPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{label}</span>
    </button>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

  // Per-view drafts live in a module-level store so the sidebar row menu
  // and this component agree on the effective layout/sort/filter.
  const drafts = useDrafts();
  const [renaming, setRenaming] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const base: ViewBase | null = useMemo(() => {
    if (selection.kind === "area") return areaBaseView(selection.area);
    if (view)
      return {
        id: view.id,
        name: view.name,
        scope: view.scope === "team" ? "team" : "personal",
        layout: (view.layout as ViewBase["layout"]) ?? "table",
        filter: (view.filter ?? []) as Filter[],
        sort: (view.sort as SortSpec | null) ?? { prop: "edited", dir: "desc" },
        group_by: view.group_by ?? null,
      };
    return null;
  }, [selection, view]);

  const current = useMemo(
    () =>
      base
        ? currentView(base, drafts)
        : null,
    [base, drafts],
  );

  const filters: Filter[] = current?.filter ?? [];
  const sort: SortSpec = current?.sort ?? { prop: "edited", dir: "desc" };
  const layout: Layout = (current?.layout as Layout) ?? "table";
  const groupBy: string = current?.group_by ?? "status";
  const fixedFilterIndex = selection.kind === "area" ? 0 : undefined;

  const patchDraft = (id: string, patch: ViewDraft) => {
    if (base && id === base.id) {
      storePatchDraft(id, patch, {
        filter: base.filter,
        sort: base.sort,
        layout: base.layout,
        group_by: base.group_by,
      });
    } else {
      storePatchDraft(id, patch);
    }
  };
  const clearDraft = (id: string) => storeClearDraft(id);


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

  const people = useMemo(
    () =>
      members.map((m) => ({
        id: m.user_id,
        full_name: m.profiles?.full_name ?? null,
      })),
    [members],
  );

  const unfilteredCount = useMemo(
    () => pages.filter((p) => !p.archived_at).length,
    [pages],
  );

  const staleThreshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  // Personal-owned views persist directly; everything else (team + area)
  // writes to the per-view draft.
  const persistOrDraft = (patch: ViewDraft) => {
    if (!base) return;
    if (isOwnerOfView && view) {
      clearDraft(base.id);
      const dbPatch: Parameters<typeof updateView.mutate>[0]["patch"] = {};
      if ("filter" in patch) dbPatch.filter = patch.filter ?? [];
      if ("sort" in patch) dbPatch.sort = patch.sort ?? { prop: "edited", dir: "desc" };
      if ("layout" in patch) dbPatch.layout = patch.layout as ViewBase["layout"];
      if ("group_by" in patch) dbPatch.group_by = patch.group_by ?? null;
      updateView.mutate({ id: view.id, patch: dbPatch });
    } else {
      patchDraft(base.id, patch);
    }
  };

  const onChangeFilters = (next: Filter[]) => persistOrDraft({ filter: next });
  const onChangeSort = (s: SortSpec) => persistOrDraft({ sort: s });
  const onChangeLayout = (l: Layout) => persistOrDraft({ layout: l });
  const onChangeGroupBy = (g: string) => persistOrDraft({ group_by: g });

  const statusDef = propDefs.find((d) => d.key === "status");

  const groupableDefs = propDefs.filter(
    (d) => d.type === "select" || d.type === "status",
  );

  const onNewPage = () => {
    const seed: Record<string, unknown> = {};
    for (const f of (base?.filter ?? [])) {
      if (f.op === "eq" && f.prop && f.value !== undefined) seed[f.prop] = f.value;
      if (f.op === "is_me" && f.prop && user?.id) seed[f.prop] = user.id;
    }
    if (selection.kind === "area") seed.area = selection.area;
    void createAndOpen({ seedProps: seed });
  };

  // Team and area toolbars are editable (edits flow to the draft).
  // Personal-owned views are also editable (edits persist directly).
  const editable = !!base;

  const isModified =
    !!current && current._modified && current.scope !== "personal";

  const toast = useToast();

  const doSaveAsMyView = () => {
    if (!base || !isModified) return;
    const baseName = base.name;
    const isAreaBase = base.scope === "area";
    createView.mutate(
      {
        name: `${baseName} (mine)`,
        icon: null,
        filter: filters,
        sort,
        layout,
        groupBy: layout === "board" ? groupBy : null,
      },
      {
        onSuccess: (row) => {
          clearDraft(base.id);
          navigate({ to: "/v/$viewId", params: { viewId: row.id } });
          toast.push(
            isAreaBase
              ? `Saved to My views — "${baseName}" is unchanged for everyone.`
              : `Saved to My views — "${baseName}" is unchanged for the team.`,
          );
        },
      },
    );
  };
  const doDiscard = () => {
    if (base) clearDraft(base.id);
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


  /* --- shortcut & spec support ---------------------------------------- */

  const sortLabel = useMemo(() => {
    const key = `${sort.prop}:${sort.dir}`;
    return (
      SORT_CHOICES.find((c) => c.key === key)?.label ?? SORT_CHOICES[0].label
    );
  }, [sort]);

  const publisherName = useMemo(() => {
    if (!view || view.scope !== "team" || !view.owner_id) return "";
    const m = members.find((mm) => mm.user_id === view.owner_id);
    return m?.profiles?.full_name || m?.profiles?.email || "";
  }, [view, members]);

  const copyLinkHere = () => {
    const origin =
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "";
    const url =
      selection.kind === "area"
        ? `${origin}/a/${encodeURIComponent(selection.area)}`
        : view
          ? `${origin}/v/${view.id}`
          : origin;
    void navigator.clipboard?.writeText?.(url);
    const name =
      selection.kind === "area"
        ? selection.area
        : view?.name ?? "this view";
    toast.push(`Copied link to "${name}"`);
  };

  const scope: "team" | "area" | "personal" =
    selection.kind === "area"
      ? "area"
      : isTeamView
        ? "team"
        : "personal";

  // Wire the mono keyboard hints the toolbar promises. Guard against
  // focus in typable elements so shortcuts never eat a keystroke.
  useEffect(() => {
    const isTypable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return true;
      return el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypable(document.activeElement)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      // ⌘⌥L / Ctrl+Alt+L — copy link (view or area).
      if (k === "l" && e.altKey && (view || selection.kind === "area")) {
        e.preventDefault();
        copyLinkHere();
        return;
      }
      // ⌘D — duplicate the current view (personal → dup; team → fork).
      if (k === "d" && !e.altKey && !e.shiftKey && view) {
        e.preventDefault();
        if (isOwnerOfView) doDuplicatePersonal();
        else if (isTeamView) doDuplicateTeam();
        return;
      }
      // ⌘⇧R — start inline rename on a personal-owned view.
      if (k === "r" && e.shiftKey && !e.altKey && view && isOwnerOfView) {
        e.preventDefault();
        setRenaming(true);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selection, isOwnerOfView, isTeamView]);

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
        groupBy={groupBy}
        layout={layout}
        onChangeFilters={onChangeFilters}
        onChangeSort={onChangeSort}
        onChangeGroupBy={onChangeGroupBy}
        propDefs={propDefs}
        people={people}
        staleDays={staleDays}
        editable={editable}
        fixedFilterIndex={fixedFilterIndex}
        pages={pages}
        verbose={prefs.explainQuery}
        pill={
          isModified && base ? (
            <ModifiedPill
              onSave={doSaveAsMyView}
              onDiscard={doDiscard}
            />
          ) : null
        }
        menuSpec={(mctx) =>
          buildViewToolbarSpec(
            {
              scope,
              isModified,
              isWorkspaceOwner,
              isOwnerOfView,
              name:
                selection.kind === "area"
                  ? selection.area
                  : view?.name ?? "",
              workspaceName: workspace?.name ?? "the workspace",
              memberCount,
              publisherName,
              layout,
              rowCount: rows.length,
              unfilteredCount,
              sortLabel,
              onSaveAsMyView: doSaveAsMyView,
              onDiscard: doDiscard,
              onDuplicateTeam: doDuplicateTeam,
              onAreaSaveAsView: doAreaSaveAsView,
              onChangeLayout,
              onCopyLink: copyLinkHere,
              onRename: () => setRenaming(true),
              onPublish: doPublish,
              onUnpublish: doUnpublish,
              onDelete: doDelete,
              onExportView: () => setExportOpen(true),
            },
            mctx,
          )
        }
      />

      {isModified && base && (
        <ModifiedBand baseName={base.name} />
      )}

      {rows.length < unfilteredCount && (
        <div
          style={{
            marginTop: 6,
            marginBottom: 4,
            fontSize: 12.5,
            color: "var(--color-whisper)",
          }}
        >
          {rows.length} of {unfilteredCount} pages
        </div>
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

/* ─────────────────────────── Modified pill + band ─────────────────────────── */

function ModifiedPill({
  onSave,
  onDiscard,
}: {
  onSave: () => void;
  onDiscard: () => void;
}) {
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
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "var(--color-amberDot)",
        }}
      />
      <span
        className="font-display uppercase"
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: "0.05em",
          color: "var(--color-amberInk)",
        }}
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
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          color: "var(--color-amberInk)",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </span>
  );
}

function ModifiedBand({ baseName }: { baseName: string }) {
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
        You&apos;re looking at unsaved changes. <b>{baseName}</b> is untouched for
        everyone else — saving makes a copy in <b>My views</b>.
      </span>
    </div>
  );
}


/* ─────────────────────────── View toolbar ⋯ spec ─────────────────────────── */

/**
 * The view/area toolbar's ⋯ menu. Contents depend on state — this is
 * where the product's central guarantee (team & area views are read-only;
 * changes fork to My views) becomes visible.
 *
 * Pure builder — no React state. Submenus & confirms swap in place.
 * ⌘⌥L / ⌘⇧R hints are honoured by keyboard shortcuts wired in MainView;
 * ⌘D is not offered here because a view row is duplicated via the row
 * menu (chunk 2b), not the toolbar.
 */
function buildViewToolbarSpec(
  args: {
    scope: "team" | "area" | "personal";
    isModified: boolean;
    isWorkspaceOwner: boolean;
    isOwnerOfView: boolean;
    name: string;
    workspaceName: string;
    memberCount: number;
    publisherName: string;
    layout: Layout;
    rowCount: number;
    unfilteredCount: number;
    sortLabel: string;
    onSaveAsMyView: () => void;
    onDiscard: () => void;
    onDuplicateTeam: () => void;
    onAreaSaveAsView: () => void;
    onChangeLayout: (l: Layout) => void;
    onCopyLink: () => void;
    onRename: () => void;
    onPublish: () => void;
    onUnpublish: () => void;
    onDelete: () => void;
    onExportView: () => void;
  },
  mctx: { setSpec: (s: MenuSpec) => void; close: () => void },
): MenuSpec {
  const {
    scope,
    isModified,
    isWorkspaceOwner,
    isOwnerOfView,
    name,
    workspaceName,
    memberCount,
    publisherName,
    layout,
    rowCount,
    unfilteredCount,
    sortLabel,
  } = args;

  const title =
    scope === "area" ? "Area" : scope === "team" ? "Team view" : "My view";

  const footer =
    scope === "team"
      ? `Published by ${publisherName || "someone"} · read-only here. Save a copy to change it.`
      : scope === "area"
        ? "An area view is a query on one property. Saving makes it yours."
        : personalViewFooter({
            matchCount: rowCount,
            totalCount: unfilteredCount,
            sortLabel,
          });

  const layoutSubmenu = (): MenuSpec => ({
    title: "Change layout",
    rows: (["table", "board", "list"] as const).map((l) => ({
      kind: "row" as const,
      label: l === "table" ? "Table" : l === "board" ? "Board" : "List",
      icon: l === "table" ? "layout" : l === "board" ? "board" : "list",
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
      hint: { text: "personal" },
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
  } else if (scope === "team") {
    rows.push({
      kind: "row",
      label: "Duplicate into My views",
      icon: "dup",
      hint: { text: "personal" },
      onPick: () => {
        args.onDuplicateTeam();
        mctx.close();
      },
    });
  } else if (scope === "area") {
    rows.push({
      kind: "row",
      label: "Save this area as my view",
      icon: "bookmark",
      hint: { text: "personal" },
      onPick: () => {
        args.onAreaSaveAsView();
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

  if (scope === "personal" && isOwnerOfView) {
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
    if (isWorkspaceOwner) {
      rows.push({
        kind: "row",
        label: "Publish to team",
        icon: "people",
        hint: { text: "everyone sees it" },
        onPick: () =>
          mctx.setSpec({
            title,
            rows: [],
            confirm: {
              title: `Publish "${name}"?`,
              body: `It moves out of My views into Team views for all ${memberCount} people at ${workspaceName}. Publishing is the only way a view becomes shared.`,
              cta: "Publish",
              onConfirm: args.onPublish,
            },
          }),
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
            body: "The view disappears — the pages it filtered are untouched.",
            cta: "Delete view",
            danger: true,
            onConfirm: args.onDelete,
          },
        }),
    });
  } else if (scope === "team" && isWorkspaceOwner) {
    rows.push({ kind: "sep" });
    rows.push({
      kind: "row",
      label: "Unpublish to personal",
      icon: "eyeOff",
      hint: { text: "personal" },
      onPick: () => {
        args.onUnpublish();
        mctx.close();
      },
    });
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
            body: "The view disappears — the pages it filtered are untouched.",
            cta: "Delete view",
            danger: true,
            onConfirm: args.onDelete,
          },
        }),
    });
  }

  return { title, rows, footer: footer || undefined };
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
