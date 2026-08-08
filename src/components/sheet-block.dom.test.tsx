// @vitest-environment happy-dom
/* Rendering + interaction checks for the sheet block.
 *
 * The interaction tests here are the ones that caught the spec's author:
 * they assert the EDITOR ELEMENT IDENTITY across keystrokes (the single
 * hoisted input), that clicking away never writes an empty draft onto the
 * cell you clicked, and — §E — that Backspace with a cell range selected
 * never reaches the page's block-delete handler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { SheetBlockView, SHEET_ROW_NUM_W } from "./sheet-block";
import { isTypingTarget } from "@/lib/is-typing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const block = {
  id: "s1",
  type: "sheet",
  cells: [
    [{ v: "Deal" }, { v: "Value" }],
    [{ v: "Alpha" }, { v: 100 }],
    [{ v: "Total" }, { v: "=SUM(B2:B2)" }],
  ],
  cw: [160, 120],
  bw: 900,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

function mount(node: React.ReactNode) {
  root = createRoot(host);
  act(() => root.render(node));
  return host;
}

const grid = () => host.querySelector('[role="table"]') as HTMLElement;
const box = () => grid().parentElement as HTMLElement;
const cell = (r: number, c: number) =>
  host.querySelector(`[data-sheet-cell="${r},${c}"]`) as HTMLElement;
const editor = () => host.querySelector("[data-sheet-editor]") as HTMLInputElement | null;
const refLabel = () => (host.querySelector("[data-sheet-ref]") as HTMLElement).textContent;
const readout = () => (host.querySelector("[data-sheet-readout]") as HTMLElement | null)?.textContent;

/* ── Event helpers. React listens at the root container, so bubbling
   native events drive the real handlers. ── */
function press(el: Element, key: string, opts: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
  });
}

function click(el: Element, opts: MouseEventInit = {}) {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...opts }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, ...opts }));
  });
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A live harness: patches from onChange are applied, exactly as the page
 *  editor's commit path does, so a commit is observable in the next render. */
function Harness({
  initial = block,
  onPatch,
}: {
  initial?: Record<string, unknown>;
  onPatch?: (p: Record<string, unknown>) => void;
}) {
  const [b, setB] = useState<Record<string, unknown>>(initial);
  return (
    <SheetBlockView
      block={b}
      onChange={(patch) => {
        onPatch?.(patch);
        setB((prev) => ({ ...prev, ...patch }));
      }}
    />
  );
}

const rawAt = (patch: Record<string, unknown>, r: number, c: number) => {
  const cells = patch.cells as { v?: unknown }[][] | undefined;
  return cells?.[r]?.[c]?.v;
};

/* ═══════════════════════ rendering / containers ═══════════════════════ */

describe("sheet renders inside containers", () => {
  it("keeps its grid track inside a column", () => {
    mount(
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <SheetBlockView block={block} pageScope={false} />
      </div>,
    );
    expect(grid().style.gridTemplateColumns).toBe(`${SHEET_ROW_NUM_W}px 160px 120px`);
  });

  it("keeps its grid track inside a callout", () => {
    mount(
      <div style={{ padding: "12px" }}>
        <SheetBlockView block={block} pageScope={false} />
      </div>,
    );
    expect(grid().style.gridTemplateColumns).toBe(`${SHEET_ROW_NUM_W}px 160px 120px`);
  });

  it("ignores the block width outside page scope", () => {
    mount(<SheetBlockView block={block} pageScope={false} />);
    expect(box().style.width).toBe("");
  });

  it("honours the block width at page scope", () => {
    mount(<SheetBlockView block={block} pageScope />);
    expect(box().style.width).toBe("900px");
  });
});

describe("sheet shows computed values", () => {
  it("renders results, never formula source", () => {
    mount(<SheetBlockView block={block} />);
    expect(host.textContent).toContain("100");
    expect(host.textContent).not.toContain("=SUM");
  });

  it("nudges toward pages only past 50 rows", () => {
    mount(<SheetBlockView block={block} />);
    expect(host.textContent).not.toContain("Past 50 rows");

    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    mount(
      <SheetBlockView
        block={{ ...block, cells: Array.from({ length: 60 }, () => [{ v: 1 }, { v: 2 }]) }}
      />,
    );
    expect(host.textContent).toContain("Past 50 rows");
  });
});

/* ═══════════════════════ the single hoisted editor ═══════════════════════ */

describe("there is exactly one editor element and it never remounts", () => {
  it('typing "Hello" yields "Hello", not "o"', () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);

    click(cell(1, 0));
    press(grid(), "H");
    const first = editor()!;
    expect(first).toBeTruthy();
    expect(first.value).toBe("H");

    const nodes = [first];
    const active: (Element | null)[] = [document.activeElement];
    for (const next of ["He", "Hel", "Hell", "Hello"]) {
      typeInto(editor()!, next);
      nodes.push(editor()!);
      active.push(document.activeElement);
    }

    // The SAME DOM node across all five keystrokes.
    expect(new Set(nodes).size).toBe(1);
    // Focus never left it.
    expect(active.every((el) => el === first)).toBe(true);
    expect(editor()!.value).toBe("Hello");

    press(editor()!, "Enter");
    expect(rawAt(patches.at(-1)!, 1, 0)).toBe("Hello");
  });

  it("the editor is a child of the GRID container, not of a cell", () => {
    mount(<Harness />);
    click(cell(1, 1));
    press(grid(), "Enter");
    const el = editor()!;
    expect(el.parentElement).toBe(grid());
    expect(el.closest("[data-sheet-cell]")).toBeNull();
    expect(el.style.position).toBe("absolute");
    // left = 34 + cw[0], top = 26 + 1*29
    expect(el.style.left).toBe("194px");
    expect(el.style.top).toBe("55px");
  });

  it("the cell under the editor renders empty, so the value never doubles", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "Enter");
    expect(cell(1, 0).textContent).toBe("");
  });

  it("start typing in A, click B, then click C — C KEEPS ITS VALUE", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);

    click(cell(2, 1)); // A: the "=SUM" cell
    press(grid(), "9");
    click(cell(0, 0)); // B
    click(cell(1, 1)); // C — holds 100
    expect(cell(1, 1).textContent).toBe("100");
    const last = patches.at(-1)!;
    expect(rawAt(last, 1, 1)).toBe(100);
  });
});

describe("the focus guard", () => {
  it("Enter on a filled cell SELECTS the value so typing replaces it", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "Enter");
    const el = editor()!;
    expect(el.value).toBe("Alpha");
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 5]);
  });

  it("typing a character starts fresh with the caret AFTER it", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "x");
    const el = editor()!;
    expect(el.value).toBe("x");
    expect([el.selectionStart, el.selectionEnd]).toEqual([1, 1]);
  });

  it("does not re-select the text on later renders", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "x");
    typeInto(editor()!, "xy");
    const el = editor()!;
    expect(el.value).toBe("xy");
    expect([el.selectionStart, el.selectionEnd]).toEqual([2, 2]);
  });
});

describe("entering, leaving, committing", () => {
  it("Tab commits and moves right", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 0));
    press(grid(), "Z");
    press(editor()!, "Tab");
    expect(rawAt(patches.at(-1)!, 1, 0)).toBe("Z");
    expect(refLabel()).toBe("B2");
  });

  it("Enter commits and moves down", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(0, 0));
    press(grid(), "Q");
    press(editor()!, "Enter");
    expect(rawAt(patches.at(-1)!, 0, 0)).toBe("Q");
    expect(refLabel()).toBe("A2");
  });

  it("Escape DISCARDS and leaves the block data untouched", () => {
    const onPatch = vi.fn();
    mount(<Harness onPatch={onPatch} />);
    click(cell(1, 0));
    press(grid(), "n");
    typeInto(editor()!, "nonsense");
    press(editor()!, "Escape");
    expect(editor()).toBeNull();
    expect(onPatch).not.toHaveBeenCalled();
    expect(cell(1, 0).textContent).toBe("Alpha");
  });

  it("a numeric entry commits as a number, not a string", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 1));
    press(grid(), "4");
    typeInto(editor()!, "42");
    press(editor()!, "Enter");
    expect(rawAt(patches.at(-1)!, 1, 1)).toBe(42);
  });
});

/* ═══════════════════════ selection ═══════════════════════ */

describe("selection", () => {
  it("shift-click builds the rectangle from any two corners", () => {
    mount(<Harness />);
    click(cell(2, 1));
    click(cell(0, 0), { shiftKey: true });
    expect(refLabel()).toBe("A1:B3");
    const overlay = host.querySelector("[data-sheet-selection]") as HTMLElement;
    expect(overlay.style.left).toBe("34px");
    expect(overlay.style.top).toBe("26px");
    expect(overlay.style.width).toBe("280px");
    expect(overlay.style.height).toBe("87px");
  });

  it("drag across cells extends live", () => {
    mount(<Harness />);
    act(() => {
      cell(0, 0).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    act(() => {
      cell(2, 1).dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    });
    expect(refLabel()).toBe("A1:B3");
  });

  it("a column letter selects the whole column and a row number the whole row", () => {
    mount(<Harness />);
    const letters = host.querySelectorAll('[role="columnheader"]');
    click(letters[1]);
    expect(refLabel()).toBe("B1:B3");
    const nums = host.querySelectorAll('[role="rowheader"]');
    click(nums[2]);
    expect(refLabel()).toBe("A3:B3");
  });

  it("draws ONE overlay, not per-cell borders", () => {
    mount(<Harness />);
    click(cell(0, 0));
    click(cell(2, 1), { shiftKey: true });
    expect(host.querySelectorAll("[data-sheet-selection]").length).toBe(1);
  });
});

/* ═══════════════════════ §E — the sheet claims its keys ═══════════════════════ */

describe("the sheet claims its own keys", () => {
  it("a focused sheet grid counts as a typing target for the shared predicate", () => {
    mount(<Harness />);
    expect(isTypingTarget(grid())).toBe(true);
    expect(isTypingTarget(cell(1, 1))).toBe(true);
  });

  it("Backspace with a range selected clears CELLS and never reaches the page", () => {
    const patches: Record<string, unknown>[] = [];
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", spy);
    mount(<Harness onPatch={(p) => patches.push(p)} />);

    click(cell(1, 0));
    click(cell(1, 1), { shiftKey: true });
    press(cell(1, 1), "Backspace");

    // The page's window-level handler — the one that deletes a block
    // selection — never sees the key.
    expect(seen).not.toContain("Backspace");
    const last = patches.at(-1)!;
    expect(rawAt(last, 1, 0)).toBeUndefined();
    expect(rawAt(last, 1, 1)).toBeUndefined();
    // The sheet itself is still here.
    expect(grid()).toBeTruthy();
    window.removeEventListener("keydown", spy);
  });

  it("arrows, Enter, Tab, Escape and ⌘B all stop at the sheet", () => {
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", spy);
    mount(<Harness />);
    click(cell(1, 0));
    for (const key of ["ArrowDown", "ArrowRight", "Tab", "Escape"]) press(grid(), key);
    click(cell(1, 0));
    press(grid(), "b", { metaKey: true });
    press(grid(), "Enter");
    expect(seen).toEqual([]);
    window.removeEventListener("keydown", spy);
  });

  it("⌘Z still reaches the page's undo stack", () => {
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", spy);
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "z", { metaKey: true });
    expect(seen).toEqual(["z"]);
    window.removeEventListener("keydown", spy);
  });

  it("Escape clears the cell selection", () => {
    mount(<Harness />);
    click(cell(1, 0));
    expect(refLabel()).toBe("A2");
    press(grid(), "Escape");
    expect(refLabel()).toBe("—");
  });

  it("⌘B bolds the selected range through one patch", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 0));
    click(cell(1, 1), { shiftKey: true });
    press(grid(), "b", { metaKey: true });
    expect(patches.length).toBe(1);
    const cells = patches[0].cells as { b?: boolean }[][];
    expect(cells[1][0].b).toBe(true);
    expect(cells[1][1].b).toBe(true);
  });
});

/* ═══════════════════════ formula bar ═══════════════════════ */

describe("the formula bar", () => {
  it("shows the reference and the RAW value, formula source included", () => {
    mount(<Harness />);
    click(cell(2, 1));
    expect(refLabel()).toBe("B3");
    const bar = host.querySelector("[data-sheet-bar]") as HTMLInputElement;
    expect(bar.value).toBe("=SUM(B2:B2)");
  });

  it("typing in the bar edits the cell", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 1));
    const bar = host.querySelector("[data-sheet-bar]") as HTMLInputElement;
    typeInto(bar, "7");
    press(bar, "Enter");
    expect(rawAt(patches.at(-1)!, 1, 1)).toBe(7);
  });

  it("reads out Sum / Avg / count for a multi-numeric selection", () => {
    mount(
      <Harness
        initial={{
          id: "s2",
          type: "sheet",
          cells: [[{ v: 100 }], [{ v: 200 }], [{ v: 900 }]],
          cw: [120],
        }}
      />,
    );
    click(cell(0, 0));
    click(cell(2, 0), { shiftKey: true });
    expect(readout()).toBe("Sum 1,200 · Avg 400 · 3 numbers");
  });

  it("stays silent for a single cell", () => {
    mount(<Harness />);
    click(cell(1, 1));
    expect(readout()).toBeUndefined();
  });
});
