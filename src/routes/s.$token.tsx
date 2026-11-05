import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { PublicPage } from "@/components/public-page";

type PublicSearch = { p?: string; v?: string; m?: string };

const pick = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : undefined);

// A public link (2026-11-05): anyone can open it, without signing in.
// ?p= a page inside the published one, ?v= a database page's view, ?m= a
// calendar's month (YYYY-MM).
export const Route = createFileRoute("/s/$token")({
  validateSearch: (search: Record<string, unknown>): PublicSearch => {
    const out: PublicSearch = {};
    const p = pick(search.p, /^[\w-]{1,64}$/);
    const v = pick(search.v, /^[\w-]{1,64}$/);
    const m = pick(search.m, /^\d{4}-\d{2}$/);
    if (p) out.p = p;
    if (v) out.v = v;
    if (m) out.m = m;
    return out;
  },
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
  const { p, v, m } = useSearch({ from: "/s/$token" });
  return <PublicPage token={token} pageId={p ?? null} viewId={v ?? null} month={m ?? null} />;
}
