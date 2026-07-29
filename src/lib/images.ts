/**
 * Storage layer for image blocks: signing, uploading, downscaling and GC.
 *
 * Signed URLs are resolved with createSignedUrl(path, 3600) and cached in
 * TanStack Query keyed by the storage PATH, with a staleTime a little
 * under the expiry — a page with eight images signs once per image per
 * hour rather than once per render. A copy lands in a module-level map so
 * the synchronous export serialisers can read it (src/lib/image-url-cache).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { rememberSignedUrl } from "./image-url-cache";
import {
  IMAGE_BUCKET,
  IMAGE_MAX_EDGE,
  extForMime,
  storagePath,
} from "./image-ops";

const HOUR = 3600;

export async function signPath(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(path, HOUR);
  if (error || !data?.signedUrl) throw error ?? new Error("Could not sign image");
  rememberSignedUrl(path, data.signedUrl);
  return data.signedUrl;
}

export function signedImageKey(path: string) {
  return ["signedImage", path] as const;
}

export function useSignedImageUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: signedImageKey(path ?? ""),
    enabled: !!path,
    // A little under the one-hour expiry.
    staleTime: 55 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: () => signPath(path as string),
  });
}

/** Resolve every path in a list, for the export path. */
export async function prefetchSignedUrls(paths: readonly string[]): Promise<void> {
  await Promise.all(
    paths.map((p) =>
      signPath(p).catch(() => {
        /* an unsignable image simply exports without a src */
      }),
    ),
  );
}

/**
 * Downscale anything wider than 2400px via canvas. Retina screenshots are
 * routinely 5–6 MB for no visual gain. SVG and GIF pass through untouched
 * (vector has no pixel width; a canvas pass would flatten an animation).
 */
export async function downscale(file: File): Promise<Blob> {
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function")
    return file;
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width <= IMAGE_MAX_EDGE) {
      bmp.close?.();
      return file;
    }
    const scale = IMAGE_MAX_EDGE / bmp.width;
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_MAX_EDGE;
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const out = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, file.type === "image/png" ? "image/png" : "image/jpeg", 0.92),
    );
    return out ?? file;
  } catch {
    return file;
  }
}

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Upload and return the STORAGE PATH — never a URL. */
export async function uploadImage(
  file: File,
  workspaceId: string,
  pageId: string,
): Promise<string> {
  const body = await downscale(file);
  const path = storagePath(workspaceId, pageId, uuid(), extForMime(file.type));
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, body, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

/**
 * Remove objects for images a page no longer references. Deletion goes
 * through page_images_gc, which checks the caller can edit the page and
 * only touches objects whose path's page segment matches — the client
 * never deletes from storage directly.
 */
export async function gcImagePaths(
  pageId: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) return;
  await supabase.rpc("page_images_gc", {
    p_page: pageId,
    p_paths: paths as string[],
  });
}
