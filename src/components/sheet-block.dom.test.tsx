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
import { newBlock } from "@/lib/block-ops";

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

  /* Chunk 8 made `bw` a symmetric BLEED DELTA on the block's own box rather
     than an absolute width on the scroll container: the sheet grows outward
     from the text column on both sides, so it stays visually centred. */
  it("ignores the block width outside page scope", () => {
    mount(<SheetBlockView block={block} pageScope={false} />);
    expect((box().parentElement as HTMLElement).style.width).toBe("");
    expect(box().style.width).toBe("");
  });

  it("honours the block width at page scope, as a symmetric bleed", () => {
    mount(<SheetBlockView block={block} pageScope />);
    const bleed = box().parentElement as HTMLElement;
    expect(bleed.style.width).toBe("calc(100% + 900px)");
    expect(bleed.style.marginLeft).toBe("-450px");
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

/* ═══════════════ autocomplete and click-to-reference (chunk 5) ═══════════════
 *
 * happy-dom has no layout engine, so offsetHeight/scrollHeight are always 0
 * here. The anti-squash rule is therefore asserted STRUCTURALLY — every row
 * carries flex: none and the list is the scroller inside a capped panel,
 * which is exactly the pair that prevents twenty rows squashing to nothing.
 */

const panel = () => host.querySelector("[data-sheet-panel]") as HTMLElement | null;
const panelRows = () =>
  Array.from(host.querySelectorAll("[data-sheet-suggestion]")) as HTMLElement[];
const panelFooter = () =>
  (host.querySelector("[data-sheet-panel-footer]") as HTMLElement | null)?.textContent;
const chip = () => (host.querySelector("[data-sheet-chip]") as HTMLElement | null)?.textContent;
const halo = () => host.querySelector("[data-sheet-halo]") as HTMLElement | null;

/** Types a value AND places the caret at the end, which is what the panel
 *  reads — it looks at the word under the caret, never the tail. */
function typeFormula(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the suggestion panel", () => {
  it('"=" opens all twenty functions in a capped, scrolling panel', () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    expect(panel()).toBeTruthy();
    expect(panelRows().length).toBe(20);
    // Each row refuses to shrink; the list scrolls inside the 226px cap.
    expect(panelRows().every((r) => r.style.flexShrink === "0")).toBe(true);
    const list = host.querySelector("[data-sheet-panel-list]") as HTMLElement;
    // No stylesheet in happy-dom, so the scroller is asserted by its class.
    expect(list.className).toContain("overflow-y-auto");
    expect(panel()!.style.maxHeight).toBe("226px");
    expect(panelFooter()).toBe("All 20 functions · type to narrow · ↑↓ Tab");
  });

  it('"=C" narrows to COUNT and CONCAT with the footer reading "2 of 20"', () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=C");
    expect(panelRows().map((r) => r.dataset.sheetSuggestion)).toEqual(["COUNT", "CONCAT"]);
    expect(panelFooter()).toBe("2 of 20 · ↑↓ to choose · Tab to insert");
  });

  it('Tab on "=SU" yields "=SUM(" with the caret at index 5', () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=SU");
    press(editor()!, "Tab");
    expect(editor()!.value).toBe("=SUM(");
    expect(editor()!.selectionStart).toBe(5);
  });

  it('typing "=MINUS" keeps focus on the same input node throughout', () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    const first = editor()!;
    const nodes: Element[] = [first];
    const active: (Element | null)[] = [document.activeElement];
    for (const v of ["=M", "=MI", "=MIN", "=MINU", "=MINUS"]) {
      typeFormula(editor()!, v);
      nodes.push(editor()!);
      active.push(document.activeElement);
    }
    expect(new Set(nodes).size).toBe(1);
    expect(active.every((el) => el === first)).toBe(true);
    expect(editor()!.value).toBe("=MINUS");
    expect(panelRows().map((r) => r.dataset.sheetSuggestion)).toEqual(["MINUS"]);
  });

  it("Escape closes the panel without leaving the cell; a second Escape discards", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    press(editor()!, "Escape");
    expect(panel()).toBeNull();
    expect(editor()).toBeTruthy();
    press(editor()!, "Escape");
    expect(editor()).toBeNull();
  });

  it("↑↓ with the panel open never reaches the page", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    act(() => {
      editor()!.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(panelRows()[1].getAttribute("aria-selected")).toBe("true");
  });

  it("once the caret is inside a call the chip replaces the list", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=SU");
    press(editor()!, "Tab");
    typeFormula(editor()!, "=SUM(A1");
    expect(panel()).toBeNull();
    expect(chip()).toBe("SUM(range)");
  });
});

describe("click-to-reference", () => {
  it('"=SUM(" then a cell mousedown is prevented and the draft becomes "=SUM(B2)"', () => {
    mount(<Harness />);
    click(cell(0, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=SUM(");
    const first = editor()!;
    const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      cell(1, 1).dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(editor()).toBe(first);
    expect(document.activeElement).toBe(first);
    // The halo marks the live pick; typing ends the pick, so assert it here.
    expect(halo()).toBeTruthy();
    typeFormula(editor()!, editor()!.value + ")");
    expect(editor()!.value).toBe("=SUM(B2)");
  });

  it("clicking a DIFFERENT cell replaces the reference rather than appending", () => {
    mount(<Harness />);
    click(cell(0, 0));
    press(grid(), "=");
    act(() => {
      cell(1, 1).dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(editor()!.value).toBe("=B2");
    act(() => {
      cell(2, 1).dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(editor()!.value).toBe("=B3");
  });

  it("with a complete formula a cell click still means LEAVE THIS CELL", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(0, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=1+1");
    click(cell(1, 1));
    expect(editor()).toBeNull();
    expect(rawAt(patches.at(-1)!, 0, 0)).toBe("=1+1");
    expect(cell(1, 1).textContent).toBe("100");
  });
});

/* ═══════════════════════ the formatting toolbar (chunk 6) ═══════════════════
 *
 * The chunk-5 regression guard lives here too: the toolbar installs a
 * CAPTURE-PHASE document mousedown listener, and capture runs before the
 * cell's own handler, so click-to-reference is the thing most likely to
 * break. It is asserted explicitly, with the toolbar mounted.
 */

const toolbar = () => host.querySelector("[data-sheet-toolbar]") as HTMLElement | null;
const fmtBtn = (id: string) =>
  host.querySelector(`[data-sheet-fmt="${id}"]`) as HTMLElement | null;
const palette = () => host.querySelector("[data-sheet-palette]") as HTMLElement | null;

/** A real click on a toolbar control: mousedown (which the control must
 *  preventDefault, so an open editor is never blurred) then click. */
function tbClick(el: Element) {
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(down);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return down;
}

function mouseDownAt(el: EventTarget) {
  const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

describe("the toolbar appears with a selection and dismisses outside the block", () => {
  it("is absent until a cell is selected", () => {
    mount(<Harness />);
    expect(toolbar()).toBeNull();
    click(cell(1, 1));
    expect(toolbar()).toBeTruthy();
  });

  it("a mousedown INSIDE [data-sheet] leaves it up", () => {
    mount(<Harness />);
    click(cell(1, 1));
    mouseDownAt(cell(2, 1));
    expect(toolbar()).toBeTruthy();
  });

  it("a mousedown OUTSIDE [data-sheet] clears the selection and the toolbar", () => {
    mount(<Harness />);
    click(cell(1, 1));
    mouseDownAt(document.body);
    expect(toolbar()).toBeNull();
    expect(refLabel()).toBe("—");
  });
});

describe("toolbar writes act on the whole selection", () => {
  it("Bold over a mixed range sets it on every cell, then clears every cell", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 0));
    click(cell(1, 1), { shiftKey: true });
    tbClick(fmtBtn("bold")!);
    let cells = patches.at(-1)!.cells as { b?: boolean }[][];
    expect([cells[1][0].b, cells[1][1].b]).toEqual([true, true]);
    expect(fmtBtn("bold")!.getAttribute("aria-pressed")).toBe("true");
    tbClick(fmtBtn("bold")!);
    cells = patches.at(-1)!.cells as { b?: boolean }[][];
    expect([cells[1][0].b, cells[1][1].b]).toEqual([undefined, undefined]);
    expect(fmtBtn("bold")!.getAttribute("aria-pressed")).toBeNull();
  });

  it("percent format renders a sub-1% value at two decimals via format()", () => {
    const patches: Record<string, unknown>[] = [];
    mount(
      <Harness
        initial={{ ...block, cells: [[{ v: 0.0004 }, { v: "x" }], [{ v: 1 }, { v: 2 }]] }}
        onPatch={(p) => patches.push(p)}
      />,
    );
    click(cell(0, 0));
    tbClick(fmtBtn("f-pct")!);
    expect((patches.at(-1)!.cells as { f?: string }[][])[0][0].f).toBe("pct");
    expect(cell(0, 0).textContent).toBe("0.04%");
  });

  it("Clear formatting empties every style key and leaves every value intact", () => {
    const patches: Record<string, unknown>[] = [];
    mount(
      <Harness
        initial={{
          ...block,
          cells: [
            [
              { v: "Total", b: true, i: true, a: "center", bg: "green", fg: "red", rt: true },
              { v: 12, f: "currency", d: 3, b: true },
            ],
            [{ v: 1 }, { v: 2 }],
          ],
        }}
        onPatch={(p) => patches.push(p)}
      />,
    );
    click(cell(0, 0));
    click(cell(0, 1), { shiftKey: true });
    tbClick(fmtBtn("clear")!);
    const cells = patches.at(-1)!.cells as Record<string, unknown>[][];
    expect(Object.keys(cells[0][0])).toEqual(["v"]);
    expect(Object.keys(cells[0][1])).toEqual(["v"]);
    expect([cells[0][0].v, cells[0][1].v]).toEqual(["Total", 12]);
  });

  it("the palette strip writes a KEY, and None clears it", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 1));
    tbClick(fmtBtn("pal-bg")!);
    expect(palette()!.dataset.sheetPalette).toBe("bg");
    tbClick(host.querySelector('[data-sheet-swatch="green"]')!);
    expect((patches.at(-1)!.cells as { bg?: string }[][])[1][1].bg).toBe("green");
    tbClick(fmtBtn("pal-bg")!);
    tbClick(host.querySelector('[data-sheet-swatch="none"]')!);
    expect((patches.at(-1)!.cells as { bg?: string }[][])[1][1].bg).toBeUndefined();
  });

  it("Header toggles the block's freeze and reflects it", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 1));
    tbClick(fmtBtn("freeze")!);
    expect(patches.at(-1)!.freeze).toBe(true);
    expect(fmtBtn("freeze")!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the toolbar never becomes a second input site", () => {
  it("clicking Bold mid-edit does not commit or clear the draft", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 0));
    press(grid(), "Enter");
    typeInto(editor()!, "half-typed");
    const before = patches.length;
    const down = tbClick(fmtBtn("bold")!);
    expect(down.defaultPrevented).toBe(true);
    expect(editor()).toBeTruthy();
    expect(editor()!.value).toBe("half-typed");
    expect(patches.length).toBe(before + 1);
    expect(rawAt(patches.at(-1)!, 1, 0)).toBe("Alpha");
  });

  it("REGRESSION GUARD: with the capture listener installed, \"=SUM(\" plus a cell mousedown still yields \"=SUM(B2)\"", () => {
    mount(<Harness />);
    click(cell(0, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=SUM(");
    const first = editor()!;
    const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      cell(1, 1).dispatchEvent(ev);
      cell(1, 1).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(editor()).toBe(first);
    typeFormula(editor()!, editor()!.value + ")");
    expect(editor()!.value).toBe("=SUM(B2)");
  });

  it("the suggestion panel survives the capture listener", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    mouseDownAt(host.querySelector("[data-sheet-suggestion]")!);
    expect(panel()).toBeTruthy();
    expect(editor()).toBeTruthy();
  });
});

/* ═══════════════════ chunk 7 — clipboard, ants, fill ═══════════════════ */

const ants = () => host.querySelectorAll("[data-sheet-ants]");
const fillHandle = () => host.querySelector("[data-sheet-fill-handle]") as HTMLElement | null;

describe("the sheet claims the clipboard keys", () => {
  it("⌘C draws exactly ONE ants overlay, not per-cell borders, and Escape clears it", () => {
    mount(<Harness />);
    click(cell(1, 0));
    click(cell(2, 1), { shiftKey: true });
    press(grid(), "c", { metaKey: true });
    expect(ants().length).toBe(1);
    const rectEl = ants()[0] as HTMLElement;
    // Positioned with rangeBox arithmetic: row 2 of 3, both columns.
    expect(rectEl.style.left).toBe("34px");
    expect(rectEl.style.width).toBe("280px");
    press(grid(), "Escape");
    expect(ants().length).toBe(0);
  });

  it("⌘C with a range selected never reaches the page's block copy", () => {
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", spy);
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "c", { metaKey: true });
    window.removeEventListener("keydown", spy);
    expect(seen).not.toContain("c");
  });

  it("⌘Z still reaches the page — the page owns the history", () => {
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", spy);
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "z", { metaKey: true });
    window.removeEventListener("keydown", spy);
    expect(seen).toContain("z");
  });

  it("while EDITING, ⌘C stays native so copying inside the input works", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "Enter");
    const ev = new KeyboardEvent("keydown", {
      key: "c",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editor()!.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
    expect(ants().length).toBe(0);
  });

  it("cut then Escape leaves the source intact — no write happens on the cut", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 1));
    press(grid(), "x", { metaKey: true });
    expect(patches.length).toBe(0);
    press(grid(), "Escape");
    expect(patches.length).toBe(0);
  });

  it("cut then paste elsewhere clears the source and lands the value", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 1));
    press(grid(), "x", { metaKey: true });
    click(cell(2, 0));
    press(grid(), "v", { metaKey: true });
    const last = patches[patches.length - 1];
    expect(rawAt(last, 2, 0)).toBe(100);
    expect(rawAt(last, 1, 1)).toBeUndefined();
  });
});

describe("the fill handle", () => {
  it("appears with a selection, hides while editing, and fills along the drag axis", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(1, 1));
    expect(fillHandle()).toBeTruthy();

    act(() => {
      fillHandle()!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    act(() => {
      cell(2, 1).dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });
    expect(host.querySelector("[data-sheet-fill-preview]")).toBeTruthy();
    act(() => {
      grid().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    });
    const last = patches[patches.length - 1];
    expect(rawAt(last, 2, 1)).toBe(100);
  });

  it("is absent while a cell is being edited", () => {
    mount(<Harness />);
    click(cell(1, 1));
    press(grid(), "Enter");
    expect(fillHandle()).toBeNull();
  });
});

/* ═══════════════════ chunk 8: the block resize + clamp ═══════════════════ */

const gripEl = () => host.querySelector("[data-sheet-grip]") as HTMLElement;
const sizeReadout = () =>
  (host.querySelector("[data-sheet-size-readout]") as HTMLElement | null)?.textContent;
const scrollBox = () => host.querySelector("[data-sheet-scroll]") as HTMLElement;

/** A grip drag. Listeners are on WINDOW during the drag, because the block
 *  shrinks out from under the pointer. */
function dragGrip(dx: number, dy: number) {
  act(() => {
    gripEl().dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 0,
        clientY: 0,
      }),
    );
  });
  act(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: dx, clientY: dy }));
  });
}

function releaseGrip() {
  act(() => {
    window.dispatchEvent(new PointerEvent("pointerup", {}));
  });
}

describe("the block resize grip", () => {
  it("writes ONE patch per drag, on release, carrying both axes", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness initial={{ ...block, bw: 0 }} onPatch={(p) => patches.push(p)} />);
    dragGrip(60, -40);
    expect(patches.length).toBe(0); // nothing written mid-drag → one undo entry
    expect(sizeReadout()).toContain("wide");
    releaseGrip();
    expect(patches.length).toBe(1);
    expect(patches[0]).toHaveProperty("bw");
    expect(patches[0]).toHaveProperty("bh");
    expect(sizeReadout()).toBeUndefined();
  });

  it("clamps the width against the live container, never a constant", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness initial={{ ...block, bw: 0 }} onPatch={(p) => patches.push(p)} />);
    dragGrip(100000, 0);
    releaseGrip();
    const bw = patches[patches.length - 1].bw as number;
    // The measured room is the viewport here (no scrollable ancestor), and
    // the natural width is whatever the block measures — the ceiling must
    // leave GRIP_PAD, so it can never be the requested 200000.
    expect(bw).toBeLessThanOrEqual(window.innerWidth - 20);
    expect(bw).toBeGreaterThanOrEqual(0);
  });

  /* THE PAGE MUST NEVER GAIN A HORIZONTAL SCROLLBAR — a bw past the
     container's room slides every prose block on the page sideways, and the
     grip itself off-screen. happy-dom does not lay out, so this asserts the
     invariant that the clamp guarantees (the written delta leaves the pad)
     alongside the document-level check. */
  it("a maximal drag leaves documentElement.scrollWidth === clientWidth", () => {
    mount(<Harness initial={{ ...block, bw: 0 }} />);
    dragGrip(100000, 0);
    releaseGrip();
    const de = document.documentElement;
    expect(de.scrollWidth).toBe(de.clientWidth);
  });

  it("double-click resets both bw and bh", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness initial={{ ...block, bw: 400, bh: 200 }} onPatch={(p) => patches.push(p)} />);
    act(() => {
      gripEl().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    expect(patches[patches.length - 1]).toEqual({ bw: 0, bh: 0 });
    expect(scrollBox().style.maxHeight).toBe("");
  });

  it("bleeds symmetrically at page scope so the sheet stays visually centred", () => {
    mount(<SheetBlockView block={{ ...block, bw: 160 }} onChange={() => {}} />);
    const bleed = scrollBox().parentElement as HTMLElement;
    expect(bleed.style.width).toBe("calc(100% + 160px)");
    expect(bleed.style.marginLeft).toBe("-80px");
  });

  it("inside a container ignores bw but still applies bh", () => {
    const patches: Record<string, unknown>[] = [];
    mount(
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <SheetBlockView
          block={{ ...block, bw: 0, bh: 0 }}
          pageScope={false}
          onChange={(p) => patches.push(p)}
        />
      </div>,
    );
    const bleed = scrollBox().parentElement as HTMLElement;
    expect(bleed.style.width).toBe("");
    dragGrip(200, -120);
    expect(scrollBox().style.maxHeight).not.toBe("");
    releaseGrip();
    const last = patches[patches.length - 1];
    expect(last.bw).toBe(0);
    expect(last.bh).not.toBe(0);
  });

  it("does not steal the fill handle's press — they are in different boxes", () => {
    mount(<Harness initial={{ ...block, bw: 0 }} />);
    click(cell(1, 1));
    expect(scrollBox().contains(fillHandle())).toBe(true);
    expect(scrollBox().contains(gripEl())).toBe(false);
  });
});

describe("the grid wrapper is the scroll container for BOTH axes", () => {
  it("scrolls on x and y, so chunk 2's sticky headers have something to pin to", () => {
    mount(<SheetBlockView block={block} />);
    expect(scrollBox().className).toContain("overflow-auto");
    expect(grid().style.width).toBe("max-content");
  });

  it("pins the corner, the column letters and the row numbers", () => {
    mount(<SheetBlockView block={block} />);
    const corner = host.querySelector('[aria-label="Select all cells"]') as HTMLElement;
    expect([corner.style.position, corner.style.top, corner.style.left]).toEqual([
      "sticky",
      "0px",
      "0px",
    ]);
    const letter = host.querySelectorAll('[role="columnheader"]')[1] as HTMLElement;
    expect([letter.style.position, letter.style.top]).toEqual(["sticky", "0px"]);
    const rowNum = host.querySelectorAll('[role="rowheader"]')[1] as HTMLElement;
    expect([rowNum.style.position, rowNum.style.left]).toEqual(["sticky", "0px"]);
  });

  it("pins a frozen first row below the column letters", () => {
    mount(<SheetBlockView block={{ ...block, freeze: true }} />);
    // The pin lives on the ROW, not the cell — one sticky element per row
    // rather than one per cell.
    const row = cell(0, 1).closest('[role="row"]') as HTMLElement;
    expect(row.style.position).toBe("sticky");
    expect(row.style.top).toBe("26px");
  });
});

/* ═════════════ THE EDIT SURVIVES A PICK (bug 1) ═════════════
 * Every earlier test asserted the INSERTION and stopped there — none
 * asserted that the edit survived it. The failure needed the FULL browser
 * gesture: pointerdown, then mousedown (which is the event that moves
 * focus, and which the cell was not cancelling), then click. */

/** A real click: the whole compatibility sequence, with the focus shift a
 *  browser performs on an uncancelled mousedown emulated explicitly. */
function realClick(el: Element) {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    const md = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(md);
    if (!md.defaultPrevented) (document.activeElement as HTMLElement | null)?.blur?.();
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

describe("the edit survives a pick", () => {
  it("a suggestion-row CLICK leaves the edit open, focused, with \"=SUM(\"", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=SU");
    const first = editor()!;
    realClick(host.querySelector('[data-sheet-suggestion="SUM"]')!);
    expect(editor()).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(editor()!.value).toBe("=SUM(");
  });

  it("a cell CLICK during a formula pick leaves the edit open, focused, with \"=SUM(B2\"", () => {
    mount(<Harness />);
    click(cell(0, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=SUM(");
    const first = editor()!;
    realClick(cell(1, 1));
    expect(editor()).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(editor()!.value).toBe("=SUM(B2");
  });

  it("typing continues after a suggestion click and after a cell pick", () => {
    mount(<Harness />);
    click(cell(1, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=SU");
    realClick(host.querySelector('[data-sheet-suggestion="SUM"]')!);
    realClick(cell(1, 1));
    expect(editor()!.value).toBe("=SUM(B2");
    typeFormula(editor()!, editor()!.value + ")");
    expect(editor()!.value).toBe("=SUM(B2)");
    expect(document.activeElement).toBe(editor());
  });

  it("THE ESCAPE HATCH: a cell click with a COMPLETE formula commits and moves", () => {
    const patches: Record<string, unknown>[] = [];
    mount(<Harness onPatch={(p) => patches.push(p)} />);
    click(cell(0, 0));
    press(grid(), "=");
    typeFormula(editor()!, "=1+1");
    realClick(cell(2, 0));
    expect(editor()).toBeNull();
    expect(rawAt(patches.at(-1)!, 0, 0)).toBe("=1+1");
  });
});

/* A brand-new sheet must be usable on arrival — 10 rows × 5 columns, the
 * first column wider. A sheet you have to grow before you can use it is a
 * sheet nobody uses. */
describe("a brand-new sheet", () => {
  it("renders 10 rows × 5 columns with the first column wider", () => {
    mount(<SheetBlockView block={newBlock("sheet") as unknown as Record<string, unknown>} />);
    expect(host.querySelectorAll('[role="row"]').length).toBe(10);
    expect(host.querySelectorAll('[data-sheet-cell^="0,"]').length).toBe(5);
    expect(grid().style.gridTemplateColumns).toBe(
      `${SHEET_ROW_NUM_W}px 160px 120px 120px 120px`,
    );
  });
});
