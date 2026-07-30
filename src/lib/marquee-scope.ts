/* Marquee SCOPE — which rows a band may select.
 *
 * The bug this file exists to prevent: a marquee started inside a column
 * selected the whole `columns` block, because selection only ever
 * considered TOP-LEVEL rows and the columns block's row spans the entire
 * column area.
 *
 * THE RULE: a marquee operates within the container WHERE IT STARTED.
 *   - started on the page background  → scope is null (page). It sees
 *     top-level rows only; a columns block or a callout is selected AS A
 *     UNIT and its children are invisible to the band.
 *   - started inside a column track or a callout body → scope is that
 *     container. It sees THAT container's children only: never the parent,
 *     never a sibling column, never a top-level block.
 *
 * A selection can therefore never span two containers.
 *
 * Pure on purpose: the editor measures rows and records each row's owning
 * container; this module decides membership.
 */

import type { ColumnRef } from "./reorder";

/** `null` means the top-level (page) list. */
export type ScopeRef = ColumnRef | null;

export type ScopedRow = { id: string; scope: ScopeRef };

const isCallout = (r: ColumnRef): boolean =>
  (r as { callout?: unknown }).callout === true;

/** Structural equality for two scopes. */
export function sameScope(a: ScopeRef, b: ScopeRef): boolean {
  if (a === null || b === null) return a === b;
  if (a.blockId !== b.blockId) return false;
  const ac = isCallout(a);
  const bc = isCallout(b);
  if (ac !== bc) return false;
  if (ac) return true;
  return (
    (a as { colIndex: number }).colIndex === (b as { colIndex: number }).colIndex
  );
}

/** Filter candidate rows down to the ones the marquee is allowed to touch,
 *  preserving input order. */
export function rowsInScope<R extends ScopedRow>(
  scope: ScopeRef,
  rows: readonly R[],
): R[] {
  return rows.filter((r) => sameScope(r.scope, scope));
}
