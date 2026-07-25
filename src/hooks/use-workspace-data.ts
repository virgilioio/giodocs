import { useQuery, useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import type { PageListItem, PageFull, PageAccessRow } from "@/lib/types";

const PAGE_LIST_COLUMNS =
  "id, title, icon, props, verified_at, verified_by, edited_at, edited_by, access_type";

const PAGE_FULL_COLUMNS =
  "id, workspace_id, title, icon, props, blocks, access_type, verified_at, verified_by, edited_at, edited_by, created_by, created_at, deleted_at";

async function fetchPages(ws: string): Promise<PageListItem[]> {
  const { data, error } = await supabase
    .from("pages")
    .select(PAGE_LIST_COLUMNS)
    .eq("workspace_id", ws)
    .is("deleted_at", null)
    .order("edited_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as PageListItem[];
}

async function fetchPage(id: string): Promise<PageFull | null> {
  const { data, error } = await supabase
    .from("pages")
    .select(PAGE_FULL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PageFull | null;
}

async function fetchPageAccess(id: string): Promise<PageAccessRow[]> {
  const { data, error } = await supabase
    .from("page_access")
    .select("page_id, user_id, guest_email, capability")
    .eq("page_id", id);
  if (error) throw error;
  return (data ?? []) as PageAccessRow[];
}

async function fetchViews(ws: string) {
  const { data, error } = await supabase
    .from("views")
    .select("*")
    .eq("workspace_id", ws);
  if (error) throw error;
  return data ?? [];
}

async function fetchMembers(ws: string) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id, role, profiles(*)")
    .eq("workspace_id", ws);
  if (error) throw error;
  return data ?? [];
}

async function fetchPropDefs(ws: string) {
  const { data, error } = await supabase
    .from("property_defs")
    .select("*")
    .eq("workspace_id", ws);
  if (error) throw error;
  return data ?? [];
}

async function fetchWorkspace(ws: string) {
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", ws)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function usePages(ws: string | undefined) {
  return useQuery({
    queryKey: ws ? qk.pages(ws) : ["pages", "none"],
    queryFn: () => fetchPages(ws!),
    enabled: !!ws,
  });
}

export function usePage(id: string | undefined) {
  return useQuery({
    queryKey: id ? qk.page(id) : ["page", "none"],
    queryFn: () => fetchPage(id!),
    enabled: !!id,
  });
}

export const pageQuery = (id: string) => ({
  queryKey: qk.page(id),
  queryFn: () => fetchPage(id),
});

export function usePageAccess(id: string | undefined) {
  return useQuery({
    queryKey: id ? ["pageAccess", id] : ["pageAccess", "none"],
    queryFn: () => fetchPageAccess(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useViews(ws: string | undefined) {
  return useQuery({
    queryKey: ws ? qk.views(ws) : ["views", "none"],
    queryFn: () => fetchViews(ws!),
    enabled: !!ws,
  });
}

export function useMembers(ws: string | undefined) {
  return useQuery({
    queryKey: ws ? qk.members(ws) : ["members", "none"],
    queryFn: () => fetchMembers(ws!),
    enabled: !!ws,
  });
}

export function usePropDefs(ws: string | undefined) {
  return useQuery({
    queryKey: ws ? qk.propDefs(ws) : ["propDefs", "none"],
    queryFn: () => fetchPropDefs(ws!),
    enabled: !!ws,
  });
}

export function useWorkspace(ws: string | undefined) {
  return useQuery({
    queryKey: ws ? qk.workspace(ws) : ["workspace", "none"],
    queryFn: () => fetchWorkspace(ws!),
    enabled: !!ws,
  });
}

export function useAllowedDomains(ws: string | undefined) {
  return useQuery({
    queryKey: ws ? ["allowed_domains", ws] : ["allowed_domains", "none"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allowed_domains")
        .select("domain")
        .eq("workspace_id", ws!);
      if (error) throw error;
      return (data ?? []).map((r) => r.domain);
    },
    enabled: !!ws,
  });
}



export function useAreas(ws: string | undefined) {
  const pagesQ = usePages(ws);
  const pages = pagesQ.data ?? [];
  const counts = new Map<string, number>();
  for (const p of pages) {
    const props =
      p.props && typeof p.props === "object" && !Array.isArray(p.props)
        ? (p.props as Record<string, unknown>)
        : {};
    const area = props.area;
    if (typeof area === "string" && area) {
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
  }
  const areas = Array.from(counts, ([area, page_count]) => ({
    area,
    page_count,
  })).sort((a, b) => (a.area < b.area ? -1 : a.area > b.area ? 1 : 0));
  return { ...pagesQ, data: areas };
}

export function useWorkspaceShell(ws: string | undefined) {
  const enabled = !!ws;
  const results = useQueries({
    queries: [
      {
        queryKey: enabled ? qk.pages(ws!) : ["pages", "none"],
        queryFn: () => fetchPages(ws!),
        enabled,
      },
      {
        queryKey: enabled ? qk.views(ws!) : ["views", "none"],
        queryFn: () => fetchViews(ws!),
        enabled,
      },
      {
        queryKey: enabled ? qk.members(ws!) : ["members", "none"],
        queryFn: () => fetchMembers(ws!),
        enabled,
      },
      {
        queryKey: enabled ? qk.propDefs(ws!) : ["propDefs", "none"],
        queryFn: () => fetchPropDefs(ws!),
        enabled,
      },
      {
        queryKey: enabled ? qk.workspace(ws!) : ["workspace", "none"],
        queryFn: () => fetchWorkspace(ws!),
        enabled,
      },
    ],
  });
  const [pages, views, members, propDefs, workspace] = results;
  return { pages, views, members, propDefs, workspace };
}
