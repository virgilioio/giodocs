import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useInlineEmojiSet } from "@/lib/emoji-registry";
import { exitOnly, exitRef } from "@/lib/exit-motion";
import { qk } from "@/lib/query-keys";
import { useToast } from "@/lib/toast";
import { describeDiff, diffVersion } from "@/lib/version-diff";
import {
  fetchRestoredPage,
  restoreErrorMessage,
  restoreVersion,
  usePageVersions,
  useVersionPreview,
  versionTime,
  type PageVersion,
} from "@/hooks/use-page-history";
import {
  closePageHistory,
  getOpenPageHistory,
  pageHistoryHosts as hosts,
  subscribePageHistory,
  type PageHistoryHostApi as HostApi,
} from "@/lib/page-history-store";
import { Ico } from "./emoji-icon";
import { Sk } from "./sk";
import type { Block, PageFull } from "@/lib/types";

/* Page history — every saved version of a page, a preview of each, and
 * Restore.
 *
 * Opened from the page's ⋯ menu (openPageHistory). The dialog is hosted by
 * the page itself (PageHistoryHost in page-view), because restoring has to
 * finish the page's pending saves first and then load the restored content
 * into the editor; the host hands over both steps. Restoring is undoable
 * from the toast: the database saves what it replaced as a version. */

type Member = {
  user_id: string;
  profiles: { full_name: string | null; email: string | null } | null;
};

class NotSafeYet extends Error {}

/** Restore `versionId` and bring the page up to date wherever it's open.
 *  Returns the id of the version holding what was replaced. */
async function restoreAndAdopt(
  pageId: string,
  versionId: string,
  qc: QueryClient,
  ws: string,
): Promise<string | null> {
  const host = hosts.get(pageId);
  if (host) {
    const problem = await host.prepare();
    if (problem) throw new NotSafeYet(problem);
  }
  const saved = await restoreVersion(versionId);
  if (saved) {
    const row = await fetchRestoredPage(pageId);
    const live = hosts.get(pageId);
    if (live) live.adopt(row);
    else void qc.invalidateQueries({ queryKey: qk.page(pageId) });
    void qc.invalidateQueries({ queryKey: qk.pages(ws) });
  }
  void qc.invalidateQueries({ queryKey: qk.pageVersions(pageId) });
  return saved;
}

/* ────────────── Words ────────────── */

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? null : { year: "numeric" }),
  });
}

/** "Today at 3:42 PM", "Wed, Oct 8 at 9:05 AM". */
function whenLabel(iso: string): string {
  return `${dayLabel(iso)} at ${timeFmt.format(new Date(iso))}`;
}

function nameOf(userId: string | null, members: Member[], meId: string): string {
  if (!userId) return "Someone";
  if (userId === meId) return "You";
  const m = members.find((x) => x.user_id === userId);
  const full = m?.profiles?.full_name?.trim();
  if (full) return full;
  return m?.profiles?.email?.split("@")[0] ?? "Someone";
}

/* ────────────── Host ────────────── */

export function PageHistoryHost({
  page,
  members,
  meId,
  canEdit,
  prepare,
  adopt,
}: {
  page: PageFull;
  members: Member[];
  meId: string;
  canEdit: boolean;
} & HostApi) {
  const open = useSyncExternalStore(subscribePageHistory, getOpenPageHistory, () => null);
  const apiRef = useRef<HostApi>({ prepare, adopt });
  apiRef.current = { prepare, adopt };

  useEffect(() => {
    const api: HostApi = {
      prepare: () => apiRef.current.prepare(),
      adopt: (row) => apiRef.current.adopt(row),
    };
    hosts.set(page.id, api);
    return () => {
      if (hosts.get(page.id) === api) hosts.delete(page.id);
      // Leaving the page closes its history.
      if (getOpenPageHistory() === page.id) closePageHistory();
    };
  }, [page.id]);

  if (open !== page.id) return null;
  return <PageHistoryDialog page={page} members={members} meId={meId} canEdit={canEdit} />;
}

/* ────────────── Dialog ────────────── */

function PageHistoryDialog({
  page,
  members,
  meId,
  canEdit,
}: {
  page: PageFull;
  members: Member[];
  meId: string;
  canEdit: boolean;
}) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const toast = useToast();
  const emojiSet = useInlineEmojiSet();
  const versionsQ = usePageVersions(page.id, true);
  const versions = useMemo(() => versionsQ.data ?? [], [versionsQ.data]);

  const currentBlocks = useMemo(
    () => (Array.isArray(page.blocks) ? (page.blocks as unknown as Block[]) : []),
    [page.blocks],
  );
  const current = useMemo(
    () => ({ title: page.title, icon: page.icon, blocks: currentBlocks, editedAt: page.edited_at }),
    [page.title, page.icon, currentBlocks, page.edited_at],
  );

  // Start on the latest saved version; "current" when there are none.
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? (versionsQ.isSuccess ? (versions[0]?.id ?? "current") : null);
  const selectedVersion = versions.find((v) => v.id === selected) ?? null;
  const preview = useVersionPreview(selected, current, emojiSet);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setErr(null), [selected]);

  const close = useCallback(() => {
    if (!busy) closePageHistory();
  }, [busy]);

  /* Focus: into the list on open, back where it was on close; Tab stays in
   * the dialog; Escape closes. */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const cardExit = useMemo(() => exitRef<HTMLDivElement>("dialog", cardRef), []);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    listRef.current?.focus({ preventScroll: true });
    return () => {
      if (before && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const els = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex="0"], iframe',
        ),
      );
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !cardRef.current.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !cardRef.current.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  // The order the list shows, "current" first.
  const order = useMemo(() => ["current", ...versions.map((v) => v.id)], [versions]);
  const move = (delta: number) => {
    if (!selected) return;
    const i = order.indexOf(selected);
    const next = order[Math.max(0, Math.min(order.length - 1, i + delta))];
    setPicked(next);
  };
  useEffect(() => {
    if (!selected) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-version="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const diffText = useMemo(() => {
    if (!preview.data || selected === "current") return null;
    return describeDiff(
      diffVersion(preview.data, { title: page.title, icon: page.icon, blocks: currentBlocks }),
      preview.data.title,
    );
  }, [preview.data, selected, page.title, page.icon, currentBlocks]);

  const onRestore = async () => {
    if (!selectedVersion || busy || !canEdit) return;
    setBusy(true);
    setErr(null);
    const when = whenLabel(versionTime(selectedVersion));
    try {
      const saved = await restoreAndAdopt(page.id, selectedVersion.id, qc, ws);
      closePageHistory();
      if (!saved) {
        toast.push("The page already looks like this version.");
        return;
      }
      const pageId = page.id;
      toast.push({
        message: `Restored the version from ${when.charAt(0).toLowerCase()}${when.slice(1)}.`,
        action: {
          label: "Undo",
          onClick: () => {
            restoreAndAdopt(pageId, saved, qc, ws).then(
              () => toast.push("Undone. The page is back as it was."),
              (e) => toast.push(e instanceof NotSafeYet ? e.message : restoreErrorMessage(e)),
            );
          },
        },
      });
    } catch (e) {
      setErr(e instanceof NotSafeYet ? e.message : restoreErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: PageVersion[] }> = [];
    for (const v of versions) {
      const label = dayLabel(versionTime(v));
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(v);
      else out.push({ label, items: [v] });
    }
    return out;
  }, [versions]);

  const headWho =
    selected === "current"
      ? `Edited by ${nameOf(page.edited_by, members, meId)}`
      : selectedVersion
        ? `Edited by ${nameOf(selectedVersion.edited_by, members, meId)}`
        : "";
  const headWhen =
    selected === "current"
      ? "Current version"
      : selectedVersion
        ? whenLabel(versionTime(selectedVersion))
        : "";

  const restoreDisabled = !selectedVersion || busy || !canEdit;

  return (
    <>
      <div
        ref={exitOnly("fade")}
        aria-hidden
        className="animate-fadeIn"
        onMouseDown={close}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: "var(--z-modal)",
          background: "rgba(13,13,9,.32)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
        }}
      />
      <div
        ref={cardExit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-history-title"
        className="animate-dialogIn"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          translate: "-50% -50%",
          width: "min(1120px, calc(100vw - 48px))",
          height: "min(800px, calc(100vh - 48px))",
          zIndex: "calc(var(--z-modal) + 1)",
          display: "flex",
          overflow: "hidden",
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(13,13,9,.22)",
        }}
      >
        {/* Preview */}
        <section
          aria-label="Preview"
          className="flex min-w-0 flex-1 flex-col bg-canvas"
        >
          <div
            className="border-b border-line bg-surface"
            style={{ padding: "14px 22px 12px", minHeight: 74 }}
          >
            <div className="flex min-w-0 items-baseline" style={{ gap: 8 }}>
              <span className="truncate text-strong" style={{ fontSize: 15, fontWeight: 700 }}>
                {headWhen || " "}
              </span>
              {headWho ? <span className="shrink-0 text-meta text-muted">{headWho}</span> : null}
            </div>
            {/* Reserved line: the sentence arrives without moving anything. */}
            <div className="mt-1 text-meta text-secondary" style={{ minHeight: 20 }}>
              {selected === "current"
                ? "This is the page as it is now. Pick an earlier version to compare."
                : diffText}
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            {preview.data ? (
              <iframe
                key={selected ?? "none"}
                title={headWhen ? `Preview: ${headWhen}` : "Preview"}
                // No scripts: the preview is our own escaped markup. Same
                // origin only so the app's fonts load into it.
                sandbox="allow-same-origin"
                srcDoc={preview.data.html}
                className="animate-fadeIn"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            ) : preview.isError ? (
              <div className="grid h-full place-items-center px-6 text-center">
                <div>
                  <p className="text-row text-body">Couldn't load this version.</p>
                  <button
                    type="button"
                    onClick={() => void preview.refetch()}
                    className="mt-3 rounded-md border border-line bg-surface px-3 text-meta text-body hover:bg-rail"
                    style={{ height: 28 }}
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <PreviewSkeleton />
            )}
          </div>
        </section>

        {/* Versions */}
        <aside
          className="flex flex-col border-l border-line bg-rail"
          style={{ width: 300, flex: "none" }}
        >
          <div className="flex items-start" style={{ padding: "16px 12px 10px 18px", gap: 8 }}>
            <div className="min-w-0 flex-1">
              <h2
                id="page-history-title"
                className="font-display text-strong"
                style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.03em" }}
              >
                Page history
              </h2>
              <p className="mt-1 text-caption text-muted" style={{ lineHeight: 1.45 }}>
                A version is saved when someone starts a new round of edits. The last 50 are kept.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close page history"
              title="Close"
              className="grid shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong"
              style={{ width: 28, height: 28 }}
            >
              <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div
            ref={listRef}
            role="listbox"
            aria-label="Versions"
            aria-activedescendant={selected ? `pv-${selected}` : undefined}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Home") {
                e.preventDefault();
                setPicked("current");
              } else if (e.key === "End") {
                e.preventDefault();
                setPicked(order[order.length - 1]);
              }
            }}
            className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
            style={{ padding: "2px 8px 10px" }}
          >
            <VersionOption
              id="current"
              selected={selected === "current"}
              onPick={setPicked}
              primary="Current version"
              secondary={`Now · ${nameOf(page.edited_by, members, meId)}`}
            />
            {versionsQ.isPending ? (
              <div role="status" aria-busy="true" aria-label="Loading versions" style={{ padding: "8px 10px" }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} style={{ padding: "9px 0" }}>
                    <Sk w={i % 2 ? 92 : 120} h={11} />
                    <Sk w={70} h={9} style={{ marginTop: 7 }} />
                  </div>
                ))}
              </div>
            ) : versionsQ.isError ? (
              <div className="px-2 py-3 text-meta text-body">
                Couldn't load the history.{" "}
                <button type="button" onClick={() => void versionsQ.refetch()} className="underline">
                  Try again
                </button>
              </div>
            ) : versions.length === 0 ? (
              <p className="px-2 py-3 text-meta text-muted" style={{ lineHeight: 1.5 }}>
                No earlier versions yet. The first one is saved the next time someone edits this page.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.label} role="group" aria-label={g.label}>
                  <div className="px-2 pb-1 pt-3 text-label uppercase text-faint">{g.label}</div>
                  {g.items.map((v) => (
                    <VersionOption
                      key={v.id}
                      id={v.id}
                      selected={selected === v.id}
                      onPick={setPicked}
                      icon={v.icon}
                      primary={timeFmt.format(new Date(versionTime(v)))}
                      secondary={nameOf(v.edited_by, members, meId)}
                      title={(v.title || "") !== (page.title || "") ? v.title || "Untitled" : null}
                    />
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-line" style={{ padding: "12px 14px 14px" }}>
            {/* Reserved space: the error never moves the buttons. */}
            <div
              role="alert"
              className="text-meta"
              style={{ minHeight: 18, color: "var(--color-danger)", lineHeight: 1.4, marginBottom: err ? 8 : 0 }}
            >
              {err}
            </div>
            {!canEdit ? (
              <p className="mb-2 text-caption text-muted">You can view this page but not edit it, so you can't restore a version.</p>
            ) : (
              <p className="mb-2 text-caption text-muted">
                Restores the title, icon and content. Properties keep their current values. You can undo it.
              </p>
            )}
            <div className="flex items-center justify-end" style={{ gap: 8 }}>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-lg text-body hover:bg-sunken"
                style={{ padding: "8px 14px", fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRestore}
                disabled={restoreDisabled}
                className="bg-btn text-btnFg disabled:opacity-40"
                style={{ padding: "8px 16px", fontSize: 14, fontWeight: 700, borderRadius: 9, minWidth: 92 }}
              >
                {busy ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function VersionOption({
  id,
  selected,
  onPick,
  primary,
  secondary,
  icon,
  title,
}: {
  id: string;
  selected: boolean;
  onPick: (id: string) => void;
  primary: string;
  secondary: string;
  icon?: string | null;
  title?: string | null;
}) {
  return (
    <div
      id={`pv-${id}`}
      data-version={id}
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(id)}
      className={`cursor-pointer rounded-lg ${selected ? "bg-surface shadow-card" : "hover:bg-railHover"}`}
      style={{ padding: "7px 10px", marginTop: 2 }}
    >
      <div className="flex min-w-0 items-baseline" style={{ gap: 6 }}>
        <span className="gio-stable-bold shrink-0 text-strong" data-label={primary} style={{ fontSize: 14, fontWeight: selected ? 700 : 400 }}>
          {primary}
        </span>
        <span className="min-w-0 truncate text-meta text-muted">{secondary}</span>
      </div>
      {title ? (
        <div className="mt-0.5 flex min-w-0 items-center text-caption text-secondary" style={{ gap: 5 }}>
          {icon ? <Ico icon={icon} size={12} /> : null}
          <span className="truncate">{title}</span>
        </div>
      ) : null}
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading preview" style={{ padding: "34px 44px" }}>
      <Sk w="46%" h={26} r={6} />
      <div style={{ height: 22 }} />
      {[92, 84, 96, 60, 0, 88, 72, 90, 40].map((w, i) =>
        w === 0 ? <div key={i} style={{ height: 16 }} /> : <Sk key={i} w={`${w}%`} h={12} style={{ marginTop: 10 }} />,
      )}
    </div>
  );
}
