// @vitest-environment happy-dom
/* The boundary that matters: an entry that does not resolve against the
 * reader's OWN visible page list must leave no trace in the strip — no
 * badge, no greyed placeholder, no "N more" counter. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactNode } from "react";
import { RelatedLinks } from "./related-links";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VISIBLE = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Hiring plan",
    icon: "🧑",
    props: { area: "People" },
    edited_at: "2026-08-01T00:00:00Z",
  },
];
const HIDDEN_ID = "99999999-9999-9999-9999-999999999999";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function mount(node: ReactNode) {
  act(() => root.render(node));
}

describe("RelatedLinks strip", () => {
  it("renders a badge for a visible page and for a URL", () => {
    mount(
      <RelatedLinks
        value={[VISIBLE[0].id, "https://figma.com/file/x"]}
        pages={VISIBLE}
        onSet={() => {}}
        onOpenPage={() => {}}
      />,
    );
    const badges = host.querySelectorAll("[data-rel-badge]");
    expect(badges.length).toBe(2);
    expect(host.textContent).toContain("Hiring plan");
    expect(host.textContent).toContain("Figma");
  });

  it("an id absent from the visible list renders NO badge and NO placeholder", () => {
    mount(
      <RelatedLinks
        value={[HIDDEN_ID]}
        pages={VISIBLE}
        onSet={() => {}}
        onOpenPage={() => {}}
      />,
    );
    expect(host.querySelectorAll("[data-rel-badge]").length).toBe(0);
    const text = host.textContent ?? "";
    expect(text).not.toContain(HIDDEN_ID);
    expect(text).not.toContain("Deleted");
    expect(text).not.toContain("more");
    expect(text).not.toContain("🔒");
    // Only the add affordance remains, and it reads as if nothing is linked.
    expect(text).toContain("Add");
  });

  it("removing a badge writes the array without exactly that entry", () => {
    const onSet = vi.fn();
    mount(
      <RelatedLinks
        value={[VISIBLE[0].id, "https://figma.com/file/x"]}
        pages={VISIBLE}
        onSet={onSet}
        onOpenPage={() => {}}
      />,
    );
    const x = host.querySelector('[aria-label="Remove Figma"]');
    expect(x).not.toBeNull();
    act(() => {
      x!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSet).toHaveBeenCalledWith([VISIBLE[0].id]);
  });

  it("clicking a page badge navigates in-app and never opens a tab", () => {
    const onOpenPage = vi.fn();
    mount(
      <RelatedLinks
        value={[VISIBLE[0].id]}
        pages={VISIBLE}
        onSet={() => {}}
        onOpenPage={onOpenPage}
      />,
    );
    const badge = host.querySelector('[data-rel-badge="page"] button');
    act(() => {
      badge!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenPage).toHaveBeenCalledWith(VISIBLE[0].id);
    expect(host.querySelector('[data-rel-badge="page"] a')).toBeNull();
  });

  it("the empty affordance reads as an invitation", () => {
    mount(
      <RelatedLinks
        value={[]}
        pages={VISIBLE}
        onSet={() => {}}
        onOpenPage={() => {}}
      />,
    );
    expect(host.textContent).toContain("Link a page or paste a URL");
  });
});
