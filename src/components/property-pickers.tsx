import { useMemo, useState, type ReactNode } from "react";
import { Popover } from "./popover";

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
