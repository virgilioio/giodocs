import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import {
  useWorkspaceShell,
  usePage,
  usePageAccess,
} from "@/hooks/use-workspace-data";
import {
  useSetPageProperty,
  useRenamePage,
  useVerifyPage,
} from "@/hooks/use-page-mutations";
import { qk } from "@/lib/query-keys";
import { Popover } from "./popover";
import { usePrefs } from "@/lib/preferences";
import { formatTimestamp } from "@/lib/format";
import { useEmojiFavorites } from "@/lib/emoji-favorites";
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

/* ────────────── Title ────────────── */

function TitleField({
  page,
  onRename,
}: {
  page: PageFull;
  onRename: (title: string) => void;
}) {
  const [value, setValue] = useState(page.title ?? "");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<{ inFlight: boolean; queued: string | null }>({
    inFlight: false,
    queued: null,
  });
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef(page.title ?? "");

  // Reflect external title updates when not actively typing.
  useEffect(() => {
    if (document.activeElement !== taRef.current) {
      setValue(page.title ?? "");
      lastSavedRef.current = page.title ?? "";
    }
  }, [page.title]);

  // Auto-grow.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const flush = (t: string) => {
    if (t === lastSavedRef.current) return;
    if (pendingRef.current.inFlight) {
      pendingRef.current.queued = t;
      return;
    }
    pendingRef.current.inFlight = true;
    lastSavedRef.current = t;
    onRename(t);
    // We can't easily observe completion here; rely on cache invalidation.
    // Use a microtask timeout to release the gate.
    window.setTimeout(() => {
      pendingRef.current.inFlight = false;
      const q = pendingRef.current.queued;
      pendingRef.current.queued = null;
      if (q !== null && q !== lastSavedRef.current) flush(q);
    }, 250);
  };

  const schedule = (t: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => flush(t.trim()), 500);
  };

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // One-shot focus after "New area" creation.
  useEffect(() => {
    try {
      const target = sessionStorage.getItem("gio.focus-title");
      if (target && target === page.id) {
        sessionStorage.removeItem("gio.focus-title");
        const el = taRef.current;
        if (el) {
          el.focus();
          const end = el.value.length;
          el.setSelectionRange(end, end);
        }
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);


  return (
    <textarea
      ref={taRef}
      rows={1}
      value={value}
      placeholder="Untitled"
      onChange={(e) => {
        setValue(e.target.value);
        schedule(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          flush(value.trim());
          const body = document.getElementById("page-body");
          if (body) (body as HTMLElement).focus();
        }
      }}
      onBlur={() => {
        if (timerRef.current) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        flush(value.trim());
      }}
      className="block w-full resize-none overflow-hidden bg-transparent font-display text-display text-noir focus:outline-none placeholder:text-whisper"
    />
  );
}

/* ────────────── Permissions chip ────────────── */

type PermsData = {
  page: PageFull;
  workspaceName: string;
  members: MemberRow[];
  access: PageAccessRow[];
  areaAccessNorm: { hasGuests: boolean };
};

function PermissionsChip({
  page,
  workspaceName,
  members,
  access,
  areaAccessNorm,
}: PermsData) {
  const isWorkspace = page.access_type === "workspace";
  const guests = access.filter((a) => a.guest_email);
  const explicitUsers = access.filter((a) => a.user_id);

  const label = isWorkspace
    ? `Everyone at ${workspaceName}${
        guests.length ? ` · ${guests.length} guest${guests.length === 1 ? "" : "s"}` : ""
      }`
    : `Only ${explicitUsers.length + guests.length} people`;

  const path = isWorkspace
    ? "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"
    : "M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z";

  const anomaly =
    isWorkspace && guests.length > 0 && !areaAccessNorm.hasGuests
      ? `${guests.length} ${
          guests.length === 1 ? "person outside" : "people outside"
        } ${workspaceName} can see this page. The rest of this area has no guests.`
      : null;

  return (
    <Popover
      width={320}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-meta text-secondary hover:bg-rail"
          style={{ borderRadius: 999 }}
        >
          <Glyph path={path} className="h-3.5 w-3.5" />
          <span>{label}</span>
        </button>
      )}
    >
      {() => (
        <div className="p-1">
          <div className="px-2 pb-1 pt-1 text-label uppercase text-faint">
            Who can see this page
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {isWorkspace && (
              <li className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-meta">
                <span className="text-body">Everyone at {workspaceName}</span>
                <span className="text-caption text-faint">
                  {members.length}{" "}
                  {members.length === 1 ? "member" : "members"}
                </span>
              </li>
            )}
            {explicitUsers.map((a) => {
              const m = members.find((x) => x.user_id === a.user_id);
              const name = m?.profiles?.full_name || m?.profiles?.email || "Unknown";
              return (
                <li
                  key={`u-${a.user_id}`}
                  className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-meta"
                >
                  <span className="text-body">{name}</span>
                  <span className="text-caption text-faint">
                    Can {a.capability === "edit" ? "edit" : "view"}
                  </span>
                </li>
              );
            })}
            {guests.map((a) => (
              <li
                key={`g-${a.guest_email}`}
                className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-meta"
              >
                <span className="text-body">{a.guest_email}</span>
                <span className="text-caption text-faint">
                  Guest · can {a.capability === "edit" ? "edit" : "view"}
                </span>
              </li>
            ))}
          </ul>
          {anomaly && (
            <p className="mx-1 my-1 rounded-md border border-amberRing bg-amberTint px-2 py-1.5 text-caption text-amberInk">
              {anomaly}
            </p>
          )}
          <p className="border-t border-lineSoft px-2 pt-1.5 text-caption text-muted">
            Access is set per page. Nothing is inherited — this list is the
            whole story.
          </p>
        </div>
      )}
    </Popover>
  );
}

/* ────────────── Freshness row ────────────── */

function FreshnessRow({
  page,
  members,
  staleDays,
  onVerify,
  justVerified,
}: {
  page: PageFull;
  members: MemberRow[];
  staleDays: number;
  onVerify: () => void;
  justVerified: boolean;
}) {
  const verifiedByName = useMemo(() => {
    const m = members.find((x) => x.user_id === page.verified_by);
    return m?.profiles?.full_name || m?.profiles?.email || null;
  }, [members, page.verified_by]);

  const ageMs = Date.now() - new Date(page.verified_at).getTime();
  const isStale = ageMs > staleDays * 24 * 60 * 60 * 1000;

  if (justVerified) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-accentRing bg-accentTint px-3 py-2 text-meta text-accent"
        style={{ borderRadius: 10 }}
      >
        <Glyph
          path="M5 12l5 5 9-11"
          className="h-4 w-4"
        />
        <span className="font-bold">
          Verified just now by you — thanks for keeping this fresh.
        </span>
      </div>
    );
  }

  if (isStale) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-amberRing bg-amberTint px-3 py-2 text-meta"
        style={{ borderRadius: 10 }}
      >
        <Glyph
          path="M12 3l10 18H2L12 3zM12 10v5M12 18h.01"
          className="h-4 w-4 text-amberInk"
        />
        <span className="font-bold text-amberInk">
          Not verified in {relTime(page.verified_at).replace(" ago", "")} — may
          be stale.
        </span>
        <button
          type="button"
          onClick={onVerify}
          className="ml-auto rounded-md border border-amberRing bg-surface px-2 py-1 text-caption font-bold text-amberInk hover:bg-amberTint"
        >
          Still accurate ✓
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-line bg-track px-3 py-2 text-meta text-body"
      style={{ borderRadius: 10 }}
    >
      <Glyph
        path="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5L16 9.5"
        className="h-4 w-4 text-accent"
      />
      <span>
        Verified {relTime(page.verified_at)}
        {verifiedByName ? ` by ${verifiedByName}` : ""}
      </span>
      <button
        type="button"
        onClick={onVerify}
        className="ml-auto rounded-md border border-line bg-surface px-2 py-1 text-caption font-bold text-body hover:bg-rail"
      >
        Still accurate ✓
      </button>
    </div>
  );
}


/* ────────────── Property strip ────────────── */

const PROPS_ORDER_TOP = ["area", "owner", "status", "tags"];

function labelFor(key: string, defs: PropDef[]): string {
  const d = defs.find((x) => x.key === key);
  return d?.label ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function PropertyStrip({
  page,
  propDefs,
  members,
  pages,
  onSet,
}: {
  page: PageFull;
  propDefs: PropDef[];
  members: MemberRow[];
  pages: PageListItem[];
  onSet: (key: string, value: unknown) => void;
}) {
  const propsRec = propsOf(page);

  const registered = new Set(propDefs.map((d) => d.key));
  const present = new Set(Object.keys(propsRec));
  const extra = [...present].filter(
    (k) => registered.has(k) && !PROPS_ORDER_TOP.includes(k),
  );

  const rows = [
    ...PROPS_ORDER_TOP.map((k) => ({ key: k })),
    ...extra.map((k) => ({ key: k })),
  ];

  const areas = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      const a = propsOf(p)["area"];
      if (typeof a === "string" && a) s.add(a);
    }
    return [...s].sort();
  }, [pages]);

  const [adding, setAdding] = useState(false);
  const unusedRegistered = propDefs
    .filter((d) => !present.has(d.key))
    .filter((d) => d.key !== "area" && d.key !== "owner");

  return (
    <div className="mt-6">
      {rows.map((r) => (
        <div
          key={r.key}
          className="flex items-center gap-3 px-1"
          style={{ minHeight: 32 }}
        >
          <div
            className="shrink-0 text-meta text-muted"
            style={{ width: 132 }}
          >
            {labelFor(r.key, propDefs)}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="inline-block rounded-md hover:bg-sunken"
              style={{ padding: "3px 8px", margin: "0 -8px" }}
            >
              <PropertyEditor
                propKey={r.key}
                page={page}
                propDefs={propDefs}
                members={members}
                areas={areas}
                onSet={onSet}
              />
            </div>
          </div>
        </div>
      ))}


      <div
        className="flex items-center gap-2 rounded-md px-1"
        style={{ minHeight: 32 }}
      >
        <div className="shrink-0 text-meta text-muted" style={{ width: 132 }}>
          Last verified
        </div>
        <div className="min-w-0 flex-1 text-meta text-secondary">
          {relTime(page.verified_at)}
        </div>
      </div>

      <div className="mt-1">
        {adding ? (
          <div
            className="flex items-center gap-2 rounded-md border border-line bg-surface p-1"
            style={{ maxWidth: 320 }}
          >
            <div className="max-h-64 flex-1 overflow-y-auto">
              {unusedRegistered.length === 0 ? (
                <p className="px-2 py-1 text-meta text-muted">
                  Every registered property is already on this page.
                </p>
              ) : (
                unusedRegistered.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
                    onClick={() => {
                      // Seed with an empty-but-typed value the trigger accepts.
                      const seed: unknown =
                        d.type === "multi_select"
                          ? []
                          : d.type === "checkbox"
                            ? false
                            : d.type === "number"
                              ? 0
                              : d.type === "select" ||
                                  d.type === "status"
                                ? ((d.options as unknown as Array<{
                                    value: string;
                                  }>) ?? [])[0]?.value ?? null
                                : "";
                      if (seed === null) {
                        setAdding(false);
                        return;
                      }
                      onSet(d.key, seed);
                      setAdding(false);
                    }}
                  >
                    <span className="text-faint">
                      {d.type[0].toUpperCase()}
                    </span>
                    <span>{d.label}</span>
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              className="rounded-sm px-2 py-1 text-caption text-muted hover:bg-rail"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md px-1 py-1 text-meta text-muted hover:bg-sunken"
          >
            + Add a property
          </button>
        )}
      </div>
    </div>
  );
}

/* Editors — thin wrappers around the same popover shapes the table uses.
   We inline them here (rather than exporting from main-view) to avoid
   coupling the page editor to the table module. */

function PropertyEditor({
  propKey,
  page,
  propDefs,
  members,
  areas,
  onSet,
}: {
  propKey: string;
  page: PageFull;
  propDefs: PropDef[];
  members: MemberRow[];
  areas: string[];
  onSet: (key: string, value: unknown) => void;
}) {
  const def = propDefs.find((d) => d.key === propKey);
  const raw = propsOf(page)[propKey];
  const missingLabel = (() => {
    if (propKey === "area") return "No area";
    if (propKey === "owner" || def?.type === "person") return "No owner";
    if (propKey === "tags" || def?.type === "multi_select") return "No tags";
    const lbl = (def?.label ?? propKey).toLowerCase();
    return `No ${lbl}`;
  })();
  const Missing = () => (
    <span className="italic text-whisper">{missingLabel}</span>
  );


  if (propKey === "area") {
    const [neu, setNeu] = useState("");
    return (
      <Popover
        width={240}
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className="w-full rounded-sm px-1 py-1 text-left text-meta hover:bg-rail"
          >
            {typeof raw === "string" && raw ? (
              raw
            ) : (
              <Missing />
            )}
          </button>
        )}
      >
        {(close) => (
          <div>
            {areas.map((a) => (
              <button
                key={a}
                type="button"
                className="w-full rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
                onClick={() => {
                  onSet(propKey, a);
                  close();
                }}
              >
                {a}
              </button>
            ))}
            <div className="my-1 border-t border-lineSoft" />
            <div className="flex gap-1 p-1">
              <input
                value={neu}
                onChange={(e) => setNeu(e.target.value)}
                placeholder="Move to new area…"
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-meta"
              />
              <button
                type="button"
                disabled={!neu.trim()}
                onClick={() => {
                  onSet(propKey, neu.trim());
                  close();
                }}
                className="rounded-sm bg-noir px-2 text-meta font-bold text-canvas disabled:opacity-40"
              >
                Set
              </button>
            </div>
            <button
              type="button"
              className="w-full rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-rail"
              onClick={() => {
                onSet(propKey, null);
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

  if (def?.type === "person" || propKey === "owner") {
    const current = members.find((m) => m.user_id === raw);
    return (
      <Popover
        width={260}
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-meta hover:bg-rail"
          >
            {current ? (
              <>
                <MiniAvatar profile={current.profiles} />
                <span className="truncate">{current.profiles?.full_name}</span>
              </>
            ) : (
              <Missing />
            )}
          </button>
        )}
      >
        {(close) => (
          <div className="max-h-64 overflow-y-auto">
            {members.map((m) => (
              <button
                key={m.user_id}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
                onClick={() => {
                  onSet(propKey, m.user_id);
                  close();
                }}
              >
                <MiniAvatar profile={m.profiles} />
                <span>{m.profiles?.full_name}</span>
              </button>
            ))}
            <div className="my-1 border-t border-lineSoft" />
            <button
              type="button"
              className="w-full rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-rail"
              onClick={() => {
                onSet(propKey, null);
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
      <Popover
        width={200}
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className="rounded-sm px-1 py-1 text-left"
          >
            {cur ? (
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
            ) : (
              <Missing />
            )}
          </button>
        )}
      >
        {(close) => (
          <div>
            {opts.map((o) => (
              <button
                key={o.value}
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1 text-left hover:bg-rail"
                onClick={() => {
                  onSet(propKey, o.value);
                  close();
                }}
              >
                <span
                  className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption"
                  style={{
                    background: `var(--color-${o.tint})`,
                    color: `var(--color-${o.ink})`,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: `var(--color-${o.ink})` }}
                  />
                  {o.label}
                </span>
              </button>
            ))}
            <div className="my-1 border-t border-lineSoft" />
            <button
              type="button"
              className="w-full rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-rail"
              onClick={() => {
                onSet(propKey, null);
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

  if (def?.type === "multi_select" || propKey === "tags") {
    const tags = Array.isArray(raw) ? raw.map(String) : [];
    const [neu, setNeu] = useState("");
    return (
      <Popover
        width={260}
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className="flex w-full flex-wrap items-center gap-1 rounded-sm px-1 py-1 text-left"
          >
            {tags.length === 0 && <Missing />}
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-sm bg-sunken px-1.5 py-0.5 text-caption text-body"
              >
                {t}
              </span>
            ))}
          </button>
        )}
      >
        {(close) => (
          <div>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-meta hover:bg-rail"
                onClick={() => onSet(propKey, tags.filter((x) => x !== t))}
              >
                <span>{t}</span>
                <span className="text-caption text-faint">Remove</span>
              </button>
            ))}
            <div className="flex gap-1 p-1">
              <input
                value={neu}
                onChange={(e) => setNeu(e.target.value)}
                placeholder="New tag…"
                className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1 text-meta"
              />
              <button
                type="button"
                disabled={!neu.trim()}
                onClick={() => {
                  onSet(propKey, [...tags, neu.trim()]);
                  setNeu("");
                  close();
                }}
                className="rounded-sm bg-noir px-2 text-meta font-bold text-canvas disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </Popover>
    );
  }

  if (def?.type === "checkbox") {
    return (
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-meta hover:bg-rail">
        <input
          type="checkbox"
          checked={!!raw}
          onChange={(e) => onSet(propKey, e.target.checked)}
        />
        <span className="text-secondary">{raw ? "Yes" : "No"}</span>
      </label>
    );
  }

  if (def?.type === "number") {
    return (
      <input
        type="number"
        defaultValue={typeof raw === "number" ? raw : ""}
        onBlur={(e) => {
          const n = e.target.value === "" ? null : Number(e.target.value);
          if (n !== raw) onSet(propKey, n);
        }}
        className="w-full rounded-sm bg-transparent px-1 py-1 text-meta hover:bg-rail focus:bg-surface focus:outline-none"
      />
    );
  }

  // Text / date / default
  return (
    <input
      type={def?.type === "date" ? "date" : "text"}
      defaultValue={typeof raw === "string" ? raw : ""}
      placeholder={missingLabel}
      onBlur={(e) => {
        const v = e.target.value;
        if (v !== raw) onSet(propKey, v === "" ? null : v);
      }}
      className="w-full rounded-sm bg-transparent px-1 py-1 text-meta hover:bg-rail focus:bg-surface focus:outline-none placeholder:text-faint"
    />
  );
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

/* ────────────── Body ────────────── */

function ReadOnlyBody({ blocks }: { blocks: Block[] }) {
  useFlashOnHash(blocks);
  const { prefs } = usePrefs();
  if (!blocks.length) {
    return (
      <p className="mt-6 text-meta italic text-faint">
        This page has no body yet. The editor lands in a later batch.
      </p>
    );
  }
  return (
    <div
      id="page-body"
      tabIndex={-1}
      data-font={prefs.fontFamily}
      className="gio-page-body mt-6 space-y-4 focus:outline-none"
    >
      {blocks.map((b, i) => {
        const text = (b.text ?? b.body ?? "").trim();
        if (!text) return null;
        const t = b.type ?? "p";
        const blockId = typeof b.id === "string" ? b.id : undefined;
        const anchor = blockId ? `block-${blockId}` : undefined;
        const commonProps = {
          id: anchor,
          "data-block-id": blockId,
        } as const;
        if (t === "h1")
          return (
            <h2 key={i} {...commonProps} className="font-display text-heading text-noir">
              {text}
            </h2>
          );
        if (t === "h2" || t === "h3")
          return (
            <h3 key={i} {...commonProps} className="font-display text-subhead text-noir">
              {text}
            </h3>
          );
        if (t === "quote")
          return (
            <blockquote
              key={i}
              {...commonProps}
              className="border-l-2 border-line pl-3 text-quote text-secondary"
            >
              {text}
            </blockquote>
          );
        return (
          <p key={i} {...commonProps} className="text-prose text-body">
            {text}
          </p>
        );
      })}
    </div>
  );
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const s = window.getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(s.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function useFlashOnHash(blocks: Block[]) {
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

/* ────────────── Page editor container ────────────── */

export function PageEditor({ pageId }: { pageId: string }) {
  const ws = useWorkspaceId();
  const { user: _user } = useAuth();
  const shell = useWorkspaceShell(ws);
  const pageQ = usePage(pageId);
  const accessQ = usePageAccess(pageId);
  const rename = useRenamePage();
  const setProp = useSetPageProperty();
  const verify = useVerifyPage();
  const qc = useQueryClient();
  const { prefs } = usePrefs();
  useEffect(() => {
    setDateModeForPageView(prefs.dateFormat);
  }, [prefs.dateFormat]);


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
  const pages = (shell.pages.data ?? []) as PageListItem[];
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const propDefs = (shell.propDefs.data ?? []) as PropDef[];
  const workspace = shell.workspace.data;
  const workspaceName = workspace?.name ?? "";
  const staleDays = workspace?.stale_days ?? 30;
  const access = accessQ.data ?? [];

  const areaAccessNorm = useMemo(() => {
    if (!page) return { hasGuests: false };
    const area = propsOf(page)["area"];
    if (typeof area !== "string" || !area) return { hasGuests: false };
    // Heuristic: does any *other* page in this area carry a guest?
    // Because we only have list-level page rows here (no access list per row),
    // we approximate "the rest of the area has no guests" as false when
    // no other page uses restricted access. This is intentionally conservative.
    const otherRestricted = pages.some(
      (p) =>
        p.id !== page.id &&
        propsOf(p)["area"] === area &&
        p.access_type !== "workspace",
    );
    return { hasGuests: otherRestricted };
  }, [page, pages]);

  const editorName = useMemo(() => {
    if (!page) return null;
    const m = members.find((x) => x.user_id === page.edited_by);
    return m?.profiles?.full_name || m?.profiles?.email || null;
  }, [members, page]);


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
        className="mx-auto py-12"
        style={{ maxWidth: "var(--container-page)", padding: "42px 44px" }}
      >
        <p className="text-meta text-muted">Loading page…</p>
      </div>
    );
  }

  if (!page) {
    return (
      <div
        className="mx-auto py-12"
        style={{ maxWidth: "var(--container-page)", padding: "42px 44px" }}
      >
        <h1 className="font-display text-title text-noir">Page not found</h1>
        <p className="mt-2 text-meta text-muted">
          It may have been deleted, or you don't have access.
        </p>
      </div>
    );
  }



  const blocks: Block[] = Array.isArray(page.blocks)
    ? (page.blocks as Block[])
    : [];

  return (
    <div
      className="mx-auto"
      style={{
        maxWidth: "var(--container-page)",
        padding: "42px 44px",
      }}
    >
      {/* 1. Icon + Title */}
      <div className="flex items-start gap-3">
        <IconPicker
          value={page.icon || "📄"}
          onPick={(icon) => setProp.mutate({ pageId: page.id, key: "icon", value: icon })}
        />
        <div className="min-w-0 flex-1">
          <TitleField
            page={page}
            onRename={(t) => rename.mutate({ pageId: page.id, title: t })}
          />
        </div>
      </div>

      {/* 2. Permissions chip */}
      <div className="mt-3">
        <PermissionsChip
          page={page}
          workspaceName={workspaceName}
          members={members}
          access={access}
          areaAccessNorm={areaAccessNorm}
        />
      </div>

      {/* 3. Freshness row */}
      <div className="mt-4">
        <FreshnessRow
          page={page}
          members={members}
          staleDays={staleDays}
          onVerify={onVerify}
          justVerified={justVerified}
        />
      </div>

      {/* Quiet edited line */}
      <p className="mt-2 text-caption text-whisper">
        Edited {relTime(page.edited_at)} · {editorName}
      </p>

      {/* 4. Property strip */}
      <PropertyStrip
        page={page}
        propDefs={propDefs}
        members={members}
        pages={pages}
        onSet={(key, value) => {
          if (key === "icon") {
            // Icon is a column, not a property. Route through a small helper.
            void updatePageIcon(page.id, value as string, qc, ws);
            return;
          }
          setProp.mutate({ pageId: page.id, key, value });
        }}
      />

      {/* 5. Divider */}
      <div className="mt-6 border-t border-lineSoft" />

      {/* Body */}
      <ReadOnlyBody blocks={blocks} />
    </div>
  );
}

/* Icon updates go directly to the pages table since icon is a column,
   not a jsonb prop. We keep this here to avoid churn in mutations file. */
async function updatePageIcon(
  pageId: string,
  icon: string,
  qc: ReturnType<typeof useQueryClient>,
  _ws: string,
) {
  const { supabase } = await import("@/integrations/supabase/client");
  await supabase.from("pages").update({ icon }).eq("id", pageId);
  qc.invalidateQueries({ queryKey: qk.page(pageId) });
}

/* Small emoji picker — 24 common emojis, no external lib. */
const EMOJI_ROSTER = [
  "📄","📓","📘","📕","📗","📙","🗂","🗒","📝","📌","🔧","🧭","🎨","🤝","📦","🚀","🐛","💡","🔍","⚙️","🧪","🧱","🧰","🗺️",
];

function IconPicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (icon: string) => void;
}) {
  return (
    <Popover
      width={288}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          aria-label="Change icon"
          className="grid shrink-0 place-items-center rounded-md hover:bg-sunken"
          style={{ height: 44, width: 44, fontSize: 32, lineHeight: 1 }}
        >
          <span aria-hidden>{value}</span>
        </button>
      )}
    >
      {(close) => {
        const favorites = useEmojiFavorites();
        const seen = new Set<string>();
        const list = [...favorites, ...EMOJI_ROSTER].filter((e) => {
          if (seen.has(e)) return false;
          seen.add(e);
          return true;
        });
        return (
          <div className="grid grid-cols-8 gap-1 p-1">
            {list.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onPick(e);
                  close();
                }}
                className="grid h-8 w-8 place-items-center rounded-sm text-row hover:bg-rail"
              >
                {e}
              </button>
            ))}
          </div>
        );
      }}
    </Popover>
  );
}
