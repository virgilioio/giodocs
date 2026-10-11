/* Importing a file into a blank page: Markdown, HTML or CSV, read in the
 * browser with the same readers as paste (markdown-import, htmlToBlocks).
 * A CSV becomes a simple table; its ⋯ menu can then turn it into a
 * database. Word and Google Docs files aren't readable here. */

import { nanoid } from "nanoid";
import { parseMarkdown, type Blk } from "./markdown-import";
import { htmlToBlocks, htmlToMarkdown } from "./html-to-markdown";

export const IMPORT_ACCEPT = ".md,.markdown,.txt,.html,.htm,.csv,text/markdown,text/html,text/csv,text/plain";

/** Largest file read (2 MB): bigger pages belong in several pages. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export type ImportResult =
  | { ok: true; title: string; blocks: Blk[]; kind: "markdown" | "html" | "csv" }
  | { ok: false; error: string };

/** The file's name without its extension, as the page title. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "").replace(/[_]+/g, " ").trim();
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks
 *  inside quotes. A semicolon file (common in Spanish locales) is read
 *  with semicolons when its first line has more of them than commas. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const kept = rows.filter((r) => r.some((x) => x.trim() !== ""));
  const width = kept.reduce((m, r) => Math.max(m, r.length), 0);
  return kept.map((r) => [...r, ...Array(width - r.length).fill("")]);
}

/** Cell text as inline source: markup characters stay literal. */
export function escapeInline(s: string): string {
  return s.replace(/[\\*_`~<>[\]()]/g, (m) => `\\${m}`);
}

export function importFile(name: string, text: string): ImportResult {
  const lower = name.toLowerCase();
  const title = titleFromFileName(name);
  if (lower.endsWith(".csv")) {
    const grid = parseCsv(text);
    if (grid.length === 0) return { ok: false, error: `"${name}" has no rows.` };
    const rows = grid.map((r) => r.map((c) => escapeInline(c.trim()).replace(/\r\n?/g, "\n")));
    return { ok: true, kind: "csv", title, blocks: [{ id: nanoid(10), type: "table", text: "", rows } as Blk] };
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    // A page whose body is in a <body>: read only that.
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(text)?.[1] ?? text;
    const blocks = htmlToBlocks(body) ?? parseMarkdown(htmlToMarkdown(body));
    if (blocks.length === 0) return { ok: false, error: `Couldn't read any content from "${name}".` };
    const htmlTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim();
    return { ok: true, kind: "html", title: htmlTitle || title, blocks };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) {
    const blocks = parseMarkdown(text);
    if (blocks.length === 0) return { ok: false, error: `"${name}" is empty.` };
    // A leading "# Title" names the page instead of repeating it.
    if (blocks[0].type === "h1" && typeof blocks[0].text === "string" && blocks[0].text.trim()) {
      return { ok: true, kind: "markdown", title: blocks[0].text.trim(), blocks: blocks.slice(1) };
    }
    return { ok: true, kind: "markdown", title, blocks };
  }
  return {
    ok: false,
    error: `Gio Docs can import Markdown, HTML and CSV files. "${name}" is none of those; save it as one first.`,
  };
}
