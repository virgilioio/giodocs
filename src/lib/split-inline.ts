/**
 * Split an inline-markdown source at a caret without breaking its marks.
 *
 * Cutting "say **hello world** now" after "hello" gives "say **hello**"
 * and "** world** now": every mark that encloses the caret is closed on the
 * left and re-opened on the right. A caret inside a delimiter or an emoji shortcode moves to the
 * nearest token edge, so no half-delimiter ever leaks into either side.
 *
 * Uses the one tokenizer (inline-tokens.ts); never re-parses the grammar.
 */
import { tokenizeInline, type InlineOpts, type InlineToken } from "./inline-tokens";

export function splitInlineSource(
  source: string,
  caret: number,
  opts?: InlineOpts,
): [string, string] {
  const src = source ?? "";
  let cut = Math.max(0, Math.min(caret, src.length));
  const closes: string[] = []; // innermost last
  const opens: string[] = []; // outermost first

  const walk = (tokens: InlineToken[]) => {
    for (const t of tokens) {
      if (cut <= t.sourceStart || cut >= t.sourceEnd) continue;
      if (t.kind === "text") {
        // An escape like "\*" is one token of width 2: never split it.
        if (t.sourceEnd - t.sourceStart > 1) cut = t.sourceEnd;
        return;
      }
      if (t.kind === "emoji") {
        cut = t.sourceEnd;
        return;
      }
      if (t.kind === "code") {
        const innerStart = t.sourceStart + 1;
        const innerEnd = t.sourceEnd - 1;
        if (cut <= innerStart) cut = t.sourceStart;
        else if (cut >= innerEnd) cut = t.sourceEnd;
        else {
          closes.push("`");
          opens.push("`");
        }
        return;
      }
      const innerStart = t.sourceStart + t.openLen;
      const innerEnd = t.sourceEnd - t.closeLen;
      if (cut <= innerStart) {
        cut = t.sourceStart;
        return;
      }
      if (cut >= innerEnd) {
        cut = t.sourceEnd;
        return;
      }
      opens.push(src.slice(t.sourceStart, innerStart));
      closes.push(src.slice(innerEnd, t.sourceEnd));
      walk(t.children);
      return;
    }
  };
  walk(tokenizeInline(src, opts));

  const left = src.slice(0, cut) + closes.slice().reverse().join("");
  const right = opens.join("") + src.slice(cut);
  return [left, right];
}
