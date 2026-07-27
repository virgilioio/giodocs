// @vitest-environment happy-dom
/* DOM caret tests for ce-offsets. Runs in happy-dom (a test-only
 * devDependency; never bundled — check-bundle asserts dist/client
 * is clean).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  getCaretOffset,
  readCaretSource,
  setCaretOffset,
  writeCaretSource,
} from "./ce-offsets";
import { inlineToHtml } from "./inline-markdown";

let el: HTMLElement;

const mount = (html: string): HTMLElement => {
  const div = document.createElement("div");
  div.contentEditable = "true";
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("getCaretOffset — flat text", () => {
  it("reads caret positions across a flat text node", () => {
    el = mount("hello world");
    const text = el.firstChild!;
    const positions = [0, 5, 6, 11];
    for (const pos of positions) {
      const range = document.createRange();
      range.setStart(text, pos);
      range.setEnd(text, pos);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      expect(getCaretOffset(el)).toEqual({ start: pos, end: pos });
    }
  });
});

describe("getCaretOffset — nested inline elements", () => {
  it("counts rendered characters across the whole element", () => {
    el = mount("a<strong><em>x</em></strong>b");
    // Place caret between 'x' and '</em>' — inside the <em>'s text node
    // at offset 1. Rendered text is "axb" → caret at index 2.
    const em = el.querySelector("em")!;
    const emText = em.firstChild!;
    const range = document.createRange();
    range.setStart(emText, 1);
    range.setEnd(emText, 1);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(getCaretOffset(el)).toEqual({ start: 2, end: 2 });
  });
});

describe("getCaretOffset — non-collapsed selection", () => {
  it("returns distinct start and end", () => {
    el = mount("a<strong>bcd</strong>e"); // rendered "abcde"
    const range = document.createRange();
    range.setStart(el.firstChild!, 1); // after 'a'
    const strong = el.querySelector("strong")!;
    range.setEnd(strong.firstChild!, 2); // inside "bcd" at offset 2 → after "bc"
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(getCaretOffset(el)).toEqual({ start: 1, end: 3 });
  });
});

describe("setCaretOffset → getCaretOffset round-trip", () => {
  it("round-trips over a fixture with nested inlines", () => {
    el = mount("a<strong><em>bc</em></strong>d<u>e</u>f"); // "abcdef" (6)
    for (let pos = 0; pos <= 6; pos++) {
      setCaretOffset(el, pos);
      expect(getCaretOffset(el)).toEqual({ start: pos, end: pos });
    }
  });
});

describe("setCaretOffset — clamps", () => {
  it("clamps rather than throwing when offset exceeds content length", () => {
    el = mount("abc"); // length 3
    expect(() => setCaretOffset(el, 999)).not.toThrow();
    expect(getCaretOffset(el)).toEqual({ start: 3, end: 3 });
  });

  it("does not throw on an empty element", () => {
    el = mount("");
    expect(() => setCaretOffset(el, 0)).not.toThrow();
    expect(() => setCaretOffset(el, 5)).not.toThrow();
    // getCaretOffset in an empty element should still read as 0.
    const read = getCaretOffset(el);
    // Either null (no selection inside a truly empty div) or {0,0}.
    if (read) expect(read).toEqual({ start: 0, end: 0 });
  });
});

describe("setCaretOffset — selection length", () => {
  it("produces a selection of the right length", () => {
    el = mount("a<strong>bcd</strong>e"); // "abcde"
    setCaretOffset(el, 1, 4); // select "bcd"
    expect(getCaretOffset(el)).toEqual({ start: 1, end: 4 });
    const sel = window.getSelection()!;
    expect(sel.toString()).toBe("bcd");
  });
});
