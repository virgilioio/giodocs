import { describe, it, expect } from "vitest";
import {
  ancestorsOf,
  blockedParents,
  childrenOf,
  depthOf,
  descendantsOf,
  flattenTree,
  placementRows,
  type TreePage,
} from "./page-tree";

function p(
  id: string,
  parent_id: string | null,
  extra: Partial<TreePage> = {},
): TreePage {
  return {
    id,
    title: extra.title ?? id.toUpperCase(),
    parent_id,
    edited_at: extra.edited_at ?? `2026-01-01T00:00:0${id.length}Z`,
    props: extra.props ?? {},
  };
}

describe("descendantsOf", () => {
  it("reaches grandchildren", () => {
    const pages = [p("a", null), p("b", "a"), p("c", "b"), p("d", null)];
    expect([...descendantsOf("a", pages)].sort()).toEqual(["b", "c"]);
  });

  it("terminates on a cyclic array", () => {
    const pages = [p("a", "c"), p("b", "a"), p("c", "b")];
    const out = descendantsOf("a", pages);
    expect(out.has("b")).toBe(true);
    expect(out.has("c")).toBe(true);
    expect(out.has("a")).toBe(false);
  });
});

describe("blockedParents", () => {
  it("holds the page, its child and its grandchild", () => {
    const pages = [p("a", null), p("b", "a"), p("c", "b")];
    expect([...blockedParents("a", pages)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("ancestorsOf / depthOf", () => {
  const pages = [p("a", null), p("b", "a"), p("c", "b")];

  it("is root-first and excludes the page", () => {
    expect(ancestorsOf("c", pages).map((x) => x.id)).toEqual(["a", "b"]);
    expect(depthOf("c", pages)).toBe(2);
    expect(depthOf("a", pages)).toBe(0);
  });

  it("returns a partial chain when a mid-chain parent is hidden", () => {
    const visible = [p("c", "b"), p("a", null)];
    expect(ancestorsOf("c", visible)).toEqual([]);
    const partial = [p("d", "c"), p("c", "b"), p("a", null)];
    expect(ancestorsOf("d", partial).map((x) => x.id)).toEqual(["c"]);
  });
});

describe("childrenOf", () => {
  it("returns direct children, most-recently-edited first", () => {
    const pages = [
      p("a", null),
      p("b", "a", { edited_at: "2026-01-01T00:00:00Z" }),
      p("c", "a", { edited_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(childrenOf("a", pages).map((x) => x.id)).toEqual(["c", "b"]);
  });
});

describe("flattenTree", () => {
  it("omits a page whose parent is set but absent, and its children", () => {
    const pages = [p("child", "hidden"), p("grand", "child"), p("root", null)];
    const rows = flattenTree(pages, new Set(["child", "root"]));
    expect(rows.map((r) => r.page.id)).toEqual(["root"]);
  });

  it("has correct depths for a 3-level chain", () => {
    const pages = [p("a", null), p("b", "a"), p("c", "b")];
    const rows = flattenTree(pages, new Set(["a", "b"]));
    expect(rows.map((r) => [r.page.id, r.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("collapsed parents do not emit children", () => {
    const pages = [p("a", null), p("b", "a"), p("c", "b")];
    const rows = flattenTree(pages, new Set());
    expect(rows.map((r) => r.page.id)).toEqual(["a"]);
    expect(rows[0]!.hasKids).toBe(true);
    expect(rows[0]!.expanded).toBe(false);
  });
});

describe("placementRows", () => {
  const pages = [
    p("me", null, { title: "Me" }),
    p("kid", "me", { title: "Kid" }),
    p("grand", "kid", { title: "Grand" }),
    p("roadmap", null, { title: "Roadmap", props: { area: "Product" } }),
    p("notes", "roadmap", { title: "Notes" }),
  ];

  it("create row sinks last when there are matches", () => {
    const rows = placementRows("road", pages, "me");
    expect(rows[0]).toMatchObject({ kind: "page" });
    expect(rows[rows.length - 1]).toMatchObject({ kind: "create" });
  });

  it("create row leads when nothing matches", () => {
    const rows = placementRows("zzz", pages, "me");
    expect(rows).toEqual([{ kind: "create", title: "zzz" }]);
  });

  it("create row is absent on an exact title match", () => {
    const rows = placementRows("roadmap", pages, "me");
    expect(rows.some((r) => r.kind === "create")).toBe(false);
  });

  it("excludes self, descendants and pages already parented here", () => {
    const ids = placementRows("", pages, "me").map((r) =>
      r.kind === "page" ? r.page.id : "create",
    );
    expect(ids).not.toContain("me");
    expect(ids).not.toContain("kid");
    expect(ids).not.toContain("grand");
    expect(ids).toContain("roadmap");
  });

  it("hint names the current parent or unfiled", () => {
    const rows = placementRows("", pages, "me");
    const byId = new Map(
      rows.flatMap((r) => (r.kind === "page" ? [[r.page.id, r.hint]] : [])),
    );
    expect(byId.get("roadmap")).toBe("unfiled");
    expect(byId.get("notes")).toBe("Roadmap");
  });

  it("filters on area too", () => {
    const ids = placementRows("product", pages, "me").flatMap((r) =>
      r.kind === "page" ? [r.page.id] : [],
    );
    expect(ids).toEqual(["roadmap"]);
  });
});
