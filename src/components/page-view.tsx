import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import {
  useWorkspaceShell,
  usePage,
  usePageAccess,
} from "@/hooks/use-workspace-data";
import { Ico } from "./emoji-icon";
import { RelatedLinks } from "./related-links";
import { PlacedInRow } from "./placed-in-row";
import {
  useRenamePage,
  useSetPageIcon,
  useSetPageProperty,
  useBlocksSender,
  EditConflictError,
  SaveRejectedError,
  confirmedServerState,
  setConfirmedServerState,
  useVerifyPage,
  useArchivePage,
} from "@/hooks/use-page-mutations";

import { usePrefs } from "@/lib/preferences";
import { usePageAppearance } from "@/lib/page-appearance";
import { Popover } from "./popover";
import { EmojiPicker } from "./emoji-picker";
import {
  AreaPicker,
  OwnerPicker,
  SelectPicker,
  TagsPicker,
  DatePicker,
  NumberEditor,
  TextEditor,
  TypedValueEditor,
  CheckboxToggle,
} from "./property-pickers";
import { isPropSet, isTerminalStatus } from "@/lib/due-date";
import { summarizeProp } from "@/lib/prop-summary";
import { isTypedString, PROPERTY_KINDS, kindLabel, type PropertyType } from "@/lib/property-kinds";
import { useAddPropertyOption, useCreateProperty } from "@/hooks/use-property-mutations";
import { formatTimestamp } from "@/lib/format";

import { EditableBody, EditableTitle } from "./page-editor-body";
import { createBlocksSaver } from "@/lib/blocks-saver";
import { jsonEqual } from "@/lib/json-equal";
import { anyUnsaved, setSaveStatus } from "@/lib/save-status";
import { useToast } from "@/lib/toast";
import { qk } from "@/lib/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useDelayedPending } from "./sk";
import { PageSkeleton } from "./skeletons";
import {
  PermissionsPopoverHost,
  openPermissionsPopover,
} from "./permissions-popover";
import { RowMenu, type MenuRow, type MenuSpec } from "./row-menu";
import { PageHistoryHost } from "./page-history";
import { LinkedFrom } from "./linked-from";
import type { RestoredPage } from "@/hooks/use-page-history";
import { clearUndoStore } from "@/lib/undo-store";
import { normAccess, panelCopy } from "@/lib/share-panel";
import type { Block, PageAccessRow, PageFull, PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";


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

function propsOf(p: PageFull | PageListItem): Record<string, unknown> {
  const v = p.props;
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/* ────────────── relative time (page editor uses its own so preference is honoured) ────────────── */

let _dateMode: "relative" | "absolute" = "relative";
export function setDateModeForPageView(m: "relative" | "absolute") {
  _dateMode = m;
}
function relTime(iso: string): string {
  if (_dateMode === "absolute") return formatTimestamp(iso, "absolute");
  const now = Date.now();
  const t = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} week${w === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.floor(mo / 12);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

function firstName(full: string | null | undefined, email: string | null | undefined): string {
  if (full && full.trim()) return full.trim().split(/\s+/)[0];
  if (email) return email.split("@")[0];
  return "someone";
}

function Glyph({
  path,
  className,
  strokeWidth,
  style,
}: {
  path: string;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

/* ────────────── Permissions chip ────────────── */

function PermissionsChip({
  page,
  workspaceName,
  access,
  members,
}: {
  page: PageFull;
  workspaceName: string;
  access: PageAccessRow[];
  members: MemberRow[];
}) {
  const isWorkspace = page.access_type === "workspace";

  const memberInfo = useMemo(
    () =>
      members.map((m) => ({
        user_id: m.user_id,
        full_name: m.profiles?.full_name ?? null,
        email: m.profiles?.email ?? null,
        avatar_tint: m.profiles?.avatar_tint ?? null,
        avatar_ink: m.profiles?.avatar_ink ?? null,
      })),
    [members],
  );
  const areaLabel = useMemo(() => {
    const p = page.props as Record<string, unknown> | null;
    const v = p && typeof p === "object" ? (p as Record<string, unknown>)["area"] : null;
    return typeof v === "string" && v.trim() ? v : null;
  }, [page.props]);
  const norm = useMemo(
    () => normAccess(page as never, access, memberInfo),
    [page, access, memberInfo],
  );
  const label = useMemo(
    () => panelCopy(norm, workspaceName, members.length, areaLabel).chipLabel,
    [norm, workspaceName, members.length, areaLabel],
  );

  const path = isWorkspace
    ? "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"
    : "M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z";

  return (
    <button
      type="button"
      data-permissions-chip
      onClick={(e) => {
        openPermissionsPopover(
          (e.currentTarget as HTMLElement).getBoundingClientRect(),
        );
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-line text-meta text-secondary transition-colors hover:bg-rail"
      style={{
        height: 27,
        boxSizing: "border-box",
        padding: "0 11px",
        borderRadius: 999,
      }}
    >
      <Glyph path={path} className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

/* ────────────── Freshness helpers ────────────── */

function daysBetween(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
}

function staleLabel(iso: string): string {
  const d = daysBetween(iso);
  if (d >= 60) {
    const mo = Math.floor(d / 30);
    return `${mo} month${mo === 1 ? "" : "s"}`;
  }
  return `${d} day${d === 1 ? "" : "s"}`;
}


/* ────────────── Property strip (read-only, × removes non-system props) ────────────── */

const PROPS_ORDER_TOP = ["area", "owner", "status"];

function labelFor(key: string, defs: PropDef[]): string {
  const d = defs.find((x) => x.key === key);
  return d?.label ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/* Hash-to-six-pairs colouring (matches the table). */
const TAG_PAIRS: Array<{ tint: string; ink: string }> = [
  { tint: "greenTint", ink: "greenInk" },
  { tint: "blueTint", ink: "blueInk" },
  { tint: "amberTint", ink: "amberInk" },
  { tint: "violetTint", ink: "violetInk" },
  { tint: "pinkTint", ink: "pinkInk" },
  { tint: "sandTint", ink: "sandInk" },
];
function hashPair(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return TAG_PAIRS[Math.abs(h) % TAG_PAIRS.length];
}

function MiniAvatar({ profile }: { profile: MemberRow["profiles"] }) {
  const initials = (profile?.full_name || profile?.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: 19,
        height: 19,
        fontSize: 9.5,
        fontWeight: 700,
        lineHeight: 1,
        background: profile?.avatar_tint ?? "var(--color-sunken)",
        color: profile?.avatar_ink ?? "var(--color-noir)",
      }}
    >
      {initials}
    </span>
  );
}

/* Shared classes/styles for every editable value cell in the property
 * strip. The −7px margin-left is load-bearing: it pulls the value's
 * hover box out to the value column's true left edge so it aligns with
 * the strip's top hairline and never looks pinched against the label. */
const VALUE_CELL_CLASS =
  "gio-prop-value flex items-center rounded-md cursor-pointer text-left hover:bg-sunken";
const VALUE_CELL_STYLE: React.CSSProperties = {
  padding: "3px 7px",
  marginLeft: -7,
  minHeight: 24,
};

/* Empty-state copy varies per prop so an owner-less page reads
 * differently from a bare tag list. */
function emptyCopy(propKey: string, defType?: string): string {
  if (propKey === "owner" || defType === "person") return "Unassigned";
  if (defType === "multi_select") return "Empty — click to tag";
  return "Empty";
}
function EmptyValue({ propKey, defType }: { propKey: string; defType?: string }) {
  return (
    <span style={{ fontSize: 14, color: "var(--color-whisper)" }}>
      {emptyCopy(propKey, defType)}
    </span>
  );
}

/* Editable property row that opens the shared picker on click. Uses
 * the same popover components the table uses so the two experiences
 * are byte-identical.
 *
 * The row keeps its `bg-sunken` hover background while its own popover
 * is open — achieved by lifting the "is my popover open" flag up here
 * and mixing it with the hover flag in the caller. */

function EditableValue({
  propKey,
  page,
  def,
  members,
  pages,
  areas,
  onSet,
  onOpenChange,
}: {
  propKey: string;
  page: PageFull;
  def: PropDef | undefined;
  members: MemberRow[];
  pages: PageListItem[];
  areas: string[];
  onSet: (value: unknown) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const addOption = useAddPropertyOption();
  const raw = propsOf(page)[propKey];
  const empty = <EmptyValue propKey={propKey} defType={def?.type} />;
  const allTags = useMemo(() => {
    if (def?.type !== "multi_select") return [] as string[];
    const s = new Set<string>();
    for (const p of pages) {
      const t = propsOf(p)[propKey];
      if (Array.isArray(t)) t.forEach((x) => s.add(String(x)));
    }
    return [...s].sort();
  }, [pages, propKey, def?.type]);

  /* ── Area ── */
  if (propKey === "area") {
    const hasArea = typeof raw === "string" && raw;
    return (
      <AreaPicker
        value={typeof raw === "string" ? raw : null}
        areas={areas}
        onPick={onSet}
        onOpenChange={onOpenChange}
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className={VALUE_CELL_CLASS}
            style={VALUE_CELL_STYLE}
          >
            {hasArea ? (
              <span style={{ fontSize: 14, color: "var(--color-strong)" }}>
                {raw as string}
              </span>
            ) : (
              empty
            )}
          </button>
        )}
      />
    );
  }

  /* ── Owner / Person ── */
  if (propKey === "owner" || def?.type === "person") {
    const m = members.find((x) => x.user_id === raw);
    return (
      <OwnerPicker
        value={typeof raw === "string" ? raw : null}
        members={members}
        onPick={onSet}
        onOpenChange={onOpenChange}
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className={VALUE_CELL_CLASS + " min-w-0"}
            style={{ ...VALUE_CELL_STYLE, gap: 7 }}
          >
            {m ? (
              <>
                <MiniAvatar profile={m.profiles} />
                <span style={{ fontSize: 14, color: "var(--color-strong)" }}>
                  {m.profiles?.full_name ?? m.profiles?.email ?? "Unknown"}
                </span>
              </>
            ) : (
              empty
            )}
          </button>
        )}
      />
    );
  }

  /* ── Select / Status ── */
  if (def?.type === "select" || def?.type === "status") {
    const opts =
      (def.options as unknown as Array<{
        value: string;
        label: string;
        tint: string;
        ink: string;
      }>) ?? [];
    const cur = opts.find((o) => o.value === raw);
    return (
      <SelectPicker
        value={typeof raw === "string" ? raw : null}
        options={opts}
        onPick={onSet}
        onOpenChange={onOpenChange}
        // Team-made properties grow their own options; built-in ones keep
        // the list they were set up with.
        onCreate={
          def.is_system
            ? undefined
            : async (label) => {
                try {
                  const r = await addOption.mutateAsync({ id: def.id, label });
                  return r.value;
                } catch {
                  return null;
                }
              }
        }
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className={VALUE_CELL_CLASS}
            style={VALUE_CELL_STYLE}
          >
            {cur ? (
              <StatusChipInline
                label={cur.label}
                tint={cur.tint}
                ink={cur.ink}
                withDot={def.type === "status" || propKey === "stage"}
              />
            ) : (
              empty
            )}
          </button>
        )}
      />
    );
  }

  /* ── Multi-select / Tags ── */
  if (def?.type === "multi_select") {
    const tags = Array.isArray(raw) ? raw.map(String) : [];
    return (
      <TagsPicker
        value={tags}
        options={allTags}
        onSet={onSet}
        onOpenChange={onOpenChange}
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className={VALUE_CELL_CLASS + " flex-wrap"}
            style={{ ...VALUE_CELL_STYLE, gap: 5 }}
          >
            {tags.length === 0
              ? empty
              : tags.map((t) => {
                  const p = hashPair(t);
                  return (
                    <span
                      key={t}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 5,
                        fontSize: 12.5,
                        fontWeight: 400,
                        lineHeight: 1.2,
                        background: `var(--color-${p.tint})`,
                        color: `var(--color-${p.ink})`,
                      }}
                    >
                      {t}
                    </span>
                  );
                })}
          </button>
        )}
      />
    );
  }

  /* ── Checkbox ── (direct toggle, no popover). Shared with the table
   * cell so the tick, the accent colour and the "absent means false"
   * rule can never drift between the two sites. */
  if (def?.type === "checkbox") {
    return <CheckboxToggle value={raw} onSet={onSet} label={def.label} />;
  }

  /* ── Number ── */
  if (def?.type === "number") {
    return (
      <NumberEditor
        value={raw}
        onSet={onSet}
        onOpenChange={onOpenChange}
        emptyLabel={emptyCopy(propKey, def.type)}
        triggerClassName={VALUE_CELL_CLASS + " tnum"}
        triggerStyle={VALUE_CELL_STYLE}
      />
    );
  }

  /* ── Date ── overdue is judged against the page's own status: a
   * finished page is never late. */
  if (def?.type === "date") {
    return (
      <DatePicker
        value={raw}
        onSet={onSet}
        onOpenChange={onOpenChange}
        terminal={isTerminalStatus(propsOf(page)["status"])}
        emptyLabel={emptyCopy(propKey, def.type)}
        triggerClassName={VALUE_CELL_CLASS}
        triggerStyle={VALUE_CELL_STYLE}
      />
    );
  }

  /* ── Related links ── entries that do not resolve against the reader's
   * own visible page list render NOTHING here (see related-links.ts). */
  if (def?.type === "links") {
    return (
      <RelatedLinks
        value={raw}
        pages={pages}
        currentPageId={page.id}
        onSet={onSet}
        onOpenPage={(id) => navigate({ to: "/p/$pageId", params: { pageId: id } })}
        onOpenChange={onOpenChange}
      />
    );
  }

  /* ── Link / Email / Phone ── checked like the database, opens out. */
  if (isTypedString(def?.type)) {
    return (
      <TypedValueEditor
        type={def!.type as "url" | "email" | "phone"}
        value={raw}
        onSet={onSet}
        onOpenChange={onOpenChange}
        emptyLabel={emptyCopy(propKey, def?.type)}
        triggerClassName={VALUE_CELL_CLASS}
        triggerStyle={VALUE_CELL_STYLE}
      />
    );
  }

  /* ── Text / default ── */
  return (
    <TextEditor

      value={raw}
      onSet={onSet}
      onOpenChange={onOpenChange}
      emptyLabel={emptyCopy(propKey, def?.type)}
      triggerClassName={VALUE_CELL_CLASS + " w-full"}
      triggerStyle={VALUE_CELL_STYLE}
    />
  );
}


function StatusChipInline({
  label,
  tint,
  ink,
  withDot = true,
}: {
  label: string;
  tint: string;
  ink: string;
  withDot?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center"
      style={{
        padding: "2px 9px",
        borderRadius: 999,
        fontSize: 13.5,
        fontWeight: 700,
        lineHeight: 1.2,
        gap: 6,
        background: `var(--color-${tint})`,
        color: `var(--color-${ink})`,
      }}
    >
      {withDot ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: `var(--color-${ink})`,
          }}
        />
      ) : null}
      {label}
    </span>
  );
}

/* Per-property icons — attached to the registry entry (keyed by property
 * key), NOT derived at render time. Stage and Priority are both selects
 * but must not share an icon: Stage's values are an ordered pipeline
 * (Screen → Interview → Offer → Hired), so it gets the ascending
 * staircase; Priority's P0/P1/P2 is a pick from a set, so it keeps the
 * generic dot. Encoding that difference is the point of having icons. */
const PROP_ICON_BY_KEY: Record<string, string> = {
  stage: "M3.5 20h5v-4.5h5V11h5V6.5h2.5",
  priority: "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z",
  due: "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10.5h16M8.5 4v3M15.5 4v3",
  effort: "M5 9.5h14M5 15h14M10 4.5 8.5 20M15.5 4.5 14 20",
  reviewer:
    "M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.6v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2",
  confidential:
    "M5.5 4h13a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM8.4 12.2l2.6 2.6 4.6-5",
  notes: "M6 5h12M9.6 5v14M7.4 19h4.4",
  related:
    "M10.5 13.5a3.4 3.4 0 0 0 4.8 0l3-3a3.4 3.4 0 0 0-4.8-4.8l-1 1M13.5 10.5a3.4 3.4 0 0 0-4.8 0l-3 3a3.4 3.4 0 0 0 4.8 4.8l1-1",
};

const TYPE_LABEL: Record<string, string> = {
  select: "Select",
  status: "Status",
  multi_select: "Multi-select",
  date: "Date",
  number: "Number",
  person: "Person",
  checkbox: "Checkbox",
  text: "Text",
  links: "Links",
  url: "Link",
  email: "Email",
  phone: "Phone",
};

function AddPropertyPopover({
  propDefs,
  present,
  onAdd,
}: {
  propDefs: PropDef[];
  present: Set<string>;
  onAdd: (key: string, seed: unknown, focusAfter: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // null = the root list; otherwise a submenu swapped in place.
  const [sub, setSub] = useState<MenuSpec | null>(null);
  const createProperty = useCreateProperty();
  const candidates = propDefs
    .filter((d) => !present.has(d.key))
    .filter((d) => d.key !== "area" && d.key !== "owner");

  const seedFor = (t: string): unknown => {
    switch (t) {
      case "multi_select":
      case "links":
        return [];
      case "checkbox":
        return false;
      case "text":
        return "";
      default:
        return null;
    }
  };

  const close = () => {
    setAnchor(null);
    setSub(null);
  };

  // Step 2: name it. Creating adds it to the workspace and to this page.
  const nameSpec = (type: PropertyType): MenuSpec => ({
    title: `New ${kindLabel(type).toLowerCase()} property`,
    rows: [],
    onBack: () => setSub(typeSpec),
    footer: "Everyone in the workspace can use it. Only owners can archive it.",
    input: {
      placeholder: "Name it, then press Enter",
      onCommit: (label) => {
        createProperty.mutate(
          { label, type },
          { onSuccess: (def) => onAdd(def.key, seedFor(def.type), true) },
        );
      },
    },
  });

  // Step 1: pick a type.
  const typeSpec: MenuSpec = {
    title: "New property",
    onBack: () => setSub(null),
    rows: PROPERTY_KINDS.map((k) => ({
      kind: "row" as const,
      label: k.label,
      icon: k.icon,
      hint: { text: k.hint },
      onPick: () => setSub(nameSpec(k.type)),
    })),
  };

  const rows: MenuRow[] = candidates.map((d) => ({
    kind: "row" as const,
    label: d.label,
    icon:
      PROP_ICON_BY_KEY[d.key] ??
      // Fallback for unregistered keys: generic dot.
      "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z",
    hint: { text: TYPE_LABEL[d.type] ?? d.type },
    onPick: () => {
      onAdd(d.key, seedFor(d.type), true);
      close();
    },
  }));
  if (rows.length > 0) rows.push({ kind: "sep" });
  rows.push({
    kind: "row",
    label: "New property…",
    icon: "M12 5v14M5 12h14",
    onPick: () => setSub(typeSpec),
  });

  const spec: MenuSpec = sub ?? {
    title: `Add a property · ${candidates.length} left`,
    rows,
    footer:
      candidates.length === 0
        ? "Every property is already on this page. Make a new one for anything else."
        : "Adding one puts this page in every view that filters on it.",
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          setSub(null);
          setAnchor(e.currentTarget);
        }}
        className="gio-prop-add flex w-full items-center rounded-md text-left"
        style={{
          gap: 6,
          padding: "2px 6px",
          minHeight: 32,
          fontSize: 14,
          color: "var(--color-faint)",
        }}
      >
        <Glyph
          path="M12 5v14M5 12h14"
          className="h-[11px] w-[11px]"
          strokeWidth={2.4}
        />
        <span>Add a property</span>
      </button>
      {/* The trigger spans the full strip width, so the panel lines up with
          its LEFT edge — directly under the "Add a property" label. */}
      <RowMenu
        spec={anchor ? spec : null}
        anchor={anchor}
        align="start"
        onClose={close}
      />
    </>
  );
}


function PropertyStrip({
  page,
  propDefs,
  members,
  meId,
  pages,
  areas,
  staleDays,
  onVerify,
  justVerified,
  onSet,
}: {
  page: PageFull;
  propDefs: PropDef[];
  members: MemberRow[];
  meId: string;
  pages: PageListItem[];
  areas: string[];
  staleDays: number;
  onVerify: () => void;
  justVerified: boolean;
  onSet: (key: string, value: unknown) => void;
}) {
  const propsRec = propsOf(page);
  // null-is-absent: set_page_property stores an explicit null when a value
  // is cleared rather than dropping the key, so a cleared property must not
  // count as present — otherwise the strip keeps an unremovable empty row.
  const present = new Set(
    Object.keys(propsRec).filter((k) => isPropSet(propsRec[k])),
  );
  const byPos = [...propDefs].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  /* A freshly added property has no value yet, and `isPropSet` reads every
   * seed (null / "" / []) as absent — so the new row never appeared and
   * adding looked like it did nothing for every type except checkbox.
   * Session-local on purpose: added-but-never-filled is gone on reload,
   * which keeps null-is-absent the only persistence rule. */
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const shown = new Set(present);
  added.forEach((k) => shown.add(k));

  const rest = byPos
    .filter((d) => !PROPS_ORDER_TOP.includes(d.key))
    .filter((d) => shown.has(d.key));

  const rows = [
    ...PROPS_ORDER_TOP.map((k) => ({ key: k })),
    ...rest.map((d) => ({ key: d.key })),
  ];

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const verifiedByName = useMemo(() => {
    if (page.verified_by === meId) return "you";
    const m = members.find((x) => x.user_id === page.verified_by);
    return m?.profiles?.full_name || m?.profiles?.email || "you";
  }, [members, page.verified_by, meId]);

  const isStale = daysBetween(page.verified_at) > staleDays;

  /* Collapsible. Remembered per device for every page (a UI preference, not
   * data). Collapsed, the strip is one line: the filled values in order, and
   * the stale warning, which never hides — freshness is first-class. */
  const [collapsed, setCollapsed] = usePropsCollapsed();
  const [moving, setMoving] = useState(false);
  const bodyId = `props-${page.id}`;
  const summary = useMemo(() => {
    const nameOf = (id: string) => {
      const m = members.find((x) => x.user_id === id);
      return m ? firstName(m.profiles?.full_name, m.profiles?.email) : null;
    };
    const out: string[] = [];
    for (const r of rows) {
      const def = propDefs.find((d) => d.key === r.key);
      const text = summarizeProp(propsRec[r.key], def, labelFor(r.key, propDefs), nameOf);
      if (text) out.push(text);
    }
    return out.join(" · ");
    // rows/propsRec derive from page + propDefs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.props, propDefs, members, added]);

  /* Rhythm rule: rows ABUT (no gap between them) and each row is its own
   * min-height 32 box. The strip absorbs the old freshness banner's job,
   * so its top margin drops from 22 → 18. */
  return (
    <div
      style={{
        marginTop: 18,
        borderTop: "1px solid var(--color-line)",
        paddingTop: 6,
      }}
    >
      <div className="flex items-center" style={{ minHeight: 30, gap: 8, padding: "0 6px" }}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => {
            // Clip while the height moves; a timer backs up transitionend
            // (which never fires under reduced motion).
            setMoving(true);
            window.setTimeout(() => setMoving(false), 400);
            setCollapsed(!collapsed);
          }}
          className="flex shrink-0 items-center rounded-md text-faint hover:text-secondary"
          style={{ gap: 5, fontSize: 13, height: 26, padding: "0 4px", marginLeft: -4 }}
        >
          <Glyph
            path="M9 6l6 6-6 6"
            className="gio-props-chevron h-[11px] w-[11px]"
            strokeWidth={2.4}
            style={{ transform: collapsed ? "none" : "rotate(90deg)" }}
          />
          <span>{collapsed ? "Properties" : "Hide properties"}</span>
        </button>
        {collapsed ? (
          <span
            className="min-w-0 flex-1 truncate"
            style={{ fontSize: 13.5, color: "var(--color-secondary)" }}
            title={summary || undefined}
          >
            {summary || <span style={{ color: "var(--color-faint)" }}>No values yet</span>}
          </span>
        ) : null}
        {collapsed && isStale && !justVerified ? (
          <span className="flex shrink-0 items-center" style={{ gap: 8 }}>
            <Glyph
              path="M12 3l10 18H2L12 3zM12 10v5M12 18h.01"
              className="h-[13px] w-[13px] text-amberDot"
              strokeWidth={2}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-amberInk)" }}>
              May be stale
            </span>
            <button
              type="button"
              onClick={onVerify}
              style={{
                border: "1px solid var(--color-amberRing)",
                background: "var(--color-amberTint)",
                color: "var(--color-amberInk)",
                borderRadius: 7,
                padding: "2px 8px",
                fontSize: 12.5,
                fontWeight: 700,
              }}
            >
              Still accurate ✓
            </button>
          </span>
        ) : null}
      </div>

      {/* Height animates to the real content (grid rows 0fr → 1fr); the
          content is clipped only while closed or moving, so focus rings and
          the value cells' negative margins are never cut off at rest. */}
      <div
        id={bodyId}
        className="gio-expand"
        data-open={collapsed ? "false" : "true"}
        inert={collapsed}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget) setMoving(false);
        }}
      >
      <div style={{ minHeight: 0, overflow: collapsed || moving ? "hidden" : "visible" }}>
      {rows.map((r) => {
        const def = propDefs.find((d) => d.key === r.key);
        const removable =
          def && def.is_system === false && shown.has(r.key);
        const active = hoverKey === r.key || openKey === r.key;
        const showX = removable && active;
        const label = labelFor(r.key, propDefs);
        return (
          <div
            key={r.key}
            className="gio-prop-row rounded-md"
            style={{
              display: "grid",
              gridTemplateColumns: "132px 1fr",
              alignItems: "center",
              minHeight: 32,
              padding: "2px 6px",
              background: active ? "var(--color-track)" : undefined,
            }}
            onMouseEnter={() => setHoverKey(r.key)}
            onMouseLeave={() => setHoverKey(null)}
          >
            <div
              className="flex items-center"
              style={{
                gap: 6,
                fontSize: 14,
                color: "var(--color-muted)",
              }}
            >
              <span>{label}</span>
              {showX ? (
                <button
                  type="button"
                  title="Remove property"
                  aria-label={`Remove ${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAdded((prev) => {
                      if (!prev.has(r.key)) return prev;
                      const next = new Set(prev);
                      next.delete(r.key);
                      return next;
                    });
                    onSet(r.key, null);
                  }}
                  className="gio-prop-remove"
                  style={{
                    padding: 2,
                    fontSize: 12,
                    lineHeight: 1,
                    color: "var(--color-rule)",
                    background: "transparent",
                    border: 0,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="min-w-0">
              <EditableValue
                propKey={r.key}
                page={page}
                def={def}
                members={members}
                pages={pages}
                areas={areas}
                onSet={(v) => onSet(r.key, v)}
                onOpenChange={(open) =>
                  setOpenKey((prev) =>
                    open ? r.key : prev === r.key ? null : prev,
                  )
                }
              />
            </div>
          </div>
        );
      })}

      {/* Placed in — presentation over the STRUCTURAL column `parent_id`.
       * Deliberately not a property_defs row, so it never appears in
       * Add a property, TYPE_LABEL or seedFor. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "132px 1fr",
          alignItems: "center",
          minHeight: 32,
          padding: "2px 6px",
        }}
      >
        <div
          className="flex items-center"
          style={{ gap: 6, fontSize: 14, color: "var(--color-muted)" }}
        >
          Placed in
        </div>
        <PlacedInRow pageId={page.id} parentId={page.parent_id} />
      </div>

      {/* Verified — the freshness banner's job, folded into a strip row.
       * The label carries the verb ("Verified"); the value cell carries
       * the state (fresh / stale / just-verified). Value cell wraps on
       * narrow windows so the button never overflows. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "132px 1fr",
          alignItems: "center",
          minHeight: 32,
          padding: "2px 6px",
        }}
      >
        <div
          className="flex items-center"
          style={{ gap: 6, fontSize: 14, color: "var(--color-muted)" }}
        >
          Verified
        </div>
        <div
          className="min-w-0 flex items-center flex-wrap"
          style={{ gap: 8, padding: "3px 7px", marginLeft: -7 }}
        >
          {justVerified ? (
            <>
              <Glyph
                path="M5 12l5 5 9-11"
                className="h-[14px] w-[14px] text-accent"
                strokeWidth={2}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--color-accent)",
                }}
              >
                just now by you — thanks for keeping this fresh.
              </span>
            </>
          ) : isStale ? (
            <>
              <Glyph
                path="M12 3l10 18H2L12 3zM12 10v5M12 18h.01"
                className="h-[14px] w-[14px] text-amberDot"
                strokeWidth={2}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--color-amberInk)",
                }}
              >
                not in {staleLabel(page.verified_at)} — may be stale.
              </span>
              <button
                type="button"
                onClick={onVerify}
                style={{
                  border: "1px solid var(--color-amberRing)",
                  background: "var(--color-amberTint)",
                  color: "var(--color-amberInk)",
                  borderRadius: 7,
                  padding: "3px 9px",
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
              >
                Still accurate ✓
              </button>
            </>
          ) : (
            <>
              <Glyph
                path="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5L16 9.5"
                className="h-[14px] w-[14px] text-accent"
                strokeWidth={2}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 400,
                  color: "var(--color-secondary)",
                }}
              >
                {relTime(page.verified_at)} by {verifiedByName}
              </span>
              <button
                type="button"
                onClick={onVerify}
                className="hover:bg-sunken"
                style={{
                  border: "1px solid var(--color-lineStrong)",
                  background: "transparent",
                  color: "var(--color-secondary)",
                  borderRadius: 7,
                  padding: "3px 9px",
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
              >
                Still accurate ✓
              </button>
            </>
          )}
        </div>
      </div>


      <AddPropertyPopover
        propDefs={propDefs}
        present={shown}
        onAdd={(key, seed) => {
          setAdded((prev) => new Set(prev).add(key));
          onSet(key, seed);
        }}
      />
      </div>
      </div>
    </div>
  );
}

const PROPS_COLLAPSED_KEY = "gio.props.collapsed";
let propsCollapsedMemo: boolean | null = null;

/** Whether the property strip is collapsed — one choice for every page on
 *  this device. Storage can be missing or throw; then it's just this tab. */
function usePropsCollapsed(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    if (propsCollapsedMemo !== null) return propsCollapsedMemo;
    try {
      propsCollapsedMemo = localStorage.getItem(PROPS_COLLAPSED_KEY) === "1";
    } catch {
      propsCollapsedMemo = false;
    }
    return propsCollapsedMemo;
  });
  const set = useCallback((next: boolean) => {
    propsCollapsedMemo = next;
    setV(next);
    try {
      localStorage.setItem(PROPS_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* private mode: keep it for this tab */
    }
  }, []);
  return [v, set];
}

/* Read-only body renderer, its useFlashOnHash hook, and warnOnce lived
 * here in Part A; Part B replaces them with EditableBody which manages
 * its own state and focus. Anchor-scrolling to a specific block id is
 * a Part C follow-up. */



/* ────────────── Container ────────────── */

let saverSeq = 0;

export function PageEditor({ pageId }: { pageId: string }) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const pageQ = usePage(pageId);
  const accessQ = usePageAccess(pageId);
  const setProp = useSetPageProperty();
  const verify = useVerifyPage();
  const rename = useRenamePage();
  const sendBlocks = useBlocksSender();
  const queryClient = useQueryClient();
  const archive = useArchivePage();
  const setPageIcon = useSetPageIcon();

  const { prefs } = usePrefs();
  const { app } = usePageAppearance(pageId);
  useEffect(() => {
    setDateModeForPageView(prefs.dateFormat);
  }, [prefs.dateFormat]);

  const { user } = useAuth();
  const meId = user?.id ?? "";

  const [justVerified, setJustVerified] = useState(false);
  const justVerifiedTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (justVerifiedTimerRef.current)
        window.clearTimeout(justVerifiedTimerRef.current);
    },
    [],
  );

  const page = pageQ.data;
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const propDefs = (shell.propDefs.data ?? []) as PropDef[];
  const workspace = shell.workspace.data;
  const workspaceName = workspace?.name ?? "";
  const staleDays = workspace?.stale_days ?? 30;
  const access = accessQ.data ?? [];

  const editorName = useMemo(() => {
    if (!page) return "you";
    if (page.edited_by === meId) return "you";
    const m = members.find((x) => x.user_id === page.edited_by);
    return firstName(m?.profiles?.full_name, m?.profiles?.email);
  }, [members, page, meId]);

  const onVerify = () => {
    if (!page) return;
    verify.mutate(page.id);
    setJustVerified(true);
    if (justVerifiedTimerRef.current)
      window.clearTimeout(justVerifiedTimerRef.current);
    justVerifiedTimerRef.current = window.setTimeout(
      () => setJustVerified(false),
      2600,
    );
  };

  /* ────────── Title editing ────────── */
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleValue = titleDraft ?? page?.title ?? "";
  const titleTimerRef = useRef<number | null>(null);

  // A pending title save is sent, not dropped, when the page goes away or
  // the title loses focus.
  const pendingTitleRef = useRef<{ pageId: string; title: string } | null>(null);
  const renameRef = useRef(rename);
  renameRef.current = rename;
  const flushTitle = useCallback(() => {
    if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current);
    titleTimerRef.current = null;
    const pending = pendingTitleRef.current;
    pendingTitleRef.current = null;
    if (pending) renameRef.current.mutate(pending);
  }, []);
  useEffect(() => () => flushTitle(), [flushTitle]);

  // Focus title on freshly created page (via sessionStorage hint).
  const [titleAutoFocus, setTitleAutoFocus] = useState(false);
  useEffect(() => {
    if (!page) return;
    try {
      const want = sessionStorage.getItem("gio.focus-title");
      if (want && want === page.id) {
        setTitleAutoFocus(true);
        sessionStorage.removeItem("gio.focus-title");
      }
    } catch {
      /* storage unavailable */
    }
  }, [page]);

  const onTitleChange = useCallback(
    (v: string) => {
      setTitleDraft(v);
      if (!page) return;
      pendingTitleRef.current = { pageId: page.id, title: v };
      if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = window.setTimeout(flushTitle, 500);
    },
    [page, flushTitle],
  );

  const focusFirstBlock = useCallback(() => {
    flushTitle();
    // The body always renders at least one block. Prose blocks are
    // contenteditable; code blocks are textareas — take whichever is first.
    const el = document.querySelector<HTMLElement>(
      '#page-body [contenteditable="true"], #page-body textarea',
    );
    if (!el) return;
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      el.setSelectionRange(0, 0);
    } else {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  }, [flushTitle]);

  /* ────────── Body debounced save ──────────
   *
   * The saver owns the latest-value ref, saved-value ref, single-flight
   * guard, and follow-up dispatch. React only feeds it keystrokes and
   * triggers flushes. No React effect ever resets the saved marker
   * mid-mutation, so an optimistic cache patch cannot corrupt the diff. */
  const sendBlocksRef = useRef(sendBlocks);
  sendBlocksRef.current = sendBlocks;

  const saverRef = useRef<ReturnType<typeof createBlocksSaver<Block[]>> | null>(
    null,
  );
  const pageIdForSaver = page?.id;
  const locked = app.locked;
  // What the server has as far as this tab knows: its edited_at and blocks.
  const knownRef = useRef<{ editedAt: string | null; base: Block[] | null; attempts: Block[][]; force: boolean }>({
    editedAt: null,
    base: null,
    attempts: [],
    force: false,
  });
  const [conflict, setConflict] = useState<EditConflictError["server"] | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!pageIdForSaver) return;
    const known = knownRef.current;
    const owner = `saver-${++saverSeq}`;
    const saver = createBlocksSaver<Block[]>({
      debounceMs: 500,
      equals: jsonEqual,
      send: async (blocks) => {
        const guard = {
          editedAt: known.editedAt,
          base: known.base,
          attempts: [...known.attempts],
          force: known.force,
        };
        known.attempts.push(blocks);
        const row = await sendBlocksRef.current(pageIdForSaver, blocks, guard);
        known.force = false;
        known.editedAt = row.edited_at;
        known.base = blocks;
        known.attempts = [];
      },
      isFatal: (err) => err instanceof EditConflictError || err instanceof SaveRejectedError,
      onError: (err) => {
        if (err instanceof EditConflictError) setConflict(err.server);
        else if (err instanceof SaveRejectedError) toastRef.current.push(err.message);
      },
      onStatus: (st) => setSaveStatus(pageIdForSaver, st, owner),
    });
    saverRef.current = saver;
    const onOnline = () => saver.retryNow();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      if (saverRef.current === saver) saverRef.current = null;
      // Leaving the page never drops edits: flush, and if the server can't
      // be reached yet, keep retrying in the background until it can.
      const finish = () => {
        const lost = saver.status() === "stopped";
        saver.dispose();
        setSaveStatus(pageIdForSaver, "idle", owner);
        // A page you've left can't show the conflict banner any more, so
        // say plainly that its last edits didn't make it.
        if (lost) {
          toastRef.current.push(
            "Your last edits to a page you left weren't saved: it was changed somewhere else.",
          );
        }
      };
      void saver.flush().finally(() => {
        if (!saver.hasUnsaved() || saver.status() === "stopped") {
          finish();
          return;
        }
        const stop = window.setInterval(() => {
          if (!saver.hasUnsaved() || saver.status() === "stopped") {
            window.clearInterval(stop);
            finish();
          }
        }, 1000);
      });
    };
  }, [pageIdForSaver]);

  // Prime the saver and the edit guard from the server-known page on first
  // mount (and after "Load their version"), so no-op saves don't fire.
  const primedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!page || !saverRef.current) return;
    const key = `${page.id}:${editorKey}`;
    if (primedRef.current === key) return;
    primedRef.current = key;
    // Prefer what the server last confirmed: the cache may hold optimistic
    // edits that never reached it (offline), which are not a valid base.
    const conf = confirmedServerState(page.id);
    const serverBlocks = conf ? conf.blocks : ((Array.isArray(page.blocks) ? page.blocks : []) as Block[]);
    knownRef.current.editedAt = conf ? conf.editedAt : (page.edited_at ?? null);
    knownRef.current.base = serverBlocks;
    knownRef.current.attempts = [];
    saverRef.current.markSaved(serverBlocks);
  }, [page, editorKey]);

  // Save when the tab is hidden, and warn before closing it with edits the
  // server hasn't confirmed (an async save can't finish during unload).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        flushTitle();
        void saverRef.current?.flush();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flushTitle();
      void saverRef.current?.flush();
      if (anyUnsaved()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flushTitle]);

  // The conflict banner floats at the bottom edge. If it lands on the line
  // you're typing in, scroll that line up above it.
  const conflictRef = useRef<HTMLDivElement | null>(null);
  const hasConflict = !!conflict;
  useLayoutEffect(() => {
    const banner = conflictRef.current;
    if (!hasConflict || !banner) return;
    const sel = window.getSelection();
    const caretRect =
      sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const at = caretRect && caretRect.height > 0
      ? caretRect
      : (document.activeElement as HTMLElement | null)?.getBoundingClientRect();
    if (!at) return;
    const overlap = at.bottom + 12 - banner.getBoundingClientRect().top;
    if (overlap <= 0) return;
    let sc: HTMLElement | null = banner.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    (sc ?? document.scrollingElement)?.scrollBy({ top: overlap });
  }, [hasConflict]);

  const keepMine = useCallback(() => {
    if (!conflict) return;
    knownRef.current.force = true;
    setConflict(null);
    saverRef.current?.resume();
  }, [conflict]);

  const loadTheirs = useCallback(() => {
    if (!conflict || !page) return;
    queryClient.setQueryData<PageFull | null>(qk.page(page.id), (prev) =>
      prev
        ? {
            ...prev,
            blocks: conflict.blocks as unknown as PageFull["blocks"],
            edited_at: conflict.edited_at,
            edited_by: conflict.edited_by,
          }
        : prev,
    );
    knownRef.current.editedAt = conflict.edited_at;
    knownRef.current.base = conflict.blocks;
    knownRef.current.attempts = [];
    setConfirmedServerState(page.id, conflict.edited_at, conflict.blocks);
    // Adopt their blocks as the saved value; nothing of ours is sent.
    saverRef.current?.reset(conflict.blocks);
    setConflict(null);
    setEditorKey((k) => k + 1);
  }, [conflict, page, queryClient]);

  /* Page history (page-history.tsx). Before a restore: send what's still
   * waiting, so the database saves it as a version and Undo brings it back.
   * After: load the restored content the same way "Load their version" does. */
  const prepareRestore = useCallback(async (): Promise<string | null> => {
    if (conflict) {
      return "This page has an edit conflict. Choose Keep mine or Load their version first.";
    }
    if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current);
    titleTimerRef.current = null;
    const pendingTitle = pendingTitleRef.current;
    pendingTitleRef.current = null;
    if (pendingTitle) {
      try {
        await renameRef.current.mutateAsync(pendingTitle);
      } catch {
        return "Your title change hasn't saved yet. Try again once the page says Saved.";
      }
    }
    const saver = saverRef.current;
    if (saver) {
      await saver.flush();
      if (saver.hasUnsaved()) {
        return "Your latest edits haven't saved yet, so restoring now would lose them. Try again once the page says Saved.";
      }
    }
    return null;
  }, [conflict]);

  const adoptRestored = useCallback(
    (row: RestoredPage) => {
      if (!page) return;
      queryClient.setQueryData<PageFull | null>(qk.page(page.id), (prev) =>
        prev
          ? {
              ...prev,
              title: row.title,
              icon: row.icon ?? prev.icon,
              blocks: row.blocks as unknown as PageFull["blocks"],
              edited_at: row.edited_at,
              edited_by: row.edited_by,
            }
          : prev,
      );
      // Mutate, don't replace: the saver holds this object.
      const known = knownRef.current;
      known.editedAt = row.edited_at;
      known.base = row.blocks;
      known.attempts = [];
      known.force = false;
      setConfirmedServerState(page.id, row.edited_at, row.blocks);
      saverRef.current?.reset(row.blocks);
      // The editor's undo steps belong to the content that was replaced.
      clearUndoStore(page.id);
      setTitleDraft(null);
      setConflict(null);
      setEditorKey((k) => k + 1);
    },
    [page, queryClient],
  );

  const onBlocksChange = useCallback(
    (blocks: Block[]) => {
      if (locked) return;
      saverRef.current?.set(blocks);
    },
    [locked],
  );

  const onBodyBlur = useCallback(() => {
    void saverRef.current?.flush();
  }, []);

  const areasList = useMemo(() => {
    const s = new Set<string>();
    for (const p of (shell.pages.data ?? []) as PageListItem[]) {
      const a = propsOf(p)["area"];
      if (typeof a === "string" && a) s.add(a);
    }
    return [...s].sort();
  }, [shell.pages.data]);

  const pagePending = pageQ.isPending && !pageQ.data;
  const showPageSkeleton = useDelayedPending(pagePending);
  if (pagePending) {
    return showPageSkeleton ? <PageSkeleton /> : null;
  }

  if (!page) {
    return (
      <div
        className="mx-auto"
        style={{ maxWidth: 780, padding: "42px 44px" }}
      >
        <h1 className="font-display text-title text-noir">Page not found</h1>
        <p className="mt-2 text-meta text-muted">
          It may have been deleted, or you don't have access.
        </p>
      </div>
    );
  }

  const blocks = Array.isArray(page.blocks) ? (page.blocks as unknown[]) : [];

  return (
    <div
      className="gio-page mx-auto"
      data-font={app.font}
      data-small={app.small ? "1" : "0"}
      data-wide={app.wide ? "1" : "0"}
      data-locked={app.locked ? "1" : "0"}
      style={{ maxWidth: 780, padding: "42px 44px" }}
    >
      {/* 1+2. Title row: emoji + editable title, side-by-side, height 51. */}
      <div
        // minHeight, not height: a title that wraps to a second line grows
        // the row instead of spilling over the permissions row below it.
        // Top-aligned (offsets keep the single-line layout exactly as it
        // was) so the icon sits beside the first line of a long title.
        style={{ display: "flex", alignItems: "flex-start", minHeight: 51, gap: 13 }}
      >
        <Popover
          width={264}
          trigger={({ open, onClick, ref }) => (
            <button
              ref={ref}
              type="button"
              onClick={onClick}
              aria-label="Change page icon"
              aria-expanded={open}
              className="grid select-none place-items-center rounded-md hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{ width: 42, height: 42, fontSize: 34, lineHeight: 1, flex: "none", marginTop: 4.5 }}
            >
              <Ico icon={page.icon || "📄"} size={34} />
            </button>
          )}
        >
          {(close) => (
            <EmojiPicker
              onPick={(e) => {
                if (e) setPageIcon.mutate({ pageId: page.id, icon: e });
                close();
              }}
            />
          )}
        </Popover>

        <div className="min-w-0 flex-1" style={{ paddingTop: 3.5 }}>
          <EditableTitle
            value={titleValue}
            onChange={onTitleChange}
            onEnter={focusFirstBlock}
            autoFocus={titleAutoFocus}
            topMarginClass=""
            readOnly={app.locked}
          />
        </div>
      </div>

      {/* 3. Permissions chip · edited stamp. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PermissionsChip
          page={page}
          workspaceName={workspaceName}
          access={access}
          members={members}
        />
        <span className="text-rule">·</span>
        <span className="text-meta text-muted">
          Edited {relTime(page.edited_at)} · {editorName}
        </span>
      </div>

      {/* 4a. Archived banner — shows on the page's own route only. */}
      {page.archived_at ? (
        <div
          className="mt-4 flex w-full items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-row"
          style={{ borderRadius: 10 }}
        >
          <Glyph
            path="M4 7h16M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7M9 11h6M4 4h16v3H4z"
            className="h-4 w-4 text-muted"
          />
          <span className="text-body">
            This page is archived — it appears in search but in no views.
          </span>
          <button
            type="button"
            onClick={() =>
              archive.mutate({ pageId: page.id, archived: false })
            }
            className="ml-auto rounded-md border border-line bg-surface px-3 text-meta text-body hover:bg-rail"
            style={{ height: 28 }}
          >
            Unarchive
          </button>
        </div>
      ) : null}

      {/* 4. Properties strip — the Verified control lives inside it now.
       * The strip owns its own top hairline; margin-top absorbs the old
       * banner's job (18px instead of 22px). */}
      <PropertyStrip
        page={page}
        propDefs={propDefs}
        members={members}
        meId={meId}
        pages={(shell.pages.data ?? []) as PageListItem[]}
        areas={areasList}
        staleDays={staleDays}
        onVerify={onVerify}
        justVerified={justVerified}
        onSet={(key, value) => {
          if (key === "icon") {
            if (typeof value === "string" && value)
              setPageIcon.mutate({ pageId: page.id, icon: value });
            return;
          }
          setProp.mutate({ pageId: page.id, key, value });
        }}
      />

      {/* 6. Body divider — a matching bracket to the strip's top rule:
       * 22px from the strip's last row, hairline var(--color-line), then
       * 8px padding before the body. */}
      <div
        id="page-body"
        style={{
          marginTop: 22,
          borderTop: "1px solid var(--color-line)",
          paddingTop: 8,
        }}
      >

        <EditableBody
          key={editorKey}
          pageId={page.id}
          initialBlocks={blocks}
          onChange={onBlocksChange}
          onBlur={onBodyBlur}
          locked={app.locked}
          editedRel={page.edited_at ? relTime(page.edited_at) : null}
          editorFirstName={editorName}
        />
        {conflict ? (
          // After the last block, sticky to the bottom of the window: on a
          // long page it floats at the bottom edge where you can reach it;
          // on a short one it sits under the last line. Nothing above moves.
          <div
            ref={conflictRef}
            role="alert"
            className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amberRing bg-amberTint px-3 py-2 text-row text-amberInk shadow-toast animate-cardIn"
            style={{ position: "sticky", bottom: 16, zIndex: 30 }}
          >
            <span className="min-w-0 flex-1">
              Someone else changed this page while you were editing. Your latest edits aren't saved yet.
            </span>
            <button
              type="button"
              onClick={loadTheirs}
              className="rounded-md border border-line bg-surface px-3 text-meta text-body hover:bg-rail"
              style={{ height: 28 }}
            >
              Load their version
            </button>
            <button
              type="button"
              onClick={keepMine}
              className="rounded-md bg-btn px-3 text-meta text-btnFg"
              style={{ height: 28 }}
            >
              Keep mine
            </button>
          </div>
        ) : null}
      </div>
      <LinkedFrom pageId={page.id} />
      <PageHistoryHost
        page={page}
        members={members}
        meId={meId}
        canEdit={
          page.access_type === "workspace"
            ? page.ws_role !== "view"
            : access.some((a) => a.user_id === meId && a.capability === "write")
        }
        prepare={prepareRestore}
        adopt={adoptRestored}
      />
      <PermissionsPopoverHost
        page={page}
        workspaceName={workspaceName}
        members={members}
        isOwner={members.some(
          (m) => m.user_id === meId && m.role === "owner",
        )}
      />
    </div>
  );
}


