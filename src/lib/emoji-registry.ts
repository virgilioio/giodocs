/**
 * emoji-registry — THE one place the inline layer reads the workspace's
 * custom emoji set from.
 *
 * ⚠ WHY THIS EXISTS AND WHY IT IS A MODULE, NOT A PROP
 * tokenizeInline is consumed by BOTH the renderer (inline-markdown.tsx)
 * and the offset map (ce-offsets.ts). If those two ever disagree about
 * whether ":brand:" is an emoji token, the caret resolves to the wrong
 * SOURCE index and a ⌘B inserts delimiters in the wrong place — text
 * corrupting as the user types. A shortcode token is SET-DEPENDENT, so
 * the set has to reach every consumer, including the ones several
 * key-handlers deep (caret-shim, block-key-handler, floating-toolbar).
 *
 * Threading it as a prop through all of those is how one site silently
 * defaults to an empty set. Instead every consumer defaults to THIS
 * registry, so "same set from the same source" is true by construction.
 * Tests pass an explicit opts object to exercise a populated set.
 *
 * The registry is written once per fetch by <EmojiRegistrySync/> (see
 * app-shell.tsx) from the same useEmojiSet() query every <Ico> reads.
 */

import { useSyncExternalStore } from "react";
import type { CustomEmoji } from "./custom-emoji";

/** The minimum shape the inline layer needs: a name and a paintable URL. */
export type InlineEmoji = { name: string; url: string; description?: string };

let current: readonly InlineEmoji[] = [];
let version = 0;
const listeners = new Set<() => void>();

/** Replace the set. No-ops when nothing actually changed. */
export function setInlineEmojiSet(next: readonly CustomEmoji[]): void {
  const mapped: InlineEmoji[] = next.map((e) => ({
    name: e.name,
    url: e.url,
    description: e.description,
  }));
  const same =
    mapped.length === current.length &&
    mapped.every(
      (e, i) => e.name === current[i].name && e.url === current[i].url,
    );
  if (same) return;
  current = mapped;
  version += 1;
  for (const l of listeners) l();
}

/** The set every inline consumer defaults to. Never null. */
export function getInlineEmojiSet(): readonly InlineEmoji[] {
  return current;
}

/** Bumped whenever the set changes — an uncontrolled editor repaint key. */
export function inlineEmojiVersion(): number {
  return version;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Re-render on set changes without a React context or a query client. */
export function useInlineEmojiVersion(): number {
  return useSyncExternalStore(subscribe, inlineEmojiVersion, () => 0);
}

/** The set, as a hook. Safe outside a QueryClientProvider (tests). */
export function useInlineEmojiSet(): readonly InlineEmoji[] {
  useInlineEmojiVersion();
  return current;
}

/** Test seam. */
export function __resetInlineEmojiSet(): void {
  current = [];
  version += 1;
  for (const l of listeners) l();
}
