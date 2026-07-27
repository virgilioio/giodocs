// @vitest-environment happy-dom
/* Editable input-cycle tests. Phase 2b.α ships this component dark —
 * these tests are the ONLY renderer of it until phase 2b.β. They
 * exercise the REWRITE-AND-RESTORE cycle directly against the DOM
 * without a React renderer: the component's logic lives in handlers
 * that we simulate by mounting the element, mutating innerHTML the
 * way a browser would on keystroke, and dispatching an `input` event.
 *
 * Using React Testing Library here would drag in a heavier
 * dependency for a payoff we don't need: the contract we care about
 * is "given DOM state X, produce DOM state Y and caret Z". We assert
 * exactly that.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Editable } from "./editable";
import { readCaretSource, setCaretOffset } from "@/lib/ce-offsets";
import { htmlToInlineMarkdown } from "@/lib/inline-tokens";
import { inlineToHtml } from "@/lib/inline-markdown";

let host: HTMLDivElement;
let root: Root;

const mount = (props: Parameters<typeof Editable>[0]) => {
  root = createRoot(host);
  act(() => {
    root.render(<Editable {...props} />);
  });
  const el = host.querySelector("[contenteditable]") as HTMLDivElement;
  return el;
};

const fireInput = (el: HTMLDivElement) => {
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("Editable — initial mount", () => {
  it("seeds innerHTML from source using inlineToHtml", () => {
    const el = mount({
      source: "hello **world**",
      onSourceChange: () => {},
    });
    expect(el.innerHTML).toBe(inlineToHtml("hello **world**"));
  });

  it("mounts empty source without crashing", () => {
    const el = mount({ source: "", onSourceChange: () => {} });
    expect(el.innerHTML).toBe(inlineToHtml(""));
  });
});

describe("Editable — input cycle: REWRITE AND RESTORE", () => {
  it("re-renders when a delimiter closes and preserves the source caret", () => {
    const changes: string[] = [];
    const el = mount({
      source: "hello **bol",
      onSourceChange: (s) => changes.push(s),
    });
    // Simulate the browser accepting a keystroke that closes the bold
    // by rewriting innerHTML to what a naive contenteditable would
    // hold after that keystroke: plain text with literal `**bold**`.
    el.innerHTML = "hello **bold**";
    // Caret at end of the raw text (after the closing `**`).
    setCaretOffset(el, "hello **bold**".length);
    fireInput(el);

    // Post-cycle: innerHTML now reflects the RENDERED bold.
    expect(el.innerHTML).toBe(inlineToHtml("hello **bold**"));
    // The last emitted source is the markdown, not the rendered text.
    expect(changes.at(-1)).toBe("hello **bold**");
    // Caret sits at the end of the source (i.e. after the closing `**`).
    const caret = readCaretSource(el, "hello **bold**");
    expect(caret).toEqual({ start: 14, end: 14 });
  });

  it("does NOT rewrite innerHTML when the input is a plain text change", () => {
    const el = mount({
      source: "hello",
      onSourceChange: () => {},
    });
    const before = el.innerHTML;
    // Extend the text — still plain, no formatting flips.
    el.textContent = "hello!";
    const domHtmlAfterUserEdit = el.innerHTML;
    fireInput(el);
    // Since inlineToHtml("hello!") === "hello!" and the DOM already
    // holds that, the component must NOT reassign innerHTML.
    expect(el.innerHTML).toBe(domHtmlAfterUserEdit);
    expect(el.innerHTML).not.toBe(before);
  });

  it("emits the serialised source on every input", () => {
    const changes: string[] = [];
    const el = mount({
      source: "",
      onSourceChange: (s) => changes.push(s),
    });
    el.textContent = "a";
    fireInput(el);
    el.textContent = "ab";
    fireInput(el);
    expect(changes).toEqual(["a", "ab"]);
  });
});

describe("Editable — external source change", () => {
  it("syncs innerHTML when the source prop changes from outside", () => {
    root = createRoot(host);
    act(() => {
      root.render(
        <Editable source="alpha" onSourceChange={() => {}} />,
      );
    });
    const el = host.querySelector("[contenteditable]") as HTMLDivElement;
    expect(el.innerHTML).toBe(inlineToHtml("alpha"));
    act(() => {
      root.render(
        <Editable source="beta **bold**" onSourceChange={() => {}} />,
      );
    });
    expect(el.innerHTML).toBe(inlineToHtml("beta **bold**"));
    // Serialising back round-trips.
    expect(htmlToInlineMarkdown(el)).toBe("beta **bold**");
  });

  it("does not fight the input cycle: props catching up to just-emitted source is a no-op", () => {
    let latest = "hello";
    const rerender = (s: string) => {
      latest = s;
      act(() => {
        root.render(<Editable source={latest} onSourceChange={rerender} />);
      });
    };
    root = createRoot(host);
    act(() => {
      root.render(<Editable source={latest} onSourceChange={rerender} />);
    });
    const el = host.querySelector("[contenteditable]") as HTMLDivElement;
    // Simulate the user closing a bold.
    el.innerHTML = "hello **x**";
    setCaretOffset(el, "hello **x**".length);
    fireInput(el);
    // At this point React re-renders with source="hello **x**"; the
    // effect must observe the DOM already reflects it and skip.
    const htmlAfter = el.innerHTML;
    expect(htmlAfter).toBe(inlineToHtml("hello **x**"));
    expect(latest).toBe("hello **x**");
  });
});

describe("Editable — locked", () => {
  it("renders with contentEditable=false when locked", () => {
    const el = mount({
      source: "hi",
      onSourceChange: () => {},
      locked: true,
    });
    expect(el.getAttribute("contenteditable")).toBe("false");
  });
});
