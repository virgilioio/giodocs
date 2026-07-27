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

/* ─── readCaretSource / writeCaretSource — the ONLY sanctioned
 * rendered↔source conversion helpers. Round-trip over a fixture
 * with nested inlines: place a source offset, read it back,
 * get the same number.
 */
describe("readCaretSource / writeCaretSource — source-offset round trip", () => {
  const mountRendered = (source: string): HTMLElement => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    div.innerHTML = inlineToHtml(source);
    document.body.appendChild(div);
    return div;
  };

  it("plain text — every source offset round-trips", () => {
    const src = "hello world";
    const host = mountRendered(src);
    for (let s = 0; s <= src.length; s++) {
      writeCaretSource(host, src, s);
      const read = readCaretSource(host, src);
      expect(read).toEqual({ start: s, end: s });
    }
  });

  it("nested inlines — reachable source offsets round-trip", () => {
    const src = "a **bold *and italic* end** z";
    const host = mountRendered(src);
    // Test a selection of offsets that fall in rendered-reachable
    // territory (outside delimiter runs). Delimiter interiors are
    // deliberately unreachable and clamp — that's covered by the
    // buildOffsetMap unit tests.
    const positions = [0, 1, 2, 4, 10, 14, 20, src.length];
    for (const s of positions) {
      writeCaretSource(host, src, s);
      const read = readCaretSource(host, src);
      expect(read).not.toBeNull();
      // The written source offset must land on a rendered position
      // that maps back to the same source offset; if it doesn't
      // round-trip, the caret is at the wrong index and ⌘B would
      // insert delimiters in the wrong place.
      expect(read!.start).toBe(s);
      expect(read!.end).toBe(s);
    }
  });

  it("non-collapsed selection round-trips both ends", () => {
    const src = "a **bold** end";
    const host = mountRendered(src);
    writeCaretSource(host, src, 0, src.length);
    const read = readCaretSource(host, src);
    expect(read).toEqual({ start: 0, end: src.length });
  });

  it("readCaretSource returns null when there's no selection in el", () => {
    const src = "hello";
    const host = mountRendered(src);
    // Selection deliberately outside `host`.
    const other = document.createElement("div");
    other.textContent = "elsewhere";
    document.body.appendChild(other);
    const range = document.createRange();
    range.setStart(other.firstChild!, 0);
    range.setEnd(other.firstChild!, 0);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(readCaretSource(host, src)).toBeNull();
  });

  it("writeCaretSource clamps past-end offsets", () => {
    const src = "hi";
    const host = mountRendered(src);
    expect(() => writeCaretSource(host, src, 999)).not.toThrow();
    const read = readCaretSource(host, src);
    expect(read).toEqual({ start: 2, end: 2 });
  });
});
