// @vitest-environment happy-dom
/* Rendering tests for the four shared property editors.
 *
 * These are the SAME components the page properties strip and the table
 * cell both render, so a pass here is a pass in both places. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactNode } from "react";
import {
  DateValue,
  NumberEditor,
  TextEditor,
  CheckboxToggle,
} from "./property-pickers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 7, 8, 16, 30, 0); // 8 Aug 2026, 4:30pm local

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
function q<T extends Element>(sel: string): T {
  const el = host.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}
function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function type(input: HTMLInputElement, value: string) {
  // React tracks the last value it wrote, so a plain assignment can be
  // swallowed as "unchanged". Go through the native setter.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(el: Element, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: k }));
  });
}
function blur(el: Element) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("DateValue", () => {
  it("renders an overdue date in danger, with the triangle and the age", () => {
    mount(<DateValue value="2026-08-05" now={NOW} />);
    expect(host.textContent).toBe("Aug 5 · 3 days ago");
    expect(host.querySelector("svg")).not.toBeNull();
    expect(q("span").getAttribute("style")).toContain("--color-danger");
  });

  it("renders today as Today in amber, even at 4:30pm local", () => {
    mount(<DateValue value="2026-08-08" now={NOW} />);
    expect(host.textContent).toBe("Today");
    expect(q("span").getAttribute("style")).toContain("--color-amberInk");
  });

  it("renders a future date plainly, no triangle", () => {
    mount(<DateValue value="2026-09-01" now={NOW} />);
    expect(host.textContent).toBe("Sep 1");
    expect(host.querySelector("svg")).toBeNull();
  });

  it("a terminal status suppresses overdue treatment", () => {
    mount(<DateValue value="2026-08-01" now={NOW} terminal />);
    expect(host.querySelector("svg")).toBeNull();
  });

  it("a null value reads Empty", () => {
    mount(<DateValue value={null} now={NOW} />);
    expect(host.textContent).toBe("Empty");
  });

  it("shows the year when it differs from now", () => {
    mount(<DateValue value="2027-08-15" now={NOW} />);
    expect(host.textContent).toBe("Aug 15, 2027");
  });
});

describe("NumberEditor", () => {
  it("commits a JSON number on Enter", () => {
    const onSet = vi.fn();
    mount(<NumberEditor value={null} onSet={onSet} triggerClassName="t" />);
    click(q("button"));
    const input = q<HTMLInputElement>("input");
    type(input, "3");
    key(input, "Enter");
    expect(onSet).toHaveBeenCalledWith(3);
    expect(typeof onSet.mock.calls[0][0]).toBe("number");
  });

  it("rejects non-numeric input rather than storing NaN", () => {
    const onSet = vi.fn();
    mount(<NumberEditor value={null} onSet={onSet} triggerClassName="t" />);
    click(q("button"));
    const input = q<HTMLInputElement>("input");
    type(input, "abc");
    blur(input);
    expect(onSet).not.toHaveBeenCalled();
  });

  it("Escape reverts without committing", () => {
    const onSet = vi.fn();
    mount(<NumberEditor value={5} onSet={onSet} triggerClassName="t" />);
    click(q("button"));
    const input = q<HTMLInputElement>("input");
    type(input, "9");
    key(input, "Escape");
    expect(onSet).not.toHaveBeenCalled();
    expect(q("button").textContent).toBe("5");
  });

  it("an empty number reads Empty", () => {
    mount(<NumberEditor value={null} onSet={() => {}} triggerClassName="t" />);
    expect(host.textContent).toBe("Empty");
  });
});

describe("TextEditor", () => {
  it("commits on Enter", () => {
    const onSet = vi.fn();
    mount(<TextEditor value="old" onSet={onSet} triggerClassName="t" />);
    click(q("button"));
    const input = q<HTMLInputElement>("input");
    type(input, "new");
    key(input, "Enter");
    expect(onSet).toHaveBeenCalledWith("new");
  });

  it("reverts on Escape", () => {
    const onSet = vi.fn();
    mount(<TextEditor value="old" onSet={onSet} triggerClassName="t" />);
    click(q("button"));
    const input = q<HTMLInputElement>("input");
    type(input, "nope");
    key(input, "Escape");
    expect(onSet).not.toHaveBeenCalled();
    expect(q("button").textContent).toBe("old");
  });

  it("clearing to empty stores null so the value goes absent", () => {
    const onSet = vi.fn();
    mount(<TextEditor value="old" onSet={onSet} triggerClassName="t" />);
    click(q("button"));
    const input = q<HTMLInputElement>("input");
    type(input, "");
    blur(input);
    expect(onSet).toHaveBeenCalledWith(null);
  });
});

describe("CheckboxToggle", () => {
  it("an absent value is false and one click stores true", () => {
    const onSet = vi.fn();
    mount(
      <CheckboxToggle value={undefined} onSet={onSet} label="Confidential" />,
    );
    const box = q<HTMLInputElement>("input");
    expect(box.checked).toBe(false);
    click(box);
    expect(onSet).toHaveBeenCalledWith(true);
  });

  it("toggles back to false in one click", () => {
    const onSet = vi.fn();
    mount(<CheckboxToggle value={true} onSet={onSet} label="Confidential" />);
    click(q<HTMLInputElement>("input"));
    expect(onSet).toHaveBeenCalledWith(false);
  });
});
