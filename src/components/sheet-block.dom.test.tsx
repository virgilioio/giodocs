// @vitest-environment happy-dom
/* Rendering checks for the read-only sheet.
 *
 * The one thing containers can break is the grid track, and the one thing
 * page scope changes is the block width. Everything else is chunk 3+.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { SheetBlockView, SHEET_ROW_NUM_W } from "./sheet-block";

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
