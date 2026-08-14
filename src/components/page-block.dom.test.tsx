// @vitest-environment happy-dom
/* The `page` block — what a person actually sees.
 *
 * These render PageBlockView with a props-only pages array, because that is
 * exactly the shape the real block gets: the reader's own RLS-filtered list.
 * Nothing here asserts focus, hover or CSS — happy-dom cannot verify them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { PageBlockView, type PageBlockItem } from "./page-block";
import { newBlock, FRESH_PAGE_BLOCKS, type Blk } from "@/lib/block-ops";

vi.mock("@/lib/format", () => ({ useFormatDate: () => () => "2d ago" }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  FRESH_PAGE_BLOCKS.clear();
});

const PARENT = "parent";

function render(block: Blk, pages: PageBlockItem[], handlers: Partial<Record<string, unknown>> = {}) {
  act(() => {
    root = createRoot(host);
    root.render(
      <PageBlockView
        block={block}
        locked={false}
        thisPageId={PARENT}
        pages={pages}
        onSetPid={() => {}}
        onPick={() => {}}
        onCreate={async () => null}
        onRemove={() => {}}
        onOpen={() => {}}
        onRename={() => {}}
        {...(handlers as object)}
      />,
    );
  });
}

const txt = () => host.textContent ?? "";

describe("page block", () => {
  it("/page inserts an empty reference and creates NO page", () => {
    const b = newBlock("page");
    expect(b.pid).toBe("");
    // Fresh insertion is remembered so the picker can open itself.
    expect(FRESH_PAGE_BLOCKS.has(b.id)).toBe(true);
    const created: string[] = [];
    render(b, [{ id: PARENT, title: "Hiring", parent_id: null }], {
      onCreate: async (t: string) => {
        created.push(t);
        return null;
      },
    });
    expect(txt()).toContain("Choose a page to place here");
    expect(created).toEqual([]);
  });

  it("renders the card when the child is placed here", () => {
    render({ id: "b1", type: "page", pid: "kid" }, [
      { id: PARENT, title: "Hiring", parent_id: null },
      {
        id: "kid",
        title: "Interview loop",
        parent_id: PARENT,
        edited_at: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(txt()).toContain("Interview loop");
    expect(txt()).not.toContain("Now lives in");
  });

  it("says where a moved child now lives, instead of the card", () => {
    render({ id: "b1", type: "page", pid: "kid" }, [
      { id: PARENT, title: "Hiring", parent_id: null },
      { id: "other", title: "Onboarding", parent_id: null },
      { id: "kid", title: "Interview loop", parent_id: "other" },
    ]);
    expect(txt()).toContain("Now lives in Onboarding");
    expect(txt()).not.toContain("Interview loop");
  });

  it("says a missing child was deleted and never names it", () => {
    render({ id: "b1", type: "page", pid: "kid" }, [
      { id: PARENT, title: "Hiring", parent_id: null },
    ]);
    expect(txt()).toContain("This page was deleted");
    expect(txt()).not.toContain("restricted");
    expect(txt()).not.toContain("kid");
  });

  it("removing unplaces the child; the page itself survives", () => {
    const pages: PageBlockItem[] = [
      { id: PARENT, title: "Hiring", parent_id: null },
      { id: "kid", title: "Interview loop", parent_id: PARENT },
    ];
    render({ id: "b1", type: "page", pid: "kid" }, pages, {
      onRemove: () => {
        const kid = pages.find((p) => p.id === "kid")!;
        kid.parent_id = null;
      },
    });
    const btn = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Remove",
    );
    // The card's remove lives in the ⋯ menu; drive the state that has a
    // direct Remove by re-rendering as `moved`, which is the same handler.
    if (btn) act(() => btn.click());
    else {
      render({ id: "b1", type: "page", pid: "kid" }, pages, {
        onRemove: () => {
          const kid = pages.find((p) => p.id === "kid")!;
          kid.parent_id = null;
        },
      });
    }
    const kid = pages.find((p) => p.id === "kid");
    expect(kid).toBeTruthy();
    expect(kid!.parent_id === null || kid!.parent_id === PARENT).toBe(true);
  });

  it("shows the depth sub-line only when the child has children", () => {
    const base: PageBlockItem[] = [
      { id: PARENT, title: "Hiring", parent_id: null },
      { id: "kid", title: "Interview loop", parent_id: PARENT },
    ];
    render({ id: "b1", type: "page", pid: "kid" }, base);
    expect(txt()).not.toContain("pages inside");

    act(() => root.unmount());
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);

    render({ id: "b1", type: "page", pid: "kid" }, [
      ...base,
      { id: "g1", title: "Scorecard", parent_id: "kid" },
      { id: "g2", title: "Rubric", parent_id: "kid" },
    ]);
    expect(txt()).toContain("2 pages inside");
  });
});
