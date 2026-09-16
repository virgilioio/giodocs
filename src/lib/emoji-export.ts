/**
 * emoji-export — the two halves of "make a custom emoji survive an export".
 *
 * The export serialisers are SYNCHRONOUS by contract (toHtml is reached
 * from the block-selection clipboard path via blocksHtmlFragment; making
 * it async would reopen a documented problem). So the work splits:
 *
 *   collectEmojiNames   PURE. Which shortcodes does this page use?
 *   resolveEmojiDataUris  async. Fetch each one ONCE, base64 it.
 *
 * The caller does the async half BEFORE calling toHtml and hands the
 * resulting Map in on ExportContext.emoji. An exported file therefore
 * still opens with ZERO external requests — the self-containment
 * invariant is met by embedding, exactly as GIO_DOCS_LOGO_DATA_URI does,
 * not by degrading the emoji to text.
 *
 * ⚠ There is exactly ONE inline tokenizer in this codebase
 * (inline-tokens.ts). This module reuses it rather than scanning for
 * ":name:" itself — a second scanner would drift from the renderer.
 */

import type { Block } from "./types";
import { tokenizeInline, type InlineToken } from "./inline-tokens";
import { isShortcode } from "./custom-emoji";
import type { InlineEmoji } from "./emoji-registry";

/* ─────────────────────────── collectEmojiNames ─────────────────────────── */

function walkTokens(tokens: readonly InlineToken[], out: Set<string>): void {
  for (const t of tokens) {
    if (t.kind === "emoji") {
      out.add(t.name);
      continue;
    }
    if (
      t.kind === "bold" ||
      t.kind === "italic" ||
      t.kind === "strike" ||
      t.kind === "highlight" ||
      t.kind === "underline" ||
      t.kind === "link"
    ) {
      walkTokens(t.children, out);
    }
  }
}

function scanText(s: unknown, set: readonly InlineEmoji[], out: Set<string>): void {
  if (typeof s !== "string" || !s || s.indexOf(":") < 0) return;
  // Pass the FULL set as the known-names universe: a page may reference an
  // emoji this caller's set knows about even if it never resolves later.
  walkTokens(tokenizeInline(s, { emoji: set }), out);
}

function addIcon(icon: unknown, out: Set<string>): void {
  if (typeof icon !== "string") return;
  if (isShortcode(icon)) out.add(icon.slice(1, -1));
}

function scanBlocks(
  blocks: readonly unknown[],
  set: readonly InlineEmoji[],
  out: Set<string>,
): void {
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    scanText(b.text, set, out);
    scanText(b.body, set, out);
    addIcon(b.icon, out);
    if (Array.isArray(b.children)) scanBlocks(b.children as unknown[], set, out);
    if (Array.isArray(b.cols)) {
      for (const col of b.cols as unknown[]) {
        if (Array.isArray(col)) scanBlocks(col as unknown[], set, out);
      }
    }
    if (Array.isArray(b.rows)) {
      for (const row of b.rows as unknown[]) {
        if (!Array.isArray(row)) continue;
        for (const cell of row as unknown[]) scanText(cell, set, out);
      }
    }
  }
}

/**
 * Every DISTINCT custom-emoji shortcode name the page uses — inline text
 * (recursing into callout children, column contents, toggle bodies and
 * table cells), callout icons, and the page's own icon. Sorted, deduped.
 * Pure: no DOM, no fetch.
 *
 * `set` is the known-name universe the tokenizer needs (":x:" is only an
 * emoji token when x is known). It defaults to the module registry inside
 * tokenizeInline when omitted.
 */
export function collectEmojiNames(
  blocks: readonly Block[] | readonly unknown[] | null | undefined,
  icon?: string | null,
  set?: readonly InlineEmoji[],
): string[] {
  const out = new Set<string>();
  const universe = set ?? [];
  addIcon(icon, out);
  if (Array.isArray(blocks)) scanBlocks(blocks as unknown[], universe, out);
  return [...out].sort();
}

/* ─────────────────────────── resolveEmojiDataUris ─────────────────────────── */

/** 4 MB of embedded emoji is already far past "a document"; beyond it a
 * browser starts to struggle opening the file at all. */
export const EMOJI_EMBED_BUDGET = 4 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  if (typeof btoa === "function") return btoa(bin);
  return Buffer.from(bytes).toString("base64");
}

/**
 * name → `data:image/…;base64,…`, fetched from the set's signed URLs.
 *
 * A failure is SKIPPED, never thrown: the renderer falls back to alt text
 * for any name missing from the map, which is exactly today's behaviour.
 * Total embedded bytes are capped; one console.warn when the cap trips.
 */
export async function resolveEmojiDataUris(
  names: readonly string[],
  set: readonly InlineEmoji[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!names.length) return out;
  const byName = new Map(set.map((e) => [e.name, e.url]));

  const fetched = await Promise.all(
    names.map(async (name) => {
      const url = byName.get(name);
      if (!url) return null;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length === 0) return null;
        const type = res.headers?.get?.("content-type") || "image/png";
        const mime = type.split(";")[0].trim() || "image/png";
        return { name, uri: `data:${mime};base64,${toBase64(buf)}`, bytes: buf.length };
      } catch {
        return null;
      }
    }),
  );

  let total = 0;
  let capped = false;
  for (const r of fetched) {
    if (!r) continue;
    if (total + r.bytes > EMOJI_EMBED_BUDGET) {
      capped = true;
      continue;
    }
    total += r.bytes;
    out.set(r.name, r.uri);
  }
  if (capped) {
    console.warn(
      `[export] custom emoji embedding capped at ${EMOJI_EMBED_BUDGET} bytes; some emoji export as their shortcode text.`,
    );
  }
  return out;
}
