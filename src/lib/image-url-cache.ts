/**
 * A tiny module-level map of storage path → last resolved signed URL.
 *
 * TanStack Query owns the real cache (see src/lib/images.ts); this exists
 * only so the SYNCHRONOUS export serialisers in src/lib/export.ts can put
 * a usable src into a Markdown or HTML file. It imports nothing — no
 * Supabase, no React — so export.ts stays free of both.
 */

const urls = new Map<string, string>();

export function rememberSignedUrl(path: string, url: string): void {
  urls.set(path, url);
}

/** The last signed URL seen for a path, or "" when it was never signed. */
export function peekSignedUrl(path: string | null | undefined): string {
  if (!path) return "";
  return urls.get(path) ?? "";
}
