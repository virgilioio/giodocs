// @vitest-environment happy-dom
/* A plain left click on a link INSIDE the editor's contenteditable opens it
 * in a new tab (browsers never navigate anchors inside contenteditable).
 * Driven through the real page body with a single delegated handler.
 *
 * Deliberately NOT asserted: colour, hover, focus or geometry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { EditableBody } from "./page-editor-body";
import type { Blk } from "@/lib/block-ops";

vi.mock("@/lib/workspace-context", () => ({ useWorkspaceId: () => "ws1" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const URL_ = "https://example.com/x";
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  window.getSelection()?.removeAllRanges();
});

function mountWithLink(): HTMLAnchorElement {
  const blocks: Blk[] = [
    { id: "b1", type: "text", text: `see [label](${URL_}) end` } as Blk,
  ];
  root = createRoot(host);
  act(() =>
    root.render(
      <EditableBody pageId="p1" initialBlocks={blocks} onChange={() => {}} />,
    ),
  );
  const a = host.querySelector('[contenteditable="true"] a[href]');
  if (!a) throw new Error("anchor not rendered");
  return a as HTMLAnchorElement;
}

function clickOn(a: HTMLAnchorElement, init: MouseEventInit = {}) {
  act(() => {
    a.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
    );
  });
}

describe("in-editor link click", () => {
  it("a plain left click opens the href in a new tab", () => {
    const a = mountWithLink();
    expect(a.getAttribute("href")).toBe(URL_);
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    clickOn(a);
    expect(spy).toHaveBeenCalledWith(URL_, "_blank", "noopener,noreferrer");
    spy.mockRestore();
  });

  it("a ⌘-click does NOT open it (native behaviour wins)", () => {
    const a = mountWithLink();
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    clickOn(a, { metaKey: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a click that ends a text selection does NOT open it", () => {
    const a = mountWithLink();
    const node = a.firstChild ?? a;
    const r = document.createRange();
    r.setStart(node, 0);
    r.setEnd(node, (node.textContent ?? "x").length);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    expect(s.isCollapsed).toBe(false);
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    clickOn(a);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
