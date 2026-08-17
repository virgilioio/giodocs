/**
 * Page export — pure, dependency-free, entirely in-browser.
 *
 * Four helpers:
 *   slugOf   — filename slug (lowercase, non-alnum→'-', 28 char cap, "untitled" fallback)
 *   download — Blob + synthetic <a>, URL revoked after 4s
 *   toMarkdown — YAML front matter + all 12 block types
 *   toHtml   — self-contained document, every interpolation escaped
 *   printPdf — window.open + write toHtml + @page{size:paper;margin:.75in} + zoom + print
 *
 * No new dependencies. See CHUNK 5 spec §8.
 */

import type { Block } from "./types";
import { numberedOrdinals } from "./blocks";
import { columnsGridTemplatePlain, normalizeColumnWidths } from "./column-widths";
import { peekSignedUrl } from "./image-url-cache";
import { readAlign, readCols, readPaths, readW } from "./image-ops";
import { inlineToHtml } from "./inline-markdown";
import { calloutBg, calloutRing } from "./callout-color";
// Logo is inlined as a data URI so the exported HTML file is self-contained
// (zero network requests). Vite `?raw` reads the file at build time; vitest
// resolves the same way, so tests see the same string as the browser.
import GIO_DOCS_LOGO_SVG from "../../public/gio-docs-logo.svg?raw";
import { evaluateCell, format as sheetFormat } from "@/lib/sheet-engine";
import { normalizeSheet, type Cell as SheetCell, type SheetBlock as SheetBlockData } from "@/lib/sheet-model";

/* ─────────────────────────── Context ─────────────────────────── */

export type ExportContext = {
  title: string;
  area?: string | null;
  status?: string | null;
  ownerName?: string | null;
  tags?: readonly string[];
  verifiedAt?: string | null;
  blocks: readonly Block[];
  /** When false, omit YAML front matter (Markdown) and the properties/header
   * block (HTML/PDF). Title always stays. Default: true. */
  includeDetails?: boolean;
  /** Optional workspace name shown beside the Gio Docs mark in the HTML/PDF
   * masthead. Omitted lines just render the mark. */
  workspaceName?: string | null;
};

/* ─────────────────────────── Logo (inlined) ─────────────────────────── */

// Base64 SVG data URI, computed once. `btoa` is available in browsers and
// jsdom. The base64 payload does not contain the string "http://" or
// "https://" (URLs inside the SVG are inside the encoded blob), so the
// self-containment assertion in tests survives the inline.
const GIO_DOCS_LOGO_DATA_URI = (() => {
  try {
    // Recolour the wordmark to the footer meta tone (#767B89) so it reads
    // as a mark, not a logo lockup, at footer scale. Source SVG fills the
    // glyphs as #0d0d09 / #000000; we swap them in the raw string BEFORE
    // encoding so the data URI itself carries the tinted colours (no CSS
    // filter, no external ref). The self-containment invariant holds:
    // still no http/https/script tokens outside the base64 blob.
    const tinted = GIO_DOCS_LOGO_SVG
      .replace(/#0d0d09/gi, "#767B89")
      .replace(/#000000/gi, "#767B89");
    // deno-lint-ignore no-explicit-any
    const b64 = typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(tinted)))
      : (typeof Buffer !== "undefined"
        ? Buffer.from(tinted, "utf8").toString("base64")
        : "");
    return `data:image/svg+xml;base64,${b64}`;
  } catch {
    return "";
  }
})();

/* ─────────────────────────── slugOf ─────────────────────────── */

export function slugOf(title: string | null | undefined): string {
  const raw = (title ?? "").toLowerCase().normalize("NFKD");
  const collapsed = raw
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = collapsed.slice(0, 28).replace(/-+$/g, "");
  return trimmed || "untitled";
}

/* ─────────────────────────── download ─────────────────────────── */

export function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ─────────────────────────── helpers ─────────────────────────── */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function yamlString(v: string): string {
  // Quote if contains any character that would confuse a minimal parser.
  if (/[:#\-?&*!|>%@`{}[\],\n"']/.test(v) || v !== v.trim() || v === "") {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

function verifiedDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function blockText(b: Block): string {
  return typeof b.text === "string" ? b.text : "";
}

/* Warn once per distinct unknown block type across both serialisers, so a
 * 20-block page logs at most one line per type. Data outlives the code
 * that wrote it — degrade rather than crash. */
const _warnedUnknownBlocks = new Set<string>();
function warnUnknownBlock(t: string): void {
  if (_warnedUnknownBlocks.has(t)) return;
  _warnedUnknownBlocks.add(t);
  console.warn(`[export] unknown block type "${t}" — exported as plain text`);
}


/* ─── Sheet helpers. Export shows COMPUTED values, never formulas: what you
 * see on screen is what leaves the building. Evaluation goes through the one
 * engine, and nothing is cached. ─── */

function sheetGrid(
  b: Block,
): { values: string[][]; cells: (SheetCell | null)[][] } | null {
  const raw = b as unknown as Partial<SheetBlockData>;
  if (!Array.isArray(raw.cells) || raw.cells.length === 0) return null;
  const sheet = normalizeSheet(raw);
  const values = sheet.cells.map((row, r) =>
    row.map((cell, c) => sheetFormat(evaluateCell(sheet.cells, r, c), cell?.f ?? "text", cell?.d)),
  );
  // A sheet with nothing in it exports as nothing.
  if (!values.some((row) => row.some((v) => v !== ""))) return null;
  return { values, cells: sheet.cells };
}

function sheetAlign(
  cells: (SheetCell | null)[][],
  c: number,
  values: string[][],
): "left" | "center" | "right" {
  for (let r = 0; r < cells.length; r++) {
    const a = cells[r]?.[c]?.a;
    if (a) return a;
  }
  // No explicit alignment: numbers right, text left — same default as screen.
  const numeric = values.some((row) => {
    const v = row[c];
    return v !== "" && /^-?[$]?[\d,]+(\.\d+)?%?$/.test(v);
  });
  return numeric ? "right" : "left";
}

/* ─────────────────────────── blockToMarkdown ───────────────────────────
 *
 * Per-block Markdown serialisation, extracted so the block-selection
 * copy path can reuse the exact same output the file exporter emits.
 * Return value is the block's content with NO trailing newline;
 * toMarkdown joins blocks with a blank line between them.
 *
 * `ordinal` is the true position in a run of consecutive numbered blocks
 * (see numberedOrdinals). It only affects the "numbered" case; defaults
 * to 1 for standalone callers.
 */
export function blockToMarkdown(b: Block, ordinal = 1): string {
  const t = (b.type ?? "text") as string;
  const text = blockText(b);
  // Leading whitespace to emit for a list-like block at its indent level.
  // 2 spaces per level is what parseMarkdown reads back, so this round-trips.
  const indent = typeof (b as { indent?: unknown }).indent === "number"
    ? Math.max(0, Math.min(6, Math.floor((b as { indent?: number }).indent as number)))
    : 0;
  const pad = "  ".repeat(indent);
  switch (t) {
    case "text":
      // Indent on `text` is only meaningful when a text block is embedded
      // inside a list (e.g. wrapped-paragraph continuation). We prefix pad
      // for consistency; a bare paragraph with no indent has pad === "".
      return pad + text;
    case "h1":
      return `# ${text}`;
    case "h2":
      return `## ${text}`;
    case "h3":
      return `### ${text}`;
    case "caption":
      // Markdown has no "caption" form. Emit as a plain paragraph. This is
      // deliberately LOSSY on round-trip: a caption becomes a `text` block
      // coming back through parseMarkdown. Do NOT invent a marker; the
      // structured HTML importer is the only path that preserves it.
      // Same pragma as the `columns` and `callout` (colour) cases below —
      // three attributes Markdown cannot carry. Don't "fix" it later.
      return text;
    case "bullet":
      return `${pad}- ${text}`;
    case "numbered":
      return `${pad}${ordinal}. ${text}`;
    case "todo":
      return `${pad}- [${b.checked ? "x" : " "}] ${text}`;
    case "toggle": {
      const body = typeof b.body === "string" ? b.body : "";
      // Levelled toggle: emit summary at heading depth then body. Plain
      // toggle: keep today's `**text**` + indented body output.
      const level = typeof b.level === "string" ? (b.level as string) : "text";
      if (level === "h1" || level === "h2" || level === "h3") {
        const hash = level === "h1" ? "#" : level === "h2" ? "##" : "###";
        if (!body) return `${hash} ${text}`;
        return `${hash} ${text}\n\n${body}`;
      }
      if (!body) return `**${text}**`;
      const indented = body.split("\n").map((line) => `  ${line}`).join("\n");
      return `**${text}**\n${indented}`;
    }
    case "quote":
      return `> ${text}`;
    case "callout": {
      const icon =
        typeof b.icon === "string" && b.icon ? (b.icon as string) : "💡";
      // A stored `color` is intentionally dropped here — see the note on
      // the `caption` case for the same lossy pragma. HTML/PDF carry it
      // via an inline background style in blockHtml.
      const kids = Array.isArray((b as { children?: unknown }).children)
        ? ((b as { children: Block[] }).children as Block[])
        : null;
      if (!kids || kids.length === 0) {
        // Legacy single-line form. Round-trips through parseMarkdown as
        // `type:'callout' text:<text>`.
        return `> ${icon} ${text}`;
      }
      // Multi-child form: emit as a `>`-prefixed blockquote block. First
      // line carries the emoji so the callout signal is preserved; each
      // subsequent line is a child block's markdown, itself possibly
      // multi-line (code, table), with `> ` prefixed to every line.
      //
      // ROUND-TRIP HONESTY: the reader in markdown-import.ts is
      // intentionally NOT extended to reconstruct this back into a
      // multi-child callout — the ambiguity against ordinary consecutive
      // quote lines would silently turn a user's quote into a callout,
      // exactly the failure the task rules out. So a two-child callout
      // written by this branch comes back through parseMarkdown as a
      // single-child callout (from the first `> {icon}` line) followed
      // by N `quote` blocks — a documented import loss alongside
      // caption, columns, and callout colour. HTML export is lossless.
      const kidOrds = numberedOrdinals(kids);
      const kidLines = kids.map((k) =>
        blockToMarkdown(k, (k.id && kidOrds.get(k.id)) || 1),
      );
      const firstLine = `> ${icon}`;
      const bodyLines = kidLines
        .map((s) => s.split("\n").map((ln) => `> ${ln}`.replace(/\s+$/, "")).join("\n"))
        .join("\n");
      return `${firstLine}\n${bodyLines}`;
    }
    // Images export as their SIGNED URL, resolved from the cache the
    // editor already filled. Exports are snapshots — an unresolved path
    // is skipped rather than written as a dead relative link.
    case "image": {
      const src = peekSignedUrl((b as { path?: string }).path);
      if (!src) return "";
      const cap = String((b as { cap?: string }).cap ?? "");
      const alt = String((b as { alt?: string }).alt ?? "") || cap;
      const img = `![${alt}](${src})`;
      return cap ? `${img}\n*${cap}*` : img;
    }
    // A file exports as a REAL LINK, so an exported page still reaches the
    // document rather than merely naming it. No emoji prefix. An empty
    // file block exports as NOTHING — no placeholder line.
    case "file": {
      const name = String((b as { fname?: string }).fname ?? "");
      const src = peekSignedUrl((b as { path?: string }).path);
      if (!name || !src) return "";
      return `[${name}](${src})`;
    }
    case "imagerow": {
      const cap = String((b as { cap?: string }).cap ?? "");
      const imgs = readPaths(b)
        .map((p) => peekSignedUrl(p))
        .filter(Boolean)
        .map((src) => `![${cap}](${src})`)
        .join(" ");
      if (!imgs) return "";
      return cap ? `${imgs}\n*${cap}*` : imgs;
    }
    case "divider":
      return "---";
    case "code": {
      const lang = typeof b.lang === "string" ? (b.lang as string) : "";
      return "```" + lang + "\n" + text + "\n```";
    }
    case "table": {
      const rows = Array.isArray(b.rows)
        ? (b.rows as unknown[][]).map((r) =>
            Array.isArray(r) ? r.map((c) => String(c ?? "")) : [],
          )
        : [];
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const padded = rows.map((r) => {
        const copy = r.slice();
        while (copy.length < width) copy.push("");
        // A literal "|" would end the cell and a newline would end the
        // table, so both are neutralised here. Cell text is otherwise
        // already markdown and passes through untouched.
        return copy.map((c) =>
          c.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " "),
        );
      });
      // Per-column alignment survives via the GFM pipe-table separator row:
      //   left ":---"   center ":---:"   right "---:"   default "---".
      const alignArr = Array.isArray(b.align) ? (b.align as unknown[]) : [];
      const sep = padded[0].map((_, i) => {
        const a = alignArr[i];
        if (a === "center") return ":---:";
        if (a === "right") return "---:";
        if (a === "left") return ":---";
        return "---";
      });
      // A GFM table always needs a header line; when the block has its
      // header row turned off we emit an EMPTY one so every data row is
      // still a data row rather than being silently promoted.
      const headerRow = (b as { headerRow?: unknown }).headerRow !== false;
      const lines: string[] = [];
      lines.push(
        `| ${(headerRow ? padded[0] : padded[0].map(() => "")).join(" | ")} |`,
      );
      lines.push(`| ${sep.join(" | ")} |`);
      for (let i = headerRow ? 1 : 0; i < padded.length; i++) {
        lines.push(`| ${padded[i].join(" | ")} |`);
      }
      return lines.join("\n");
    }
    case "sheet": {
      // DELIBERATE DIVERGENCE from the screen: on screen a text value
      // overflows its empty neighbours (Excel's rule, sheet-overflow.ts);
      // on paper the exported <table> WRAPS instead. Paper has no scroll
      // and no tooltip, so a run that clipped would lose content for good.
      // Do not "fix" this to match the screen.
      const g = sheetGrid(b);
      if (!g) return "";
      const { values, cells } = g;
      const width = values[0].length;
      const cell = (s: string) =>
        s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
      const frozen = (b as { freeze?: unknown }).freeze === true;
      // Alignment survives via the GFM separator row; numbers default right.
      const sep = values[0].map((_, i) => {
        const a = sheetAlign(cells, i, values);
        if (a === "center") return ":---:";
        if (a === "right") return "---:";
        return ":---";
      });
      const lines: string[] = [];
      // A GFM table always needs a header line. When the sheet is frozen the
      // first row IS the header and reads bold; otherwise the header line is
      // empty so no data row is silently promoted.
      const head = frozen
        ? values[0].map((v) => (v ? `**${cell(v)}**` : ""))
        : new Array(width).fill("");
      lines.push(`| ${head.join(" | ")} |`);
      lines.push(`| ${sep.join(" | ")} |`);
      for (let r = frozen ? 1 : 0; r < values.length; r++) {
        lines.push(`| ${values[r].map(cell).join(" | ")} |`);
      }
      return lines.join("\n");
    }
    case "columns": {
      // Markdown has no columns. Flatten deterministically — each column's
      // blocks in order, blank line between blocks, blank line between
      // columns. Round-trip is intentionally lossy: columns become stacked
      // blocks. Do NOT invent a marker; parseMarkdown must not resurrect
      // columns from plain text.
      const cols = Array.isArray(b.cols) ? (b.cols as Block[][]) : [];
      const perCol = cols.map((col) => {
        if (!Array.isArray(col)) return "";
        const ords = numberedOrdinals(col);
        return col
          .map((inner) => blockToMarkdown(inner, (inner.id && ords.get(inner.id)) || 1))
          .filter((s) => s.length > 0)
          .join("\n\n");
      });
      return perCol.filter((s) => s.length > 0).join("\n\n");
    }
    default:
      warnUnknownBlock(t);
      return text;
  }
}


/* ─────────────────────────── toMarkdown ─────────────────────────── */

export function toMarkdown(ctx: ExportContext): string {
  const includeDetails = ctx.includeDetails !== false;
  const ords = numberedOrdinals(ctx.blocks);
  const bodies = ctx.blocks.map((b) =>
    blockToMarkdown(b, (b.id && ords.get(b.id)) || 1),
  );
  const body = bodies.map((s) => s + "\n").join("\n");

  if (!includeDetails) {
    // No front matter. Title becomes an H1 at the top so the file still
    // opens with a heading — mirrors what the HTML export does.
    return `# ${ctx.title || "Untitled"}\n\n` + body;
  }

  const front: string[] = ["---"];
  front.push(`title: ${yamlString(ctx.title || "Untitled")}`);
  if (ctx.area) front.push(`area: ${yamlString(ctx.area)}`);
  if (ctx.status) front.push(`status: ${yamlString(ctx.status)}`);
  if (ctx.ownerName) front.push(`owner: ${yamlString(ctx.ownerName)}`);
  if (ctx.tags && ctx.tags.length) {
    front.push(`tags: [${ctx.tags.map((t) => yamlString(t)).join(", ")}]`);
  }
  const vd = verifiedDate(ctx.verifiedAt);
  if (vd) front.push(`verified: ${vd}`);
  front.push("---", "");

  return front.join("\n") + body;
}


/* ─────────────────────────── toHtml ─────────────────────────── */

/** A row whose cells hold this much plain text is treated as long-form and
 *  allowed to split across pages. 600 chars approximates a third of a
 *  printable page — a heuristic, not a measurement: CSS cannot express
 *  "keep short rows together but let paragraph rows break", so the decision
 *  is made here at generation time. */
const TALL_ROW_CHARS = 600;

/** `<tr>` open tag, tagged `class="tall"` when the row is long-form. */
function trOpen(cells: readonly (string | number | null | undefined)[]): string {
  let n = 0;
  for (const c of cells) n += String(c ?? "").length;
  return n > TALL_ROW_CHARS ? `<tr class="tall">` : "<tr>";
}

function blockHtml(b: Block, ordinal = 1): string {

  const t = (b.type ?? "text") as string;
  const text = blockText(b);
  // Inline markdown (bold, italic, code, links, …) inside text-carrying
  // positions is converted to HTML via inlineToHtml, which escapes user
  // text FIRST and then inserts tags. Escaping is never bypassed.
  // Custom emoji become their shortcode text in exported HTML. An
  // exported file must open with ZERO external requests, and a signed
  // storage URL 404s within the hour — so ":brand:" is emitted verbatim
  // and listed as a documented loss alongside caption and columns.
  const inline = (s: string) => inlineToHtml(s, { emojiAs: "alt" });
  switch (t) {
    case "text":
      return `<p>${inline(text)}</p>`;
    case "caption":
      // Muted styling comes from the `.caption` rule in HTML_CSS below.
      return `<p class="caption">${inline(text)}</p>`;
    case "h1":
      // Demote by one level so the exported page keeps a single <h1>
      // (the page title). h1 → h2, h2 → h3, h3 → h4.
      return `<h2>${inline(text)}</h2>`;
    case "h2":
      return `<h3>${inline(text)}</h3>`;
    case "h3":
      return `<h4>${inline(text)}</h4>`;
    case "bullet":
    case "numbered":
    case "todo":
      // Runs of consecutive list-like blocks are emitted by `renderListRun`
      // inside toHtml so they nest into real <ul>/<ol>. If we ever end up
      // here (e.g. a solitary list block reached through some other path),
      // fall back to a flat single-item list so nothing is lost.
      return t === "numbered"
        ? `<ol${ordinal > 1 ? ` start="${ordinal}"` : ""}><li>${inline(text)}</li></ol>`
        : t === "todo"
          ? `<p class="todo"><input type="checkbox" disabled${
              b.checked ? " checked" : ""
            }/> <span${b.checked ? ' class="done"' : ""}>${inline(text)}</span></p>`
          : `<ul><li>${inline(text)}</li></ul>`;
    case "toggle": {
      const body = typeof b.body === "string" ? b.body : "";
      const level = typeof b.level === "string" ? (b.level as string) : "text";
      // Levelled toggle: wrap the summary in the demoted heading tag,
      // matching the one-level demotion applied to standalone headings.
      const summaryInner =
        level === "h1"
          ? `<h2>${inline(text)}</h2>`
          : level === "h2"
            ? `<h3>${inline(text)}</h3>`
            : level === "h3"
              ? `<h4>${inline(text)}</h4>`
              : inline(text);
      return `<details${b.open ? " open" : ""}><summary>${summaryInner}</summary>${
        body ? `<p>${inline(body)}</p>` : ""
      }</details>`;
    }
    case "quote":
      return `<blockquote>${inline(text)}</blockquote>`;
    case "callout": {
      const icon =
        typeof b.icon === "string" && b.icon ? (b.icon as string) : "💡";
      // Callout colour survives to HTML/PDF as an inline background style
      // pulled from the same token as the on-screen render. Markdown has
      // no equivalent — the round-trip loss is documented in blockToMarkdown
      // alongside caption and columns.
      const bg = calloutBg((b as { color?: unknown }).color);
      const ring = calloutRing((b as { color?: unknown }).color);
      const style = `background:${bg};border:1px solid ${ring}`;
      const kids = Array.isArray((b as { children?: unknown }).children)
        ? ((b as { children: Block[] }).children as Block[])
        : null;
      if (!kids || kids.length === 0) {
        return `<aside style="${style}"><span class="ico">${esc(icon)}</span><span>${inline(
          text,
        )}</span></aside>`;
      }
      const kidOrds = numberedOrdinals(kids);
      const kidHtml = kids.map((k) => blockHtml(k, (k.id && kidOrds.get(k.id)) || 1)).join("\n");
      return `<aside style="${style}"><span class="ico">${esc(icon)}</span><div class="callout-body">${kidHtml}</div></aside>`;

    }

    case "image": {
      const src = peekSignedUrl((b as { path?: string }).path);
      if (!src) return "";
      const cap = String((b as { cap?: string }).cap ?? "");
      const alt = String((b as { alt?: string }).alt ?? "") || cap;
      const w = readW(b);
      const align = readAlign(b);
      const wrap =
        align === "left"
          ? "margin:14px 0;"
          : align === "right"
            ? "margin:14px 0 14px auto;"
            : "margin:14px auto;";
      const width = align === "full" ? "100%" : `${w}%`;
      return `<figure style="${wrap}width:${width};max-width:100%"><img src="${esc(
        src,
      )}" alt="${esc(alt)}" style="width:100%;height:auto;border-radius:9px"/>${
        cap ? `<figcaption>${esc(cap)}</figcaption>` : ""
      }</figure>`;
    }
    case "file": {
      // The filename is escaped in BOTH the href attribute and the text:
      // filenames routinely carry &, quotes and em dashes.
      const name = String((b as { fname?: string }).fname ?? "");
      const src = peekSignedUrl((b as { path?: string }).path);
      if (!name || !src) return "";
      return `<p><a href="${esc(src)}" download="${esc(name)}">${esc(name)}</a></p>`;
    }
    case "imagerow": {
      const cap = String((b as { cap?: string }).cap ?? "");
      const paths = readPaths(b).filter(Boolean) as string[];
      const cells = paths
        .map((p) => peekSignedUrl(p))
        .filter(Boolean)
        .map(
          (src) =>
            `<img src="${esc(src)}" alt="${esc(
              cap,
            )}" style="width:100%;height:auto;border-radius:9px"/>`,
        );
      if (cells.length === 0) return "";
      return `<figure style="margin:14px 0"><div style="display:grid;grid-template-columns:repeat(${
        readCols(b)
      },minmax(0,1fr));gap:10px">${cells.join("")}</div>${
        cap ? `<figcaption>${esc(cap)}</figcaption>` : ""
      }</figure>`;
    }
    case "divider":
      return `<hr/>`;
    case "code": {
      const lang = typeof b.lang === "string" ? (b.lang as string) : "";
      return `<pre><code${
        lang ? ` class="language-${esc(lang)}"` : ""
      }>${esc(text)}</code></pre>`;
    }
    case "table": {
      const rows = Array.isArray(b.rows)
        ? (b.rows as unknown[][]).map((r) =>
            Array.isArray(r) ? r.map((c) => String(c ?? "")) : [],
          )
        : [];
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => {
        const c = r.slice();
        while (c.length < width) c.push("");
        return c;
      };
      // Per-column text-align, defaulting to left. Emitting the style on
      // every th/td keeps HTML and PDF matching the on-screen table.
      const alignArr = Array.isArray(b.align) ? (b.align as unknown[]) : [];
      const alignAt = (i: number): string => {
        const a = alignArr[i];
        return a === "center" || a === "right" ? String(a) : "left";
      };
      const styleFor = (i: number) => ` style="text-align:${alignAt(i)}"`;
      // Per-column widths survive to HTML/PDF via <colgroup>, but as
      // PERCENTAGES of their own sum: the stored pixels are a screen
      // measurement (780px body) and meaningless against a printable
      // Letter column (~672px). The user chose PROPORTIONS, so that is
      // what paper gets. Absent widths keeps today's auto layout, so
      // unrelated exports don't regress.
      const widthsRaw = Array.isArray((b as { widths?: unknown }).widths)
        ? ((b as { widths: unknown[] }).widths as unknown[])
        : null;
      let colgroup = "";
      let tableAttrs = "";
      if (widthsRaw && widthsRaw.length > 0) {
        const w: number[] = [];
        for (let i = 0; i < width; i++) {
          const v = widthsRaw[i];
          const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 160;
          w.push(Math.max(56, Math.min(1200, n)));
        }
        const sum = w.reduce((a, n) => a + n, 0);
        const pcts = w.map((n) => Math.round((n / sum) * 100000) / 1000);
        // The last column absorbs the rounding remainder so the set totals
        // exactly 100 and no sliver of table width goes unassigned.
        const head = pcts.slice(0, -1);
        const last = Math.round((100 - head.reduce((a, n) => a + n, 0)) * 1000) / 1000;
        const finals = [...head, last];
        colgroup =
          `<colgroup>${finals.map((p) => `<col style="width:${p}%"/>`).join("")}</colgroup>`;
        tableAttrs = ` style="table-layout:fixed;width:100%"`;
      }

      // Header flags are BLOCK attributes, not row data: `headerRow`
      // defaults on (today's behaviour), `headerCol` defaults off. They
      // decide which cells become <th> — semantics, not styling, so a
      // screen reader announces the same headers the editor shows.
      const headerRow = (b as { headerRow?: unknown }).headerRow !== false;
      const headerCol = (b as { headerCol?: unknown }).headerCol === true;
      // Cells carry inline markdown now, so they go through `inline`
      // (which escapes first, then inserts tags) — never raw `esc`.
      const th = (c: string, i: number, scope: "col" | "row") =>
        `<th scope="${scope}"${styleFor(i)}>${inline(c)}</th>`;
      const td = (c: string, i: number) => `<td${styleFor(i)}>${inline(c)}</td>`;
      const bodyRow = (r: string[]) =>
        `${trOpen(pad(r))}${pad(r)
          .map((c, i) => (headerCol && i === 0 ? th(c, i, "row") : td(c, i)))
          .join("")}</tr>`;
      const thead = headerRow
        ? `<thead>${trOpen(pad(rows[0]))}${pad(rows[0])
            .map((c, i) => th(c, i, "col"))
            .join("")}</tr></thead>`
        : "";

      const body = (headerRow ? rows.slice(1) : rows).map(bodyRow).join("");
      return `<table${tableAttrs}>${colgroup}${thead}<tbody>${body}</tbody></table>`;
    }
    case "sheet": {
      const g = sheetGrid(b);
      if (!g) return "";
      const { values, cells } = g;
      const frozen = (b as { freeze?: unknown }).freeze === true;
      const styleFor = (r: number, c: number): string => {
        const cell = cells[r]?.[c] ?? null;
        const bits = [`text-align:${sheetAlign(cells, c, values)}`];
        if (cell?.b) bits.push("font-weight:700");
        if (cell?.i) bits.push("font-style:italic");
        // A size set on screen must survive to paper. These px values are the
        // ones the screen's type tokens resolve to (text-caption / text-ui);
        // export serialises literal values by design and is exempt from
        // check-tokens, which only scans src outside this serialiser's data.
        if (cell?.fs === "s") bits.push("font-size:12.5px");
        if (cell?.fs === "l") bits.push("font-size:15px");
        // The rule above a total row is structure, so it survives export as
        // a real border rather than a background trick.
        if (cell?.rt) bits.push("border-top:2px solid #1B1A17");
        return ` style="${bits.join(";")}"`;
      };
      const rowHtml = (r: number, tag: "th" | "td") =>
        `${trOpen(values[r])}${values[r]
          .map((v, c) =>
            tag === "th"
              ? `<th scope="col"${styleFor(r, c)}>${esc(v)}</th>`
              : `<td${styleFor(r, c)}>${esc(v)}</td>`,
          )
          .join("")}</tr>`;

      const body: string[] = [];
      for (let r = frozen ? 1 : 0; r < values.length; r++) body.push(rowHtml(r, "td"));
      const thead = frozen ? `<thead>${rowHtml(0, "th")}</thead>` : "";
      return `<table>${thead}<tbody>${body.join("")}</tbody></table>`;
    }
    case "columns": {
      // Real CSS grid. minmax(0,Nfr) prevents long words from blowing the
      // track out and carries the block's stored proportional weights so
      // an exported page keeps them. Inner blocks serialise recursively
      // with per-column numbered ordinals so `1.` starts fresh in each.
      const cols = Array.isArray(b.cols) ? (b.cols as Block[][]) : [];
      const n = cols.length;
      if (n === 0) return "";
      const inner = cols
        .map((col) => {
          if (!Array.isArray(col)) return "<div></div>";
          const ords = numberedOrdinals(col);
          return `<div>${renderBlocksHtml(col, ords)}</div>`;
        })
        .join("");
      const tpl = columnsGridTemplatePlain(
        normalizeColumnWidths((b as { widths?: unknown }).widths, n),
        n,
      );
      return `<div class="cols" style="display:grid;grid-template-columns:${tpl};gap:40px">${inner}</div>`;
    }
    default:
      warnUnknownBlock(t);
      return `<p>${esc(text)}</p>`;
  }
}

/* ─────────────────────────── nested list renderer ───────────────────────────
 *
 * Runs of consecutive list-like blocks (bullet, numbered, todo) become a
 * single nested <ul>/<ol> tree keyed off each block's indent level. Type
 * transitions at the same depth close and reopen the list; deeper items
 * nest inside the current <li> (semantic HTML outline); ascents close the
 * inner list AND the parent <li> before opening a new sibling.
 *
 * Adjacent bullets and todos merge into the same <ul> (they share the tag);
 * a numbered item at the same depth breaks and reopens as <ol>.
 */
const LIST_LIKE = new Set(["bullet", "numbered", "todo"]);

function readIndent(b: Block): number {
  const raw = (b as { indent?: unknown }).indent;
  return typeof raw === "number" && raw > 0 ? Math.min(6, Math.floor(raw)) : 0;
}

function listItemInner(b: Block, ordinal: number): string {
  const text = blockText(b);
  // Same documented loss as blockHtml: a custom emoji exports as its
  // shortcode text, never as a signed URL that expires.
  const inline = (s: string) => inlineToHtml(s, { emojiAs: "alt" });
  if (b.type === "todo") {
    return `<input type="checkbox" disabled${
      b.checked ? " checked" : ""
    }/> <span${b.checked ? ' class="done"' : ""}>${inline(text)}</span>`;
  }
  // ordinal is embedded on the <ol> via `start`, so <li> content is the same
  // for bullet and numbered.
  void ordinal;
  return inline(text);
}

function renderListRun(
  items: readonly { block: Block; ordinal: number }[],
): string {
  let out = "";
  const stack: Array<{ tag: "ul" | "ol"; depth: number }> = [];
  for (const { block, ordinal } of items) {
    const K = readIndent(block);
    const targetTag: "ul" | "ol" = block.type === "numbered" ? "ol" : "ul";
    // Ascend to depth ≤ K, closing each deeper <li></ul|ol>.
    while (stack.length && stack[stack.length - 1].depth > K) {
      const top = stack.pop()!;
      out += `</li></${top.tag}>`;
    }
    if (stack.length && stack[stack.length - 1].depth === K) {
      if (stack[stack.length - 1].tag !== targetTag) {
        // Same depth, different tag → close and reopen fresh.
        const top = stack.pop()!;
        out += `</li></${top.tag}>`;
      } else {
        // Same depth, same tag → sibling <li>.
        out += `</li><li>${listItemInner(block, ordinal)}`;
        continue;
      }
    }
    // Open a new list at this depth (either descending or empty stack).
    const attr = targetTag === "ol" && ordinal > 1 ? ` start="${ordinal}"` : "";
    out += `<${targetTag}${attr}><li>${listItemInner(block, ordinal)}`;
    stack.push({ tag: targetTag, depth: K });
  }
  while (stack.length) {
    const top = stack.pop()!;
    out += `</li></${top.tag}>`;
  }
  return out;
}

/**
 * Walk `blocks` and emit HTML, batching consecutive list-like blocks
 * (bullet/numbered/todo) through the nested renderer. Non-list blocks go
 * through `blockHtml` one by one.
 */
function renderBlocksHtml(
  blocks: readonly Block[],
  ords: Map<string, number>,
): string {
  const parts: string[] = [];
  let run: { block: Block; ordinal: number }[] = [];
  const flush = () => {
    if (run.length) {
      parts.push(renderListRun(run));
      run = [];
    }
  };
  for (const b of blocks) {
    if (b && typeof b.type === "string" && LIST_LIKE.has(b.type)) {
      const ord = (b.id && ords.get(b.id)) || 1;
      run.push({ block: b, ordinal: ord });
    } else {
      flush();
      const ord = (b && b.id && ords.get(b.id)) || 1;
      parts.push(blockHtml(b, ord));
    }
  }
  flush();
  return parts.join("\n");
}

/**
 * HTML fragment for an arbitrary subset of blocks — used by the block-
 * selection clipboard path so `text/html` matches what the exporter would
 * produce for the same blocks. Ordinals are computed against THIS list
 * only (a selection of two numbered items starts at 1., 2. regardless of
 * their absolute position in the page).
 */
export function blocksHtmlFragment(blocks: readonly Block[]): string {
  const ords = numberedOrdinals(blocks);
  return renderBlocksHtml(blocks, ords);
}


/* ─────────────────────────── Design tokens ───────────────────────────
 * These hex values are the design-system tokens serialized for exported
 * files. They MUST match src/styles.css @theme exactly. If you change a
 * token there, change it here.
 * See scripts/check-tokens.mjs — this file is the sole exemption.
 */
const canvas     = "#F6F5F1"; // --color-canvas   (body background)
const ink        = "#2A2A24"; // --color-ink      (prose text)
const noir       = "#0d0d09"; // --color-noir     (headings)
const line       = "#E7E8EE"; // --color-line     (borders / rules)
const muted      = "#767B89"; // --color-muted    (dt, muted text)
const sunken     = "#F1F0EC"; // --color-sunken   (aside/pre/th surfaces)
const lineStrong = "#DCDCE4"; // --color-lineStrong (blockquote border)

const HTML_CSS = `
  /* The callout colour tokens, serialized. blockHtml emits a callout's
     background and ring as inline var(--color-*) expressions from the same
     resolver the on-screen render uses; an exported file has no @theme, so
     without these declarations every var() is invalid at computed-value
     time and the callout prints with NO background and a dark
     currentColor border. Light values only — an export is paper. */
  :root {
    color-scheme: light;
    --color-rail: #F4F3EF;
    --color-line: ${line};
    --color-accentTint: #DCFBE9; --color-accentRing: #B7EFD6;
    --color-amberTint: #FEF3C7;  --color-amberRing: #FCE7C8;
    --color-dangerTint: #FEE2E2; --color-dangerRing: #FBCFCF;
    --color-yellowTint: #FAF4C4; --color-yellowInk: #7A6A10;
    --color-blueTint: #DBEAFE;   --color-blueInk: #1D4ED8;
    --color-purpleTint: #EDE4FF; --color-purple: #5B21B6;
    --color-pinkTint: #FBE0EE;   --color-pink: #BE185D;
  }
  /* Real per-page margins. Applies to every sheet, not just the first —
     that was the fixed-footer / body-padding trap. printPdf appends its
     own @page with the user's selected paper size, and because it is
     injected AFTER this block it wins the cascade for print. */
  @page { size: Letter; margin: 0.8in 0.75in; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: ${canvas}; }
  body {
    font-family: Lato, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 17px; line-height: 1.6; color: ${ink};
    max-width: 780px; margin: 0 auto;
  }
  /* Screen-only inset — on paper the @page margin does this job. */
  @media screen { body { padding: 56px 44px; } }
  h1, h2, h3, h4 { font-family: Poppins, -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: -0.02em; color: ${noir}; }
  h1.title { font-size: 34px; margin: 0 0 4px; letter-spacing: -0.035em; }
  h1 { font-size: 26px; margin: 28px 0 8px; }
  h2 { font-size: 20px; margin: 22px 0 6px; }
  h3 { font-size: 17px; margin: 18px 0 4px; font-weight: 600; }
  h4 { font-size: 17px; margin: 18px 0 4px; font-weight: 600; }
  p { margin: 0 0 10px; orphans: 3; widows: 3; }
  p.caption { font-size: 12.5px; color: ${muted}; margin: 4px 0 10px; }
  ul, ol { margin: 0 0 10px; padding-left: 22px; }
  li { margin: 2px 0; }
  hr { border: 0; border-top: 1px solid ${line}; margin: 20px 0; }
  figure { margin: 14px 0; }
  figure img { max-width: 100%; }
  figcaption { margin-top: 7px; text-align: center; font-size: 12.5px; color: ${muted}; }
  blockquote { margin: 10px 0; padding: 4px 14px; border-left: 3px solid ${lineStrong}; color: ${muted}; font-style: italic; }
  aside, .callout { display: flex; gap: 10px; align-items: flex-start; margin: 10px 0; padding: 12px 14px; background: ${sunken}; border-radius: 10px; }
  aside .ico { flex: none; font-size: 18px; line-height: 1.3; }
  /* A multi-child callout wraps its children in this div. Without a basis
     it is a shrink-to-fit flex item next to the icon and collapses to a
     sliver, so its block-level children print as nothing. min-width: 0 is
     load-bearing: a long word or a <pre> inside the callout would
     otherwise push the track wider than the sheet — the same trap the
     columns grid guards with minmax(0, 1fr). */
  aside .callout-body { flex: 1 1 auto; min-width: 0; }
  aside .callout-body > *:first-child { margin-top: 0; }
  aside .callout-body > *:last-child { margin-bottom: 0; }
  pre { margin: 10px 0; padding: 12px 14px; background: ${sunken}; border-radius: 8px;
    font-family: "Spline Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px;
    white-space: pre-wrap; word-break: break-word; }
  code { font-family: "Spline Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
  img, table { max-width: 100%; }
  table { border-collapse: collapse; margin: 10px 0; width: 100%; font-size: 15px; }
  /* overflow-wrap: anywhere (not just break-word) also lowers the cell's
     min-content contribution, so an auto-layout table sizes its columns
     sensibly instead of one URL dictating the whole layout — and under
     table-layout: fixed a long token wraps inside the cell instead of
     painting over its neighbour. */
  th, td { border: 1px solid ${line}; padding: 6px 10px; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }

  thead th { background: ${sunken}; }
  mark { background: #FFF4B8; color: ${noir}; padding: 0 2px; border-radius: 2px; }
  .todo .done { color: ${muted}; text-decoration: line-through; }
  details { margin: 8px 0; }
  summary { cursor: default; font-weight: 700; }
  dl.props { display: grid; grid-template-columns: 132px 1fr; gap: 4px 16px; margin: 0 0 24px; font-size: 14px; color: ${ink}; }
  dl.props dt { color: ${muted}; }
  header.meta { border-bottom: 1px solid ${line}; padding-bottom: 18px; margin-bottom: 22px; }
  /* Masthead — a letterhead. Rendered once at the top of the document,
     never repeated per sheet. Replaces the old fixed-position footer,
     which fought pagination on every long export. */
   header.masthead {
     display: flex; align-items: center; gap: 12px;
     padding-bottom: 16px; margin-bottom: 22px;
     border-bottom: 1px solid ${line};
     font-family: Poppins, -apple-system, BlinkMacSystemFont, sans-serif;
     font-size: 12.5px; color: ${muted}; letter-spacing: -0.01em;
   }
   header.masthead img { height: 34px; width: auto; display: block; flex: none; }
  header.masthead .ws { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Page-break control — the difference between "printed a web page"
     and "a document". Headings never strand at the bottom of a page;
     structured blocks never split across a page boundary; table headers
     repeat on split tables; paragraphs never leave 1–2 orphan/widow lines. */
  h1, h2, h3 { break-after: avoid-page; page-break-after: avoid; break-inside: avoid; page-break-inside: avoid; }
  blockquote, aside, pre, table, figure, li, .callout { break-inside: avoid; page-break-inside: avoid; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  /* Long-form rows (tagged at generation time) may split, like Word and
     Google Docs allow by default; keeping short rows whole is the
     deliberate exception above. This rule must stay AFTER it to win. */
  tr.tall { break-inside: auto; page-break-inside: auto; }

  thead { display: table-header-group; }
  hr { break-after: avoid; }
  figure { break-inside: avoid; }
`;

export function toHtml(ctx: ExportContext): string {
  const includeDetails = ctx.includeDetails !== false;

  const props: Array<[string, string]> = [];
  if (includeDetails) {
    if (ctx.area) props.push(["Area", ctx.area]);
    if (ctx.status) props.push(["Status", ctx.status]);
    if (ctx.ownerName) props.push(["Owner", ctx.ownerName]);
    if (ctx.tags && ctx.tags.length) props.push(["Tags", ctx.tags.join(", ")]);
    const vd = verifiedDate(ctx.verifiedAt);
    if (vd) props.push(["Verified", vd]);
  }

  const propsHtml = props.length
    ? `<dl class="props">${props
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
        .join("")}</dl>`
    : "";

  const titleEsc = esc(ctx.title || "Untitled");

  // With details: wrap title + <dl> in <header class="meta"> (the rule sits
  // under the header). Without details: bare <h1> — no wrapper, no orphaned
  // divider. Title always renders.
  const headerHtml = includeDetails
    ? `<header class="meta">
<h1 class="title">${titleEsc}</h1>
${propsHtml}
</header>`
    : `<h1 class="title">${titleEsc}</h1>`;

  const ords = numberedOrdinals(ctx.blocks);
  const body = renderBlocksHtml(ctx.blocks, ords);

  // Masthead: renders ONCE at the top of the document (letterhead style).
  // The old fixed-position footer fought pagination and repeatedly caused
  // bottom-edge collisions — deleted. The browser's own print header/footer
  // (URL, page numbers, date) is now a checkbox in the user's print dialog.
  // If the logo failed to inline (very unlikely — module init exception),
  // fall back to a text wordmark so the mark still reads. Both branches
  // keep the file self-contained.
  const markHtml = GIO_DOCS_LOGO_DATA_URI
    ? `<img src="${GIO_DOCS_LOGO_DATA_URI}" alt="Gio Docs"/>`
    : `<span style="font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${muted};">Gio Docs</span>`;
  const wsName = (ctx.workspaceName ?? "").trim();
  const mastheadHtml = `<header class="masthead">
${markHtml}
${wsName ? `<span class="ws">${esc(wsName)}</span>` : ""}
</header>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${titleEsc}</title>
<style>${HTML_CSS}</style>
</head>
<body>
${mastheadHtml}
${headerHtml}
<main>
${body}
</main>
</body>
</html>`;
}

/* ─────────────────────────── printPdf ─────────────────────────── */

export async function printPdf(
  ctx: ExportContext,
  paper: string,
  scalePct: number,
): Promise<void> {
  // Serialise BEFORE opening the window: if toHtml throws we must not
  // leave an orphaned about:blank tab behind.
  const html = toHtml(ctx);
  // NOTE: do NOT pass "noopener,noreferrer" here. Per spec, window.open()
  // returns null when noopener is set, so we would lose the handle we need
  // to write our own document into the tab. This is safe: we are writing a
  // string we generated ourselves, not navigating to an untrusted URL.
  const win = window.open("", "_blank");
  if (!win) throw new Error("popup-blocked");
  const zoom = Math.max(0.5, Math.min(2, scalePct / 100));
  // @page carries all four margins now — 0.8in top/bottom, 0.75in left/right
  // — applied to EVERY sheet by the paginator. No body padding: padding is a
  // document-flow property that only insets the first page's content column,
  // which is what caused pages 2+ to bleed to the paper edge. Injected AFTER
  // the base stylesheet's @page so this rule wins the cascade for the
  // user's selected paper size.
  // Chrome MAY print its own header/footer (title, date, URL, page numbers)
  // if "Headers and footers" is ticked in the print dialog — that is now
  // the user's choice rather than something suppressed by breaking layout.
  const augmented = html.replace(
    "</style>",
    `@page { size: ${paper}; margin: 0.8in 0.75in; }
     html, body { background: #ffffff; }
     body { max-width: none; zoom: ${zoom}; }
     </style>`,
  );
  win.document.open();
  win.document.write(augmented);
  win.document.close();

  // Wait for the document to ACTUALLY render before freezing it. A fixed
  // delay was fine when exports were text and webfonts; images arrive over
  // the network from signed URLs and routinely take longer, so print() was
  // capturing half-loaded frames. This is a race, so it looked fine on a
  // warm cache and broke for everyone else.
  await waitForPrintReady(win);

  if (win.closed) return; // user closed the tab while we waited

  try {
    win.focus();
    win.print();
  } catch {
    /* the print dialog may be dismissed by the user; that is not an error. */
  }
}

/**
 * Resolve when `win` has parsed, loaded every image, settled its webfonts and
 * committed a paint — or when `timeoutMs` elapses, whichever comes first.
 *
 * The ceiling is deliberate: a single unreachable image must degrade to "PDF
 * without that image", never to "the print dialog never opens". Every await
 * below is individually raced against the remaining budget.
 */
async function waitForPrintReady(win: Window, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  const remaining = () => Math.max(0, timeoutMs - (Date.now() - started));

  // 1. Document parsed.
  if (win.document.readyState !== "complete") {
    await raceTimeout(
      new Promise<void>((resolve) => {
        win.addEventListener("load", () => resolve(), { once: true });
      }),
      remaining(),
    );
  }
  if (win.closed) return;

  // 2. Every <img> SETTLED — resolved or errored. `complete` is true for a
  //    broken image too, which is what we want: a 404 is settled, not pending.
  const imgs = Array.from(win.document.images);
  if (imgs.length) {
    await raceTimeout(
      Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              const done = () => resolve();
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
            }),
        ),
      ),
      remaining(),
    );
  }
  if (win.closed) return;

  // 3. Webfonts. Poppins/Lato/Spline usually come from the opener's cache,
  //    but a cold window can still swap mid-print without this.
  const fonts = (win.document as Document & { fonts?: { ready?: Promise<unknown> } })
    .fonts;
  if (fonts?.ready) {
    await raceTimeout(fonts.ready, remaining());
  }
  if (win.closed) return;

  // 4. Two frames, so layout and paint have committed. rAF does not fire in a
  //    fully backgrounded tab, so this is raced too rather than awaited bare.
  await raceTimeout(
    new Promise<void>((resolve) => {
      win.requestAnimationFrame(() =>
        win.requestAnimationFrame(() => resolve()),
      );
    }),
    Math.min(remaining(), 1000),
  );
}

/** Resolve when `p` settles or `ms` elapses. Never rejects. */
function raceTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return Promise.race([
    Promise.resolve(p).then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
  ]);
}

/* ─────────────────────────── View exports (CSV / MD table) ───────────────────────────
 *
 * Consumed by the "Export view" dialog. The rows array MUST be exactly what
 * the table is rendering right now — same runView output, same sort, after
 * local session filters. Do not re-derive inside this file.
 *
 * Column keys mirror the visible table columns; the caller passes only the
 * columns whose checkboxes are ticked, in the order they appear on screen.
 */

export type ExportViewColumnKey =
  | "title"
  | "area"
  | "owner"
  | "status"
  | "tags"
  | "verified"
  | "edited";

export type ExportViewRow = {
  title: string | null;
  area: string | null;
  ownerId: string | null;
  status: string | null;
  tags: readonly string[];
  verifiedAt: string | null;
  editedAt: string | null;
};

export type ExportViewOptions = {
  columns: readonly ExportViewColumnKey[];
  /** Resolve a member id to a display name. Called only for owner columns. */
  resolveOwner: (id: string | null) => string;
};

const VIEW_COLUMN_LABEL: Record<ExportViewColumnKey, string> = {
  title: "Page",
  area: "Area",
  owner: "Owner",
  status: "Status",
  tags: "Tags",
  verified: "Verified",
  edited: "Edited",
};

function dateOnly(iso: string | null | undefined): string {
  return verifiedDate(iso);
}

function rawIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function cellFor(
  row: ExportViewRow,
  key: ExportViewColumnKey,
  resolveOwner: (id: string | null) => string,
  dateFmt: (iso: string | null | undefined) => string,
): string {
  switch (key) {
    case "title": {
      const t = (row.title ?? "").trim();
      return t || "Untitled";
    }
    case "area":
      return row.area ?? "";
    case "owner":
      return resolveOwner(row.ownerId);
    case "status":
      return row.status ?? "";
    case "tags":
      return row.tags.join("; ");
    case "verified":
      return dateFmt(row.verifiedAt);
    case "edited":
      return dateFmt(row.editedAt);
  }
}

/* ─────────── CSV (RFC-4180, CRLF, ISO date-only) ─────────── */

function csvField(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsv(
  rows: readonly ExportViewRow[],
  opts: ExportViewOptions,
): string {
  const CRLF = "\r\n";
  const header = opts.columns.map((k) => csvField(VIEW_COLUMN_LABEL[k])).join(",");
  if (rows.length === 0) return header + CRLF;
  const body = rows
    .map((r) =>
      opts.columns
        .map((k) => csvField(cellFor(r, k, opts.resolveOwner, dateOnly)))
        .join(","),
    )
    .join(CRLF);
  return header + CRLF + body + CRLF;
}

/* ─────────── Markdown pipe table (GFM, raw ISO timestamps) ─────────── */

function mdCell(v: string): string {
  return v.replace(/\|/g, "\\|");
}

export function toMarkdownTable(
  rows: readonly ExportViewRow[],
  opts: ExportViewOptions,
): string {
  const header =
    "| " + opts.columns.map((k) => mdCell(VIEW_COLUMN_LABEL[k])).join(" | ") + " |";
  const sep = "| " + opts.columns.map(() => "---").join(" | ") + " |";
  if (rows.length === 0) return header + "\n" + sep + "\n";
  const body = rows
    .map(
      (r) =>
        "| " +
        opts.columns
          .map((k) => mdCell(cellFor(r, k, opts.resolveOwner, rawIso)))
          .join(" | ") +
        " |",
    )
    .join("\n");
  return header + "\n" + sep + "\n" + body + "\n";
}
