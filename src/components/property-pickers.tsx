import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Popover } from "./popover";
import {
  dueDeltaDays,
  dueLabel,
  dueParts,
  dueRelative,
  formatDue,
  toDueString,
} from "@/lib/due-date";
import { parseDateInput } from "@/lib/date-parse";


/* Shared editing popovers, used by BOTH the table cells (main-view.tsx)
 * and the page properties strip (page-view.tsx). Callers supply the
 * trigger — the popover BODY is the single source of truth for how
 * area/owner/select/status/tags are edited.
 *
 * "Editable × removal" on non-system properties is separate — it lives
 * in the property strip layout, not here. */

export type SelectOption = {
  value: string;
  label: string;
  tint: string;
  ink: string;
};

export type MemberLike = {
  user_id: string;
  profiles: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_tint: string | null;
    avatar_ink: string | null;
  } | null;
};

type TriggerFn = (props: {
  open: boolean;
  onClick: () => void;
  ref: React.Ref<HTMLButtonElement>;
}) => ReactNode;

/* ────────────── Shared chip / avatar / hashTag ────────────── */

const TAG_PAIRS: Array<{ tint: string; ink: string }> = [
  { tint: "accentTint", ink: "accent" },
  { tint: "amberTint", ink: "amberInk" },
  { tint: "blueTint", ink: "blueInk" },
  { tint: "purpleTint", ink: "purple" },
  { tint: "pinkTint", ink: "pinkInk" },
  { tint: "yellowTint", ink: "yellowInk" },
];

export function hashTag(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TAG_PAIRS[h % TAG_PAIRS.length];
}

export function StatusChip({
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

export function MiniAvatar({ profile }: { profile: MemberLike["profiles"] }) {
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

/* ────────────── Area ────────────── */

export function AreaPicker({
  value,
  areas,
  onPick,
  trigger,
  width = 220,
  onOpenChange,
}: {
  value: string | null;
  areas: string[];
  onPick: (v: string | null) => void;
  trigger: TriggerFn;
  width?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover width={width} trigger={trigger} onOpenChange={onOpenChange}>
      {(close) => (
        <AreaPickerBody
          value={value}
          areas={areas}
          onPick={onPick}
          close={close}
        />
      )}
    </Popover>
  );
}

function AreaPickerBody({
  value,
  areas,
  onPick,
  close,
}: {
  value: string | null;
  areas: string[];
  onPick: (v: string | null) => void;
  close: () => void;
}) {
  const [neu, setNeu] = useState("");
  return (
    <div>
      <div className="max-h-56 overflow-y-auto">
        {areas.map((a) => (
          <button
            key={a}
            type="button"
            className={
              "flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-meta hover:bg-rail " +
              (a === value ? "font-bold" : "")
            }
            onClick={() => {
              onPick(a);
              close();
            }}
          >
            <span>{a}</span>
            {a === value ? <span className="text-accent">✓</span> : null}
          </button>
        ))}
      </div>
      <div className="my-1 border-t border-lineSoft" />
      <div className="flex gap-1 p-1">
        <input
          value={neu}
          onChange={(e) => setNeu(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && neu.trim()) {
              e.preventDefault();
              onPick(neu.trim());
              close();
            }
          }}
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
          className="rounded-sm bg-btn px-2 text-meta font-bold text-btnFg disabled:opacity-40"
        >
          Set
        </button>
      </div>
      {value ? (
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
      ) : null}
    </div>
  );
}

/* ────────────── Owner / Person ────────────── */

export function OwnerPicker({
  value,
  members,
  onPick,
  trigger,
  width = 240,
  onOpenChange,
  emptyLabel = "No owner",
}: {
  value: string | null;
  members: MemberLike[];
  onPick: (uid: string | null) => void;
  trigger: TriggerFn;
  width?: number;
  onOpenChange?: (open: boolean) => void;
  emptyLabel?: string;
}) {
  return (
    <Popover width={width} trigger={trigger} onOpenChange={onOpenChange}>
      {(close) => (
        <div className="max-h-72 overflow-y-auto">
          {members.map((m) => (
            <button
              key={m.user_id}
              type="button"
              className={
                "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-rail " +
                (m.user_id === value ? "font-bold" : "")
              }
              onClick={() => {
                onPick(m.user_id);
                close();
              }}
            >
              <MiniAvatar profile={m.profiles} />
              <span className="text-meta">
                {m.profiles?.full_name ?? m.profiles?.email ?? "Unknown"}
              </span>
              {m.user_id === value ? (
                <span className="ml-auto text-accent">✓</span>
              ) : null}
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
            {emptyLabel}
          </button>
        </div>
      )}
    </Popover>
  );
}

/* ────────────── Select / Status ────────────── */

export function SelectPicker({
  value,
  options,
  onPick,
  trigger,
  width = 200,
  onOpenChange,
}: {
  value: string | null;
  options: SelectOption[];
  onPick: (v: string | null) => void;
  trigger: TriggerFn;
  width?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover width={width} trigger={trigger} onOpenChange={onOpenChange}>
      {(close) => (
        <div>
          {options.map((o) => (
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
              {o.value === value ? (
                <span className="ml-auto text-accent">✓</span>
              ) : null}
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

/* ────────────── Tags (multi-select) ────────────── */

export function TagsPicker({
  value,
  options,
  onSet,
  trigger,
  width = 240,
  onOpenChange,
}: {
  value: string[];
  options: string[];
  onSet: (tags: string[]) => void;
  trigger: TriggerFn;
  width?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover width={width} trigger={trigger} onOpenChange={onOpenChange}>
      {(close) => (
        <TagsPickerBody
          value={value}
          options={options}
          onSet={onSet}
          close={close}
        />
      )}
    </Popover>
  );
}

function TagsPickerBody({
  value,
  options,
  onSet,
  close,
}: {
  value: string[];
  options: string[];
  onSet: (tags: string[]) => void;
  close: () => void;
}) {
  const [neu, setNeu] = useState("");
  const merged = useMemo(() => {
    const s = new Set(options);
    value.forEach((v) => s.add(v));
    return [...s].sort();
  }, [options, value]);
  return (
    <div>
      <div className="max-h-56 overflow-y-auto">
        {merged.map((t) => {
          const on = value.includes(t);
          return (
            <button
              key={t}
              type="button"
              className="flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
              onClick={() =>
                onSet(on ? value.filter((x) => x !== t) : [...value, t])
              }
            >
              <span>{t}</span>
              {on ? <span className="text-accent">✓</span> : null}
            </button>
          );
        })}
        {merged.length === 0 ? (
          <p className="px-2 py-1 text-meta text-muted">No tags yet.</p>
        ) : null}
      </div>
      <div className="my-1 border-t border-lineSoft" />
      <div className="flex gap-1 p-1">
        <input
          value={neu}
          onChange={(e) => setNeu(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && neu.trim()) {
              e.preventDefault();
              const t = neu.trim();
              if (!value.includes(t)) onSet([...value, t]);
              setNeu("");
              close();
            }
          }}
          placeholder="New tag…"
          className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-meta"
        />
        <button
          type="button"
          disabled={!neu.trim()}
          onClick={() => {
            const t = neu.trim();
            if (!value.includes(t)) onSet([...value, t]);
            setNeu("");
            close();
          }}
          className="rounded-sm bg-btn px-2 text-meta font-bold text-btnFg disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ────────────── Date / Number / Text / Checkbox ──────────────
 *
 * ONE implementation per type, two call sites: the page properties strip
 * (page-view.tsx) and the table cell (main-view.tsx). `variant` only
 * changes typography and empty copy — never behaviour, never the value
 * that gets stored. All four commit through the caller's onSet, which is
 * the existing useSetPageProperty mutation in both sites. */

type Variant = "strip" | "cell";

const VALUE_FONT: Record<Variant, number> = { strip: 14, cell: 13.5 };

function emptyNode(variant: Variant, label: string) {
  return variant === "strip" ? (
    <span style={{ fontSize: 14, color: "var(--color-whisper)" }}>{label}</span>
  ) : (
    <span className="text-faint">—</span>
  );
}

/* ── Date ── stores "YYYY-MM-DD". Never a timestamptz. */

export function DateValue({
  value,
  terminal,
  variant = "strip",
  emptyLabel = "Empty",
  now,
}: {
  value: unknown;
  terminal?: boolean;
  variant?: Variant;
  emptyLabel?: string;
  now?: Date;
}) {
  const { state, text } = dueLabel(value, now ?? new Date(), { terminal });
  if (state === "empty") return emptyNode(variant, emptyLabel);
  const color =
    state === "overdue"
      ? "var(--color-danger)"
      : state === "today"
        ? "var(--color-amberInk)"
        : "var(--color-strong)";
  return (
    <span
      className="inline-flex min-w-0 items-center"
      style={{ gap: 5, fontSize: VALUE_FONT[variant], color }}
    >
      {state === "overdue" ? (
        <svg
          viewBox="0 0 24 24"
          width={13}
          height={13}
          aria-hidden
          style={{ flex: "none" }}
        >
          <path
            d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      <span className="truncate">{text}</span>
    </span>
  );
}

export function DatePicker({
  value,
  onSet,
  terminal,
  variant = "strip",
  emptyLabel = "Empty",
  triggerClassName,
  triggerStyle,
  onOpenChange,
}: {
  value: unknown;
  onSet: (v: string | null) => void;
  terminal?: boolean;
  variant?: Variant;
  emptyLabel?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  onOpenChange?: (open: boolean) => void;
}) {
  const stored = toDueString(value);
  return (
    <Popover
      width={272}
      onOpenChange={onOpenChange}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className={triggerClassName}
          style={triggerStyle}
        >
          <DateValue
            value={stored}
            terminal={terminal}
            variant={variant}
            emptyLabel={emptyLabel}
          />
        </button>
      )}
    >
      {(close) => (
        <CalendarBody
          stored={stored}
          onCommit={(v) => {
            onSet(v);
            close();
          }}
        />
      )}
    </Popover>
  );
}

/* ── The calendar ──
 * Escape and outside-click are the Popover's job — NO local listener here.
 * The month cursor is popover state only; it is never persisted. */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function ymOf(key: string): { y: number; m: number } {
  const p = dueParts(key);
  return p ? { y: p[0], m: p[1] } : { y: 0, m: 0 };
}

function monthCursor(stored: string | null, today: Date): string {
  const p = dueParts(stored);
  const y = p ? p[0] : today.getFullYear();
  const m = p ? p[1] : today.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function stepMonth(cursor: string, delta: number): string {
  const [y, m] = cursor.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** ALWAYS 42 cells (6×7), Monday first — so paging never changes height. */
function gridDays(cursor: string): Array<{ key: string; inMonth: boolean; dow: number }> {
  const [y, m] = cursor.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first offset
  const out: Array<{ key: string; inMonth: boolean; dow: number }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m - 1, 1 - lead + i);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      inMonth: d.getMonth() === m - 1 && d.getFullYear() === y,
      dow: (d.getDay() + 6) % 7,
    });
  }
  return out;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function Chevron({ dir }: { dir: -1 | 1 }) {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden>
      <path
        d={dir === -1 ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QuickBtn({
  label,
  active,
  danger,
  onClick,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={danger ? "rounded-md hover:bg-dangerTint" : "rounded-md hover:bg-sunken"}
      style={{
        padding: "4px 9px",
        fontSize: 12.5,
        background: active ? "var(--color-selected)" : "transparent",
        color: danger
          ? "var(--color-danger)"
          : active
            ? "var(--color-noir)"
            : "var(--color-secondary)",
        border: 0,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export function CalendarBody({
  stored,
  onCommit,
  now,
}: {
  stored: string | null;
  onCommit: (v: string | null) => void;
  now?: Date;
}) {
  const today = now ?? new Date();
  const todayKey = toDueString(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
  );
  const [cursor, setCursor] = useState(() => monthCursor(stored, today));
  const [draft, setDraft] = useState("");

  const days = useMemo(() => gridDays(cursor), [cursor]);
  const { y, m } = ymOf(`${cursor}-01`);
  const parsed = draft.trim() ? parseDateInput(draft, today) : null;
  const showEcho = draft.trim().length > 0;

  const quick = {
    today: todayKey,
    tomorrow: parseDateInput("+1", today),
    week: parseDateInput("+7", today),
  };

  const past = stored ? (dueDeltaDays(stored, today) ?? 0) < 0 : false;

  return (
    <div className="flex flex-col" style={{ gap: 6, padding: 2 }}>
      {/* HEADER */}
      <div
        className="flex items-center justify-between"
        style={{ padding: "3px 3px 6px" }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 13.5,
            fontWeight: 600,
            letterSpacing: "-.01em",
            color: "var(--color-noir)",
          }}
        >
          {MONTH_NAMES[m - 1]} {y}
        </span>
        <span className="flex items-center" style={{ gap: 2 }}>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setCursor((c) => stepMonth(c, -1))}
            className="grid place-items-center rounded-md text-muted hover:bg-sunken"
            style={{ width: 24, height: 24, border: 0, background: "transparent" }}
          >
            <Chevron dir={-1} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setCursor((c) => stepMonth(c, 1))}
            className="grid place-items-center rounded-md text-muted hover:bg-sunken"
            style={{ width: 24, height: 24, border: 0, background: "transparent" }}
          >
            <Chevron dir={1} />
          </button>
        </span>
      </div>

      {/* GRID */}
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}
      >
        {WEEKDAYS.map((w, i) => (
          <div
            key={`w-${i}`}
            aria-hidden
            className="grid place-items-center"
            style={{
              height: 20,
              fontFamily: "var(--font-display)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".06em",
              color: i >= 5 ? "var(--color-whisper)" : "var(--color-faint)",
            }}
          >
            {w}
          </div>
        ))}
        {days.map((d) => {
          const selected = stored === d.key;
          const isToday = d.key === todayKey;
          const weekend = d.dow >= 5;
          const fg = selected
            ? "var(--color-btnFg)"
            : isToday
              ? "var(--color-accent)"
              : !d.inMonth
                ? "var(--color-rule)"
                : weekend
                  ? "var(--color-muted)"
                  : "var(--color-body)";
          return (
            <button
              key={d.key}
              type="button"
              data-day={d.key}
              aria-label={d.key}
              onClick={() => onCommit(d.key)}
              className={selected ? "grid place-items-center" : "grid place-items-center hover:bg-sunken"}
              style={{
                height: 30,
                boxSizing: "border-box",
                borderRadius: 7,
                fontSize: 13,
                fontWeight: selected || isToday ? 700 : 400,
                border:
                  isToday && !selected
                    ? "1.5px solid var(--color-accentRing)"
                    : "1.5px solid transparent",
                background: selected ? "var(--color-accent)" : "transparent",
                color: fg,
                cursor: "pointer",
              }}
            >
              {Number(d.key.slice(8))}
            </button>
          );
        })}
      </div>

      {/* QUICK ROW */}
      <div
        className="flex items-center justify-between"
        style={{ borderTop: "1px solid var(--color-sunken)", paddingTop: 6 }}
      >
        <span className="flex items-center" style={{ gap: 2 }}>
          <QuickBtn
            label="Today"
            active={stored === quick.today}
            onClick={() => onCommit(quick.today)}
          />
          <QuickBtn
            label="Tomorrow"
            active={!!quick.tomorrow && stored === quick.tomorrow}
            onClick={() => onCommit(quick.tomorrow)}
          />
          <QuickBtn
            label="Next week"
            active={!!quick.week && stored === quick.week}
            onClick={() => onCommit(quick.week)}
          />
        </span>
        {stored ? (
          <QuickBtn label="Clear" danger onClick={() => onCommit(null)} />
        ) : null}
      </div>

      {/* TYPED ENTRY */}
      <div className="flex flex-col" style={{ gap: 3 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (parsed) onCommit(parsed);
              return;
            }
            if (!draft && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
              e.preventDefault();
              setCursor((c) => stepMonth(c, e.key === "ArrowLeft" ? -1 : 1));
            }
          }}
          placeholder={'Type a date — "tomorrow", "Mar 14", "+10"'}
          className="w-full border border-line bg-track"
          style={{ borderRadius: 7, padding: "5px 7px", fontSize: 13 }}
        />
        {showEcho ? (
          <span
            style={{
              fontSize: 12,
              padding: "0 2px",
              color: parsed ? "var(--color-accent)" : "var(--color-amberInk)",
            }}
          >
            {parsed ? `${echoLabel(parsed)} · Enter` : "Not a date"}
          </span>
        ) : null}
      </div>

      {/* RELATIVE LINE */}
      {stored ? (
        <span
          style={{
            fontSize: 12,
            padding: "0 2px",
            color: past ? "var(--color-amberInk)" : "var(--color-secondary)",
          }}
        >
          Due {dueRelative(stored, today)}
        </span>
      ) : null}
    </div>
  );
}

const ECHO_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon, Aug 10" — built from components, never from a parsed Date. */
function echoLabel(key: string): string {
  const p = dueParts(key);
  if (!p) return "";
  const dow = (new Date(p[0], p[1] - 1, p[2]).getDay() + 6) % 7;
  return `${ECHO_DOW[dow]}, ${formatDue(key, new Date(p[0], 0, 1))}`;
}


/* ── Number ── inline in place; stores a JSON number, never a string. */

export function NumberEditor({
  value,
  onSet,
  variant = "strip",
  emptyLabel = "Empty",
  triggerClassName,
  triggerStyle,
  onOpenChange,
}: {
  value: unknown;
  onSet: (v: number | null) => void;
  variant?: Variant;
  emptyLabel?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  onOpenChange?: (open: boolean) => void;
}) {
  const current = typeof value === "number" && Number.isFinite(value) ? value : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current === null ? "" : String(current));
  useEffect(() => {
    onOpenChange?.(editing);
  }, [editing, onOpenChange]);
  useEffect(() => {
    if (!editing) setDraft(current === null ? "" : String(current));
  }, [current, editing]);

  const commit = () => {
    const t = draft.trim();
    if (t === "") {
      if (current !== null) onSet(null);
    } else {
      const n = Number(t);
      // Reject non-numeric input rather than storing NaN.
      if (Number.isFinite(n)) {
        if (n !== current) onSet(n);
      }
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        aria-label="Number value"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(current === null ? "" : String(current));
            setEditing(false);
          }
        }}
        onBlur={commit}
        className="w-full border border-line bg-track tnum"
        style={{ fontSize: VALUE_FONT[variant], borderRadius: 8, padding: "3px 7px" }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={triggerClassName}
      style={triggerStyle}
    >
      {current === null ? (
        emptyNode(variant, emptyLabel)
      ) : (
        <span
          className="tnum"
          style={{ fontSize: VALUE_FONT[variant], color: "var(--color-strong)" }}
        >
          {current}
        </span>
      )}
    </button>
  );
}

/* ── Text ── inline in place, single line, ellipsised with a title. */

export function TextEditor({
  value,
  onSet,
  variant = "strip",
  emptyLabel = "Empty",
  triggerClassName,
  triggerStyle,
  onOpenChange,
}: {
  value: unknown;
  onSet: (v: string | null) => void;
  variant?: Variant;
  emptyLabel?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  onOpenChange?: (open: boolean) => void;
}) {
  const current = typeof value === "string" ? value : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  useEffect(() => {
    onOpenChange?.(editing);
  }, [editing, onOpenChange]);
  useEffect(() => {
    if (!editing) setDraft(current);
  }, [current, editing]);

  const commit = () => {
    const next = draft;
    if (next !== current) onSet(next === "" ? null : next);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label="Text value"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(current);
            setEditing(false);
          }
        }}
        onBlur={commit}
        className="w-full border border-line bg-track"
        style={{ fontSize: VALUE_FONT[variant], borderRadius: 8, padding: "3px 7px" }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={(triggerClassName ?? "") + " min-w-0"}
      style={triggerStyle}
      title={current || undefined}
    >
      {current ? (
        <span
          className="min-w-0 truncate"
          style={{ fontSize: VALUE_FONT[variant], color: "var(--color-strong)" }}
        >
          {current}
        </span>
      ) : (
        emptyNode(variant, emptyLabel)
      )}
    </button>
  );
}

/* ── Checkbox ── one click toggles; an absent value is false. */

export function CheckboxToggle({
  value,
  onSet,
  label,
  variant = "strip",
}: {
  value: unknown;
  onSet: (v: boolean) => void;
  label: string;
  variant?: Variant;
}) {
  return (
    <label
      className={
        "flex items-center " + (variant === "cell" ? "justify-center w-full" : "")
      }
      style={{ minHeight: 24, cursor: "pointer" }}
      aria-label={label}
    >
      <input
        type="checkbox"
        checked={value === true}
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
