/* html-to-markdown — Notion-shaped HTML → markdown source.
 *
 * Used by the editor's paste handler when clipboardData carries
 * text/html. The result feeds parseMarkdown (chunk 3), which produces
 * real block objects. This exists so content can be migrated OUT of
 * Notion. No new dependencies — a hand-rolled tokenizer, safe by
 * construction: unknown tags degrade to their inner text, unknown
 * attributes are dropped, links with dangerous schemes are stripped
 * of their href.
 */

/* ─────────────────────────── HTML tokenizer ─────────────────────────── */

type Attrs = Record<string, string>;
type Node =
  | { type: "text"; text: string }
  | { type: "elem"; tag: string; attrs: Attrs; children: Node[] };

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Elements whose contents we drop entirely — never surface to output.
const DROP = new Set(["script", "style", "head", "meta", "link", "noscript", "template"]);

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, ent: string) => {
    if (ent[0] === "#") {
      const num =
        ent[1] === "x" || ent[1] === "X"
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
      if (Number.isFinite(num)) return String.fromCodePoint(num);
      return `&${ent};`;
    }
    const map: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return map[ent] ?? `&${ent};`;
  });
}

function parseAttrs(src: string): Attrs {
  const attrs: Attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[name] = decodeEntities(val);
  }
  return attrs;
}

/* Parse an HTML fragment into a shallow node tree. Robust enough for
 * clipboard fragments from Notion, Google Docs, and generic browsers —
 * not a spec-compliant parser. Unknown tags become plain elements; the
 * walker later decides how to render them. */
export function parseHtmlFragment(html: string): Node[] {
  // Strip comments and CDATA up front.
  let src = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  // Drop doctype.
  src = src.replace(/<!doctype[^>]*>/gi, "");

  const stack: Node[] = [{ type: "elem", tag: "#root", attrs: {}, children: [] }];
  const top = () => stack[stack.length - 1] as Extract<Node, { type: "elem" }>;

  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      const rest = src.slice(i);
      if (rest) top().children.push({ type: "text", text: decodeEntities(rest) });
      break;
    }
    if (lt > i) {
      top().children.push({ type: "text", text: decodeEntities(src.slice(i, lt)) });
    }

    // Closing tag?
    if (src[lt + 1] === "/") {
      const gt = src.indexOf(">", lt);
      if (gt === -1) break;
      const tag = src.slice(lt + 2, gt).trim().toLowerCase();
      // Pop stack until matching tag (be forgiving on mismatches).
      for (let s = stack.length - 1; s > 0; s--) {
        const n = stack[s] as Extract<Node, { type: "elem" }>;
        if (n.tag === tag) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    // Opening tag.
    const gt = src.indexOf(">", lt);
    if (gt === -1) break;
    let inside = src.slice(lt + 1, gt);
    let selfClose = false;
    if (inside.endsWith("/")) {
      selfClose = true;
      inside = inside.slice(0, -1);
    }
    const spaceIdx = inside.search(/[\s/>]/);
    const tag = (spaceIdx === -1 ? inside : inside.slice(0, spaceIdx))
      .trim()
      .toLowerCase();
    const attrs = spaceIdx === -1 ? {} : parseAttrs(inside.slice(spaceIdx + 1));

    // Elements whose contents we want to keep verbatim.
    if (tag === "pre" || tag === "code") {
      const closer = new RegExp(`</${tag}\\s*>`, "i");
      const rest = src.slice(gt + 1);
      const m = closer.exec(rest);
      const endRel = m ? m.index : rest.length;
      const inner = rest.slice(0, endRel);
      const node: Node = {
        type: "elem",
        tag,
        attrs,
        children: [{ type: "text", text: decodeEntities(inner) }],
      };
      top().children.push(node);
      i = gt + 1 + endRel + (m ? m[0].length : 0);
      continue;
    }

    if (DROP.has(tag)) {
      // Fast-forward past the closer.
      const closer = new RegExp(`</${tag}\\s*>`, "i");
      const rest = src.slice(gt + 1);
      const m = closer.exec(rest);
      i = gt + 1 + (m ? m.index + m[0].length : rest.length);
      continue;
    }

    const node: Node = { type: "elem", tag, attrs, children: [] };
    top().children.push(node);
    if (!selfClose && !VOID.has(tag)) {
      stack.push(node);
    }
    i = gt + 1;
  }

  return (stack[0] as Extract<Node, { type: "elem" }>).children;
}

/* ─────────────────────────── Node → markdown ─────────────────────────── */

type WalkCtx = {
  inline: boolean; // if true, we're inside <p>/<span>/<li>/etc.
  listStack: Array<{ ordered: boolean; index: number; checkbox: boolean }>;
  quoteDepth: number;
};

function isSafeHref(url: string): boolean {
  const t = (url ?? "").trim();
  if (!t) return false;
  return !/^\s*(javascript|data|vbscript)\s*:/i.test(t);
}

function collapseWs(s: string): string {
  return s.replace(/[\t\n\r ]+/g, " ");
}

function textOnly(nodes: Node[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += n.text;
    else if (!DROP.has(n.tag)) out += textOnly(n.children);
  }
  return out;
}

/* A checkbox <li> is one whose descendants include an <input type=checkbox>
 * or a data-checked attribute anywhere. Returns {checkbox, checked} or null. */
function detectCheckbox(li: Extract<Node, { type: "elem" }>): { checked: boolean } | null {
  // Check the li's OWN data-checked before descending. Notion emits it
  // directly on the <li>.
  const own = li.attrs["data-checked"];
  if (own === "true" || own === "false") return { checked: own === "true" };

  let found: { checked: boolean } | null = null;
  const visit = (n: Node) => {
    if (found) return;
    if (n.type === "elem") {
      if (n.tag === "input" && (n.attrs.type ?? "").toLowerCase() === "checkbox") {
        found = { checked: "checked" in n.attrs || n.attrs.checked === "" || n.attrs.checked === "true" };
        return;
      }
      const dc = n.attrs["data-checked"];
      if (dc === "true" || dc === "false") {
        found = { checked: dc === "true" };
        return;
      }
      for (const c of n.children) visit(c);
    }
  };
  for (const c of li.children) visit(c);
  return found;
}

/* Callout detection.
 *
 * Notion does NOT emit callouts as blockquotes on the clipboard — they come
 * as a styled <div>/<figure> whose class contains "callout", or a container
 * whose first child holds a single emoji followed by content. Detect both
 * shapes and emit `> {emoji} {text}` so parseMarkdown's own rule turns it
 * back into a callout block. If detection is triggered by class but no
 * emoji is found, fall back to 💡. If nothing detects, return null and let
 * the normal div/p handler take over — we never lose the text.
 */
const CALLOUT_EMOJI_ONLY =
  /^\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*$/u;
const CALLOUT_LEAD_EMOJI =
  /^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u;

function detectCallout(
  el: Extract<Node, { type: "elem" }>,
): { icon: string; text: string } | null {
  const cls = (el.attrs.class ?? "").toLowerCase();
  const classHit = /\bcallout\b/.test(cls);
  const shapeCandidate = el.tag === "div" || el.tag === "figure";
  if (!classHit && !shapeCandidate) return null;

  // Non-whitespace children only.
  const kids = el.children.filter(
    (c) => !(c.type === "text" && /^\s*$/.test(c.text)),
  );
  if (kids.length === 0) return null;

  let icon = "";
  let contentKids: Node[] = kids;
  const first = kids[0];

  if (first.type === "elem") {
    const firstText = textOnly(first.children).trim();
    if (firstText && CALLOUT_EMOJI_ONLY.test(firstText)) {
      icon = firstText;
      contentKids = kids.slice(1);
    }
  } else if (first.type === "text") {
    const m = first.text.match(CALLOUT_LEAD_EMOJI);
    if (m) {
      icon = m[1];
      const rest = first.text.slice(m[0].length);
      contentKids = [{ type: "text", text: rest }, ...kids.slice(1)];
    }
  }

  // Shape-only detection needs an emoji to avoid false positives on plain
  // <div>s. Class-based detection accepts a missing emoji and defaults.
  if (!classHit && !icon) return null;
  if (!icon) icon = "💡";

  // Render remaining children as inline (callouts are single-line in our
  // model). collapseWs then trim to one line.
  const text = collapseWs(renderInlineChildren(contentKids)).trim();
  if (!text) return null;
  return { icon, text };
}

function renderInlineChildren(nodes: Node[]): string {
  let out = "";
  for (const n of nodes) {
    out += renderInlineNode(n);
  }
  return out;
}

function renderInlineNode(n: Node): string {
  if (n.type === "text") {
    return collapseWs(n.text);
  }
  const t = n.tag;
  if (DROP.has(t)) return "";
  if (t === "br") return "\n";
  if (t === "strong" || t === "b") return `**${renderInlineChildren(n.children)}**`;
  if (t === "em" || t === "i") return `*${renderInlineChildren(n.children)}*`;
  if (t === "u") return `<u>${renderInlineChildren(n.children)}</u>`;
  if (t === "s" || t === "del" || t === "strike") return `~~${renderInlineChildren(n.children)}~~`;
  if (t === "code") {
    // Inside inline: no re-parsing.
    return `\`${textOnly(n.children)}\``;
  }
  if (t === "a") {
    const label = renderInlineChildren(n.children);
    const href = n.attrs.href ?? "";
    if (!isSafeHref(href)) return label;
    return `[${label}](${href.trim()})`;
  }
  if (t === "img") {
    // Alt text only — we don't ingest images in this pass.
    return n.attrs.alt ?? "";
  }
  if (t === "input") {
    // Bare inputs outside a list contribute nothing.
    return "";
  }
  // Unknown inline: pass through children.
  return renderInlineChildren(n.children);
}

function renderTable(el: Extract<Node, { type: "elem" }>): string {
  const rows: string[][] = [];
  const walk = (node: Node) => {
    if (node.type !== "elem") return;
    if (node.tag === "tr") {
      const cells: string[] = [];
      for (const c of node.children) {
        if (c.type === "elem" && (c.tag === "td" || c.tag === "th")) {
          cells.push(renderInlineChildren(c.children).trim().replace(/\|/g, "\\|"));
        }
      }
      if (cells.length) rows.push(cells);
      return;
    }
    for (const c of node.children) walk(c);
  };
  walk(el);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => r.concat(new Array(width - r.length).fill(""));
  const header = pad(rows[0]);
  const rest = rows.slice(1).map(pad);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${new Array(width).fill("---").join(" | ")} |`,
    ...rest.map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function renderBlock(n: Node, ctx: WalkCtx): string {
  if (n.type === "text") {
    const s = collapseWs(n.text);
    // Between blocks, drop whitespace-only text.
    return /^\s*$/.test(s) ? "" : s;
  }
  const el = n;
  const t = el.tag;

  if (DROP.has(t)) return "";

  // Block-level containers.
  if (t === "hr") return "---";
  if (t === "br") return "";

  if (/^h[1-6]$/.test(t)) {
    // Our model supports h1, h2, h3. Any deeper heading collapses to h3
    // (never below), so external HTML that uses <h4>…<h6> lands on the
    // deepest we have rather than becoming plain text.
    const raw = Number(t.slice(1));
    const level = raw <= 1 ? 1 : raw === 2 ? 2 : 3;
    const hash = level === 1 ? "#" : level === 2 ? "##" : "###";
    return `${hash} ${renderInlineChildren(el.children).trim()}`;
  }

  if (t === "p" || t === "div" || t === "figure") {
    const co = detectCallout(el);
    if (co) return `> ${co.icon} ${co.text}`;
    const inner = renderInlineChildren(el.children).trim();
    return inner;
  }

  if (t === "blockquote") {
    const inner = el.children.map((c) => renderBlock(c, ctx)).filter(Boolean).join("\n\n");
    return inner
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }

  if (t === "pre") {
    // <pre> either wraps <code> or holds raw text.
    let raw = "";
    let lang = "";
    for (const c of el.children) {
      if (c.type === "elem" && c.tag === "code") {
        raw = textOnly(c.children);
        const cls = c.attrs.class ?? c.attrs.classname ?? "";
        const m = /language-([\w-]+)/.exec(cls);
        if (m) lang = m[1];
      } else if (c.type === "text") {
        raw += c.text;
      }
    }
    return "```" + lang + "\n" + raw.replace(/\n$/, "") + "\n```";
  }

  if (t === "ul" || t === "ol") {
    const items: string[] = [];
    let n = 1;
    for (const c of el.children) {
      if (c.type !== "elem" || c.tag !== "li") continue;
      const box = detectCheckbox(c);
      const inner = renderInlineChildren(
        c.children.filter(
          (ch) => !(ch.type === "elem" && ch.tag === "input"),
        ),
      ).trim();
      if (box) {
        items.push(`- [${box.checked ? "x" : " "}] ${inner}`);
      } else if (t === "ol") {
        items.push(`${n}. ${inner}`);
        n += 1;
      } else {
        items.push(`- ${inner}`);
      }
    }
    return items.join("\n");
  }

  if (t === "table") {
    return renderTable(el);
  }

  // Unknown block element — walk children as blocks.
  return el.children.map((c) => renderBlock(c, ctx)).filter(Boolean).join("\n\n");
}

export function htmlToMarkdown(html: string): string {
  const roots = parseHtmlFragment(html);
  const ctx: WalkCtx = { inline: false, listStack: [], quoteDepth: 0 };
  const parts: string[] = [];
  for (const n of roots) {
    const md = renderBlock(n, ctx);
    if (md) parts.push(md);
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ─────────────────────── Structured Notion importer ───────────────────────
 *
 * Notion's clipboard HTML emits column layouts as nested divs whose class
 * contains "column_list" and "column". Markdown cannot express columns, so
 * this structured path returns Blk[] directly, feeding real columns blocks
 * into paste — bypassing the markdown round-trip.
 *
 * Returns null when NO column_list shape is found: callers fall back to
 * htmlToMarkdown + parseMarkdown, so no content is ever lost.
 *
 * We intentionally keep the block "type" typing loose (string) to avoid a
 * cross-file dep on the editor's BlockType union. The editor's normalize()
 * accepts these shapes.
 */

import { nanoid } from "nanoid";
import { parseMarkdown, type Blk } from "./markdown-import";
import { MAX_COLS, MIN_COLS } from "./columns";

function hasClass(el: Extract<Node, { type: "elem" }>, needle: string): boolean {
  const cls = (el.attrs.class ?? "").toLowerCase();
  return cls.split(/\s+/).some((c) => c.includes(needle));
}

function serializeChildrenToHtml(nodes: Node[]): string {
  // Minimal serialiser: we only need round-trippable text so htmlToMarkdown
  // can consume the inner content. Attributes we care about (href, src,
  // alt, type, class for language-*, data-checked) are preserved verbatim.
  const out: string[] = [];
  for (const n of nodes) out.push(serializeNode(n));
  return out.join("");
}

function serializeNode(n: Node): string {
  if (n.type === "text") {
    return n.text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  const attrs = Object.entries(n.attrs)
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join("");
  if (VOID.has(n.tag)) return `<${n.tag}${attrs}/>`;
  return `<${n.tag}${attrs}>${serializeChildrenToHtml(n.children)}</${n.tag}>`;
}

function findFirstColumnList(nodes: Node[]): Extract<Node, { type: "elem" }> | null {
  for (const n of nodes) {
    if (n.type !== "elem") continue;
    if (hasClass(n, "column_list")) return n;
    const found = findFirstColumnList(n.children);
    if (found) return found;
  }
  return null;
}

/** Structured HTML → Blk[]. Returns null if the fragment does not contain
 * a Notion-shaped column_list; callers should then fall back to
 * htmlToMarkdown + parseMarkdown. */
export function htmlToBlocks(html: string): Blk[] | null {
  const roots = parseHtmlFragment(html);
  const colList = findFirstColumnList(roots);
  if (!colList) return null;

  // Direct children whose class contains "column". Notion also wraps each
  // column in a block_column div; accept either as long as the class hits.
  const colEls: Array<Extract<Node, { type: "elem" }>> = [];
  for (const c of colList.children) {
    if (c.type === "elem" && hasClass(c, "column")) colEls.push(c);
  }
  if (colEls.length < MIN_COLS) return null;

  // Clamp N to MAX_COLS: content from overflow columns is flattened into
  // the last kept column so nothing is lost.
  const kept = colEls.slice(0, MAX_COLS);
  const overflow = colEls.slice(MAX_COLS);

  const cols: Blk[][] = kept.map((colEl) => {
    const inner = serializeChildrenToHtml(colEl.children);
    return parseMarkdown(htmlToMarkdown(inner));
  });
  if (overflow.length > 0 && cols.length > 0) {
    for (const el of overflow) {
      const inner = serializeChildrenToHtml(el.children);
      cols[cols.length - 1].push(...parseMarkdown(htmlToMarkdown(inner)));
    }
  }
  // Ensure every column has at least one block so the editor can seed a
  // caret target.
  for (let i = 0; i < cols.length; i++) {
    if (cols[i].length === 0) {
      cols[i] = [{ id: nanoid(10), type: "text", text: "" } as Blk];
    }
  }

  return [
    { id: nanoid(10), type: "columns", cols } as Blk,
  ];
}

