import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { prefetchSignedUrls } from "@/lib/images";
import { collectImagePaths } from "@/lib/image-ops";
import { collectEmojiNames, resolveEmojiDataUris } from "@/lib/emoji-export";
import { toPreviewHtml } from "@/lib/export";
import { documentFontFaceCss } from "@/lib/font-faces";
import type { InlineEmoji } from "@/lib/emoji-registry";
import type { Block } from "@/lib/types";

/* Page history: the versions the database keeps of a page (page_versions,
 * written by the snapshot trigger: at most one per editor every two minutes,
 * the last 50 per page) and restoring one (restore_page_from_version).
 *
 * The list never loads blocks; one version's blocks load when it is
 * previewed. Versions never change, so both stay cached. */

export type PageVersion = {
  id: string;
  title: string;
  icon: string | null;
  edited_by: string | null;
  /** When the saved content was last edited; null on versions saved before
   *  2026-10-10, which fall back to created_at. */
  edited_at: string | null;
  /** When the version was saved: the moment its content was replaced. */
  created_at: string;
};

export function versionTime(v: Pick<PageVersion, "edited_at" | "created_at">): string {
  return v.edited_at ?? v.created_at;
}

async function fetchVersions(pageId: string): Promise<PageVersion[]> {
  const { data, error } = await supabase
    .from("page_versions")
    .select("id, title, icon, edited_by, edited_at, created_at")
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as PageVersion[];
}

export function usePageVersions(pageId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.pageVersions(pageId),
    queryFn: () => fetchVersions(pageId),
    enabled,
    staleTime: 0,
  });
}

export type VersionContent = {
  title: string;
  icon: string | null;
  blocks: Block[];
};

async function fetchVersionContent(versionId: string): Promise<VersionContent> {
  const { data, error } = await supabase
    .from("page_versions")
    .select("title, icon, blocks")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That version no longer exists.");
  const blocks = Array.isArray(data.blocks)
    ? (data.blocks as unknown[]).filter((b): b is Block => !!b && typeof b === "object")
    : [];
  return { title: data.title, icon: data.icon, blocks };
}

export type VersionPreview = VersionContent & { html: string };

/** Build the preview document. Serialising is synchronous, so images are
 *  signed and custom emoji embedded first, as for an export. */
export async function buildPreview(
  content: VersionContent,
  emojiSet: readonly InlineEmoji[],
): Promise<VersionPreview> {
  await prefetchSignedUrls(collectImagePaths(content.blocks as never));
  const names = collectEmojiNames(content.blocks, content.icon, emojiSet);
  const emoji = names.length ? await resolveEmojiDataUris(names, emojiSet) : new Map();
  const html = toPreviewHtml(
    { title: content.title || "Untitled", icon: content.icon, blocks: content.blocks, emoji },
    documentFontFaceCss(),
  );
  return { ...content, html };
}

/** A saved version, ready to preview. `id` "current" previews the page as it
 *  is now (from `current`), so the list can start with it. */
export function useVersionPreview(
  id: string | null,
  current: VersionContent & { editedAt: string | null },
  emojiSet: readonly InlineEmoji[],
) {
  const isCurrent = id === "current";
  return useQuery({
    queryKey: isCurrent
      ? [...qk.pageVersionPreview("current"), current.editedAt, current.title, current.icon]
      : qk.pageVersionPreview(id ?? "none"),
    queryFn: async () =>
      buildPreview(isCurrent ? current : await fetchVersionContent(id!), emojiSet),
    enabled: id !== null,
    // Signed image links last an hour; rebuild well before that.
    staleTime: isCurrent ? 0 : 30 * 60_000,
    gcTime: 10 * 60_000,
  });
}

/** Restore a version. Returns the id of the version that now holds the
 *  replaced content (restore that to undo), or null when the page already
 *  looked like this version. */
export async function restoreVersion(versionId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("restore_page_from_version", {
    p_version: versionId,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export type RestoredPage = {
  title: string;
  icon: string | null;
  blocks: Block[];
  edited_at: string;
  edited_by: string | null;
};

export async function fetchRestoredPage(pageId: string): Promise<RestoredPage> {
  const { data, error } = await supabase
    .from("pages")
    .select("title, icon, blocks, edited_at, edited_by")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The page is no longer there.");
  return {
    title: data.title,
    icon: data.icon,
    blocks: (Array.isArray(data.blocks) ? data.blocks : []) as unknown as Block[],
    edited_at: data.edited_at,
    edited_by: data.edited_by,
  };
}

/** Plain words for a failed restore. */
export function restoreErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "42501") return "You can view this page but not edit it, so you can't restore a version.";
  if (e?.code === "P0002") return "That version no longer exists. Pick another one.";
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "You're offline. Restore once you're back online.";
  }
  return "Couldn't restore this version. Try again.";
}
