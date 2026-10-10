import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { pageQuery } from "@/hooks/use-workspace-data";
import { useSetPageOrigin } from "@/lib/page-origin";
import { useAddPropertyOption } from "@/hooks/use-property-mutations";
import type { useRenamePage, useSetPageProperty } from "@/hooks/use-page-mutations";
import { isTerminalStatus } from "@/lib/due-date";
import { isTypedString, PROPERTY_KINDS } from "@/lib/property-kinds";
import { relList, relResolve } from "@/lib/related-links";
import { sortProp, type SortSpec } from "@/lib/run-view";
import { viewTime } from "@/lib/view-time";
import {
  TITLE_KEY,
  allPropKeys,
  hideProp,
  labelOfProp,
  moveProp,
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
import { RowMenu, SpecMenuTrigger, type MenuRow, type MenuSpec } from "./row-menu";
import { RelatedLinks } from "./related-links";
import {
  AreaPicker,
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

function PageTitleCell({ page, onSave }: { page: PageListItem; onSave: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(page.title ?? "");
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
  onPick,
}: {
  value: unknown;
  members: TableMember[];
  emptyLabel: string;
  onPick: (userId: string | null) => void;
}) {
  const current = members.find((m) => m.user_id === value);
  return (
    <OwnerPicker
      value={typeof value === "string" ? value : null}
      members={members}
      onPick={onPick}
      emptyLabel={emptyLabel}
      trigger={({ onClick, ref }) => (
        <button ref={ref} type="button" onClick={onClick} className="flex min-w-0 flex-1 text-left">
          {current ? <PersonView member={current} /> : <span className="text-faint">—</span>}
        </button>
      )}
    />
  );
}

function AreaCell({
  value,
  areas,
  onPick,
}: {
  value: unknown;
  areas: string[];
  onPick: (v: string | null) => void;
}) {
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
          className="min-w-0 flex-1 truncate text-left text-meta"
        >
          {typeof value === "string" && value ? value : EMPTY}
        </button>
      )}
    />
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

type CellCtx = {
  defs: ReadonlyMap<string, PropDef>;
  members: TableMember[];
  areas: string[];
  multiOptions: ReadonlyMap<string, string[]>;
  linkPages: PageListItem[];
  isStale: boolean;
  setProp: SetPropFn;
};

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
    case "area":
      return <AreaCell value={propsOf(page).area} areas={ctx.areas} onPick={set} />;
  }
  const def = ctx.defs.get(k);
  if (!def) return EMPTY;
  const raw = propsOf(page)[k];
  switch (def.type) {
    case "person":
      return (
        <PersonCell
          value={raw}
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
    case "number":
      return (
        <NumberEditor value={raw} onSet={set} variant="cell" triggerClassName="tnum text-left" />
      );
    case "date":
      return (
        <DatePicker
          value={raw}
          onSet={set}
          variant="cell"
          terminal={isTerminalStatus(propsOf(page).status)}
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

const TableRow = memo(function TableRow({
  p,
  shown,
  ctx,
  rename,
  selected,
  anySelection,
  onCheckboxClick,
  buildMenu,
}: {
  p: PageListItem;
  shown: string[];
  ctx: CellCtx;
  rename: RenameFn;
  selected: boolean;
  anySelection: boolean;
  onCheckboxClick: (id: string, shift: boolean) => void;
  buildMenu: MenuBuild;
}) {
  return (
    <div className="contents group" role="row">
      <div data-page-id={p.id} className={cellClass(selected, true)}>
        <RowCheckbox
          checked={selected}
          alwaysVisible={anySelection}
          onClick={(shift) => onCheckboxClick(p.id, shift)}
        />
      </div>
      <div data-page-id={p.id} role="cell" className={cellClass(selected)}>
        <PageTitleCell page={p} onSave={(t) => rename({ pageId: p.id, title: t })} />
      </div>
      {shown.map((k) => (
        <div key={k} data-page-id={p.id} data-prop={k} role="cell" className={cellClass(selected)}>
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
          build={buildMenu}
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

const HEAD_CLASS =
  "relative flex items-center border-b border-line bg-canvas text-label uppercase text-faint";
const HEAD_STYLE = { padding: "12px 0 6px", lineHeight: "11px" } as const;

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
}: {
  k: string;
  label: string;
  sortDir: "asc" | "desc" | null;
  dragging: boolean;
  canArrange: boolean;
  menu: () => MenuSpec;
  onPointerDownLabel: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onResetWidth: () => void;
  onNudgeWidth: (dx: number) => void;
  suppressClick: React.MutableRefObject<boolean>;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [spec, setSpec] = useState<MenuSpec | null>(null);
  return (
    <div
      role="columnheader"
      aria-sort={sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : undefined}
      data-prop-header={k}
      className={HEAD_CLASS}
      style={{ ...HEAD_STYLE, opacity: dragging ? 0.45 : 1 }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left uppercase hover:text-muted"
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
          // Every choice in a heading's menu is final: pick, then close.
          const m = menu();
          setSpec({
            ...m,
            rows: m.rows.map((r) =>
              r.kind === "row"
                ? {
                    ...r,
                    onPick: () => {
                      r.onPick();
                      setAnchor(null);
                      setSpec(null);
                    },
                  }
                : r,
            ),
          });
          setAnchor(e.currentTarget);
        }}
        aria-haspopup="menu"
      >
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
              onNudgeWidth(e.key === "ArrowLeft" ? -16 : 16);
            }
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
          <div className="flex items-center" style={{ padding: "6px 8px 4px 10px", gap: 6 }}>
            <span className="flex-1 text-label uppercase text-faint">Properties</span>
            <button
              type="button"
              onClick={() => onChange(hidden.length ? allKeys : [])}
              className="rounded-md px-2 text-meta text-muted hover:bg-sunken hover:text-strong"
              style={{ height: 24 }}
            >
              {hidden.length ? "Show all" : "Hide all"}
            </button>
          </div>
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
                className="flex w-full items-center rounded-md text-left hover:bg-rail"
                style={{ gap: 9, padding: "6px 10px", fontSize: 14 }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width={15}
                  height={15}
                  aria-hidden
                  fill="none"
                  className="shrink-0 text-faint"
                >
                  {icon ? (
                    <path
                      d={icon}
                      stroke="currentColor"
                      strokeWidth={1.9}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                </svg>
                <span className={`min-w-0 flex-1 truncate ${on ? "text-strong" : "text-muted"}`}>
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
                    transition: "background-color 150ms var(--ease-out)",
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

/* ─────────────────────────── Table ─────────────────────────── */

export function ViewTable({
  rows,
  pages,
  members,
  areas,
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
}: {
  rows: PageListItem[];
  pages: PageListItem[];
  members: TableMember[];
  areas: string[];
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
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
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
  const typeOf = (k: string) => typeOfProp(k, propDefs);

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
  const stableAreas = useStable(areas, areas.join("\u0000"));
  const hasLinks = shown.some((k) => defs.get(k)?.type === "links");
  const linkPages = hasLinks ? pages : EMPTY_PAGES;
  const setPropMutate = setProp.mutate;
  const renameMutate = rename.mutate;

  const ctxFresh = useMemo(
    () => ({ defs, members, areas: stableAreas, multiOptions, linkPages, setProp: setPropMutate }),
    [defs, members, stableAreas, multiOptions, linkPages, setPropMutate],
  );
  // One ctx object per staleness, so memoised rows keep their props.
  const ctxStale = useMemo(() => ({ ...ctxFresh, isStale: true }), [ctxFresh]);
  const ctxOk = useMemo(() => ({ ...ctxFresh, isStale: false }), [ctxFresh]);

  const tracks = [TITLE_KEY, ...shown].map((k) => ({ k, ...trackOf(config, k, typeOf(k)) }));
  const allFixed = tracks.every((t) => t.fixed);
  // The ⋯ track takes what's left only when every property has a set width.
  const endTrack = allFixed ? "minmax(40px, 1fr)" : "40px";
  const minTableWidth = 16 + 40 + tracks.reduce((n, t) => n + t.min, 0);
  const templateWith = (override?: { key: string; px: number }) =>
    [
      "16px",
      ...tracks.map((t) => (override && override.key === t.k ? `${override.px}px` : t.css)),
      endTrack,
    ].join(" ");

  const primary = sorts[0];
  const sortedKey = primary ? keyOfSortName(primary.prop) : null;

  const headingMenu = (k: string): MenuSpec => {
    const rowsOut: MenuRow[] = [
      {
        kind: "row",
        label: "Sort ascending",
        icon: IC.chevUp,
        checked: sortedKey === k && primary?.dir === "asc",
        onPick: () => onSort({ prop: sortNameOf(k), dir: "asc" }),
      },
      {
        kind: "row",
        label: "Sort descending",
        icon: IC.chevDown,
        checked: sortedKey === k && primary?.dir === "desc",
        onPick: () => onSort({ prop: sortNameOf(k), dir: "desc" }),
      },
    ];
    if (canArrange && k !== TITLE_KEY) {
      const i = shown.indexOf(k);
      rowsOut.push({ kind: "sep" });
      if (i > 0)
        rowsOut.push({
          kind: "row",
          label: "Move left",
          icon: "m15 18-6-6 6-6",
          onPick: () => onConfig({ ...config, props: moveProp(shown, k, i - 1) }),
        });
      if (i < shown.length - 1)
        rowsOut.push({
          kind: "row",
          label: "Move right",
          icon: IC.open,
          onPick: () => onConfig({ ...config, props: moveProp(shown, k, i + 1) }),
        });
      rowsOut.push({
        kind: "row",
        label: "Hide in this view",
        icon: IC.eyeOff,
        onPick: () => onConfig({ ...config, props: hideProp(shown, k) }),
      });
    }
    if (canArrange && config.widths?.[k] !== undefined) {
      rowsOut.push({
        kind: "row",
        label: "Reset width",
        icon: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
        onPick: () => onConfig(setWidth(config, k, null)),
      });
    }
    return { title: labelOf(k), rows: rowsOut, width: 220 };
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
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setResizing(null);
      if (px !== startW) onConfig(setWidth(config, k, px));
      else grid.style.gridTemplateColumns = templateWith();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  // React owns the template again after every render (a saved width, a
  // reset, a shown/hidden property).
  const template = templateWith();
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

  const heading = (k: string) => (
    <PropHeading
      key={k}
      k={k}
      label={labelOf(k)}
      sortDir={sortedKey === k ? (primary?.dir ?? null) : null}
      dragging={drag?.key === k}
      canArrange={canArrange}
      menu={() => headingMenu(k)}
      onPointerDownLabel={(e) => startHeadingDrag(e, k)}
      onResizeStart={(e) => startResize(e, k)}
      onResetWidth={() => onConfig(setWidth(config, k, null))}
      onNudgeWidth={(dx) => {
        const head = gridRef.current?.querySelector<HTMLElement>(
          `[data-prop-header="${CSS.escape(k)}"]`,
        );
        const w = head?.getBoundingClientRect().width ?? widthOf(config, k, typeOf(k));
        onConfig(setWidth(config, k, Math.round(w) + dx));
      }}
      suppressClick={suppressClick}
    />
  );

  return (
    <div ref={wrapRef} className="relative overflow-x-auto" data-resizing={resizing ?? undefined}>
      <div
        ref={gridRef}
        role="table"
        className="grid text-row"
        style={{ gridTemplateColumns: template, minWidth: minTableWidth }}
        onClickCapture={onGridClickCapture}
      >
        <div className="contents" role="row">
          <div className={HEAD_CLASS + " justify-center"} style={HEAD_STYLE}>
            <HeaderSelectAll
              state={selectAllState}
              count={rows.length}
              onClick={onHeaderCheckboxClick}
            />
          </div>
          {heading(TITLE_KEY)}
          {shown.map(heading)}
          <div
            className={HEAD_CLASS + " sticky right-0 z-[1] justify-end"}
            style={{ padding: "6px 0 2px" }}
          >
            {canArrange ? (
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

        {rows.map((p) => {
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
              buildMenu={getPageMenuBuild(p)}
            />
          );
        })}
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
