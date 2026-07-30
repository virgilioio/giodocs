// @vitest-environment happy-dom
/* Diagnosis + regression tests for the table block's row/column menus.
 *
 * These render the REAL TableBlock through React and drive it the way a
 * person does: click the row handle (which selects and opens the menu in
 * one gesture), then click the menu row. The assertion is on the
 * `onChange` patch, because that patch is the only thing that leaves the
 * component — if it never arrives, the operation did not happen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { TableBlock } from "./page-editor-body";
import type { Blk } from "@/lib/block-ops";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const click = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const menuItem = (label: string): HTMLElement => {
  const items = Array.from(
    document.querySelectorAll('[role="menuitem"], button'),
  ) as HTMLElement[];
  const found = items.find((b) => (b.textContent ?? "").trim().startsWith(label));
  if (!found) throw new Error(`menu item not found: ${label}`);
  return found;
};

const handle = (kind: "row" | "col", i: number): HTMLElement => {
  const label = kind === "row" ? `Row ${i + 1} actions` : `Column ${i + 1} actions`;
  // Must be the BUTTON: cells also carry aria-labels that start with
  // "Row 2 …", and clicking one of those does nothing.
  const el = document.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`handle not found: ${label}`);
  return el as HTMLElement;
};

const table = (r: number, c: number): Blk => ({
  id: "t1",
  type: "table",
  rows: Array.from({ length: r }, (_, ri) =>
    Array.from({ length: c }, (_, ci) => `r${ri}c${ci}`),
  ),
});

describe("TableBlock delete row / delete column", () => {
  it("deletes a non-header row", () => {
    const onChange = vi.fn();
    mount(table(3, 2), onChange);
    click(handle("row", 1));
    click(menuItem("Delete row"));
    expect(onChange).toHaveBeenCalled();
    const patch = onChange.mock.calls.at(-1)![0] as { rows: string[][] };
    expect(patch.rows.length).toBe(2);
    expect(patch.rows.map((r) => r[0])).toEqual(["r0c0", "r2c0"]);
  });

  it("deletes the header row after confirming", () => {
    const onChange = vi.fn();
    mount(table(3, 2), onChange);
    click(handle("row", 0));
    click(menuItem("Delete row"));
    click(menuItem("Delete row"));
    const patch = onChange.mock.calls.at(-1)![0] as { rows: string[][] };
    expect(patch.rows.length).toBe(2);
    expect(patch.rows[0][0]).toBe("r1c0");
  });

  it("deletes a column", () => {
    const onChange = vi.fn();
    mount(table(2, 3), onChange);
    click(handle("col", 1));
    click(menuItem("Delete column"));
    const patch = onChange.mock.calls.at(-1)![0] as { rows: string[][] };
    expect(patch.rows[0]).toEqual(["r0c0", "r0c2"]);
  });
});
