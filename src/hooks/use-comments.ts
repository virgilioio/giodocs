import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useAuth } from "@/lib/auth-context";

/* Comments on a page. Reads come straight from the table (RLS shows only
 * what the reader may see); every write goes through a database function
 * (add_comment, edit_comment, set_comment_removed, resolve_comment_thread),
 * which holds the rules. Other people's comments arrive live. */

export type CommentRow = {
  id: string;
  thread_id: string | null;
  block_id: string | null;
  quote: string | null;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
};

export type Thread = { root: CommentRow; replies: CommentRow[] };

const COLS = "id, thread_id, block_id, quote, author_id, body, created_at, edited_at, resolved_at, resolved_by";

async function fetchComments(pageId: string): Promise<CommentRow[]> {
  const { data, error } = await supabase
    .from("comments")
    .select(COLS)
    .eq("page_id", pageId)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as CommentRow[];
}

export function useComments(pageId: string) {
  return useQuery({
    queryKey: qk.comments(pageId),
    queryFn: () => fetchComments(pageId),
    staleTime: 30_000,
  });
}

/** Keep a page's comments live while it's open. Mount once per page. */
export function useCommentsLive(pageId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`comments:${pageId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: `page_id=eq.${pageId}` },
        () => void qc.invalidateQueries({ queryKey: qk.comments(pageId) }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pageId, qc]);
}

/** Rows → threads, in the order they were started. */
export function toThreads(rows: readonly CommentRow[]): Thread[] {
  const roots = new Map<string, Thread>();
  for (const r of rows) if (!r.thread_id) roots.set(r.id, { root: r, replies: [] });
  for (const r of rows) {
    if (!r.thread_id) continue;
    roots.get(r.thread_id)?.replies.push(r);
  }
  return [...roots.values()];
}

/** Plain words for a failed comment action. */
export function commentError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "42501" || e?.code === "22023" || e?.code === "P0002") return e.message ?? "That didn't work.";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Try again once you're back online.";
  return "Couldn't save that. Try again.";
}

function useRefresh(pageId: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: qk.comments(pageId) });
}

export function useAddComment(pageId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const refresh = useRefresh(pageId);
  return useMutation({
    mutationFn: async (v: { body: string; thread?: string | null; block?: string | null; quote?: string | null }) => {
      const { data, error } = await supabase.rpc("add_comment", {
        p_page: pageId,
        p_body: v.body,
        p_thread: v.thread ?? undefined,
        p_block: v.block ?? undefined,
        p_quote: v.quote ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id, v) => {
      // Show it at once; the refetch brings the stored row.
      const now = new Date().toISOString();
      qc.setQueryData<CommentRow[]>(qk.comments(pageId), (prev) => {
        const row: CommentRow = {
          id,
          thread_id: v.thread ?? null,
          block_id: v.thread ? null : (v.block ?? null),
          quote: v.thread ? null : (v.quote ?? null),
          author_id: user?.id ?? "",
          body: v.body.trim(),
          created_at: now,
          edited_at: null,
          resolved_at: null,
          resolved_by: null,
        };
        const next = (prev ?? []).filter((x) => x.id !== id);
        // A reply reopens its thread.
        return [...next.map((x) => (v.thread && x.id === v.thread ? { ...x, resolved_at: null, resolved_by: null } : x)), row];
      });
      refresh();
    },
  });
}

export function useEditComment(pageId: string) {
  const refresh = useRefresh(pageId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; body: string }) => {
      const { error } = await supabase.rpc("edit_comment", { p_comment: v.id, p_body: v.body });
      if (error) throw error;
    },
    onMutate: (v) => {
      const snap = qc.getQueryData<CommentRow[]>(qk.comments(pageId));
      qc.setQueryData<CommentRow[]>(qk.comments(pageId), (prev) =>
        prev?.map((x) => (x.id === v.id ? { ...x, body: v.body.trim(), edited_at: new Date().toISOString() } : x)),
      );
      return { snap };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.comments(pageId), ctx.snap);
    },
    onSettled: refresh,
  });
}

export function useSetCommentRemoved(pageId: string) {
  const refresh = useRefresh(pageId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; removed: boolean }) => {
      const { error } = await supabase.rpc("set_comment_removed", { p_comment: v.id, p_removed: v.removed });
      if (error) throw error;
    },
    onMutate: (v) => {
      const snap = qc.getQueryData<CommentRow[]>(qk.comments(pageId));
      if (v.removed) {
        qc.setQueryData<CommentRow[]>(qk.comments(pageId), (prev) =>
          prev?.filter((x) => x.id !== v.id && x.thread_id !== v.id),
        );
      }
      return { snap };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.comments(pageId), ctx.snap);
    },
    onSettled: refresh,
  });
}

export function useResolveThread(pageId: string) {
  const refresh = useRefresh(pageId);
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (v: { thread: string; resolved: boolean }) => {
      const { error } = await supabase.rpc("resolve_comment_thread", { p_thread: v.thread, p_resolved: v.resolved });
      if (error) throw error;
    },
    onMutate: (v) => {
      const snap = qc.getQueryData<CommentRow[]>(qk.comments(pageId));
      const now = new Date().toISOString();
      qc.setQueryData<CommentRow[]>(qk.comments(pageId), (prev) =>
        prev?.map((x) =>
          x.id === v.thread
            ? { ...x, resolved_at: v.resolved ? now : null, resolved_by: v.resolved ? (user?.id ?? null) : null }
            : x,
        ),
      );
      return { snap };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.comments(pageId), ctx.snap);
    },
    onSettled: refresh,
  });
}
