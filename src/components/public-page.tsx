import { useEffect, useMemo, useRef, type MouseEvent } from "react";
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
import {
  databasePageHtml,
  inlineDatabaseHtml,
  makePublicDbCtx,
  publicFilePaths,
  rowPropertiesHtml,
  toListItem,
  type PublicRow,
} from "@/lib/public-database";
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
  @media screen { body { max-width: 760px; margin: 0 auto; } body.pub-wide { max-width: 1180px; } }
  /* Databases (public-database.ts): the app's grid, read only. */
  .pub-db { margin: 14px 0; font-size: 14px; line-height: 1.45; }
  .pub-db-head { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 15px; margin: 0 0 6px; color: var(--color-strong); }
  .pub-db-note { padding: 10px 12px; border-radius: 6px; background: var(--color-sunken); color: var(--color-muted); font-size: 14px; }
  .pub-db-foot { margin-top: 6px; font-size: 12px; color: var(--color-faint); }
  .pub-scroll { overflow-x: auto; max-width: 100%; }
  .pub-table { border-collapse: separate; border-spacing: 0; table-layout: fixed; margin: 0; font-size: 14px; }
  .pub-table th, .pub-table td { border: 0; border-bottom: 1px solid var(--color-line); border-right: 1px solid var(--color-line); padding: 6px 8px; vertical-align: top; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: var(--color-surface); }
  .pub-table th:last-child, .pub-table td:last-child { border-right: 0; }
  .pub-table thead th { background: var(--color-surface); color: var(--color-muted); font-weight: 400; font-size: 13px; border-top: 1px solid var(--color-line); }
  .pub-table .pub-wrap { white-space: normal; }
  .pub-table .pub-frozen { position: sticky; z-index: 1; }
  .pub-table .pub-title { font-weight: 700; }
  .pub-table tr.pub-group td { background: var(--color-surface); border-right: 0; padding-top: 14px; font-weight: 700; }
  .pub-table tfoot td { color: var(--color-muted); font-size: 12px; border-bottom: 0; }
  .pub-calc-label { color: var(--color-faint); }
  .pub-count { color: var(--color-faint); font-weight: 400; font-size: 12px; margin-left: 4px; }
  .pub-chip { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 13px; line-height: 20px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
  .pub-person { display: inline-flex; align-items: center; gap: 5px; margin-right: 6px; white-space: nowrap; }
  .pub-av { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: 700; flex: none; }
  .pub-check { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 3px; border: 1.5px solid var(--color-whisper); font-size: 11px; line-height: 1; color: var(--color-surface); vertical-align: middle; }
  .pub-check.on { background: var(--color-accent); border-color: var(--color-accent); }
  .pub-ico { margin-right: 5px; }
  .pub-rel { margin-right: 8px; white-space: nowrap; }
  .pub-private { color: var(--color-faint); }
  .pub-file { margin-right: 8px; }
  .pub-db a, .pub-props a { color: inherit; text-decoration: none; border-bottom: 1px solid rgba(13,13,9,.2); }
  .pub-db a.pub-page-link, .pub-props a.pub-page-link { border-bottom: 0; }
  .pub-db a.pub-page-link:hover .pub-title-text, .pub-props a.pub-page-link:hover { text-decoration: underline; text-decoration-color: rgba(13,13,9,.35); }
  .pub-board { display: flex; gap: 12px; align-items: flex-start; padding-bottom: 6px; }
  .pub-col { flex: none; width: 240px; }
  .pub-col header { display: flex; align-items: center; margin: 0 0 8px; }
  .pub-card { padding: 9px 10px; margin: 0 0 8px; border-radius: 8px; background: var(--color-surface); box-shadow: 0 0 0 1px var(--color-line), 0 1px 2px rgba(13,13,9,.04); font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
  .pub-props-line { margin-top: 5px; font-weight: 400; font-size: 13px; color: var(--color-body); display: flex; flex-wrap: wrap; gap: 4px; }
  .pub-list { list-style: none; padding: 0; margin: 0; }
  .pub-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 4px; border-bottom: 1px solid var(--color-lineSoft); }
  .pub-list .pub-props-line { margin: 0; }
  .pub-cal-bar { display: flex; align-items: center; justify-content: space-between; margin: 0 0 6px; }
  .pub-cal-month { font-weight: 700; }
  .pub-cal-nav a { margin-left: 10px; border-bottom: 0 !important; color: var(--color-muted); }
  .pub-cal { table-layout: fixed; min-width: 640px; margin: 0; font-size: 13px; }
  .pub-cal th { background: transparent; color: var(--color-muted); font-weight: 400; font-size: 12px; text-align: left; }
  .pub-cal td { height: 92px; padding: 4px 5px; }
  .pub-cal td.out { background: var(--color-track); color: var(--color-faint); }
  .pub-cal td.today .pub-day { color: var(--color-surface); background: var(--color-danger); border-radius: 10px; display: inline-block; padding: 0 6px; }
  .pub-day { font-size: 12px; margin-bottom: 3px; }
  .pub-event { padding: 2px 5px; margin: 0 0 3px; border-radius: 4px; background: var(--color-surface); box-shadow: 0 0 0 1px var(--color-line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700; }
  .pub-tabs { display: flex; gap: 2px; overflow-x: auto; border-bottom: 1px solid var(--color-line); margin: 0 0 10px; }
  .pub-tabs a { padding: 6px 10px 7px; color: var(--color-muted); border-bottom: 2px solid transparent !important; white-space: nowrap; margin-bottom: -1px; }
  .pub-tabs a.on { color: var(--color-strong); border-bottom-color: var(--color-strong) !important; font-weight: 700; }
  .pub-row-props { margin: 0 0 22px; padding-bottom: 14px; border-bottom: 1px solid var(--color-line); }
  .pub-props { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 6px 16px; margin: 0; font-size: 14px; }
  .pub-props dt { color: var(--color-muted); }
  .pub-props dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .pub-empty { color: var(--color-faint); }
  .pub-fold { margin-top: 8px; }
  .pub-fold summary { color: var(--color-muted); font-weight: 400; font-size: 13px; cursor: pointer; margin-bottom: 6px; }
`;

type Loaded = { data: PublishedPage; emoji: Map<string, string>; files: Map<string, string> };

async function load(token: string, pageId: string | null): Promise<Loaded | null> {
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
  // Files in the databases' values: signed for the visitor, an hour long.
  const files = new Map<string, string>();
  const paths = publicFilePaths(data.databases ?? [], rowOf(data)).slice(0, 500);
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from("page-images")
      .createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) files.set(s.path, s.signedUrl);
  }
  return { data, emoji, files };
}

/** The page being read, as a row (its own values), when it is one. */
function rowOf(data: PublishedPage): PublicRow | null {
  const p = data.page;
  if (!p.database_id) return null;
  return {
    id: p.id,
    title: p.title,
    icon: p.icon,
    props: p.props ?? {},
    row_number: p.row_number ?? null,
    created_at: p.created_at ?? null,
    created_by: p.created_by ?? null,
    edited_at: p.edited_at,
    edited_by: p.edited_by ?? null,
    verified_at: p.verified_at ?? null,
    verified_by: p.verified_by ?? null,
    database_id: p.database_id,
  };
}

function render(
  loaded: Loaded,
  token: string,
  viewId: string | null,
  month: string | null,
): string {
  const { data } = loaded;
  const extra = rowOf(data);
  const ctx = makePublicDbCtx({
    token,
    root: data.root,
    pageId: data.page.id,
    viewId,
    month,
    databases: data.databases ?? [],
    people: data.people ?? [],
    staleDays: data.stale_days ?? 30,
    extra,
    fileUrls: loaded.files,
  });
  return publicPageHtml(data, token, loaded.emoji, documentFontFaceCss() + FRAME_CSS, {
    inline: (view) => inlineDatabaseHtml(ctx, view),
    page: () => databasePageHtml(ctx, data.page.id),
    rowProps: () =>
      extra ? rowPropertiesHtml(ctx, ctx.idx.byId.get(extra.id) ?? toListItem(extra)) : "",
  });
}

export function PublicPage({
  token,
  pageId,
  viewId = null,
  month = null,
}: {
  token: string;
  pageId: string | null;
  viewId?: string | null;
  month?: string | null;
}) {
  const navigate = useNavigate();
  /** Another page of this link (or another view or month of this one): in
   *  the app, without reloading it. */
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** Where the page was scrolled, kept when only its view or month changes. */
  const keepScroll = useRef<number | null>(null);
  const go = (href: string) => {
    const u = new URL(href, window.location.origin);
    keepScroll.current =
      (u.searchParams.get("p") ?? null) === pageId
        ? (frameRef.current?.contentWindow?.scrollY ?? null)
        : null;
    const search: { p?: string; v?: string; m?: string } = {};
    for (const k of ["p", "v", "m"] as const) {
      const v = u.searchParams.get(k);
      if (v) search[k] = v;
    }
    void navigate({ to: "/s/$token", params: { token }, search });
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
    if (keepScroll.current !== null) {
      frame.contentWindow?.scrollTo(0, keepScroll.current);
      keepScroll.current = null;
    }
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
    queryFn: () => load(token, pageId),
    // Signed links last an hour.
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const loaded = q.data ?? null;
  // Another view or month redraws the page from what's already here.
  const built = useMemo(
    () => (loaded ? { data: loaded.data, html: render(loaded, token, viewId, month) } : null),
    [loaded, token, viewId, month],
  );
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
        ref={frameRef}
        onLoad={(e) => onFrameLoad(e.currentTarget)}
        className="w-full flex-1 border-0"
        style={{ minHeight: "calc(100vh - 49px)" }}
      />
    </div>
  );
}
