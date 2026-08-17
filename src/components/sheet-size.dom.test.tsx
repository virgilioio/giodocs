// @vitest-environment happy-dom
/* Phase 2 of sheet type: the PER-CELL FONT SIZE control.
 *
 * Assertions are on the written patch and on the cell's class list only.
 * Rendered text size, line box and clipping are browser checks — happy-dom
 * cannot verify them, so they are deliberately absent here. */
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { SheetBlockView } from "./sheet-block";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const block = {
  id: "s1",
  type: "sheet",
  cells: [
    [{ v: "Deal" }, { v: "Value" }],
    [{ v: "Alpha" }, { v: 100 }],
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

function Harness({ onPatch }: { onPatch?: (p: Record<string, unknown>) => void }) {
  const [b, setB] = useState<Record<string, unknown>>(block);
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

function mount(onPatch?: (p: Record<string, unknown>) => void) {
  root = createRoot(host);
  act(() => root.render(<Harness onPatch={onPatch} />));
}

const cell = (r: number, c: number) =>
  host.querySelector(`[data-sheet-cell="${r},${c}"]`) as HTMLElement;
const btn = (id: string) =>
  host.querySelector(`[data-sheet-fmt="${id}"]`) as HTMLButtonElement | null;

function click(el: Element, opts: MouseEventInit = {}) {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...opts }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, ...opts }));
  });
}

function tap(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const fsAt = (patch: Record<string, unknown>, r: number, c: number) =>
  (patch.cells as { fs?: string }[][] | undefined)?.[r]?.[c]?.fs;

describe("the sheet's per-cell font size", () => {
  it("applies the size to every cell in the range in ONE write", () => {
    const patches: Record<string, unknown>[] = [];
    mount((p) => patches.push(p));
    click(cell(0, 0));
    click(cell(1, 1), { shiftKey: true });
    const before = patches.length;
    tap(btn("size-l")!);
    expect(patches.length).toBe(before + 1);
    const last = patches.at(-1)!;
    expect(fsAt(last, 0, 0)).toBe("l");
    expect(fsAt(last, 0, 1)).toBe("l");
    expect(fsAt(last, 1, 0)).toBe("l");
    expect(fsAt(last, 1, 1)).toBe("l");
    expect(cell(0, 0).className).toContain("text-ui");
    expect(cell(1, 1).className).toContain("text-ui");
  });

  it("picking the already-common size clears it back to the default", () => {
    const patches: Record<string, unknown>[] = [];
    mount((p) => patches.push(p));
    click(cell(0, 0));
    tap(btn("size-s")!);
    expect(fsAt(patches.at(-1)!, 0, 0)).toBe("s");
    expect(cell(0, 0).className).toContain("text-caption");
    tap(btn("size-s")!);
    expect(fsAt(patches.at(-1)!, 0, 0)).toBeUndefined();
    expect(cell(0, 0).className).toContain("text-meta");
  });

  it("the indicator matches the range's shared size, and is off when mixed", () => {
    mount();
    click(cell(0, 0));
    // Default: the middle step reads as active.
    expect(btn("size-m")!.getAttribute("aria-pressed")).toBe("true");
    tap(btn("size-l")!);
    expect(btn("size-l")!.getAttribute("aria-pressed")).toBe("true");
    expect(btn("size-m")!.getAttribute("aria-pressed")).toBeNull();
    // Extend over an unsized cell → mixed, so nothing reads active.
    click(cell(0, 0));
    click(cell(0, 1), { shiftKey: true });
    for (const id of ["size-s", "size-m", "size-l"])
      expect(btn(id)!.getAttribute("aria-pressed")).toBeNull();
  });
});
