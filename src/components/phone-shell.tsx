import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { exitOnly, exitRef } from "@/lib/exit-motion";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useRecentVisits } from "@/hooks/use-home";
import { recentPages } from "@/lib/home";
import { setPageOrigin } from "@/lib/page-origin";
import type { PageListItem } from "@/lib/types";
import { G } from "@/lib/phone-glyphs";
import { Ico } from "./emoji-icon";
import { PhoneRecentRowsSkeleton } from "./phone-skeletons";

/* The phone frame (Allan, 2026-10-11; Notion's iOS app is the model).
 * Below 768px the app has no sidebar and no top bar:
 * - Tab screens (Home, Inbox, Templates) open with a row of round tabs at
 *   the top: the workspace's logo (account and settings), then pills — the
 *   current one names itself, the others show only their icon.
 * - A page runs edge to edge under floating round buttons: back on the
 *   left, Share and ⋯ on the right.
 * - At the bottom floats a bar: ☰ (pages only: recent pages, Home,
 *   Search), a wide Search pill and New page.
 * - Menus open as sheets from the bottom (BottomSheet).
 * Desktop never renders any of this. */

export type PhoneTab = "home" | "inbox" | "templates";

export function Glyph({ d, size = 22, fill = false }: { d: string; size?: number; fill?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/* ────────────── Top tabs ────────────── */

export function PhoneTopTabs({
  tab,
  unread,
  workspaceIcon,
  workspaceName,
  onAccount,
}: {
  tab: PhoneTab;
  unread: number;
  workspaceIcon: string;
  workspaceName: string;
  onAccount: () => void;
}) {
  const tabs: Array<{ id: PhoneTab; label: string; d: string }> = [
    { id: "home", label: "Home", d: G.home },
    { id: "inbox", label: "Inbox", d: G.inbox },
    { id: "templates", label: "Templates", d: G.templates },
  ];
  return (
    <nav aria-label="Main" className="gio-phone-tabs flex items-center" data-phone-tabs>
      <button
        type="button"
        onClick={onAccount}
        aria-label={`${workspaceName || "Workspace"}: account and settings`}
        className="gio-press gio-phone-circle grid shrink-0 place-items-center rounded-full bg-surface"
        style={{ width: 52, height: 52 }}
      >
        <Ico icon={workspaceIcon} size={28} />
      </button>
      {tabs.map((t) => {
        const active = t.id === tab;
        const label = t.id === "inbox" && unread ? `Inbox, ${unread} unread` : t.label;
        return (
          <Link
            key={t.id}
            to="/home"
            search={t.id === "home" ? {} : { tab: t.id }}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`gio-press relative flex items-center justify-center rounded-full ${
              active ? "bg-selected text-strong" : "bg-sunken text-muted"
            }`}
            style={{ height: 52, flex: active ? "2 1 0" : "1 1 0", gap: 10, minWidth: 0 }}
          >
            <Glyph d={t.d} size={22} fill={false} />
            {active ? <span className="truncate" style={{ fontSize: 17, fontWeight: 700 }}>{t.label}</span> : null}
            {t.id === "inbox" && unread && !active ? (
              <span
                aria-hidden
                className="absolute rounded-full bg-accentDot"
                style={{ width: 9, height: 9, top: 13, right: "calc(50% - 17px)" }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/* ────────────── Floating bars ────────────── */

function Circle({
  label,
  onClick,
  children,
  size = 56,
  data,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  size?: number;
  data?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-phone-button={data}
      className="gio-press gio-phone-float grid shrink-0 place-items-center rounded-full text-strong"
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

/** The bar floating at the bottom of every phone screen. */
export function PhoneBottomBar({
  onMenu,
  onSearch,
  onNew,
}: {
  /** Pages only: the recent-pages card. */
  onMenu?: () => void;
  onSearch: () => void;
  onNew: () => void;
}) {
  return (
    <div className="gio-phone-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center" data-phone-bar>
      {onMenu ? (
        <Circle label="Recent pages, Home and Search" onClick={onMenu} data="menu">
          <Glyph d={G.menu} />
        </Circle>
      ) : null}
      <button
        type="button"
        onClick={onSearch}
        aria-label="Search"
        data-phone-button="search"
        className="gio-press gio-phone-float flex min-w-0 flex-1 items-center rounded-full text-muted"
        style={{ height: 56, gap: 10, padding: "0 20px", fontSize: 17 }}
      >
        <Glyph d={G.search} />
        <span className="truncate">Search</span>
      </button>
      <Circle label="New page" onClick={onNew} data="new">
        <Glyph d={G.compose} />
      </Circle>
    </div>
  );
}

/** Round buttons floating over the top of a page. */
export function PhonePageButtons({
  onBack,
  onShare,
  more,
}: {
  onBack: () => void;
  onShare: () => void;
  /** The ⋯ button (it opens the page's Actions sheet). */
  more: ReactNode;
}) {
  return (
    <div className="gio-phone-top pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center" data-phone-page-buttons>
      <Circle label="Back" onClick={onBack} size={48} data="back">
        <Glyph d={G.back} />
      </Circle>
      <span className="flex-1" />
      <Circle label="Share" onClick={onShare} size={48} data="share">
        <Glyph d={G.share} />
      </Circle>
      {more}
    </div>
  );
}

export function PhoneMoreButton({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <button
      type="button"
      data-page-more
      aria-label="Page actions"
      aria-expanded={open}
      onClick={onClick}
      className="gio-press gio-phone-float grid shrink-0 place-items-center rounded-full text-strong"
      style={{ width: 48, height: 48 }}
    >
      <Glyph d={G.more} />
    </button>
  );
}

/* ────────────── Recent pages card (☰) ────────────── */

export function RecentsCard({
  onClose,
  onSearch,
  currentId,
}: {
  onClose: () => void;
  onSearch: () => void;
  currentId?: string;
}) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const visitsQ = useRecentVisits(ws);
  const navigate = useNavigate();
  const pages = useMemo(() => (shell.pages.data ?? []) as PageListItem[], [shell.pages.data]);
  const recent = useMemo(
    () => recentPages(visitsQ.data ?? [], pages, 9).filter((p) => p.id !== currentId).slice(0, 8),
    [visitsQ.data, pages, currentId],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <>
      <div ref={exitOnly("fade")} className="fixed inset-0 z-50 animate-fadeIn" onClick={onClose} />
      <div
        ref={exitOnly("pop")}
        role="dialog"
        aria-label="Recent pages"
        className="gio-phone-card fixed z-50 animate-popIn overflow-hidden rounded-2xl"
        style={{ transformOrigin: "bottom left" }}
      >
        <div className="px-4 pb-1 pt-3 text-meta text-muted">Recents</div>
        {visitsQ.isPending ? (
          <div className="px-4">
            <PhoneRecentRowsSkeleton />
          </div>
        ) : recent.length === 0 ? (
          <p className="px-4 py-2 text-ui text-muted">Pages you open show up here.</p>
        ) : (
          <ul className="overflow-y-auto" style={{ maxHeight: "min(420px, 55vh)" }}>
            {recent.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center text-left text-strong active:bg-sunken"
                  style={{ gap: 14, minHeight: 50, padding: "0 16px", fontSize: 17 }}
                  onClick={() => {
                    onClose();
                    setPageOrigin(p.id, { kind: "search" });
                    void navigate({ to: "/p/$pageId", params: { pageId: p.id } });
                  }}
                >
                  <Ico icon={p.icon || (p.is_database ? "🗂️" : "📄")} size={22} />
                  <span className="min-w-0 flex-1 truncate">{p.title?.trim() || "Untitled"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mx-4 border-t border-line" />
        <div className="grid grid-cols-2">
          <button
            type="button"
            className="flex flex-col items-center text-strong active:bg-sunken"
            style={{ gap: 4, padding: "12px 0 14px", fontSize: 15 }}
            onClick={() => {
              onClose();
              void navigate({ to: "/home" });
            }}
          >
            <Glyph d={G.home} />
            Home
          </button>
          <button
            type="button"
            className="flex flex-col items-center text-strong active:bg-sunken"
            style={{ gap: 4, padding: "12px 0 14px", fontSize: 15 }}
            onClick={() => {
              onClose();
              onSearch();
            }}
          >
            <Glyph d={G.search} />
            Search
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ────────────── Bottom sheet ────────────── */

/** A sheet that rises from the bottom: a handle, a centred title, and
 *  grouped cards. Esc, a tap outside or a drag down on the handle closes
 *  it. */
export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    panel.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <>
      <div
        ref={exitOnly("fade")}
        className="fixed inset-0 z-[90] animate-fadeIn"
        style={{ background: "rgba(13,13,9,.28)" }}
        onClick={onClose}
      />
      <div
        ref={exitRef("sheet", panel)}
        role="dialog"
        aria-modal
        aria-label={title}
        tabIndex={-1}
        data-bottom-sheet
        className="gio-sheet fixed inset-x-0 bottom-0 z-[91] flex flex-col outline-none"
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: start.current === null && drag === 0 ? "transform 240ms var(--ease-drawer)" : "none",
        }}
      >
        <div
          className="shrink-0 touch-none"
          onPointerDown={(e) => {
            start.current = e.clientY;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current === null) return;
            setDrag(Math.max(0, e.clientY - start.current));
          }}
          onPointerUp={() => {
            const d = drag;
            start.current = null;
            if (d > 80) onClose();
            else setDrag(0);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
        >
          <div className="mx-auto mt-2.5 rounded-full bg-lineStrong" style={{ width: 40, height: 5 }} />
          <div className="py-3 text-center text-strong" style={{ fontSize: 17, fontWeight: 700 }}>
            {title}
          </div>
        </div>
        <div className="gio-sheet-body min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>,
    document.body,
  );
}

/** A group of rows on a white card, inside a sheet. */
export function SheetGroup({ children }: { children: ReactNode }) {
  return <div className="gio-sheet-group overflow-hidden rounded-xl bg-surface">{children}</div>;
}

export function SheetRow({
  icon,
  label,
  onClick,
  danger,
  trailing,
  hint,
}: {
  icon?: string;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  trailing?: ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`gio-sheet-row flex w-full items-center text-left active:bg-sunken ${
        danger ? "text-danger" : "text-strong"
      }`}
    >
      {icon ? (
        <span className={danger ? "" : "text-body"}>
          <Glyph d={icon} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="max-w-[45%] truncate text-ui text-muted">{hint}</span> : null}
      {trailing}
    </button>
  );
}

export function SheetSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="relative shrink-0 rounded-full"
      style={{
        width: 51,
        height: 31,
        background: on ? "var(--color-accent)" : "var(--color-lineStrong)",
        transition: "background-color var(--dur-switch) var(--ease-out)",
      }}
    >
      <span
        className="absolute rounded-full bg-surface"
        style={{
          top: 2,
          left: 2,
          width: 27,
          height: 27,
          boxShadow: "0 2px 4px rgba(13,13,9,.2)",
          transform: on ? "translateX(20px)" : "none",
          transition: "transform var(--dur-switch) var(--ease-out)",
        }}
      />
    </span>
  );
}

export const PHONE_GLYPHS = G;
