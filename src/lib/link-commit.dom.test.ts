// @vitest-environment happy-dom
/* commitSourceToEditable renders canonical HTML deterministically.
 *
 * Asserts on the DOM NODES, not on the source string: the bug that shipped
 * was that the source was right while the screen showed literal markdown.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { commitSourceToEditable, readEditableSource } from "./link-commit";

let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  el = document.createElement("div");
  el.contentEditable = "true";
  document.body.appendChild(el);
});

describe("commitSourceToEditable", () => {
  it("renders bold as a <strong> element", () => {
    commitSourceToEditable(el, "**bold**", 8);
    expect(el.querySelector("strong")).toBeTruthy();
    expect(el.querySelector("strong")!.textContent).toBe("bold");
    expect(el.textContent).not.toContain("**");
  });

  it("renders a link as an <a href>", () => {
    commitSourceToEditable(el, "[a](https://x.com)", 18);
    const a = el.querySelector("a");
    expect(a).toBeTruthy();
    expect(a!.getAttribute("href")).toBe("https://x.com");
    expect(a!.textContent).toBe("a");
  });

  it("round-trips back to the same source (Editable's sync effect is a no-op)", () => {
    const src = "click [here](https://gogio.io) now";
    commitSourceToEditable(el, src, src.length);
    expect(readEditableSource(el)).toBe(src);
  });

  it("sets .value on a textarea and leaves it unrendered", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    commitSourceToEditable(ta, "[a](https://x.com)", 1);
    expect(ta.value).toBe("[a](https://x.com)");
  });

  it("dispatches an input event so React state commits", () => {
    let n = 0;
    el.addEventListener("input", () => n++);
    commitSourceToEditable(el, "**b**", 5);
    expect(n).toBe(1);
  });
});
