// @vitest-environment happy-dom
/* Drag-to-reorder for table rows and columns.
 *
 * These drive the REAL TableBlock through pointer events on the existing
 * row/column handles and assert the COMMITTED patch — the gesture itself is
 * unobservable in happy-dom, but the patch is the only thing that leaves the
 * component, so it is the only honest assertion. Layout is unmeasured here,
 * so the drag's index resolution falls back to its nominal step (24px per
 * row, 100px per column) — that is what the coordinates below encode.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MARQUEE_SKIP_SEL, TableBlock } from "./page-editor-body";
import type { Blk } from "@/lib/block-ops";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW_H = 24;
const COL_W = 100;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

const mount = (block: Blk, onChange: (p: Partial<Blk>) => void) => {
  root = createRoot(host);
  act(() => {
    root.render(<TableBlock block={block} locked={false} onChange={onChange} />);
  });
};

const handle = (kind: "row" | "col", i: number): HTMLElement => {
  const label = kind === "row" ? `Row ${i + 1} actions` : `Column ${i + 1} actions`;
  const el = document.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`handle not found: ${label}`);
  return el as HTMLElement;
};

type Pt = { x?: number; y?: number };

const pointer = (el: Element, type: string, { x = 0, y = 0 }: Pt) => {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  act(() => {
    el.dispatchEvent(ev);
  });
};

/** Full press → move → release on a handle. */
const drag = (el: Element, from: Pt, to: Pt) => {
  pointer(el, "pointerdown", from);
  pointer(el, "pointermove", to);
  pointer(el, "pointerup", to);
};

const click = (el: Element) => {
  pointer(el, "pointerdown", { x: 0, y: 0 });
  pointer(el, "pointerup", { x: 0, y: 0 });
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const menuLabels = (): string[] =>
  Array.from(document.querySelectorAll('[role="menuitem"], button'))
    .map((b) => (b.textContent ?? "").trim())
    .filter(Boolean);

const table = (r: number, c: number, extra: Partial<Blk> = {}): Blk => ({
  id: "t1",
  type: "table",
  rows: Array.from({ length: r }, (_, ri) =>
    Array.from({ length: c }, (_, ci) => `r${ri}c${ci}`),
  ),
  ...extra,
});

const lastPatch = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls.at(-1)![0] as Partial<Blk>;

describe("table drag-to-reorder", () => {
  it("dragging a row's handle down commits the moveRow order", () => {
    const onChange = vi.fn();
    mount(table(5, 2, { headerRow: false, align: ["left", "left"] }), onChange);
    drag(handle("row", 1), { y: ROW_H * 1 }, { y: ROW_H * 3 });
    const patch = lastPatch(onChange) as { rows: string[][]; align?: unknown; widths?: unknown };
    expect(patch.rows.map((r) => r[0])).toEqual([
      "r0c0",
      "r2c0",
      "r3c0",
      "r1c0",
      "r4c0",
    ]);
    // A row move never touches the column shadow arrays.
    expect(patch.align).toBeUndefined();
    expect(patch.widths).toBeUndefined();
  });

  it("dragging a column reorders cells, align AND widths in step", () => {
    const onChange = vi.fn();
    mount(
      table(2, 4, {
        align: ["left", "center", "right", "left"],
        widths: [100, 200, 300, 400],
      }),
      onChange,
    );
    drag(handle("col", 1), { x: COL_W * 1 }, { x: COL_W * 3 });
    const patch = lastPatch(onChange) as {
      rows: string[][];
      align: string[];
      widths: number[];
    };
    expect(patch.rows[0]).toEqual(["r0c0", "r0c2", "r0c3", "r0c1"]);
    expect(patch.align).toEqual(["left", "right", "left", "center"]);
    expect(patch.widths).toEqual([100, 300, 400, 200]);
  });

  it("with headerRow, a drop at index 0 lands at index 1 and row 0 is unchanged", () => {
    const onChange = vi.fn();
    mount(table(4, 2), onChange);
    drag(handle("row", 2), { y: ROW_H * 2 }, { y: 0 });
    const patch = lastPatch(onChange) as { rows: string[][] };
    expect(patch.rows.map((r) => r[0])).toEqual(["r0c0", "r2c0", "r1c0", "r3c0"]);
  });

  it("with headerRow false, a row CAN be dropped at index 0", () => {
    const onChange = vi.fn();
    mount(table(4, 2, { headerRow: false }), onChange);
    drag(handle("row", 2), { y: ROW_H * 2 }, { y: 0 });
    const patch = lastPatch(onChange) as { rows: string[][] };
    expect(patch.rows.map((r) => r[0])).toEqual(["r2c0", "r0c0", "r1c0", "r3c0"]);
  });

  it("with headerRow, the row menu offers no Move up on row 1", () => {
    mount(table(4, 2), vi.fn());
    click(handle("row", 1));
    const labels = menuLabels();
    expect(labels.some((l) => l.startsWith("Move down"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Move up"))).toBe(false);
  });

  it("with headerRow, the row menu offers no Move down on row 0", () => {
    mount(table(4, 2), vi.fn());
    click(handle("row", 0));
    const labels = menuLabels();
    expect(labels.some((l) => l.startsWith("Move down"))).toBe(false);
  });

  it("with headerRow false, row 1 keeps Move up", () => {
    mount(table(4, 2, { headerRow: false }), vi.fn());
    click(handle("row", 1));
    expect(menuLabels().some((l) => l.startsWith("Move up"))).toBe(true);
  });

  it("a press with no movement opens the menu and commits no reorder", () => {
    const onChange = vi.fn();
    mount(table(4, 2), onChange);
    click(handle("row", 2));
    expect(menuLabels().some((l) => l.startsWith("Delete row"))).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marquee guard skips handles, cells and sheets", () => {
    expect(MARQUEE_SKIP_SEL).toContain("[data-table-handle]");
    expect(MARQUEE_SKIP_SEL).toContain("[data-table-cell]");
    expect(MARQUEE_SKIP_SEL).toContain("[data-sheet]");
  });
});
