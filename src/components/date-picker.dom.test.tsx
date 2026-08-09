// @vitest-environment happy-dom
/* The boundary that matters for the calendar: clicking a day COMMITS the
 * plain "YYYY-MM-DD" string AND closes the popover. Nothing here asserts
 * focus, hover, grid layout or :has() — happy-dom cannot verify them. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactNode } from "react";
import { DatePicker } from "./property-pickers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function mount(node: ReactNode) {
  act(() => root.render(node));
}
function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function panel(): Element | null {
  // The Popover portals into document.body, outside `host`.
  return document.body.querySelector('[data-day]');
}

describe("DatePicker calendar", () => {
  it("no native date input survives anywhere in the picker", () => {
    mount(<DatePicker value="2026-08-08" onSet={() => {}} triggerClassName="t" />);
    click(host.querySelector("button")!);
    expect(document.body.querySelector('input[type="date"]')).toBeNull();
  });

  it("clicking a day commits the string and closes", () => {
    const onSet = vi.fn();
    mount(<DatePicker value="2026-08-08" onSet={onSet} triggerClassName="t" />);
    click(host.querySelector("button")!);
    const cell = document.body.querySelector('[data-day="2026-08-19"]');
    expect(cell).not.toBeNull();
    click(cell!);
    expect(onSet).toHaveBeenCalledWith("2026-08-19");
    expect(typeof onSet.mock.calls[0][0]).toBe("string");
    expect(panel()).toBeNull();
  });

  it("always renders 42 day cells so paging never resizes the popover", () => {
    mount(<DatePicker value="2026-08-08" onSet={() => {}} triggerClassName="t" />);
    click(host.querySelector("button")!);
    expect(document.body.querySelectorAll("[data-day]").length).toBe(42);
    click(document.body.querySelector('[aria-label="Next month"]')!);
    expect(document.body.querySelectorAll("[data-day]").length).toBe(42);
  });

  it("Clear commits null and closes, and only shows with a value", () => {
    const onSet = vi.fn();
    mount(<DatePicker value="2026-08-08" onSet={onSet} triggerClassName="t" />);
    click(host.querySelector("button")!);
    const clear = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent === "Clear",
    );
    click(clear!);
    expect(onSet).toHaveBeenCalledWith(null);
    expect(panel()).toBeNull();

    const onSet2 = vi.fn();
    act(() => root.render(<DatePicker value={null} onSet={onSet2} triggerClassName="t" />));
    click(host.querySelector("button")!);
    expect(
      [...document.body.querySelectorAll("button")].some(
        (b) => b.textContent === "Clear",
      ),
    ).toBe(false);
  });
});
