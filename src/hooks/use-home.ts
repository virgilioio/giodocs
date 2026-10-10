import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { qk } from "@/lib/query-keys";
import { readHomePrefs, withVisit, type HomePrefs, type PageVisit } from "@/lib/home";

/* Home's data: the person's own settings (home_prefs) and the pages they
 * visited (page_visits). RLS returns only their own rows; visits are
 * written only by record_page_visit, which checks the page can be opened. */

export function useHomePrefs() {
  const { user } = useAuth();
  const uid = user?.id;
  return useQuery({
    queryKey: qk.homePrefs(uid ?? "none"),
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<HomePrefs> => {
      const { data, error } = await supabase
        .from("home_prefs")
        .select("nickname, emoji, start_page, hidden, pinned_views")
        .eq("user_id", uid!)
        .maybeSingle();
      if (error) throw error;
      return readHomePrefs(data);
    },
  });
}

/** Changes some of the person's Home settings. Shows at once; a failure
 *  puts the old settings back. */
export function useSaveHomePrefs() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = qk.homePrefs(user?.id ?? "none");
  return useMutation({
    mutationFn: async (patch: Partial<HomePrefs>) => {
      if (!user?.id) throw new Error("Not signed in");
      const next = { ...(qc.getQueryData<HomePrefs>(key) ?? readHomePrefs(null)), ...patch };
      const { error } = await supabase.from("home_prefs").upsert({
        user_id: user.id,
        nickname: next.nickname,
        emoji: next.emoji,
        start_page: next.start_page,
        hidden: next.hidden,
        pinned_views: next.pinned_views,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<HomePrefs>(key);
      qc.setQueryData<HomePrefs>(key, { ...(prev ?? readHomePrefs(null)), ...patch });
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
  });
}

export function useRecentVisits(ws: string | null | undefined) {
  return useQuery({
    queryKey: qk.recentVisits(ws ?? "none"),
    enabled: !!ws,
    staleTime: 60_000,
    queryFn: async (): Promise<PageVisit[]> => {
      const { data, error } = await supabase
        .from("page_visits")
        .select("page_id, visited_at")
        .eq("workspace_id", ws!)
        .order("visited_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as PageVisit[];
    },
  });
}

/** Records that the person opened a page. The page moves to the front of
 *  Recently visited at once; nothing is refetched. A failed write is
 *  ignored: a missed visit never gets in the way of reading the page. */
export function useRecordVisit(ws: string | null | undefined, pageId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!ws || !pageId) return;
    const key = qk.recentVisits(ws);
    const prev = qc.getQueryData<PageVisit[]>(key);
    if (prev) qc.setQueryData<PageVisit[]>(key, withVisit(prev, pageId, new Date().toISOString()));
    void supabase.rpc("record_page_visit", { p_page: pageId }).then(
      () => undefined,
      () => undefined,
    );
  }, [ws, pageId, qc]);
}
