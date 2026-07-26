import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useIsMutating } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { usePrefs } from "@/lib/preferences";
import { formatTimestamp } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { usePageAppearance, type PageFont } from "@/lib/page-appearance";
import { pageUrl } from "@/lib/slug";
import {
  useMovePageToArea,
  useDuplicatePage,
  useArchivePage,
  useDeletePage,
  useVerifyPage,
} from "@/hooks/use-page-mutations";
import type { PageListItem } from "@/lib/types";

/* ────────────── Glyph helper (1.9 stroke to match spec) ────────────── */

function Glyph({
  path,
  size = 15,
  strokeWidth = 1.9,
  className,
}: {
  path: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

/* ────────────── Formatting ────────────── */

function shortRel(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((now - t) / 1000));
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
  return `${Math.floor(mo / 12)} year${Math.floor(mo / 12) === 1 ? "" : "s"} ago`;
}

const fullFmt = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/* ────────────── Edited stamp ────────────── */

function EditedStamp({
  page,
  editorName,
  saving,
}: {
  page: PageListItem;
  editorName: string | null;
  saving: boolean;
}) {
  const { prefs } = usePrefs();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 45_000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  const label = useMemo(() => {
    if (saving) return "Saving…";
    if (prefs.dateFormat === "absolute") {
      return `Edited ${formatTimestamp(page.edited_at, "absolute")}`;
    }
    return `Edited ${shortRel(page.edited_at)}`;
  }, [page.edited_at, prefs.dateFormat, saving]);

  const tooltip = `${fullFmt.format(new Date(page.edited_at))}${
    editorName ? ` · ${editorName}` : ""
  }`;

  return (
    <span
      title={tooltip}
      className={`hidden shrink-0 whitespace-nowrap text-meta md:block ${
        saving ? "text-faint" : "text-muted"
      }`}
    >
      {label}
    </span>
  );
}

/* ────────────── Icon buttons ────────────── */

function IconButton({
  onClick,
  title,
  children,
  ariaLabel,
  buttonRef,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  ariaLabel: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className="grid shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong"
      style={{ height: 26, width: 26 }}
    >
      {children}
    </button>
  );
}

/* ────────────── Menu row primitives ────────────── */

function MenuRow({
  onClick,
  icon,
  label,
  shortcut,
  danger,
  disabled,
  trailing,
}: {
  onClick?: () => void;
  icon?: ReactNode;
  label: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg text-left text-ui disabled:opacity-40 ${
        danger
          ? "text-danger hover:bg-dangerTint"
          : "text-body hover:bg-rail"
      }`}
      style={{ padding: "7px 9px" }}
    >
      <span className={danger ? "text-danger" : "text-secondary"}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {trailing}
      {shortcut ? (
        <span
          className="font-mono text-whisper"
          style={{ fontSize: 11 }}
        >
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

function Toggle({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className="relative shrink-0 rounded-full"
      style={{
        width: 34,
        height: 19,
        background: on ? "var(--color-accent)" : "var(--color-lineStrong)",
        transition: "background 150ms ease",
      }}
    >
      <span
        className="absolute rounded-full bg-surface"
        style={{
          top: 2,
          left: on ? 17 : 2,
          width: 15,
          height: 15,
          transition: "left 150ms ease",
        }}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center rounded-md bg-sunken"
      style={{ padding: 2 }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(o.value);
            }}
            className={`rounded-sm text-caption ${
              active ? "bg-line text-noir" : "text-secondary hover:text-strong"
            }`}
            style={{
              padding: "3px 8px",
              fontWeight: active ? 700 : 500,
              minWidth: 32,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────── Move-to-area sub-popover ────────────── */

function MoveToAreaList({
  areas,
  current,
  onPick,
}: {
  areas: string[];
  current: string | null;
  onPick: (area: string | null) => void;
}) {
  return (
    <div className="p-1">
      <div className="px-2 pt-1 pb-0.5 text-label uppercase text-faint">
        Move to area
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {areas.map((a) => (
          <li key={a}>
            <button
              type="button"
              onClick={() => onPick(a)}
              disabled={a === current}
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-meta hover:bg-rail disabled:opacity-40"
            >
              <span className="text-body">{a}</span>
              {a === current ? (
                <span className="text-caption text-faint">Current</span>
              ) : null}
            </button>
          </li>
        ))}
        {current ? (
          <li>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="w-full rounded-sm px-2 py-1.5 text-left text-meta text-muted hover:bg-rail"
            >
              Clear area
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/* ────────────── Delete confirm ────────────── */

function DeleteConfirm({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="p-3">
      <p className="text-ui text-body">
        Delete <span className="font-bold">&ldquo;{title}&rdquo;</span>? It
        disappears from every view at once — there is no folder it stays in.
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1.5 text-meta text-body hover:bg-rail"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-danger px-2.5 py-1.5 text-meta font-bold text-surface hover:opacity-95"
        >
          Delete page
        </button>
      </div>
    </div>
  );
}

/* ────────────── Portal popover ────────────── */

type Anchor = { top: number; right: number };

function AnchoredPopover({
  anchor,
  width = 256,
  onClickOutside,
  children,
}: {
  anchor: Anchor;
  width?: number;
  onClickOutside: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClickOutside();
    };
    document.addEventListener("mousedown", onMouse);
    return () => document.removeEventListener("mousedown", onMouse);
  }, [onClickOutside]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        aria-hidden
        onMouseDown={onClickOutside}
      />
      <div
        ref={ref}
        role="menu"
        className="fixed z-50 rounded-xl border border-line bg-surface shadow-popover animate-popIn"
        style={{
          top: anchor.top,
          right: anchor.right,
          width,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/* ────────────── Main topbar actions ────────────── */

export function PageTopbarActions({
  pageId,
  menuOpen,
  onMenuOpen,
  onMenuClose,
}: {
  pageId: string;
  menuOpen: boolean;
  onMenuOpen: () => void;
  onMenuClose: () => void;
}) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { app, set: setApp } = usePageAppearance(pageId);

  const move = useMovePageToArea();
  const duplicate = useDuplicatePage();
  const archive = useArchivePage();
  const del = useDeletePage();
  const verify = useVerifyPage();

  const pages = (shell.pages.data ?? []) as PageListItem[];
  const page = useMemo(() => pages.find((p) => p.id === pageId), [pages, pageId]);
  const members = (shell.members.data ?? []) as Array<{
    user_id: string;
    profiles: { full_name: string | null; email: string | null } | null;
  }>;

  const nameOf = useCallback(
    (id: string | null) => {
      if (!id) return null;
      const m = members.find((x) => x.user_id === id);
      return m?.profiles?.full_name || m?.profiles?.email || null;
    },
    [members],
  );

  const editedName = page ? nameOf(page.edited_by) : null;
  const verifiedName = page ? nameOf(page.verified_by) : null;

  const currentArea = useMemo(() => {
    if (!page) return null;
    const props =
      page.props && typeof page.props === "object" && !Array.isArray(page.props)
        ? (page.props as Record<string, unknown>)
        : {};
    return typeof props.area === "string" ? (props.area as string) : null;
  }, [page]);

  const areas = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      if (p.archived_at) continue;
      const pr =
        p.props && typeof p.props === "object" && !Array.isArray(p.props)
          ? (p.props as Record<string, unknown>)
          : {};
      const a = pr.area;
      if (typeof a === "string" && a) s.add(a);
    }
    return [...s].sort();
  }, [pages]);

  // "Saving…" detection — any in-flight mutation whose variables target this page.
  const inFlight = useIsMutating({
    predicate: (m) => {
      const v = m.state.variables as unknown;
      if (typeof v === "string" && v === pageId) return true;
      if (v && typeof v === "object" && "pageId" in v) {
        return (v as { pageId?: string }).pageId === pageId;
      }
      return false;
    },
  });
  const [showSaving, setShowSaving] = useState(false);
  useEffect(() => {
    if (!inFlight) {
      setShowSaving(false);
      return;
    }
    const t = window.setTimeout(() => setShowSaving(true), 1200);
    return () => window.clearTimeout(t);
  }, [inFlight]);

  // Copy-link handler — shared by button and shortcut.
  const doCopyLink = useCallback(async () => {
    if (!page) return;
    const url = pageUrl(page.id, page.title);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* Never fail silently; the toast still surfaces the URL below. */
    }
    toast.push(`Link copied — ${url}`);
  }, [page, toast]);

  // Duplicate shortcut handler.
  const doDuplicate = useCallback(() => {
    if (!page) return;
    duplicate.mutate(page.id, {
      onSuccess: (row) => {
        navigate({ to: "/p/$pageId", params: { pageId: row.id } });
      },
    });
    onMenuClose();
  }, [page, duplicate, navigate, onMenuClose]);

  // ⌘⌥L and ⌘D shortcuts, active only while a page is open.
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.altKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        void doCopyLink();
        return;
      }
      if (meta && !e.altKey && !e.shiftKey && (e.key === "d" || e.key === "D")) {
        // Only trigger duplicate if focus is not in an editable field.
        const el = document.activeElement as HTMLElement | null;
        const editable =
          el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable);
        if (editable) return;
        e.preventDefault();
        doDuplicate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, doCopyLink, doDuplicate]);

  // Menu button anchor for the popover.
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [subPopover, setSubPopover] = useState<
    "move" | "delete" | null
  >(null);
  useEffect(() => {
    if (!menuOpen) setSubPopover(null);
  }, [menuOpen]);

  if (!page) return null;

  const isArchived = !!page.archived_at;

  // Anchor: top under the header, right-edge aligned with 14px topbar padding.
  const anchor: Anchor = { top: 46, right: 14 };

  const verifiedAgeMs =
    Date.now() - new Date(page.verified_at).getTime();
  const showVerify = verifiedAgeMs > 60 * 60 * 1000; // 1h

  /* Icons — single-path glyphs per spec. */
  const linkIcon =
    "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.3 19";
  const dotsIcon = "M5 12h.01M12 12h.01M19 12h.01"; // rendered thicker
  const shieldIcon =
    "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5L16 9.5";
  const folderIcon = "M3 7h6l2 2h10v10H3z";
  const eyeIcon = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z";
  const copyIcon =
    "M8 8h10v12H8zM6 4h10v2M6 4v14";
  const duplicateIcon = "M8 4h10v14H8zM4 8v12h10";
  const archiveIcon = "M3 6h18v4H3zM5 10h14v10H5zM10 14h4";
  const trashIcon = "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13";
  const lockIcon = "M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z";

  return (
    <>
      <EditedStamp page={page} editorName={editedName} saving={showSaving} />

      <IconButton
        onClick={doCopyLink}
        title="Copy link  ⌘⌥L"
        ariaLabel="Copy link to this page"
      >
        <Glyph path={linkIcon} />
      </IconButton>

      <button
        ref={menuBtnRef}
        type="button"
        onClick={() => (menuOpen ? onMenuClose() : onMenuOpen())}
        aria-label="Page menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Page actions"
        className="grid shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong"
        style={{ height: 26, width: 26 }}
      >
        <svg
          viewBox="0 0 24 24"
          width={15}
          height={15}
          aria-hidden
        >
          <circle cx="5" cy="12" r="1.7" fill="currentColor" />
          <circle cx="12" cy="12" r="1.7" fill="currentColor" />
          <circle cx="19" cy="12" r="1.7" fill="currentColor" />
        </svg>
      </button>

      {menuOpen ? (
        <AnchoredPopover anchor={anchor} onClickOutside={onMenuClose}>
          {subPopover === "move" ? (
            <MoveToAreaList
              areas={areas}
              current={currentArea}
              onPick={(area) => {
                move.mutate({ pageId: page.id, area });
                setSubPopover(null);
                onMenuClose();
              }}
            />
          ) : subPopover === "delete" ? (
            <DeleteConfirm
              title={page.title || "Untitled"}
              onCancel={() => setSubPopover(null)}
              onConfirm={() => {
                setSubPopover(null);
                onMenuClose();
                del.mutate(page.id, {
                  onSuccess: () => {
                    if (typeof window !== "undefined" && window.history.length > 1) {
                      window.history.back();
                    } else {
                      navigate({ to: "/", replace: true });
                    }
                  },
                });
              }}
            />
          ) : (
            <div className="p-1">
              {/* Group A — appearance (per page, per device) */}
              <div className="px-2 pt-1 pb-0.5 text-label uppercase text-faint">
                On this device
              </div>
              <MenuRow
                icon={
                  <span className="inline-block h-4 w-4 rounded-sm border border-line" />
                }
                label="Font"
                trailing={
                  <Segmented<PageFont>
                    value={app.font}
                    options={[
                      { value: "default", label: "A" },
                      { value: "serif", label: "Aa" },
                      { value: "mono", label: "Ab" },
                    ]}
                    onChange={(v) => setApp("font", v)}
                  />
                }
              />
              <MenuRow
                icon={
                  <span
                    className="inline-block font-display font-bold text-noir"
                    style={{ fontSize: 12 }}
                  >
                    aA
                  </span>
                }
                label="Small text"
                trailing={
                  <Toggle
                    on={app.small}
                    onChange={(v) => setApp("small", v)}
                    ariaLabel="Small text"
                  />
                }
              />
              <MenuRow
                icon={<Glyph path="M4 8h16M4 16h16" />}
                label="Full width"
                trailing={
                  <Toggle
                    on={app.wide}
                    onChange={(v) => setApp("wide", v)}
                    ariaLabel="Full width"
                  />
                }
              />
              <MenuRow
                icon={<Glyph path={lockIcon} />}
                label="Lock page"
                trailing={
                  <Toggle
                    on={app.locked}
                    onChange={(v) => {
                      setApp("locked", v);
                      toast.push(
                        v
                          ? "Page locked — content is read-only."
                          : "Editing unlocked.",
                      );
                    }}
                    ariaLabel="Lock page"
                  />
                }
              />

              <div
                className="border-t border-lineSoft"
                style={{ marginTop: 5, marginBottom: 5 }}
              />

              {/* Group B — actions */}
              <MenuRow
                icon={<Glyph path={eyeIcon} />}
                label="Who can see this"
                onClick={() => {
                  onMenuClose();
                  // Trigger the page's own permissions chip. It's the single
                  // popover — we scroll it into view and click it programmatically.
                  const chip = document.getElementById("gio-perm-chip");
                  if (chip) {
                    chip.scrollIntoView({ block: "nearest" });
                    (chip as HTMLButtonElement).click();
                  }
                }}
              />
              <MenuRow
                icon={<Glyph path={folderIcon} />}
                label="Move to area"
                onClick={() => setSubPopover("move")}
              />
              {showVerify ? (
                <MenuRow
                  icon={<Glyph path={shieldIcon} />}
                  label="Mark verified"
                  onClick={() => {
                    onMenuClose();
                    verify.mutate(page.id);
                  }}
                />
              ) : null}
              <MenuRow
                icon={<Glyph path={copyIcon} />}
                label="Copy link"
                shortcut="⌘⌥L"
                onClick={() => {
                  onMenuClose();
                  void doCopyLink();
                }}
              />
              <MenuRow
                icon={<Glyph path={duplicateIcon} />}
                label="Duplicate"
                shortcut="⌘D"
                onClick={doDuplicate}
              />

              <div
                className="border-t border-lineSoft"
                style={{ marginTop: 5, marginBottom: 5 }}
              />

              {/* Group C — destructive */}
              <MenuRow
                icon={<Glyph path={archiveIcon} />}
                label={isArchived ? "Unarchive" : "Archive"}
                onClick={() => {
                  onMenuClose();
                  archive.mutate({ pageId: page.id, archived: !isArchived });
                }}
              />
              <MenuRow
                icon={<Glyph path={trashIcon} />}
                label="Delete"
                danger
                onClick={() => setSubPopover("delete")}
              />

              {/* Footer */}
              <div
                className="border-t border-lineSoft"
                style={{ marginTop: 5 }}
              >
                <div
                  className="text-faint"
                  style={{
                    padding: "8px 10px",
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}
                >
                  <div>
                    Edited {shortRel(page.edited_at)}
                    {editedName ? ` by ${editedName}` : ""}
                  </div>
                  <div>
                    Verified {shortRel(page.verified_at)}
                    {verifiedName ? ` by ${verifiedName}` : ""}
                  </div>
                </div>
              </div>
            </div>
          )}
        </AnchoredPopover>
      ) : null}
      {/* Keep user reference to preserve mount stability across renders. */}
      <span hidden aria-hidden data-me={user?.id ?? ""} />
    </>
  );
}
