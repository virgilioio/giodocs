import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useWorkspaceId } from "@/lib/workspace-context";
import type { TaskConfig } from "@/lib/tasks";
import type { PageFull, PageListItem } from "@/lib/types";

/** Makes a database a task database (or stops it being one, with null).
 *  The guard_task_config trigger checks the properties; anyone who can
 *  edit the database page can change it. Shows at once; a failure puts
 *  the old settings back and the caller shows the error. */
export function useSetTaskConfig() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  return useMutation({
    mutationFn: async (v: { databaseId: string; config: TaskConfig | null }) => {
      const { error } = await supabase
        .from("pages")
        .update({ task_config: v.config as never })
        .eq("id", v.databaseId);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const list = qc.getQueryData<PageListItem[]>(qk.pages(ws));
      const full = qc.getQueryData<PageFull | null>(qk.page(v.databaseId));
      const cfg = (v.config ?? null) as PageFull["task_config"];
      if (list) {
        qc.setQueryData<PageListItem[]>(
          qk.pages(ws),
          list.map((p) => (p.id === v.databaseId ? { ...p, task_config: cfg } : p)),
        );
      }
      if (full) {
        qc.setQueryData<PageFull | null>(qk.page(v.databaseId), (prev) =>
          prev ? ({ ...prev, task_config: cfg } as PageFull) : prev,
        );
      }
      return { list, full };
    },
    onError: (_e, v, ctx) => {
      if (ctx?.list) qc.setQueryData(qk.pages(ws), ctx.list);
      if (ctx?.full !== undefined) qc.setQueryData(qk.page(v.databaseId), ctx.full);
    },
  });
}
