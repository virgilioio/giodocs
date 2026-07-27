/**
 * parseMarkdown — inverse of blockToMarkdown in export.ts.
 *
 * Supports exactly the twelve block types: text, h1, h2, bullet, numbered,
 * todo, toggle, quote, callout, divider, code, table. Line-based scan; no
 * dependencies (no turndown, no marked, no remark).
 *
 * INLINE FORMATTING IS PRESERVED AS LITERAL CHARACTERS.
 * Blk.text is a plain string with no inline model, so "**bold**",
 * "*italic*", "[a](b)" survive verbatim. Do NOT strip these markers (that
 * loses information) and do NOT invent an inline model here — that would
 * touch every renderer, both serialisers, and the search vector, and is
 * out of scope for markdown import. The next person: please don't "fix"
 * this.
 */

import { nanoid } from "nanoid";
import type { Block } from "./types";

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
      const rows: string[][] = [parseRow(line)];
      i += 2; // skip header + separator
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      out.push({ id: nanoid(10), type: "table", text: "", rows });
      continue;
    }

    // Headings: `# `, and `## ` (also `### ` and deeper collapse to h2).
    const h1 = line.match(/^# (.*)$/);
    if (h1) {
      flushParagraph();
      out.push({ id: nanoid(10), type: "h1", text: h1[1] });
      i++;
      continue;
    }
    const hMulti = line.match(/^#{2,6} (.*)$/);
    if (hMulti) {
      flushParagraph();
      out.push({ id: nanoid(10), type: "h2", text: hMulti[1] });
      i++;
      continue;
    }

    // Todo — MUST be checked before bullet, or `- [ ] x` becomes a bullet.
    const todo = line.match(/^[-*+] \[([ xX])\] (.*)$/);
    if (todo) {
      flushParagraph();
      out.push({
        id: nanoid(10),
        type: "todo",
        text: todo[2],
        checked: todo[1].toLowerCase() === "x",
      });
      i++;
      continue;
    }

    // Bullet
    const bullet = line.match(/^[-*+] (.*)$/);
    if (bullet) {
      flushParagraph();
      out.push({ id: nanoid(10), type: "bullet", text: bullet[1] });
      i++;
      continue;
    }

    // Numbered — any digit run before ". ".
    const num = line.match(/^\d+\. (.*)$/);
    if (num) {
      flushParagraph();
      out.push({ id: nanoid(10), type: "numbered", text: num[1] });
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
  return out;
}
