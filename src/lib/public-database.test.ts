import { describe, expect, it } from "vitest";
import {
  databasePageHtml,
  inlineDatabaseHtml,
  makePublicDbCtx,
  publicFilePaths,
  publicHref,
  rowPropertiesHtml,
  type PublicDatabase,
  type PublicDef,
} from "./public-database";
import { publicPageHtml } from "./public-page";
import type { PublishedPage } from "./public-links";

const NOW = new Date(2026, 10, 5, 12, 0, 0);
const ME = "11111111-1111-1111-1111-111111111111";

const defs: PublicDef[] = [
  {
    key: "tstatus",
    label: "Status",
    type: "status",
    position: 0,
    options: [
      { value: "todo", label: "To do", tint: "sunken", ink: "secondary" },
      { value: "done", label: "Done", tint: "accentTint", ink: "accent" },
    ],
  },
  { key: "towner", label: "Owner", type: "person", position: 1 },
  { key: "tcost", label: "Cost", type: "number", position: 2, config: { format: "currency" } },
  { key: "tdue", label: "Due", type: "date", position: 3 },
  { key: "tlink", label: "Link", type: "relation", position: 4, config: { database_id: "dbE" } },
  { key: "tsite", label: "Site", type: "url", position: 5 },
  { key: "tok", label: "OK", type: "checkbox", position: 6 },
  { key: "tfiles", label: "Files", type: "files", position: 7 },
  {
    key: "tcount",
    label: "Linked",
    type: "rollup",
    position: 8,
    config: { relation: "tlink", target: "title", calc: "count_all" },
  },
];

const tasks: PublicDatabase = {
  id: "dbT",
  title: "Tasks",
  icon: "✅",
  mode: "here",
  rows_open: true,
  page_layout: null,
  properties: defs,
  row_count: 3,
  views: [
    { id: "v1", name: "All", layout: "table", filter: [], sort: [], config: {}, group_by: null },
    {
      id: "v2",
      name: "Board",
      layout: "board",
      filter: [],
      sort: [],
      config: {},
      group_by: "tstatus",
    },
  ],
  rows: [
    {
      id: "r1",
      title: "Write <the> brief",
      icon: null,
      position: 0,
      database_id: "dbT",
      props: {
        tstatus: "todo",
        towner: [ME],
        tcost: 12450000,
        tdue: "2026-11-10",
        tlink: ["e1", "secret"],
        tsite: "javascript:alert(1)",
        tok: true,
        tfiles: [
          { path: "ws/r1/files/a.pdf", name: "Brief.pdf", size: 1, mime: "application/pdf" },
        ],
      },
    },
    {
      id: "r2",
      title: "Ship",
      icon: "🚀",
      position: 1,
      database_id: "dbT",
      props: { tstatus: "done", tdue: "2026-11-12/2026-11-13" },
    },
    { id: "r3", title: "Unsorted", icon: null, position: 2, database_id: "dbT", props: {} },
  ],
};

const elsewhere: PublicDatabase = {
  id: "dbE",
  title: "Partners",
  icon: null,
  mode: "related",
  rows_open: false,
  page_layout: null,
  properties: [],
  row_count: 1,
  views: [],
  rows: [{ id: "e1", title: "Acme", icon: null, database_id: "dbE", props: {} }],
};

const ctxFor = (over: Partial<Parameters<typeof makePublicDbCtx>[0]> = {}) =>
  makePublicDbCtx({
    token: "tok",
    root: "root",
    pageId: "root",
    databases: [tasks, elsewhere],
    people: [{ id: ME, name: "Nina Patel", tint: "accentTint", ink: null }],
    staleDays: 30,
    fileUrls: new Map([["ws/r1/files/a.pdf", "https://signed.example/a.pdf"]]),
    now: NOW,
    ...over,
  });

describe("public databases: a table", () => {
  const html = inlineDatabaseHtml(ctxFor(), {
    database_id: "dbT",
    name: "",
    layout: "table",
    filter: [],
    sort: { prop: "manual", dir: "asc" },
    config: {
      props: ["tstatus", "towner", "tcost", "tdue", "tlink", "tsite", "tok", "tfiles", "tcount"],
      freeze: "tstatus",
      calcs: { tcost: "sum", title: "count_all" },
    },
  });

  it("names the database and escapes titles", () => {
    expect(html).toContain("Tasks");
    expect(html).toContain("Write &lt;the&gt; brief");
    expect(html).not.toContain("<the>");
  });

  it("reads values as the app writes them", () => {
    expect(html).toContain("To do");
    expect(html).toContain("var(--color-accentTint)"); // the Done chip
    expect(html).toContain("Nina Patel");
    expect(html).not.toContain("@");
    expect(html).toContain("$12,450,000.00");
    expect(html).toContain("Nov 10");
    expect(html).toContain("Nov 12 → 13");
    expect(html).toContain('aria-label="Checked"');
  });

  it("shows related pages the visitor may see, and Private page for the rest", () => {
    expect(html).toContain("Acme");
    expect(html).toContain("Private page");
    // The rollup counts only what's public.
    expect(html).toMatch(/<td[^>]*>1<\/td>/);
  });

  it("links rows that open, never an unsafe address, files by their signed link", () => {
    expect(html).toContain(`href="${publicHref("tok", "r1", "root")}"`);
    // Shown as words, never as a link.
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://signed.example/a.pdf"');
  });

  it("freezes columns and writes the Calculate row", () => {
    expect(html).toContain('class="pub-frozen" style="left:300px"');
    expect(html).toContain("Sum");
    expect(html).toContain("$12,450,000.00");
    expect(html).toContain("Count");
  });

  it("doesn't link rows that don't open from this link", () => {
    const closed = inlineDatabaseHtml(
      ctxFor({ databases: [{ ...tasks, rows_open: false }, elsewhere] }),
      { database_id: "dbT", layout: "table" },
    );
    expect(closed).not.toContain("?p=r1");
  });
});

describe("public databases: filters, layouts, notes", () => {
  it("matches nothing on a filter that names me", () => {
    const html = inlineDatabaseHtml(ctxFor(), {
      database_id: "dbT",
      layout: "table",
      filter: [{ op: "is_me", prop: "towner" }],
    });
    expect(html).toContain("No rows match this view.");
    expect(html).not.toContain("Write");
  });

  it("puts a board's rows in their option's column, and the rest under No Status", () => {
    const html = inlineDatabaseHtml(ctxFor(), {
      database_id: "dbT",
      layout: "board",
      group_by: "tstatus",
    });
    const cols = [...html.matchAll(/<section class="pub-col" aria-label="([^"]+)">/g)].map(
      (m) => m[1],
    );
    expect(cols).toEqual(["To do", "Done", "No Status"]);
    expect(html.indexOf("Unsorted")).toBeGreaterThan(html.indexOf("No Status"));
  });

  it("lists rows", () => {
    const html = inlineDatabaseHtml(ctxFor(), { database_id: "dbT", layout: "list" });
    expect(html).toContain('<ul class="pub-list">');
    expect(html).toContain("Ship");
  });

  it("places rows on a calendar month, ranges on every day, with month links", () => {
    const html = inlineDatabaseHtml(ctxFor({ month: "2026-11" }), {
      database_id: "dbT",
      layout: "calendar",
      group_by: "tdue",
    });
    expect(html).toContain("November 2026");
    expect((html.match(/Ship/g) ?? []).length).toBe(2);
    expect(html).toContain('href="/s/tok?m=2026-10"');
    expect(html).toContain('href="/s/tok?m=2026-12"');
  });

  it("says when a database isn't public", () => {
    expect(inlineDatabaseHtml(ctxFor(), { database_id: "nope" })).toContain(
      "This database isn’t public.",
    );
    // A relation's target came along for its titles only.
    expect(inlineDatabaseHtml(ctxFor(), { database_id: "dbE" })).toContain(
      "This database isn’t public.",
    );
  });

  it("says when only the first rows came", () => {
    const html = inlineDatabaseHtml(
      ctxFor({ databases: [{ ...tasks, row_count: 4200 }, elsewhere] }),
      {
        database_id: "dbT",
      },
    );
    expect(html).toContain("Showing the first 3 of 4,200 rows.");
  });
});

describe("public databases: a database page and a row page", () => {
  it("shows the shared views as tabs, the picked one drawn", () => {
    const first = databasePageHtml(ctxFor({ pageId: "dbT" }), "dbT");
    expect(first).toContain('<nav class="pub-tabs"');
    expect(first).toContain('class="pub-table"');
    expect(first).toContain(`href="/s/tok?p=dbT&amp;v=v2"`);
    const board = databasePageHtml(ctxFor({ pageId: "dbT", viewId: "v2" }), "dbT");
    expect(board).toContain('class="pub-board"');
    expect(board).toMatch(/aria-current="page">Board/);
  });

  it("writes a row's properties, the rest folded", () => {
    const ctx = ctxFor({ pageId: "r1" });
    const full = rowPropertiesHtml(ctx, ctx.idx.byId.get("r1")!);
    expect(full).toContain("<dt>Status</dt>");
    expect(full).toContain("Brief.pdf");
    // An empty row: the first three always, the rest wait in the fold.
    const empty = rowPropertiesHtml(ctx, ctx.idx.byId.get("r3")!);
    expect(empty.indexOf("<dt>Cost</dt>")).toBeLessThan(empty.indexOf("<summary>"));
    expect(empty).toContain("5 more properties</summary>");
  });

  it("lists the files to sign, not those of a related database", () => {
    expect(publicFilePaths([tasks, elsewhere])).toEqual(["ws/r1/files/a.pdf"]);
  });

  it("puts the databases into the page's document", () => {
    const data: PublishedPage = {
      workspace: "W",
      root: "root",
      page: {
        id: "root",
        title: "Plan",
        icon: null,
        is_database: false,
        edited_at: null,
        blocks: [
          { id: "a", type: "text", text: "Before" },
          {
            id: "t",
            type: "toggle",
            text: "More",
            open: true,
            children: [{ id: "v", type: "view", view: { database_id: "dbT", layout: "list" } }],
          },
        ],
      },
      path: [],
      children: [],
      mentioned: [],
      emoji: [],
    };
    const ctx = ctxFor();
    const html = publicPageHtml(data, "tok", new Map(), "", {
      inline: (v) => inlineDatabaseHtml(ctx, v),
      page: () => "",
      rowProps: () => "",
    });
    expect(html).toContain("Before");
    expect(html).toContain('<ul class="pub-list">');
    expect(html).not.toContain("GIOPUBDB");
  });
});
