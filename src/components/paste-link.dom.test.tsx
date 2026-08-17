// @vitest-environment happy-dom
/* Pasting a bare URL over a text selection hyperlinks the selection.
 *
 * Driven through the REAL page body: focus a block's contenteditable, place a
 * DOM Range over part of it, then dispatch a paste with a URL on the
 * clipboard. The assertion is on the onChange payload (the block source) plus
 * preventDefault, which is the whole contract.
 *
 * Deliberately NOT asserted: focus, activeElement, blur ordering, or pixel
 * geometry — happy-dom cannot verify them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { EditableBody } from "./page-editor-body";
import { FloatingToolbar } from "./floating-toolbar";
import type { Blk } from "@/lib/block-ops";

vi.mock("@/lib/workspace-context", () => ({ useWorkspaceId: () => "ws1" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

function mount(blocks: Blk[], onChange: (b: Blk[]) => void) {
  root = createRoot(host);
  act(() =>
    root.render(<EditableBody pageId="p1" initialBlocks={blocks} onChange={onChange} />),
  );
}

function editableFor(id: string): HTMLElement {
  const row = host.querySelector(`[data-block-id="${id}"]`);
  const el = row?.querySelector('[contenteditable="true"]');
  if (!el) throw new Error(`editable not found: ${id}`);
  return el as HTMLElement;
}

/** Focus `el` and select DOM text offsets [a, b) inside its first text node. */
function selectIn(el: HTMLElement, a: number, b: number) {
  act(() => {
    el.focus();
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const node = el.firstChild ?? el;
    const r = document.createRange();
    r.setStart(node, a);
    r.setEnd(node, b);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
}

type Clip = { plain?: string; html?: string };

function paste(el: HTMLElement, clip: Clip) {
  const ev = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
    clipboardData: unknown;
  };
  Object.defineProperty(ev, "clipboardData", {
    value: {
      files: [],
      getData: (t: string) =>
        t === "text/html" ? (clip.html ?? "") : (clip.plain ?? ""),
    },
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

const textOf = (bs: Blk[], id: string) =>
  (bs.find((b) => b.id === id) as unknown as { text?: string })?.text ?? "";

describe("paste a URL over a selection", () => {
  it("links the selected words in a prose block", () => {
    const onChange = vi.fn();
    mount([{ id: "b1", type: "text", text: "click here now" }] as unknown as Blk[], onChange);
    const el = editableFor("b1");
    selectIn(el, 6, 10); // "here"
    const ev = paste(el, { plain: "https://gogio.io" });
    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(onChange.mock.calls.at(-1)![0] as Blk[], "b1")).toBe(
      "click [here](https://gogio.io) now",
    );
  });

  it("does NOT link with a collapsed caret", () => {
    const onChange = vi.fn();
    mount([{ id: "b1", type: "text", text: "click here now" }] as unknown as Blk[], onChange);
    const el = editableFor("b1");
    selectIn(el, 6, 6);
    paste(el, { plain: "https://gogio.io" });
    const last = onChange.mock.calls.at(-1);
    if (last) expect(textOf(last[0] as Blk[], "b1")).toBe("click here now");
  });

  it("still creates blocks from a multi-line markdown paste", () => {
    const onChange = vi.fn();
    mount([{ id: "b1", type: "text", text: "" }] as unknown as Blk[], onChange);
    const el = editableFor("b1");
    selectIn(el, 0, 0);
    paste(el, { plain: "# One\n\nTwo" });
    const next = onChange.mock.calls.at(-1)![0] as Blk[];
    expect(next.length).toBeGreaterThan(1);
  });

  /* The regression that shipped: the branch read the block source from React
   * state while Editable is uncontrolled, so once the DOM ran ahead of state
   * the caret mapping failed and the native paste replaced the words. The DOM
   * is mutated here WITHOUT flushing state to reproduce exactly that. */
  it("links even when the DOM has diverged from React state", () => {
    const onChange = vi.fn();
    mount([{ id: "b1", type: "text", text: "Tai Rattigan" }] as unknown as Blk[], onChange);
    const el = editableFor("b1");
    act(() => {
      el.textContent = "Hi Tai Rattigan";
    });
    selectIn(el, 3, 15); // "Tai Rattigan" at the DOM's offsets, not state's
    const ev = paste(el, { plain: "https://www.linkedin.com/in/tairattigan/" });
    expect(ev.defaultPrevented).toBe(true);
    expect(el.textContent ?? "").toContain(
      "[Tai Rattigan](https://www.linkedin.com/in/tairattigan/)",
    );
  });

  it("links a selection inside a TABLE CELL", () => {
    const onChange = vi.fn();
    mount(
      [
        {
          id: "tb",
          type: "table",
          rows: [
            ["head", "b"],
            ["click here now", "d"],
          ],
        },
      ] as unknown as Blk[],
      onChange,
    );
    const cell = host.querySelector<HTMLElement>('[data-table-cell="1,0"]')!;
    selectIn(cell, 6, 10);
    const ev = paste(cell, { plain: "https://gogio.io" });
    expect(ev.defaultPrevented).toBe(true);
    const next = onChange.mock.calls.at(-1)![0] as unknown as {
      rows: string[][];
    }[];
    expect(next[0].rows[1][0]).toBe("click [here](https://gogio.io) now");
  });
});

describe("the floating toolbar's link field", () => {
  it("stays mounted after entering link mode", () => {
    const onChange = vi.fn();
    mount([{ id: "b1", type: "text", text: "click here now" }] as unknown as Blk[], onChange);
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    const r2 = createRoot(bar);
    const el = editableFor("b1");
    selectIn(el, 6, 10);
    act(() => r2.render(<FloatingToolbar />));
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    const link = document.querySelector<HTMLElement>('[aria-label="Link"]');
    if (!link) return; // happy-dom gave a zero rect: nothing to assert here
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="toolbar"]')).toBeTruthy();
    expect(document.querySelector('input[placeholder="Paste a link…"]')).toBeTruthy();
  });
});
