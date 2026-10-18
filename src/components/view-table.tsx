import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openPageSomewhere } from "@/lib/peek";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { pageQuery } from "@/hooks/use-workspace-data";
import { useSetPageOrigin } from "@/lib/page-origin";
import { useAddPropertyOption } from "@/hooks/use-property-mutations";
import type { useRenamePage, useSetPageProperty } from "@/hooks/use-page-mutations";
import { isFinished } from "@/lib/status-groups";
import { readNumberFormat, type NumberFormat } from "@/lib/number-format";
import { isTypedString, PROPERTY_KINDS } from "@/lib/property-kinds";
import { relList, relResolve } from "@/lib/related-links";
import {
  relatedPages,
  formulaResultOf,
  relationSummary,
  relationUsable,
  relationWrite,
  rollupKind,
  rollupText,
  uniqueIdText,
  type RelationIndex,
} from "@/lib/relations";
import { FilesValue } from "./files-value";
import { FormulaValueView, UniqueIdView } from "./computed-value";
import { RelationEditor } from "./relation-editor";
import { groupRows, sortProp, type PropInfo, type RowGroup, type SortSpec } from "@/lib/run-view";
import { viewTime } from "@/lib/view-time";
import {
  CALC_LABELS,
  CALC_SHORT,
  calcsFor,
  calculate,
  isCalcId,
  type CalcId,
} from "@/lib/view-calc";
import {
  TITLE_KEY,
  allPropKeys,
  hideProp,
  insertProp,
  labelOfProp,
  moveProp,
  toggleWrap,
  setWidth,
  showProp,
  shownProps,
  sortNameOf,
  typeOfProp,
  trackOf,
  widthOf,
  type ViewConfig,
} from "@/lib/view-config";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";
import { Ico } from "./emoji-icon";
import { Popover } from "./popover";
import { MenuHead, MenuIcon, MenuLead } from "./menu-parts";
import { RowMenu, SpecMenuTrigger, type MenuBuildCtx, type MenuRow, type MenuSpec } from "./row-menu";
import { usePropertyEditing } from "./property-menu";
import { useNewPropertyFlow } from "./new-property-flow";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useWorkspaceId } from "@/lib/workspace-context";
import { RelatedLinks } from "./related-links";
import {
  CheckboxToggle,
  DatePicker,
  MiniAvatar,
  NumberEditor,
  OwnerPicker,
  SelectPicker,
  StatusChip,
  TagsPicker,
  TextEditor,
  TypedValueEditor,
  hashTag,
  type SelectOption,
} from "./property-pickers";
import { IC } from "@/lib/menu-icons";
import { useIsPhone } from "@/lib/use-media";
import { onePersonOnly, personIds } from "@/lib/person-value";

/* The table layout of a view. Which properties it shows, in which order and
 * how wide, come from the view's config (src/lib/view-config.ts); every
 * property type gets an editable cell. The page title is always first.
 *
 * Arranging: drag a property's heading to move it, drag its right edge to
 * resize (double-click resets), or use its menu (sort, move, hide). The
 * Properties button at the end shows and hides properties. */

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];
export type TableMember = {
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
type SetPropFn = ReturnType<typeof useSetPageProperty>["mutate"];
type RenameFn = ReturnType<typeof useRenamePage>["mutate"];
type MenuBuild = (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }) => MenuSpec;

const EMPTY_PAGES: PageListItem[] = [];

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

function useStable<T>(value: T, sig: string): T {
  const ref = useRef<{ sig: string; value: T }>({ sig, value });
  if (ref.current.sig !== sig) ref.current = { sig, value };
  return ref.current.value;
}

function keyOfSortName(prop: string): string {
  const k = sortProp(prop);
  return k === "@title" ? TITLE_KEY : k;
}

const EMPTY = <span className="text-faint">—</span>;

/* ─────────────────────────── Cells ─────────────────────────── */

function PageTitleCell({
  page,
  onSave,
  autoEdit = false,
  onEditDone,
}: {
  page: PageListItem;
  onSave: (title: string) => void;
  /** Start naming it right away (a row just added with + New page). */
  autoEdit?: boolean;
  onEditDone?: () => void;
}) {
  const [editing, setEditingState] = useState(autoEdit);
  const [value, setValue] = useState(page.title ?? "");
  useEffect(() => {
    if (autoEdit) setEditingState(true);
  }, [autoEdit]);
  const setEditing = (on: boolean) => {
    setEditingState(on);
    if (!on) onEditDone?.();
  };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setOrigin = useSetPageOrigin();

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Ico icon={page.icon || "📄"} size={19} />
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (value !== page.title) onSave(value);
          }}
          placeholder="Untitled"
          aria-label="Page title"
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
              // A row opens in a dialog over the database (Notion's peek).
              openPageSomewhere(navigate, page.id);
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

function PersonView({ member }: { member: TableMember | undefined }) {
  if (!member) return EMPTY;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MiniAvatar profile={member.profiles} />
      <span className="min-w-0 truncate text-meta text-body">
        {member.profiles?.full_name || member.profiles?.email || "Unknown"}
      </span>
    </span>
  );
}

function PersonCell({
  value,
  members,
  emptyLabel,
  multi,
  onPick,
}: {
  value: unknown;
  members: TableMember[];
  emptyLabel: string;
  /** No limit: several people. */
  multi: boolean;
  onPick: (next: string | string[] | null) => void;
}) {
  const people = personIds(value)
    .map((id) => members.find((m) => m.user_id === id))
    .filter((m): m is TableMember => !!m);
  return (
    <OwnerPicker
      value={value}
      multi={multi}
      members={members}
      onPick={onPick}
      emptyLabel={emptyLabel}
      trigger={({ onClick, ref }) => (
        <button ref={ref} type="button" onClick={onClick} className="flex min-w-0 flex-1 text-left">
          {people.length === 0 ? (
            <span className="text-faint">—</span>
          ) : people.length === 1 ? (
            <PersonView member={people[0]} />
          ) : (
            <PeopleView members={people} />
          )}
        </button>
      )}
    />
  );
}

/** Several people in one cell: their faces overlapping, then the names. */
function PeopleView({ members }: { members: TableMember[] }) {
  const names = members.map((m) => m.profiles?.full_name || m.profiles?.email || "Unknown");
  return (
    <span className="flex min-w-0 items-center" style={{ gap: 6 }}>
      <span className="flex shrink-0">
        {members.slice(0, 3).map((m, i) => (
          <span key={m.user_id} style={{ marginLeft: i ? -6 : 0, borderRadius: 999, boxShadow: "0 0 0 2px var(--color-surface)" }}>
            <MiniAvatar profile={m.profiles} />
          </span>
        ))}
      </span>
      <span className="min-w-0 truncate text-meta text-body">{names.join(", ")}</span>
    </span>
  );
}


function OptionCell({
  def,
  value,
  onSet,
}: {
  def: PropDef;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const addOption = useAddPropertyOption();
  const opts = (def.options as unknown as SelectOption[]) ?? [];
  const cur = opts.find((o) => o.value === value);
  return (
    <SelectPicker
      value={typeof value === "string" ? value : null}
      options={opts}
      onPick={onSet}
      // Team-made properties grow their own options; built-in ones keep
      // the list they were set up with.
      onCreate={
        def.is_system
          ? undefined
          : async (label) => {
              try {
                return (await addOption.mutateAsync({ id: def.id, label })).value;
              } catch {
                return null;
              }
            }
      }
      trigger={({ onClick, ref }) => (
        <button ref={ref} type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
          {cur ? <StatusChip label={cur.label} tint={cur.tint} ink={cur.ink} /> : EMPTY}
        </button>
      )}
    />
  );
}

function MultiCell({
  value,
  options,
  onSet,
}: {
  value: unknown;
  options: string[];
  onSet: (tags: string[]) => void;
}) {
  const tags = Array.isArray(value) ? value.map(String) : [];
  const shown = tags.slice(0, 2);
  const extra = tags.length - shown.length;
  return (
    <TagsPicker
      value={tags}
      options={options}
      onSet={onSet}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden"
        >
          {shown.map((t) => {
            const c = hashTag(t);
            return (
              <span
                key={t}
                className="truncate rounded-sm px-1.5 py-0.5 text-caption"
                style={{ background: `var(--color-${c.tint})`, color: `var(--color-${c.ink})` }}
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
          {tags.length === 0 && EMPTY}
        </button>
      )}
    />
  );
}

/** Related pages in a cell: a one-line summary that opens the full editor. */
function LinksCell({
  page,
  value,
  pages,
  onSet,
}: {
  page: PageListItem;
  value: unknown;
  pages: PageListItem[];
  onSet: (v: string[]) => void;
}) {
  const navigate = useNavigate();
  const names = relList(value)
    .map((e) => {
      const r = relResolve(e, pages);
      if (r.kind === "page") return r.page.title?.trim() || "Untitled";
      if (r.kind === "url") return r.url.replace(/^https?:\/\//, "");
      return null;
    })
    .filter((x): x is string => !!x);
  return (
    <Popover
      width={320}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="min-w-0 flex-1 truncate text-left text-meta"
        >
          {names.length === 0
            ? EMPTY
            : names.length === 1
              ? names[0]
              : `${names[0]} +${names.length - 1}`}
        </button>
      )}
    >
      {() => (
        <div style={{ padding: "6px 8px" }}>
          <RelatedLinks
            value={value}
            pages={pages}
            currentPageId={page.id}
            onSet={onSet}
            onOpenPage={(id) => navigate({ to: "/p/$pageId", params: { pageId: id } })}
          />
        </div>
      )}
    </Popover>
  );
}

/** What tables need for relations and rollups (built once per view). */
export type TableRelations = {
  idx: RelationIndex;
  words: (value: unknown, key: string) => string[];
  readValue: (page: PageListItem, key: string) => unknown;
  candidates: (def: PropDef, page: PageListItem) => PageListItem[];
  scopeNote: (def: PropDef) => string | undefined;
};

type CellCtx = {
  defs: ReadonlyMap<string, PropDef>;
  members: TableMember[];
  multiOptions: ReadonlyMap<string, string[]>;
  linkPages: PageListItem[];
  isStale: boolean;
  setProp: SetPropFn;
  relations: TableRelations | null;
};

/** A relation in a cell: its pages in one line; the editor in a popover.
 *  On a two-way relation's far side, a change is written to the other page. */
function RelationCell({
  page,
  def,
  rel,
  setProp,
}: {
  page: PageListItem;
  def: PropDef;
  rel: TableRelations;
  setProp: SetPropFn;
}) {
  const navigate = useNavigate();
  const linked = relatedPages(page, def.key, rel.idx);
  const write = (otherId: string, add: boolean) => {
    const w = relationWrite(def, page, otherId, add, rel.idx);
    if (w) setProp(w);
  };
  return (
    <Popover
      width={300}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="min-w-0 flex-1 truncate text-left text-meta text-body"
        >
          {linked.length ? relationSummary(linked) : EMPTY}
        </button>
      )}
    >
      {() => (
        <RelationEditor
          linked={linked}
          candidates={rel.candidates(def, page)}
          scopeNote={rel.scopeNote(def)}
          onAdd={(id) => write(id, true)}
          onRemove={(id) => write(id, false)}
          onOpenPage={(id) => navigate({ to: "/p/$pageId", params: { pageId: id } })}
        />
      )}
    </Popover>
  );
}

function ValueCell({ page, k, ctx }: { page: PageListItem; k: string; ctx: CellCtx }) {
  const set = (value: unknown) => ctx.setProp({ pageId: page.id, key: k, value });
  switch (k) {
    case "@verified":
      return ctx.isStale ? (
        <span className="inline-flex items-center gap-1 truncate font-bold text-amberInk">
          ⚠ {viewTime(page.verified_at)}
        </span>
      ) : (
        <span className="truncate text-meta text-muted">{viewTime(page.verified_at)}</span>
      );
    case "@edited":
      return <span className="truncate text-meta text-muted">{viewTime(page.edited_at)}</span>;
    case "@created":
      return page.created_at ? (
        <span className="truncate text-meta text-muted">{viewTime(page.created_at)}</span>
      ) : (
        EMPTY
      );
    case "@created_by":
      return <PersonView member={ctx.members.find((m) => m.user_id === page.created_by)} />;
    case "@edited_by":
      return <PersonView member={ctx.members.find((m) => m.user_id === page.edited_by)} />;
  }
  const def = ctx.defs.get(k);
  if (!def) return EMPTY;
  if (def.type === "relation")
    return ctx.relations && relationUsable(def, ctx.relations.idx.defs) ? (
      <RelationCell page={page} def={def} rel={ctx.relations} setProp={ctx.setProp} />
    ) : (
      EMPTY
    );
  if (def.type === "unique_id") return <UniqueIdView text={uniqueIdText(page, def)} />;
  if (def.type === "formula")
    return (
      <FormulaValueView
        result={
          ctx.relations
            ? formulaResultOf(page, def, ctx.relations.idx.defs, ctx.relations.readValue, ctx.relations.words)
            : null
        }
      />
    );
  if (def.type === "rollup") {
    // Worked out from the related pages: read only.
    const text = ctx.relations ? rollupText(page, def, ctx.relations.idx, ctx.relations.words) : "";
    return text ? (
      <span
        className={`truncate text-meta text-body ${rollupKind(def) === "number" ? "tnum" : ""}`}
      >
        {text}
      </span>
    ) : (
      EMPTY
    );
  }
  const raw = propsOf(page)[k];
  switch (def.type) {
    case "person":
      return (
        <PersonCell
          value={raw}
          multi={!onePersonOnly(def)}
          members={ctx.members}
          emptyLabel={k === "owner" ? "No owner" : "No one"}
          onPick={set}
        />
      );
    case "select":
    case "status":
      return <OptionCell def={def} value={raw} onSet={set} />;
    case "multi_select":
      return <MultiCell value={raw} options={ctx.multiOptions.get(k) ?? []} onSet={set} />;
    case "links":
      return <LinksCell page={page} value={raw} pages={ctx.linkPages} onSet={set} />;
    case "checkbox":
      return <CheckboxToggle value={raw} onSet={set} label={def.label} variant="cell" />;
    case "files":
      return <FilesValue pageId={page.id} value={raw} onSet={set} variant="cell" />;
    case "number":
      return (
        <NumberEditor
          value={raw}
          onSet={set}
          variant="cell"
          triggerClassName="tnum text-left"
          format={readNumberFormat(def.config)}
        />
      );
    case "date":
      return (
        <DatePicker
          value={raw}
          onSet={set}
          variant="cell"
          terminal={isFinished(propsOf(page), ctx.defs.values())}
          triggerClassName="min-w-0 text-left"
        />
      );
  }
  if (isTypedString(def.type))
    return (
      <TypedValueEditor
        type={def.type}
        value={raw}
        onSet={set}
        variant="cell"
        triggerClassName="text-left"
      />
    );
  return <TextEditor value={raw} onSet={set} variant="cell" triggerClassName="text-left" />;
}

/* ─────────────────────────── Row ─────────────────────────── */

function cellClass(selected: boolean, edge?: boolean, extra = ""): string {
  return (
    "min-w-0 border-b border-lineSoft gio-cell-pad flex items-center whitespace-nowrap " +
    (edge ? "justify-center px-0 " : "px-[11px] overflow-hidden ") +
    (selected ? "bg-blueTint group-hover:bg-blueWash " : "group-hover:bg-sunken ") +
    extra
  );
}

/** A frozen cell's class and its place from the left (Freeze): the
 *  gutter ("") sits at 0, each frozen property at its measured left. */
function frozenOf(frozen: readonly string[], k: string): { cls: string; style?: React.CSSProperties } {
  if (frozen.length === 0) return { cls: "" };
  if (k === "") return { cls: " gio-frozen sticky", style: { left: 0 } };
  const i = frozen.indexOf(k);
  if (i < 0) return { cls: "" };
  return {
    // "sticky" as a utility too: it outranks a heading's own "relative".
    cls: " gio-frozen sticky" + (i === frozen.length - 1 ? " gio-frozen-edge" : ""),
    style: { left: `var(--fz-${i}, 0px)` },
  };
}

const TableRow = memo(function TableRow({
  p,
  shown,
  ctx,
  rename,
  selected,
  anySelection,
  onCheckboxClick,
  getMenu,
  autoEdit,
  onEditDone,
  selectable,
  wrapped,
  frozen,
}: {
  p: PageListItem;
  shown: string[];
  /** Freeze: the title and properties that stay while the table scrolls. */
  frozen: readonly string[];
  ctx: CellCtx;
  rename: RenameFn;
  selected: boolean;
  anySelection: boolean;
  onCheckboxClick: (id: string, shift: boolean) => void;
  getMenu: (p: PageListItem) => MenuBuild;
  autoEdit: boolean;
  onEditDone: () => void;
  selectable: boolean;
  /** Properties whose cells wrap (Wrap text). */
  wrapped: ReadonlySet<string>;
}) {
  return (
    <div className="contents group" role="row">
      <div data-page-id={p.id} className={cellClass(selected, true) + frozenOf(frozen, "").cls} style={frozenOf(frozen, "").style}>
        {selectable ? (
          <RowCheckbox
            checked={selected}
            alwaysVisible={anySelection}
            onClick={(shift) => onCheckboxClick(p.id, shift)}
          />
        ) : null}
      </div>
      <div data-page-id={p.id} role="cell" data-wrap={wrapped.has(TITLE_KEY) || undefined} className={cellClass(selected) + frozenOf(frozen, TITLE_KEY).cls} style={frozenOf(frozen, TITLE_KEY).style}>
        <PageTitleCell
          page={p}
          onSave={(t) => rename({ pageId: p.id, title: t })}
          autoEdit={autoEdit}
          onEditDone={onEditDone}
        />
      </div>
      {shown.map((k) => (
        <div key={k} data-page-id={p.id} data-prop={k} role="cell" data-wrap={wrapped.has(k) || undefined} className={cellClass(selected) + frozenOf(frozen, k).cls} style={frozenOf(frozen, k).style}>
          <ValueCell page={p} k={k} ctx={ctx} />
        </div>
      ))}
      {/* Pinned to the right edge, so row actions stay in reach when the
          table scrolls sideways. */}
      <div
        data-page-id={p.id}
        data-row-more
        className={cellClass(
          selected,
          false,
          "sticky right-0 justify-end " + (selected ? "" : "bg-surface"),
        )}
      >
        <SpecMenuTrigger
          build={(mctx) => getMenu(p)(mctx)}
          size="sm"
          ariaLabel="Page actions"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
        />
      </div>
    </div>
  );
});

export function RowCheckbox({
  checked,
  alwaysVisible,
  onClick,
}: {
  checked: boolean;
  alwaysVisible: boolean;
  onClick: (shift: boolean) => void;
}) {
  return (
    <button
      type="button"
      data-row-checkbox
      aria-checked={checked}
      role="checkbox"
      aria-label="Select page"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e.shiftKey);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={
        "grid place-items-center rounded-[4px] " +
        (alwaysVisible || checked ? "visible " : "invisible group-hover:visible ")
      }
      style={{
        width: 16,
        height: 16,
        border: "1.6px solid var(--color-rule)",
        background: checked ? "var(--color-accent)" : "var(--color-surface)",
        borderColor: checked ? "var(--color-accent)" : "var(--color-rule)",
      }}
    >
      {checked && (
        <svg viewBox="0 0 24 24" width={10} height={10} aria-hidden fill="none">
          <path
            d="M20 6 9 17l-5-5"
            stroke="white"
            strokeWidth={3.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function HeaderSelectAll({
  state,
  count,
  onClick,
}: {
  state: "none" | "some" | "all";
  count: number;
  onClick: () => void;
}) {
  const filled = state !== "none";
  return (
    <button
      type="button"
      title={state === "none" ? `Select all ${count}` : "Clear selection"}
      aria-label={state === "none" ? `Select all ${count}` : "Clear selection"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="grid place-items-center rounded-[4px]"
      style={{
        width: 16,
        height: 16,
        border: "1.6px solid " + (filled ? "var(--color-accent)" : "var(--color-rule)"),
        background: filled ? "var(--color-accent)" : "var(--color-surface)",
      }}
    >
      {state === "some" && (
        <svg viewBox="0 0 24 24" width={10} height={10} aria-hidden fill="none">
          <path d="M6 12h12" stroke="white" strokeWidth={3.4} strokeLinecap="round" />
        </svg>
      )}
      {state === "all" && (
        <svg viewBox="0 0 24 24" width={10} height={10} aria-hidden fill="none">
          <path
            d="M20 6 9 17l-5-5"
            stroke="white"
            strokeWidth={3.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

/* ─────────────────────────── Headings ─────────────────────────── */

/* Notion's heading row (2026-10-11): plain, sentence case, each property
 * with its type's icon. */
const HEAD_CLASS = "relative flex items-center border-b border-line text-meta text-muted";
const HEAD_STYLE = { padding: "7px 0", lineHeight: "16px" } as const;

function kindIcon(type: string | undefined): string | undefined {
  if (type === "timestamp") return IC.clock;
  if (type === "title") return undefined;
  return PROPERTY_KINDS.find((k) => k.type === type)?.icon;
}

function SortArrow({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden className="shrink-0 text-muted">
      <path
        d={dir === "asc" ? "M12 19V5m-6 6 6-6 6 6" : "M12 5v14m6-6-6 6-6-6"}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PropHeading({
  k,
  label,
  sortDir,
  dragging,
  canArrange,
  menu,
  onPointerDownLabel,
  onResizeStart,
  onResetWidth,
  onNudgeWidth,
  suppressClick,
  icon,
  frozen,
  description,
}: {
  /** Freeze: this heading's class and place. */
  frozen?: { cls: string; style?: React.CSSProperties };
  /** The property's description: the heading's tooltip. */
  description?: string;
  /** The property type's icon (a path), or "Aa" for the title. */
  icon?: string;
  k: string;
  label: string;
  sortDir: "asc" | "desc" | null;
  dragging: boolean;
  canArrange: boolean;
  menu: (mctx: MenuBuildCtx) => MenuSpec;
  onPointerDownLabel: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onResetWidth: () => void;
  /** Arrow keys resize live; the width is saved once, on key up. */
  onNudgeWidth: (dx: number, commit: boolean) => void;
  suppressClick: React.MutableRefObject<boolean>;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [spec, setSpec] = useState<MenuSpec | null>(null);
  return (
    <div
      role="columnheader"
      aria-sort={sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : undefined}
      data-prop-header={k}
      className={HEAD_CLASS + (frozen?.cls ?? "")}
      style={{ ...HEAD_STYLE, ...frozen?.style, opacity: dragging ? 0.45 : 1 }}
    >
      <button
        type="button"
        title={description || undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left hover:text-strong"
        style={{
          padding: "0 11px",
          cursor: canArrange && k !== TITLE_KEY ? "grab" : "pointer",
          touchAction: "none",
        }}
        onPointerDown={onPointerDownLabel}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setSpec(
            menu({
              setSpec,
              close: () => {
                setAnchor(null);
                setSpec(null);
              },
            }),
          );
          setAnchor(e.currentTarget);
        }}
        aria-haspopup="menu"
      >
        {icon === "Aa" ? (
          <span aria-hidden className="shrink-0 text-caption text-faint" style={{ width: 15, textAlign: "center" }}>
            Aa
          </span>
        ) : icon ? (
          <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden className="shrink-0 text-faint">
            <path d={icon} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
        <span className="truncate">{label}</span>
        {sortDir ? <SortArrow dir={sortDir} /> : null}
      </button>
      {canArrange ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label}`}
          tabIndex={0}
          className="gio-prop-resize"
          onPointerDown={onResizeStart}
          onDoubleClick={onResetWidth}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              onNudgeWidth(e.key === "ArrowLeft" ? -16 : 16, false);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") onNudgeWidth(0, true);
          }}
        />
      ) : null}
      <RowMenu
        spec={spec}
        anchor={anchor}
        align="start"
        onClose={() => {
          setAnchor(null);
          setSpec(null);
        }}
      />
    </div>
  );
}

/** "+" at the end of the heading row: a new property for this database,
 *  shown in this view as soon as it's made. Same flow as a row's
 *  "Add a property" (new-property-flow.tsx). */
function AddPropertyButton({
  databaseId,
  onCreated,
  shownBuiltIns,
  iconOnly = false,
}: {
  databaseId: string;
  onCreated: (key: string) => void;
  /** Built-ins already shown (the rest are offered as columns). */
  shownBuiltIns: string[];
  /** A phone's narrow end track: just the +. */
  iconOnly?: boolean;
}) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const allPropDefs = useMemo(() => (shell.propDefs.data ?? []) as PropDef[], [shell.propDefs.data]);
  const databases = useMemo(
    () =>
      ((shell.pages.data ?? []) as PageListItem[])
        .filter((p) => p.is_database && !p.archived_at)
        .map((p) => ({ id: p.id, title: p.title, icon: p.icon }))
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")),
    [shell.pages.data],
  );
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [sub, setSub] = useState<MenuSpec | null>(null);
  const close = () => {
    setAnchor(null);
    setSub(null);
  };
  const { typeSpec } = useNewPropertyFlow({
    databaseId,
    allPropDefs,
    databases,
    setSub: (s) => (s ? setSub(s) : close()),
    rootBack: null,
    noBack: true,
    shownBuiltIns,
    onBuiltIn: (key) => {
      onCreated(key);
      close();
    },
    onCreated: (def) => {
      onCreated(def.key);
      close();
    },
  });
  return (
    <>
      <button
        type="button"
        aria-expanded={!!anchor}
        data-add-property
        aria-label={iconOnly ? "Add property" : undefined}
        title={iconOnly ? "Add property" : undefined}
        onClick={(e) => {
          setSub(null);
          setAnchor(e.currentTarget);
        }}
        className={`flex items-center gap-1 whitespace-nowrap rounded-md text-meta text-muted hover:bg-railHover hover:text-strong ${anchor ? "bg-railHover" : ""}`}
        style={iconOnly ? { height: 24, width: 28, justifyContent: "center", margin: "0 6px" } : { height: 24, padding: "0 6px", marginRight: "auto", marginLeft: 4 }}
      >
        <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden fill="none">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
        </svg>
        {iconOnly ? null : "Add property"}
      </button>
      <RowMenu spec={anchor ? (sub ?? typeSpec) : null} anchor={anchor} onClose={close} />
    </>
  );
}

/** Show and hide properties, from the end of the heading row. */
function PropertiesMenu({
  shown,
  allKeys,
  labelOf,
  typeOf,
  onChange,
}: {
  shown: string[];
  allKeys: string[];
  labelOf: (k: string) => string;
  typeOf: (k: string) => string | undefined;
  onChange: (next: string[]) => void;
}) {
  const hidden = allKeys.filter((k) => !shown.includes(k));
  return (
    <Popover
      width={260}
      align="end"
      trigger={({ onClick, ref, open }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          aria-expanded={open}
          aria-label="Properties"
          title="Show and hide properties"
          className={`grid place-items-center rounded-md text-whisper hover:bg-railHover hover:text-strong ${open ? "bg-railHover" : ""}`}
          style={{ width: 22, height: 22, marginRight: 4 }}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden fill="none">
            <path
              d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    >
      {() => (
        <div role="menu" aria-label="Properties" style={{ maxHeight: 360, overflowY: "auto" }}>
          <MenuHead
            trailing={
              <button
                type="button"
                onClick={() => onChange(hidden.length ? allKeys : [])}
                className="rounded-md px-2 text-meta text-muted hover:bg-sunken hover:text-strong"
                style={{ height: 24 }}
              >
                {hidden.length ? "Show all" : "Hide all"}
              </button>
            }
          >
            Properties
          </MenuHead>
          {allKeys.map((k) => {
            const on = shown.includes(k);
            const icon = kindIcon(typeOf(k));
            return (
              <button
                key={k}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onChange(on ? hideProp(shown, k) : showProp(shown, k))}
                className="gio-mrow"
              >
                <MenuLead>{icon ? <MenuIcon path={icon} /> : null}</MenuLead>
                <span className={`truncate ${on ? "text-strong" : "text-muted"}`}>
                  {labelOf(k)}
                </span>
                <span
                  aria-hidden
                  className="grid shrink-0 place-items-center rounded-full"
                  style={{
                    width: 26,
                    height: 15,
                    padding: 2,
                    justifyItems: on ? "end" : "start",
                    background: on ? "var(--color-accent)" : "var(--color-rule)",
                    transition: "background-color var(--dur-hover) var(--ease-out)",
                  }}
                >
                  <span
                    className="block rounded-full bg-surface"
                    style={{ width: 11, height: 11 }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

/* ─────────────────────────── Groups and + New ─────────────────────────── */

const NO_VALUE = "\u0000none";

function GroupLabel({
  group,
  def,
  groupKey,
  members,
  labelOf,
}: {
  group: RowGroup;
  def: PropDef | undefined;
  groupKey: string | null;
  members: TableMember[];
  labelOf: (k: string) => string;
}) {
  if (group.value === null)
    return <span className="text-muted">No {labelOf(groupKey ?? "").toLowerCase()}</span>;
  if (def && (def.type === "select" || def.type === "status")) {
    const o = ((def.options as unknown as SelectOption[]) ?? []).find(
      (x) => x.value === group.value,
    );
    if (o) return <StatusChip label={o.label} tint={o.tint} ink={o.ink} />;
  }
  if (def?.type === "person" || groupKey === "@created_by" || groupKey === "@edited_by")
    return <PersonView member={members.find((m) => m.user_id === group.value)} />;
  return <span className="text-strong">{group.label}</span>;
}

function GroupBlock({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="contents" role="row">
        <div
          role="rowheader"
          className="flex min-w-0 items-center border-b border-lineSoft"
          style={{ gridColumn: "1 / -1", gap: 8, padding: "14px 6px 6px 0" }}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Collapse group" : "Expand group"}
            className="grid shrink-0 place-items-center rounded-sm text-faint hover:bg-rail hover:text-strong"
            style={{ width: 18, height: 18 }}
          >
            <svg
              viewBox="0 0 24 24"
              width={12}
              height={12}
              aria-hidden
              style={{
                transform: open ? "rotate(90deg)" : "none",
                transition: "transform var(--dur-hover) var(--ease-out)",
              }}
            >
              <path
                d="m9 6 6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="flex min-w-0 items-center text-meta">{label}</span>
          <span className="tnum text-caption text-faint">{count}</span>
        </div>
      </div>
      {children}
    </>
  );
}

function NewRowButton({ onAdd }: { onAdd: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="contents" role="row">
      <div className="border-b border-lineSoft" style={{ gridColumn: "1 / -1" }}>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd();
            } finally {
              setBusy(false);
            }
          }}
          className="flex w-full items-center text-left text-meta text-faint hover:bg-sunken hover:text-strong disabled:cursor-default"
          style={{ gap: 7, padding: "7px 11px 7px 27px" }}
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
      </div>
    </div>
  );
}

/* ─────────────────────────── Calculate row ─────────────────────────── */

function CalcCell({
  k,
  label,
  type,
  calc,
  pages,
  canArrange,
  onPick,
  readValue,
  numberFormat,
}: {
  numberFormat?: NumberFormat;
  k: string;
  label: string;
  type: string | undefined;
  calc: CalcId | undefined;
  pages: PageListItem[];
  canArrange: boolean;
  onPick: (calc: CalcId | null) => void;
  readValue?: (page: PageListItem, key: string) => unknown;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [spec, setSpec] = useState<MenuSpec | null>(null);
  const value = calc ? calculate(calc, pages, k, undefined, readValue, numberFormat) : "";
  const close = () => {
    setAnchor(null);
    setSpec(null);
  };
  const content = calc ? (
    <span className="flex min-w-0 items-baseline justify-end" style={{ gap: 6 }}>
      <span className="shrink-0 text-label uppercase text-faint">{CALC_SHORT[calc]}</span>
      <span className="tnum truncate text-meta text-body">{value || "—"}</span>
    </span>
  ) : (
    <span className="text-meta text-faint opacity-0 group-hover/calc:opacity-100 group-focus-within/calc:opacity-100">
      Calculate
    </span>
  );
  if (!canArrange) return calc ? content : null;
  return (
    <>
      <button
        type="button"
        aria-label={calc ? `${label}: ${CALC_LABELS[calc]} ${value}` : `Calculate ${label}`}
        onClick={(e) => {
          const rows: MenuRow[] = [
            {
              kind: "row",
              label: "None",
              checked: !calc,
              onPick: () => {
                onPick(null);
                close();
              },
            },
            { kind: "sep" },
            ...calcsFor(type).map<MenuRow>((c) => ({
              kind: "row",
              label: CALC_LABELS[c],
              checked: calc === c,
              onPick: () => {
                onPick(c);
                close();
              },
            })),
          ];
          setSpec({ title: `Calculate ${label.toLowerCase()}`, rows, width: 220 });
          setAnchor(e.currentTarget);
        }}
        className="flex min-w-0 flex-1 justify-end rounded-sm hover:bg-sunken"
        style={{ padding: "2px 4px" }}
      >
        {content}
      </button>
      <RowMenu spec={spec} anchor={anchor} align="end" onClose={close} />
    </>
  );
}

function CalcRow({
  pages,
  keys,
  calcs,
  canArrange,
  labelOf,
  typeOf,
  onPick,
  readValue,
  formatOf,
  frozen = [],
}: {
  frozen?: readonly string[];
  /** A number property's format, for sums and averages. */
  formatOf?: (k: string) => NumberFormat | undefined;
  pages: PageListItem[];
  keys: string[];
  calcs: Record<string, string> | undefined;
  canArrange: boolean;
  labelOf: (k: string) => string;
  typeOf: (k: string) => string | undefined;
  onPick: (k: string, calc: CalcId | null) => void;
  readValue?: (page: PageListItem, key: string) => unknown;
}) {
  const any = keys.some((k) => isCalcId(calcs?.[k]));
  if (!any && !canArrange) return null;
  const cell = "flex min-w-0 items-center overflow-hidden border-b border-lineSoft";
  return (
    <div className="contents group/calc" role="row" data-calc-row>
      <div className={cell + frozenOf(frozen, "").cls} style={frozenOf(frozen, "").style} />
      {keys.map((k) => {
        const c = calcs?.[k];
        return (
          <div key={k} className={cell + frozenOf(frozen, k).cls} style={{ padding: "5px 7px", minHeight: 32, ...frozenOf(frozen, k).style }} data-calc={k}>
            <CalcCell
              k={k}
              label={labelOf(k)}
              type={typeOf(k)}
              calc={isCalcId(c) ? c : undefined}
              pages={pages}
              canArrange={canArrange}
              onPick={(calc) => onPick(k, calc)}
              readValue={readValue}
              numberFormat={formatOf?.(k)}
            />
          </div>
        );
      })}
      <div className={cell + " sticky right-0 bg-surface"} />
    </div>
  );
}

/* ─────────────────────────── Table ─────────────────────────── */

export function ViewTable({
  rows,
  pages,
  members,
  propDefs,
  staleThreshold,
  rename,
  setProp,
  selectedSet,
  anySelection,
  onCheckboxClick,
  selectAllState,
  onHeaderCheckboxClick,
  getPageMenuBuild,
  config,
  onConfig,
  canArrange,
  sorts,
  onSort,
  groupKey,
  onNewRow,
  relations,
  selectable = true,
  databaseId,
  rowLimit,
  onShowAll,
  isOwner,
  onFilter,
}: {
  rows: PageListItem[];
  pages: PageListItem[];
  members: TableMember[];
  propDefs: PropDef[];
  staleThreshold: number;
  rename: ReturnType<typeof useRenamePage>;
  setProp: ReturnType<typeof useSetPageProperty>;
  selectedSet: Set<string>;
  anySelection: boolean;
  onCheckboxClick: (id: string, shift: boolean) => void;
  selectAllState: "none" | "some" | "all";
  onHeaderCheckboxClick: () => void;
  getPageMenuBuild: (p: PageListItem) => MenuBuild;
  config: ViewConfig;
  onConfig: (next: ViewConfig) => void;
  canArrange: boolean;
  sorts: SortSpec[];
  onSort: (s: SortSpec) => void;
  /** The property rows are grouped by, or null. */
  groupKey: string | null;
  /** Adds a page from the + New page row (seeded with the group's value);
   *  resolves to its id, or null if it wasn't made. */
  onNewRow?: (groupValue: string | null | undefined) => Promise<string | null>;
  /** Relations and rollups: their pages, figures and edits. */
  relations?: TableRelations;
  /** False hides the selection boxes (a view inside a page). */
  selectable?: boolean;
  /** The database the rows belong to: "+" in the heading makes a new
   *  property there (only where the view can be arranged). */
  databaseId?: string;
  /** Show at most this many rows (per group), then "Show all". */
  rowLimit?: number;
  onShowAll?: () => void;
  /** A workspace owner: can archive properties from their column. */
  isOwner?: boolean;
  /** Opens the view's filter builder at this property. */
  onFilter?: (key: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const nudged = useRef<string | null>(null);
  const [drag, setDrag] = useState<{ key: string; x: number; index: number } | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);

  // Properties a page uses; newer kinds appear in the default set once used,
  // and stay for the session so clearing a last value doesn't pull a column.
  const sticky = useRef(new Set<string>());
  const usedSig = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      for (const [k, v] of Object.entries(propsOf(p))) {
        if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
          s.add(k);
      }
    }
    s.forEach((k) => sticky.current.add(k));
    return [...sticky.current].sort().join(",");
  }, [pages]);
  const used = useMemo(() => new Set(usedSig ? usedSig.split(",") : []), [usedSig]);

  const shownNow = shownProps(config, propDefs, used);
  const shown = useStable(shownNow, shownNow.join(","));
  const allKeys = allPropKeys(shown, propDefs);

  const defs = useMemo(() => new Map(propDefs.map((d) => [d.key, d])), [propDefs]);
  const labelOf = (k: string) => labelOfProp(k, propDefs);
  const typeOf = (k: string) => {
    const t = typeOfProp(k, propDefs);
    if (t !== "rollup") return t;
    const kind = rollupKind(defs.get(k));
    return kind === "text" ? "rollup" : kind;
  };

  // Options for multi-selects: every value any page uses, per property.
  const multiNow = useMemo(() => {
    const keys = propDefs.filter((d) => d.type === "multi_select").map((d) => d.key);
    const out: Array<[string, string[]]> = keys.map((k) => {
      const s = new Set<string>();
      for (const p of pages) {
        const v = propsOf(p)[k];
        if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && x && s.add(x));
      }
      return [k, [...s].sort()];
    });
    return out;
  }, [pages, propDefs]);
  const multiOptions = useStable(
    useMemo(() => new Map(multiNow), [multiNow]),
    JSON.stringify(multiNow),
  );
  const hasLinks = shown.some((k) => defs.get(k)?.type === "links");
  const linkPages = hasLinks ? pages : EMPTY_PAGES;
  const setPropMutate = setProp.mutate;
  const renameMutate = rename.mutate;

  // Rows re-render when relations change only if they show one.
  const needsRelations = shown.some((k) => {
    const t = defs.get(k)?.type;
    return t === "relation" || t === "rollup" || t === "formula";
  });
  const rel = needsRelations ? (relations ?? null) : null;
  const ctxFresh = useMemo(
    () => ({
      defs,
      members,
      multiOptions,
      linkPages,
      setProp: setPropMutate,
      relations: rel,
    }),
    [defs, members, multiOptions, linkPages, setPropMutate, rel],
  );
  // One ctx object per staleness, so memoised rows keep their props.
  const ctxStale = useMemo(() => ({ ...ctxFresh, isStale: true }), [ctxFresh]);
  const ctxOk = useMemo(() => ({ ...ctxFresh, isStale: false }), [ctxFresh]);

  const phone = useIsPhone();
  const tracks = [TITLE_KEY, ...shown].map((k) => ({ k, ...trackOf(config, k, typeOf(k)) }));
  const allFixed = tracks.every((t) => t.fixed);
  // The ⋯ track takes what's left only when every property has a set width.
  // The last track holds each row's ⋯ and, in the heading, "+ Add property".
  // On a phone the end track stays 40px: it's sticky, and a wider one
  // would cover the properties the table scrolls under it.
  const endW = canArrange && databaseId && !phone ? 150 : 40;
  const endTrack = allFixed ? `minmax(${endW}px, 1fr)` : `${endW}px`;
  const minTableWidth = 16 + endW + tracks.reduce((n, t) => n + t.min, 0);
  const templateWith = (override?: { key: string; px: number }) =>
    [
      "16px",
      ...tracks.map((t) => (override && override.key === t.k ? `${override.px}px` : t.css)),
      endTrack,
    ].join(" ");

  const primary = sorts[0];
  const sortedKey = primary ? keyOfSortName(primary.prop) : null;

  const editing = usePropertyEditing({ databaseId, isOwner: !!isOwner });
  const wrapped = useMemo(() => new Set(config.wrap ?? []), [config.wrap]);
  // Freeze: the title and the properties up to the frozen one.
  const frozenKeys = useMemo(() => {
    const all = [TITLE_KEY, ...shown];
    const i = config.freeze ? all.indexOf(config.freeze) : -1;
    return i >= 0 ? all.slice(0, i + 1) : [];
  }, [config.freeze, shown]);

  const headingMenu = (k: string, mctx: MenuBuildCtx): MenuSpec => {
    // Every plain choice is final: do it, then close.
    const final = (row: Extract<MenuRow, { kind: "row" }>): MenuRow => ({
      ...row,
      onPick: () => {
        row.onPick();
        mctx.close();
      },
    });
    const back = () => headingMenu(k, mctx);
    const sub = (title: string, rows: MenuRow[], footer?: string): MenuSpec => ({
      title,
      rows,
      footer,
      onBack: () => mctx.setSpec(back()),
      width: 240,
    });
    const isTitle = k === TITLE_KEY;
    const type = isTitle ? "title" : (typeOf(k) ?? "text");
    const rowsOut: MenuRow[] = [];

    // The property itself: Edit property, Property access, Change type.
    const edit = isTitle ? [] : editing.editRows(k, mctx, back);
    if (edit.length) rowsOut.push(...edit, { kind: "sep" });

    // What this view does with it.
    if (onFilter && !isTitle)
      rowsOut.push(final({ kind: "row", label: "Filter", icon: "M4 6h16M7 12h10M10 18h4", onPick: () => onFilter(k) }));
    const [up, down] =
      type === "number" || type === "unique_id"
        ? ["1 → 9", "9 → 1"]
        : type === "date" || type === "timestamp"
          ? ["Old → New", "New → Old"]
          : type === "checkbox"
            ? ["Unchecked first", "Checked first"]
            : ["A → Z", "Z → A"];
    const sortedHere = sortedKey === k ? primary?.dir : undefined;
    rowsOut.push({
      kind: "row",
      label: "Sort",
      icon: "M7 4v12m0 0-3-3m3 3 3-3M17 20V8m0 0-3 3m3-3 3 3",
      hint: { text: (sortedHere === "asc" ? up : sortedHere === "desc" ? down : "") + " ›" },
      onPick: () =>
        mctx.setSpec(
          sub("Sort", [
            final({ kind: "row", label: `Sort ${up}`, icon: IC.chevUp, checked: sortedHere === "asc", onPick: () => onSort({ prop: sortNameOf(k), dir: "asc" }) }),
            final({ kind: "row", label: `Sort ${down}`, icon: IC.chevDown, checked: sortedHere === "desc", onPick: () => onSort({ prop: sortNameOf(k), dir: "desc" }) }),
          ]),
        ),
    });
    if (canArrange) {
      const groupable =
        !isTitle && (["select", "status", "person", "checkbox"].includes(type) || k === "@created_by" || k === "@edited_by");
      if (groupable)
        rowsOut.push(
          final({
            kind: "row",
            label: groupKey === k ? "Ungroup" : "Group",
            icon: "M4 5h16M4 12h10M4 19h7",
            checked: groupKey === k,
            onPick: () => onConfig({ ...config, group: groupKey === k ? null : k }),
          }),
        );

      // Calculate › None, Count ›, Percent ›, then the type's own.
      const ids = calcsFor(type);
      const cur = config.calcs?.[k];
      const setCalc = (c: CalcId | null) => {
        const calcs = { ...(config.calcs ?? {}) };
        if (c) calcs[k] = c;
        else delete calcs[k];
        onConfig({ ...config, calcs });
      };
      const calcRow = (c: CalcId): MenuRow => final({ kind: "row", label: CALC_LABELS[c], checked: cur === c, onPick: () => setCalc(c) });
      const counts = ids.filter((c) => c.startsWith("count_") || c === "checked" || c === "unchecked");
      const percents = ids.filter((c) => c.startsWith("percent_"));
      const others = ids.filter((c) => !counts.includes(c) && !percents.includes(c));
      const calcSpec = (): MenuSpec =>
        sub("Calculate", [
          final({ kind: "row", label: "None", checked: !isCalcId(cur), onPick: () => setCalc(null) }),
          ...(counts.length > 1
            ? [
                {
                  kind: "row" as const,
                  label: "Count",
                  checked: counts.includes(cur as CalcId),
                  hint: { text: "›" },
                  onPick: () => mctx.setSpec({ ...sub("Count", counts.map(calcRow)), onBack: () => mctx.setSpec(calcSpec()) }),
                },
              ]
            : counts.map(calcRow)),
          ...(percents.length
            ? [
                {
                  kind: "row" as const,
                  label: "Percent",
                  checked: percents.includes(cur as CalcId),
                  hint: { text: "›" },
                  onPick: () => mctx.setSpec({ ...sub("Percent", percents.map(calcRow)), onBack: () => mctx.setSpec(calcSpec()) }),
                },
              ]
            : []),
          ...(others.length ? [{ kind: "sep" as const }, ...others.map(calcRow)] : []),
        ], "Shown in the Calculate row under the table.");
      rowsOut.push({
        kind: "row",
        label: "Calculate",
        icon: "M18 5H6l6 7-6 7h12",
        hint: { text: (isCalcId(cur) ? CALC_LABELS[cur] : "") + " ›" },
        onPick: () => mctx.setSpec(calcSpec()),
      });

      rowsOut.push(
        final({
          kind: "row",
          label: config.freeze === k ? "Unfreeze" : "Freeze",
          icon: "M12 3v18M5 8l7 4 7-4M5 16l7-4 7 4",
          checked: config.freeze === k,
          onPick: () => onConfig({ ...config, freeze: config.freeze === k ? null : k }),
        }),
      );
      const i = isTitle ? -1 : shown.indexOf(k);
      if (!isTitle)
        rowsOut.push(
          final({
            kind: "row",
            label: "Hide",
            icon: IC.eyeOff,
            onPick: () => onConfig({ ...config, props: hideProp(shown, k) }),
          }),
        );
      rowsOut.push(
        final({
          kind: "row",
          label: wrapped.has(k) ? "Unwrap content" : "Wrap content",
          icon: "M4 6h16M4 12h13a3 3 0 0 1 0 6h-4m0 0 2-2m-2 2 2 2M4 18h5",
          onPick: () => onConfig(toggleWrap(config, k)),
        }),
      );
      if (!isTitle) {
        if (i > 0)
          rowsOut.push(
            final({ kind: "row", label: "Move left", icon: "m15 18-6-6 6-6", onPick: () => onConfig({ ...config, props: moveProp(shown, k, i - 1) }) }),
          );
        if (i < shown.length - 1)
          rowsOut.push(
            final({ kind: "row", label: "Move right", icon: IC.open, onPick: () => onConfig({ ...config, props: moveProp(shown, k, i + 1) }) }),
          );
      }
      if (config.widths?.[k] !== undefined)
        rowsOut.push(
          final({
            kind: "row",
            label: "Reset width",
            icon: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
            onPick: () => onConfig(setWidth(config, k, null)),
          }),
        );
      const insert = editing
        .insertRows(i, mctx, back, (newKey, at) => onConfig({ ...config, props: insertProp(shown, newKey, at) }))
        // The page title is always first: a new property goes to its right.
        .filter((r) => !isTitle || (r.kind === "row" && r.label === "Insert right"));
      if (insert.length) rowsOut.push({ kind: "sep" }, ...insert);
    }
    const tail = isTitle ? [] : editing.tailRows(k, mctx, back);
    if (tail.length) rowsOut.push(...(canArrange ? [] : [{ kind: "sep" as const }]), ...tail);
    return {
      title: labelOf(k),
      rows: rowsOut,
      width: 260,
      maxHeight: 520,
      inputFirst: true,
      input: isTitle ? undefined : editing.renameInput(k, mctx, back),
      footer: isTitle ? undefined : editing.ownerNote(k),
    };
  };

  /* Drag a heading to move the property. Starts after 4px, like block
   * drags; a click without movement opens the heading's menu. */
  const startHeadingDrag = (e: React.PointerEvent, k: string) => {
    if (e.button !== 0 || !canArrange || k === TITLE_KEY) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const startX = e.clientX;
    let active = false;
    let index = shown.indexOf(k);
    const onMove = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientX - startX) < 4) return;
      active = true;
      const wr = wrap.getBoundingClientRect();
      const others = shown
        .filter((x) => x !== k)
        .map((x) => wrap.querySelector<HTMLElement>(`[data-prop-header="${CSS.escape(x)}"]`))
        .filter((h): h is HTMLElement => !!h)
        .map((h) => h.getBoundingClientRect());
      index = others.filter((r) => r.left + r.width / 2 < ev.clientX).length;
      const title = wrap.querySelector<HTMLElement>(`[data-prop-header="${TITLE_KEY}"]`);
      const edge =
        index === 0 ? (title?.getBoundingClientRect().right ?? wr.left) : others[index - 1].right;
      setDrag({ key: k, x: edge - wr.left + wrap.scrollLeft, index });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
      if (!active) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      setDrag(null);
      if (commit && index !== shown.indexOf(k))
        onConfig({ ...config, props: moveProp(shown, k, index) });
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && active) {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  };

  /* Drag a heading's right edge to resize. Follows the pointer exactly (no
   * transition) by writing the grid template directly; saved on release. */
  const startResize = (e: React.PointerEvent, k: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    const handle = e.currentTarget as HTMLElement;
    if (!grid) return;
    handle.setPointerCapture?.(e.pointerId);
    const startX = e.clientX;
    // Start from the width it has on screen (a column without its own width
    // shares the table's width).
    const head = gridRef.current?.querySelector<HTMLElement>(
      `[data-prop-header="${CSS.escape(k)}"]`,
    );
    const startW = Math.round(head?.getBoundingClientRect().width ?? widthOf(config, k, typeOf(k)));
    let px = startW;
    setResizing(k);
    const onMove = (ev: PointerEvent) => {
      px = Math.round(Math.min(800, Math.max(60, startW + ev.clientX - startX)));
      grid.style.gridTemplateColumns = templateWith({ key: k, px });
    };
    const end = (commit: boolean) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      setResizing(null);
      if (commit && px !== startW) onConfig(setWidth(config, k, px));
      else grid.style.gridTemplateColumns = templateWith();
    };
    const onUp = () => end(true);
    // A cancelled gesture (the system took the pointer) puts it back.
    const onCancel = () => end(false);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  };

  // React owns the template again after every render (a saved width, a
  // reset, a shown/hidden property).
  const template = templateWith();
  // Where each frozen property starts, measured from its heading, so its
  // cells stop there while the table scrolls sideways.
  const frozenSig = frozenKeys.join("\u0000");
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || frozenKeys.length === 0) return;
    const measure = () => {
      frozenKeys.forEach((k, i) => {
        const head = grid.querySelector<HTMLElement>(`[data-prop-header="${CSS.escape(k)}"]`);
        // From the grid's own left edge, whatever positions the heading.
        if (head)
          grid.style.setProperty(
            `--fz-${i}`,
            `${Math.round(head.getBoundingClientRect().left - grid.getBoundingClientRect().left)}px`,
          );
      });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(grid);
    return () => ro?.disconnect();
    // The keys are in frozenSig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozenSig, template]);
  useEffect(() => {
    if (gridRef.current) gridRef.current.style.gridTemplateColumns = template;
  }, [template]);

  // While a selection is active, clicking a row toggles it instead of
  // opening the page, so one stray click doesn't lose the selection.
  const onGridClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!anySelection) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-row-checkbox]") || target.closest("[data-row-more]")) return;
    const id = (target.closest("[data-page-id]") as HTMLElement | null)?.getAttribute(
      "data-page-id",
    );
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    onCheckboxClick(id, e.shiftKey);
  };

  const [editId, setEditId] = useState<string | null>(null);
  const clearEdit = useMemo(() => () => setEditId(null), []);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const addRow = async (groupValue: string | null | undefined) => {
    if (!onNewRow) return;
    const id = await onNewRow(groupValue);
    if (id) setEditId(id);
  };

  // Grouping keeps each group's rows in the view's sort order.
  const groupDef = groupKey ? defs.get(groupKey) : undefined;
  const groups = useMemo(() => {
    if (!groupKey || rows.length === 0) return null;
    const info = new Map<string, PropInfo>();
    if (groupDef)
      info.set(groupKey, {
        type: groupDef.type,
        options: (groupDef.options as unknown as SelectOption[]) ?? [],
      });
    const nameOf = (id: string) => {
      const m = members.find((x) => x.user_id === id);
      return m?.profiles?.full_name || m?.profiles?.email || "Someone";
    };
    return groupRows(rows, groupKey, { props: info, nameOf });
  }, [rows, groupKey, groupDef, members]);

  const renderRow = (p: PageListItem) => {
    const stale = new Date(p.verified_at).getTime() < staleThreshold;
    return (
      <TableRow
        key={p.id}
        p={p}
        shown={shown}
        ctx={stale ? ctxStale : ctxOk}
        rename={renameMutate}
        selected={selectedSet.has(p.id)}
        anySelection={anySelection}
        onCheckboxClick={onCheckboxClick}
        getMenu={getPageMenuBuild}
        autoEdit={editId === p.id}
        onEditDone={clearEdit}
        selectable={selectable}
        wrapped={wrapped}
        frozen={frozenKeys}
      />
    );
  };
  // A view inside a page shows its first rows, then "Show all".
  const limited = (list: PageListItem[]) =>
    rowLimit && list.length > rowLimit ? list.slice(0, rowLimit) : list;
  const cutOff =
    !!rowLimit && (groups ? groups.some((g) => g.pages.length > rowLimit) : rows.length > rowLimit);

  const calcRow = (forPages: PageListItem[]) => (
    <CalcRow
      pages={forPages}
      keys={[TITLE_KEY, ...shown]}
      calcs={config.calcs}
      canArrange={canArrange}
      labelOf={labelOf}
      typeOf={typeOf}
      readValue={relations?.readValue}
      frozen={frozenKeys}
      formatOf={(k) => (defs.get(k)?.type === "number" ? readNumberFormat(defs.get(k)?.config) : undefined)}
      onPick={(k, calc) => {
        const calcs = { ...(config.calcs ?? {}) };
        if (calc) calcs[k] = calc;
        else delete calcs[k];
        onConfig({ ...config, calcs });
      }}
    />
  );

  const heading = (k: string) => (
    <PropHeading
      key={k}
      k={k}
      label={labelOf(k)}
      icon={k === TITLE_KEY ? "Aa" : kindIcon(typeOf(k))}
      frozen={frozenOf(frozenKeys, k)}
      description={String((defs.get(k) as { description?: string } | undefined)?.description ?? "")}
      sortDir={sortedKey === k ? (primary?.dir ?? null) : null}
      dragging={drag?.key === k}
      canArrange={canArrange}
      menu={(mctx) => headingMenu(k, mctx)}
      onPointerDownLabel={(e) => startHeadingDrag(e, k)}
      onResizeStart={(e) => startResize(e, k)}
      onResetWidth={() => onConfig(setWidth(config, k, null))}
      onNudgeWidth={(dx, commit) => {
        const grid = gridRef.current;
        const head = grid?.querySelector<HTMLElement>(`[data-prop-header="${CSS.escape(k)}"]`);
        const w = Math.round(head?.getBoundingClientRect().width ?? widthOf(config, k, typeOf(k)));
        if (commit) {
          if (nudged.current === k) onConfig(setWidth(config, k, w));
          nudged.current = null;
          return;
        }
        const px = Math.min(800, Math.max(60, w + dx));
        nudged.current = k;
        if (grid) grid.style.gridTemplateColumns = templateWith({ key: k, px });
      }}
      suppressClick={suppressClick}
    />
  );

  return (
    <div ref={wrapRef} className="relative overflow-x-auto" data-resizing={resizing ?? undefined}>
      <div
        ref={gridRef}
        role="table"
        className="relative grid text-row"
        style={{ gridTemplateColumns: template, minWidth: minTableWidth }}
        onClickCapture={onGridClickCapture}
      >
        <div className="contents" role="row">
          <div className={HEAD_CLASS + " justify-center" + frozenOf(frozenKeys, "").cls} style={{ ...HEAD_STYLE, ...frozenOf(frozenKeys, "").style }}>
            {selectable ? (
              <HeaderSelectAll
                state={selectAllState}
                count={rows.length}
                onClick={onHeaderCheckboxClick}
              />
            ) : null}
          </div>
          {heading(TITLE_KEY)}
          {shown.map(heading)}
          <div
            className={HEAD_CLASS + " sticky right-0 z-[1] justify-end bg-surface"}
            style={{ padding: "3px 0" }}
          >
            {canArrange && databaseId ? (
              <AddPropertyButton
                databaseId={databaseId}
                onCreated={(key) => onConfig({ ...config, props: showProp(shown, key) })}
                shownBuiltIns={shown.filter((k) => k.startsWith("@"))}
                iconOnly={phone}
              />
            ) : null}
            {canArrange && !phone ? (
              <PropertiesMenu
                shown={shown}
                allKeys={allKeys}
                labelOf={labelOf}
                typeOf={typeOf}
                onChange={(next) => onConfig({ ...config, props: next })}
              />
            ) : null}
          </div>
        </div>

        {groups
          ? groups.map((g) => {
              const id = g.value ?? NO_VALUE;
              const open = !collapsed.has(id);
              return (
                <GroupBlock
                  key={id}
                  label={
                    <GroupLabel
                      group={g}
                      def={groupKey ? defs.get(groupKey) : undefined}
                      groupKey={groupKey}
                      members={members}
                      labelOf={labelOf}
                    />
                  }
                  count={g.pages.length}
                  open={open}
                  onToggle={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                >
                  {open ? (
                    <>
                      {limited(g.pages).map(renderRow)}
                      {onNewRow ? <NewRowButton onAdd={() => addRow(g.value)} /> : null}
                      {calcRow(g.pages)}
                    </>
                  ) : null}
                </GroupBlock>
              );
            })
          : limited(rows).map(renderRow)}
        {rows.length === 0 ? (
          <div className="contents" role="row">
            <div
              role="cell"
              className="border-b border-lineSoft text-meta text-secondary"
              style={{ gridColumn: "1 / -1", padding: "18px 11px 18px 27px" }}
            >
              Nothing matches this view yet. Pages appear here the moment their properties match.
            </div>
          </div>
        ) : null}
        {!groups && onNewRow ? <NewRowButton onAdd={() => addRow(undefined)} /> : null}
        {!groups ? calcRow(rows) : null}
        {cutOff && onShowAll ? (
          <div className="contents" role="row">
            <div style={{ gridColumn: "1 / -1" }}>
              <button
                type="button"
                onClick={onShowAll}
                className="w-full text-left text-meta text-muted hover:bg-sunken hover:text-strong"
                style={{ padding: "7px 11px 7px 27px" }}
              >
                Show all {rows.length} pages
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {drag ? (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: drag.x - 1,
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--color-accent)",
          }}
        />
      ) : null}
    </div>
  );
}
