/**
 * Shared, pure block utilities used by both the editable body and the
 * export/read-only paths. The ordinal of a `numbered` block is a property
 * of its position in a RUN of consecutive numbered blocks — never a
 * property of the element itself. A single `<ol><li>` per block therefore
 * always renders "1."; this module supplies the correct ordinal instead.
 */

import type { Block } from "./types";

/**
 * Walk `blocks` once. For each block of type "numbered", the ordinal is
 * 1 + the count of immediately preceding CONSECUTIVE "numbered" blocks;
 * any non-numbered block resets the run. Keys are block ids.
 * Blocks without an id are skipped in the output but still reset/participate
 * in the running count based on their type.
 */
export function numberedOrdinals(blocks: readonly Block[]): Map<string, number> {
  const out = new Map<string, number>();
  let run = 0;
  for (const b of blocks) {
    if (b && b.type === "numbered") {
      run += 1;
      if (typeof b.id === "string" && b.id) out.set(b.id, run);
    } else {
      run = 0;
    }
  }
  return out;
}
