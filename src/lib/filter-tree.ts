import { MAX_FILTER_DEPTH, groupFilters, isFilterGroup, type Filter } from "./run-view";

/* Editing an advanced filter (Notion's, 2026-10-30): one group of rules and
 * groups, addressed by a path of indexes from the group's own list ([2, 0]
 * is the first rule of the third item's group). A view holds at most one
 * advanced filter, beside its plain filters. Pure: every edit returns a new
 * group. */

export type FilterPath = number[];

export function newGroup(mode: "and" | "or" = "and", filters: Filter[] = []): Filter {
  return { op: "group", mode, filters };
}

/** The view's advanced filter, if it has one. */
export function advancedOf(filters: Filter[]): Filter | null {
  return filters.find(isFilterGroup) ?? null;
}

/** The view's filters with its advanced filter set (null takes it away).
 *  It stays where it was, or goes last. */
export function withAdvanced(filters: Filter[], group: Filter | null): Filter[] {
  const at = filters.findIndex(isFilterGroup);
  if (!group) return at < 0 ? filters : filters.filter((_, i) => i !== at);
  if (at < 0) return [...filters, group];
  return filters.map((f, i) => (i === at ? group : f));
}

export function getAt(group: Filter, path: FilterPath): Filter | null {
  let cur: Filter = group;
  for (const i of path) {
    const next = groupFilters(cur)[i];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** Change the group whose path is given (the root for []). */
function updateGroup(group: Filter, path: FilterPath, fn: (g: Filter) => Filter): Filter {
  if (path.length === 0) return fn(group);
  const [i, ...rest] = path;
  const list = groupFilters(group);
  if (!list[i] || !isFilterGroup(list[i])) return group;
  return { ...group, filters: list.map((f, j) => (j === i ? updateGroup(f, rest, fn) : f)) };
}

const parentOf = (path: FilterPath) => path.slice(0, -1);
const lastOf = (path: FilterPath) => path[path.length - 1];

export function setAt(group: Filter, path: FilterPath, next: Filter): Filter {
  if (path.length === 0) return next;
  return updateGroup(group, parentOf(path), (g) => ({
    ...g,
    filters: groupFilters(g).map((f, i) => (i === lastOf(path) ? next : f)),
  }));
}

export function removeAt(group: Filter, path: FilterPath): Filter {
  if (path.length === 0) return newGroup(group.mode);
  return updateGroup(group, parentOf(path), (g) => ({
    ...g,
    filters: groupFilters(g).filter((_, i) => i !== lastOf(path)),
  }));
}

/** Add to the end of the group at `groupPath`. */
export function appendTo(group: Filter, groupPath: FilterPath, item: Filter): Filter {
  return updateGroup(group, groupPath, (g) => ({ ...g, filters: [...groupFilters(g), item] }));
}

/** A copy right below the original. */
export function duplicateAt(group: Filter, path: FilterPath): Filter {
  const item = getAt(group, path);
  if (!item || path.length === 0) return group;
  const copy = JSON.parse(JSON.stringify(item)) as Filter;
  return updateGroup(group, parentOf(path), (g) => {
    const list = [...groupFilters(g)];
    list.splice(lastOf(path) + 1, 0, copy);
    return { ...g, filters: list };
  });
}

/** A rule becomes a group holding it, so others can join it. */
export function turnIntoGroup(group: Filter, path: FilterPath): Filter {
  const item = getAt(group, path);
  if (!item || isFilterGroup(item) || !canNestAt(path)) return group;
  return setAt(group, path, newGroup("and", [item]));
}

export function setMode(group: Filter, groupPath: FilterPath, mode: "and" | "or"): Filter {
  return updateGroup(group, groupPath, (g) => ({ ...g, mode }));
}

/** Can a group go where `path` points? The view's list is level 1 and the
 *  advanced filter level 2, so its items may be groups (level 3), and
 *  theirs may not. */
export function canNestAt(path: FilterPath): boolean {
  return path.length + 2 <= MAX_FILTER_DEPTH;
}
