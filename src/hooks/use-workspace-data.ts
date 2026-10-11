import type { Database } from "@/integrations/supabase/types";
import { useQuery, useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { applyAvatarRender } from "@/lib/avatar";
import type { PageListItem, PageFull, PageAccessRow } from "@/lib/types";

const PAGE_LIST_COLUMNS =
  "id, title, icon, props, verified_at, verified_by, edited_at, edited_by, created_at, created_by, access_type, archived_at, parent_id, database_id, is_database, position, task_config";

const PAGE_FULL_COLUMNS =
  "id, workspace_id, title, icon, props, blocks, access_type, ws_role, verified_at, verified_by, edited_at, edited_by, created_by, created_at, deleted_at, archived_at, template_at, parent_id, database_id, is_database, position, task_config";

async function fetchPages(ws: string): Promise<PageListItem[]> {
  // Archived pages and templates leave every view, area list, and sidebar
  // count. They stay reachable by direct URL and by search_pages (⌘K),
  // which is the "stays searchable" promise; templates are also offered
  // when starting a new page (useTemplates).
  const { data, error } = await supabase
    .from("pages")
    .select(PAGE_LIST_COLUMNS)
    .eq("workspace_id", ws)
    .is("deleted_at", null)
    .is("archived_at", null)
    .is("template_at", null)
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
    .eq("workspace_id", ws)
    // Every database has its own views; don't cut them off at a few dozen
    // databases.
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

async function fetchMembers(ws: string) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, user_id, role, profiles(*)")
    .eq("workspace_id", ws)
    .limit(500);
  if (error) throw error;
  // Compose portraits into profiles.avatar_tint / avatar_ink so every avatar
  // call site works with zero changes — see src/lib/avatar.ts.
  return (data ?? []).map((row) => ({
    ...row,
    profiles: applyAvatarRender(row.profiles),
  }));
}

/** Every database brings its own properties, so a workspace can hold
 *  more than one request returns: read them a page of 1000 at a time
 *  instead of cutting off at a fixed count. */
const PROP_PAGE = 1000;

/** Live properties only: archived ones are hidden from pages, views,
 *  filters and pickers (their values stay on the pages). */
async function fetchPropDefs(ws: string) {
  const out: Database["public"]["Tables"]["property_defs"]["Row"][] = [];
  for (let from = 0; ; from += PROP_PAGE) {
    const { data, error } = await supabase
      .from("property_defs")
      .select("*")
      .eq("workspace_id", ws)
      .is("archived_at", null)
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PROP_PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PROP_PAGE) return out;
  }
}

/** Every property, archived included — for Settings › Properties. */
async function fetchAllPropDefs(ws: string) {
  const out: Database["public"]["Tables"]["property_defs"]["Row"][] = [];
  for (let from = 0; ; from += PROP_PAGE) {
    const { data, error } = await supabase
      .from("property_defs")
      .select("*")
      .eq("workspace_id", ws)
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PROP_PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PROP_PAGE) return out;
  }
}

export function useAllPropDefs(ws: string | undefined) {
  return useQuery({
    queryKey: ws ? qk.propDefsAll(ws) : ["propDefsAll", "none"],
    queryFn: () => fetchAllPropDefs(ws!),
    enabled: !!ws,
  });
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
    queryKey: id ? qk.pageAccess(id) : ["pageAccess", "none"],
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

export type TemplateRow = {
  id: string;
  title: string;
  icon: string | null;
  edited_at: string;
  /** The database the template is a row of; null for a plain-page template. */
  database_id: string | null;
};

async function fetchTemplates(ws: string): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, title, icon, edited_at, database_id")
    .eq("workspace_id", ws)
    .is("deleted_at", null)
    .is("archived_at", null)
    .not("template_at", "is", null)
    .order("title", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as TemplateRow[];
}

/** The templates this person can open, A–Z. */
export function useTemplates(ws: string | undefined) {
  return useQuery({
    queryKey: ws ? qk.templates(ws) : ["templates", "none"],
    queryFn: () => fetchTemplates(ws!),
    enabled: !!ws,
    staleTime: 60_000,
  });
}
