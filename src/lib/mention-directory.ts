/**
 * mention-directory — who and what an @mention points at, by id.
 *
 * A mention is stored in a block's text as "@[label](user:<id>)" or
 * "@[](page:<id>)". What it SHOWS comes from here, so a renamed person or
 * page reads correctly everywhere without rewriting any page. Like the
 * emoji registry, it's a module (not a prop) so every inline renderer reads
 * the same data; <MentionDirectorySync/> in app-shell.tsx fills it from
 * the workspace's members and the pages this person can read.
 *
 * A page mention whose page isn't here is one this person can't open (or
 * that was deleted): it reads "Private page" and never shows a title.
 */

import { useSyncExternalStore } from "react";

export type MentionPage = { title: string; icon: string | null };

let users: ReadonlyMap<string, string> = new Map();
let pages: ReadonlyMap<string, MentionPage> = new Map();
let ready = false;
let version = 0;
const listeners = new Set<() => void>();

function sameMap<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>, eq: (x: V, y: V) => boolean): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined || !eq(v, w)) return false;
  }
  return true;
}

/** Replace the directory. No-ops when nothing changed. */
export function setMentionDirectory(next: {
  users: ReadonlyMap<string, string>;
  pages: ReadonlyMap<string, MentionPage>;
}): void {
  const sameUsers = sameMap(users, next.users, (x, y) => x === y);
  const samePages = sameMap(pages, next.pages, (x, y) => x.title === y.title && x.icon === y.icon);
  if (sameUsers && samePages && ready) return;
  ready = true;
  users = next.users;
  pages = next.pages;
  version += 1;
  for (const l of listeners) l();
}

/** False until the first fill: a page that isn't known yet may just not
 *  be loaded, so it isn't called private. */
export function mentionDirectoryReady(): boolean {
  return ready;
}

export function mentionUserName(id: string): string | undefined {
  return users.get(id);
}

export function mentionPage(id: string): MentionPage | undefined {
  return pages.get(id);
}

/** Every person, for the @ menu. */
export function mentionUsers(): ReadonlyMap<string, string> {
  return users;
}

/** Every page this person can open, for the @ menu. */
export function mentionPages(): ReadonlyMap<string, MentionPage> {
  return pages;
}

export function mentionDirectoryVersion(): number {
  return version;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Re-render when names or titles change. */
export function useMentionDirectoryVersion(): number {
  return useSyncExternalStore(subscribe, mentionDirectoryVersion, () => 0);
}

/** Test seam. */
export function __resetMentionDirectory(): void {
  users = new Map();
  pages = new Map();
  ready = false;
  version += 1;
}
