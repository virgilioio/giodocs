import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { jsonEqual } from "@/lib/json-equal";
import { qk } from "@/lib/query-keys";
import { runView, type Filter, type SortSpec } from "@/lib/run-view";
import type { ViewConfig } from "@/lib/view-config";
import { useToast } from "@/lib/toast";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import type { PageListItem, PageFull, Block } from "@/lib/types";
import { applyMove, descendantsOf, type MoveTarget } from "@/lib/page-tree";
import { storedPropsFor } from "./stored-props";
import { openPageSomewhere } from "@/lib/peek";


type ViewRow = {
  id: string;
  name: string;
  filter: unknown;
  sort: unknown;
  database_id?: string | null;
};

function viewSpec(v: ViewRow) {
  return {
    filter: (v.filter ?? []) as Filter[],
    sort: (v.sort ?? { prop: "edited", dir: "desc" }) as SortSpec | SortSpec[],
  };
}

/** The views (of the page's own database) the page is listed in. */
function memberViewIds(
  pages: PageListItem[],
  pageId: string,
  views: ViewRow[],
  ctx: { me: string; staleDays: number },
): Set<string> {
  const out = new Set<string>();
  const dbId = pages.find((p) => p.id === pageId)?.database_id ?? null;
  if (!dbId) return out;
  const rowsOfDb = pages.filter((p) => p.database_id === dbId);
  for (const v of views) {
    if (v.database_id !== dbId) continue;
    try {
      const rows = runView(rowsOfDb, viewSpec(v), ctx);
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
    mutationFn: async (v: { pageId: string; key: string; value: unknown; quiet?: boolean }) => {
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
      // A link made from the far side of a relation changes the OTHER page,
      // which the person may only be able to read.
      const msg = (err as Error).message ?? "";
      if (/permission|row-level security|42501|view.only|can.t change/i.test(msg)) {
        const title =
          qc.getQueryData<PageListItem[]>(qk.pages(ws))?.find((p) => p.id === v.pageId)?.title ||
          "that page";
        toast.push(`You can't change \u201C${title}\u201D, so that change wasn't saved.`);
        return;
      }
      toast.push(`Couldn't save: ${msg}`);
    },
    onSuccess: (_data, v, ctx) => {
      // The caller says what happened (My tasks offers Undo instead).
      if (!ctx || v.quiet) return;
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
  database_id: string;
  name: string;
  scope: "personal" | "team";
  layout: "table" | "board" | "list" | "calendar";
  position: number;
  filter: unknown;
  sort: unknown;
  icon: string | null;
  group_by: string | null;
  config?: unknown;
};


export function useCreateView() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: {
      /** The database the view belongs to. */
      databaseId: string;
      /** "team": a tab for everyone who can open the database. */
      scope?: "personal" | "team";
      name: string;
      icon?: string | null;
      filter?: Filter[];
      sort?: SortSpec | SortSpec[];
      layout?: "table" | "board" | "list" | "calendar";
      groupBy?: string | null;
      config?: ViewConfig;
      _tempId?: string;
    }) => {
      const { data, error } = await supabase
        .from("views")
        .insert({
          workspace_id: ws,
          owner_id: user!.id,
          database_id: v.databaseId,
          name: v.name,
          scope: v.scope ?? "personal",
          layout: v.layout ?? "table",
          filter: (v.filter ?? []) as never,
          sort: (v.sort ?? { prop: "edited", dir: "desc" }) as never,
          icon: v.icon ?? null,
          group_by: v.groupBy ?? null,
          config: (v.config ?? {}) as never,
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
        database_id: v.databaseId,
        name: v.name,
        scope: v.scope ?? "personal",
        layout: v.layout ?? "table",
        position: 0,
        filter: (v.filter ?? []) as unknown,
        sort: (v.sort ?? { prop: "edited", dir: "desc" }) as unknown,
        icon: v.icon ?? null,
        group_by: v.groupBy ?? null,
        config: v.config ?? {},
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
        Pick<
          ViewFull,
          "name" | "icon" | "filter" | "sort" | "layout" | "group_by" | "scope" | "config"
        >
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
      databaseId?: string;
      name: string;
      filter: Filter[];
      sort: SortSpec | SortSpec[];
      layout: "table" | "board" | "list" | "calendar";
      groupBy?: string | null;
      config?: ViewConfig;
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
      // fork_view copies filter, sort and layout; the rest follows.
      const extra: { group_by?: string | null; config?: ViewConfig } = {};
      if (v.groupBy !== undefined) extra.group_by = v.groupBy;
      if (v.config !== undefined) extra.config = v.config;
      if (Object.keys(extra).length) {
        const { error: e2 } = await supabase
          .from("views")
          .update(extra as never)
          .eq("id", row.id);
        if (e2) throw e2;
        Object.assign(row, extra);
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
        database_id:
          v.databaseId ??
          qc.getQueryData<ViewFull[]>(qk.views(ws))?.find((x) => x.id === v.viewId)?.database_id ??
          "",
        name: v.name,
        scope: "personal",
        layout: v.layout,
        position: 0,
        filter: v.filter as unknown,
        sort: v.sort as unknown,
        icon: null,
        group_by: v.groupBy ?? null,
        config: v.config ?? {},
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
      toast.push(`Saved as your own view — "${row.name}".`);
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
      /** Placement, when the page is created INSIDE another page. Structural
       *  — the column, never a prop. */
      parentId?: string | null;
      title?: string;
      /** The page icon; a new page from a template takes the template's. */
      icon?: string;
      /** No "New page created" toast (a row added inside a table). */
      quiet?: boolean;
      /** A database: a page whose children are its rows. */
      isDatabase?: boolean;
      _tempId?: string;
    }) => {
      // New pages are private to their creator: the database adds the
      // creator's access row right AFTER the insert, so the row can't be
      // returned by the insert itself (RLS would hide it). Pick the id here,
      // insert without returning, then read the page back.
      const id = newPageId();
      const { error: insertError } = await supabase.from("pages").insert({
        id,
        workspace_id: ws,
        created_by: user!.id,
        edited_by: user!.id,
        verified_by: user!.id,
        icon: v.icon || (v.isDatabase ? "🗂️" : "📄"),
        title: v.title ?? "",
        parent_id: v.parentId ?? null,
        is_database: !!v.isDatabase,
        props: v.seedProps as never,
        blocks: (v.blocks ?? []) as never,
        access_type: "restricted",
      });
      if (insertError) throw insertError;
      const { data, error } = await supabase
        .from("pages")
        .select(
          "id, workspace_id, title, icon, props, blocks, access_type, ws_role, verified_at, verified_by, edited_at, edited_by, created_by, created_at, deleted_at, archived_at, parent_id, database_id, is_database",
        )
        .eq("id", id)
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
      const parent = v.parentId
        ? qc.getQueryData<PageListItem[]>(qk.pages(ws))?.find((p) => p.id === v.parentId)
        : undefined;
      const optimistic: PageListItem = {
        id: tempId,
        title: v.title ?? "",
        icon: v.icon || (v.isDatabase ? "🗂️" : "📄"),
        parent_id: v.parentId ?? null,
        database_id: parent?.is_database ? parent.id : null,
        is_database: !!v.isDatabase,
        props: v.seedProps as PageListItem["props"],
        verified_at: nowIso,
        verified_by: user?.id ?? null,
        edited_at: nowIso,
        edited_by: user?.id ?? null,
        created_at: nowIso,
        created_by: user?.id ?? null,
        access_type: "restricted" as PageListItem["access_type"],
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
        created_at: row.created_at,
        created_by: row.created_by,
        access_type: row.access_type,
        archived_at: row.archived_at ?? null,
        parent_id: row.parent_id ?? null,
        database_id: row.database_id ?? null,
        is_database: !!row.is_database,
      };
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) => {
        if (!prev) return [listRow];
        const filtered = prev.filter((p) => p.id !== tempId && p.id !== row.id);
        return [listRow, ...filtered];
      });
      // Seed the page-detail cache so /p/{id} renders instantly with correct
      // data instead of flashing a loading skeleton.
      qc.setQueryData<PageFull>(qk.page(row.id), row);
      if (!v.quiet) toast.push(v.isDatabase ? `New database created` : `New page created`);
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
      toast.push(`"${row.name}" is shared: everyone who can open the database sees it.`);
    },
    onError: (err) => toast.push(`Couldn't publish: ${(err as Error).message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.views(ws) }),
  });
}

/**
 * Unpublish a team view — flips scope back to 'personal' with `owner_id`
 * set to the caller so it becomes their own view. RLS restricts this
 * update to workspace owners (see views_update policy).
 */
export function useUnpublishView() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (viewId: string) => {
      const { data, error } = await supabase
        .from("views")
        .update({ scope: "personal", owner_id: user!.id })
        .eq("id", viewId)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as ViewFull;
    },
    onSuccess: (row) => {
      qc.setQueryData<ViewFull[]>(qk.views(ws), (prev) =>
        prev ? prev.map((x) => (x.id === row.id ? row : x)) : [row],
      );
      toast.push(`"${row.name}" is yours only now.`);
    },
    onError: (err) => toast.push(`Couldn't unpublish: ${(err as Error).message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.views(ws) }),
  });
}


/* ────────────── Page-level actions used by the topbar menu ────────────── */


export function useDuplicatePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (pageId: string) => {
      const { data: src, error: e1 } = await supabase
        .from("pages")
        .select("title, icon, props, blocks, access_type, parent_id, database_id, is_database")
        .eq("id", pageId)
        .maybeSingle();
      if (e1) throw e1;
      if (!src) throw new Error("Original page not found");

      // A database is copied whole (properties, views, rows) in the
      // database: duplicate_database.
      if (src.is_database) {
        const { data: newId, error: e0 } = await supabase.rpc("duplicate_database", {
          p_database: pageId,
        });
        if (e0) throw e0;
        void qc.invalidateQueries({ queryKey: qk.pages(ws) });
        void qc.invalidateQueries({ queryKey: qk.views(ws) });
        void qc.invalidateQueries({ queryKey: qk.propDefs(ws) });
        const { data: dbRow, error: e2 } = await supabase
          .from("pages")
          .select(
            "id, title, icon, props, verified_at, verified_by, edited_at, edited_by, access_type, archived_at, parent_id, database_id, is_database",
          )
          .eq("id", newId as string)
          .single();
        if (e2) throw e2;
        return dbRow as PageListItem;
      }

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

      // A copy is a new page: private to whoever made it, like any other
      // new page (copying the source's access used to fail outright for
      // restricted pages, since nobody was on the copy's access list).
      const id = newPageId();
      const { error: insertError } = await supabase.from("pages").insert({
        id,
        workspace_id: ws,
        created_by: user!.id,
        edited_by: user!.id,
        verified_by: user!.id,
        icon: src.icon ?? "📄",
        title: suffixed,
        // Beside the original: a row stays a row of its database (with its
        // values), a page inside a page stays inside it.
        parent_id: src.parent_id ?? null,
        props: (await storedPropsFor(src.props, src.database_id)) as never,
        blocks: cloned as never,
        access_type: "restricted",
      });
      if (insertError) throw insertError;
      const { data, error } = await supabase
        .from("pages")
        .select(
          "id, title, icon, props, verified_at, verified_by, edited_at, edited_by, access_type, archived_at, parent_id, database_id, is_database",
        )
        .eq("id", id)
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
      await qc.cancelQueries({ queryKey: qk.page(v.pageId) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const pageSnap =
        qc.getQueryData<PageFull | null>(qk.page(v.pageId)) ?? null;
      const nowIso = new Date().toISOString();
      // The list query only contains non-archived rows, so archiving
      // removes and unarchiving re-inserts. This gives the sidebar,
      // areas, and view counts an immediate optimistic drop/return.
      if (v.archived) {
        qc.setQueryData<PageListItem[]>(
          qk.pages(ws),
          snapshot.filter((p) => p.id !== v.pageId),
        );
      } else {
        const row = snapshot.find((p) => p.id === v.pageId);
        if (!row && pageSnap) {
          const listRow: PageListItem = {
            id: pageSnap.id,
            title: pageSnap.title,
            icon: pageSnap.icon,
            props: pageSnap.props as PageListItem["props"],
            verified_at: pageSnap.verified_at,
            verified_by: pageSnap.verified_by,
            edited_at: pageSnap.edited_at,
            edited_by: pageSnap.edited_by,
            access_type: pageSnap.access_type,
            archived_at: null,
          };
          qc.setQueryData<PageListItem[]>(qk.pages(ws), [listRow, ...snapshot]);
        }
      }
      qc.setQueryData<PageFull | null>(qk.page(v.pageId), (prev) =>
        prev ? { ...prev, archived_at: v.archived ? nowIso : null } : prev,
      );
      return { snapshot, pageSnap };
    },
    onError: (err, v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      if (ctx?.pageSnap !== undefined)
        qc.setQueryData(qk.page(v.pageId), ctx.pageSnap);
      toast.push(`Couldn't ${v.archived ? "archive" : "unarchive"}: ${(err as Error).message}`);
    },
    onSuccess: (_d, v) => {
      toast.push(
        v.archived
          ? `Archived — it stays searchable in ⌘K but appears in no views.`
          : `Unarchived — it's back in every view that matches.`,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.pages(ws) }),
  });
}


/** Soft-delete via the delete_page RPC, which takes the pages inside it
 *  (a database's rows included) in the same moment. Returns the removed row
 *  (from cache) so the caller can offer an Undo action to restore_page. */
export function useDeletePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (pageId: string) => {
      const { error } = await supabase.rpc("delete_page", { p_page: pageId });
      if (error) throw error;
    },
    onMutate: async (pageId) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const removed = snapshot.find((p) => p.id === pageId) ?? null;
      const gone = descendantsOf(pageId, snapshot);
      gone.add(pageId);
      qc.setQueryData<PageListItem[]>(
        qk.pages(ws),
        snapshot.filter((p) => !gone.has(p.id)),
      );
      return { snapshot, removed };
    },
    onError: (err, _pageId, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      toast.push(`Couldn't delete: ${(err as Error).message}`);
    },
    // The topbar menu owns the undo toast — it needs the restore mutation
    // and a page-detail reference, both of which live at the call site.
  });
}

/** Share a page with everyone in the workspace (editing), keeping the
 *  caller as an editor. Used by the sidebar's "New page in Workspace". */
export function useShareToWorkspace() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (pageId: string) => {
      const { error } = await supabase.rpc("set_page_access", {
        p_page: pageId,
        p_type: "workspace",
        p_ws_role: "edit",
        p_people: [{ id: user!.id, role: "edit" }] as never,
        p_guests: [] as never,
      });
      if (error) throw error;
    },
    onMutate: async (pageId) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
        prev
          ? prev.map((p) =>
              p.id === pageId ? { ...p, access_type: "workspace" as PageListItem["access_type"] } : p,
            )
          : prev,
      );
      qc.setQueryData<PageFull | null>(qk.page(pageId), (prev) =>
        prev ? { ...prev, access_type: "workspace", ws_role: "edit" } : prev,
      );
    },
    onError: (err) => toast.push(`Couldn't share: ${(err as Error).message}`),
    onSettled: (_d, _e, pageId) => {
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
      void qc.invalidateQueries({ queryKey: qk.page(pageId) });
      void qc.invalidateQueries({ queryKey: qk.pageAccess(pageId) });
    },
  });
}

/** Undo companion to useDeletePage. Restores the page and re-inserts the
 *  cached list row so the sidebar / view reappears without a refetch. */
export function useRestorePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { pageId: string; row: PageListItem | null }) => {
      const { error } = await supabase.rpc("restore_page", { p_page: v.pageId });
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      if (v.row) {
        qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) => {
          const list = prev ?? [];
          if (list.some((p) => p.id === v.pageId)) return list;
          return [v.row!, ...list];
        });
      }
    },
    onError: (err) => {
      toast.push(`Couldn't undo delete: ${(err as Error).message}`);
    },
    onSuccess: () => {
      toast.push("Restored.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.pages(ws) }),
  });
}


/* ────────────── Part B: block edits + create-and-open ────────────── */

/** Someone else saved different blocks after this tab last loaded or saved
 *  them. Carries the server's current row so the page can offer theirs. */
export class EditConflictError extends Error {
  constructor(
    public server: { blocks: Block[]; edited_at: string; edited_by: string | null },
  ) {
    super("This page changed somewhere else while you were editing.");
    this.name = "EditConflictError";
  }
}

/** The save went through but touched no row, twice: no edit access any more
 *  (or the page is gone). Not worth retrying. */
export class SaveRejectedError extends Error {
  constructor() {
    super("Your changes couldn't be saved. You may no longer be able to edit this page.");
    this.name = "SaveRejectedError";
  }
}

/** What the server last confirmed for each page this tab has saved: its
 *  edited_at and blocks. The page cache can't be trusted for this — it is
 *  patched optimistically with edits that may not have been saved yet. */
const confirmed = new Map<string, { editedAt: string | null; blocks: Block[] }>();
export function confirmedServerState(pageId: string) {
  return confirmed.get(pageId) ?? null;
}
export function setConfirmedServerState(pageId: string, editedAt: string | null, blocks: Block[]) {
  confirmed.set(pageId, { editedAt, blocks });
}

export type BlocksSaveGuard = {
  /** edited_at this tab last saw from the server; the update only applies
   *  while the row still has it. null skips the check. */
  editedAt: string | null;
  /** The blocks this tab last loaded or saved. */
  base: Block[] | null;
  /** Values this tab sent since the last confirmed save. One of them may
   *  have landed even though its reply was lost. */
  attempts: Block[][];
  /** Overwrite whatever is there ("Keep mine" after a conflict). */
  force?: boolean;
};

/**
 * Returns a stable function that writes pages.blocks. It is a plain
 * function rather than a mutation so a page that has left the screen can
 * keep retrying until its last edits are saved.
 *
 * The update is conditional on edited_at, so a second tab or a teammate
 * can't be silently overwritten. When the condition fails it reads the
 * row: if the blocks are still the ones this tab knows (the row changed
 * for another reason, such as a title edit, or our own earlier save
 * landed but its reply was lost) it retries against the new edited_at;
 * otherwise it throws EditConflictError.
 *
 * Optimistically patches the page detail and list caches so the "Edited …"
 * stamp moves immediately, then reconciles with the server's edited_at.
 */
export function useBlocksSender() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return useMemo(() => {
    const patchCaches = (pageId: string, edited_at: string, edited_by: string | null, blocks?: Block[]) => {
      qc.setQueryData<PageFull | null>(qk.page(pageId), (prev) =>
        prev
          ? {
              ...prev,
              ...(blocks ? { blocks: blocks as unknown as PageFull["blocks"] } : {}),
              edited_at,
              edited_by: edited_by ?? prev.edited_by,
            }
          : prev,
      );
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
        prev
          ? prev.map((p) =>
              p.id === pageId ? { ...p, edited_at, edited_by: edited_by ?? p.edited_by } : p,
            )
          : prev,
      );
    };

    const write = async (pageId: string, blocks: Block[], editedAt: string | null) => {
      let q = supabase.from("pages").update({ blocks: blocks as never }).eq("id", pageId);
      if (editedAt) q = q.eq("edited_at", editedAt);
      const { data, error } = await q.select("edited_at, edited_by");
      if (error) throw error;
      return (data?.[0] ?? null) as { edited_at: string; edited_by: string | null } | null;
    };

    return async (pageId: string, blocks: Block[], guard: BlocksSaveGuard) => {
      if (!confirmed.has(pageId) && guard.base) {
        confirmed.set(pageId, { editedAt: guard.editedAt, blocks: guard.base });
      }
      await qc.cancelQueries({ queryKey: qk.page(pageId) });
      patchCaches(pageId, new Date().toISOString(), userId, blocks);

      let row = await write(pageId, blocks, guard.force ? null : guard.editedAt);
      if (!row) {
        const { data: server, error } = await supabase
          .from("pages")
          .select("blocks, edited_at, edited_by")
          .eq("id", pageId)
          .maybeSingle();
        if (error) throw error;
        if (!server) throw new SaveRejectedError();
        const serverBlocks = (Array.isArray(server.blocks) ? server.blocks : []) as Block[];
        const ours =
          jsonEqual(serverBlocks, guard.base) ||
          jsonEqual(serverBlocks, blocks) ||
          guard.attempts.some((a) => jsonEqual(serverBlocks, a));
        if (!ours) {
          throw new EditConflictError({
            blocks: serverBlocks,
            edited_at: server.edited_at as string,
            edited_by: (server.edited_by as string | null) ?? null,
          });
        }
        row = await write(pageId, blocks, server.edited_at as string);
        if (!row) throw new SaveRejectedError();
      }
      patchCaches(pageId, row.edited_at, row.edited_by);
      confirmed.set(pageId, { editedAt: row.edited_at, blocks });
      return row;
    };
  }, [qc, ws, userId]);
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
    async (v: {
      seedProps: Record<string, unknown>;
      blocks?: unknown[];
      title?: string;
      icon?: string;
      /** Where the page goes: inside this page (a row, when it's a database). */
      parentId?: string | null;
      isDatabase?: boolean;
      /** Open it as its own page instead of in the dialog. */
      full?: boolean;
    }) => {
      const created = await create.mutateAsync(v);
      try {
        sessionStorage.setItem("gio.focus-title", created.id);
      } catch {
        /* storage unavailable */
      }
      // A new page opens in a dialog over this one (Notion's way), unless
      // it's a database or this is a phone; left blank, it's thrown away.
      openPageSomewhere(navigate, created.id, { full: !!v.isDatabase || !!v.full, fresh: true });
      return created;
    },
    [create, navigate],
  );
}

/* ────────────────────────── Icons: page + area ────────────────────────── */

/**
 * Set (or clear) `pages.icon`. Icons are always present on pages — the
 * write happens with the standard dual-cache optimistic patch on
 * qk.page(id) and qk.pages(ws), with a rollback on error. Because `icon`
 * is in `touch_page`'s WHEN clause, edited_at correctly moves.
 */
export function useSetPageIcon() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { pageId: string; icon: string }) => {
      const { error } = await supabase
        .from("pages")
        .update({ icon: v.icon })
        .eq("id", v.pageId);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      await qc.cancelQueries({ queryKey: qk.page(v.pageId) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
      const pageSnap = qc.getQueryData<PageFull | null>(qk.page(v.pageId)) ?? null;
      const nowIso = new Date().toISOString();
      qc.setQueryData<PageListItem[]>(
        qk.pages(ws),
        snapshot.map((p) =>
          p.id === v.pageId ? { ...p, icon: v.icon, edited_at: nowIso } : p,
        ),
      );
      qc.setQueryData<PageFull | null>(qk.page(v.pageId), (prev) =>
        prev ? { ...prev, icon: v.icon, edited_at: nowIso } : prev,
      );
      return { snapshot, pageSnap };
    },
    onError: (err, v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      if (ctx?.pageSnap !== undefined)
        qc.setQueryData(qk.page(v.pageId), ctx.pageSnap);
      toast.push(`Couldn't change icon: ${(err as Error).message}`);
    },
  });
}





/* ────────── Placement: pages inside pages ──────────
 *
 * Parenthood is the COLUMN `pages.parent_id`, never a prop. The DB trigger
 * trg_guard_page_parent is the real guard: `blockedParents` runs over the
 * reader's VISIBLE pages, so a restricted descendant is absent from that
 * array and the picker will sometimes legitimately offer a placement that is
 * secretly a cycle. The trigger raises a readable sentence — surface it. */
export function useSetPageParent() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();

  return useMutation({
    mutationFn: async (v: {
      pageId: string;
      parentId: string | null;
      /** Presentation only — used for the toast at both ends of a move. */
      title?: string;
      oldParentTitle?: string | null;
      quiet?: boolean;
    }) => {
      // The one path for a change of place (move_page): edit rights on both
      // ends, the cycle guard, and a database's properties.
      const { error } = await supabase.rpc("move_page", {
        p_page: v.pageId,
        p_parent: v.parentId,
      });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      qc.setQueryData<PageListItem[]>(qk.pages(ws), (prev) =>
        prev ? applyMove(prev, v.pageId, { parentId: v.parentId, beforeId: null }) : prev,
      );
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
      void qc.invalidateQueries({ queryKey: qk.page(v.pageId) });
      if (v.quiet) return;
      const title = v.title?.trim() || "Untitled";
      if (v.parentId === null) {
        toast.push(`"${title}" is no longer placed here`);
        return;
      }
      const from = v.oldParentTitle?.trim();
      toast.push(
        from
          ? `"${title}" moved here from "${from}"`
          : `"${title}" placed here`,
      );
    },
    onError: (err) => {
      // The trigger's own sentence: "That page already sits inside this one",
      // "A page cannot be placed inside itself", "Pages can only be nested
      // three levels deep".
      toast.push((err as Error).message);
    },
  });
}

/** Move a page in the tree (sidebar drag): a new parent and the sibling it
 *  goes before. Optimistic; the toast offers Undo, which puts the page back
 *  where it was, with the properties it had. */
export function useMovePage() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  const move = useMutation({
    mutationFn: async (v: {
      pageId: string;
      target: MoveTarget;
      props?: unknown;
      message?: string;
      undo?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("move_page", {
        p_page: v.pageId,
        p_parent: v.target.parentId,
        p_before: v.target.beforeId,
        ...(v.props !== undefined ? { p_props: v.props as never } : {}),
      });
      if (error) throw error;
      return data as unknown as { parent_id: string | null; before: string | null; props: unknown };
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.pages(ws) });
      const snapshot = qc.getQueryData<PageListItem[]>(qk.pages(ws));
      if (snapshot) {
        const parent = v.target.parentId ? snapshot.find((p) => p.id === v.target.parentId) : undefined;
        const nextDb = parent?.is_database ? parent.id : null;
        const moved = applyMove(snapshot, v.pageId, v.target).map((p) =>
          p.id === v.pageId
            ? {
                ...p,
                database_id: nextDb,
                // Out of a database: no properties. Into another: the server
                // carries over what fits; the refetch shows it.
                props: (v.props !== undefined
                  ? v.props
                  : nextDb === (p.database_id ?? null)
                    ? p.props
                    : {}) as PageListItem["props"],
              }
            : p,
        );
        qc.setQueryData<PageListItem[]>(qk.pages(ws), moved);
      }
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(qk.pages(ws), ctx.snapshot);
      toast.push((err as Error).message || "Couldn't move that page.");
    },
    onSuccess: (prev, v) => {
      if (v.undo) {
        toast.push("Moved back.");
        return;
      }
      toast.push({
        message: v.message ?? "Moved.",
        action: {
          label: "Undo",
          onClick: () =>
            move.mutate({
              pageId: v.pageId,
              target: { parentId: prev.parent_id, beforeId: prev.before },
              props: prev.props,
              undo: true,
            }),
        },
        durationMs: 8_000,
      });
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
      void qc.invalidateQueries({ queryKey: qk.page(v.pageId) });
    },
  });
  return move;
}

/** A page id chosen by the client, so a page can be read back after an
 *  insert that doesn't return it. */
function newPageId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
    )
  );
}
