/* What restoring a version would change, in words. Pure.
 *
 * Blocks are matched by id at every depth (callout and toggle children,
 * column contents). A block counts as edited when its own fields differ;
 * a change inside a child counts once, on the child. */

type AnyBlock = { id?: unknown; children?: unknown; cols?: unknown; [k: string]: unknown };

export type VersionSide = { title: string; icon: string | null; blocks: readonly unknown[] };

export type VersionDiff = {
  /** In the version, not on the page now: restoring brings them back. */
  missing: number;
  /** On both, but different: restoring reverts them. */
  changed: number;
  /** On the page now, not in the version: restoring removes them. */
  added: number;
  titleChanged: boolean;
  iconChanged: boolean;
};

/** Empty values and defaults the editor fills in (indent 0, checked false,
 *  an empty caption) say nothing about the content. */
function isEmptyValue(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    v === "" ||
    v === false ||
    v === 0 ||
    (Array.isArray(v) && v.length === 0)
  );
}

function own(b: AnyBlock): string {
  const rest: Record<string, unknown> = {};
  for (const k of Object.keys(b).sort()) {
    if (k === "children" || k === "cols" || isEmptyValue(b[k])) continue;
    rest[k] = b[k];
  }
  return JSON.stringify(rest);
}

function index(blocks: readonly unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const b = raw as AnyBlock;
      if (typeof b.id === "string") out.set(b.id, own(b));
      walk(b.children);
      if (Array.isArray(b.cols)) for (const col of b.cols) walk(col);
    }
  };
  walk(blocks);
  return out;
}

/** Blocks that are only an empty paragraph don't count: every page has one. */
function isBlank(json: string): boolean {
  try {
    const b = JSON.parse(json) as AnyBlock;
    return b.type === "text" && !String(b.text ?? "").trim();
  } catch {
    return false;
  }
}

export function diffVersion(version: VersionSide, now: VersionSide): VersionDiff {
  const v = index(version.blocks);
  const n = index(now.blocks);
  let missing = 0;
  let changed = 0;
  let added = 0;
  for (const [id, json] of v) {
    const cur = n.get(id);
    if (cur === undefined) {
      if (!isBlank(json)) missing++;
    } else if (cur !== json) changed++;
  }
  for (const [id, json] of n) if (!v.has(id) && !isBlank(json)) added++;
  return {
    missing,
    changed,
    added,
    titleChanged: (version.title || "") !== (now.title || ""),
    iconChanged: (version.icon || "") !== (now.icon || ""),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "Restoring brings back 1 block, reverts 2 edited blocks and removes 3
 *  newer blocks." — or that it changes nothing. */
export function describeDiff(d: VersionDiff, versionTitle: string): string {
  const parts: string[] = [];
  if (d.titleChanged) parts.push(`renames the page to “${versionTitle || "Untitled"}”`);
  if (d.missing) parts.push(`brings back ${plural(d.missing, "block", "blocks")}`);
  if (d.changed) parts.push(`reverts ${plural(d.changed, "edited block", "edited blocks")}`);
  if (d.added) parts.push(`removes ${plural(d.added, "newer block", "newer blocks")}`);
  if (d.iconChanged) parts.push("puts back its old icon");
  if (parts.length === 0) return "This version has the same content as the page now.";
  return `Restoring ${joinParts(parts)}.`;
}
