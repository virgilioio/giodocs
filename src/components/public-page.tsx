import { useEffect, useMemo, type MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { collectImagePaths } from "@/lib/image-ops";
import { prefetchSignedUrls } from "@/lib/images";
import { collectEmojiNames, resolveEmojiDataUris } from "@/lib/emoji-export";
import { documentFontFaceCss } from "@/lib/font-faces";
import { setMentionDirectory } from "@/lib/mention-directory";
import { fetchPublishedPage, type PublishedPage } from "@/lib/public-links";
import { publicHref, publicPageHtml } from "@/lib/public-page";
import { Ico } from "./emoji-icon";

/* The page a public link opens (Allan, 2026-11-05): no sign-in, no
 * sidebar, read only. A thin bar names the workspace and the way down from
 * the published page; the page itself is its document (public-page.ts) in
 * a sandboxed frame that runs no scripts. Its images, files and custom
 * emoji are signed for the visitor, which only a published page allows. */

const FRAME_CSS = `
  .pub-children { margin-top: 40px; padding-top: 14px; border-top: 1px solid rgba(13,13,9,.1); }
  .pub-children h3 { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; margin: 0 0 8px; }
  .pub-children ul { list-style: none; padding: 0; margin: 0; }
  .pub-children li { margin: 4px 0; }
  .pub-children a { color: inherit; text-decoration: none; border-bottom: 1px solid rgba(13,13,9,.2); }
  @media screen { body { max-width: 760px; margin: 0 auto; } }
`;

type Built = { data: PublishedPage; html: string };

async function build(token: string, pageId: string | null): Promise<Built | null> {
  const data = await fetchPublishedPage(token, pageId);
  if (!data) return null;
  // Mentions of pages this link shows read their titles; others "Private page".
  setMentionDirectory({
    users: new Map(),
    pages: new Map(
      [...data.mentioned, ...data.path, ...data.children].map((p) => [
        p.id,
        { title: p.title || "Untitled", icon: p.icon },
      ]),
    ),
  });
  const blocks = (data.page.blocks ?? []) as never;
  await prefetchSignedUrls(collectImagePaths(blocks));
  // Custom emoji: signed here (the workspace publishes a page), then embedded.
  const set = (
    await Promise.all(
      data.emoji.map(async (e) => {
        const { data: s } = await supabase.storage
          .from("page-images")
          .createSignedUrl(e.path, 3600);
        return s?.signedUrl ? { name: e.name, url: s.signedUrl } : null;
      }),
    )
  ).filter((x): x is { name: string; url: string } => !!x);
  const names = collectEmojiNames(blocks, data.page.icon, set as never);
  const emoji = names.length
    ? await resolveEmojiDataUris(names, set as never)
    : new Map<string, string>();
  return { data, html: publicPageHtml(data, token, emoji, documentFontFaceCss() + FRAME_CSS) };
}

export function PublicPage({ token, pageId }: { token: string; pageId: string | null }) {
  const navigate = useNavigate();
  /** Another page of this link: in the app, without reloading it. */
  const go = (href: string) => {
    const u = new URL(href, window.location.origin);
    const p = u.searchParams.get("p");
    void navigate({ to: "/s/$token", params: { token }, search: p ? { p } : {} });
  };
  const onBarClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(e.currentTarget.href);
  };
  /** The page's own links to pages inside it go through the app too (the
   *  frame runs no scripts; it shares the page's origin, so this can listen). */
  const onFrameLoad = (frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      const href = a?.getAttribute("href") ?? "";
      if (!a || !href.startsWith(`/s/${token}`) || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      go(href);
    });
  };
  const q = useQuery({
    queryKey: ["publishedPage", token, pageId ?? ""],
    queryFn: () => build(token, pageId),
    // Signed links last an hour.
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const built = q.data ?? null;
  const title = built?.data.page.title || "Untitled";
  useEffect(() => {
    if (built) document.title = `${title} — ${built.data.workspace}`;
  }, [built, title]);
  const path = useMemo(() => built?.data.path ?? [], [built]);

  if (q.isLoading) return <div className="min-h-screen bg-surface" aria-busy="true" />;
  if (!built) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas" style={{ padding: 24 }}>
        <div className="max-w-md text-center">
          <img
            src="/gio-docs-logo.svg"
            alt="Gio Docs"
            style={{ height: 22, margin: "0 auto 18px" }}
          />
          <h1 className="font-display text-h3 text-noir" style={{ fontWeight: 700 }}>
            This link doesn’t open a page
          </h1>
          <p className="mt-2 text-row text-muted" style={{ lineHeight: 1.5 }}>
            {q.isError
              ? "The page couldn’t be loaded. Check your connection and try again."
              : "It may have been turned off, or the page is no longer public. Ask whoever shared it for a new link."}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col bg-surface" data-public-page>
      <header
        className="flex shrink-0 items-center border-b border-lineSoft bg-surface"
        style={{ gap: 10, padding: "10px 18px", minHeight: 48 }}
      >
        <img src="/gio-docs-logo.svg" alt="Gio Docs" style={{ height: 16 }} />
        <span className="text-meta text-faint">{built.data.workspace}</span>
        <nav
          aria-label="Pages"
          className="flex min-w-0 flex-1 items-center text-meta"
          style={{ gap: 4 }}
        >
          {path.map((p, i) => (
            <span key={p.id} className="flex min-w-0 items-center" style={{ gap: 4 }}>
              <span aria-hidden className="text-faint">
                /
              </span>
              {i === path.length - 1 ? (
                <span className="flex min-w-0 items-center truncate text-strong" style={{ gap: 4 }}>
                  {p.icon ? <Ico icon={p.icon} size={14} /> : null}
                  <span className="truncate">{p.title || "Untitled"}</span>
                </span>
              ) : (
                <a
                  href={publicHref(token, p.id, built.data.root)}
                  onClick={onBarClick}
                  className="flex min-w-0 items-center truncate text-muted hover:text-strong"
                  style={{ gap: 4 }}
                >
                  {p.icon ? <Ico icon={p.icon} size={14} /> : null}
                  <span className="truncate">{p.title || "Untitled"}</span>
                </a>
              )}
            </span>
          ))}
        </nav>
        <span className="shrink-0 text-caption text-faint">Read only</span>
      </header>
      <iframe
        title={title}
        srcDoc={built.html}
        // No scripts run in the page; links open in a new tab, the pages
        // inside it here.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
        onLoad={(e) => onFrameLoad(e.currentTarget)}
        className="w-full flex-1 border-0"
        style={{ minHeight: "calc(100vh - 49px)" }}
      />
    </div>
  );
}
