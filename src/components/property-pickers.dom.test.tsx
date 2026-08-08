/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  DateValue,
  NumberEditor,
  TextEditor,
  CheckboxToggle,
} from "./property-pickers";

afterEach(cleanup);

const NOW = new Date(2026, 7, 8, 16, 30, 0); // 8 Aug 2026, 4:30pm local

describe("DateValue", () => {
  it("renders an overdue date in danger with the relative age", () => {
    const { container } = render(
      <DateValue value="2026-08-05" now={NOW} />,
    );
    expect(container.textContent).toBe("5 Aug · 3 days ago");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("span")?.getAttribute("style")).toContain(
      "--color-danger",
    );
  });

  it("renders today as Today in amber, even at 4:30pm", () => {
    const { container } = render(<DateValue value="2026-08-08" now={NOW} />);
    expect(container.textContent).toBe("Today");
    expect(container.querySelector("span")?.getAttribute("style")).toContain(
      "--color-amberInk",
    );
  });

  it("renders a future date plainly and without the triangle", () => {
    const { container } = render(<DateValue value="2026-09-01" now={NOW} />);
    expect(container.textContent).toBe("1 Sep");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("a terminal status suppresses overdue styling", () => {
    const { container } = render(
      <DateValue value="2026-08-01" now={NOW} terminal />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("a null value reads Empty", () => {
    const { container } = render(<DateValue value={null} now={NOW} />);
    expect(container.textContent).toBe("Empty");
  });
});

describe("NumberEditor", () => {
  it("commits a JSON number on Enter", () => {
    const onSet = vi.fn();
    render(<NumberEditor value={null} onSet={onSet} triggerClassName="t" />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByLabelText("Number value");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSet).toHaveBeenCalledWith(3);
    expect(typeof onSet.mock.calls[0][0]).toBe("number");
  });

  it("rejects non-numeric input rather than storing NaN", () => {
    const onSet = vi.fn();
    render(<NumberEditor value={null} onSet={onSet} triggerClassName="t" />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByLabelText("Number value");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(onSet).not.toHaveBeenCalled();
  });

  it("Escape reverts without committing", () => {
    const onSet = vi.fn();
    render(<NumberEditor value={5} onSet={onSet} triggerClassName="t" />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByLabelText("Number value");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSet).not.toHaveBeenCalled();
    expect(screen.getByRole("button").textContent).toBe("5");
  });
});

describe("TextEditor", () => {
  it("commits on Enter and reverts on Escape", () => {
    const onSet = vi.fn();
    render(<TextEditor value="old" onSet={onSet} triggerClassName="t" />);
    fireEvent.click(screen.getByRole("button"));
    let input = screen.getByLabelText("Text value");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSet).toHaveBeenCalledWith("new");

    cleanup();
    onSet.mockClear();
    render(<TextEditor value="old" onSet={onSet} triggerClassName="t" />);
    fireEvent.click(screen.getByRole("button"));
    input = screen.getByLabelText("Text value");
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSet).not.toHaveBeenCalled();
  });

  it("clearing to empty stores null so the value disappears", () => {
    const onSet = vi.fn();
    render(<TextEditor value="old" onSet={onSet} triggerClassName="t" />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByLabelText("Text value");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onSet).toHaveBeenCalledWith(null);
  });
});

describe("CheckboxToggle", () => {
  it("an absent value is false and one click stores true", () => {
    const onSet = vi.fn();
    render(<CheckboxToggle value={undefined} onSet={onSet} label="Confidential" />);
    const box = screen.getByLabelText("Confidential") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onSet).toHaveBeenCalledWith(true);
  });

  it("toggles back to false in one click", () => {
    const onSet = vi.fn();
    render(<CheckboxToggle value={true} onSet={onSet} label="Confidential" />);
    fireEvent.click(screen.getByLabelText("Confidential"));
    expect(onSet).toHaveBeenCalledWith(false);
  });
});
