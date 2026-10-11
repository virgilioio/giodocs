import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useFormatDate } from "@/lib/format";
import { useSetPageOrigin } from "@/lib/page-origin";
import { avatarInitials } from "@/lib/mention-trigger-ui";
import { useMarkRead, type InboxItem } from "@/hooks/use-inbox";
import { useVisibleInbox } from "@/hooks/use-visible-inbox";
import { describeNotification, openNotificationTarget } from "@/lib/inbox-text";
import { openComments } from "@/lib/comments-store";
import { Popover } from "./popover";
import { Ico } from "./emoji-icon";
import { InboxRowsSkeleton } from "./phone-skeletons";

/* Inbox — the sidebar row under Search, and its panel: everything that
 * mentioned you, newest first. A row opens the page at the block and marks
 * it read. Rows for pages you can no longer open are left out. */

const BELL = "M6 9a6 6 0 1 1 12 0c0 4.5 1.8 6 1.8 6H4.2S6 13.5 6 9zM10 19a2 2 0 0 0 4 0";

export function InboxButton() {
  const { unread } = useVisibleInbox();
  return (
    <Popover
      width={380}
      trigger={({ open: isOpen, onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          aria-expanded={isOpen}
          aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}
          className={`mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-ui text-secondary hover:bg-railHover ${isOpen ? "bg-railHover" : ""}`}
        >
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-muted">
            <path d={BELL} />
          </svg>
          <span className="flex-1 text-left">Inbox</span>
          {unread > 0 ? (
            <span
              className="tnum rounded-full bg-accent text-btnFg"
              style={{ minWidth: 18, height: 18, padding: "0 5px", fontSize: 11.5, fontWeight: 700, lineHeight: "18px", textAlign: "center" }}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      )}
    >
      {(close) => <InboxPanel close={close} />}
    </Popover>
  );
}

/** The inbox list: in the sidebar's popover, or full screen on a phone
 *  (`page`: no height cap, roomier rows). */
export function InboxPanel({ close, page = false }: { close: () => void; page?: boolean }) {
  const { user } = useAuth();
  const { items, unread, loading } = useVisibleInbox();
  const markRead = useMarkRead(user?.id);
  const navigate = useNavigate();
  const setOrigin = useSetPageOrigin();
  const fmt = useFormatDate();

  const open = (n: InboxItem, close: () => void) => {
    if (!n.read_at) markRead.mutate([n.id]);
    close();
    setOrigin(n.page_id);
    openNotificationTarget(n, navigate, openComments);
  };

  return (
        <div role="dialog" aria-label="Inbox">
          <div className="flex items-center" style={{ padding: "6px 8px 6px 10px", gap: 8 }}>
            <span className="font-display text-strong" style={{ fontSize: 15, fontWeight: 700 }}>
              Inbox
            </span>
            <span className="flex-1" />
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => markRead.mutate("all")}
                className="rounded-md px-2 text-meta text-muted hover:bg-sunken hover:text-strong"
                style={{ height: 26 }}
              >
                Mark all as read
              </button>
            ) : null}
          </div>
          {loading ? (
            <InboxRowsSkeleton page={page} />
          ) : items.length === 0 ? (
            <p className="text-meta text-muted" style={{ padding: "10px 12px 14px", lineHeight: 1.5 }}>
              Nothing here yet. When someone mentions you on a page, it shows up here.
            </p>
          ) : (
            <ul style={page ? undefined : { maxHeight: "min(520px, 70vh)", overflowY: "auto" }}>
              {items.map((n) => {
                const d = describeNotification(n);
                const unreadRow = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => open(n, close)}
                      className="flex w-full items-start rounded-md text-left hover:bg-rail"
                      style={{ gap: 10, padding: page ? "12px 10px" : "8px 10px" }}
                    >
                      <span
                        aria-hidden
                        className="grid shrink-0 place-items-center rounded-full bg-accentTint text-accent"
                        style={{ width: 26, height: 26, fontSize: 11, fontWeight: 700, marginTop: 1 }}
                      >
                        {avatarInitials(d.who)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-meta text-body" style={{ lineHeight: 1.4 }}>
                          <span style={{ fontWeight: 700 }}>{d.who}</span> {d.what}{" "}
                          <span className="inline-flex items-center" style={{ gap: 3, verticalAlign: "bottom" }}>
                            <Ico icon={d.icon} size={13} />
                            <span style={{ fontWeight: 700 }}>{d.page}</span>
                          </span>
                        </span>
                        {n.excerpt ? (
                          <span
                            className="mt-1 block text-caption text-secondary"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              borderLeft: "2px solid var(--color-line)",
                              paddingLeft: 7,
                            }}
                          >
                            {n.excerpt}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-caption text-faint">{fmt(n.created_at)}</span>
                      </span>
                      <span
                        aria-label={unreadRow ? "Unread" : undefined}
                        className="shrink-0 rounded-full"
                        style={{
                          width: 7,
                          height: 7,
                          marginTop: 9,
                          background: unreadRow ? "var(--color-accentDot)" : "transparent",
                          transition: "background-color 150ms var(--ease-out)",
                        }}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
  );
}
