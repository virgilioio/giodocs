import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import {
  useWorkspaceShell,
  useAllowedDomains,
} from "@/hooks/use-workspace-data";
import {
  useUpdateWorkspace,
  useAddAllowedDomain,
  useRemoveAllowedDomain,
  useUpdateMemberRole,
  useRemoveMember,
} from "@/hooks/use-workspace-mutations";
import { useCreateView } from "@/hooks/use-page-mutations";
import { usePrefs, type FontFamily, type Density, type DateFormatMode } from "@/lib/preferences";
import {
  useEmojiFavorites,
  addFavorite,
  removeFavorite,
} from "@/lib/emoji-favorites";
import { useFormatDate } from "@/lib/format";
import type { PageListItem } from "@/lib/types";

type Pane = "preferences" | "general" | "people" | "emoji";

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

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

/* ─────────────────────────── Modal shell ─────────────────────────── */

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pane, setPane] = useState<Pane>("preferences");

  // Escape closes before any other layer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      style={{ background: "rgba(13,13,9,.32)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex overflow-hidden rounded-[14px] border border-line bg-surface shadow-modal animate-cardIn"
        style={{ width: "min(1000px, 100vw - 32px)", height: "min(860px, 100vh - 64px)" }}
      >
        <SettingsNav pane={pane} onPick={setPane} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          {pane === "preferences" && <PreferencesPane />}
          {pane === "general" && <GeneralPane />}
          {pane === "people" && <PeoplePane onClose={onClose} />}
          {pane === "emoji" && <EmojiPane />}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Left rail ─────────────────────────── */

function SettingsNav({ pane, onPick }: { pane: Pane; onPick: (p: Pane) => void }) {
  const items: { key: Pane; label: string; path: string }[] = [
    { key: "preferences", label: "Preferences", path: "M4 12h6M14 12h6M12 4v6M12 14v6" },
    { key: "general", label: "General", path: "M12 4l8 4v8l-8 4-8-4V8z" },
    { key: "people", label: "People", path: "M8 12a3 3 0 100-6 3 3 0 000 6zm8 0a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 6-5s6 2 6 5m2 0c0-2 2-4 4-4s4 2 4 4" },
    { key: "emoji", label: "Emoji", path: "M12 21a9 9 0 100-18 9 9 0 000 18zM8 10h.01M16 10h.01M8 14c1 2 3 3 4 3s3-1 4-3" },
  ];
  return (
    <nav
      className="shrink-0 border-r border-line bg-track p-2"
      style={{ width: "var(--spacing-settingsRail)" }}
      aria-label="Settings sections"
    >
      <div className="px-2 pb-2 pt-1 text-label uppercase text-faint">SETTINGS</div>
      <ul>
        {items.map((it) => {
          const active = pane === it.key;
          return (
            <li key={it.key}>
              <button
                type="button"
                onClick={() => onPick(it.key)}
                style={{ height: 31 }}
                className={
                  "flex w-full items-center gap-2 rounded-md px-2 text-row " +
                  (active
                    ? "bg-selected font-bold text-noir"
                    : "text-body hover:bg-railHover")
                }
                aria-current={active ? "page" : undefined}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={"h-4 w-4 " + (active ? "text-noir" : "text-faint")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d={it.path} />
                </svg>
                {it.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ─────────────────────────── Pane header ─────────────────────────── */

function PaneHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border-b border-lineSoft px-8 pb-4 pt-6">
      <h2 className="font-display text-title text-noir">{title}</h2>
      <p className="mt-1 text-meta text-secondary">{sub}</p>
    </div>
  );
}

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-6 py-4">
      <div>
        <div className="text-ui font-bold text-noir">{label}</div>
        {help && <div className="mt-1 text-caption text-secondary">{help}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              "rounded-sm px-3 py-1 text-ui " +
              (active ? "bg-selected font-bold text-noir" : "text-secondary hover:bg-rail")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors " +
        (value ? "bg-accent" : "bg-lineStrong")
      }
    >
      <span
        className="inline-block h-4 w-4 rounded-full bg-canvas transition-transform"
        style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

/* ─────────────────────────── Preferences pane ─────────────────────────── */

function PreferencesPane() {
  const { prefs, set } = usePrefs();
  return (
    <div>
      <PaneHeader
        title="Preferences"
        sub="Personal — per device. Nothing here is visible to your teammates."
      />
      <div className="px-8 py-2">
        <Row label="Default page font" help="Applies to page body text — headings stay Poppins.">
          <Segmented<FontFamily>
            value={prefs.fontFamily}
            onChange={(v) => set("fontFamily", v)}
            options={[
              { value: "default", label: "Default" },
              { value: "serif", label: "Serif" },
              { value: "mono", label: "Mono" },
            ]}
          />
        </Row>
        <Row label="Density" help="Compact tightens table and list rows.">
          <Segmented<Density>
            value={prefs.density}
            onChange={(v) => set("density", v)}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </Row>
        <Row label="Date format" help="Changes every timestamp in the app.">
          <Segmented<DateFormatMode>
            value={prefs.dateFormat}
            onChange={(v) => set("dateFormat", v)}
            options={[
              { value: "relative", label: "Relative" },
              { value: "absolute", label: "Absolute" },
            ]}
          />
        </Row>
        <Row label="Explain the query above every view" help="Shows a plain-English sentence of what the current query returns.">
          <Toggle value={prefs.explainQuery} onChange={(v) => set("explainQuery", v)} />
        </Row>
        <Row label="Show counts in the sidebar" help="Numbers next to views and areas.">
          <Toggle value={prefs.showSidebarCounts} onChange={(v) => set("showSidebarCounts", v)} />
        </Row>
      </div>
    </div>
  );
}

/* ─────────────────────────── General pane ─────────────────────────── */

const WS_EMOJI = ["🧭", "🏛", "🚀", "📚", "🧪", "🎯", "🛠", "🌱", "☕", "🐙", "🦉", "🌿"];

function GeneralPane() {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const workspace = shell.workspace.data;
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const pages = (shell.pages.data ?? []) as PageListItem[];
  const views = shell.views.data ?? [];

  const { user } = useAuth();
  const isOwner = members.find((m) => m.user_id === user?.id)?.role === "owner";

  const domainsQ = useAllowedDomains(ws);
  const updateWs = useUpdateWorkspace();
  const addDomain = useAddAllowedDomain();
  const removeDomain = useRemoveAllowedDomain();

  const [nameDraft, setNameDraft] = useState(workspace?.name ?? "");
  useEffect(() => setNameDraft(workspace?.name ?? ""), [workspace?.name]);

  const staleDays = workspace?.stale_days ?? 90;
  const [sliderDays, setSliderDays] = useState(staleDays);
  useEffect(() => setSliderDays(staleDays), [staleDays]);

  const staleNow = useMemo(() => {
    const threshold = Date.now() - sliderDays * 24 * 60 * 60 * 1000;
    return pages.filter((p) => new Date(p.verified_at).getTime() < threshold).length;
  }, [pages, sliderDays]);

  const areaCount = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      const a = propsOf(p)["area"];
      if (typeof a === "string" && a) s.add(a);
    }
    return s.size;
  }, [pages]);

  const [newDomain, setNewDomain] = useState("");

  return (
    <div>
      <PaneHeader
        title="General"
        sub={
          isOwner
            ? "Workspace settings — everyone here sees these changes."
            : "Workspace settings — only owners can edit."
        }
      />
      <div className="px-8 py-2">
        <Row label="Name" help="Shows in the sidebar and every permission line.">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            disabled={!isOwner}
            onBlur={() => {
              const clean = nameDraft.trim();
              if (clean && clean !== workspace?.name) updateWs.mutate({ name: clean });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full max-w-sm rounded-md border border-line bg-surface px-3 py-2 text-ui focus:outline-none disabled:opacity-60"
          />
        </Row>

        <Row label="Icon" help="A single emoji.">
          <div className="flex flex-wrap gap-1">
            {WS_EMOJI.map((e) => {
              const active = workspace?.icon === e;
              return (
                <button
                  key={e}
                  type="button"
                  disabled={!isOwner}
                  onClick={() => updateWs.mutate({ icon: e })}
                  className={
                    "grid h-9 w-9 place-items-center rounded-md text-row " +
                    (active
                      ? "bg-selected ring-2 ring-noir"
                      : "hover:bg-rail")
                  }
                >
                  {e}
                </button>
              );
            })}
          </div>
        </Row>

        <Row
          label="Pages need re-verifying after"
          help="Older than this and a page is flagged as stale."
        >
          <div className="max-w-md">
            <input
              type="range"
              min={30}
              max={365}
              step={1}
              value={sliderDays}
              disabled={!isOwner}
              onChange={(e) => setSliderDays(Number(e.target.value))}
              onMouseUp={() => {
                if (sliderDays !== staleDays && isOwner)
                  updateWs.mutate({ stale_days: sliderDays });
              }}
              onTouchEnd={() => {
                if (sliderDays !== staleDays && isOwner)
                  updateWs.mutate({ stale_days: sliderDays });
              }}
              className="w-full"
            />
            <div className="mt-2 flex items-center justify-between text-meta text-secondary">
              <span>
                <b className="text-noir">{sliderDays}</b> days
              </span>
              <span className={staleNow > 0 ? "text-amberInk" : "text-muted"}>
                {staleNow} stale now
              </span>
            </div>
          </div>
        </Row>

        <Row
          label="Allowed email domains"
          help="Anyone signing up with one of these joins automatically."
        >
          <div className="flex max-w-lg flex-wrap items-center gap-2">
            {(domainsQ.data ?? []).map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-sunken px-2.5 py-1 text-meta"
              >
                @{d}
                {isOwner && (
                  <button
                    type="button"
                    aria-label={`Remove ${d}`}
                    onClick={() => removeDomain.mutate(d)}
                    className="text-faint hover:text-strong"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {isOwner && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = newDomain.trim();
                  if (!v) return;
                  addDomain.mutate(v, { onSuccess: () => setNewDomain("") });
                }}
                className="inline-flex items-center gap-1"
              >
                <input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="add domain…"
                  className="w-40 rounded-full border border-dashed border-lineStrong bg-surface px-3 py-1 text-meta focus:outline-none"
                />
              </form>
            )}
          </div>
        </Row>

        <Row label="Structure" help="How this workspace is shaped, in numbers.">
          <div className="max-w-lg text-meta text-secondary">
            Pages live wherever their properties say — no folders, no nesting.
            A view is just a saved query.
            <div className="mt-2 flex flex-wrap gap-2">
              <StatChip>{pages.length} pages</StatChip>
              <StatChip>{areaCount} areas</StatChip>
              <StatChip>{views.length} saved views</StatChip>
              <StatChip bold>0 folders</StatChip>
            </div>
          </div>
        </Row>
      </div>
    </div>
  );
}

function StatChip({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-md border border-line bg-sunken px-2.5 py-1 text-caption text-secondary " +
        (bold ? "font-bold text-noir" : "")
      }
    >
      {children}
    </span>
  );
}

/* ─────────────────────────── People pane ─────────────────────────── */

function PeoplePane({ onClose }: { onClose: () => void }) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const workspace = shell.workspace.data;
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const pages = (shell.pages.data ?? []) as PageListItem[];

  const { user } = useAuth();
  const isOwner = members.find((m) => m.user_id === user?.id)?.role === "owner";
  const staleDays = workspace?.stale_days ?? 90;
  const staleThreshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const [tab, setTab] = useState<"members" | "guests">("members");
  const [inviteLinkOn, setInviteLinkOn] = useState(true);

  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const createView = useCreateView();
  const navigate = useNavigate();

  const ownedBy = useMemo(() => {
    const m = new Map<string, PageListItem[]>();
    for (const p of pages) {
      const o = propsOf(p)["owner"];
      if (typeof o === "string") {
        const arr = m.get(o) ?? [];
        arr.push(p);
        m.set(o, arr);
      }
    }
    return m;
  }, [pages]);

  const guestsByEmail = useMemo(() => {
    // Guests derive from page_access — we don't have that data hydrated here for the whole
    // workspace, so this list is derived from access rows attached to pages we know about.
    // For members-only info we count pages a guest can access indirectly (none available here).
    return new Map<string, number>();
  }, []);

  const withOwner = pages.filter((p) => typeof propsOf(p)["owner"] === "string").length;
  const pagesWithoutOwner = pages.length - withOwner;

  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "";

  return (
    <div>
      <PaneHeader
        title="People"
        sub={
          isOwner
            ? "Members and their pages. Roles are editable inline."
            : "Members and their pages. Only owners can change roles."
        }
      />
      <div className="px-8 py-4">
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Members" value={members.length} />
          <StatCard label="Guests" value={guestsByEmail.size} />
          <StatCard label="Pages with an owner" value={`${withOwner} / ${pages.length}`} sub={`${pagesWithoutOwner} unowned`} />
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-track px-3 py-2 text-meta">
          <Toggle value={inviteLinkOn} onChange={setInviteLinkOn} />
          <span className="text-body">Invite link</span>
          <span className="text-muted">
            {inviteLinkOn
              ? "Anyone with the link can request to join."
              : "Turned off — only allowed-domain sign-ups can join."}
          </span>
          <button
            type="button"
            disabled={!inviteLinkOn}
            onClick={() => {
              if (typeof navigator !== "undefined" && inviteUrl) {
                navigator.clipboard?.writeText(inviteUrl);
              }
            }}
            className="ml-auto rounded-md border border-line bg-surface px-2 py-1 text-meta hover:bg-rail disabled:opacity-40"
          >
            Copy link
          </button>
        </div>

        <div className="mt-4 flex items-center gap-1 border-b border-line">
          {(["members", "guests"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "-mb-px border-b-2 px-3 py-2 text-ui " +
                (tab === t
                  ? "border-noir font-bold text-noir"
                  : "border-transparent text-secondary hover:text-body")
              }
            >
              {t === "members" ? "Members" : "Guests"}
            </button>
          ))}
        </div>

        {tab === "members" ? (
          <div className="pt-2">
            {members.map((m) => {
              const owned = ownedBy.get(m.user_id) ?? [];
              const staleCount = owned.filter(
                (p) => new Date(p.verified_at).getTime() < staleThreshold,
              ).length;
              const name =
                m.profiles?.full_name || m.profiles?.email || "Unknown";
              const isMe = m.user_id === user?.id;
              const canRemove = isOwner && !isMe && owned.length === 0;
              return (
                <div
                  key={m.user_id}
                  className="grid grid-cols-[minmax(0,1fr)_90px_90px_140px_32px] items-center gap-3 border-b border-lineSoft py-3 text-meta"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <MemberAvatar profile={m.profiles} />
                    <div className="min-w-0">
                      <div className="truncate text-row font-bold text-noir">{name}</div>
                      <div className="truncate text-caption text-muted">
                        {m.profiles?.email}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (owned.length === 0) return;
                      createView.mutate(
                        {
                          name: `Owned by ${name}`,
                          filter: [{ op: "eq", prop: "owner", value: m.user_id }],
                          sort: { prop: "edited", dir: "desc" },
                          layout: "table",
                        },
                        {
                          onSuccess: (row) => {
                            onClose();
                            navigate({ to: "/v/$viewId", params: { viewId: row.id } });
                          },
                        },
                      );
                    }}
                    disabled={owned.length === 0}
                    className="text-left tabular-nums text-body hover:text-noir disabled:cursor-default disabled:text-faint"
                    title={owned.length ? "Open as a saved view" : "Owns nothing"}
                  >
                    <span className="text-caption text-faint">Owns</span>{" "}
                    <b>{owned.length}</b>
                  </button>
                  <div className="tabular-nums">
                    <span className="text-caption text-faint">Stale</span>{" "}
                    <b className={staleCount ? "text-amberInk" : "text-faint"}>
                      {staleCount}
                    </b>
                  </div>
                  <select
                    value={m.role}
                    disabled={!isOwner || isMe}
                    onChange={(e) =>
                      updateRole.mutate({
                        userId: m.user_id,
                        role: e.target.value as "owner" | "member",
                      })
                    }
                    className="rounded-md border border-line bg-surface px-2 py-1 text-meta focus:outline-none disabled:opacity-70"
                  >
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    disabled={!canRemove}
                    title={
                      isMe
                        ? "That's you"
                        : owned.length > 0
                          ? `Reassign ${owned.length} page${owned.length === 1 ? "" : "s"} first`
                          : "Remove from workspace"
                    }
                    onClick={() => {
                      if (window.confirm(`Remove ${name} from this workspace?`)) {
                        removeMember.mutate(m.user_id);
                      }
                    }}
                    className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-rail hover:text-strong disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pt-6">
            <p className="text-meta text-secondary">
              Guests are people outside {workspace?.name ?? "this workspace"} who
              were given access to specific pages. There is no guest role to
              manage here — guest access lives on the page it was granted from.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-track px-3 py-2">
      <div className="text-label uppercase text-faint">{label}</div>
      <div className="mt-1 font-display text-heading text-noir tabular-nums">{value}</div>
      {sub && <div className="text-caption text-muted">{sub}</div>}
    </div>
  );
}

function MemberAvatar({ profile }: { profile: MemberRow["profiles"] }) {
  const initials = (profile?.full_name || profile?.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-caption font-bold"
      style={{
        background: profile?.avatar_tint ?? "var(--color-sunken)",
        color: profile?.avatar_ink ?? "var(--color-noir)",
      }}
    >
      {initials}
    </span>
  );
}

/* ─────────────────────────── Emoji pane ─────────────────────────── */

function EmojiPane() {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const pages = (shell.pages.data ?? []) as PageListItem[];
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const { user } = useAuth();
  const isOwner = members.find((m) => m.user_id === user?.id)?.role === "owner";
  const favorites = useEmojiFavorites();
  const fmt = useFormatDate();

  const [ownerOnlyAdd, setOwnerOnlyAdd] = useState(false);

  const inventory = useMemo(() => {
    const m = new Map<string, PageListItem[]>();
    for (const p of pages) {
      const icon = (p.icon ?? "").trim();
      if (!icon) continue;
      const arr = m.get(icon) ?? [];
      arr.push(p);
      m.set(icon, arr);
    }
    return [...m.entries()]
      .map(([emoji, pgs]) => {
        const lastEdited = pgs
          .map((p) => new Date(p.edited_at).getTime())
          .reduce((a, b) => (a > b ? a : b), 0);
        return { emoji, pages: pgs, count: pgs.length, lastEdited };
      })
      .sort((a, b) => b.count - a.count);
  }, [pages]);

  const [neu, setNeu] = useState("");

  const canAdd = !ownerOnlyAdd || isOwner;

  return (
    <div>
      <PaneHeader
        title="Emoji"
        sub="This inventory is derived from the pages that wear each icon."
      />
      <div className="px-8 py-2">
        <Row label="Only owners can add emoji" help="Doesn't stop teammates from picking existing ones.">
          <Toggle value={ownerOnlyAdd} onChange={setOwnerOnlyAdd} />
        </Row>

        <Row label="Favorites" help="These appear first in the page-icon picker.">
          <div className="flex flex-wrap items-center gap-2">
            {favorites.length === 0 && (
              <span className="text-caption italic text-faint">Nothing pinned yet.</span>
            )}
            {favorites.map((e) => (
              <span
                key={e}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-sunken px-2 py-1 text-row"
              >
                {e}
                <button
                  type="button"
                  aria-label={`Unpin ${e}`}
                  onClick={() => removeFavorite(e)}
                  className="text-faint hover:text-strong"
                >
                  ×
                </button>
              </span>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = neu.trim();
                if (!v || !canAdd) return;
                addFavorite(v);
                setNeu("");
              }}
              className="inline-flex items-center gap-1"
            >
              <input
                value={neu}
                onChange={(e) => setNeu(e.target.value)}
                placeholder="paste an emoji…"
                disabled={!canAdd}
                className="w-40 rounded-md border border-dashed border-lineStrong bg-surface px-2 py-1 text-meta focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!canAdd || !neu.trim()}
                className="rounded-md bg-noir px-2 py-1 text-meta font-bold text-canvas disabled:opacity-40"
              >
                Pin
              </button>
            </form>
          </div>
        </Row>

        <div className="mt-4 border-t border-lineSoft pt-4">
          <div className="mb-2 text-label uppercase text-faint">In use</div>
          {inventory.length === 0 && (
            <p className="text-meta text-secondary">
              No pages carry an emoji yet.
            </p>
          )}
          {inventory.map((it) => {
            const inUse = it.count > 0;
            const isFav = favorites.includes(it.emoji);
            return (
              <div
                key={it.emoji}
                className="grid grid-cols-[44px_minmax(0,1fr)_120px_96px] items-center gap-3 border-b border-lineSoft py-2 text-meta"
              >
                <span className="grid h-9 w-9 place-items-center text-row">
                  {it.emoji}
                </span>
                <div className="min-w-0 truncate text-secondary">
                  {it.pages
                    .slice(0, 4)
                    .map((p) => p.title || "Untitled")
                    .join(", ")}
                  {it.pages.length > 4 && ` +${it.pages.length - 4} more`}
                </div>
                <div className="tabular-nums text-muted">
                  <b className="text-noir">{it.count}</b>{" "}
                  page{it.count === 1 ? "" : "s"} · last edited{" "}
                  {fmt(new Date(it.lastEdited).toISOString())}
                </div>
                <div className="flex items-center justify-end gap-1">
                  {!isFav && canAdd && (
                    <button
                      type="button"
                      onClick={() => addFavorite(it.emoji)}
                      className="rounded-md border border-line bg-surface px-2 py-1 text-caption hover:bg-rail"
                    >
                      Pin
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={inUse}
                    title={
                      inUse
                        ? `${it.count} page${it.count === 1 ? "" : "s"} still use this — change them first`
                        : "Remove"
                    }
                    className="rounded-md px-2 py-1 text-caption text-faint hover:bg-rail hover:text-strong disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
