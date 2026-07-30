// @vitest-environment happy-dom
/* Diagnosis: keyboard Delete on a selected block INSIDE a column.
 *
 * Drives the real EditableBody: shift-click the drag handle of a block
 * inside a column (the only gesture that creates a block selection there),
 * then press Delete on the window. The assertion is on the onChange
 * payload — if it never arrives, the delete did not happen. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { EditableBody } from "./page-editor-body";
import type { Blk } from "@/lib/block-ops";

vi.mock("@/lib/workspace-context", () => ({
  useWorkspaceId: () => "ws1",
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

const doc: Blk[] = [
  { id: "t1", type: "text", text: "top" } as Blk,
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
  } as unknown as Blk,
];

function mount(onChange: (b: Blk[]) => void) {
  root = createRoot(host);
  act(() => {
    root.render(
      <EditableBody pageId="p1" initialBlocks={doc} onChange={onChange} />,
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

function pressDelete(target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );
  });
}

function editableFor(id: string): HTMLElement {
  const row = document.querySelector(`[data-block-id="${id}"]`)!;
  const el = row.querySelector('[contenteditable="true"]');
  if (!el) throw new Error(`editable not found: ${id}`);
  return el as HTMLElement;
}

describe("DIAG caret-first sequence", () => {
  it("caret inside a column block, then shift-click handle, then Delete", () => {
    const onChange = vi.fn();
    mount(onChange);
    const ed = editableFor("a1");
    act(() => {
      ed.focus();
      ed.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    // eslint-disable-next-line no-console
    console.log("active before shift-click:", document.activeElement?.tagName, (document.activeElement as HTMLElement)?.isContentEditable);
    shiftClickHandle("a1");
    // eslint-disable-next-line no-console
    console.log("active after shift-click:", document.activeElement?.tagName, (document.activeElement as HTMLElement)?.isContentEditable);
    const calls0 = onChange.mock.calls.length;
    pressDelete(document.activeElement ?? window);
    // eslint-disable-next-line no-console
    console.log("onChange after Delete:", onChange.mock.calls.length - calls0, JSON.stringify(onChange.mock.calls.at(-1)?.[0]));
  });
});

describe("DIAG keyboard delete", () => {
  it("top level: shift-click handle then Delete removes the block", () => {
    const onChange = vi.fn();
    mount(onChange);
    shiftClickHandle("t1");
    pressDelete();
    // eslint-disable-next-line no-console
    console.log("TOP calls:", JSON.stringify(onChange.mock.calls.map((c) => (c[0] as Blk[]).map((b) => b.id))));
    expect(onChange).toHaveBeenCalled();
  });

  it("inside a column: shift-click handle then Delete removes the block", () => {
    const onChange = vi.fn();
    mount(onChange);
    shiftClickHandle("a1");
    const selectedAttr = document
      .querySelector('[data-block-id="a1"]')
      ?.getAttribute("data-selected");
    // eslint-disable-next-line no-console
    console.log("COL selected attr:", selectedAttr);
    pressDelete();
    const last = onChange.mock.calls.at(-1)?.[0] as Blk[] | undefined;
    // eslint-disable-next-line no-console
    console.log(
      "COL result:",
      JSON.stringify(
        last?.map((b) =>
          b.type === "columns"
            ? { id: b.id, cols: (b as unknown as { cols: Blk[][] }).cols.map((c) => c.map((x) => x.id)) }
            : b.id,
        ),
      ),
    );
    expect(last).toBeTruthy();
  });
});
