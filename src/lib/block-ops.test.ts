import { describe, it, expect } from "vitest";
import { tryMarkdownShortcut, newBlock, MARKDOWN_SHORTCUTS } from "./block-ops";
import type { Blk } from "./block-ops";

/* Regression harness for the markdown type-shortcuts. Phase 2b.β
 * migrated the block to <Editable>; nothing asserted the shortcut path
 * survived the migration, and two of eleven kept working while nine
 * silently regressed. A subsequent regression added the caret guard
 * and prefix matching after a real-world case (typing "1. " at the
 * start of a NON-EMPTY line) failed to convert. This suite exercises
 * both the empty-block cases and the real-world in-line cases. */

function seed(text = ""): { list: Blk[]; id: string } {
  const b = newBlock("text", text);
  return { list: [b], id: b.id };
}

const CASES: Array<{ input: string; type: string }> = [
  { input: "# ", type: "h1" },
  { input: "## ", type: "h2" },
  { input: "### ", type: "h3" },
  { input: "#### ", type: "h3" },
  { input: "- ", type: "bullet" },
  { input: "* ", type: "bullet" },
  { input: "+ ", type: "bullet" },
  { input: "1. ", type: "numbered" },
  { input: "2. ", type: "numbered" },
  { input: "42. ", type: "numbered" },
  { input: "[] ", type: "todo" },
  { input: "[ ] ", type: "todo" },
  { input: "> ", type: "quote" },
  { input: "``` ", type: "code" },
  { input: "--- ", type: "divider" },
];

describe("tryMarkdownShortcut — empty-block cases (caret == prefix length)", () => {
  for (const c of CASES) {
    it(`${JSON.stringify(c.input)} → ${c.type}`, () => {
      const { list, id } = seed();
      const r = tryMarkdownShortcut(list, id, c.input, c.input.length);
      expect(r, `no match for ${c.input}`).not.toBeNull();
      const converted = r!.next.find((b) => b.id === id)!;
      expect(converted.type).toBe(c.type);
      expect(converted.text ?? "").toBe("");
    });
  }

  it("todo shortcut initialises checked=false", () => {
    const { list, id } = seed();
    const r = tryMarkdownShortcut(list, id, "[] ", 3);
    expect(r).not.toBeNull();
    expect(r!.next[0].checked).toBe(false);
  });

  it("divider shortcut spawns a fresh text block after and moves focus", () => {
    const { list, id } = seed();
    const r = tryMarkdownShortcut(list, id, "--- ", 4);
    expect(r).not.toBeNull();
    expect(r!.next).toHaveLength(2);
    expect(r!.next[0].type).toBe("divider");
    expect(r!.next[1].type).toBe("text");
    expect(r!.focus?.id).toBe(r!.next[1].id);
  });

  it("does not fire on non-text blocks", () => {
    const b = newBlock("bullet", "* ");
    const r = tryMarkdownShortcut([b], b.id, "* ", 2);
    expect(r).toBeNull();
  });

  it("does not fire on partial prefixes (no trailing space)", () => {
    const { list, id } = seed();
    expect(tryMarkdownShortcut(list, id, "*", 1)).toBeNull();
    expect(tryMarkdownShortcut(list, id, "1.", 2)).toBeNull();
    expect(tryMarkdownShortcut(list, id, "---", 3)).toBeNull();
  });
});

describe("tryMarkdownShortcut — real-world in-line cases (prefix + kept text)", () => {
  it('"1. Review the memo" with caret at 3 → numbered, text "Review the memo"', () => {
    const { list, id } = seed();
    const val = "1. Review the memo";
    const r = tryMarkdownShortcut(list, id, val, 3);
    expect(r).not.toBeNull();
    const nb = r!.next.find((b) => b.id === id)!;
    expect(nb.type).toBe("numbered");
    expect(nb.text).toBe("Review the memo");
    expect(r!.focus?.id).toBe(id);
    expect(r!.focus?.caret).toBe("start");
  });

  it('"* Buy milk" with caret at 2 → bullet, text "Buy milk"', () => {
    const { list, id } = seed();
    const r = tryMarkdownShortcut(list, id, "* Buy milk", 2);
    expect(r).not.toBeNull();
    const nb = r!.next.find((b) => b.id === id)!;
    expect(nb.type).toBe("bullet");
    expect(nb.text).toBe("Buy milk");
  });

  it('"## Section" with caret at 3 → h2, text "Section"', () => {
    const { list, id } = seed();
    const r = tryMarkdownShortcut(list, id, "## Section", 3);
    expect(r).not.toBeNull();
    const nb = r!.next.find((b) => b.id === id)!;
    expect(nb.type).toBe("h2");
    expect(nb.text).toBe("Section");
  });

  it('"42. First item" with caret at 4 → numbered, text "First item"', () => {
    const { list, id } = seed();
    const r = tryMarkdownShortcut(list, id, "42. First item", 4);
    expect(r).not.toBeNull();
    const nb = r!.next.find((b) => b.id === id)!;
    expect(nb.type).toBe("numbered");
    expect(nb.text).toBe("First item");
  });

  it('"``` python code" with caret at 4 → code, text "python code"', () => {
    const { list, id } = seed();
    const r = tryMarkdownShortcut(list, id, "``` python code", 4);
    expect(r).not.toBeNull();
    const nb = r!.next.find((b) => b.id === id)!;
    expect(nb.type).toBe("code");
    expect(nb.text).toBe("python code");
  });
});

describe("tryMarkdownShortcut — caret guard", () => {
  it("caret at end of a pasted line does NOT convert", () => {
    const { list, id } = seed();
    const val = "1. Review the memo";
    // caret at 18 (end) is where a paste lands — not "just typed the prefix".
    expect(tryMarkdownShortcut(list, id, val, val.length)).toBeNull();
  });

  it("caret at 0 does NOT convert", () => {
    const { list, id } = seed();
    expect(tryMarkdownShortcut(list, id, "1. Review the memo", 0)).toBeNull();
  });

  it("caret in the middle of the payload does NOT convert", () => {
    const { list, id } = seed();
    expect(tryMarkdownShortcut(list, id, "* Buy milk", 6)).toBeNull();
  });

  it("divider only fires on empty remainder — trailing text returns null", () => {
    const { list, id } = seed();
    // "--- something" would destroy "something"; leave alone even at the
    // right prefix-length caret.
    expect(tryMarkdownShortcut(list, id, "--- something", 4)).toBeNull();
  });
});

describe("MARKDOWN_SHORTCUTS registry covers the documented set", () => {
  it("has entries for every documented type", () => {
    const types = new Set(MARKDOWN_SHORTCUTS.map((m) => m.type));
    for (const t of [
      "h1",
      "h2",
      "h3",
      "bullet",
      "numbered",
      "todo",
      "quote",
      "code",
      "divider",
      "callout",
    ]) {
      expect(types.has(t as never)).toBe(true);
    }
  });
});
