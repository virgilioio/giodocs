import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import { useToast } from "@/lib/toast";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import type { PageListItem, PageFull, Block } from "@/lib/types";


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
      await qc.cancelQueries({ queryKey: qk.page(v.pageId) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const pageSnap =
        qc.getQueryData<PageFull | null>(qk.page(v.pageId)) ?? null;
      const before = memberViewIds(snapshot, v.pageId, views, {
        me: user?.id ?? "",
        staleDays,
      });
      const nowIso = new Date().toISOString();
      const patchProps = (raw: unknown): Record<string, unknown> => {
        const props =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? { ...(raw as Record<string, unknown>) }
            : {};
        if (v.value === null || v.value === undefined) delete props[v.key];
        else props[v.key] = v.value;
        return props;
      };
      const next = snapshot.map((p) => {
        if (p.id !== v.pageId) return p;
        return {
          ...p,
          props: patchProps(p.props) as PageListItem["props"],
          edited_at: nowIso,
        };
      });
      qc.setQueryData<PageListItem[]>(qk.pages(ws), next);
      // Page-detail cache must be patched too — otherwise navigating away
      // from a view (which mutated the list) and back into the page reads
      // stale props from qk.page(id). Same lesson as the chunk-1 rename fix.
      qc.setQueryData<PageFull | null>(qk.page(v.pageId), (prev) =>
        prev
          ? ({
              ...prev,
              props: patchProps(prev.props) as PageFull["props"],
              edited_at: nowIso,
            } as PageFull)
          : prev,
      );
      const after = memberViewIds(next, v.pageId, views, {
        me: user?.id ?? "",
        staleDays,
      });
      return { snapshot, pageSnap, before, after };
    },
    onError: (err, v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      if (ctx?.pageSnap !== undefined)
        qc.setQueryData(qk.page(v.pageId), ctx.pageSnap);
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
    // No onSettled invalidation: optimistic patch is authoritative and
    // realtime will surface any teammate edits without a list refetch.
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
      await qc.cancelQueries({ queryKey: qk.page(v.pageId) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const pageSnap =
        qc.getQueryData<PageFull | null>(qk.page(v.pageId)) ?? null;
      const nowIso = new Date().toISOString();
      qc.setQueryData<PageListItem[]>(
        qk.pages(ws),
        snapshot.map((p) =>
          p.id === v.pageId ? { ...p, title: v.title, edited_at: nowIso } : p,
        ),
      );
      // Also patch the page-detail cache. Without this, useCreatePage seeds
      // qk.page(id) with title="" at creation time; navigating away and
      // back within staleTime resurrects that empty-title row and the
      // component (freshly remounted via key={pageId}) has no local draft
      // to fall back on, so the title disappears in the editor.
      qc.setQueryData<PageFull | null>(qk.page(v.pageId), (prev) =>
        prev ? { ...prev, title: v.title, edited_at: nowIso } : prev,
      );
      return { snapshot, pageSnap };
    },
    onError: (err, v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      if (ctx?.pageSnap !== undefined)
        qc.setQueryData(qk.page(v.pageId), ctx.pageSnap);
      toast.push(`Couldn't rename: ${(err as Error).message}`);
    },
    // Optimistic patch is authoritative; realtime handles teammates.
  });
}

export function useVerifyPage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();

  return useMutation({
    mutationFn: async (pageId: string) => {
      const { error } = await supabase.rpc("verify_page", { p_page: pageId });
      if (error) throw error;
    },
    onMutate: async (pageId) => {
      await qc.cancelQueries({ queryKey: qk.page(pageId) });
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const nowIso = new Date().toISOString();
      const prevPage = qc.getQueryData<{
        verified_at: string;
        verified_by: string | null;
      } | null>(qk.page(pageId));
      if (prevPage) {
        qc.setQueryData(qk.page(pageId), {
          ...prevPage,
          verified_at: nowIso,
          verified_by: user?.id ?? prevPage.verified_by,
        });
      }
      const listSnap = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      qc.setQueryData<PageListItem[]>(
        qk.pages(ws),
        listSnap.map((p) =>
          p.id === pageId
            ? { ...p, verified_at: nowIso, verified_by: user?.id ?? p.verified_by }
            : p,
        ),
      );
      return { prevPage, listSnap };
    },
    onError: (err, pageId, ctx) => {
      if (ctx?.prevPage) qc.setQueryData(qk.page(pageId), ctx.prevPage);
      if (ctx?.listSnap) qc.setQueryData(qk.pages(ws), ctx.listSnap);
      toast.push(`Couldn't verify: ${(err as Error).message}`);
    },
    onSettled: (_d, _e, pageId) => {
      qc.invalidateQueries({ queryKey: qk.page(pageId) });
    },
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
  group_by: string | null;
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
      _tempId?: string;
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
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.views(ws) });
      const tempId =
        v._tempId ??
        (globalThis.crypto?.randomUUID?.() ?? `tmp-${Date.now()}-${Math.random()}`);
      v._tempId = tempId;
      const optimistic: ViewFull = {
        id: tempId,
        workspace_id: ws,
        owner_id: user!.id,
        name: v.name,
        scope: "personal",
        layout: v.layout ?? "table",
        position: 0,
        filter: (v.filter ?? []) as unknown,
        sort: (v.sort ?? { prop: "edited", dir: "desc" }) as unknown,
        icon: v.icon ?? null,
        group_by: null,
      };
      qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) =>
        prev ? [...prev, optimistic] : [optimistic],
      );
      return { tempId };
    },
    onSuccess: (row, _v, ctx) => {
      qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) => {
        if (!prev) return [row];
        const filtered = prev.filter((x) => x.id !== ctx?.tempId && x.id !== row.id);
        return [...filtered, row];
      });
      toast.push(`Created "${row.name}"`);
    },
    onError: (err, _v, ctx) => {
      if (ctx?.tempId) {
        qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) =>
          prev ? prev.filter((x) => x.id !== ctx.tempId) : prev,
        );
      }
      toast.push(`Couldn't create view: ${(err as Error).message}`);
    },
  });
}

export function useUpdateView() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: {
      id: string;
      patch: Partial<
        Pick<ViewFull, "name" | "icon" | "filter" | "sort" | "layout" | "group_by">
      >;
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
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: {
      viewId: string;
      name: string;
      filter: Filter[];
      sort: SortSpec;
      layout: "table" | "board" | "list";
      groupBy?: string | null;
      _tempId?: string;
    }) => {
      const { data, error } = await supabase.rpc("fork_view", {
        p_view: v.viewId,
        p_name: v.name,
        p_filter: v.filter as never,
        p_sort: v.sort as never,
        p_layout: v.layout,
      });
      if (error) throw error;
      const row = data as unknown as ViewFull;
      if (v.groupBy !== undefined) {
        const { error: e2 } = await supabase
          .from("views")
          .update({ group_by: v.groupBy } as never)
          .eq("id", row.id);
        if (e2) throw e2;
        row.group_by = v.groupBy;
      }
      return row;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.views(ws) });
      const tempId =
        v._tempId ??
        (globalThis.crypto?.randomUUID?.() ?? `tmp-${Date.now()}-${Math.random()}`);
      v._tempId = tempId;
      const optimistic: ViewFull = {
        id: tempId,
        workspace_id: ws,
        owner_id: user!.id,
        name: v.name,
        scope: "personal",
        layout: v.layout,
        position: 0,
        filter: v.filter as unknown,
        sort: v.sort as unknown,
        icon: null,
        group_by: v.groupBy ?? null,
      };
      qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) =>
        prev ? [...prev, optimistic] : [optimistic],
      );
      return { tempId };
    },
    onSuccess: (row, _v, ctx) => {
      qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) => {
        if (!prev) return [row];
        const filtered = prev.filter((x) => x.id !== ctx?.tempId && x.id !== row.id);
        return [...filtered, row];
      });
      toast.push(`Saved to My views — "${row.name}" is unchanged for the team.`);
    },
    onError: (err, _v, ctx) => {
      if (ctx?.tempId) {
        qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) =>
          prev ? prev.filter((x) => x.id !== ctx.tempId) : prev,
        );
      }
      toast.push(`Couldn't fork: ${(err as Error).message}`);
    },
  });
}

export function useCreatePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();

  return useMutation({
    mutationFn: async (v: {
      seedProps: Record<string, unknown>;
      blocks?: unknown[];
      _tempId?: string;
    }) => {
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
          blocks: (v.blocks ?? []) as never,
        })
        .select(
          "id, workspace_id, title, icon, props, blocks, access_type, verified_at, verified_by, edited_at, edited_by, created_by, created_at, deleted_at, archived_at",
        )
        .single();
      if (error) throw error;
      return data as unknown as PageFull;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const tempId =
        v._tempId ??
        (globalThis.crypto?.randomUUID?.() ?? `tmp-${Date.now()}-${Math.random()}`);
      v._tempId = tempId;
      const nowIso = new Date().toISOString();
      const optimistic: PageListItem = {
        id: tempId,
        title: "",
        icon: "📄",
        props: v.seedProps as PageListItem["props"],
        verified_at: nowIso,
        verified_by: user?.id ?? null,
        edited_at: nowIso,
        edited_by: user?.id ?? null,
        access_type: "workspace" as PageListItem["access_type"],
      };
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
        prev ? [optimistic, ...prev] : [optimistic],
      );
      return { tempId };
    },
    onSuccess: (row, v, ctx) => {
      const tempId = ctx?.tempId ?? v._tempId;
      // Project the PageFull row down to the list shape.
      const listRow: PageListItem = {
        id: row.id,
        title: row.title,
        icon: row.icon,
        props: row.props as PageListItem["props"],
        verified_at: row.verified_at,
        verified_by: row.verified_by,
        edited_at: row.edited_at,
        edited_by: row.edited_by,
        access_type: row.access_type,
        archived_at: row.archived_at ?? null,
      };
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) => {
        if (!prev) return [listRow];
        const filtered = prev.filter((p) => p.id !== tempId && p.id !== row.id);
        return [listRow, ...filtered];
      });
      // Seed the page-detail cache so /p/{id} renders instantly with correct
      // data instead of flashing a loading skeleton.
      qc.setQueryData<PageFull>(qk.page(row.id), row);
      toast.push(`New page created`);
    },
    onError: (err, _v, ctx) => {
      if (ctx?.tempId) {
        qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
          prev ? prev.filter((p) => p.id !== ctx.tempId) : prev,
        );
      }
      toast.push(`Couldn't create page: ${(err as Error).message}`);
    },
  });
}

export function usePublishView() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (viewId: string) => {
      const { data, error } = await supabase.rpc("publish_view", {
        p_view: viewId,
      });
      if (error) throw error;
      return data as unknown as ViewFull;
    },
    onSuccess: (row) => {
      qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) =>
        prev ? prev.map((x) => (x.id === row.id ? row : x)) : [row],
      );
      toast.push(`Published "${row.name}" to Team views`);
    },
    onError: (err) => toast.push(`Couldn't publish: ${(err as Error).message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.views(ws) }),
  });
}

/* ────────────── Page-level actions used by the topbar menu ────────────── */

// Move to area with menu-appropriate toast wording that names both
// consequences (the view/area it left, the one it joined).
export function useMovePageToArea() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { pageId: string; area: string | null }) => {
      const { error } = await supabase.rpc("set_page_property", {
        p_page: v.pageId,
        p_key: "area",
        p_value: (v.area ?? null) as never,
      });
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const prev = snapshot.find((p) => p.id === v.pageId);
      const prevArea =
        prev && prev.props && typeof prev.props === "object" &&
        !Array.isArray(prev.props)
          ? ((prev.props as Record<string, unknown>).area as string | undefined) ?? null
          : null;
      const next = snapshot.map((p) => {
        if (p.id !== v.pageId) return p;
        const props =
          p.props && typeof p.props === "object" && !Array.isArray(p.props)
            ? { ...(p.props as Record<string, unknown>) }
            : {};
        if (v.area) props.area = v.area;
        else delete props.area;
        return {
          ...p,
          props: props as PageListItem["props"],
          edited_at: new Date().toISOString(),
        };
      });
      qc.setQueryData<PageListItem[]>(qk.pages(ws), next);
      return { snapshot, prevArea };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      toast.push(`Couldn't move: ${(err as Error).message}`);
    },
    onSuccess: (_d, v, ctx) => {
      const from = ctx?.prevArea;
      if (v.area && from && from !== v.area) {
        toast.push(`Moved to ${v.area} — it left "${from}" and joined "${v.area}".`);
      } else if (v.area && !from) {
        toast.push(`Moved to ${v.area}.`);
      } else if (!v.area && from) {
        toast.push(`Removed from ${from}.`);
      } else {
        toast.push(`Moved.`);
      }
    },
  });
}

/**
 * Rewrites `props.area` on every page in the workspace whose current area
 * matches `from`. The sidebar entry vanishes on its own because nothing
 * carries the old area name anymore.
 */
export function useRenameArea() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { from: string; to: string }) => {
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const ids = snapshot
        .filter((p) => {
          const props =
            p.props && typeof p.props === "object" && !Array.isArray(p.props)
              ? (p.props as Record<string, unknown>)
              : {};
          return props.area === v.from;
        })
        .map((p) => p.id);
      for (const pageId of ids) {
        const { error } = await supabase.rpc("set_page_property", {
          p_page: pageId,
          p_key: "area",
          p_value: v.to as never,
        });
        if (error) throw error;
      }
      return { count: ids.length };
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const nowIso = new Date().toISOString();
      qc.setQueryData<PageListItem[]>(
        qk.pages(ws),
        snapshot.map((p) => {
          const props =
            p.props && typeof p.props === "object" && !Array.isArray(p.props)
              ? { ...(p.props as Record<string, unknown>) }
              : {};
          if (props.area !== v.from) return p;
          props.area = v.to;
          return {
            ...p,
            props: props as PageListItem["props"],
            edited_at: nowIso,
          };
        }),
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      toast.push(`Couldn't rename area: ${(err as Error).message}`);
    },
    onSuccess: (res, v) =>
      toast.push(
        `Renamed "${v.from}" → "${v.to}" — ${res.count} ${res.count === 1 ? "page" : "pages"} updated.`,
      ),
  });
}

export function useDuplicatePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (pageId: string) => {
      const { data: src, error: e1 } = await supabase
        .from("pages")
        .select("title, icon, props, blocks, access_type")
        .eq("id", pageId)
        .maybeSingle();
      if (e1) throw e1;
      if (!src) throw new Error("Original page not found");

      // Fresh block ids on every block. Any non-object entries are kept as-is.
      const rawBlocks = Array.isArray(src.blocks) ? (src.blocks as unknown[]) : [];
      const cloned = rawBlocks.map((b) => {
        if (b && typeof b === "object" && !Array.isArray(b)) {
          const rec = b as Record<string, unknown>;
          return {
            ...rec,
            id:
              globalThis.crypto?.randomUUID?.() ??
              `blk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          };
        }
        return b;
      });

      const suffixed = `${(src.title ?? "").trim() || "Untitled"} (copy)`;

      const { data, error } = await supabase
        .from("pages")
        .insert({
          workspace_id: ws,
          created_by: user!.id,
          edited_by: user!.id,
          verified_by: user!.id,
          icon: src.icon ?? "📄",
          title: suffixed,
          props: (src.props ?? {}) as never,
          blocks: cloned as never,
          access_type: src.access_type,
        })
        .select(
          "id, title, icon, props, verified_at, verified_by, edited_at, edited_by, access_type, archived_at",
        )
        .single();
      if (error) throw error;
      return data as PageListItem;
    },
    onSuccess: (row) => {
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
        prev ? [row, ...prev] : [row],
      );
      toast.push("Duplicated — you're on the copy.");
    },
    onError: (err) => {
      toast.push(`Couldn't duplicate: ${(err as Error).message}`);
    },
  });
}

export function useArchivePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { pageId: string; archived: boolean }) => {
      const { error } = await supabase
        .from("pages")
        .update({ archived_at: v.archived ? new Date().toISOString() : null } as never)
        .eq("id", v.pageId);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const nowIso = new Date().toISOString();
      qc.setQueryData<PageListItem[]>(
        qk.pages(ws),
        snapshot.map((p) =>
          p.id === v.pageId
            ? { ...p, archived_at: v.archived ? nowIso : null }
            : p,
        ),
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      toast.push(`Couldn't ${_v.archived ? "archive" : "unarchive"}: ${(err as Error).message}`);
    },
    onSuccess: (_d, v) => {
      toast.push(
        v.archived
          ? `Archived — it left every view but ⌘K still finds it.`
          : `Unarchived — it's back in every view that matches.`,
      );
    },
  });
}

export function useDeletePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (pageId: string) => {
      const { error } = await supabase
        .from("pages")
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("id", pageId);
      if (error) throw error;
    },
    onMutate: async (pageId) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      qc.setQueryData<PageListItem[]>(
        qk.pages(ws),
        snapshot.filter((p) => p.id !== pageId),
      );
      return { snapshot };
    },
    onError: (err, _pageId, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      toast.push(`Couldn't delete: ${(err as Error).message}`);
    },
    onSuccess: () => toast.push("Page deleted."),
  });
}


/* ────────────── Part B: block edits + create-and-open ────────────── */

/**
 * Writes pages.blocks and lets the server-side touch_page trigger bump
 * edited_at/edited_by. Optimistically patches the page detail cache and
 * the workspace list cache so the topbar's "Edited …" stamp updates
 * immediately. Variables carry `pageId` so useIsMutating in
 * page-topbar-actions can detect the in-flight save.
 */
export function useUpdateBlocks() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();

  return useMutation({
    mutationFn: async (v: { pageId: string; blocks: Block[] }) => {
      const { data, error } = await supabase
        .from("pages")
        .update({ blocks: v.blocks as never })
        .eq("id", v.pageId)
        .select("edited_at, edited_by")
        .single();
      if (error) throw error;
      return data as { edited_at: string; edited_by: string | null };
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.page(v.pageId) });
      const nowIso = new Date().toISOString();

      qc.setQueryData<PageFull | null>(qk.page(v.pageId), (prev) =>
        prev
          ? {
              ...prev,
              blocks: v.blocks as unknown as PageFull["blocks"],
              edited_at: nowIso,
              edited_by: user?.id ?? prev.edited_by,
            }
          : prev,
      );
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
        prev
          ? prev.map((p) =>
              p.id === v.pageId
                ? { ...p, edited_at: nowIso, edited_by: user?.id ?? p.edited_by }
                : p,
            )
          : prev,
      );
    },
    onError: (err) => {
      toast.push(`Couldn't save: ${(err as Error).message}`);
    },
    onSuccess: (row, v) => {
      // Reconcile with the server-authoritative edited_at.
      qc.setQueryData<PageFull | null>(qk.page(v.pageId), (prev) =>
        prev ? { ...prev, edited_at: row.edited_at, edited_by: row.edited_by } : prev,
      );
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
        prev
          ? prev.map((p) =>
              p.id === v.pageId
                ? { ...p, edited_at: row.edited_at, edited_by: row.edited_by }
                : p,
            )
          : prev,
      );
    },
  });
}

/**
 * Creates a page and navigates the user to /p/{id} with the title focused.
 * Every "New page" entry point routes through this hook so the workflow
 * is uniform: no more leaving the user on the table.
 */
export function useCreatePageAndOpen() {
  const create = useCreatePage();
  const navigate = useNavigate();
  return useCallback(
    async (v: { seedProps: Record<string, unknown>; blocks?: unknown[] }) => {
      const created = await create.mutateAsync(v);
      try {
        sessionStorage.setItem("gio.focus-title", created.id);
      } catch {
        /* storage unavailable */
      }
      await navigate({ to: "/p/$pageId", params: { pageId: created.id } });
      return created;
    },
    [create, navigate],
  );
}
