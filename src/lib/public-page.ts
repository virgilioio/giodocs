import { toPreviewHtml } from "./export";
import type { Block } from "./types";
import type { PublishedPage } from "./public-links";

/* A published page as a visitor sees it (2026-11-05): the page's own
 * document, as page history previews it (export.ts, the app's fonts),
 * with the pages inside it listed at the end. Read only: it shows in a
 * sandboxed frame that runs no scripts. Pure. */

const DATABASE_NOTE = "A database is here. Databases aren’t shown on public pages yet.";

/** Inline databases can't show on a public page yet: a short note takes
 *  each one's place (an export leaves them out silently). */
export function publicBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map((b) => {
    if (b.type === "view")
      return { id: b.id, type: "callout", icon: "🗂️", text: DATABASE_NOTE } as Block;
    const out = { ...b } as Block & { children?: Block[]; cols?: Block[][] };
    if (Array.isArray(out.children)) out.children = publicBlocks(out.children);
    if (Array.isArray(out.cols)) out.cols = out.cols.map((c) => publicBlocks(c));
    return out;
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The public page's address for a page this link shows. */
export function publicHref(token: string, pageId: string | null, root: string): string {
  return pageId && pageId !== root ? `/s/${token}?p=${encodeURIComponent(pageId)}` : `/s/${token}`;
}

/** The document a visitor reads. */
export function publicPageHtml(
  data: PublishedPage,
  token: string,
  emoji: ReadonlyMap<string, string>,
  fontCss: string,
): string {
  const blocks = data.page.is_database
    ? ([{ id: "db-note", type: "callout", icon: "🗂️", text: DATABASE_NOTE }] as Block[])
    : publicBlocks((data.page.blocks ?? []) as Block[]);
  let html = toPreviewHtml(
    { title: data.page.title || "Untitled", icon: data.page.icon, blocks, emoji },
    fontCss,
  );
  // Links in the page open in a new tab; the pages inside it open here.
  html = html.replace("<head>", () => `<head>\n<base target="_blank"/>`);
  if (data.children.length) {
    const items = data.children
      .map(
        (c) =>
          `<li><a target="_top" href="${esc(publicHref(token, c.id, data.root))}">${esc(c.icon ? `${c.icon} ` : "")}${esc(c.title || "Untitled")}</a></li>`,
      )
      .join("");
    html = html.replace(
      "</main>",
      () =>
        `<section class="pub-children"><h3>Pages inside</h3><ul>${items}</ul></section>\n</main>`,
    );
  }
  return html;
}
