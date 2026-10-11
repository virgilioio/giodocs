import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useWorkspaceId } from "@/lib/workspace-context";

/* Trash (2026-10-11): deleted pages the person could edit, one row per
 * deletion (list_trash), and bringing them back through restore_page. */

export type TrashItem = {
  id: string;
  title: string;
  icon: string | null;
  is_database: boolean;
  deleted_at: string;
  parent_id: string | null;
  parent_title: string | null;
  access_type: string;
  excerpt: string | null;
  inside: number;
  /** Deleted pages it lives in, from the top down. */
  trashed_ancestors: string[];
};

export function useTrash(query: string, enabled = true) {
  const ws = useWorkspaceId();
  const q = query.trim();
  return useQuery({
    queryKey: qk.trash(ws, q),
    enabled,
    staleTime: 0,
    // Keep the last list on screen while a new search runs.
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<TrashItem[]> => {
      const { data, error } = await supabase.rpc("list_trash", q ? { p_query: q } : {});
      if (error) throw error;
      return (data ?? []) as TrashItem[];
    },
  });
}

/** Restores a page and, first, the deleted pages it lives in (so it comes
 *  back where it was, not under a page that's still in the bin). */
export function useRestoreFromTrash() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  return useMutation({
    mutationFn: async (item: TrashItem) => {
      for (const id of [...item.trashed_ancestors, item.id]) {
        const { error } = await supabase.rpc("restore_page", { p_page: id });
        if (error) throw error;
      }
    },
    onMutate: async (item) => {
      // Gone from the list at once; back if the restore fails.
      const keys = qc.getQueriesData<TrashItem[]>({ queryKey: ["trash", ws] });
      for (const [key, rows] of keys) qc.setQueryData(key, (rows ?? []).filter((r) => r.id !== item.id));
      return { keys };
    },
    onError: (_e, _item, ctx) => {
      for (const [key, rows] of ctx?.keys ?? []) qc.setQueryData(key, rows);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
      void qc.invalidateQueries({ queryKey: ["trash", ws] });
    },
  });
}
