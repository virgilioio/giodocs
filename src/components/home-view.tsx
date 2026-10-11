import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { STAR_GLYPH, useFavoritePages } from "@/hooks/use-favorites";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useHidden, useHomePrefs, useRecentVisits, useSaveHomePrefs } from "@/hooks/use-home";
import { greetingFor, greetingName, recentPages, RECENT_LIMIT } from "@/lib/home";
import { useFormatDate } from "@/lib/format";
import { placeOf } from "@/lib/page-place";
import { setPageOrigin } from "@/lib/page-origin";
import type { PageListItem } from "@/lib/types";
import { Popover } from "./popover";
import { EmojiPicker } from "./emoji-picker";
import { Ico } from "./emoji-icon";
import { Sk } from "./sk";
import { MyTasks } from "./home-tasks";
import {
  CustomizeHome,
  PinnedViews,
  QuickLinks,
  RecentlyUpdated,
  TemplatesSection,
} from "./home-sections";

/* Home (Notion's): a greeting, the pages you visited last, your tasks,
 * views you pinned, what changed lately, templates and quick links. Each
 * section can be hidden from the ⋯ beside the greeting (home_prefs). */

const CARD_W = 148;
const CARD_H = 140;

export function HomeView({
  empty,
  onOpenPalette,
  onOpenSettings,
}: {
  empty?: ReactNode;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const pages = useMemo(() => (shell.pages.data ?? []) as PageListItem[], [shell.pages.data]);
  const visitsQ = useRecentVisits(ws);
  const recent = useMemo(() => recentPages(visitsQ.data ?? [], pages), [visitsQ.data, pages]);
  const now = useNow();
  const hidden = useHidden();
  const favorites = useFavoritePages();

  return (
    <div className="mx-auto w-full" style={{ maxWidth: 900, padding: "56px 48px 96px" }}>
      <div className="relative">
        <Greeting now={now} />
        {empty ? null : (
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <CustomizeHome />
          </div>
        )}
      </div>
      {empty ? (
        <div className="mt-6">{empty}</div>
      ) : (
        <>
          {hidden("recent") ? null : (
            <Section title="Recently visited" icon={CLOCK}>
              {visitsQ.isLoading || !shell.pages.data ? (
                <div role="status" aria-busy="true">
                  <span className="sr-only">Loading…</span>
                  <CardRow>
                    {Array.from({ length: 5 }, (_, i) => (
                      <Sk key={i} w={CARD_W} h={CARD_H} r={12} tone="soft" />
                    ))}
                  </CardRow>
                </div>
              ) : visitsQ.isError ? (
                <p className="text-meta text-danger">
                  Couldn't load the pages you visited.{" "}
                  <button type="button" className="underline" onClick={() => void visitsQ.refetch()}>
                    Retry
                  </button>
                </p>
              ) : recent.length === 0 ? (
                <p className="text-meta text-muted">Pages you open show up here, newest first.</p>
              ) : (
                <CardRow label={`Recently visited, ${recent.length} of up to ${RECENT_LIMIT} pages`}>
                  {recent.map((p) => (
                    <PageCard key={p.id} page={p} place={placeOf(p, pages)} visitedAt={p.visited_at} />
                  ))}
                </CardRow>
              )}
            </Section>
          )}
          {hidden("favorites") ? null : (
            <Section title="Favorites" icon={STAR_GLYPH}>
              {favorites.length === 0 ? (
                <p className="text-meta text-muted">
                  Star pages you come back to: open a page's ⋯ menu and choose Add to Favorites.
                </p>
              ) : (
                <CardRow label={`Favorites, ${favorites.length} pages`}>
                  {favorites.map((p) => (
                    <PageCard key={p.id} page={p} place={placeOf(p, pages)} visitedAt={p.edited_at} />
                  ))}
                </CardRow>
              )}
            </Section>
          )}
          {hidden("tasks") ? null : (
            <Section title="My tasks" icon={TASKS}>
              <MyTasks now={now} />
            </Section>
          )}
          {hidden("views") ? null : (
            <Section title="Pinned views" icon={PIN}>
              <PinnedViews />
            </Section>
          )}
          {hidden("updated") ? null : (
            <Section title="Recently updated" icon={PENCIL}>
              <RecentlyUpdated />
            </Section>
          )}
          {hidden("templates") ? null : (
            <Section title="Templates" icon={TEMPLATE}>
              <TemplatesSection />
            </Section>
          )}
          <Section title="Quick links" icon={BOLT}>
            <QuickLinks onOpenPalette={onOpenPalette} onOpenSettings={onOpenSettings} />
          </Section>
        </>
      )}
    </div>
  );
}

/* ─────────────── Greeting ─────────────── */

function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

function Greeting({ now }: { now: Date }) {
  const { user, profile } = useAuth();
  const prefsQ = useHomePrefs();
  const save = useSaveHomePrefs();
  const prefs = prefsQ.data;
  const name = greetingName(prefs?.nickname, profile?.full_name, user?.email);
  const text = `${greetingFor(now)}${name ? `, ${name}` : ""}`;

  return (
    <div className="group/greet relative flex items-center justify-center gap-3">
      {prefs?.emoji ? <Ico icon={prefs.emoji} size={30} /> : null}
      <h1 className="min-w-0 truncate text-center font-display text-h1 text-noir">{text}</h1>
      <Popover
        width={300}
        align="end"
        trigger={({ open, onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            aria-expanded={open}
            aria-label="Edit greeting"
            title="Edit greeting"
            className={`grid place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong ${open ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover/greet:opacity-100"}`}
            style={{ width: 28, height: 28, transition: "opacity var(--dur-hover) ease" }}
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
            </svg>
          </button>
        )}
      >
        {(close) => (
          <GreetingEditor
            nickname={prefs?.nickname ?? ""}
            emoji={prefs?.emoji ?? null}
            placeholder={greetingName(null, profile?.full_name, user?.email) || "Your name"}
            onSave={(patch) => {
              save.mutate(patch);
              close();
            }}
          />
        )}
      </Popover>
    </div>
  );
}

function GreetingEditor({
  nickname,
  emoji,
  placeholder,
  onSave,
}: {
  nickname: string;
  emoji: string | null;
  placeholder: string;
  onSave: (patch: { nickname: string | null; emoji: string | null }) => void;
}) {
  const [draft, setDraft] = useState(nickname);
  const [icon, setIcon] = useState<string | null>(emoji);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The popover places itself after mounting; focus once it has.
  useEffect(() => {
    if (picking) return;
    const r = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(r);
  }, [picking]);
  const commit = () => onSave({ nickname: draft.trim() || null, emoji: icon });

  if (picking) {
    return (
      <EmojiPicker
        removable
        onPick={(e) => {
          setIcon(e);
          setPicking(false);
        }}
      />
    );
  }
  return (
    <form
      className="flex flex-col gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">Call me</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPicking(true)}
            aria-label={icon ? "Change greeting emoji" : "Add greeting emoji"}
            title={icon ? "Change emoji" : "Add emoji"}
            className="grid shrink-0 place-items-center rounded-md border border-line bg-surface text-muted hover:bg-sunken"
            style={{ width: 32, height: 32 }}
          >
            {icon ? <Ico icon={icon} size={18} /> : <span aria-hidden className="text-ui">☺</span>}
          </button>
          <input
            ref={inputRef}
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-ui text-body outline-none focus:border-accent"
            style={{ height: 32 }}
          />
        </div>
      </label>
      <p className="text-caption text-muted">Only you see this. Leave it empty to use your first name.</p>
      <div className="flex justify-end gap-2">
        {icon ? (
          <button
            type="button"
            onClick={() => setIcon(null)}
            className="mr-auto rounded-md px-2 text-meta text-muted hover:bg-sunken hover:text-strong"
            style={{ height: 28 }}
          >
            Remove emoji
          </button>
        ) : null}
        <button type="submit" className="rounded-md bg-btn px-3 text-meta font-bold text-btnFg" style={{ height: 28 }}>
          Save
        </button>
      </div>
    </form>
  );
}

/* ─────────────── Sections and cards ─────────────── */

const CLOCK = "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z";
const TASKS = "M4 5h4v4H4zM4 15h4v4H4zM11 7h9M11 17h9";
const PIN = "M12 17v4M8 3h8l-1 6 3 4H6l3-4z";
const PENCIL = "M4 20h4L19 9l-4-4L4 16v4z";
const TEMPLATE = "M5 4h14v5H5zM5 13h6v7H5zM15 13h4M15 17h4";
const BOLT = "M13 3L5 14h6l-1 7 8-11h-6z";

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section className="mt-10" aria-label={title}>
      <h2 className="mb-3 flex items-center gap-1.5 text-caption font-bold text-muted">
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={icon} />
        </svg>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CardRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      role={label ? "list" : undefined}
      aria-label={label}
      className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2"
      style={{ scrollSnapType: "x proximity" }}
    >
      {children}
    </div>
  );
}

function PageCard({ page, place, visitedAt }: { page: PageListItem; place: string; visitedAt: string }) {
  const navigate = useNavigate();
  const fmt = useFormatDate();
  const title = page.title?.trim() || "Untitled";
  return (
    <div role="listitem" className="shrink-0" style={{ scrollSnapAlign: "start" }}>
      <button
        type="button"
        onClick={() => {
          setPageOrigin(page.id, { kind: "search" });
          void navigate({ to: "/p/$pageId", params: { pageId: page.id } });
        }}
        className="gio-press flex flex-col overflow-hidden rounded-xl border border-line bg-surface text-left hover:bg-track"
        style={{ width: CARD_W, height: CARD_H }}
      >
        <div className="relative w-full shrink-0 bg-sunken" style={{ height: 40 }}>
          <span className="absolute" style={{ left: 14, bottom: -14 }}>
            <Ico icon={page.icon || (page.is_database ? "🗂️" : "📄")} size={26} />
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-3" style={{ paddingTop: 22 }}>
          <span className="line-clamp-2 text-ui font-bold text-strong">{title}</span>
          <span className="mt-auto truncate text-caption text-faint">
            {place ? `${place} · ` : ""}
            {fmt(visitedAt)}
          </span>
        </div>
      </button>
    </div>
  );
}
