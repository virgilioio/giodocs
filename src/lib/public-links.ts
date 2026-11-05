import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/lib/toast";

/* Public links (Allan, 2026-11-05): Notion's Share › Publish to web. A
 * published page has a link with a random code, `/s/<code>`, never its id;
 * pages inside it that are shared with the workspace come along (unless
 * that's switched off), private ones never do. set_page_public publishes
 * and unpublishes (editors and owners), get_published_page is all a
 * visitor can read, and owners can switch public links off for the
 * workspace. See supabase/migrations/…_public_links.sql. */

export type PublicLink = {
  token: string;
  include_children: boolean;
  created_by: string;
  created_at: string;
};

export type PublishedPage = {
  workspace: string;
  root: string;
  page: {
    id: string;
    title: string | null;
    icon: string | null;
    blocks: unknown[];
    is_database: boolean;
    edited_at: string | null;
  };
  /** From the published page down to this one. */
  path: Array<{ id: string; title: string | null; icon: string | null }>;
  children: Array<{ id: string; title: string | null; icon: string | null; is_database: boolean }>;
  /** Pages it mentions that the link shows (others read "Private page"). */
  mentioned: Array<{ id: string; title: string | null; icon: string | null }>;
  emoji: Array<{ name: string; path: string }>;
};

export type PublicPageRow = {
  page_id: string;
  title: string | null;
  icon: string | null;
  token: string;
  include_children: boolean;
  created_by: string;
  created_at: string;
};

/** The address a link opens: the published page, or a page inside it. */
export function publicPageUrl(token: string, pageId?: string | null): string {
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}/s/${token}${pageId ? `?p=${pageId}` : ""}`;
}

const linkKey = (pageId: string) => ["publicLink", pageId] as const;
const listKey = (ws: string) => ["publicPages", ws] as const;

/** A page's live link, or null when it isn't published. */
export function usePagePublicLink(pageId: string | null) {
  return useQuery({
    queryKey: linkKey(pageId ?? ""),
    enabled: !!pageId,
    queryFn: async (): Promise<PublicLink | null> => {
      const { data, error } = await supabase
        .from("page_public_links")
        .select("token, include_children, created_by, created_at")
        .eq("page_id", pageId!)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
  });
}

/** Publish, change, reset or unpublish a page's link. */
export function useSetPagePublic(pageId: string, workspaceId?: string | null) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { on: boolean; includeChildren?: boolean; reset?: boolean }) => {
      const { data, error } = await supabase.rpc("set_page_public", {
        p_page: pageId,
        p_on: v.on,
        p_include_children: v.includeChildren ?? true,
        p_reset: v.reset ?? false,
      });
      if (error) throw new Error(error.message);
      return (data as unknown as PublicLink | null) ?? null;
    },
    onSuccess: (link) => {
      qc.setQueryData(linkKey(pageId), link);
      if (workspaceId) qc.invalidateQueries({ queryKey: listKey(workspaceId) });
    },
    onError: (e: Error) => toast.push(e.message || "Couldn’t change the public link."),
  });
}

/** The workspace's published pages (owners see all of them). */
export function usePublicPages(ws: string | null) {
  return useQuery({
    queryKey: listKey(ws ?? ""),
    enabled: !!ws,
    queryFn: async (): Promise<PublicPageRow[]> => {
      const { data, error } = await supabase.rpc("list_public_pages", { p_ws: ws! });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** Owners: public links on or off for the whole workspace. */
export function useSetWorkspacePublicLinks(ws: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase.rpc("set_workspace_public_links", { p_ws: ws, p_on: on });
      if (error) throw new Error(error.message);
      return on;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", ws] });
      qc.invalidateQueries({ queryKey: listKey(ws) });
    },
    onError: (e: Error) => toast.push(e.message || "Couldn’t change public links."),
  });
}

/** What a visitor reads: the page this link shows at `pageId` (the
 *  published page when absent), or null when the link doesn't show it. */
export async function fetchPublishedPage(
  token: string,
  pageId?: string | null,
): Promise<PublishedPage | null> {
  const { data, error } = await supabase.rpc("get_published_page", {
    p_token: token,
    ...(pageId ? { p_page: pageId } : {}),
  });
  if (error) throw new Error(error.message);
  return (data as unknown as PublishedPage | null) ?? null;
}
