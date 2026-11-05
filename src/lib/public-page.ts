import { toPreviewHtml } from "./export";
import type { Block } from "./types";
import type { PublishedPage } from "./public-links";
import { publicHref } from "./public-database";

export { publicHref };

/* A published page as a visitor sees it (2026-11-05): the page's own
 * document, as page history previews it (export.ts, the app's fonts),
 * with the pages inside it listed at the end. Read only: it shows in a
 * sandboxed frame that runs no scripts. Databases (public-database.ts)
 * take the places of the views placed on the page; a database page is its
 * views; a row page starts with its properties. Pure. */

const DATABASE_NOTE = "A database is here. Databases aren’t shown on public pages yet.";

/** What draws the databases (public-database.ts, with the link's data). */
export type PublicDatabases = {
  /** A view block's stored view. */
  inline: (view: unknown) => string;
  /** The page itself, when it's a database. */
  page: () => string;
  /** The page's properties, when it's a row. */
  rowProps: () => string;
};

const marker = (i: number) => `GIOPUBDB${i}X`;

/** The page's blocks with each view replaced by a marker the database's
 *  HTML takes the place of (or, without `views`, by a short note). */
export function publicBlocks(blocks: readonly Block[], views?: unknown[]): Block[] {
  return blocks.map((b) => {
    if (b.type === "view") {
      if (!views) return { id: b.id, type: "callout", icon: "🗂️", text: DATABASE_NOTE } as Block;
      views.push((b as Block & { view?: unknown }).view);
      return { id: b.id, type: "text", text: marker(views.length - 1) } as Block;
    }
    const out = { ...b } as Block & { children?: Block[]; cols?: Block[][] };
    if (Array.isArray(out.children)) out.children = publicBlocks(out.children, views);
    if (Array.isArray(out.cols)) out.cols = out.cols.map((c) => publicBlocks(c, views));
    return out;
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The document a visitor reads. */
export function publicPageHtml(
  data: PublishedPage,
  token: string,
  emoji: ReadonlyMap<string, string>,
  fontCss: string,
  dbs?: PublicDatabases,
): string {
  const views: unknown[] = [];
  const isDb = data.page.is_database;
  const blocks = isDb
    ? dbs
      ? ([{ id: "db", type: "text", text: marker(0) }] as Block[])
      : ([{ id: "db-note", type: "callout", icon: "🗂️", text: DATABASE_NOTE }] as Block[])
    : publicBlocks((data.page.blocks ?? []) as Block[], dbs ? views : undefined);
  let html = toPreviewHtml(
    { title: data.page.title || "Untitled", icon: data.page.icon, blocks, emoji },
    fontCss,
  );
  // Links in the page open in a new tab; the pages inside it open here.
  html = html.replace("<head>", () => `<head>\n<base target="_blank"/>`);
  if (dbs) {
    // Each marker is a paragraph of its own; the database takes its place.
    html = html.replace(/<p>GIOPUBDB(\d+)X<\/p>/g, (_, n: string) =>
      isDb ? dbs.page() : dbs.inline(views[Number(n)]),
    );
    if (isDb) html = html.replace("<body>", () => `<body class="pub-wide">`);
    if (data.page.database_id) {
      const props = dbs.rowProps();
      if (props) html = html.replace("<main>", () => `${props}\n<main>`);
    }
  }
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
