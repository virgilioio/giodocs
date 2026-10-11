import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_PREFS,
  greetingFor,
  greetingName,
  readHomePrefs,
  recentPages,
  startTarget,
  withVisit,
} from "./home";

const at = (h: number) => new Date(2026, 9, 10, h, 30);

describe("greetingFor", () => {
  it("follows the time of day", () => {
    expect(greetingFor(at(6))).toBe("Good morning");
    expect(greetingFor(at(11))).toBe("Good morning");
    expect(greetingFor(at(12))).toBe("Good afternoon");
    expect(greetingFor(at(16))).toBe("Good afternoon");
    expect(greetingFor(at(17))).toBe("Good evening");
    expect(greetingFor(at(2))).toBe("Good evening");
  });
});

describe("greetingName", () => {
  it("prefers the nickname, then the first name, then the email", () => {
    expect(greetingName("  Al ", "Allan Smith", "allan@x.io")).toBe("Al");
    expect(greetingName("", "Allan Smith", "allan@x.io")).toBe("Allan");
    expect(greetingName(null, "  ", "allan@x.io")).toBe("allan");
    expect(greetingName(null, null, null)).toBe("");
  });
});

const pages = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("recentPages", () => {
  it("keeps visit order, drops pages that can't be opened, limits", () => {
    const visits = [
      { page_id: "c", visited_at: "3" },
      { page_id: "gone", visited_at: "2" },
      { page_id: "a", visited_at: "1" },
    ];
    expect(recentPages(visits, pages).map((p) => p.id)).toEqual(["c", "a"]);
    expect(recentPages(visits, pages, 1).map((p) => p.id)).toEqual(["c"]);
    expect(recentPages(visits, pages)[0].visited_at).toBe("3");
  });
});

describe("startTarget", () => {
  const visits = [{ page_id: "gone", visited_at: "2" }, { page_id: "b", visited_at: "1" }];
  it("opens Home by default", () => {
    expect(startTarget("home", visits, pages)).toEqual({ to: "home" });
  });
  it("opens the last page that can still be opened", () => {
    expect(startTarget("last", visits, pages)).toEqual({ to: "page", id: "b" });
    expect(startTarget("last", [], pages)).toEqual({ to: "home" });
  });
});

describe("withVisit", () => {
  it("moves the page to the front", () => {
    const v = withVisit([{ page_id: "a", visited_at: "1" }, { page_id: "b", visited_at: "0" }], "b", "2");
    expect(v).toEqual([{ page_id: "b", visited_at: "2" }, { page_id: "a", visited_at: "1" }]);
  });
});

describe("readHomePrefs", () => {
  it("reads defensively", () => {
    expect(readHomePrefs(null)).toEqual(DEFAULT_HOME_PREFS);
    expect(readHomePrefs({ start_page: "weird", hidden: ["x", 3], nickname: 5 })).toEqual({
      ...DEFAULT_HOME_PREFS,
      hidden: ["x"],
    });
    expect(readHomePrefs({ start_page: "last", emoji: "🌿" }).start_page).toBe("last");
  });
});

describe("pins, hidden sections and recent edits", () => {
  it("toggles", async () => {
    const { togglePinned, toggleHidden, recentlyUpdated } = await import("./home");
    expect(togglePinned(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePinned(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleHidden([], "tasks")).toEqual(["tasks"]);
    expect(toggleHidden(["tasks"], "tasks")).toEqual([]);
    const pages = [
      { id: "a", edited_at: "2026-10-01" },
      { id: "b", edited_at: "2026-10-03" },
      { id: "c", edited_at: null },
    ];
    expect(recentlyUpdated(pages).map((p) => p.id)).toEqual(["b", "a"]);
    expect(recentlyUpdated(pages, 1).map((p) => p.id)).toEqual(["b"]);
  });
});

describe("favorites", () => {
  it("toggles and lists the pages the person can open, in starred order", async () => {
    const { toggleFavorite, favoritePages, readHomePrefs } = await import("./home");
    expect(toggleFavorite(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFavorite(["a", "b"], "a")).toEqual(["b"]);
    const pages = [{ id: "a" }, { id: "b", archived_at: "x" }, { id: "c" }];
    expect(favoritePages(["c", "gone", "b", "a"], pages).map((p) => p.id)).toEqual(["c", "a"]);
    expect(readHomePrefs({ favorite_pages: ["a", 3] }).favorite_pages).toEqual(["a"]);
  });
});
