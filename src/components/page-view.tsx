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
}: {
  path: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

/* ────────────── Permissions chip (non-interactive this phase) ────────────── */

function PermissionsChip({
  page,
  workspaceName,
  access,
}: {
  page: PageFull;
  workspaceName: string;
  access: PageAccessRow[];
}) {
  const isWorkspace = page.access_type === "workspace";
  const nExplicit = access.filter((a) => a.user_id).length;

  const label = isWorkspace
    ? `Everyone at ${workspaceName}`
    : `Only ${nExplicit} ${nExplicit === 1 ? "person" : "people"}`;

  const path = isWorkspace
    ? "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"
    : "M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z";

  return (
    <span
      data-permissions-chip
      className="inline-flex items-center gap-1.5 rounded-full border border-line text-meta text-secondary"
      style={{
        height: 27,
        boxSizing: "border-box",
        padding: "0 11px",
        borderRadius: 999,
      }}
    >
      <Glyph path={path} className="h-3.5 w-3.5" />
      <span>{label}</span>
    </span>
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
  const missing = <span className="italic text-whisper">—</span>;
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
            className="text-left"
          >
            {typeof raw === "string" && raw ? (
              <span
                className="inline-flex items-center rounded-sm bg-sunken px-1.5 py-0.5 text-meta text-body"
                style={{ paddingBlock: 2 }}
              >
                {raw}
              </span>
            ) : (
              missing
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
            className="flex min-w-0 items-center gap-2 text-left"
          >
            {m ? (
              <>
                <MiniAvatar profile={m.profiles} />
                <span className="text-meta text-body">
                  {m.profiles?.full_name ?? m.profiles?.email ?? "Unknown"}
                </span>
              </>
            ) : (
              missing
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
            className="text-left"
          >
            {cur ? (
              <StatusChipInline
                label={cur.label}
                tint={cur.tint}
                ink={cur.ink}
              />
            ) : (
              missing
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
            className="flex flex-wrap items-center gap-1"
          >
            {tags.length === 0
              ? missing
              : tags.map((t) => {
                  const p = hashPair(t);
                  return (
                    <span
                      key={t}
                      className="rounded-sm px-1.5 py-0.5 text-caption"
                      style={{
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

  /* ── Checkbox ── (direct toggle, no popover) */
  if (def?.type === "checkbox") {
    const on = !!raw;
    return (
      <button
        type="button"
        onClick={() => onSet(!on)}
        className="grid h-5 w-5 place-items-center rounded-sm border border-line hover:bg-rail"
        aria-pressed={on}
        aria-label={def.label}
      >
        {on ? (
          <Glyph path="M5 12l5 5 9-11" className="h-3.5 w-3.5 text-accent" />
        ) : null}
      </button>
    );
  }

  /* ── Number ── */
  if (def?.type === "number") {
    return (
      <NumberInline
        value={typeof raw === "number" ? raw : null}
        onSet={onSet}
        onOpenChange={onOpenChange}
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
      />
    );
  }

  /* ── Text / default ── */
  return (
    <TextInline
      value={typeof raw === "string" ? raw : ""}
      onSet={onSet}
    />
  );
}

function StatusChipInline({
  label,
  tint,
  ink,
}: {
  label: string;
  tint: string;
  ink: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption"
      style={{
        background: `var(--color-${tint})`,
        color: `var(--color-${ink})`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `var(--color-${ink})` }}
      />
      {label}
    </span>
  );
}

function NumberInline({
  value,
  onSet,
  onOpenChange,
}: {
  value: number | null;
  onSet: (v: number | null) => void;
  onOpenChange: (open: boolean) => void;
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
        className="text-left text-meta text-body tnum"
      >
        {value === null ? (
          <span className="italic text-whisper">—</span>
        ) : (
          value
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
}: {
  value: string | null;
  onSet: (v: string | null) => void;
  onOpenChange: (open: boolean) => void;
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
          className="text-left text-meta text-body"
        >
          {label ?? <span className="italic text-whisper">—</span>}
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
}: {
  value: string;
  onSet: (v: string) => void;
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
        className="w-full text-left text-meta text-body"
      >
        {value ? value : <span className="italic text-whisper">—</span>}
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
          className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-meta text-muted hover:bg-sunken"
        >
          <Glyph path="M12 5v14M5 12h14" className="h-3.5 w-3.5" />
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

  return (
    <div>
      {rows.map((r) => {
        const def = propDefs.find((d) => d.key === r.key);
        const removable =
          def && def.is_system === false && present.has(r.key);
        const active = hoverKey === r.key || openKey === r.key;
        const showX = removable && active;
        return (
          <div
            key={r.key}
            className={
              "flex items-center rounded-md px-1 " +
              (active ? "bg-sunken" : "")
            }
            style={{ height: 20, gap: 10 }}
            onMouseEnter={() => setHoverKey(r.key)}
            onMouseLeave={() => setHoverKey(null)}
          >
            <div
              className="flex shrink-0 items-center gap-1 text-meta text-muted"
              style={{ width: 118, flex: "none" }}
            >
              <span>{labelFor(r.key, propDefs)}</span>
              {showX ? (
                <button
                  type="button"
                  aria-label={`Remove ${labelFor(r.key, propDefs)}`}
                  className="grid h-4 w-4 place-items-center rounded-sm text-faint hover:bg-rail hover:text-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSet(r.key, null);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
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

      <div
        className="flex items-center rounded-md px-1"
        style={{ height: 20, gap: 10 }}
      >
        <div className="shrink-0 text-meta text-muted" style={{ width: 118, flex: "none" }}>
          Last verified
        </div>
        <div className="min-w-0 flex-1 text-meta text-secondary">
          {relTime(page.verified_at)} · {verifiedByName}
        </div>
      </div>

      <div className="mt-1">
        <AddPropertyPopover
          propDefs={propDefs}
          present={present}
          onAdd={(key, seed) => onSet(key, seed)}
        />
      </div>
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
      {/* 1. Emoji icon on its own line — opens the shared emoji picker. */}
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
            style={{ width: 56, height: 56, fontSize: 44, lineHeight: 1 }}
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


      {/* 2. Editable title. */}
      <EditableTitle
        value={titleValue}
        onChange={onTitleChange}
        onEnter={focusFirstBlock}
        autoFocus={titleAutoFocus}
      />

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


      {/* 5. Properties strip. */}
      <div style={{ marginTop: 18 }}>
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
      </div>

      {/* 6. Hairline divider. */}
      <div className="border-t border-lineSoft" style={{ marginTop: 20 }} />

      {/* 7. Editable body. */}
      <div id="page-body" style={{ marginTop: 26 }}>
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
    </div>
  );
}


