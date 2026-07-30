/**
 * The workspace's custom emoji set: one query, one batch of signed URLs.
 *
 * Signing happens ONCE per set (createSignedUrls, 1 hour) rather than per
 * render or per icon site — the twelve icon call sites all read the same
 * cached array. A copy of each URL lands in the module-level image URL
 * cache so the synchronous export serialisers can reach it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { IMAGE_BUCKET } from "@/lib/image-ops";
import { rememberSignedUrl } from "@/lib/image-url-cache";
import { emojiStoragePath, type CustomEmoji } from "@/lib/custom-emoji";
import { useWorkspaceId } from "@/lib/workspace-context";

const HOUR = 3600;

async function fetchCustomEmoji(ws: string): Promise<CustomEmoji[]> {
  const { data, error } = await supabase
    .from("custom_emoji")
    .select("name, description, path, created_by, created_at")
    .eq("workspace_id", ws)
    .limit(500);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const paths = rows.map((r) => r.path);
  const signed = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(paths, HOUR);
  const byPath = new Map<string, string>();
  for (const s of signed.data ?? []) {
    if (s.path && s.signedUrl) {
      byPath.set(s.path, s.signedUrl);
      rememberSignedUrl(s.path, s.signedUrl);
    }
  }
  return rows
    .map((r) => ({
      name: r.name,
      description: r.description ?? "",
      path: r.path,
      url: byPath.get(r.path) ?? "",
      created_by: r.created_by,
      created_at: r.created_at,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function useCustomEmoji(wsIn?: string) {
  const ctxWs = useWorkspaceId();
  const ws = wsIn ?? ctxWs;
  return useQuery({
    queryKey: ws ? qk.customEmoji(ws) : ["customEmoji", "none"],
    queryFn: () => fetchCustomEmoji(ws!),
    enabled: !!ws,
    // A little under the one-hour signed-URL expiry.
    staleTime: 50 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/** The set itself — the shape every resolver call site wants. */
export function useEmojiSet(): CustomEmoji[] {
  return useCustomEmoji().data ?? [];
}

/** Pages-per-emoji, for the in-use guard. */
export function useCustomEmojiUsage() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ws ? ["customEmojiUsage", ws] : ["customEmojiUsage", "none"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custom_emoji_usage", {
        p_workspace: ws!,
      });
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of data ?? []) m.set(r.name, r.pages ?? 0);
      return m;
    },
    enabled: !!ws,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  return () => {
    if (!ws) return;
    qc.invalidateQueries({ queryKey: qk.customEmoji(ws) });
    qc.invalidateQueries({ queryKey: ["customEmojiUsage", ws] });
    qc.invalidateQueries({ queryKey: qk.pages(ws) });
  };
}

/** Upload the 128px PNG and insert the row. */
export function useCreateCustomEmoji() {
  const ws = useWorkspaceId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (v: { name: string; description: string; blob: Blob; userId: string }) => {
      const path = emojiStoragePath(ws!, v.name);
      const up = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, v.blob, { contentType: "image/png", upsert: true });
      if (up.error) throw up.error;
      const { error } = await supabase.from("custom_emoji").insert({
        workspace_id: ws!,
        name: v.name,
        description: v.description,
        path,
        created_by: v.userId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Rename / re-describe / replace the image. The rename goes through
 * rename_custom_emoji, which is ATOMIC: it renames the row AND rewrites
 * pages.icon on every page wearing the old shortcode, returning how many
 * pages it touched.
 */
export function useUpdateCustomEmoji() {
  const ws = useWorkspaceId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (v: {
      oldName: string;
      name: string;
      description: string;
      blob?: Blob | null;
    }) => {
      let path: string | null = null;
      if (v.blob) {
        path = emojiStoragePath(ws!, v.name);
        const up = await supabase.storage
          .from(IMAGE_BUCKET)
          .upload(path, v.blob, { contentType: "image/png", upsert: true });
        if (up.error) throw up.error;
      } else if (v.name !== v.oldName) {
        // The object keeps its old key; only the row's name changes.
        path = null;
      }
      const { data, error } = await supabase.rpc("rename_custom_emoji", {
        p_workspace: ws!,
        p_old: v.oldName,
        p_new: v.name,
        p_desc: v.description,
        p_path: path,
      });
      if (error) throw error;
      return (data ?? 0) as number;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteCustomEmoji() {
  const ws = useWorkspaceId();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (v: { name: string; path: string }) => {
      const { error } = await supabase
        .from("custom_emoji")
        .delete()
        .eq("workspace_id", ws!)
        .eq("name", v.name);
      if (error) throw error;
      await supabase.storage.from(IMAGE_BUCKET).remove([v.path]);
    },
    onSuccess: invalidate,
  });
}
