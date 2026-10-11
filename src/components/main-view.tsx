import { actionableDefs, valueLabel } from "@/lib/prop-actions";
import { PROPERTY_KINDS } from "@/lib/property-kinds";
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setViewDateMode, viewTime } from "@/lib/view-time";
import { useNavigate } from "@tanstack/react-router";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useAllPropDefs } from "@/hooks/use-workspace-data";
import { sortsOf, type Filter, type FilterOp, type SortSpec } from "@/lib/run-view";
import { sortLabel as sortLabelOf } from "@/lib/sort-label";
import { RowCheckbox } from "./view-table";
import { relationConfig, rollupKind } from "@/lib/relations";
import { relList } from "@/lib/related-links";
import { applyFilterReplacement, filterLabel } from "@/lib/filter-label";
import { useSetPageOrigin } from "@/lib/page-origin";
import { Ico } from "./emoji-icon";
import { Popover } from "./popover";
import { SpecMenuTrigger, type MenuSpec } from "./row-menu";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";

type Layout = "table" | "board" | "list" | "calendar";


type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];
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

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

export function setDateModeForMainView(m: "relative" | "absolute") {
  setViewDateMode(m);
}
function relTime(iso: string): string {
  return viewTime(iso);
}


export function LayoutGlyph({ layout }: { layout: string }) {
  const path =
    layout === "board"
      ? "M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v16h-4z"
      : layout === "list"
        ? "M4 6h16M4 12h16M4 18h16"
        : layout === "calendar"
          ? "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"
          : "M4 5h16v14H4zM4 10h16M9 5v14";
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Glyph({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-4 w-4"} aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* describeFilter — REMOVED. Every filter chip text now flows through
 * filterLabel() in @/lib/filter-label. See B1 spec §1. */


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

export function QueryToolbar({
  filters,
  sort,
  groupBy,
  layout,
  onChangeFilters,
  onChangeSort,
  onChangeGroupBy,
  tableGroup,
  tableGroupChoices,
  onChangeTableGroup,
  propDefs,
  people,
  staleDays,
  editable,
  fixedFilterIndex,
  pages,
  verbose,
  pill,
  menuSpec,
  filterAsk,
}: {
  filters: Filter[];
  sort: SortSpec | SortSpec[];
  groupBy: string;
  layout: Layout;
  onChangeFilters: (next: Filter[]) => void;
  onChangeSort: (s: SortSpec | SortSpec[]) => void;
  onChangeGroupBy: (g: string) => void;
  tableGroup: string | null;
  tableGroupChoices: Array<{ key: string; label: string }>;
  onChangeTableGroup: (g: string | null) => void;
  propDefs: PropDef[];
  people: PersonForLabel[];
  staleDays: number;
  editable: boolean;
  fixedFilterIndex?: number;
  pages: PageListItem[];
  verbose: boolean;
  pill?: ReactNode;
  menuSpec: (ctx: { setSpec: (s: MenuSpec) => void; close: () => void }) => MenuSpec;
  /** A column's "Filter": opens +Filter at that property (n changes each ask). */
  filterAsk?: { prop: string; n: number } | null;
}) {
  const pickFilter = (picked: Filter) =>
    onChangeFilters(applyFilterReplacement(filters, picked));
  const groupableDefs = propDefs.filter(
    (d) => d.type === "select" || d.type === "status",
  );
  const dateDefs = propDefs.filter((d) => d.type === "date");
  // Chips name archived properties too (a saved filter can still use one).
  const allDefs = useAllPropDefs(useWorkspaceId()).data as PropDef[] | undefined;
  const labelDefs = allDefs && allDefs.length ? allDefs : propDefs;
  const pageTitle = (id: string) => {
    const p = pages.find((x) => x.id === id);
    return p ? p.title || "Untitled" : "a private page";
  };

  return (
    <div
      className="flex flex-wrap items-center"
      style={{ marginTop: 14, marginBottom: 10, gap: 7, minHeight: 22 }}
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
                label={filterLabel(f, { people, staleDays, defs: labelDefs, pageTitle })}
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
                          startAt={{ prop: f.prop, op: f.op, value: f.value }}
                          onPick={(picked) => {
                            // Editing a chip changes that filter in place.
                            onChangeFilters(
                              applyFilterReplacement(
                                filters.filter((_, idx) => idx !== i),
                                picked,
                              ),
                            );
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
              ask={filterAsk ?? null}
            />
          )}
        </>
      )}

      <span
        aria-hidden
        className="inline-block bg-line"
        style={{ width: 1, height: 16 }}
      />

      <SortControl sort={sort} defs={propDefs} nameDefs={labelDefs} onChange={onChangeSort} />

      {layout === "table" && editable && (
        <TableGroupControl
          value={tableGroup}
          choices={tableGroupChoices}
          onChange={onChangeTableGroup}
        />
      )}
      {layout === "board" && (
        <GroupControl
          groupBy={groupBy}
          defs={groupableDefs}
          onChange={onChangeGroupBy}
        />
      )}
      {layout === "calendar" && (
        <GroupControl
          groupBy={groupBy}
          defs={dateDefs}
          onChange={onChangeGroupBy}
          title="Show by"
          iconPath="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"
          emptyText="Add a date property to place pages on the calendar."
          fallbackLabel="No date property"
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
  ask,
}: {
  propDefs: PropDef[];
  pages: PageListItem[];
  people: PersonForLabel[];
  staleDays: number;
  onPick: (f: Filter) => void;
  ask: { prop: string; n: number } | null;
}) {
  // A column's "Filter" opens this at its property: remember where to
  // start, then press the button.
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [startProp, setStartProp] = useState<string | null>(null);
  const askN = ask?.n;
  useEffect(() => {
    if (!ask) return;
    setStartProp(ask.prop);
    const id = window.requestAnimationFrame(() => btnRef.current?.click());
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askN]);
  return (
    <Popover
      width={264}
      onOpenChange={(o) => {
        if (!o) setStartProp(null);
      }}
      trigger={({ onClick, ref }) => (
        <button
          ref={(el) => {
            btnRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = el;
          }}
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
          key={startProp ?? "root"}
          propDefs={propDefs}
          pages={pages}
          people={people}
          staleDays={staleDays}
          startAt={startProp ? { prop: startProp } : undefined}
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
  startAt?: { prop?: string; op?: Filter["op"]; value?: Filter["value"] };
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

  // Icons by TYPE: every database names its properties its own way.
  const TYPE_ICON: Record<string, string> = Object.fromEntries(
    PROPERTY_KINDS.map((k) => [k.type, k.icon]),
  );
  const ROOT_ICON: Record<string, string> = {
    __freshness: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3.2 1.9",
  };
  const rootItems: Array<{ key: string; label: string }> = [];
  // The database's live properties, in its own order.
  for (const def of [...propDefs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    if (def.archived_at) continue;
    rootItems.push({ key: def.key, label: def.label });
    ROOT_ICON[def.key] = TYPE_ICON[def.type] ?? "";
  }
  rootItems.push({ key: "@created", label: "Created" });
  rootItems.push({ key: "@created_by", label: "Created by" });
  rootItems.push({ key: "@edited_by", label: "Last edited by" });
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
          Filters combine with and. A new pick for a property replaces the old one; ranges
          (above and below, before and after) and tags add up.
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

  const initialValue = startAt && startAt.prop === key ? startAt.value : undefined;

  if (key === "@created") {
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>Created</StepTitle>
        <DateFilterRows
          prop={key}
          ranges={["today", "this_week", "past_7", "past_30", "this_month"]}
          initial={initialValue}
          onPick={onPick}
        />
      </div>
    );
  }
  if (key === "@created_by" || key === "@edited_by") {
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{key === "@created_by" ? "Created by" : "Last edited by"}</StepTitle>
        <BuilderRow onClick={() => onPick({ op: "is_me", prop: key })}>Me</BuilderRow>
        {people.map((p) => (
          <BuilderRow key={p.id} onClick={() => onPick({ op: "eq", prop: key, value: p.id })}>
            {p.full_name ?? "Someone"}
          </BuilderRow>
        ))}
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

  if (def.type === "select" || def.type === "status") {
    const opts =
      (def.options as unknown as Array<{
        value: string;
        label: string;
        tint: string;
        ink: string;
      }>) ?? [];
    // An open property also holds values typed in that aren't options yet.
    const known = new Set(opts.map((o) => o.value));
    const typed = new Set<string>();
    for (const p of pages) {
      const v = propsOf(p)[def.key];
      if (typeof v === "string" && v && !known.has(v)) typed.add(v);
    }
    const allOpts = [
      ...opts,
      ...[...typed].sort().map((v) => ({ value: v, label: v, tint: "sunken", ink: "muted" })),
    ];
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        <BuilderRow onClick={() => onPick({ op: "not_empty", prop: def.key })}>
          Has any {def.label.toLowerCase()}
        </BuilderRow>
        {allOpts.map((o) => (
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
        <BuilderRow onClick={() => onPick({ op: "empty", prop: def.key })}>
          No {def.label.toLowerCase()}
        </BuilderRow>
      </div>
    );
  }

  /* Every other property the team made. */
  if (def.type === "person") {
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        <BuilderRow onClick={() => onPick({ op: "is_me", prop: def.key })}>Me</BuilderRow>
        <BuilderRow onClick={() => onPick({ op: "not_empty", prop: def.key })}>
          Anyone
        </BuilderRow>
        <BuilderRow onClick={() => onPick({ op: "empty", prop: def.key })}>No one</BuilderRow>
        {people.map((p) => (
          <BuilderRow
            key={p.id}
            onClick={() => onPick({ op: "eq", prop: def.key, value: p.id })}
          >
            {p.full_name ?? "Someone"}
          </BuilderRow>
        ))}
      </div>
    );
  }

  if (def.type === "multi_select") {
    const vals = new Set<string>();
    for (const p of pages) {
      const t = propsOf(p)[def.key];
      if (Array.isArray(t)) t.forEach((x) => vals.add(String(x)));
    }
    const list = [...vals].sort();
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        {list.length === 0 && <EmptyValues />}
        {list.map((t) => (
          <BuilderRow
            key={t}
            onClick={() => onPick({ op: "includes", prop: def.key, value: t })}
          >
            {t}
          </BuilderRow>
        ))}
      </div>
    );
  }

  if (def.type === "checkbox") {
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        <BuilderRow onClick={() => onPick({ op: "eq", prop: def.key, value: "true" })}>
          Checked
        </BuilderRow>
        <BuilderRow onClick={() => onPick({ op: "unchecked", prop: def.key })}>
          Not checked
        </BuilderRow>
      </div>
    );
  }

  if (def.type === "relation") {
    // The pages it links to anywhere (near side), or the pages that link
    // here (far side): pick one to see the pages related to it.
    const byId = new Map(pages.filter((p) => !p.archived_at).map((p) => [p.id, p]));
    const of = relationConfig(def).of;
    const ids = new Set<string>();
    for (const p of byId.values()) {
      if (of) {
        if (relList(propsOf(p)[of]).length) ids.add(p.id);
      } else {
        relList(propsOf(p)[def.key]).forEach((id) => byId.has(id) && ids.add(id));
      }
    }
    const list = [...ids]
      .map((id) => byId.get(id)!)
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return (
      <div style={{ padding: "2px 0", maxHeight: 360, overflowY: "auto" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        {list.length === 0 && <EmptyValues />}
        {list.map((p) => (
          <BuilderRow
            key={p.id}
            leading={<Ico icon={p.icon || "📄"} size={15} />}
            onClick={() => onPick({ op: "includes", prop: def.key, value: p.id })}
          >
            {p.title || "Untitled"}
          </BuilderRow>
        ))}
        <FilterDivider />
        <BuilderRow onClick={() => onPick({ op: "not_empty", prop: def.key })}>
          Linked to any page
        </BuilderRow>
        <BuilderRow onClick={() => onPick({ op: "empty", prop: def.key })}>Not linked</BuilderRow>
      </div>
    );
  }

  if (def.type === "rollup") {
    const kind = rollupKind(def);
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        {kind === "date" ? (
          <DateFilterRows
            prop={def.key}
            ranges={["today", "this_week", "next_week", "this_month"]}
            initial={initialValue}
            onPick={onPick}
          />
        ) : (
          <CompareInput
            kind={kind === "number" ? "number" : "text"}
            ops={kind === "number" ? NUMBER_OPS : TEXT_OPS}
            initial={initialValue}
            onPick={(op, value) => onPick({ op, prop: def.key, value })}
          />
        )}
        <FilterDivider />
        <BuilderRow onClick={() => onPick({ op: "empty", prop: def.key })}>Empty</BuilderRow>
      </div>
    );
  }

  if (def.type === "date") {
    return (
      <div style={{ padding: "2px 0" }}>
        <StepTitle onBack={back}>{def.label}</StepTitle>
        <DateFilterRows
          prop={def.key}
          ranges={["overdue", "today", "this_week", "next_week", "next_7", "this_month"]}
          initial={initialValue}
          onPick={onPick}
        />
        <FilterDivider />
        <BuilderRow onClick={() => onPick({ op: "not_empty", prop: def.key })}>
          Has a date
        </BuilderRow>
        <BuilderRow onClick={() => onPick({ op: "empty", prop: def.key })}>No date</BuilderRow>
      </div>
    );
  }

  const compare =
    def.type === "number"
      ? { kind: "number" as const, ops: NUMBER_OPS }
      : def.type === "links"
        ? null
        : { kind: "text" as const, ops: TEXT_OPS };

  // Text, number, link, email, phone: compare; related pages: present or not.
  return (
    <div style={{ padding: "2px 0" }}>
      <StepTitle onBack={back}>{def.label}</StepTitle>
      {compare ? (
        <>
          <CompareInput
            kind={compare.kind}
            ops={compare.ops}
            initial={initialValue}
            onPick={(op, value) => onPick({ op, prop: def.key, value })}
          />
          <FilterDivider />
        </>
      ) : null}
      <BuilderRow onClick={() => onPick({ op: "not_empty", prop: def.key })}>
        Has a value
      </BuilderRow>
      <BuilderRow onClick={() => onPick({ op: "empty", prop: def.key })}>Empty</BuilderRow>
    </div>
  );
}

const NUMBER_OPS: Array<{ op: FilterOp; label: string }> = [
  { op: "gt", label: "Above" },
  { op: "gte", label: "At least" },
  { op: "lt", label: "Below" },
  { op: "lte", label: "At most" },
];
const TEXT_OPS: Array<{ op: FilterOp; label: string }> = [
  { op: "contains", label: "Contains" },
  { op: "not_contains", label: "Doesn\u2019t contain" },
];
const DATE_OPS: Array<{ op: FilterOp; label: string }> = [
  { op: "before", label: "Before" },
  { op: "date_is", label: "On" },
  { op: "after", label: "After" },
];
const RANGE_LABELS: Record<string, string> = {
  overdue: "Overdue",
  today: "Today",
  this_week: "This week",
  next_week: "Next week",
  next_7: "In the next 7 days",
  past_7: "In the past 7 days",
  past_30: "In the past 30 days",
  this_month: "This month",
};

function FilterDivider() {
  return (
    <div aria-hidden style={{ height: 1, background: "var(--color-lineSoft)", margin: "4px 3px" }} />
  );
}

/** Quick date ranges, then before / on / after a day. */
function DateFilterRows({
  prop,
  ranges,
  initial,
  onPick,
}: {
  prop: string;
  ranges: string[];
  initial?: Filter["value"];
  onPick: (f: Filter) => void;
}) {
  return (
    <>
      {ranges.map((r) => (
        <BuilderRow key={r} onClick={() => onPick({ op: "date_is", prop, value: r })}>
          {RANGE_LABELS[r] ?? r}
        </BuilderRow>
      ))}
      <FilterDivider />
      <CompareInput
        kind="date"
        ops={DATE_OPS}
        initial={typeof initial === "string" && /^\d{4}-\d{2}-\d{2}$/.test(initial) ? initial : undefined}
        onPick={(op, value) => onPick({ op, prop, value })}
      />
    </>
  );
}

/** A value and the ways to compare against it: "Above 3", "Contains plan",
 *  "Before Oct 20". Enter picks the first. */
function CompareInput({
  kind,
  ops,
  initial,
  onPick,
}: {
  kind: "number" | "text" | "date";
  ops: Array<{ op: FilterOp; label: string }>;
  initial?: Filter["value"];
  onPick: (op: FilterOp, value: string | number) => void;
}) {
  const [v, setV] = useState(initial === undefined || initial === null ? "" : String(initial));
  const value = v.trim();
  const valid =
    kind === "number"
      ? value !== "" && Number.isFinite(Number(value))
      : kind === "date"
        ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        : value !== "";
  const pick = (op: FilterOp) => {
    if (!valid) return;
    onPick(op, kind === "number" ? Number(value) : value);
  };
  return (
    <div style={{ padding: "6px 10px 8px" }}>
      <input
        type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
        inputMode={kind === "number" ? "decimal" : undefined}
        aria-label={kind === "date" ? "A day" : kind === "number" ? "A number" : "Text"}
        placeholder={kind === "number" ? "A number" : kind === "text" ? "Some text" : undefined}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            pick(ops[0].op);
          }
        }}
        className="tnum w-full rounded-md border border-line bg-surface text-row text-body focus:border-accent"
        style={{ padding: "5px 8px" }}
      />
      <div className="mt-2 flex flex-wrap" style={{ gap: 6 }}>
        {ops.map((o) => (
          <button
            key={o.op}
            type="button"
            disabled={!valid}
            onClick={() => pick(o.op)}
            className="rounded-md border border-line bg-surface text-meta text-body hover:bg-rail disabled:cursor-default disabled:text-faint disabled:hover:bg-surface"
            style={{ padding: "3px 9px" }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
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

/* Sort by any property, with an optional second sort that breaks ties.
 * The quick picks below keep the familiar orders one click away. */
const QUICK_SORTS: Array<{ label: string; spec: SortSpec }> = [
  { label: "Newest edits", spec: { prop: "edited", dir: "desc" } },
  { label: "Oldest verification", spec: { prop: "verified", dir: "asc" } },
  { label: "Title A–Z", spec: { prop: "title", dir: "asc" } },
];

/** Every property a view can sort by: built-ins, then properties. */
function sortTargets(defs: PropDef[]): Array<{ prop: string; label: string }> {
  return [
    { prop: "title", label: "Title" },
    { prop: "edited", label: "Edited" },
    { prop: "verified", label: "Verified" },
    { prop: "@created", label: "Created" },
    { prop: "@created_by", label: "Created by" },
    { prop: "@edited_by", label: "Last edited by" },
    ...[...defs]
      .filter((d) => d.type !== "links")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((d) => ({ prop: `p:${d.key}`, label: d.label })),
  ];
}

/** A single sort is stored as one spec, as views always have. */
function storeSorts(list: SortSpec[]): SortSpec | SortSpec[] {
  return list.length === 1 ? list[0] : list;
}

function SortControl({
  sort,
  defs,
  nameDefs,
  onChange,
}: {
  sort: SortSpec | SortSpec[];
  defs: PropDef[];
  /** Archived properties too, so a saved sort on one still reads by name. */
  nameDefs: PropDef[];
  onChange: (s: SortSpec | SortSpec[]) => void;
}) {
  const sorts = sortsOf(sort);
  const [picking, setPicking] = useState<number | null>(null);
  const targets = sortTargets(defs);
  const named = sortTargets(nameDefs);
  const nameOf = (prop: string) =>
    (targets.find((t) => t.prop === prop) ?? named.find((t) => t.prop === prop))?.label ?? prop;
  const set = (next: SortSpec[]) => onChange(storeSorts(next));
  return (
    <Popover
      width={300}
      onOpenChange={(open) => {
        if (!open) setPicking(null);
      }}
      trigger={({ onClick, ref }) => (
        <ToolbarBorderlessButton
          innerRef={ref}
          onClick={onClick}
          iconPath="M7 4v12m0 0l-3-3m3 3l3-3M17 20V8m0 0l-3 3m3-3l3 3"
          label={sortLabelOf(sort, nameDefs)}
        />
      )}
    >
      {(close) =>
        picking !== null ? (
          <div style={{ padding: "2px 0", maxHeight: 360, overflowY: "auto" }}>
            <StepTitle onBack={() => setPicking(null)}>
              {picking === 0 ? "Sort by" : "Then by"}
            </StepTitle>
            {targets
              .filter((t) => !sorts.some((x, i) => i !== picking && x.prop === t.prop))
              .map((t) => (
                <BuilderRow
                  key={t.prop}
                  onClick={() => {
                    const next = sorts.slice();
                    next[picking] = { prop: t.prop, dir: next[picking]?.dir ?? "asc" };
                    set(next);
                    setPicking(null);
                  }}
                  trailing={sorts[picking]?.prop === t.prop ? <CheckIcon /> : null}
                >
                  {t.label}
                </BuilderRow>
              ))}
          </div>
        ) : (
          <div style={{ padding: "2px 0" }}>
            <StepTitle>Sort</StepTitle>
            {sorts.map((x, i) => (
              <div key={i} className="flex items-center" style={{ gap: 6, padding: "3px 8px" }}>
                <span className="text-meta text-faint" style={{ width: 34 }}>
                  {i === 0 ? "By" : "Then"}
                </span>
                <button
                  type="button"
                  onClick={() => setPicking(i)}
                  className="flex min-w-0 flex-1 items-center justify-between rounded-md border border-line bg-surface text-left text-meta text-body hover:bg-rail"
                  style={{ padding: "4px 8px", gap: 6 }}
                >
                  <span className="truncate">{nameOf(x.prop)}</span>
                  <span aria-hidden className="text-faint">
                    ›
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = sorts.slice();
                    next[i] = { ...x, dir: x.dir === "asc" ? "desc" : "asc" };
                    set(next);
                  }}
                  aria-label={x.dir === "asc" ? "Ascending, switch to descending" : "Descending, switch to ascending"}
                  title={x.dir === "asc" ? "Ascending" : "Descending"}
                  className="rounded-md border border-line bg-surface text-meta text-body hover:bg-rail"
                  style={{ padding: "4px 8px", minWidth: 62 }}
                >
                  {x.dir === "asc" ? "↑ Asc" : "↓ Desc"}
                </button>
                {sorts.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Remove this sort"
                    title="Remove this sort"
                    onClick={() => set(sorts.filter((_, j) => j !== i))}
                    className="grid place-items-center rounded-md text-faint hover:bg-rail hover:text-strong"
                    style={{ width: 22, height: 22 }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
            {sorts.length < 2 ? (
              <BuilderRow onClick={() => setPicking(sorts.length)}>
                <span className="text-muted">+ Then by…</span>
              </BuilderRow>
            ) : null}
            <FilterDivider />
            {QUICK_SORTS.map((c) => {
              const on =
                sorts.length === 1 && sorts[0].prop === c.spec.prop && sorts[0].dir === c.spec.dir;
              return (
                <BuilderRow
                  key={c.label}
                  onClick={() => {
                    onChange(c.spec);
                    close();
                  }}
                  trailing={on ? <CheckIcon /> : null}
                >
                  {c.label}
                </BuilderRow>
              );
            })}
          </div>
        )
      }
    </Popover>
  );
}

/** Group a table's rows, or not. */
function TableGroupControl({
  value,
  choices,
  onChange,
}: {
  value: string | null;
  choices: Array<{ key: string; label: string }>;
  onChange: (key: string | null) => void;
}) {
  const current = choices.find((c) => c.key === value) ?? null;
  return (
    <Popover
      width={220}
      trigger={({ onClick, ref }) => (
        <ToolbarBorderlessButton
          innerRef={ref}
          onClick={onClick}
          iconPath="M4 6h16M4 12h10M4 18h13"
          label={current ? `Grouped by ${current.label.toLowerCase()}` : "Group"}
        />
      )}
    >
      {(close) => (
        <div style={{ padding: "2px 0", maxHeight: 360, overflowY: "auto" }}>
          <StepTitle>Group by</StepTitle>
          <BuilderRow
            onClick={() => {
              onChange(null);
              close();
            }}
            trailing={current ? null : <CheckIcon />}
          >
            None
          </BuilderRow>
          {choices.map((c) => (
            <BuilderRow
              key={c.key}
              onClick={() => {
                onChange(c.key);
                close();
              }}
              trailing={c.key === value ? <CheckIcon /> : null}
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
  title = "Group by",
  iconPath = "M6 4v16 M12 4v16 M18 4v16",
  emptyText = "Add a select property to group.",
  fallbackLabel = "Status",
}: {
  groupBy: string;
  defs: PropDef[];
  onChange: (key: string) => void;
  title?: string;
  iconPath?: string;
  emptyText?: string;
  fallbackLabel?: string;
}) {
  const current = defs.find((d) => d.key === groupBy) ?? defs[0] ?? null;
  return (
    <Popover
      width={220}
      trigger={({ onClick, ref }) => (
        <ToolbarBorderlessButton
          innerRef={ref}
          onClick={onClick}
          iconPath={iconPath}
          label={current ? current.label : fallbackLabel}
        />
      )}
    >
      {(close) => (
        <div style={{ padding: "2px 0" }}>
          <StepTitle>{title}</StepTitle>
          {defs.length === 0 && (
            <div
              style={{ padding: 10, fontSize: 13, color: "var(--color-muted)" }}
            >
              {emptyText}
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

/* ─────────────────────────── Table cells ─────────────────────────── */

/* ─────────────────────────── Main view ─────────────────────────── */

/* ─────────────────────────── Board body ─────────────────────────── */

export function BoardBody({
  rows,
  groupBy,
  propDefs,
  members,
  staleThreshold,
  onMove,
  selectedSet,
  anySelection,
  onCheckboxClick,
  getPageMenuBuild,
  onNewCard,
}: {
  rows: PageListItem[];
  groupBy: string;
  propDefs: PropDef[];
  members: MemberRow[];
  staleThreshold: number;
  onMove: (pageId: string, value: string) => void;
  /** + New page at the foot of a column: a page with that column's value. */
  onNewCard?: (value: string) => void;
  selectedSet: Set<string>;
  anySelection: boolean;
  onCheckboxClick: (id: string, shift: boolean) => void;
  getPageMenuBuild: (p: PageListItem) => (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }) => MenuSpec;
}) {
  const navigate = useNavigate();
  const setOrigin = useSetPageOrigin();
  // Drag feedback: the card being dragged fades, the column under it lights
  // up. Dropping a card back in its own column does nothing.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const def = propDefs.find((d) => d.key === groupBy);
  // The face on a card is the database's first person property — whatever
  // it's called there (src/lib/prop-actions.ts).
  const personDef = actionableDefs(propDefs).find((d) => d.type === "person");
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
    <div className="flex gap-[14px] overflow-x-auto pb-2">
      {columns.map((col) => (
        <div
          key={col.value}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overCol !== col.value) setOverCol(col.value);
          }}
          onDragLeave={(e) => {
            // Only when leaving the column itself, not moving between cards.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setOverCol((cur) => (cur === col.value ? null : cur));
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/pageId");
            setOverCol(null);
            setDragId(null);
            if (!id) return;
            if (col.pages.some((x) => x.id === id)) return; // same column
            onMove(id, col.value);
          }}
          className="shrink-0 rounded-xl bg-rail p-[10px] transition-[box-shadow,background-color] duration-150"
          style={{
            width: "var(--container-boardCol)",
            boxShadow:
              overCol === col.value && dragId && !col.pages.some((x) => x.id === dragId)
                ? "inset 0 0 0 2px var(--color-accentRing)"
                : undefined,
            background:
              overCol === col.value && dragId && !col.pages.some((x) => x.id === dragId)
                ? "var(--color-railHover)"
                : undefined,
          }}
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
              const ownerId = personDef ? propsOf(p)[personDef.key] : null;
              const owner =
                typeof ownerId === "string"
                  ? members.find((m) => m.user_id === ownerId)?.profiles
                  : null;
              const isSelected = selectedSet.has(p.id);
              return (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/pageId", p.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(p.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                  }}
                  style={{ opacity: dragId === p.id ? 0.45 : undefined }}
                  onClick={(e) => {
                    // Skip when the click originated inside the checkbox or menu.
                    const t = e.target as HTMLElement;
                    if (
                      t.closest("[data-row-checkbox]") ||
                      t.closest("[data-row-more]") ||
                      t.closest('[aria-label="Page actions"]')
                    ) return;
                    if (anySelection) {
                      onCheckboxClick(p.id, e.shiftKey);
                      return;
                    }
                    setOrigin(p.id);
                    navigate({ to: "/p/$pageId", params: { pageId: p.id } });
                  }}
                  className={
                    "group rounded-[9px] bg-surface p-[10px] text-left shadow-card transition hover:shadow-cardHover cursor-pointer " +
                    (isSelected
                      ? "border-[1.5px] border-blue"
                      : "border border-line")
                  }
                >
                  <div className="flex items-center gap-2">
                    {(anySelection || isSelected) ? (
                      <span className="mt-[2px]" data-row-checkbox>
                        <RowCheckbox
                          checked={isSelected}
                          alwaysVisible
                          onClick={(shift) => onCheckboxClick(p.id, shift)}
                        />
                      </span>
                    ) : (
                      <Ico icon={p.icon ?? "📄"} size={18} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-row font-bold text-noir">
                      {p.title || "Untitled"}
                    </span>
                    <span
                      data-row-more
                      className="opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                    >
                      <SpecMenuTrigger
                        build={getPageMenuBuild(p)}
                        size="sm"
                        ariaLabel="Page actions"
                      />
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
                </div>
              );
            })}
          </div>
          {onNewCard ? (
            <button
              type="button"
              onClick={() => onNewCard(col.value)}
              className="mt-2 flex w-full items-center rounded-md text-left text-meta text-faint hover:bg-railHover hover:text-strong"
              style={{ gap: 7, padding: "6px 6px" }}
            >
              <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden>
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </svg>
              New page
            </button>
          ) : null}
        </div>
      ))}
      {columns.length === 0 && (
        <div className="text-meta text-muted">Pick a property with options to group by.</div>
      )}
    </div>
  );
}

/* ─────────────────────────── List body ─────────────────────────── */

export function ListBody({
  rows,
  members,
  propDefs,
  staleThreshold,
  selectedSet,
  anySelection,
  onCheckboxClick,
  getPageMenuBuild,
}: {
  rows: PageListItem[];
  members: MemberRow[];
  propDefs: PropDef[];
  staleThreshold: number;
  selectedSet: Set<string>;
  anySelection: boolean;
  onCheckboxClick: (id: string, shift: boolean) => void;
  getPageMenuBuild: (p: PageListItem) => (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }) => MenuSpec;
}) {
  const navigate = useNavigate();
  const setOrigin = useSetPageOrigin();

  // A row's line reads its database's first status-or-select property and
  // first person property, by type, never by name.
  const acts = actionableDefs(propDefs);
  const stateDef = acts.find((d) => d.type === "status") ?? acts.find((d) => d.type === "select");
  const personDef = acts.find((d) => d.type === "person");

  return (
    <div style={{ maxWidth: 800 }}>
      {rows.map((p, idx) => {
        const props = propsOf(p);
        const isStale = new Date(p.verified_at).getTime() < staleThreshold;
        const ownerId = personDef ? props[personDef.key] : null;
        const owner =
          typeof ownerId === "string"
            ? members.find((m) => m.user_id === ownerId)?.profiles
            : null;
        const v = stateDef ? props[stateDef.key] : null;
        const status = stateDef && typeof v === "string" && v ? valueLabel(stateDef, v, []) : null;
        const ownerName = owner?.full_name ?? owner?.email ?? null;
        const parts = [ownerName, status].filter(Boolean) as string[];
        const isLast = idx === rows.length - 1;
        const isSelected = selectedSet.has(p.id);
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              const t = e.target as HTMLElement;
              if (
                t.closest("[data-row-checkbox]") ||
                t.closest("[data-row-more]") ||
                t.closest('[aria-label="Page actions"]')
              ) return;
              if (anySelection) {
                onCheckboxClick(p.id, e.shiftKey);
                return;
              }
              setOrigin(p.id);
              navigate({ to: "/p/$pageId", params: { pageId: p.id } });
            }}
            className={
              "group grid w-full items-center gap-[11px] rounded-lg text-left cursor-pointer " +
              (isSelected ? "bg-blueTint hover:bg-blueWash " : "hover:bg-sunken ") +
              (isLast ? "" : "border-b border-lineSoft ")
            }
            style={{
              gridTemplateColumns: "20px minmax(0,1fr) auto 24px",
              minHeight: "var(--gio-list-row, 44px)",
              padding: "7px 10px",
            }}
          >
            {(anySelection || isSelected) ? (
              <span data-row-checkbox>
                <RowCheckbox
                  checked={isSelected}
                  alwaysVisible
                  onClick={(shift) => onCheckboxClick(p.id, shift)}
                />
              </span>
            ) : (
              <Ico icon={p.icon ?? "📄"} size={21} />
            )}
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
            <span
              data-row-more
              className="justify-self-end opacity-0 group-hover:opacity-100 focus-within:opacity-100"
            >
              <SpecMenuTrigger
                build={getPageMenuBuild(p)}
                size="sm"
                ariaLabel="Page actions"
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Selection primitives ─────────────────────────── */
