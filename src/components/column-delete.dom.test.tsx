// @vitest-environment happy-dom
/* Regression tests for keyboard block operations inside CONTAINERS.
 *
 * These render the real EditableBody and drive it the way a person does:
 * shift-click a block's drag handle (the gesture that creates a block
 * selection), then press a key on the window. The assertion is on the
 * `onChange` payload — the only thing that leaves the component.
 *
 * Origin: "Delete does not work inside a column". These tests PROVE the
 * selection→Delete pipeline is sound at every scope, which is what pointed
 * the diagnosis at the columns grid geometry instead (stray grid items made
 * the marquee's container hit-test resolve the wrong scope, so no selection
 * was ever created inside a column).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { EditableBody } from "./page-editor-body";
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
    { id: "t1", type: "text", text: "top" },
    {
      id: "cx",
      type: "columns",
      cols: [
        [
          { id: "a1", type: "text", text: "aaa" },
          { id: "a2", type: "text", text: "bbb" },
        ],
        [{ id: "b1", type: "text", text: "ccc" }],
      ],
    },
    {
      id: "ca",
      type: "callout",
      text: "",
      children: [
        { id: "k1", type: "text", text: "kkk" },
        { id: "k2", type: "text", text: "lll" },
      ],
    },
  ] as unknown as Blk[];

function mount(blocks: Blk[], onChange: (b: Blk[]) => void) {
  root = createRoot(host);
  act(() => {
    root.render(
      <EditableBody pageId="p1" initialBlocks={blocks} onChange={onChange} />,
    );
  });
}

function handleFor(id: string): HTMLElement {
  const row = document.querySelector(`[data-block-id="${id}"]`);
  if (!row) throw new Error(`row not found: ${id}`);
  const btn = row.querySelector('button[aria-label="Drag to reorder"]');
  if (!btn) throw new Error(`handle not found: ${id}`);
  return btn as HTMLElement;
}

function editableFor(id: string): HTMLElement {
  const row = document.querySelector(`[data-block-id="${id}"]`);
  const el = row?.querySelector('[contenteditable="true"]');
  if (!el) throw new Error(`editable not found: ${id}`);
  return el as HTMLElement;
}

function shiftClickHandle(id: string) {
  const el = handleFor(id);
  act(() => {
    el.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, shiftKey: true, button: 0 }),
    );
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, shiftKey: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
  });
}

function press(key: string, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

const idsOf = (bs: Blk[]) => bs.map((b) => b.id);
const colsOf = (bs: Blk[], id: string) =>
  ((bs.find((b) => b.id === id) as unknown as { cols: Blk[][] }).cols ?? []).map((c) =>
    c.map((x) => x.id),
  );

describe("Delete on a selected block", () => {
  it("removes it at top level", () => {
    const onChange = vi.fn();
    mount(doc(), onChange);
    shiftClickHandle("t1");
    press("Delete");
    expect(idsOf(onChange.mock.calls.at(-1)![0] as Blk[])).toEqual(["cx", "ca"]);
  });

  it("removes it INSIDE A COLUMN, leaving the other column untouched", () => {
    const onChange = vi.fn();
    mount(doc(), onChange);
    shiftClickHandle("a1");
    press("Delete");
    const next = onChange.mock.calls.at(-1)![0] as Blk[];
    expect(colsOf(next, "cx")).toEqual([["a2"], ["b1"]]);
    expect(idsOf(next)).toEqual(["t1", "cx", "ca"]);
  });

  it("removes it INSIDE A CALLOUT", () => {
    const onChange = vi.fn();
    mount(doc(), onChange);
    shiftClickHandle("k1");
    press("Delete");
    const next = onChange.mock.calls.at(-1)![0] as Blk[];
    const ca = next.find((b) => b.id === "ca") as unknown as { children: Blk[] };
    expect(ca.children.map((c) => c.id)).toEqual(["k2"]);
  });

  it("works when the caret was in the column block first (focus is dropped)", () => {
    const onChange = vi.fn();
    mount(doc(), onChange);
    const ed = editableFor("a1");
    act(() => {
      ed.focus();
      ed.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    shiftClickHandle("a1");
    expect((document.activeElement as HTMLElement | null)?.isContentEditable).toBe(
      false,
    );
    press("Delete", document.activeElement ?? window);
    expect(colsOf(onChange.mock.calls.at(-1)![0] as Blk[], "cx")).toEqual([
      ["a2"],
      ["b1"],
    ]);
  });
});

describe("Backspace dissolves a wholly empty columns block", () => {
  const emptyCols = (): Blk[] =>
    [
      { id: "t1", type: "text", text: "top" },
      {
        id: "cx",
        type: "columns",
        cols: [
          [{ id: "e1", type: "text", text: "" }],
          [{ id: "e2", type: "text", text: "" }],
          [{ id: "e3", type: "text", text: "" }],
        ],
      },
    ] as unknown as Blk[];

  it("replaces the block with a single empty text block", () => {
    const onChange = vi.fn();
    mount(emptyCols(), onChange);
    const ed = editableFor("e2");
    act(() => {
      ed.focus();
      ed.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    press("Backspace", ed);
    const next = onChange.mock.calls.at(-1)![0] as Blk[];
    expect(next.length).toBe(2);
    expect(next[0].id).toBe("t1");
    expect(next[1].type).toBe("text");
    expect(next[1].text ?? "").toBe("");
    expect((next[1] as unknown as { cols?: unknown }).cols).toBeUndefined();
  });

  it("does NOTHING when another column still has content", () => {
    const withContent = emptyCols();
    (withContent[1] as unknown as { cols: Blk[][] }).cols[2] = [
      { id: "e3", type: "text", text: "keep" } as Blk,
    ];
    const onChange = vi.fn();
    mount(withContent, onChange);
    const ed = editableFor("e1");
    act(() => {
      ed.focus();
      ed.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    press("Backspace", ed);
    const calls = onChange.mock.calls;
    if (calls.length) {
      const next = calls.at(-1)![0] as Blk[];
      expect(next.find((b) => b.id === "cx")).toBeTruthy();
    }
  });
});
