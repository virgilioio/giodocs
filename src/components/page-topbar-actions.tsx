import { relationConfig, valueWords } from "@/lib/relations";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { primaryMod } from "@/lib/platform";
import { toClipboard } from "@/lib/clipboard";
import { useSaveStatus } from "@/lib/save-status";
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
import { isTypingTarget } from "@/lib/is-typing";
import { pageUrl } from "@/lib/slug";
import { getPageOrigin } from "@/lib/page-origin";
import { PageActionsMenu, PageMoreButton } from "./page-actions-menu";
import { openPermissionsPopover } from "./permissions-popover";
import { openPageHistory } from "@/lib/page-history-store";
import { useSetTemplate } from "@/hooks/use-templates";
import { openComments, toggleComments, useCommentsPanel } from "@/lib/comments-store";
import { toThreads, useComments } from "@/hooks/use-comments";
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
import { TaskDatabaseDialog } from "./task-database-dialog";
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
  unsaved = false,
  stopped = false,
}: {
  page: PageListItem;
  editorName: string | null;
  saving: boolean;
  savedFlash: boolean;
  unsaved?: boolean;
  stopped?: boolean;
}) {
  const { prefs } = usePrefs();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 45_000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  const label = useMemo(() => {
    if (stopped) return "Not saved";
    if (unsaved) return "Not saved · retrying";
    if (saving) return "Saving…";
    if (savedFlash) return "Saved";
    if (prefs.dateFormat === "absolute") {
      return `Edited ${formatTimestamp(page.edited_at, "absolute")}`;
    }
    return `Edited ${shortRel(page.edited_at)}`;
  }, [page.edited_at, prefs.dateFormat, saving, savedFlash, unsaved, stopped]);

  const tooltip = `${fullFmt.format(new Date(page.edited_at))}${
    editorName ? ` · ${editorName}` : ""
  }`;

  return (
    <span
      title={tooltip}
      role="status"
      className={`hidden shrink-0 whitespace-nowrap text-meta md:block ${
        unsaved ? "text-danger" : saving ? "text-faint" : "text-muted"
      }`}
    >
      {label}
    </span>
  );
}

/* ────────────── Icon button ────────────── */

/** Comments: the open-thread count, and the panel toggle (⌘⇧M). */
function CommentsButton({ pageId }: { pageId: string }) {
  const q = useComments(pageId);
  const panel = useCommentsPanel();
  const open = (q.data ? toThreads(q.data) : []).filter((t) => !t.root.resolved_at).length;
  const isOpen = panel?.pageId === pageId;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (primaryMod(e) && e.shiftKey && !e.altKey && e.code === "KeyM") {
        e.preventDefault();
        // Words selected on the page: start a thread on them.
        const selection = window.getSelection();
        const node = selection && !selection.isCollapsed ? selection.anchorNode : null;
        const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
        const blockId = el?.closest("[data-gio-page-body] [data-block-id]")?.getAttribute("data-block-id");
        if (blockId) {
          const quote = selection!.toString().replace(/\s+/g, " ").trim().slice(0, 500);
          openComments(pageId, { draft: { blockId, quote } });
          return;
        }
        toggleComments(pageId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageId]);
  const label = open ? `Comments, ${open} open` : "Comments";
  return (
    <button
      type="button"
      onClick={() => toggleComments(pageId)}
      title={`${label}  ⌘⇧M`}
      aria-label={label}
      aria-pressed={isOpen}
      className={`flex shrink-0 items-center rounded-md text-muted hover:bg-sunken hover:text-strong ${isOpen ? "bg-sunken text-strong" : ""}`}
      style={{ height: 26, minWidth: 26, padding: open ? "0 6px 0 5px" : 0, justifyContent: "center", gap: 4 }}
    >
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-3.9A8 8 0 1 1 20 12z" />
      </svg>
      {open ? <span className="tnum text-meta">{open}</span> : null}
    </button>
  );
}

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
  const pageQ = usePage(pageId);
  const accessQ = usePageAccess(pageId);
  const toast = useToast();
  const navigate = useNavigate();
  const { app, set: setAppearance } = usePageAppearance(pageId);

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
  const editedName = useMemo(() => {
    if (!listRow) return null;
    const m = members.find((x) => x.user_id === listRow.edited_by);
    return m?.profiles?.full_name || m?.profiles?.email || null;
  }, [members, listRow]);

  // Save state comes from the page body's saver ("Saving…" only when a
  // save takes a while; "Not saved" while it's retrying or stopped).
  const saveStatus = useSaveStatus(pageId);
  const inFlight = saveStatus === "saving";
  const unsaved = saveStatus === "retrying" || saveStatus === "stopped";
  const stopped = saveStatus === "stopped";
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
      if (showSaving && !unsaved) {
        setSavedFlash(true);
        const t = window.setTimeout(() => setSavedFlash(false), 1500);
        setShowSaving(false);
        return () => window.clearTimeout(t);
      }
    }
    setShowSaving(false);
  }, [inFlight, showSaving, unsaved]);

  /* ────────── Mutations ────────── */
  const verify = useVerifyPage();
  const setProp = useSetPageProperty();
  const dup = useDuplicatePage();
  const archive = useArchivePage();
  const setTemplate = useSetTemplate();
  const del = useDeletePage();
  const restore = useRestorePage();

  const doCopyLink = useCallback(async () => {
    if (!listRow) return;
    const url = pageUrl(listRow.id, listRow.title);
    toClipboard(url);
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
    if (origin?.kind === "database") {
      navigate({
        to: "/p/$pageId",
        params: { pageId: origin.databaseId },
        search: origin.viewId ? { v: origin.viewId } : {},
        replace: true,
      });
      return;
    }
    // Else the page it was in, or the root.
    const parent = listRow?.parent_id;
    if (parent) {
      navigate({ to: "/p/$pageId", params: { pageId: parent }, replace: true });
      return;
    }
    navigate({ to: "/", replace: true });
  }, [navigate, pageId, listRow?.parent_id]);

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

  // ⌘⌥L (copy) and ⌘D (duplicate) shortcuts. Both yield to text fields —
  // native copy/duplicate-selection inside a textarea must win.
  useEffect(() => {
    if (!listRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const meta = primaryMod(e);
      // e.code: on a Mac ⌥L types "¬", so e.key never reads "l".
      if (meta && e.altKey && e.code === "KeyL") {
        e.preventDefault();
        void doCopyLink();
        return;
      }
      if (meta && !e.altKey && !e.shiftKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        void doDuplicate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listRow, doCopyLink, doDuplicate]);

  const [exportOpen, setExportOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);

  const exportCtx: ExportContext | null = useMemo(() => {
    if (!page) return null;
    // The page's properties as its database names them, in its order, in
    // words — none for a plain page.
    const props = propsOf(page);
    const defs = ((shell.propDefs.data ?? []) as Array<{
      key: string;
      label: string;
      type: string;
      options: unknown;
      position: number | null;
      archived_at: string | null;
      database_id: string | null;
    }>)
      .filter((d) => page.database_id && d.database_id === page.database_id && !d.archived_at)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const words = valueWords({
      defs: new Map(defs.map((d) => [d.key, d])),
      nameOf: (id) => {
        const m = members.find((x) => x.user_id === id);
        return m?.profiles?.full_name || m?.profiles?.email || "Someone";
      },
      titleOf: (id) =>
        ((shell.pages.data ?? []) as PageListItem[]).find((p) => p.id === id)?.title || "Untitled",
    });
    const properties = defs
      .filter((d) => d.type !== "rollup" && !(d.type === "relation" && relationConfig(d).of))
      .map((d) => [d.label, words(props[d.key], d.key).join(", ")] as const);
    const blocks: Block[] = Array.isArray(page.blocks)
      ? (page.blocks as unknown[]).filter(
          (b): b is Block => !!b && typeof b === "object",
        )
      : [];
    return {
      title: page.title || "Untitled",
      properties,
      verifiedAt: page.verified_at,
      blocks,
      // The page's own icon travels with the export; the dialog resolves a
      // custom-emoji shortcode to an embedded image before serialising.
      icon: typeof page.icon === "string" ? page.icon : null,
    };
  }, [page, members, shell.propDefs.data, shell.pages.data]);

  if (!listRow) return null;

  const linkIcon =
    "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.3 19";

  const isVerifiedToday = page
    ? isSameLocalDay(page.verified_at, new Date())
    : false;
  const access = accessQ.data ?? [];


  return (
    <>
      <EditedStamp
        page={listRow}
        editorName={editedName}
        saving={showSaving}
        savedFlash={savedFlash}
        unsaved={unsaved}
        stopped={stopped}
      />

      <IconButton
        onClick={doCopyLink}
        title="Copy link  ⌘⌥L"
        ariaLabel="Copy link to this page"
      >
        <Glyph path={linkIcon} />
      </IconButton>

      {page ? <CommentsButton pageId={page.id} /> : null}

      <PageMoreButton
        open={menuOpen}
        onClick={() => {
          const next = !menuOpen;
          if (next) onMenuOpen(); else onMenuClose();
        }}
      />

      {page && (
        <PageActionsMenu
          open={menuOpen}
          onClose={onMenuClose}
          page={page}
          workspaceName={workspaceName}
          memberCount={memberCount}
          access={access}
          appearance={app}
          onAppearance={setAppearance}
          handlers={{
            onCopyLink: () => { void doCopyLink(); },
            onExport: () => setExportOpen(true),
            onTaskDatabase: () => setTasksOpen(true),
            onDuplicate: () => { void doDuplicate(); },
            onOpenHistory: () => openPageHistory(page.id),
            onToggleTemplate: () =>
              setTemplate.mutate({ pageId: page.id, title: page.title ?? "", on: !page.template_at }),
            onArchive: () => archive.mutate({ pageId: page.id, archived: true }),
            onUnarchive: () => archive.mutate({ pageId: page.id, archived: false }),
            onDelete: doDelete,
            onVerify: () => {
              verify.mutate(page.id);
              toast.push("Verified just now — thanks for keeping this fresh.");
            },
            onOpenPermissions: () => {
              const btn = document.querySelector<HTMLElement>(
                "[data-page-more]",
              );
              const rect = btn?.getBoundingClientRect();
              if (rect) openPermissionsPopover(rect);
            },
          }}
        />
      )}

      {exportOpen && exportCtx && (
        <ExportDialog ctx={exportCtx} onClose={() => setExportOpen(false)} />
      )}
      {tasksOpen && page?.is_database ? (
        <TaskDatabaseDialog
          databaseId={page.id}
          title={page.title || "Untitled"}
          onClose={() => setTasksOpen(false)}
        />
      ) : null}
    </>
  );
}

