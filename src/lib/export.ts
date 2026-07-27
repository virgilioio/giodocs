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

/* ─────────────────────────── Context ─────────────────────────── */

export type ExportContext = {
  title: string;
  area?: string | null;
  status?: string | null;
  ownerName?: string | null;
  tags?: readonly string[];
  verifiedAt?: string | null;
  blocks: readonly Block[];
};

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
  switch (t) {
    case "text":
      return text;
    case "h1":
      return `# ${text}`;
    case "h2":
      return `## ${text}`;
    case "bullet":
      return `- ${text}`;
    case "numbered":
      return `${ordinal}. ${text}`;
    case "todo":
      return `- [${b.checked ? "x" : " "}] ${text}`;
    case "toggle": {
      const body = typeof b.body === "string" ? b.body : "";
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
      const lines: string[] = [];
      lines.push(`| ${padded[0].join(" | ")} |`);
      lines.push(`| ${padded[0].map(() => "---").join(" | ")} |`);
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

  const ords = numberedOrdinals(ctx.blocks);
  const bodies = ctx.blocks.map((b) =>
    blockToMarkdown(b, (b.id && ords.get(b.id)) || 1),
  );
  const body = bodies.map((s) => s + "\n").join("\n");
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
    case "h1":
      return `<h1>${inline(text)}</h1>`;
    case "h2":
      return `<h2>${inline(text)}</h2>`;
    case "bullet":
      return `<ul><li>${inline(text)}</li></ul>`;
    case "numbered":
      // Each block is its own <ol>; use `start` so the number matches the
      // page's read of the run (see numberedOrdinals).
      return `<ol start="${ordinal}"><li>${inline(text)}</li></ol>`;
    case "todo":
      return `<p class="todo"><input type="checkbox" disabled${
        b.checked ? " checked" : ""
      }/> <span${b.checked ? ' class="done"' : ""}>${inline(text)}</span></p>`;
    case "toggle": {
      const body = typeof b.body === "string" ? b.body : "";
      return `<details${b.open ? " open" : ""}><summary>${inline(
        text,
      )}</summary>${body ? `<p>${inline(body)}</p>` : ""}</details>`;
    }
    case "quote":
      return `<blockquote>${inline(text)}</blockquote>`;
    case "callout": {
      const icon =
        typeof b.icon === "string" && b.icon ? (b.icon as string) : "💡";
      return `<aside><span class="ico">${esc(icon)}</span><span>${inline(
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
      const head = pad(rows[0])
        .map((c) => `<th>${esc(c)}</th>`)
        .join("");
      const body = rows
        .slice(1)
        .map(
          (r) => `<tr>${pad(r).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`,
        )
        .join("");
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
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
          const html = col
            .map((c) => blockHtml(c, (c.id && ords.get(c.id)) || 1))
            .join("");
          return `<div>${html}</div>`;
        })
        .join("");
      return `<div class="cols" style="display:grid;grid-template-columns:repeat(${n},minmax(0,1fr));gap:20px">${inner}</div>`;
    }
    default:
      warnUnknownBlock(t);
      return `<p>${esc(text)}</p>`;
  }
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
  html, body { margin: 0; padding: 0; background: ${canvas}; }
  body {
    font-family: Lato, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 17px; line-height: 1.6; color: ${ink};
    padding: 56px 44px; max-width: 780px; margin: 0 auto;
  }
  h1, h2, h3 { font-family: Poppins, -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: -0.02em; color: ${noir}; }
  h1.title { font-size: 34px; margin: 0 0 4px; letter-spacing: -0.035em; }
  h1 { font-size: 26px; margin: 28px 0 8px; }
  h2 { font-size: 20px; margin: 22px 0 6px; }
  p { margin: 0 0 10px; }
  ul, ol { margin: 0 0 10px; padding-left: 22px; }
  li { margin: 2px 0; }
  hr { border: 0; border-top: 1px solid ${line}; margin: 20px 0; }
  blockquote { margin: 10px 0; padding: 4px 14px; border-left: 3px solid ${lineStrong}; color: ${muted}; font-style: italic; }
  aside { display: flex; gap: 10px; align-items: flex-start; margin: 10px 0; padding: 12px 14px; background: ${sunken}; border-radius: 10px; }
  aside .ico { flex: none; font-size: 18px; line-height: 1.3; }
  pre { margin: 10px 0; padding: 12px 14px; background: ${sunken}; border-radius: 8px; overflow: auto;
    font-family: "Spline Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
  code { font-family: "Spline Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
  table { border-collapse: collapse; margin: 10px 0; width: 100%; font-size: 15px; }
  th, td { border: 1px solid ${line}; padding: 6px 10px; text-align: left; vertical-align: top; }
  thead th { background: ${sunken}; }
  .todo .done { color: ${muted}; text-decoration: line-through; }
  details { margin: 8px 0; }
  summary { cursor: default; font-weight: 700; }
  dl.props { display: grid; grid-template-columns: 132px 1fr; gap: 4px 16px; margin: 0 0 24px; font-size: 14px; color: ${ink}; }
  dl.props dt { color: ${muted}; }
  header.meta { border-bottom: 1px solid ${line}; padding-bottom: 18px; margin-bottom: 22px; }
`;

export function toHtml(ctx: ExportContext): string {
  const props: Array<[string, string]> = [];
  if (ctx.area) props.push(["Area", ctx.area]);
  if (ctx.status) props.push(["Status", ctx.status]);
  if (ctx.ownerName) props.push(["Owner", ctx.ownerName]);
  if (ctx.tags && ctx.tags.length) props.push(["Tags", ctx.tags.join(", ")]);
  const vd = verifiedDate(ctx.verifiedAt);
  if (vd) props.push(["Verified", vd]);

  const propsHtml = props.length
    ? `<dl class="props">${props
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
        .join("")}</dl>`
    : "";

  const ords = numberedOrdinals(ctx.blocks);
  const body = ctx.blocks
    .map((b) => blockHtml(b, (b.id && ords.get(b.id)) || 1))
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(ctx.title || "Untitled")}</title>
<style>${HTML_CSS}</style>
</head>
<body>
<header class="meta">
<h1 class="title">${esc(ctx.title || "Untitled")}</h1>
${propsHtml}
</header>
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
  const augmented = html.replace(
    "</style>",
    `@page { size: ${paper}; margin: 0.75in; }
     html, body { background: #ffffff; }
     body { zoom: ${zoom}; }
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
