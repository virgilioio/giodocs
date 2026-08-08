// @vitest-environment happy-dom
/* BOUNDARY tests: a formula edit inside a `sheet` block must survive the
 * PAGE's pointer gesture, not just the sheet's own handlers.
 *
 * The failure these lock down was never in the pure layer (canPick, insertRef
 * and the caret mirror all behaved). It was the page marquee: a press on a
 * sheet cell opened a marquee session, and the session's POINTERUP branch
 * imperatively blurred the hoisted editor, which committed a half-written
 * draft. So the pointerUP is the whole point here — a test that stops at
 * pointerdown passes against the broken code.
 *
 * Deliberately NOT asserted: focus, document.activeElement, blur ordering,
 * CSS grid, hover, :has(). happy-dom cannot verify any of them. These assert
 * DOM SURVIVAL and DATA NON-MUTATION only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { EditableBody, MARQUEE_SKIP_SEL } from "./page-editor-body";
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
      id: "s1",
      type: "sheet",
      text: "",
      cells: [
        [{ v: "Deal" }, { v: "Value" }],
        [{ v: "Alpha" }, { v: 100 }],
      ],
      cw: [160, 120],
    },
  ] as unknown as Blk[];

function mount(blocks: Blk[], onChange: (b: Blk[]) => void) {
  root = createRoot(host);
  act(() =>
    root.render(<EditableBody pageId="p1" initialBlocks={blocks} onChange={onChange} />),
  );
  return host;
}

const cell = (r: number, c: number) =>
  host.querySelector(`[data-sheet-cell="${r},${c}"]`) as HTMLElement;
const editor = () => host.querySelector("[data-sheet-editor]") as HTMLInputElement | null;

function gesture(el: Element) {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
  });
}

function press(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** Open an edit in A1 whose draft is exactly "=" — the state in which a cell
 *  click is a REFERENCE PICK rather than "leave this cell". */
function openFormulaEdit() {
  gesture(cell(1, 0));
  press(host.querySelector('[role="table"]')!, "=");
  expect(editor()).toBeTruthy();
  expect(editor()!.value).toBe("=");
}

const sheetOf = (blocks: Blk[]) =>
  blocks.find((b) => (b as { id?: string }).id === "s1") as unknown as {
    cells?: { v?: unknown }[][];
  };

describe("a sheet edit survives the page's pointer gesture", () => {
  it("a cell click during a formula pick keeps the edit open through POINTERUP and writes nothing", () => {
    let latest: Blk[] | null = null;
    mount(doc(), (b) => {
      latest = b;
    });
    openFormulaEdit();

    gesture(cell(1, 1));

    // The hoisted editor is still mounted with the reference inserted.
    expect(editor()).toBeTruthy();
    expect(editor()!.value).toBe("=B2");
    // And nothing was committed onto A1.
    const cells = latest ? sheetOf(latest).cells : null;
    if (cells) expect(cells[1]?.[0]?.v).toBe("Alpha");
  });

  it("a suggestion-row click keeps the edit open through POINTERUP", () => {
    mount(doc(), () => {});
    openFormulaEdit();
    // "=S" narrows the panel; the row is inside the sheet root.
    act(() => {
      const el = editor()!;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(el, "=S");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const row = host.querySelector("[data-sheet-suggestion]") as HTMLElement | null;
    expect(row).toBeTruthy();

    gesture(row!);

    expect(editor()).toBeTruthy();
    expect(editor()!.value.startsWith("=S")).toBe(true);
  });
});

describe("MARQUEE_SKIP_SEL", () => {
  it("keeps both the sheet root and table cells out of marquee sessions", () => {
    expect(MARQUEE_SKIP_SEL).toContain("[data-sheet]");
    expect(MARQUEE_SKIP_SEL).toContain("[data-table-cell]");
  });
});
