import { useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { mentionPage, useMentionDirectoryVersion } from "@/lib/mention-directory";
import { useInbox, type InboxItem } from "@/hooks/use-inbox";

/** The person's inbox, without rows for pages they can no longer open. */
export function useVisibleInbox(): { items: InboxItem[]; unread: number; loading: boolean } {
  const { user } = useAuth();
  const q = useInbox(user?.id);
  const dirVersion = useMentionDirectoryVersion();
  const items = useMemo(
    () => (q.data ?? []).filter((n) => !!mentionPage(n.page_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data, dirVersion],
  );
  return { items, unread: items.filter((n) => !n.read_at).length, loading: q.isPending };
}

/** How many unread mentions the person has (the phone's Inbox tab). */
export function useInboxUnread(): number {
  return useVisibleInbox().unread;
}
