// @vitest-environment happy-dom
/* Phase 1 of sheet overflow: the RENDERED inner span.
 *
 * These are string assertions on the style attribute only. Painting,
 * z-order and real clipping are browser checks, not happy-dom ones. */
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { SheetBlockView } from "./sheet-block";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

const block = {
  id: "s1",
  type: "sheet",
  cells: [
    // row 0: a long text with two empty neighbours, then an occupied cell
    [{ v: "a very long label indeed" }, null, null, { v: "x" }],
    // row 1: a long text immediately blocked on the right
    [{ v: "another long label" }, { v: "blocker" }, null, null],
    // row 2: a number with empties to the right — must NOT overflow
    [{ v: 1234567 }, null, null, null],
  ],
  cw: [100, 80, 60, 40],
  bw: 900,
};

const mount = () => {
  root = createRoot(host);
  act(() => root.render(<SheetBlockView block={block} pageScope={false} />));
};

const cell = (r: number, c: number) =>
  host.querySelector(`[data-sheet-cell="${r},${c}"]`) as HTMLElement;
const run = (r: number, c: number) =>
  cell(r, c).querySelector("[data-sheet-run]") as HTMLElement | null;

describe("sheet cell overflow rendering", () => {
  it("renders an inner span spanning the empty run", () => {
    mount();
    const span = run(0, 0);
    expect(span).not.toBeNull();
    const style = span!.getAttribute("style") ?? "";
    expect(style).toContain("left: 0px");
    expect(style).toContain("width: 240px");
    expect(span!.textContent).toBe("a very long label indeed");
  });

  it("renders no span for a blocked cell", () => {
    mount();
    expect(run(1, 0)).toBeNull();
    expect(cell(1, 0).textContent).toBe("another long label");
  });

  it("renders no span for a numeric cell", () => {
    mount();
    expect(run(2, 0)).toBeNull();
  });
});

describe("overflow span is paint-only", () => {
  it("carries pointer-events: none", () => {
    mount();
    const style = run(0, 0)!.getAttribute("style") ?? "";
    expect(style).toContain("pointer-events: none");
  });
});
