import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useAuth } from "@/lib/auth-context";
import type { PageListItem } from "@/lib/types";

const PAGE_LIST_FIELDS: (keyof PageListItem)[] = [
  "id",
  "title",
  "icon",
  "props",
  "verified_at",
  "verified_by",
  "edited_at",
  "edited_by",
  "access_type",
];

function projectPage(row: Record<string, unknown>): PageListItem {
  const out: Record<string, unknown> = {};
  for (const k of PAGE_LIST_FIELDS) out[k as string] = row[k as string];
  return out as PageListItem;
}

/**
 * Subscribes once per workspace to `pages` and `views` changes.
 * - Pages: patch the list cache in place (never invalidate).
 *   Ignore payloads whose edited_by is the current user — optimistic
 *   update already applied and a "self" patch would clobber pending
 *   local state.
 * - Views: invalidate the views list.
 */
export function useRealtimeWorkspace(workspaceId: string | undefined) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const myId = user?.id;

  useEffect(() => {
    if (!workspaceId) return;

    const channel = supabase
      .channel(`ws:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pages",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const key = qk.pages(workspaceId);
          const newRow = payload.new as Record<string, unknown> | null;
          const oldRow = payload.old as Record<string, unknown> | null;

          if (payload.eventType === "DELETE") {
            const id = (oldRow?.id as string | undefined) ?? undefined;
            if (!id) return;
            qc.setQueryData<PageListItem[]>(key, (prev) =>
              prev ? prev.filter((p) => p.id !== id) : prev,
            );
            qc.removeQueries({ queryKey: qk.page(id) });
            return;
          }

          if (!newRow) return;
          // Ignore our own edits — optimistic patch is authoritative.
          if (myId && newRow.edited_by === myId) return;

          const softDeleted = newRow.deleted_at != null;
          const id = newRow.id as string;

          qc.setQueryData<PageListItem[]>(key, (prev) => {
            if (!prev) return prev;
            if (softDeleted) return prev.filter((p) => p.id !== id);
            const projected = projectPage(newRow);
            const idx = prev.findIndex((p) => p.id === id);
            if (idx === -1) return [projected, ...prev];
            const next = prev.slice();
            next[idx] = { ...next[idx], ...projected };
            return next;
          });

          // Patch the detail cache too, if present.
          qc.setQueryData(qk.page(id), (prev: unknown) =>
            prev ? { ...(prev as object), ...newRow } : prev,
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "views",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: qk.views(workspaceId) });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, qc, myId]);
}
