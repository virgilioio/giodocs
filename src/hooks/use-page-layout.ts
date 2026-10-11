import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useToast } from "@/lib/toast";
import type { PageLayout } from "@/lib/page-layout";
import type { PageListItem } from "@/lib/types";

/** Saves how a database's rows show their properties (pages.page_layout).
 *  Shows at once; a refusal (a view-only member) puts it back. */
export function useSetPageLayout() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { databaseId: string; layout: PageLayout }) => {
      const { error } = await supabase
        .from("pages")
        .update({ page_layout: v.layout as never })
        .eq("id", v.databaseId);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const list = qc.getQueryData<PageListItem[]>(qk.pages(ws));
      if (list) {
        qc.setQueryData<PageListItem[]>(
          qk.pages(ws),
          list.map((p) => (p.id === v.databaseId ? { ...p, page_layout: v.layout as never } : p)),
        );
      }
      return { list };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.list) qc.setQueryData(qk.pages(ws), ctx.list);
      const m = (err as { message?: string })?.message ?? "";
      toast.push(
        /42501|permission|not change/i.test(m)
          ? "You can view this database but not change how its pages show properties."
          : "Couldn't save that. Try again.",
      );
    },
  });
}
