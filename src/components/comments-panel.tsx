import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { useFormatDate } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { exitOnly } from "@/lib/exit-motion";
import { renderInline } from "@/lib/inline-markdown";
import { mentionUserName, useMentionDirectoryVersion } from "@/lib/mention-directory";
import { avatarInitials } from "@/lib/mention-trigger-ui";
import { closeComments, openComments, useCommentsPanel } from "@/lib/comments-store";
import {
  commentError,
  toThreads,
  useAddComment,
  useComments,
  useEditComment,
  useResolveThread,
  useSetCommentRemoved,
  type CommentRow,
  type Thread,
} from "@/hooks/use-comments";
import { Editable } from "./editable";

/* Comments — a panel on the right of the page, over it (nothing on the
 * page moves). Open threads in page order, page-wide ones first; resolved
 * threads fold away underneath. A thread can be about a block and the words
 * selected in it; its quote scrolls the page there.
 *
 * Writing a comment: Enter sends, Shift+Enter starts a new line, @ mentions
 * someone (they hear about it in their inbox). */

const ICON = {
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  send: "M5 12h13M12 5l7 7-7 7",
  more: "M5 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM19 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z",
  reopen: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4",
};

function Svg({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong disabled:opacity-40"
      style={{ width: 26, height: 26 }}
    >
      {children}
    </button>
  );
}

/** A comment's text: inline formatting and mentions, line breaks kept. */
function Body({ text }: { text: string }) {
  useMentionDirectoryVersion();
  const lines = text.split("\n");
  return (
    <div className="text-meta text-body" style={{ lineHeight: 1.5, overflowWrap: "anywhere" }}>
      {lines.map((l, i) => (
        <div key={i} style={{ minHeight: "1.5em" }}>
          {renderInline(l)}
        </div>
      ))}
    </div>
  );
}

/* ────────────── Composer ────────────── */

export function CommentComposer({
  placeholder,
  initial = "",
  autoFocus,
  submitLabel = "Send",
  onSubmit,
  onCancel,
  compact,
}: {
  placeholder: string;
  initial?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [source, setSource] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const empty = source.trim().length === 0;

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // Caret at the end.
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }, [autoFocus]);

  const send = async () => {
    if (empty || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(source);
      setSource("");
    } catch (e) {
      setErr(commentError(e));
    } finally {
      setBusy(false);
    }
  };

  const open = !compact || focused || !empty;

  return (
    <div>
      <div
        className={`rounded-lg border bg-surface ${focused ? "border-accent" : "border-line"}`}
        style={{ padding: open ? "7px 8px 6px 10px" : "5px 8px 5px 10px", transition: "border-color 150ms var(--ease-out)" }}
      >
        <Editable
          ref={ref}
          source={source}
          onSourceChange={setSource}
          placeholder={placeholder}
          ariaLabel={placeholder}
          className="gio-line text-meta text-body"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              void send();
              return;
            }
            if (e.key === "Escape" && onCancel) {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {open ? (
          <div className="mt-1.5 flex items-center justify-end" style={{ gap: 6 }}>
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md px-2 text-meta text-muted hover:bg-sunken hover:text-strong"
                style={{ height: 26 }}
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void send()}
              disabled={empty || busy}
              aria-label={submitLabel}
              title={`${submitLabel} (Enter)`}
              className="grid place-items-center rounded-md bg-btn text-btnFg disabled:opacity-30"
              style={{ height: 26, minWidth: 26, padding: "0 6px" }}
            >
              {submitLabel === "Send" ? <Svg d={ICON.send} size={14} /> : <span className="text-meta" style={{ fontWeight: 700 }}>{submitLabel}</span>}
            </button>
          </div>
        ) : null}
      </div>
      {/* Reserved only once something went wrong; never a layout jump while typing. */}
      {err ? (
        <div role="alert" className="mt-1 text-caption" style={{ color: "var(--color-danger)" }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}

/* ────────────── One comment ────────────── */

function CommentItem({
  c,
  pageId,
  isRoot,
  thread,
}: {
  c: CommentRow;
  pageId: string;
  isRoot: boolean;
  thread: Thread;
}) {
  const { user } = useAuth();
  const fmt = useFormatDate();
  const toast = useToast();
  const edit = useEditComment(pageId);
  const removeM = useSetCommentRemoved(pageId);
  const resolve = useResolveThread(pageId);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const mine = c.author_id === user?.id;
  const name = mentionUserName(c.author_id) ?? "Someone";

  const remove = () => {
    setMenu(false);
    // A promise, not mutate callbacks: the comment leaves the list at once,
    // and callbacks tied to it would never run.
    const label = isRoot && thread.replies.length ? "Thread removed." : "Comment removed.";
    removeM.mutateAsync({ id: c.id, removed: true }).then(
      () =>
        toast.push({
          message: label,
          action: {
            label: "Undo",
            onClick: () => {
              removeM.mutateAsync({ id: c.id, removed: false }).catch((e) => toast.push(commentError(e)));
            },
          },
        }),
      (e) => toast.push(commentError(e)),
    );
  };

  return (
    <div className="group" style={{ padding: "6px 0" }}>
      <div className="flex items-center" style={{ gap: 7 }}>
        <span
          aria-hidden
          className="grid shrink-0 place-items-center rounded-full bg-accentTint text-accent"
          style={{ width: 22, height: 22, fontSize: 10.5, fontWeight: 700 }}
        >
          {avatarInitials(name)}
        </span>
        <span className="min-w-0 truncate text-meta text-strong" style={{ fontWeight: 700 }}>
          {name}
        </span>
        <span className="shrink-0 text-caption text-faint">
          {fmt(c.created_at)}
          {c.edited_at ? " · edited" : ""}
        </span>
        <span className="flex-1" />
        {isRoot ? (
          <IconButton
            label={thread.root.resolved_at ? "Reopen thread" : "Resolve thread"}
            onClick={() => {
              resolve
                .mutateAsync({ thread: c.id, resolved: !thread.root.resolved_at })
                .catch((e) => toast.push(commentError(e)));
            }}
          >
            <Svg d={thread.root.resolved_at ? ICON.reopen : ICON.check} />
          </IconButton>
        ) : null}
        {mine && !editing ? (
          <div className="relative">
            <IconButton label="Comment actions" onClick={() => setMenu((v) => !v)}>
              <Svg d={ICON.more} />
            </IconButton>
            {menu ? (
              <div
                ref={exitOnly("pop")}
                role="menu"
                className="absolute right-0 z-10 rounded-lg border border-line bg-surface p-1 shadow-popover animate-popIn"
                style={{ top: 28, width: 150, transformOrigin: "top right" }}
                onMouseLeave={() => setMenu(false)}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    setEditing(true);
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-meta text-body hover:bg-rail"
                >
                  Edit
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={remove}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-meta hover:bg-dangerTint"
                  style={{ color: "var(--color-danger)" }}
                >
                  {isRoot && thread.replies.length ? "Remove thread" : "Remove"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div style={{ paddingLeft: 29, marginTop: 3 }}>
        {editing ? (
          <CommentComposer
            placeholder="Edit your comment"
            initial={c.body}
            autoFocus
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await edit.mutateAsync({ id: c.id, body });
              setEditing(false);
            }}
          />
        ) : (
          <Body text={c.body} />
        )}
      </div>
    </div>
  );
}

/* ────────────── One thread ────────────── */

function scrollToBlock(blockId: string) {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("gio-flash");
  void el.offsetWidth;
  el.classList.add("gio-flash");
}

function ThreadCard({ t, pageId, focused }: { t: Thread; pageId: string; focused: boolean }) {
  const add = useAddComment(pageId);
  const ref = useRef<HTMLDivElement | null>(null);
  const [replying, setReplying] = useState(false);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  return (
    <div
      ref={ref}
      data-thread={t.root.id}
      className={`rounded-xl border bg-surface ${focused ? "border-accentRing" : "border-line"}`}
      style={{
        padding: "8px 12px 10px",
        boxShadow: focused ? "0 0 0 3px var(--color-accentTint)" : undefined,
        transition: "box-shadow 150ms var(--ease-out), border-color 150ms var(--ease-out)",
      }}
    >
      {t.root.quote || t.root.block_id ? (
        <button
          type="button"
          onClick={() => t.root.block_id && scrollToBlock(t.root.block_id)}
          className="mb-1 block w-full text-left text-caption text-secondary hover:text-strong"
          style={{ borderLeft: "2px solid var(--color-highlight)", paddingLeft: 8, overflowWrap: "anywhere" }}
          title="Show it on the page"
        >
          <span style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {t.root.quote ? `“${t.root.quote}”` : "On a block"}
          </span>
        </button>
      ) : null}
      <CommentItem c={t.root} pageId={pageId} isRoot thread={t} />
      {t.replies.map((r) => (
        <CommentItem key={r.id} c={r} pageId={pageId} isRoot={false} thread={t} />
      ))}
      {t.root.resolved_at ? null : (
        <div style={{ marginTop: 4 }}>
          <CommentComposer
            compact={!replying}
            placeholder="Reply…"
            onSubmit={async (body) => {
              await add.mutateAsync({ body, thread: t.root.id });
              setReplying(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ────────────── The panel ────────────── */

export function CommentsHost({ pageId, blockOrder }: { pageId: string; blockOrder: readonly string[] }) {
  const panel = useCommentsPanel();
  if (!panel || panel.pageId !== pageId) return null;
  return <CommentsPanel pageId={pageId} blockOrder={blockOrder} />;
}

function CommentsPanel({ pageId, blockOrder }: { pageId: string; blockOrder: readonly string[] }) {
  const panel = useCommentsPanel();
  const q = useComments(pageId);
  const add = useAddComment(pageId);
  const [showResolved, setShowResolved] = useState(false);
  const threads = useMemo(() => toThreads(q.data ?? []), [q.data]);
  const order = useMemo(() => new Map(blockOrder.map((id, i) => [id, i])), [blockOrder]);
  const pos = (t: Thread) => (t.root.block_id ? (order.get(t.root.block_id) ?? 1e6) : -1);
  const open = threads.filter((t) => !t.root.resolved_at).sort((a, b) => pos(a) - pos(b));
  const resolved = threads.filter((t) => t.root.resolved_at);
  const draft = panel?.draft ?? null;
  const [draftOpen, setDraftOpen] = useState<typeof draft>(draft);
  useEffect(() => setDraftOpen(panel?.draft ?? null), [panel?.seq, panel?.draft]);
  // A notification may point at a reply: focus the thread it's in.
  const focusId = panel?.focusThread ?? null;
  const focusThread = focusId
    ? (threads.find((t) => t.root.id === focusId || t.replies.some((r) => r.id === focusId))?.root.id ?? null)
    : null;
  useEffect(() => {
    if (focusThread && resolved.some((t) => t.root.id === focusThread)) setShowResolved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusThread, q.data]);

  // The page makes room for the panel (see .gio-comments-open in styles.css).
  useEffect(() => {
    document.documentElement.classList.add("gio-comments-open");
    return () => document.documentElement.classList.remove("gio-comments-open");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      // Escape inside a comment box cancels that box first.
      if (t?.closest?.("[data-comments-panel] [contenteditable]")) return;
      if (t?.closest?.("[data-comments-panel]")) closeComments();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside
      ref={exitOnly("drawer")}
      data-comments-panel
      aria-label="Comments"
      className="flex flex-col border-l border-line bg-rail animate-drawerIn"
      style={{
        position: "fixed",
        // Below the top bar, so its buttons (and this panel's toggle) stay reachable.
        top: "var(--spacing-topbar)",
        right: 0,
        bottom: 0,
        width: "var(--comments-panel-w)",
        zIndex: 60,
      }}
    >
      <div className="flex items-center border-b border-line bg-surface" style={{ padding: "12px 12px 12px 18px", gap: 8 }}>
        <h2 className="font-display text-strong" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Comments
        </h2>
        {open.length > 0 ? <span className="tnum text-meta text-muted">{open.length} open</span> : null}
        <span className="flex-1" />
        <IconButton label="Close comments" onClick={closeComments}>
          <Svg d={ICON.close} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "12px 14px 24px" }}>
        {/* A new thread: on the selected words, or on the whole page. */}
        <div style={{ marginBottom: 14 }}>
          {draftOpen?.quote ? (
            <div
              className="mb-1.5 text-caption text-secondary"
              style={{ borderLeft: "2px solid var(--color-highlight)", paddingLeft: 8, overflowWrap: "anywhere" }}
            >
              <span style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                “{draftOpen.quote}”
              </span>
            </div>
          ) : null}
          <CommentComposer
            key={panel?.seq}
            autoFocus={!!draftOpen || (!q.isPending && threads.length === 0)}
            placeholder={draftOpen?.blockId ? "Comment on this…" : "Add a comment on this page…"}
            onCancel={draftOpen ? () => setDraftOpen(null) : undefined}
            onSubmit={async (body) => {
              await add.mutateAsync({ body, block: draftOpen?.blockId ?? null, quote: draftOpen?.quote ?? null });
              setDraftOpen(null);
            }}
          />
        </div>

        {q.isError ? (
          <div className="text-meta text-body">
            Couldn't load the comments.{" "}
            <button type="button" onClick={() => void q.refetch()} className="underline">
              Try again
            </button>
          </div>
        ) : null}

        {q.isSuccess && threads.length === 0 ? (
          <p className="text-meta text-muted" style={{ lineHeight: 1.5 }}>
            No comments yet. Select some words on the page and choose Comment, or write one above for the whole page.
          </p>
        ) : null}

        <div className="flex flex-col" style={{ gap: 10 }}>
          {open.map((t) => (
            <ThreadCard key={t.root.id} t={t} pageId={pageId} focused={focusThread === t.root.id} />
          ))}
        </div>

        {resolved.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              onClick={() => setShowResolved((v) => !v)}
              aria-expanded={showResolved}
              className="flex items-center rounded-md px-1 text-label uppercase text-faint hover:text-strong"
              style={{ gap: 5, height: 24 }}
            >
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden className="gio-props-chevron" style={{ transform: showResolved ? "rotate(90deg)" : undefined }}>
                <path d="M9 6l6 6-6 6" />
              </svg>
              Resolved · <span className="tnum">{resolved.length}</span>
            </button>
            {showResolved ? (
              <div className="mt-2 flex flex-col" style={{ gap: 10, opacity: 0.85 }}>
                {resolved.map((t) => (
                  <ThreadCard key={t.root.id} t={t} pageId={pageId} focused={focusThread === t.root.id} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/* ────────────── Markers in the margin ────────────── */

/** A small count beside each block that has open threads. Click to see
 *  them. Placed by measuring the blocks, re-measured when the page
 *  changes size or its blocks move. */
export function CommentMarkers({ pageId }: { pageId: string }) {
  const q = useComments(pageId);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [tops, setTops] = useState<Array<{ blockId: string; top: number; count: number; thread: string }>>([]);
  const byBlock = useMemo(() => {
    const m = new Map<string, { count: number; thread: string }>();
    for (const t of toThreads(q.data ?? [])) {
      if (t.root.resolved_at || !t.root.block_id) continue;
      const cur = m.get(t.root.block_id);
      m.set(t.root.block_id, { count: (cur?.count ?? 0) + 1, thread: cur?.thread ?? t.root.id });
    }
    return m;
  }, [q.data]);

  useEffect(() => {
    const host = hostRef.current?.parentElement;
    if (!host) return;
    if (byBlock.size === 0) {
      setTops([]);
      return;
    }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const base = host.getBoundingClientRect().top;
        const out: typeof tops = [];
        for (const [blockId, v] of byBlock) {
          const el = host.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
          if (!el) continue;
          out.push({ blockId, top: Math.round(el.getBoundingClientRect().top - base), ...v });
        }
        setTops((prev) =>
          prev.length === out.length && prev.every((p, i) => p.blockId === out[i].blockId && p.top === out[i].top && p.count === out[i].count)
            ? prev
            : out,
        );
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const mo = new MutationObserver(measure);
    mo.observe(host, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [byBlock]);

  return (
    <div ref={hostRef} aria-hidden={tops.length === 0 ? true : undefined}>
      {tops.map((m) => (
        <button
          key={m.blockId}
          type="button"
          onClick={() => openComments(pageId, { focusThread: m.thread })}
          aria-label={m.count === 1 ? "1 comment thread on this block" : `${m.count} comment threads on this block`}
          title="Show comments"
          className="flex items-center rounded-md text-muted hover:bg-sunken hover:text-strong"
          style={{ position: "absolute", top: m.top + 2, right: -40, height: 22, padding: "0 5px", gap: 3 }}
        >
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-3.9A8 8 0 1 1 20 12z" />
          </svg>
          <span className="tnum text-caption">{m.count}</span>
        </button>
      ))}
    </div>
  );
}
