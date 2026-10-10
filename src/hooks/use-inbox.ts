import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";

/* The inbox: this person's notifications (RLS returns only their own).
 * The database files them (pages_notify_mentions); the app only reads them
 * and marks them read. New ones arrive live. */

export type InboxItem = {
  id: string;
  kind: string;
  page_id: string;
  block_id: string | null;
  actor_id: string | null;
  excerpt: string;
  created_at: string;
  read_at: string | null;
};

async function fetchInbox(): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, page_id, block_id, actor_id, excerpt, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as InboxItem[];
}

export function useInbox(userId: string | null | undefined) {
  return useQuery({
    queryKey: qk.inbox(userId ?? "none"),
    queryFn: fetchInbox,
    enabled: !!userId,
    staleTime: 60_000,
  });
}

/** Live: a new notification refreshes the inbox and is handed to `onNew`. */
export function useInboxRealtime(
  userId: string | null | undefined,
  onNew: (item: InboxItem) => void,
) {
  const qc = useQueryClient();
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`inbox:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const item = payload.new as InboxItem;
          qc.setQueryData<InboxItem[]>(qk.inbox(userId), (prev) =>
            prev ? [item, ...prev.filter((x) => x.id !== item.id)] : prev,
          );
          void qc.invalidateQueries({ queryKey: qk.inbox(userId) });
          onNewRef.current(item);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}

/** Mark some (or all unread) notifications read, optimistically. */
export function useMarkRead(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | "all") => {
      const now = new Date().toISOString();
      let q = supabase.from("notifications").update({ read_at: now }).is("read_at", null);
      if (ids !== "all") q = q.in("id", ids);
      const { error } = await q;
      if (error) throw error;
    },
    onMutate: async (ids) => {
      if (!userId) return;
      const key = qk.inbox(userId);
      await qc.cancelQueries({ queryKey: key });
      const snap = qc.getQueryData<InboxItem[]>(key);
      const now = new Date().toISOString();
      qc.setQueryData<InboxItem[]>(key, (prev) =>
        prev?.map((x) => (!x.read_at && (ids === "all" || ids.includes(x.id)) ? { ...x, read_at: now } : x)),
      );
      return { snap };
    },
    onError: (_e, _v, ctx) => {
      if (userId && ctx?.snap) qc.setQueryData(qk.inbox(userId), ctx.snap);
    },
  });
}
