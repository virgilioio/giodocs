import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Popover } from "./popover";
import { dueLabel, toDueString } from "@/lib/due-date";

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
      width={214}
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
        <div className="flex flex-col" style={{ gap: 2, padding: 2 }}>
          <input
            type="date"
            defaultValue={stored ?? ""}
            onChange={(e) => {
              const next = toDueString(e.target.value);
              onSet(next);
              if (next) close();
            }}
            className="w-full border border-line bg-track"
            style={{ fontSize: 13.5, borderRadius: 8, padding: "6px 8px" }}
          />
          {stored ? (
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
