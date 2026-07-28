/**
 * parseMarkdown — inverse of blockToMarkdown in export.ts.
 *
 * Supports the block-type set: text, h1, h2, h3, bullet, numbered,
 * todo, toggle, quote, callout, divider, code, table, caption. `caption`
 * is a LOSSY round-trip: exported as a plain paragraph, so the parser sees
 * a `text` block coming back. Line-based scan; no external dependencies
 * (no turndown, no marked, no remark).
 *
 * INLINE FORMATTING IS PRESERVED AS LITERAL CHARACTERS.
 * Blk.text is a plain string with no inline model, so "**bold**",
 * "*italic*", "[a](b)" survive verbatim. Do NOT strip these markers (that
 * loses information) and do NOT invent an inline model here — that would
 * touch every renderer, both serialisers, and the search vector, and is
 * out of scope for markdown import. The next person: please don't "fix"
 * this.
 *
 * NOTE — markdown cannot express `columns` blocks. Exported columns are
 * flattened by blockToMarkdown into stacked blocks. This parser therefore
 * never resurrects a columns block from text; the structured importer
 * (htmlToBlocks in html-to-markdown.ts) is the only path that preserves
 * columns, and it feeds Blk[] directly, bypassing markdown.
 */


import { nanoid } from "nanoid";
import type { Block } from "./types";
import { clampIndent } from "./blocks";

export type Blk = Block & { id: string; type: string };

// Emoji lead detection: Extended_Pictographic covers every emoji glyph
// we ship as a callout icon. The optional VS16 (\uFE0F) is consumed too.
const EMOJI_LEAD = /^\p{Extended_Pictographic}\uFE0F?/u;

export function parseMarkdown(text: string): Blk[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Blk[] = [];
  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push({ id: nanoid(10), type: "text", text: paragraph.join("\n") });
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — ends any accumulating text paragraph.
    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    // Divider — must be a whole line on its own.
    if (/^(?:---|\*\*\*)\s*$/.test(line)) {
      flushParagraph();
      out.push({ id: nanoid(10), type: "divider", text: "" });
      i++;
      continue;
    }

    // Fenced code — join enclosed lines, ignore language tag.
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      flushParagraph();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      out.push({ id: nanoid(10), type: "code", text: codeLines.join("\n") });
      continue;
    }

    // Table — `| a | b |` line followed by a `| --- | --- |` separator.
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1])
    ) {
      flushParagraph();
      const parseRow = (l: string) =>
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      // GFM separator encodes per-column alignment:
      //   ":---:" center · "---:" right · ":---" left · plain "---" default.
      // We record only the intentional ones; plain "---" falls back to
      // "left" (also the runtime default), so a table without alignment
      // round-trips as an all-left align array.
      const sepCells = parseRow(lines[i + 1]);
      const align = sepCells.map((c): "left" | "center" | "right" => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        return "left";
      });
      const rows: string[][] = [parseRow(line)];
      i += 2; // skip header + separator
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      out.push({ id: nanoid(10), type: "table", text: "", rows, align });
      continue;
    }

    // Headings: `# ` → h1, `## ` → h2, `### ` and deeper → h3
    // (we have exactly three levels; anything deeper lands on the deepest).
    const h1 = line.match(/^# (.*)$/);
    if (h1) {
      flushParagraph();
      out.push({ id: nanoid(10), type: "h1", text: h1[1] });
      i++;
      continue;
    }
    const h2m = line.match(/^## (.*)$/);
    if (h2m) {
      flushParagraph();
      out.push({ id: nanoid(10), type: "h2", text: h2m[1] });
      i++;
      continue;
    }
    const h3plus = line.match(/^#{3,6} (.*)$/);
    if (h3plus) {
      flushParagraph();
      out.push({ id: nanoid(10), type: "h3", text: h3plus[1] });
      i++;
      continue;
    }

    // Todo / bullet / numbered — the leading whitespace becomes an indent
    // level. Accept spaces or tabs; every 2 spaces (or every tab) counts
    // as one level. The parent+1 clamp is applied after the whole parse
    // completes (see the tail of this function).
    const indentOf = (raw: string): number => {
      let spaces = 0;
      for (const ch of raw) {
        if (ch === " ") spaces += 1;
        else if (ch === "\t") spaces += 2;
        else break;
      }
      // 2-space and 4-space nesting both map to one level per two spaces,
      // which matches emitters that write "  " or "    " per depth.
      return Math.max(0, Math.floor(spaces / 2));
    };

    // Todo — MUST be checked before bullet, or `- [ ] x` becomes a bullet.
    const todo = line.match(/^([ \t]*)[-*+] \[([ xX])\] (.*)$/);
    if (todo) {
      flushParagraph();
      const ind = indentOf(todo[1]);
      const b: Blk = {
        id: nanoid(10),
        type: "todo",
        text: todo[3],
        checked: todo[2].toLowerCase() === "x",
      };
      if (ind > 0) (b as { indent?: number }).indent = ind;
      out.push(b);
      i++;
      continue;
    }

    // Bullet
    const bullet = line.match(/^([ \t]*)[-*+] (.*)$/);
    if (bullet) {
      flushParagraph();
      const ind = indentOf(bullet[1]);
      const b: Blk = { id: nanoid(10), type: "bullet", text: bullet[2] };
      if (ind > 0) (b as { indent?: number }).indent = ind;
      out.push(b);
      i++;
      continue;
    }

    // Numbered — any digit run before ". ".
    const num = line.match(/^([ \t]*)\d+\. (.*)$/);
    if (num) {
      flushParagraph();
      const ind = indentOf(num[1]);
      const b: Blk = { id: nanoid(10), type: "numbered", text: num[2] };
      if (ind > 0) (b as { indent?: number }).indent = ind;
      out.push(b);
      i++;
      continue;
    }

    // Quote / callout. Our exporter writes callouts as `> {icon} {text}`,
    // so a `>` line whose payload starts with an emoji is a callout.
    const quote = line.match(/^> (.*)$/);
    if (quote) {
      flushParagraph();
      const body = quote[1];
      const em = body.match(EMOJI_LEAD);
      if (em) {
        const icon = em[0];
        const rest = body.slice(em[0].length).replace(/^\s+/, "");
        out.push({ id: nanoid(10), type: "callout", icon, text: rest });
      } else {
        out.push({ id: nanoid(10), type: "quote", text: body });
      }
      i++;
      continue;
    }

    // Toggle — `**title**` followed by ≥1 two-space-indented lines.
    // This mirrors the exporter, which writes toggle body indented by 2.
    // A bare `**text**` line without indented follow-up is left as text
    // (parsing it as toggle would clobber ordinary bold text).
    const toggle = line.match(/^\*\*(.+)\*\*$/);
    if (toggle && i + 1 < lines.length && /^ {2}\S/.test(lines[i + 1])) {
      flushParagraph();
      const title = toggle[1];
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && /^ {2}/.test(lines[i])) {
        bodyLines.push(lines[i].slice(2));
        i++;
      }
      out.push({
        id: nanoid(10),
        type: "toggle",
        text: title,
        body: bodyLines.join("\n"),
      });
      continue;
    }

    // Everything else: accumulate into a text paragraph.
    paragraph.push(line);
    i++;
  }
  flushParagraph();
  // Apply the parent+1 clamp — malformed imports (e.g. a bullet that jumps
  // from indent 0 to indent 2 with no parent between) must not produce
  // orphan levels. Only bullet/numbered/todo carry indent from the parser;
  // any other block resets prev to 0.
  const INDENTABLE = new Set(["bullet", "numbered", "todo", "text"]);
  let prev = 0;
  for (let k = 0; k < out.length; k++) {
    const b = out[k];
    const canIndent = INDENTABLE.has(b.type);
    const cur = typeof b.indent === "number" && b.indent > 0 ? b.indent : 0;
    const target = canIndent ? clampIndent(prev, cur) : 0;
    if (target !== cur) {
      if (target === 0) delete (b as { indent?: number }).indent;
      else (b as { indent?: number }).indent = target;
    }
    prev = target;
  }
  return out;
}
