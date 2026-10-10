import { mentionPage, mentionUserName } from "./mention-directory";
import type { InboxItem } from "@/hooks/use-inbox";

/** "Sam Rivera mentioned you in Sales playbook", in parts. */
export function describeNotification(n: Pick<InboxItem, "actor_id" | "kind" | "page_id">): { who: string; what: string; page: string; icon: string } {
  const who = (n.actor_id && mentionUserName(n.actor_id)) || "Someone";
  const page = mentionPage(n.page_id);
  return {
    who,
    what: n.kind === "page_mention" ? "mentioned you in" : "updated",
    page: page?.title || "Untitled",
    icon: page?.icon || "📄",
  };
}

