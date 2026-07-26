import { createContext, useContext } from "react";

// Records where the user opened a page from, so the topbar breadcrumb can
// say "Areas / Ops / Title" or "My views / Assigned to me / Title" rather
// than the useless "Page / Title" fallback.


export type PageOrigin =
  | { kind: "view"; viewId: string; viewName: string; scope: "team" | "personal" }
  | { kind: "area"; area: string }
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
    return raw ? (JSON.parse(raw) as PageOrigin) : null;
  } catch {
    return null;
  }
}
