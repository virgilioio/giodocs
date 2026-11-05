import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { PublicPage } from "@/components/public-page";

// A public link (2026-11-05): anyone can open it, without signing in.
export const Route = createFileRoute("/s/$token")({
  validateSearch: (search: Record<string, unknown>): { p?: string } =>
    typeof search.p === "string" && search.p ? { p: search.p } : {},
  head: () => ({
    meta: [
      { title: "Gio Docs" },
      // Never invited into search engines.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PublicLinkPage,
});

function PublicLinkPage() {
  const { token } = useParams({ from: "/s/$token" });
  const { p } = useSearch({ from: "/s/$token" });
  return <PublicPage token={token} pageId={p ?? null} />;
}
