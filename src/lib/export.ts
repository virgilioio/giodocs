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
import { inlineToHtml } from "./inline-markdown";
import { calloutBg } from "./callout-color";
// Logo is inlined as a data URI so the exported HTML file is self-contained
// (zero network requests). Vite `?raw` reads the file at build time; vitest
// resolves the same way, so tests see the same string as the browser.
import GIO_DOCS_LOGO_SVG from "../../public/gio-docs-logo.svg?raw";

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
      // Same pragma as the `columns` case below — don't "fix" it later.
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
      return `> ${icon} ${text}`;
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
        return copy;
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
      const lines: string[] = [];
      lines.push(`| ${padded[0].join(" | ")} |`);
      lines.push(`| ${sep.join(" | ")} |`);
      for (let i = 1; i < padded.length; i++) {
        lines.push(`| ${padded[i].join(" | ")} |`);
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

function blockHtml(b: Block, ordinal = 1): string {
  const t = (b.type ?? "text") as string;
  const text = blockText(b);
  // Inline markdown (bold, italic, code, links, …) inside text-carrying
  // positions is converted to HTML via inlineToHtml, which escapes user
  // text FIRST and then inserts tags. Escaping is never bypassed.
  const inline = (s: string) => inlineToHtml(s);
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
      return `<aside style="background:${bg}"><span class="ico">${esc(icon)}</span><span>${inline(
        text,
      )}</span></aside>`;
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
      // Per-column widths survive to HTML/PDF via <colgroup>. When widths
      // are present, table-layout: fixed with a table width equal to their
      // sum preserves proportions; the existing `img, table { max-width:
      // 100% }` rule in HTML_CSS scales an over-wide table down for the
      // page rather than clipping it. Absent widths keeps today's auto
      // layout, so unrelated exports don't regress.
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
        colgroup =
          `<colgroup>${w.map((n) => `<col style="width:${n}px"/>`).join("")}</colgroup>`;
        const sum = w.reduce((a, n) => a + n, 0);
        tableAttrs = ` style="table-layout:fixed;width:${sum}px"`;
      }
      const head = pad(rows[0])
        .map((c, i) => `<th${styleFor(i)}>${esc(c)}</th>`)
        .join("");
      const body = rows
        .slice(1)
        .map(
          (r) =>
            `<tr>${pad(r)
              .map((c, i) => `<td${styleFor(i)}>${esc(c)}</td>`)
              .join("")}</tr>`,
        )
        .join("");
      return `<table${tableAttrs}>${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case "columns": {
      // Real CSS grid. minmax(0,1fr) prevents long words from blowing the
      // track out. Inner blocks serialise recursively with per-column
      // numbered ordinals so `1.` starts fresh in each column.
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
      return `<div class="cols" style="display:grid;grid-template-columns:repeat(${n},minmax(0,1fr));gap:20px">${inner}</div>`;
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
  const inline = (s: string) => inlineToHtml(s);
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
  :root { color-scheme: light; }
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
  blockquote { margin: 10px 0; padding: 4px 14px; border-left: 3px solid ${lineStrong}; color: ${muted}; font-style: italic; }
  aside, .callout { display: flex; gap: 10px; align-items: flex-start; margin: 10px 0; padding: 12px 14px; background: ${sunken}; border-radius: 10px; }
  aside .ico { flex: none; font-size: 18px; line-height: 1.3; }
  pre { margin: 10px 0; padding: 12px 14px; background: ${sunken}; border-radius: 8px;
    font-family: "Spline Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px;
    white-space: pre-wrap; word-break: break-word; }
  code { font-family: "Spline Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
  img, table { max-width: 100%; }
  table { border-collapse: collapse; margin: 10px 0; width: 100%; font-size: 15px; }
  th, td { border: 1px solid ${line}; padding: 6px 10px; text-align: left; vertical-align: top; }
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
    display: flex; align-items: center; gap: 10px;
    padding-bottom: 12px; margin-bottom: 18px;
    border-bottom: 1px solid ${line};
    font-family: Poppins, -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 11px; color: ${muted}; letter-spacing: -0.01em;
  }
  header.masthead img { height: 20px; width: auto; display: block; flex: none; }
  header.masthead .ws { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Page-break control — the difference between "printed a web page"
     and "a document". Headings never strand at the bottom of a page;
     structured blocks never split across a page boundary; table headers
     repeat on split tables; paragraphs never leave 1–2 orphan/widow lines. */
  h1, h2, h3 { break-after: avoid-page; page-break-after: avoid; break-inside: avoid; page-break-inside: avoid; }
  blockquote, aside, pre, table, figure, li, .callout { break-inside: avoid; page-break-inside: avoid; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
  hr { break-after: avoid; }
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
    : `<span style="font-weight:700;letter-spacing:-0.02em;color:${muted};">Gio Docs</span>`;
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
  await new Promise<void>((r) => window.setTimeout(r, 280));
  try {
    win.focus();
    win.print();
  } catch {
    /* the print dialog may be dismissed by the user; that is not an error. */
  }
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
