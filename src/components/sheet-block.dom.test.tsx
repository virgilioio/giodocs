import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SheetBlockView, SHEET_ROW_NUM_W } from "./sheet-block";

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

/** The two containers a sheet may live in share the container renderer, so
 *  the only thing that can break is the grid track. */
function trackOf(root: HTMLElement): string {
  const grid = root.querySelector('[role="table"]') as HTMLElement;
  return grid.style.gridTemplateColumns;
}

describe("sheet renders inside containers", () => {
  it("keeps its grid track inside a column", () => {
    const { container } = render(
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <SheetBlockView block={block} pageScope={false} />
      </div>,
    );
    expect(trackOf(container as HTMLElement)).toBe(`${SHEET_ROW_NUM_W}px 160px 120px`);
  });

  it("keeps its grid track inside a callout", () => {
    const { container } = render(
      <div className="callout" style={{ padding: 12 }}>
        <SheetBlockView block={block} pageScope={false} />
      </div>,
    );
    expect(trackOf(container as HTMLElement)).toBe(`${SHEET_ROW_NUM_W}px 160px 120px`);
  });

  it("ignores the block width outside page scope, honours it at page scope", () => {
    const nested = render(<SheetBlockView block={block} pageScope={false} />);
    const nestedBox = nested.container.querySelector('[role="table"]')!.parentElement as HTMLElement;
    expect(nestedBox.style.width).toBe("");

    const page = render(<SheetBlockView block={block} pageScope />);
    const pageBox = page.container.querySelector('[role="table"]')!.parentElement as HTMLElement;
    expect(pageBox.style.width).toBe("900px");
  });

  it("shows computed values and the 50-row nudge only past 50 rows", () => {
    const { container, queryByText } = render(<SheetBlockView block={block} />);
    expect(container.textContent).toContain("100");
    expect(container.textContent).not.toContain("=SUM");
    expect(queryByText(/Past 50 rows/)).toBeNull();

    const big = {
      ...block,
      cells: Array.from({ length: 60 }, () => [{ v: 1 }, { v: 2 }]),
    };
    const tall = render(<SheetBlockView block={big} />);
    expect(tall.queryByText(/Past 50 rows/)).not.toBeNull();
  });
});
