import { createContext, useContext } from "react";

// Records where the user opened a page from, so the topbar can offer a way
// back to the database view they came from rather than a plain "Back".

export type PageOrigin =
  | { kind: "database"; databaseId: string; viewId: string | null; name: string }
  | { kind: "search" };

const KEY = "gio.page-origin.";

export function setPageOrigin(pageId: string, origin: PageOrigin) {
  try {
    sessionStorage.setItem(KEY + pageId, JSON.stringify(origin));
  } catch {
    /* ignore */
  }
}

export function getPageOrigin(pageId: string): PageOrigin | null {
  try {
    const raw = sessionStorage.getItem(KEY + pageId);
    if (!raw) return null;
    const o = JSON.parse(raw) as { kind?: string };
    // Origins written before databases (views, areas) no longer resolve.
    if (o.kind !== "database" && o.kind !== "search") return null;
    return o as PageOrigin;
  } catch {
    return null;
  }
}

export const PageOriginContext = createContext<PageOrigin | null>(null);

export function useSetPageOrigin() {
  const origin = useContext(PageOriginContext);
  return (pageId: string, override?: PageOrigin) => {
    const o = override ?? origin;
    if (o) setPageOrigin(pageId, o);
  };
}
