// @vitest-environment happy-dom
/* Block-level inline formatting through the REAL page body.
 *
 * A marquee selection has no focused editable and no DOM Range, so the
 * in-block ⌘B never fires. These assert the window-level path: the committed
 * blocks change, the selection survives, and a focused text field still wins.
 *
 * Deliberately NOT asserted: focus, activeElement, blur ordering, hover, or
 * any pixel geometry — happy-dom cannot verify them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { EditableBody } from "./page-editor-body";
import { FloatingToolbar } from "./floating-toolbar";
import type { Blk } from "@/lib/block-ops";

vi.mock("@/lib/workspace-context", () => ({ useWorkspaceId: () => "ws1" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

const doc = (): Blk[] =>
  [
    { id: "b1", type: "text", text: "one" },
    { id: "b2", type: "text", text: "two" },
  ] as unknown as Blk[];

function mount(blocks: Blk[], onChange: (b: Blk[]) => void) {
  root = createRoot(host);
  act(() =>
    root.render(<EditableBody pageId="p1" initialBlocks={blocks} onChange={onChange} />),
  );
}

const key = (k: string, opts: KeyboardEventInit = {}, target?: Element) => {
  const ev = new KeyboardEvent("keydown", {
    key: k,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  act(() => {
    (target ?? window).dispatchEvent(ev);
  });
};

const selectedCount = () =>
  host.querySelectorAll('[data-selected="true"]').length;

describe("block selection formatting", () => {
  it("⌘B on a block selection formats the blocks and keeps the selection", () => {
    const onChange = vi.fn();
    mount(doc(), onChange);
    key("a"); // select all blocks
    const before = selectedCount();
    expect(before).toBeGreaterThan(0);
    key("b");
    const last = onChange.mock.calls.at(-1)?.[0] as Blk[] | undefined;
    expect(last?.map((b) => (b as { text?: string }).text)).toEqual([
      "**one**",
      "**two**",
    ]);
    expect(selectedCount()).toBe(before);
  });

  it("does not run the block path when a text field is focused", () => {
    const onChange = vi.fn();
    mount(doc(), onChange);
    key("a");
    onChange.mockClear();
    const input = document.createElement("input");
    document.body.appendChild(input);
    key("b", {}, input);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FloatingToolbar block mode", () => {
  it("renders without a link button", () => {
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    const r = createRoot(bar);
    act(() =>
      r.render(
        <FloatingToolbar
          blockSel={{
            count: 2,
            anchor: () => new DOMRect(10, 200, 400, 80),
            active: {
              bold: false,
              italic: false,
              underline: false,
              strike: false,
              code: false,
              highlight: false,
            },
            onToggle: () => {},
          }}
        />,
      ),
    );
    const toolbar = document.querySelector('[role="toolbar"]');
    expect(toolbar).toBeTruthy();
    expect(document.querySelector('[aria-label="Link"]')).toBeNull();
    expect(document.querySelector('[aria-label="Bold  ⌘B"]')).toBeTruthy();
    act(() => r.unmount());
  });
});
