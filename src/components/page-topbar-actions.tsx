import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { usePrefs } from "@/lib/preferences";
import { formatTimestamp } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { pageUrl } from "@/lib/slug";
import type { PageListItem } from "@/lib/types";

/* ────────────── Glyph ────────────── */

function Glyph({
  path,
  size = 15,
  className,
}: {
  path: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

/* ────────────── Relative formatting ────────────── */

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
  const y = Math.floor(mo / 12);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

const fullFmt = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function EditedStamp({
  page,
  editorName,
  saving,
  savedFlash,
}: {
  page: PageListItem;
  editorName: string | null;
  saving: boolean;
  savedFlash: boolean;
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
    if (savedFlash) return "Saved";
    if (prefs.dateFormat === "absolute") {
      return `Edited ${formatTimestamp(page.edited_at, "absolute")}`;
    }
    return `Edited ${shortRel(page.edited_at)}`;
  }, [page.edited_at, prefs.dateFormat, saving, savedFlash]);

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


/* ────────────── Icon button ────────────── */

function IconButton({
  onClick,
  title,
  children,
  ariaLabel,
  disabled,
}: {
  onClick?: () => void;
  title: string;
  children: React.ReactNode;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className="grid shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted"
      style={{ height: 26, width: 26 }}
    >
      {children}
    </button>
  );
}

/* ────────────── Main ────────────── */

// The full ⋯ page-actions menu ships in Part B. Signature is preserved so
// AppShell can keep its ordered Escape wiring; menu props are ignored.
export function PageTopbarActions({
  pageId,
  menuOpen: _menuOpen,
  onMenuOpen: _onMenuOpen,
  onMenuClose: _onMenuClose,
}: {
  pageId: string;
  menuOpen: boolean;
  onMenuOpen: () => void;
  onMenuClose: () => void;
}) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const toast = useToast();

  const pages = (shell.pages.data ?? []) as PageListItem[];
  const page = useMemo(() => pages.find((p) => p.id === pageId), [pages, pageId]);
  const members = (shell.members.data ?? []) as Array<{
    user_id: string;
    profiles: { full_name: string | null; email: string | null } | null;
  }>;

  const editedName = useMemo(() => {
    if (!page) return null;
    const m = members.find((x) => x.user_id === page.edited_by);
    return m?.profiles?.full_name || m?.profiles?.email || null;
  }, [members, page]);

  // Saving detection — any in-flight mutation whose variables target this page.
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
  const [savedFlash, setSavedFlash] = useState(false);
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (inFlight) {
      const t = window.setTimeout(() => setShowSaving(true), 1200);
      wasSavingRef.current = true;
      return () => window.clearTimeout(t);
    }
    // Just settled: flash "Saved" for 1.5s if we had shown "Saving…".
    if (wasSavingRef.current) {
      wasSavingRef.current = false;
      if (showSaving) {
        setSavedFlash(true);
        const t = window.setTimeout(() => setSavedFlash(false), 1500);
        setShowSaving(false);
        return () => window.clearTimeout(t);
      }
    }
    setShowSaving(false);
  }, [inFlight, showSaving]);


  const doCopyLink = useCallback(async () => {
    if (!page) return;
    const url = pageUrl(page.id, page.title);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* Never fail silently; the toast still surfaces the URL below. */
    }
    toast.push("Link copied");
  }, [page, toast]);

  // ⌘⌥L only — the Part B ⋯ menu will add its own shortcuts later.
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.altKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        void doCopyLink();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, doCopyLink]);

  if (!page) return null;

  const linkIcon =
    "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.3 19";

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

      {/* ⋯ is intentionally inert this phase. Full menu ships in Part B. */}
      <IconButton
        title="Page actions — next phase"
        ariaLabel="Page actions — next phase"
        disabled
      >
        <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden>
          <circle cx="5" cy="12" r="1.7" fill="currentColor" />
          <circle cx="12" cy="12" r="1.7" fill="currentColor" />
          <circle cx="19" cy="12" r="1.7" fill="currentColor" />
        </svg>
      </IconButton>
    </>
  );
}
