import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { useAddPropertyOption, useCreateProperty } from "@/hooks/use-property-mutations";
import type { PageFull, PageListItem } from "@/lib/types";

export type StartLayout = "table" | "board" | "list" | "calendar";

export const LAYOUT_NAMES: Record<StartLayout, string> = {
  table: "Table",
  board: "Board",
  list: "List",
  calendar: "Calendar",
};

/** The options a board's new Status starts with. */
const BOARD_OPTIONS = ["Not started", "In progress", "Done"];

/** Turns a blank page into a database that opens as a table, board, list
 *  or calendar (Notion's "Or start with a database"). A board gets a
 *  Status to group by and a calendar a Date to place rows on; each gets
 *  a shared view of that layout. Returns the view's id. */
export function useStartDatabase() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const createProperty = useCreateProperty();
  const addOption = useAddPropertyOption();
  return useMutation({
    mutationFn: async (v: { pageId: string; layout: StartLayout; icon: string | null }) => {
      const patch: { is_database: boolean; icon?: string } = { is_database: true };
      if (!v.icon || v.icon === "📄") patch.icon = "🗂️";
      const { error } = await supabase.from("pages").update(patch).eq("id", v.pageId);
      if (error) throw error;
      const mark = (p: PageListItem): PageListItem => ({ ...p, ...patch, database_id: p.database_id ?? null });
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) => prev?.map((p) => (p.id === v.pageId ? mark(p) : p)));
      qc.setQueryData<PageFull | null>(qk.page(v.pageId), (prev) => (prev ? ({ ...prev, ...patch } as PageFull) : prev));

      let groupBy: string | null = null;
      if (v.layout === "board") {
        const def = await createProperty.mutateAsync({ databaseId: v.pageId, label: "Status", type: "status" });
        for (const label of BOARD_OPTIONS) await addOption.mutateAsync({ id: def.id, label });
        groupBy = def.key;
      } else if (v.layout === "calendar") {
        const def = await createProperty.mutateAsync({ databaseId: v.pageId, label: "Date", type: "date" });
        groupBy = def.key;
      }
      const { data, error: e2 } = await supabase
        .from("views")
        .insert({
          workspace_id: ws,
          owner_id: user!.id,
          database_id: v.pageId,
          name: LAYOUT_NAMES[v.layout],
          scope: "team",
          layout: v.layout,
          filter: [] as never,
          sort: { prop: "edited", dir: "desc" } as never,
          group_by: groupBy,
          config: {} as never,
        })
        .select("*")
        .single();
      if (e2) throw e2;
      return data as { id: string };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.views(ws) });
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
    },
  });
}
