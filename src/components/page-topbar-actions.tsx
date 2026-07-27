import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useWorkspaceId } from "@/lib/workspace-context";
import {
  useWorkspaceShell,
  usePage,
  usePageAccess,
} from "@/hooks/use-workspace-data";
import { usePrefs } from "@/lib/preferences";
import { formatTimestamp } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { pageUrl } from "@/lib/slug";
import { getPageOrigin } from "@/lib/page-origin";
import { PageActionsMenu, PageMoreButton } from "./page-actions-menu";
import { usePageAppearance } from "@/lib/page-appearance";
import {
  useArchivePage,
  useDeletePage,
  useDuplicatePage,
  useRestorePage,
  useSetPageProperty,
  useVerifyPage,
} from "@/hooks/use-page-mutations";
import type { PageListItem, PageFull, Block } from "@/lib/types";
import { ExportDialog } from "./export-dialog";
import type { ExportContext } from "@/lib/export";


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

/* ────────────── Relative formatting for the "Edited …" stamp ────────────── */

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

/* ────────────── Helpers ────────────── */

function isSameLocalDay(a: string, b: Date): boolean {
  const d = new Date(a);
  return (
    d.getFullYear() === b.getFullYear() &&
    d.getMonth() === b.getMonth() &&
    d.getDate() === b.getDate()
  );
}

function propsOf(p: PageListItem | PageFull): Record<string, unknown> {
  const v = p.props;
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/* The inline PageActionsMenu / SearchAllHint helpers that previously lived
 * here were retired when the page-route ⋯ moved to its own component in
 * src/components/page-actions-menu.tsx. Keep this file focused on the
 * topbar orchestration: edited stamp, copy-link icon, and the ⋯ trigger. */



/* ────────────── Main ────────────── */

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
  const pageQ = usePage(pageId);
  const accessQ = usePageAccess(pageId);
  const toast = useToast();
  const navigate = useNavigate();

  const pages = (shell.pages.data ?? []) as PageListItem[];
  const listRow = useMemo(
    () => pages.find((p) => p.id === pageId) ?? null,
    [pages, pageId],
  );
  const page = pageQ.data;
  const members = (shell.members.data ?? []) as Array<{
    user_id: string;
    profiles: { full_name: string | null; email: string | null } | null;
  }>;
  const workspace = shell.workspace.data;
  const workspaceName = workspace?.name ?? "";
  const memberCount = members.length;
  const areas = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      const a = propsOf(p)["area"];
      if (typeof a === "string" && a) s.add(a);
    }
    return [...s].sort();
  }, [pages]);

  const editedName = useMemo(() => {
    if (!listRow) return null;
    const m = members.find((x) => x.user_id === listRow.edited_by);
    return m?.profiles?.full_name || m?.profiles?.email || null;
  }, [members, listRow]);

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

  /* ────────── Mutations ────────── */
  const verify = useVerifyPage();
  const setProp = useSetPageProperty();
  const dup = useDuplicatePage();
  const archive = useArchivePage();
  const del = useDeletePage();
  const restore = useRestorePage();

  const doCopyLink = useCallback(async () => {
    if (!listRow) return;
    const url = pageUrl(listRow.id, listRow.title);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* Never fail silently; the toast still surfaces success below. */
    }
    toast.push("Link copied");
  }, [listRow, toast]);

  const doDuplicate = useCallback(async () => {
    if (!listRow) return;
    try {
      const row = await dup.mutateAsync(listRow.id);
      await navigate({ to: "/p/$pageId", params: { pageId: row.id } });
    } catch {
      /* toast already surfaced by the hook */
    }
  }, [dup, listRow, navigate]);

  const backAfterDelete = useCallback(() => {
    // Return to whatever origin the sidebar/table recorded, else the root
    // which auto-picks the first personal view.
    const origin = getPageOrigin(pageId);
    if (origin?.kind === "view") {
      navigate({ to: "/v/$viewId", params: { viewId: origin.viewId }, replace: true });
      return;
    }
    if (origin?.kind === "area") {
      navigate({
        to: "/a/$area",
        params: { area: encodeURIComponent(origin.area) },
        replace: true,
      });
      return;
    }
    navigate({ to: "/", replace: true });
  }, [navigate, pageId]);

  const doDelete = useCallback(() => {
    if (!listRow) return;
    const rowSnap = listRow;
    del.mutate(rowSnap.id, {
      onSuccess: () => {
        backAfterDelete();
        toast.push({
          message: "Page deleted — it left every view at once.",
          action: {
            label: "Undo",
            onClick: () =>
              restore.mutate({ pageId: rowSnap.id, row: rowSnap }),
          },
          durationMs: 10_000,
        });
      },
    });
  }, [del, listRow, restore, toast, backAfterDelete]);

  // ⌘⌥L (copy) and ⌘D (duplicate) shortcuts. Suppressed while focus is inside
  // an editable field so text selection & shortcuts inside the editor win.
  useEffect(() => {
    if (!listRow) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const tgt = e.target as HTMLElement | null;
      const inField =
        !!tgt &&
        (tgt.tagName === "TEXTAREA" ||
          tgt.tagName === "INPUT" ||
          tgt.isContentEditable);
      if (meta && e.altKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        void doCopyLink();
        return;
      }
      if (meta && !e.altKey && !e.shiftKey && (e.key === "d" || e.key === "D")) {
        if (inField) return;
        e.preventDefault();
        void doDuplicate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listRow, doCopyLink, doDuplicate]);

  const [exportOpen, setExportOpen] = useState(false);

  const exportCtx: ExportContext | null = useMemo(() => {
    if (!page) return null;
    const props = propsOf(page);
    const areaV = typeof props.area === "string" ? (props.area as string) : null;
    const statusV = typeof props.status === "string" ? (props.status as string) : null;
    const tagsV = Array.isArray(props.tags)
      ? (props.tags as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    const ownerMember = members.find((m) => m.user_id === page.edited_by);
    const ownerName =
      ownerMember?.profiles?.full_name || ownerMember?.profiles?.email || null;
    const blocks: Block[] = Array.isArray(page.blocks)
      ? (page.blocks as unknown[]).filter(
          (b): b is Block => !!b && typeof b === "object",
        )
      : [];
    return {
      title: page.title || "Untitled",
      area: areaV,
      status: statusV,
      ownerName,
      tags: tagsV,
      verifiedAt: page.verified_at,
      blocks,
    };
  }, [page, members]);

  if (!listRow) return null;

  const linkIcon =
    "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.3 19";

  const isVerifiedToday = page
    ? isSameLocalDay(page.verified_at, new Date())
    : false;
  const access = accessQ.data ?? [];


  const buildMenu = (): ReactNode => {
    if (!page) {
      return (
        <RowMenuList
          title={listRow.title || "Untitled"}
          items={[{ id: "wait", label: "Loading page…", disabled: true }]}
        />
      );
    }
    return (
      <PageActionsMenu
        page={page}
        workspaceName={workspaceName}
        memberCount={memberCount}
        access={access}
        areas={areas}
        onCopyLink={doCopyLink}
        onExport={() => setExportOpen(true)}
        onDuplicate={doDuplicate}
        onMoveArea={(area) =>
          setProp.mutate({ pageId: page.id, key: "area", value: area })
        }
        onVerify={() => verify.mutate(page.id)}
        isVerifiedToday={isVerifiedToday}
        onArchive={() =>
          archive.mutate({ pageId: page.id, archived: true })
        }
        onUnarchive={() =>
          archive.mutate({ pageId: page.id, archived: false })
        }
        onDelete={doDelete}
      />
    );
  };

  return (
    <>
      <EditedStamp
        page={listRow}
        editorName={editedName}
        saving={showSaving}
        savedFlash={savedFlash}
      />

      <IconButton
        onClick={doCopyLink}
        title="Copy link  ⌘⌥L"
        ariaLabel="Copy link to this page"
      >
        <Glyph path={linkIcon} />
      </IconButton>

      <RowMoreButton
        size="md"
        ariaLabel="Page actions"
        build={buildMenu}
        width={264}
      />

      {exportOpen && exportCtx && (
        <ExportDialog ctx={exportCtx} onClose={() => setExportOpen(false)} />
      )}
    </>
  );
}
