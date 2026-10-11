/* A person property's value (2026-10-11): one member id, or a list of them
 * when the property has no limit (Notion's "Limit: No limit"). Old values
 * are single ids; everything that reads a person reads both shapes here.
 * The database checks the same (validate_page_props, person_ids). Pure. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The people a value names, in order, without repeats. */
export function personIds(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const out: string[] = [];
  for (const x of list) if (typeof x === "string" && x && !out.includes(x)) out.push(x);
  return out;
}

/** Whether the property holds one person at most (config.limit = 1). */
export function onePersonOnly(def: { config?: unknown } | null | undefined): boolean {
  const c = def?.config as { limit?: unknown } | null | undefined;
  return c?.limit === 1;
}

/** The value to store for these people. */
export function personValue(ids: string[], one: boolean): string | string[] | null {
  if (ids.length === 0) return null;
  return one ? ids[0] : ids;
}

/** Picking a person: with a limit it replaces; without, it adds or takes
 *  them off the list. */
export function togglePerson(current: unknown, id: string, one: boolean): string | string[] | null {
  if (one) return id;
  const ids = personIds(current);
  return personValue(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id], false);
}

export function isPersonId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
