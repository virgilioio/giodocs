import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import { useToast } from "@/lib/toast";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import type { PageListItem } from "@/lib/types";

type ViewRow = {
  id: string;
  name: string;
  filter: unknown;
  sort: unknown;
};

function viewSpec(v: ViewRow) {
  return {
    filter: (v.filter ?? []) as Filter[],
    sort: (v.sort ?? { prop: "edited", dir: "desc" }) as SortSpec,
  };
}

function memberViewIds(
  pages: PageListItem[],
  pageId: string,
  views: ViewRow[],
  ctx: { me: string; staleDays: number },
): Set<string> {
  const out = new Set<string>();
  for (const v of views) {
    try {
      const rows = runView(pages, viewSpec(v), ctx);
      if (rows.some((r) => r.id === pageId)) out.add(v.id);
    } catch {
      /* ignore invalid view */
    }
  }
  return out;
}

function propLabel(key: string) {
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

export function useSetPageProperty() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const shell = useWorkspaceShell(ws);
  const toast = useToast();
  const staleDays = shell.workspace.data?.stale_days ?? 30;
  const views = (shell.views.data ?? []) as ViewRow[];

  return useMutation({
    mutationFn: async (v: { pageId: string; key: string; value: unknown }) => {
      const { error } = await supabase.rpc("set_page_property", {
        p_page: v.pageId,
        p_key: v.key,
        p_value: v.value === null ? null : (v.value as never),
      });
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const before = memberViewIds(snapshot, v.pageId, views, {
        me: user?.id ?? "",
        staleDays,
      });
      const next = snapshot.map((p) => {
        if (p.id !== v.pageId) return p;
        const props =
          p.props && typeof p.props === "object" && !Array.isArray(p.props)
            ? { ...(p.props as Record<string, unknown>) }
            : {};
        if (v.value === null || v.value === undefined) delete props[v.key];
        else props[v.key] = v.value;
        return {
          ...p,
          props: props as PageListItem["props"],
          edited_at: new Date().toISOString(),
        };
      });
      qc.setQueryData<PageListItem[]>(qk.pages(ws), next);
      const after = memberViewIds(next, v.pageId, views, {
        me: user?.id ?? "",
        staleDays,
      });
      return { snapshot, before, after };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      toast.push(`Couldn't save: ${(err as Error).message}`);
    },
    onSuccess: (_data, v, ctx) => {
      if (!ctx) return;
      const entered = [...ctx.after].filter((id) => !ctx.before.has(id));
      const left = [...ctx.before].filter((id) => !ctx.after.has(id));
      const nameOf = (id: string) => views.find((x) => x.id === id)?.name ?? "view";
      if (entered.length === 0 && left.length === 0) {
        toast.push(`Updated ${propLabel(v.key)}`);
      } else {
        for (const id of entered) toast.push(`Added to "${nameOf(id)}"`);
        for (const id of left) toast.push(`Left "${nameOf(id)}"`);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.pages(ws) });
    },
  });
}

export function useRenamePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();

  return useMutation({
    mutationFn: async (v: { pageId: string; title: string }) => {
      const { error } = await supabase
        .from("pages")
        .update({ title: v.title })
        .eq("id", v.pageId);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      qc.setQueryData<PageListItem[]>(
        qk.pages(ws),
        snapshot.map((p) =>
          p.id === v.pageId
            ? { ...p, title: v.title, edited_at: new Date().toISOString() }
            : p,
        ),
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      toast.push(`Couldn't rename: ${(err as Error).message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.pages(ws) }),
  });
}

type ViewFull = {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  scope: "personal" | "team";
  layout: "table" | "board" | "list";
  position: number;
  filter: unknown;
  sort: unknown;
  icon: string | null;
};

export function useCreateView() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: {
      name: string;
      icon?: string | null;
      filter?: Filter[];
      sort?: SortSpec;
      layout?: "table" | "board" | "list";
    }) => {
      const { data, error } = await supabase
        .from("views")
        .insert({
          workspace_id: ws,
          owner_id: user!.id,
          name: v.name,
          scope: "personal",
          layout: v.layout ?? "table",
          filter: (v.filter ?? []) as never,
          sort: (v.sort ?? { prop: "edited", dir: "desc" }) as never,
          icon: v.icon ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as ViewFull;
    },
    onSuccess: (row) => {
      qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) =>
        prev ? [...prev, row] : [row],
      );
      toast.push(`Created "${row.name}"`);
    },
    onError: (err) => toast.push(`Couldn't create view: ${(err as Error).message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.views(ws) }),
  });
}

export function useUpdateView() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: {
      id: string;
      patch: Partial<Pick<ViewFull, "name" | "icon" | "filter" | "sort" | "layout">>;
    }) => {
      const { error } = await supabase
        .from("views")
        .update(v.patch as never)
        .eq("id", v.id);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.views(ws) });
      const snap = qc.getQueryData<ViewFull[]>(qk.views(ws)) ?? [];
      qc.setQueryData<ViewFull[]>(
        qk.views(ws),
        snap.map((x) => (x.id === v.id ? { ...x, ...v.patch } : x)),
      );
      return { snap };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.views(ws), ctx.snap);
      toast.push(`Couldn't update view: ${(err as Error).message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.views(ws) }),
  });
}

export function useDeleteView() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("views").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.views(ws) });
      const snap = qc.getQueryData<ViewFull[]>(qk.views(ws)) ?? [];
      qc.setQueryData<ViewFull[]>(
        qk.views(ws),
        snap.filter((x) => x.id !== id),
      );
      return { snap };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.views(ws), ctx.snap);
      toast.push(`Couldn't delete view: ${(err as Error).message}`);
    },
    onSuccess: () => toast.push(`View deleted`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.views(ws) }),
  });
}

export function useForkView() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: {
      viewId: string;
      name: string;
      filter: Filter[];
      sort: SortSpec;
      layout: "table" | "board" | "list";
    }) => {
      const { data, error } = await supabase.rpc("fork_view", {
        p_view: v.viewId,
        p_name: v.name,
        p_filter: v.filter as never,
        p_sort: v.sort as never,
        p_layout: v.layout,
      });
      if (error) throw error;
      return data as unknown as ViewFull;
    },
    onSuccess: (row) => {
      qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) =>
        prev ? [...prev, row] : [row],
      );
      toast.push(`Forked to "${row.name}"`);
    },
    onError: (err) => toast.push(`Couldn't fork: ${(err as Error).message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.views(ws) }),
  });
}

export function useCreatePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();

  return useMutation({
    mutationFn: async (v: { seedProps: Record<string, unknown> }) => {
      const { data, error } = await supabase
        .from("pages")
        .insert({
          workspace_id: ws,
          created_by: user!.id,
          edited_by: user!.id,
          verified_by: user!.id,
          icon: "📄",
          title: "",
          props: v.seedProps as never,
          blocks: [] as never,
        })
        .select(
          "id, title, icon, props, verified_at, verified_by, edited_at, edited_by, access_type",
        )
        .single();
      if (error) throw error;
      return data as PageListItem;
    },
    onSuccess: (row) => {
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
        prev ? [row, ...prev] : [row],
      );
      toast.push(`New page created`);
    },
    onError: (err) => toast.push(`Couldn't create page: ${(err as Error).message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.pages(ws) }),
  });
}
