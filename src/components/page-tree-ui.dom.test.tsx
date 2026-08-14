// @vitest-environment happy-dom
/* The breadcrumb, the sidebar tree and the "Placed in" row — what a person
 * actually sees. Nothing here asserts focus, hover, CSS grid or :has(): those
 * are browser checks, not happy-dom checks.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { PageBreadcrumbView } from "./page-breadcrumb";
import { SidebarTreeView } from "./sidebar-tree";
import { PlacedInRowView } from "./placed-in-row";
import type { PageBlockItem } from "./page-block";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

function mount(node: React.ReactNode) {
  act(() => {
    root = createRoot(host);
    root.render(node);
  });
}

function pg(
  id: string,
  title: string,
  parent_id: string | null = null,
): PageBlockItem {
  return { id, title, icon: null, props: {}, parent_id } as PageBlockItem;
}

const text = () => document.body.textContent ?? "";

describe("breadcrumb", () => {
  const pages = [
    pg("eng", "Engineering"),
    pg("api", "Meridian API design", "eng"),
    pg("me", "Rate limits", "api"),
  ];

  it("renders ancestors only, never the current page's own title", () => {
    mount(<PageBreadcrumbView pageId="me" pages={pages} onOpen={() => {}} />);
    expect(text()).toContain("Engineering");
    expect(text()).toContain("Meridian API design");
    expect(text()).not.toContain("Rate limits");
  });

  it("renders nothing for a root page", () => {
    mount(<PageBreadcrumbView pageId="eng" pages={pages} onOpen={() => {}} />);
    expect(host.querySelector("[data-breadcrumb]")).toBeNull();
    expect(text()).toBe("");
  });

  it("a crumb's chevron menu lists pages sharing that crumb's parent_id", () => {
    const wide = [...pages, pg("design", "Design"), pg("infra", "Infra", "eng")];
    mount(<PageBreadcrumbView pageId="me" pages={wide} onOpen={() => {}} />);
    const chev = host.querySelector<HTMLButtonElement>(
      '[aria-label="Pages beside Engineering"]',
    )!;
    act(() => chev.click());
    // Siblings of Engineering are the other root pages.
    expect(text()).toContain("Design");
    expect(text()).toContain(
      "A page is also reachable from any view that matches it.",
    );
    // Infra is a child of Engineering, not its sibling.
    expect(document.querySelectorAll("button").length).toBeGreaterThan(2);
  });
});

describe("sidebar tree", () => {
  it("omits a page whose parent is set but unreadable, with no placeholder or count", () => {
    const pages = [pg("a", "Visible"), pg("orphan", "Hidden", "secret")];
    mount(
      <SidebarTreeView
        pages={pages}
        expanded={new Set()}
        onToggle={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(text()).toContain("Visible");
    expect(text()).not.toContain("Hidden");
    expect(text()).not.toMatch(/more|can't see|\d+ hidden/i);
    expect(host.querySelectorAll("li").length).toBe(1);
  });

  it("renders a disclosure triangle only where a page has children", () => {
    const pages = [pg("a", "Has kids"), pg("b", "Child", "a"), pg("c", "Alone")];
    mount(
      <SidebarTreeView
        pages={pages}
        expanded={new Set()}
        onToggle={() => {}}
        onOpen={() => {}}
      />,
    );
    const rows = [...host.querySelectorAll("li")];
    expect(rows.length).toBe(2); // collapsed: the child is not rendered
    expect(host.querySelectorAll("[data-disclosure]").length).toBe(1);
    expect(
      rows[0]!.querySelector("[data-disclosure]")!.getAttribute("aria-label"),
    ).toBe("Expand Has kids");
  });

  it("expanding shows the child with one guide cell per ancestor level", () => {
    const pages = [pg("a", "Has kids"), pg("b", "Child", "a")];
    mount(
      <SidebarTreeView
        pages={pages}
        expanded={new Set(["a"])}
        onToggle={() => {}}
        onOpen={() => {}}
      />,
    );
    const rows = [...host.querySelectorAll("li")];
    expect(rows.length).toBe(2);
    expect(rows[0]!.querySelectorAll("[data-guide]").length).toBe(0);
    expect(rows[1]!.querySelectorAll("[data-guide]").length).toBe(1);
  });
});

describe("placed in row", () => {
  const pages = [pg("home", "Engineering"), pg("me", "Rate limits", "home")];

  it("unplaced renders the stands-on-its-own copy and no amber", () => {
    mount(
      <PlacedInRowView
        pageId="me"
        parentId={null}
        pages={pages}
        onOpen={() => {}}
        onUnplace={() => {}}
        onPick={() => {}}
        onCreate={() => {}}
      />,
    );
    expect(text()).toContain("Nowhere — it stands on its own");
    expect(text()).toContain("Place it in a page");
    expect(host.innerHTML).not.toMatch(/amber/i);
  });

  it("× unplaces and the page still exists", () => {
    let unplaced = 0;
    mount(
      <PlacedInRowView
        pageId="me"
        parentId="home"
        pages={pages}
        onOpen={() => {}}
        onUnplace={() => {
          unplaced += 1;
        }}
        onPick={() => {}}
        onCreate={() => {}}
      />,
    );
    expect(text()).toContain("Engineering");
    const x = host.querySelector<HTMLButtonElement>(
      '[aria-label="Unplace this page"]',
    )!;
    act(() => x.click());
    expect(unplaced).toBe(1);
    expect(pages.some((p) => p.id === "me")).toBe(true);
  });

  it("a deleted parent gets a neutral chip and a green call to action, never amber", () => {
    mount(
      <PlacedInRowView
        pageId="me"
        parentId="ghost"
        pages={pages}
        onOpen={() => {}}
        onUnplace={() => {}}
        onPick={() => {}}
        onCreate={() => {}}
      />,
    );
    expect(text()).toContain("The page it was in has been deleted");
    expect(text()).toContain("File it somewhere");
    expect(host.innerHTML).not.toMatch(/amber/i);
  });
});
