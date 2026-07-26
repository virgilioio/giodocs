import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import {
  useWorkspaceShell,
  usePage,
  usePageAccess,
} from "@/hooks/use-workspace-data";
import { useSetPageProperty, useVerifyPage } from "@/hooks/use-page-mutations";
import { qk } from "@/lib/query-keys";
import { usePrefs } from "@/lib/preferences";
import { usePageAppearance } from "@/lib/page-appearance";
import { Popover } from "./popover";
import { formatTimestamp } from "@/lib/format";
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
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-meta text-secondary"
      style={{ borderRadius: 999 }}
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
        className="flex w-full items-center gap-2 rounded-lg border border-accentRing bg-accentTint px-3 py-2 text-row"
        style={{ borderRadius: 10 }}
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
        className="flex w-full items-center gap-2 rounded-lg border border-amberRing bg-amberTint px-3 py-2 text-row"
        style={{ borderRadius: 10 }}
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
          style={{ height: 32 }}
        >
          Still accurate ✓
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex w-full items-center gap-2 rounded-lg border border-line bg-track px-3 py-2 text-row"
      style={{ borderRadius: 10 }}
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
        style={{ height: 32 }}
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

function ReadOnlyValue({
  propKey,
  page,
  def,
  members,
}: {
  propKey: string;
  page: PageFull;
  def: PropDef | undefined;
  members: MemberRow[];
}) {
  const raw = propsOf(page)[propKey];
  const missing = <span className="italic text-whisper">—</span>;

  if (propKey === "area") {
    if (typeof raw === "string" && raw) {
      return (
        <span
          className="inline-flex items-center rounded-sm bg-sunken px-1.5 py-0.5 text-meta text-body"
          style={{ paddingBlock: 2 }}
        >
          {raw}
        </span>
      );
    }
    return missing;
  }

  if (propKey === "owner" || def?.type === "person") {
    const m = members.find((x) => x.user_id === raw);
    if (!m) return missing;
    return (
      <span className="inline-flex items-center gap-2">
        <MiniAvatar profile={m.profiles} />
        <span className="text-meta text-body">
          {m.profiles?.full_name ?? m.profiles?.email ?? "Unknown"}
        </span>
      </span>
    );
  }

  if (def?.type === "select" || def?.type === "status") {
    const opts =
      (def.options as unknown as Array<{
        value: string;
        label: string;
        tint: string;
        ink: string;
      }>) ?? [];
    const cur = opts.find((o) => o.value === raw);
    if (!cur) return missing;
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption"
        style={{
          background: `var(--color-${cur.tint})`,
          color: `var(--color-${cur.ink})`,
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: `var(--color-${cur.ink})` }}
        />
        {cur.label}
      </span>
    );
  }

  if (def?.type === "multi_select") {
    const tags = Array.isArray(raw) ? raw.map(String) : [];
    if (!tags.length) return missing;
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {tags.map((t) => {
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
      </span>
    );
  }

  if (def?.type === "checkbox") {
    return raw ? (
      <Glyph path="M5 12l5 5 9-11" className="h-4 w-4 text-accent" />
    ) : (
      missing
    );
  }

  if (def?.type === "number") {
    return typeof raw === "number" ? (
      <span className="text-meta text-body tnum">{raw}</span>
    ) : (
      missing
    );
  }

  if (def?.type === "date") {
    if (typeof raw !== "string" || !raw) return missing;
    const d = new Date(raw);
    return (
      <span className="text-meta text-body">
        {isNaN(d.getTime()) ? raw : d.toLocaleDateString()}
      </span>
    );
  }

  // text / default
  if (typeof raw === "string" && raw) {
    return <span className="text-meta text-body">{raw}</span>;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return <span className="text-meta text-body">{String(raw)}</span>;
  }
  return missing;
}

function AddPropertyPopover({
  propDefs,
  present,
  onAdd,
  onNotify,
}: {
  propDefs: PropDef[];
  present: Set<string>;
  onAdd: (key: string, seed: unknown) => void;
  onNotify: (m: string) => void;
}) {
  const candidates = propDefs
    .filter((d) => !present.has(d.key))
    .filter((d) => d.key !== "area" && d.key !== "owner");

  function seedFor(d: PropDef): { seed: unknown; ok: boolean } {
    switch (d.type) {
      case "multi_select":
        return { seed: [], ok: true };
      case "checkbox":
        return { seed: false, ok: true };
      case "text":
        return { seed: "", ok: true };
      // number / date / select / status — no null-ish default the trigger will
      // accept without a real value. Disabled this phase.
      default:
        return { seed: null, ok: false };
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
            candidates.map((d) => {
              const { seed, ok } = seedFor(d);
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={!ok}
                  title={
                    ok
                      ? undefined
                      : "Set a value in the next phase"
                  }
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-meta hover:bg-rail disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    if (!ok) return;
                    onAdd(d.key, seed);
                    onNotify(`Added "${d.label}" — value comes next phase.`);
                    close();
                  }}
                >
                  <span className="text-faint">
                    {d.type[0].toUpperCase()}
                  </span>
                  <span>{d.label}</span>
                </button>
              );
            })
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
  onSet,
}: {
  page: PageFull;
  propDefs: PropDef[];
  members: MemberRow[];
  meId: string;
  onSet: (key: string, value: unknown) => void;
}) {
  const propsRec = propsOf(page);
  const present = new Set(Object.keys(propsRec));
  const registered = new Set(propDefs.map((d) => d.key));
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
        const showX = removable && hoverKey === r.key;
        return (
          <div
            key={r.key}
            className="flex items-center gap-3 rounded-md px-1 hover:bg-sunken"
            style={{ minHeight: 32 }}
            onMouseEnter={() => setHoverKey(r.key)}
            onMouseLeave={() => setHoverKey(null)}
          >
            <div
              className="flex shrink-0 items-center gap-1 text-meta text-muted"
              style={{ width: 132 }}
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
              <ReadOnlyValue
                propKey={r.key}
                page={page}
                def={def}
                members={members}
              />
            </div>
          </div>
        );
      })}

      <div
        className="flex items-center gap-3 rounded-md px-1"
        style={{ minHeight: 32 }}
      >
        <div className="shrink-0 text-meta text-muted" style={{ width: 132 }}>
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
          onNotify={() => {
            /* toasts are already emitted by useSetPageProperty */
          }}
        />
      </div>

      {/* Reserve reference to registered set so lint stays quiet if list is empty. */}
      <span hidden aria-hidden data-registered={registered.size} />
    </div>
  );
}

/* ────────────── Read-only body — all 12 block types ────────────── */

type Blk = Block & {
  icon?: string;
  checked?: boolean;
  rows?: unknown;
  language?: string;
};

const _warned = new Set<string>();
function warnOnce(t: string) {
  if (_warned.has(t)) return;
  _warned.add(t);
  // eslint-disable-next-line no-console
  console.warn(`[page-view] unknown block type: ${t}`);
}

function BlockView({ b, idx }: { b: Blk; idx: number }) {
  const t = (b.type ?? "text") as string;
  const anchor = typeof b.id === "string" ? `block-${b.id}` : undefined;
  const common = { id: anchor, "data-block-id": b.id, "data-block-idx": idx } as const;
  const txt = (b.text ?? b.body ?? "") as string;

  switch (t) {
    case "text":
      return (
        <p {...common} className="text-prose text-body">
          {txt}
        </p>
      );
    case "h1":
      return (
        <h2 {...common} className="font-display text-title text-noir">
          {txt}
        </h2>
      );
    case "h2":
      return (
        <h3 {...common} className="font-display text-heading text-noir">
          {txt}
        </h3>
      );
    case "bullet":
      return (
        <ul {...common} className="list-disc pl-6 text-prose text-body">
          <li>{txt}</li>
        </ul>
      );
    case "numbered":
      return (
        <ol
          {...common}
          className="list-decimal pl-6 text-prose text-body marker:text-muted"
        >
          <li>{txt}</li>
        </ol>
      );
    case "todo": {
      const done = !!b.checked;
      return (
        <label
          {...common}
          className="flex items-start gap-2 text-prose text-body"
        >
          <input
            type="checkbox"
            checked={done}
            disabled
            className="mt-1.5 accent-accent"
            aria-label={done ? "Done" : "Todo"}
          />
          <span className={done ? "line-through text-muted" : ""}>{txt}</span>
        </label>
      );
    }
    case "toggle":
      return (
        <details {...common} className="text-prose text-body">
          <summary className="cursor-pointer list-none">
            <span className="mr-1 inline-block transition-transform [details[open]_&]:rotate-90">
              ›
            </span>
            {txt}
          </summary>
          {b.body ? (
            <div className="ml-4 mt-1 text-prose text-body">
              {String(b.body)}
            </div>
          ) : null}
        </details>
      );
    case "quote":
      return (
        <blockquote
          {...common}
          className="border-l-2 border-lineStrong pl-4 text-quote italic text-body"
          style={{ fontFamily: "Lato, sans-serif" }}
        >
          {txt}
        </blockquote>
      );
    case "callout":
      return (
        <div
          {...common}
          className="flex items-start gap-2 rounded-lg bg-sunken p-3 text-prose text-body"
          style={{ borderRadius: 10 }}
        >
          <span aria-hidden className="shrink-0 text-row">
            {b.icon ?? "💡"}
          </span>
          <span>{txt}</span>
        </div>
      );
    case "divider":
      return (
        <hr
          {...common}
          className="border-line"
          style={{ marginBlock: 20 }}
        />
      );
    case "code":
      return (
        <pre
          {...common}
          className="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-meta text-body"
          style={{ borderRadius: 6, whiteSpace: "pre" }}
        >
          <code>{txt}</code>
        </pre>
      );
    case "table": {
      const grid = Array.isArray(b.rows) ? (b.rows as unknown[][]) : [];
      if (!grid.length) return null;
      const [head, ...body] = grid;
      return (
        <div {...common} className="overflow-x-auto">
          <table className="w-full border-collapse text-meta">
            <thead>
              <tr>
                {(head as unknown[]).map((c, i) => (
                  <th
                    key={i}
                    className="border border-line px-2 py-1 text-left text-label uppercase text-secondary"
                  >
                    {String(c ?? "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>
                  {(row as unknown[]).map((c, ci) => (
                    <td
                      key={ci}
                      className="border border-line px-2 py-1 text-body"
                    >
                      {String(c ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default: {
      warnOnce(t);
      return (
        <p {...common} className="text-prose text-body">
          {txt}
        </p>
      );
    }
  }
}

function ReadOnlyBody({ blocks }: { blocks: Blk[] }) {
  useFlashOnHash(blocks);
  if (!blocks.length) {
    return (
      <div className="py-16 text-center">
        <p className="font-display text-subhead text-body">
          This page has no body yet.
        </p>
        <p className="mt-1 text-meta text-faint">
          Blocks arrive in the next phase.
        </p>
      </div>
    );
  }
  return (
    <div id="page-body" tabIndex={-1} className="space-y-4 focus:outline-none">
      {blocks.map((b, i) => (
        <BlockView key={(b.id as string | undefined) ?? i} b={b} idx={i} />
      ))}
    </div>
  );
}

/* ────────────── #block hash flash-on-arrival ────────────── */

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const s = window.getComputedStyle(node);
    if (
      /(auto|scroll|overlay)/.test(s.overflowY) &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function useFlashOnHash(blocks: Blk[]) {
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (!hash.startsWith("#block-")) return;
    const id = hash.slice(1);
    let cancelled = false;
    const attempt = (tries: number) => {
      if (cancelled) return;
      const el = document.getElementById(id) as HTMLElement | null;
      if (!el) {
        if (tries > 0) window.setTimeout(() => attempt(tries - 1), 60);
        return;
      }
      const scroller = findScrollParent(el);
      if (scroller) {
        const rect = el.getBoundingClientRect();
        const sRect = scroller.getBoundingClientRect();
        const target = scroller.scrollTop + (rect.top - sRect.top) - 120;
        scroller.scrollTop = Math.max(0, target);
      }
      const prev = el.style.transition;
      el.style.transition = "background-color 500ms ease";
      el.style.backgroundColor = "var(--color-highlight)";
      window.setTimeout(() => {
        el.style.backgroundColor = "transparent";
        window.setTimeout(() => {
          el.style.transition = prev;
          el.style.backgroundColor = "";
        }, 550);
      }, 2400);
    };
    attempt(10);
    return () => {
      cancelled = true;
    };
  }, [blocks]);
}

/* ────────────── Container ────────────── */

export function PageEditor({ pageId }: { pageId: string }) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const pageQ = usePage(pageId);
  const accessQ = usePageAccess(pageId);
  const setProp = useSetPageProperty();
  const verify = useVerifyPage();
  const qc = useQueryClient();
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

  if (pageQ.isLoading) {
    return (
      <div
        className="mx-auto"
        style={{ maxWidth: 780, padding: "42px 44px" }}
      >
        <p className="text-meta text-muted">Loading page…</p>
      </div>
    );
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

  const blocks: Blk[] = Array.isArray(page.blocks)
    ? (page.blocks as Blk[])
    : [];

  return (
    <div
      className="gio-page mx-auto"
      data-font={app.font}
      data-small={app.small ? "1" : "0"}
      data-wide={app.wide ? "1" : "0"}
      data-locked={app.locked ? "1" : "0"}
      style={{
        maxWidth: 780,
        padding: "42px 44px",
      }}
    >
      {/* 1. Emoji icon on its own line, ~44px, not clickable this phase. */}
      <div
        className="select-none"
        aria-hidden
        style={{ fontSize: 44, lineHeight: 1 }}
      >
        {page.icon || "📄"}
      </div>

      {/* 2. Title — read-only this phase. */}
      <h1
        className="mt-3 font-display text-display text-noir"
        style={{ whiteSpace: "pre-wrap" }}
      >
        {page.title || "Untitled"}
      </h1>

      {/* 3. Permissions chip row: pill · edited stamp. */}
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

      {/* 5. Properties strip (read-only + × removal on non-system rows). */}
      <div style={{ marginTop: 18 }}>
        <PropertyStrip
          page={page}
          propDefs={propDefs}
          members={members}
          meId={meId}
          onSet={(key, value) => {
            if (key === "icon") {
              void updatePageIcon(page.id, value as string, qc);
              return;
            }
            setProp.mutate({ pageId: page.id, key, value });
          }}
        />
      </div>

      {/* 6. Hairline divider. */}
      <div
        className="border-t border-lineSoft"
        style={{ marginTop: 20 }}
      />

      {/* 7. Body. */}
      <div style={{ marginTop: 26 }}>
        <ReadOnlyBody blocks={blocks} />
      </div>
    </div>
  );
}




async function updatePageIcon(
  pageId: string,
  icon: string,
  qc: ReturnType<typeof useQueryClient>,
) {
  const { supabase } = await import("@/integrations/supabase/client");
  await supabase.from("pages").update({ icon }).eq("id", pageId);
  qc.invalidateQueries({ queryKey: qk.page(pageId) });
}
