import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
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
import { usePrefs, type FontFamily, type Density, type DateFormatMode, type ThemePref } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { useFormatDate } from "@/lib/format";
import type { PageListItem } from "@/lib/types";
import type { PendingInvite } from "./add-members-modal";

export type SettingsPane = "profile" | "preferences" | "general" | "people" | "emoji";

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

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ─────────────────────────── Icons ─────────────────────────── */

function NavIcon({ d, active }: { d: string; active: boolean }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={active ? "text-noir" : "text-faint"}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICON_SLIDERS =
  "M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-4M20 13V3M1.5 15h5M9.5 8h5M17.5 17h5";
const ICON_GEAR =
  "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM19.6 14.4a1.5 1.5 0 0 0 .3 1.7l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.5 1.5 0 0 0-2.6-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.2a1.9 1.9 0 1 1 0-3.8h.1a1.5 1.5 0 0 0 1.1-2.6l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.5 1.5 0 0 0 2.6-1.1v-.2a1.9 1.9 0 1 1 3.8 0v.1a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.5 1.5 0 0 0-1.4.9z";
const ICON_PEOPLE =
  "M9 3.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM2 20.4v-1.8a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1.8M16.5 3.9a3.6 3.6 0 0 1 0 7M22 20.4v-1.8a4 4 0 0 0-3-3.8";
const ICON_SMILEY =
  "M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6zM8.7 14.4a4.4 4.4 0 0 0 6.6 0M9.2 9.6h.01M14.8 9.6h.01";
const ICON_CLOSE = "M6 6l12 12M18 6L6 18";
const ICON_PLUS = "M12 5v14M5 12h14";

/* ─────────────────────────── Modal shell ─────────────────────────── */

export function SettingsModal({
  open,
  pane,
  onPaneChange,
  onClose,
  pendingInvites,
  onRevokeInvite,
  onOpenInvite,
  membersTab,
  onMembersTabChange,
}: {
  open: boolean;
  pane: SettingsPane;
  onPaneChange: (p: SettingsPane) => void;
  onClose: () => void;
  pendingInvites: PendingInvite[];
  onRevokeInvite: (email: string) => void;
  onOpenInvite: () => void;
  membersTab: "members" | "guests";
  onMembersTabChange: (t: "members" | "guests") => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 110,
        background: "rgba(13,13,9,.32)",
        backdropFilter: "blur(3px)",
        padding: "4vh 3vw",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex bg-surface shadow-modal animate-palIn"
        style={{
          width: 1000,
          maxWidth: "100%",
          height: "100%",
          maxHeight: 860,
          borderRadius: 14,
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <SettingsNav pane={pane} onPick={onPaneChange} />
        <div className="relative min-w-0 flex-1 overflow-y-auto">
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="absolute right-4 top-4 grid place-items-center rounded-md text-whisper hover:bg-sunken"
            style={{ width: 26, height: 26, zIndex: 2 }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
              strokeLinejoin="round" aria-hidden>
              <path d={ICON_CLOSE} />
            </svg>
          </button>
          {pane === "preferences" && <PreferencesPane />}
          {pane === "general" && <GeneralPane />}
          {pane === "people" && (
            <PeoplePane
              onClose={onClose}
              pendingInvites={pendingInvites}
              onRevokeInvite={onRevokeInvite}
              onOpenInvite={onOpenInvite}
              tab={membersTab}
              onTabChange={onMembersTabChange}
            />
          )}
          {pane === "emoji" && <EmojiPane />}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Left rail ─────────────────────────── */

function SettingsNav({ pane, onPick }: { pane: SettingsPane; onPick: (p: SettingsPane) => void }) {
  const { user, profile } = useAuth();
  const name = profile?.full_name || user?.email || "";
  const email = user?.email || "";
  const initials = initialsOf(name || email || "?");

  type NavItem = { key: SettingsPane; label: string; path: string; group: "ACCOUNT" | "WORKSPACE" };
  const items: NavItem[] = [
    { key: "preferences", label: "Preferences", path: ICON_SLIDERS, group: "ACCOUNT" },
    { key: "general", label: "General", path: ICON_GEAR, group: "WORKSPACE" },
    { key: "people", label: "People", path: ICON_PEOPLE, group: "WORKSPACE" },
    { key: "emoji", label: "Emoji", path: ICON_SMILEY, group: "WORKSPACE" },
  ];

  const groups: Array<{ name: "ACCOUNT" | "WORKSPACE"; items: NavItem[] }> = [];
  for (const it of items) {
    const g = groups.find((x) => x.name === it.group);
    if (g) g.items.push(it);
    else groups.push({ name: it.group, items: [it] });
  }

  return (
    <nav
      className="shrink-0 overflow-y-auto border-r border-line bg-canvas"
      style={{ width: 214, padding: "16px 10px" }}
      aria-label="Settings sections"
    >
      {/* Identity card — NOT a nav row */}
      <div
        className="flex items-center bg-surface"
        style={{
          gap: 9,
          border: "1px solid var(--color-line)",
          borderRadius: 9,
          padding: "8px 9px",
          marginBottom: 12,
        }}
      >
        <span
          className="grid shrink-0 place-items-center rounded-full"
          style={{
            width: 28,
            height: 28,
            background: profile?.avatar_tint ?? "var(--color-sunken)",
            color: profile?.avatar_ink ?? "var(--color-noir)",
            fontSize: 10.5,
            fontWeight: 700,
          }}
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-noir" style={{ fontSize: 13.5, fontWeight: 700 }}>
            {name || email || "You"}
          </div>
          <div className="truncate text-faint" style={{ fontSize: 11.5 }}>
            {email}
          </div>
        </div>
      </div>

      {groups.map((group, gi) => (
        <div key={group.name}>
          <div
            className="text-faint"
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.085em",
              padding: "6px 8px",
              marginTop: gi === 0 ? 0 : 12,
              borderTop: gi === 0 ? "none" : "1px solid var(--color-line)",
              paddingTop: gi === 0 ? 6 : 12,
            }}
          >
            {group.name}
          </div>
          <ul>
            {group.items.map((it) => {
              const active = pane === it.key;
              return (
                <li key={it.key}>
                  <button
                    type="button"
                    onClick={() => onPick(it.key)}
                    style={{
                      height: 31,
                      padding: "0 9px",
                      gap: 9,
                    }}
                    className={
                      "flex w-full items-center rounded-lg text-body " +
                      (active
                        ? "bg-selected text-noir"
                        : "hover:bg-railHover")
                    }
                    aria-current={active ? "page" : undefined}
                  >
                    <NavIcon d={it.path} active={active} />
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: active ? 700 : 400,
                      }}
                    >
                      {it.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* ─────────────────────────── Pane header ─────────────────────────── */

function PaneHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ padding: "26px 30px 14px" }}>
      <h2
        className="font-display text-noir"
        style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 1.15 }}
      >
        {title}
      </h2>
      <p className="text-secondary" style={{ fontSize: 15, marginTop: 4, maxWidth: 640 }}>
        {sub}
      </p>
    </div>
  );
}

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div
      className="flex items-start justify-between border-t border-lineSoft"
      style={{ padding: "16px 0", gap: 24 }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-noir" style={{ fontSize: 14.5, fontWeight: 700 }}>
          {label}
        </div>
        {help && (
          <div className="text-muted" style={{ fontSize: 13.5, marginTop: 3 }}>
            {help}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
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
    <div
      className="inline-flex border border-line"
      style={{ borderRadius: 10, overflow: "hidden" }}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              active ? "bg-selected text-noir" : "text-secondary hover:bg-rail"
            }
            style={{
              padding: "5px 13px",
              fontSize: 13.5,
              fontWeight: active ? 700 : 400,
              borderLeft: i === 0 ? "none" : "1px solid var(--color-line)",
            }}
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
      className={value ? "bg-accent" : "bg-lineStrong"}
      style={{
        position: "relative",
        width: 40,
        height: 22,
        borderRadius: 999,
        transition: "background-color 150ms ease",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 18,
          height: 18,
          background: "var(--color-surface)",
          borderRadius: 999,
          boxShadow: "0 1px 3px rgba(13,13,9,.2)",
          transition: "transform 150ms ease",
          transform: value ? "translateX(18px)" : "translateX(0)",
        }}
      />
    </button>
  );
}

/* ─────────────────────────── Preferences pane ─────────────────────────── */

function PreferencesPane() {
  const { prefs, set, theme, setTheme, resolvedTheme, systemPrefersDark } = usePrefs();
  const appearanceHelp =
    theme === "system"
      ? `Following your device, which is currently ${systemPrefersDark ? "dark" : "light"}. Changes the moment your device does.`
      : `Always ${resolvedTheme}, whatever your device is set to.`;
  return (
    <div>
      <PaneHeader
        title="Preferences"
        sub="How Gio Docs looks and behaves for you. These settings are yours alone."
      />
      <div style={{ padding: "0 30px 30px" }}>
        <Row label="Appearance" help={appearanceHelp}>
          <Segmented<ThemePref>
            value={theme}
            onChange={(v) => setTheme(v)}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </Row>
        <Row label="Default page font" help="Applies to page body and headings.">
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
        <Row label="Density" help="Tighter table and list rows.">
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
        <Row label="Explain the query above every view" help="Show a plain-language filter sentence.">
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
  const [iconOpen, setIconOpen] = useState(false);

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
        sub="Your workspace name, icon, and the one rule that decides what counts as stale."
      />
      {!isOwner && (
        <div className="text-muted" style={{ padding: "0 30px 8px", fontSize: 13.5, fontStyle: "italic" }}>
          Read-only — only owners can edit workspace settings.
        </div>
      )}
      <div style={{ padding: "0 30px 30px" }}>
        <Row label="Name" help="Live-updates the sidebar and every permission line.">
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
            className="w-full max-w-sm rounded-md border border-line bg-surface focus:outline-none disabled:opacity-60"
            style={{ padding: "8px 12px", fontSize: 14 }}
          />
        </Row>

        <Row label="Icon" help="One emoji.">
          <div style={{ position: "relative" }}>
            <button
              type="button"
              disabled={!isOwner}
              onClick={() => setIconOpen((v) => !v)}
              className="grid place-items-center border border-line rounded-lg hover:bg-rail disabled:opacity-60"
              style={{ width: 52, height: 52, fontSize: 26 }}
            >
              {workspace?.icon ?? "📄"}
            </button>
            {iconOpen && (
              <div
                className="absolute z-10 mt-1 bg-surface border border-line shadow-popover animate-popIn"
                style={{ borderRadius: 12, padding: 6, width: 240 }}
              >
                <div className="grid grid-cols-6 gap-1">
                  {WS_EMOJI.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        updateWs.mutate({ icon: e });
                        setIconOpen(false);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-md hover:bg-rail"
                      style={{ fontSize: 18 }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Row>

        <Row
          label="Pages need re-verifying after"
          help="Older than this and a page is flagged as stale."
        >
          <div style={{ width: 320 }}>
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
            <div className="mt-2 flex items-center justify-between text-secondary" style={{ fontSize: 13.5 }}>
              <span>
                <b className="text-noir tnum">{sliderDays}</b> days
              </span>
              <span className={staleNow > 0 ? "text-amberInk" : "text-muted"} style={{ fontWeight: staleNow > 0 ? 700 : 400 }}>
                {staleNow} pages are stale right now.
              </span>
            </div>
          </div>
        </Row>

        <Row
          label="Allowed email domains"
          help="Anyone signing up with one of these joins automatically."
        >
          <div className="flex max-w-lg flex-wrap items-center gap-2" style={{ minWidth: 320 }}>
            {(domainsQ.data ?? []).map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-sunken"
                style={{ padding: "3px 8px", fontSize: 13 }}
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
                className="inline-flex items-center"
              >
                <input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="add domain…"
                  className="rounded-md border border-dashed border-lineStrong bg-surface focus:outline-none"
                  style={{ width: 160, padding: "3px 8px", fontSize: 13 }}
                />
              </form>
            )}
          </div>
        </Row>

        <Row label="Structure" help="A page lives wherever its properties say.">
          <div className="flex flex-wrap gap-2" style={{ maxWidth: 460 }}>
            <StatChip>{pages.length} pages</StatChip>
            <StatChip>{areaCount} areas</StatChip>
            <StatChip>{views.length} saved views</StatChip>
            <StatChip bold>0 folders</StatChip>
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
        "inline-flex items-center rounded-md border border-line bg-sunken " +
        (bold ? "text-noir" : "text-secondary")
      }
      style={{ padding: "3px 9px", fontSize: 12.5, fontWeight: bold ? 700 : 400 }}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────── People pane ─────────────────────────── */

type PeoplePaneProps = {
  onClose: () => void;
  pendingInvites: PendingInvite[];
  onRevokeInvite: (email: string) => void;
  onOpenInvite: () => void;
  tab: "members" | "guests";
  onTabChange: (t: "members" | "guests") => void;
};

function PeoplePane({
  onClose,
  pendingInvites,
  onRevokeInvite,
  onOpenInvite,
  tab,
  onTabChange,
}: PeoplePaneProps) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const workspace = shell.workspace.data;
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const pages = (shell.pages.data ?? []) as PageListItem[];
  const domainsQ = useAllowedDomains(ws);
  const domains = domainsQ.data ?? [];
  const toast = useToast();

  const { user } = useAuth();
  const isOwner = members.find((m) => m.user_id === user?.id)?.role === "owner";
  const staleDays = workspace?.stale_days ?? 90;
  const staleThreshold = Date.now() - staleDays * 24 * 60 * 60 * 1000;

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

  const withOwner = pages.filter((p) => typeof propsOf(p)["owner"] === "string").length;

  // Guests derived from access rows on individual pages (page_access table
  // is fetched per page, so at workspace scope we can only surface what is
  // encoded in blocks/props at this time). Keep the derived set for the
  // stat card, but show "0" honestly when nothing is known.
  const guestEmails = useMemo(() => new Set<string>(), []);

  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "";
  const domainSentence = domains.length
    ? domains.map((d) => `@${d}`).join(", ")
    : "your allowed domain";

  const membersLabel =
    pendingInvites.length > 0
      ? `Members · ${pendingInvites.length} invited`
      : "Members";

  return (
    <div>
      <PaneHeader
        title="People"
        sub={`Who is in ${workspace?.name ?? "this workspace"}, what they own, and what they can do.`}
      />
      <div style={{ padding: "0 30px 30px" }}>
        {/* Stat cards */}
        <div className="flex flex-wrap gap-3">
          <StatCard label={membersLabel} value={members.length} />
          <StatCard label="Guests" value={guestEmails.size} />
          <StatCard
            label="Pages with an owner"
            value={`${withOwner} of ${pages.length}`}
          />
        </div>

        {/* Invite by link */}
        <div
          className="mt-4 flex items-center gap-3 bg-canvas border border-line"
          style={{ borderRadius: 10, padding: "11px 13px" }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-noir" style={{ fontSize: 14, fontWeight: 700 }}>
              Invite by link
            </div>
            <div className="text-secondary" style={{ fontSize: 12.5, marginTop: 2 }}>
              Anyone signing in with {domainSentence} joins automatically.
            </div>
          </div>
          <button
            type="button"
            disabled={!inviteLinkOn}
            onClick={() => {
              if (typeof navigator !== "undefined" && inviteUrl) {
                navigator.clipboard?.writeText(inviteUrl);
                toast.push("Link copied");
              }
            }}
            className="text-accent disabled:opacity-40"
            style={{ fontSize: 13.5, fontWeight: 700 }}
          >
            Copy link
          </button>
          <Toggle value={inviteLinkOn} onChange={setInviteLinkOn} />
        </div>

        {/* Tabs + Add member */}
        <div className="mt-4 flex items-center gap-2">
          {(["members", "guests"] as const).map((t) => {
            const active = tab === t;
            const count = t === "members"
              ? members.length + pendingInvites.length
              : guestEmails.size;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onTabChange(t)}
                className={active ? "bg-sunken text-noir" : "text-secondary hover:bg-rail"}
                style={{
                  padding: "5px 12px",
                  borderRadius: 999,
                  fontSize: 13.5,
                  fontWeight: active ? 700 : 400,
                }}
              >
                {t === "members" ? "Members" : "Guests"}{" "}
                <span className="text-whisper tnum">{count}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onOpenInvite}
            className="inline-flex items-center gap-1 bg-btn text-btnFg"
            style={{ borderRadius: 10, padding: "6px 13px", fontSize: 13.5, fontWeight: 700 }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={ICON_PLUS} />
            </svg>
            Add member
          </button>
        </div>

        {/* Table */}
        {tab === "members" ? (
          <div className="mt-3 border border-line overflow-hidden" style={{ borderRadius: 10 }}>
            <div
              className="grid bg-canvas border-b border-line text-faint"
              style={{
                gridTemplateColumns: "minmax(0,1.7fr) 92px 96px 128px 32px",
                gap: 12,
                padding: "8px 13px",
                fontSize: 11.5,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <div>PERSON</div>
              <div>OWNS</div>
              <div>STALE</div>
              <div>ROLE</div>
              <div></div>
            </div>
            {members.map((m, i) => {
              const owned = ownedBy.get(m.user_id) ?? [];
              const staleCount = owned.filter(
                (p) => new Date(p.verified_at).getTime() < staleThreshold,
              ).length;
              const name = m.profiles?.full_name || m.profiles?.email || "Unknown";
              const isMe = m.user_id === user?.id;
              const isLast = i === members.length - 1 && pendingInvites.length === 0;
              return (
                <MemberTableRow
                  key={m.user_id}
                  isLast={isLast}
                  avatar={
                    <MemberAvatar
                      tint={m.profiles?.avatar_tint ?? null}
                      ink={m.profiles?.avatar_ink ?? null}
                      initials={initialsOf(name)}
                    />
                  }
                  name={name}
                  email={m.profiles?.email ?? ""}
                  pending={false}
                  owns={
                    owned.length === 0 ? (
                      <span className="text-whisper">none</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const first = (name.split(/\s+/)[0] || name);
                          createView.mutate(
                            {
                              name: `${first}'s pages`,
                              filter: [{ op: "eq", prop: "owner", value: m.user_id }],
                              sort: { prop: "edited", dir: "desc" },
                              layout: "table",
                            },
                            {
                              onSuccess: (row) => {
                                onClose();
                                navigate({ to: "/v/$viewId", params: { viewId: row.id } });
                                toast.push(`Saved '${first}'s pages' to My views`);
                              },
                            },
                          );
                        }}
                        className="text-body hover:text-noir tnum"
                        style={{ textDecoration: "underline dotted", fontSize: 13.5 }}
                      >
                        {owned.length} pages
                      </button>
                    )
                  }
                  stale={
                    staleCount === 0 ? (
                      <span className="text-whisper">—</span>
                    ) : (
                      <span className="text-amberInk tnum" style={{ fontWeight: 700 }}>
                        {staleCount} stale
                      </span>
                    )
                  }
                  role={
                    <RolePicker
                      value={m.role as "owner" | "member"}
                      disabled={!isOwner || isMe}
                      onPick={(role) =>
                        updateRole.mutate({ userId: m.user_id, role })
                      }
                    />
                  }
                  onRemove={() => {
                    if (isMe) {
                      toast.push("You cannot remove yourself");
                      return;
                    }
                    if (owned.length > 0) {
                      const first = name.split(/\s+/)[0] || name;
                      toast.push(`${first} owns ${owned.length} pages — reassign them first`);
                      return;
                    }
                    removeMember.mutate(m.user_id);
                    toast.push(`${name} removed from ${workspace?.name ?? "workspace"}`);
                  }}
                />
              );
            })}
            {pendingInvites.map((inv, i) => {
              const isLast = i === pendingInvites.length - 1;
              return (
                <MemberTableRow
                  key={`inv-${inv.email}`}
                  isLast={isLast}
                  avatar={
                    <MemberAvatar
                      tint={inv.tint}
                      ink={inv.ink}
                      initials={initialsOf(inv.name)}
                    />
                  }
                  name={inv.name}
                  email={inv.email}
                  pending
                  owns={
                    <button
                      type="button"
                      onClick={() => toast.push(`Invite resent to ${inv.email}`)}
                      className="text-body hover:text-noir"
                      style={{ textDecoration: "underline dotted", fontSize: 13.5 }}
                    >
                      Resend
                    </button>
                  }
                  stale={<span className="text-whisper">—</span>}
                  role={
                    <span className="text-secondary" style={{ fontSize: 13.5 }}>
                      {inv.role}
                    </span>
                  }
                  onRemove={() => {
                    onRevokeInvite(inv.email);
                    toast.push(`Invite to ${inv.email} revoked`);
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="mt-3 border border-line" style={{ borderRadius: 10, padding: 20 }}>
            <p className="text-secondary" style={{ fontSize: 13.5 }}>
              No guests yet. Guests are added page by page — open a page and
              share it with someone outside {workspace?.name ?? "the workspace"}.
            </p>
          </div>
        )}

        <p className="mt-3" style={{ fontSize: 13, color: "var(--color-secondary)" }}>
          {tab === "members"
            ? "Owners can publish team views and change these settings. Members can do everything else. Click a page count to save that person's pages as a view."
            : `Guests are invited page by page — there is no guest role to manage here, only the pages that name them.`}
        </p>
      </div>
    </div>
  );
}

function MemberTableRow({
  isLast,
  avatar,
  name,
  email,
  pending,
  owns,
  stale,
  role,
  onRemove,
}: {
  isLast: boolean;
  avatar: ReactNode;
  name: string;
  email: string;
  pending: boolean;
  owns: ReactNode;
  stale: ReactNode;
  role: ReactNode;
  onRemove: () => void;
}) {
  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "minmax(0,1.7fr) 92px 96px 128px 32px",
        gap: 12,
        padding: "9px 13px",
        borderBottom: isLast ? "none" : "1px solid var(--color-lineSoft)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {avatar}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-noir" style={{ fontSize: 14, fontWeight: 700 }}>
              {name}
            </span>
            {pending && (
              <span
                className="bg-amberTint text-amberInk"
                style={{
                  border: "1px solid var(--color-amberRing)",
                  borderRadius: 5,
                  padding: "1px 5px",
                  fontSize: 10,
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                INVITED
              </span>
            )}
          </div>
          <div className="truncate text-faint" style={{ fontSize: 12.5 }}>
            {email}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 13.5 }}>{owns}</div>
      <div style={{ fontSize: 13.5 }}>{stale}</div>
      <div>{role}</div>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="grid h-6 w-6 place-items-center text-whisper hover:bg-dangerTint hover:text-danger"
        style={{ borderRadius: 6 }}
      >
        ×
      </button>
    </div>
  );
}

function RolePicker({
  value,
  disabled,
  onPick,
}: {
  value: "owner" | "member";
  disabled: boolean;
  onPick: (r: "owner" | "member") => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-role-picker]")) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const label = value === "owner" ? "Owner" : "Member";
  return (
    <div data-role-picker style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md hover:bg-rail disabled:opacity-60"
        style={{ padding: "3px 8px", fontSize: 13.5 }}
      >
        {label}
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-10 mt-1 bg-surface border border-line shadow-popover animate-popIn"
          style={{ borderRadius: 8, padding: 4, width: 140 }}
        >
          {(["member", "owner"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onPick(r);
                setOpen(false);
              }}
              className="flex w-full items-center rounded-md hover:bg-rail"
              style={{ padding: "5px 8px", fontSize: 13.5, textAlign: "left" }}
            >
              {r === "owner" ? "Owner" : "Member"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="border border-line"
      style={{ borderRadius: 10, padding: "11px 13px", flex: 1, minWidth: 150 }}
    >
      <div className="text-muted" style={{ fontSize: 13 }}>{label}</div>
      <div
        className="font-display text-noir tnum"
        style={{ fontSize: 21.5, fontWeight: 700, letterSpacing: "-0.04em", marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}

function MemberAvatar({
  tint,
  ink,
  initials,
}: {
  tint: string | null;
  ink: string | null;
  initials: string;
}) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: 28,
        height: 28,
        background: tint ?? "var(--color-sunken)",
        color: ink ?? "var(--color-noir)",
        fontSize: 11.5,
        fontWeight: 700,
      }}
      aria-hidden
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
  const propDefs = (shell.propDefs.data ?? []) as Array<{
    key?: string | null;
    options?: unknown;
  }>;
  const views = (shell.views.data ?? []) as Array<{
    id: string;
    name?: string | null;
    icon?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
  }>;
  const fmt = useFormatDate();
  const [query, setQuery] = useState("");

  type Usage =
    | { kind: "page"; label: string; when: number }
    | { kind: "area"; label: string; when: number }
    | { kind: "view"; label: string; when: number };

  const inventory = useMemo(() => {
    const m = new Map<string, Usage[]>();
    const push = (icon: string | null | undefined, u: Usage) => {
      const key = (icon ?? "").trim();
      if (!key) return;
      const arr = m.get(key) ?? [];
      arr.push(u);
      m.set(key, arr);
    };
    for (const p of pages) {
      push(p.icon, {
        kind: "page",
        label: p.title || "Untitled",
        when: new Date(p.edited_at).getTime(),
      });
    }
    const areaDef = propDefs.find((d) => d?.key === "area");
    const options = Array.isArray(areaDef?.options)
      ? (areaDef!.options as Array<{ value?: string; label?: string; icon?: string }>)
      : [];
    for (const opt of options) {
      push(opt?.icon, {
        kind: "area",
        label: opt?.label || opt?.value || "Area",
        when: 0,
      });
    }
    for (const v of views) {
      push(v.icon, {
        kind: "view",
        label: v.name || "View",
        when: new Date(v.updated_at ?? v.created_at ?? 0).getTime(),
      });
    }
    return [...m.entries()]
      .map(([emoji, usages]) => {
        const lastEdited = usages.reduce((a, u) => (u.when > a ? u.when : a), 0);
        return { emoji, usages, count: usages.length, lastEdited };
      })
      .sort((a, b) => b.count - a.count || (a.emoji < b.emoji ? -1 : 1))
      .filter(
        (row) =>
          !query ||
          row.usages.some((u) =>
            u.label.toLowerCase().includes(query.toLowerCase()),
          ),
      );
  }, [pages, propDefs, views, query]);

  const kindLabel = (k: Usage["kind"]) =>
    k === "page" ? "Page" : k === "area" ? "Area" : "View";

  return (
    <div>
      <PaneHeader
        title="Emoji"
        sub="Every icon in use across the workspace, generated from what pages, areas and views actually wear."
      />
      <div style={{ padding: "0 30px 30px" }}>
        <div className="mt-2 flex items-center gap-3">
          <div className="text-secondary" style={{ fontSize: 13.5 }}>
            <b className="text-noir tnum">{inventory.length}</b> distinct emoji in use
          </div>
          <div className="flex-1" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="border border-line bg-surface rounded-md focus:outline-none"
            style={{ padding: "5px 10px", fontSize: 13.5, width: 200 }}
          />
        </div>

        <div className="mt-3 border border-line overflow-hidden" style={{ borderRadius: 10 }}>
          <div
            className="grid bg-canvas border-b border-line text-faint"
            style={{
              gridTemplateColumns: "56px minmax(0,1.6fr) 96px minmax(0,1.3fr)",
              gap: 12,
              padding: "8px 13px",
              fontSize: 11.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            <div>EMOJI</div>
            <div>USED BY</div>
            <div>COUNT</div>
            <div>MOST RECENT</div>
          </div>
          {inventory.length === 0 && (
            <div className="text-secondary" style={{ padding: 20, fontSize: 13.5 }}>
              No pages, areas or views carry an emoji yet.
            </div>
          )}
          {inventory.map((it, i) => (
            <div
              key={it.emoji}
              className="grid items-center"
              style={{
                gridTemplateColumns: "56px minmax(0,1.6fr) 96px minmax(0,1.3fr)",
                gap: 12,
                padding: "9px 13px",
                borderBottom: i === inventory.length - 1 ? "none" : "1px solid var(--color-lineSoft)",
              }}
            >
              <span style={{ fontSize: 21 }}>{it.emoji}</span>
              <div className="min-w-0 truncate text-secondary" style={{ fontSize: 13.5 }}>
                {it.usages.slice(0, 4).map((u, idx) => (
                  <span key={idx}>
                    {idx > 0 ? ", " : ""}
                    <span className="text-faint" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {kindLabel(u.kind)}
                    </span>{" "}
                    {u.label}
                  </span>
                ))}
                {it.usages.length > 4 && ` +${it.usages.length - 4} more`}
              </div>
              <div className="text-noir tnum" style={{ fontSize: 13.5, fontWeight: 700 }}>
                {it.count}
              </div>
              <div className="text-muted" style={{ fontSize: 12.5 }}>
                {it.lastEdited ? fmt(new Date(it.lastEdited).toISOString()) : "—"}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-caption text-muted">
          Derived from what your pages, areas and views actually use — nothing to configure.
        </p>
      </div>
    </div>
  );
}
