import { mentionPage, mentionUserName } from "./mention-directory";
import type { InboxItem } from "@/hooks/use-inbox";

/** "Sam Rivera mentioned you in Sales playbook", in parts. */
export function describeNotification(n: Pick<InboxItem, "actor_id" | "kind" | "page_id">): { who: string; what: string; page: string; icon: string } {
  const who = (n.actor_id && mentionUserName(n.actor_id)) || "Someone";
  const page = mentionPage(n.page_id);
  return {
    who,
    what:
      n.kind === "page_mention"
        ? "mentioned you in"
        : n.kind === "comment_mention"
          ? "mentioned you in a comment on"
          : n.kind === "comment_reply"
            ? "replied to a comment on"
            : n.kind === "person_added"
              ? "added you to"
              : "updated",
    page: page?.title || "Untitled",
    icon: page?.icon || "📄",
  };
}


/** Where a notification takes you: the page, at its block or comment. */
export function openNotificationTarget(
  n: Pick<InboxItem, "page_id" | "block_id" | "comment_id">,
  navigate: (opts: { to: "/p/$pageId"; params: { pageId: string }; hash?: string }) => unknown,
  openComments: (pageId: string, opts: { focusThread: string }) => void,
): void {
  void navigate({
    to: "/p/$pageId",
    params: { pageId: n.page_id },
    hash: !n.comment_id && n.block_id ? `block-${n.block_id}` : undefined,
  });
  if (n.comment_id) openComments(n.page_id, { focusThread: n.comment_id });
}
