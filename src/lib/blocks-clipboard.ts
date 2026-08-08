/**
 * Pure clipboard payload for a block selection.
 *
 * Copy/cut of a block-selection writes TWO representations onto the
 * system clipboard: `text/plain` (Markdown, via `blockToMarkdown` — the
 * same string parsePasteToBlocks reads back) and `text/html` (the same
 * HTML `toHtml` uses for exports). The dual payload matters for the
 * cross-app migration this product supports: pasting into Notion, Word
 * or Google Docs picks up the HTML and arrives formatted; a plain-only
 * copy would land as literal `**` and `#` characters.
 *
 * `blocksToClipboard` is the pure part — computing the two strings —
 * and is unit-tested in isolation. `writeBlocksClipboard` is the small
 * async wrapper that actually calls the browser clipboard, using a
 * `ClipboardItem` with both MIME types and falling back to
 * `writeText(markdown)` when `ClipboardItem` or `clipboard.write` is
 * absent.
 */
import type { Block } from "./types";
import { blockToMarkdown, blocksHtmlFragment } from "./export";
import { numberedOrdinals } from "./blocks";

export function blocksToClipboard(
  blocks: readonly Block[],
): { markdown: string; html: string } {
  const ords = numberedOrdinals(blocks);
  const markdown = blocks
    .map((b) => {
      const ord = b.type === "numbered" && b.id ? (ords.get(b.id) ?? 1) : 1;
      return blockToMarkdown(b, ord);
    })
    .join("\n\n");
  const html = blocksHtmlFragment(blocks);
  return { markdown, html };
}

export async function writeBlocksClipboard(
  blocks: readonly Block[],
): Promise<void> {
  const { markdown, html } = blocksToClipboard(blocks);
  // ONE clipboard path — src/lib/clipboard.ts — so a rejected promise in a
  // sandboxed frame can never escape as an unhandled rejection.
  toClipboardRich(markdown, html);
}

