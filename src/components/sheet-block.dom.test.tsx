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
      cell(2, 1).dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
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

/* ═══════════════════════ chunk 4 — structural controls ═══════════════════════
   These test the WIRING and the edge decisions; the grid mutations
   themselves are covered by sheet-model / sheet-structure unit tests. */

const rowNums = () => host.querySelectorAll('[role="rowheader"]');
const colLetters = () => host.querySelectorAll('[role="columnheader"]');
const op = (id: string) => host.querySelector(`[data-sheet-op="${id}"]`) as HTMLButtonElement | null;
const spanLabel = () =>
  (host.querySelector("[data-sheet-span-label]") as HTMLElement | null)?.textContent;
const addRowBtn = () => host.querySelector('[data-sheet-add="row"]') as HTMLButtonElement;
const addColBtn = () => host.querySelector('[data-sheet-add="col"]') as HTMLButtonElement;
const divider = (c: number) => host.querySelector(`[data-sheet-divider="${c}"]`) as HTMLElement;

/** Buttons respond to a real click, not to the pointer pair `click()` sends. */
function tap(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function bigBlock(rows: number, cols = 2) {
  return {
    id: "s3",
    type: "sheet",
    cells: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({ v: `${r}${c}` })),
    ),
    cw: Array.from({ length: cols }, (_, c) => (c === 0 ? 160 : 120)),
  };
}

describe("the contextual group appears only for a full span", () => {
  it("is absent for a single cell and present for a whole row", () => {
    mount(<Harness />);
    click(cell(1, 1));
    expect(spanLabel()).toBeUndefined();
    click(rowNums()[1]);
    expect(spanLabel()).toBe("Row 2");
    expect(op("insertBefore")!.textContent).toBe("Above");
    expect(op("delete")!.textContent).toBe("Delete");
  });

  it("reads Rows 2–3 for a multi-row span and inserts that many", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness initial={bigBlock(5)} onPatch={(p) => patches.push(p)} />);
    click(rowNums()[1]);
    click(rowNums()[2], { shiftKey: true });
    expect(spanLabel()).toBe("Rows 2–3");
    tap(op("insertBefore")!);
    const cells = patches.at(-1)!.cells as { v?: unknown }[][];
    expect(cells.length).toBe(7);
    // The span moved down by two and kept its internal order.
    expect([cells[3][0].v, cells[4][0].v]).toEqual(["10", "20"]);
  });

  it("a column span labels by letter and moves as a block", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness initial={bigBlock(3, 3)} onPatch={(p) => patches.push(p)} />);
    click(colLetters()[1]);
    click(colLetters()[2], { shiftKey: true });
    expect(spanLabel()).toBe("Columns B–C");
    tap(op("moveBack")!);
    const cells = patches.at(-1)!.cells as { v?: unknown }[][];
    expect(cells[0].map((c) => c.v)).toEqual(["01", "02", "00"]);
  });
});

describe("floors, bounds and greyed controls", () => {
  it("Delete greys at the two-row floor and toasts instead of no-oping", () => {
    const onPatch = vi.fn();
    mount(<Harness initial={{ ...bigBlock(2), id: "s4" }} onPatch={onPatch} />);
    click(rowNums()[0]);
    const del = op("delete")!;
    expect(del.getAttribute("aria-disabled")).toBe("true");
    expect(del.title).toBe("A sheet keeps at least two rows");
    tap(del);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("Move greys at either end with Already first / Already last", () => {
    mount(<Harness initial={bigBlock(4)} />);
    click(rowNums()[0]);
    expect(op("moveBack")!.title).toBe("Already first");
    expect(op("moveFwd")!.title).toBe("Move down");
    click(rowNums()[3]);
    expect(op("moveFwd")!.title).toBe("Already last");
  });

  it("the append controls stay visible and inert at the bounds", () => {
    mount(<Harness initial={bigBlock(100)} />);
    expect(addRowBtn().title).toBe("100 rows is the limit");
    expect(addRowBtn().getAttribute("aria-disabled")).toBe("true");
    expect(addColBtn().title).toBe("Add column");
  });

  it("the bottom + appends a row at the end", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness initial={bigBlock(3)} onPatch={(p) => patches.push(p)} />);
    tap(addRowBtn());
    const cells = patches.at(-1)!.cells as ({ v?: unknown } | null)[][];
    expect(cells.length).toBe(4);
    expect(cells[3][0]).toBeNull();
  });

  it("the right + appends a column with the default width", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness initial={bigBlock(3)} onPatch={(p) => patches.push(p)} />);
    tap(addColBtn());
    expect(patches.at(-1)!.cw).toEqual([160, 120, 120]);
  });
});

describe("selection and the open editor survive a structural change", () => {
  it("deleting the selected row leaves a valid selection", () => {
    mount(<Harness initial={bigBlock(4)} />);
    click(rowNums()[2]);
    expect(refLabel()).toBe("A3:B3");
    tap(op("delete")!);
    // The selection lands on the NEW row 3, not on nothing.
    expect(refLabel()).toBe("A3:B3");
    expect(cell(2, 0).textContent).toBe("30");
  });

  it("selecting a full row COMMITS an open edit rather than orphaning it", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness initial={bigBlock(4)} onPatch={(p) => patches.push(p)} />);
    click(cell(2, 0));
    press(grid(), "x");
    typeInto(editor()!, "xyz");
    click(rowNums()[0]);
    // Focus moved to the grid, so the draft landed — no lost keystrokes,
    // and no editor left hovering over a row that is about to move.
    expect(editor()).toBeNull();
    expect(rawAt(patches.at(-1)!, 2, 0)).toBe("xyz");
    expect(spanLabel()).toBe("Row 1");
  });

  it("there is still exactly one input inside the grid", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "k");
    expect(grid().querySelectorAll("input").length).toBe(1);
  });
});

describe("column width dragging", () => {
  function drag(c: number, dx: number) {
    const el = divider(c);
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }),
      );
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100 + dx }));
    });
    return () =>
      act(() => {
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: 100 + dx }));
      });
  }

  it("clamps at 420 during the drag and writes once on release", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    const release = drag(0, 900);
    // Felt DURING the drag: the grid track is already clamped.
    expect(grid().style.gridTemplateColumns).toBe(`${SHEET_ROW_NUM_W}px 420px 120px`);
    expect(patches.length).toBe(0); // no write per pointermove
    release();
    expect(patches.length).toBe(1); // ONE undo entry per drag
    expect(patches[0].cw).toEqual([420, 120]);
  });

  it("clamps at 56 during the drag", () => {
    mount(<Harness />);
    drag(0, -400);
    expect(grid().style.gridTemplateColumns).toBe(`${SHEET_ROW_NUM_W}px 56px 120px`);
  });

  it("a drag on the divider does not select the column", () => {
    mount(<Harness />);
    drag(1, 20)();
    expect(refLabel()).toBe("—");
  });

  it("double-clicking a divider resets THAT column to its default", () => {
    const patches: Record<string, unknown>[] = [];
    mount(
      <Harness
        initial={{ ...block, id: "s5", cw: [300, 300] }}
        onPatch={(p) => patches.push(p)}
      />,
    );
    act(() => {
      divider(1).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(patches.at(-1)!.cw).toEqual([300, 120]);
    act(() => {
      divider(0).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(patches.at(-1)!.cw).toEqual([160, 120]);
  });
});
