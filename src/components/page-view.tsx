import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import {
  useWorkspaceShell,
  usePage,
  usePageAccess,
} from "@/hooks/use-workspace-data";
import {
  useRenamePage,
  useSetPageIcon,
  useSetPageProperty,
  useUpdateBlocks,
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
} from "./property-pickers";
import { formatTimestamp } from "@/lib/format";
import { EditableBody, EditableTitle } from "./page-editor-body";
import { createBlocksSaver } from "@/lib/blocks-saver";
import { useDelayedPending } from "./sk";
import { PageSkeleton } from "./skeletons";
import {
  PermissionsPopoverHost,
  openPermissionsPopover,
} from "./permissions-popover";
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
}: {
  path: string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
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

/* ────────────── Freshness row ────────────── */

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

function FreshnessRow({
  page,
  members,
  meId,
  staleDays,
  onVerify,
  justVerified,
}: {
  page: PageFull;
  members: MemberRow[];
  meId: string;
  staleDays: number;
  onVerify: () => void;
  justVerified: boolean;
}) {
  const verifiedByName = useMemo(() => {
    if (page.verified_by === meId) return "you";
    const m = members.find((x) => x.user_id === page.verified_by);
    return m?.profiles?.full_name || m?.profiles?.email || "you";
  }, [members, page.verified_by, meId]);

  const isStale = daysBetween(page.verified_at) > staleDays;

  if (justVerified) {
    return (
      <div
        className="flex w-full items-center rounded-lg border border-accentRing bg-accentTint text-row"
        style={{ borderRadius: 10, padding: "12px 13px", gap: 10 }}
      >
        <Glyph path="M5 12l5 5 9-11" className="h-4 w-4 text-accent" />
        <span className="font-bold text-accent">
          Verified just now by you — thanks for keeping this fresh.
        </span>
      </div>
    );
  }

  if (isStale) {
    return (
      <div
        className="flex w-full items-center rounded-lg border border-amberRing bg-amberTint text-row"
        style={{ borderRadius: 10, padding: "12px 13px", gap: 10 }}
      >
        <Glyph
          path="M12 3l10 18H2L12 3zM12 10v5M12 18h.01"
          className="h-4 w-4 text-amberInk"
        />
        <span className="font-bold text-amberInk">
          Not verified in {staleLabel(page.verified_at)} — may be stale.
        </span>
        <button
          type="button"
          onClick={onVerify}
          className="ml-auto rounded-md border border-line bg-surface px-3 text-meta text-amberInk hover:bg-amberTint"
          style={{ height: 24 }}
        >
          Still accurate ✓
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex w-full items-center rounded-lg border border-line bg-track text-row"
      style={{ borderRadius: 10, padding: "12px 13px", gap: 10 }}
    >
      <Glyph
        path="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5L16 9.5"
        className="h-4 w-4 text-accent"
      />
      <span className="text-body">
        Verified {relTime(page.verified_at)} by {verifiedByName}
      </span>
      <button
        type="button"
        onClick={onVerify}
        className="ml-auto rounded-md border border-line bg-surface px-3 text-meta text-body hover:bg-rail"
        style={{ height: 24 }}
      >
        Still accurate ✓
      </button>
    </div>
  );
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

  /* ── Checkbox ── (direct toggle, no popover). Uses a native input so
   * accent-color themes the tick without a custom glyph. */
  if (def?.type === "checkbox") {
    const on = !!raw;
    return (
      <label
        className={VALUE_CELL_CLASS}
        style={VALUE_CELL_STYLE}
        aria-label={def.label}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onSet(e.currentTarget.checked)}
          style={{
            width: 15,
            height: 15,
            margin: 0,
            accentColor: "var(--color-accent)",
            cursor: "pointer",
          }}
        />
      </label>
    );
  }

  /* ── Number ── */
  if (def?.type === "number") {
    return (
      <NumberInline
        value={typeof raw === "number" ? raw : null}
        onSet={onSet}
        onOpenChange={onOpenChange}
        propKey={propKey}
        defType={def?.type}
      />
    );
  }

  /* ── Date ── */
  if (def?.type === "date") {
    return (
      <DateInline
        value={typeof raw === "string" ? raw : null}
        onSet={onSet}
        onOpenChange={onOpenChange}
        propKey={propKey}
        defType={def?.type}
      />
    );
  }

  /* ── Text / default ── */
  return (
    <TextInline
      value={typeof raw === "string" ? raw : ""}
      onSet={onSet}
      propKey={propKey}
      defType={def?.type}
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

function NumberInline({
  value,
  onSet,
  onOpenChange,
  propKey,
  defType,
}: {
  value: number | null;
  onSet: (v: number | null) => void;
  onOpenChange: (open: boolean) => void;
  propKey: string;
  defType?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value === null ? "" : String(value));
  useEffect(() => {
    onOpenChange(editing);
  }, [editing, onOpenChange]);
  useEffect(() => {
    if (!editing) setDraft(value === null ? "" : String(value));
  }, [value, editing]);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={VALUE_CELL_CLASS + " tnum"}
        style={VALUE_CELL_STYLE}
      >
        {value === null ? (
          <EmptyValue propKey={propKey} defType={defType} />
        ) : (
          <span style={{ fontSize: 14, color: "var(--color-strong)" }}>{value}</span>
        )}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(value === null ? "" : String(value));
          setEditing(false);
        }
      }}
      onBlur={() => {
        const t = draft.trim();
        if (t === "") {
          onSet(null);
        } else {
          const n = Number(t);
          if (!Number.isNaN(n)) onSet(n);
        }
        setEditing(false);
      }}
      inputMode="decimal"
      className="w-full rounded-sm border border-line bg-surface px-2 py-0.5 text-meta tnum"
    />
  );
}

function DateInline({
  value,
  onSet,
  onOpenChange,
  propKey,
  defType,
}: {
  value: string | null;
  onSet: (v: string | null) => void;
  onOpenChange: (open: boolean) => void;
  propKey: string;
  defType?: string;
}) {
  const label =
    value && !isNaN(new Date(value).getTime())
      ? new Date(value).toLocaleDateString()
      : null;
  return (
    <Popover
      width={220}
      onOpenChange={onOpenChange}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className={VALUE_CELL_CLASS}
          style={VALUE_CELL_STYLE}
        >
          {label ? (
            <span style={{ fontSize: 14, color: "var(--color-strong)" }}>{label}</span>
          ) : (
            <EmptyValue propKey={propKey} defType={defType} />
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-1 p-1">
          <input
            type="date"
            defaultValue={value ?? ""}
            onChange={(e) => {
              onSet(e.target.value || null);
              close();
            }}
            className="rounded-sm border border-line bg-surface px-2 py-1 text-meta"
          />
          {value ? (
            <button
              type="button"
              className="rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-rail"
              onClick={() => {
                onSet(null);
                close();
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

function TextInline({
  value,
  onSet,
  propKey,
  defType,
}: {
  value: string;
  onSet: (v: string) => void;
  propKey: string;
  defType?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={VALUE_CELL_CLASS + " w-full"}
        style={VALUE_CELL_STYLE}
      >
        {value ? (
          <span style={{ fontSize: 14, color: "var(--color-strong)" }}>{value}</span>
        ) : (
          <EmptyValue propKey={propKey} defType={defType} />
        )}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(value);
          setEditing(false);
        }
      }}
      onBlur={() => {
        onSet(draft);
        setEditing(false);
      }}
      className="w-full rounded-sm border border-line bg-surface px-2 py-0.5 text-meta"
    />
  );
}

function AddPropertyPopover({
  propDefs,
  present,
  onAdd,
}: {
  propDefs: PropDef[];
  present: Set<string>;
  onAdd: (key: string, seed: unknown, focusAfter: boolean) => void;
}) {
  const candidates = propDefs
    .filter((d) => !present.has(d.key))
    .filter((d) => d.key !== "area" && d.key !== "owner");

  function typeGlyph(t: string) {
    switch (t) {
      case "select":
      case "status":
        return "◉";
      case "multi_select":
        return "#";
      case "checkbox":
        return "☐";
      case "number":
        return "#";
      case "date":
        return "◵";
      case "person":
        return "@";
      case "text":
        return "T";
      default:
        return "•";
    }
  }

  return (
    <Popover
      width={260}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
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
      )}
    >
      {(close) => (
        <div className="p-1">
          <div className="px-2 pt-1 pb-1 text-label uppercase text-faint">
            Add a property
          </div>
          {candidates.length === 0 ? (
            <p className="px-2 py-1 text-meta text-muted">
              Every registered property is already on this page.
            </p>
          ) : (
            candidates.map((d) => (
              <button
                key={d.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
                onClick={() => {
                  /* Seed by type. For select/status/person the seed is null;
                   * the row appears and immediately auto-opens its picker via
                   * the `autoOpenKey` mechanism in PropertyStrip. */
                  let seed: unknown;
                  switch (d.type) {
                    case "multi_select":
                      seed = [];
                      break;
                    case "checkbox":
                      seed = false;
                      break;
                    case "text":
                      seed = "";
                      break;
                    case "number":
                    case "date":
                    case "select":
                    case "status":
                    case "person":
                    default:
                      seed = null;
                  }
                  onAdd(d.key, seed, true);
                  close();
                }}
              >
                <span className="w-4 text-faint">{typeGlyph(d.type)}</span>
                <span>{d.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </Popover>
  );
}

function PropertyStrip({
  page,
  propDefs,
  members,
  meId,
  pages,
  areas,
  onSet,
}: {
  page: PageFull;
  propDefs: PropDef[];
  members: MemberRow[];
  meId: string;
  pages: PageListItem[];
  areas: string[];
  onSet: (key: string, value: unknown) => void;
}) {
  const propsRec = propsOf(page);
  const present = new Set(Object.keys(propsRec));
  const byPos = [...propDefs].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );

  const rest = byPos
    .filter((d) => !PROPS_ORDER_TOP.includes(d.key))
    .filter((d) => present.has(d.key));

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

  /* Rhythm rule: rows ABUT (no gap between them) and each row is its own
   * min-height 32 box. The strip owns its own top hairline (marginTop 22,
   * borderTop 1px var(--color-line), paddingTop 8); the page container no
   * longer wraps this with any additional spacing. */
  return (
    <div
      style={{
        marginTop: 22,
        borderTop: "1px solid var(--color-line)",
        paddingTop: 8,
      }}
    >
      {rows.map((r) => {
        const def = propDefs.find((d) => d.key === r.key);
        const removable =
          def && def.is_system === false && present.has(r.key);
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

      {/* Last verified — the one non-clickable row. No hover, cursor
       * default. The way to change it is the freshness banner above. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "132px 1fr",
          alignItems: "center",
          minHeight: 32,
          padding: "2px 6px",
          cursor: "default",
        }}
      >
        <div
          className="flex items-center"
          style={{ gap: 6, fontSize: 14, color: "var(--color-muted)" }}
        >
          Last verified
        </div>
        <div
          className="min-w-0"
          style={{ fontSize: 14, color: "var(--color-strong)" }}
        >
          {relTime(page.verified_at)} · {verifiedByName}
        </div>
      </div>

      <AddPropertyPopover
        propDefs={propDefs}
        present={present}
        onAdd={(key, seed) => onSet(key, seed)}
      />
    </div>
  );
}

/* Read-only body renderer, its useFlashOnHash hook, and warnOnce lived
 * here in Part A; Part B replaces them with EditableBody which manages
 * its own state and focus. Anchor-scrolling to a specific block id is
 * a Part C follow-up. */



/* ────────────── Container ────────────── */

export function PageEditor({ pageId }: { pageId: string }) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const pageQ = usePage(pageId);
  const accessQ = usePageAccess(pageId);
  const setProp = useSetPageProperty();
  const verify = useVerifyPage();
  const rename = useRenamePage();
  const updateBlocks = useUpdateBlocks();
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

  useEffect(
    () => () => {
      if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current);
    },
    [],
  );

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
      if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = window.setTimeout(() => {
        if (!page) return;
        rename.mutate({ pageId: page.id, title: v });
      }, 500);
    },
    [page, rename],
  );

  const focusFirstBlock = useCallback(() => {
    // The body always renders at least one block, so this always finds
    // a textarea. No empty-state clicking, no Enter ritual.
    const el = document.querySelector<HTMLTextAreaElement>(
      "#page-body textarea",
    );
    if (el) {
      el.focus();
      el.setSelectionRange(0, 0);
    }
  }, []);

  /* ────────── Body debounced save ──────────
   *
   * The saver owns the latest-value ref, saved-value ref, single-flight
   * guard, and follow-up dispatch. React only feeds it keystrokes and
   * triggers flushes. No React effect ever resets the saved marker
   * mid-mutation, so an optimistic cache patch cannot corrupt the diff. */
  const updateBlocksRef = useRef(updateBlocks);
  useEffect(() => {
    updateBlocksRef.current = updateBlocks;
  }, [updateBlocks]);

  const saverRef = useRef<ReturnType<typeof createBlocksSaver<Block[]>> | null>(
    null,
  );
  const pageIdForSaver = page?.id;
  const locked = app.locked;

  useEffect(() => {
    if (!pageIdForSaver) return;
    const saver = createBlocksSaver<Block[]>({
      debounceMs: 500,
      send: async (blocks) => {
        await updateBlocksRef.current.mutateAsync({
          pageId: pageIdForSaver,
          blocks,
        });
      },
    });
    saverRef.current = saver;
    return () => {
      // Flush before tearing down (route change / pageId change).
      void saver.flush().finally(() => saver.dispose());
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [pageIdForSaver]);

  // Prime savedRef from the server-known blocks on first mount for this
  // page so no-op saves don't fire.
  const primedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!page || !saverRef.current) return;
    if (primedRef.current === page.id) return;
    primedRef.current = page.id;
    saverRef.current.markSaved(
      (Array.isArray(page.blocks) ? page.blocks : []) as Block[],
    );
  }, [page]);

  // Flush on page unload (tab close, hard nav).
  useEffect(() => {
    const onBeforeUnload = () => {
      saverRef.current?.flush();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onBeforeUnload);
    };
  }, []);

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
        style={{ display: "flex", alignItems: "center", height: 51, gap: 13 }}
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
              style={{ width: 42, height: 42, fontSize: 34, lineHeight: 1, flex: "none" }}
            >
              {page.icon || "📄"}
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

        <div className="min-w-0 flex-1">
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

      {/* 4. Freshness banner. */}
      <div style={{ marginTop: 14 }}>
        <FreshnessRow
          page={page}
          members={members}
          meId={meId}
          staleDays={staleDays}
          onVerify={onVerify}
          justVerified={justVerified}
        />
      </div>


      {/* 5. Properties strip. The strip owns its own top hairline —
       * marginTop 22 + border-top + padding-top 8 — so no wrapper spacing
       * here. */}
      <PropertyStrip
        page={page}
        propDefs={propDefs}
        members={members}
        meId={meId}
        pages={(shell.pages.data ?? []) as PageListItem[]}
        areas={areasList}
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
          pageId={page.id}
          initialBlocks={blocks}
          onChange={onBlocksChange}
          onBlur={onBodyBlur}
          locked={app.locked}
          editedRel={page.edited_at ? relTime(page.edited_at) : null}
          editorFirstName={editorName}
        />
      </div>
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


