import { describe, it, expect } from "vitest";
import { tryMarkdownShortcut, newBlock, MARKDOWN_SHORTCUTS } from "./block-ops";
import type { Blk } from "./block-ops";

/* Regression harness for the markdown type-shortcuts. Phase 2b.β
 * migrated the block to <Editable>; nothing asserted the shortcut path
 * survived the migration, and two of eleven kept working while nine
 * silently regressed. This suite runs every shortcut through the pure
 * op that BOTH the top-level and column onInput handlers now call
 * first. If a case here fails, the shortcut is broken in production. */

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

describe("tryMarkdownShortcut — every shortcut fires", () => {
  for (const c of CASES) {
    it(`${JSON.stringify(c.input)} → ${c.type}`, () => {
      const { list, id } = seed();
      const r = tryMarkdownShortcut(list, id, c.input);
      expect(r, `no match for ${c.input}`).not.toBeNull();
      const converted = r!.next.find((b) => b.id === id)!;
      expect(converted.type).toBe(c.type);
      expect(converted.text ?? "").toBe("");
    });
  }

  it("todo shortcut initialises checked=false", () => {
    const { list, id } = seed();
    const r = tryMarkdownShortcut(list, id, "[] ");
    expect(r).not.toBeNull();
    expect(r!.next[0].checked).toBe(false);
  });

  it("divider shortcut spawns a fresh text block after and moves focus", () => {
    const { list, id } = seed();
    const r = tryMarkdownShortcut(list, id, "--- ");
    expect(r).not.toBeNull();
    expect(r!.next).toHaveLength(2);
    expect(r!.next[0].type).toBe("divider");
    expect(r!.next[1].type).toBe("text");
    expect(r!.focus?.id).toBe(r!.next[1].id);
  });

  it("does not fire on non-text blocks", () => {
    const b = newBlock("bullet", "* ");
    const r = tryMarkdownShortcut([b], b.id, "* ");
    expect(r).toBeNull();
  });

  it("does not fire on partial prefixes (no trailing space)", () => {
    const { list, id } = seed();
    expect(tryMarkdownShortcut(list, id, "*")).toBeNull();
    expect(tryMarkdownShortcut(list, id, "1.")).toBeNull();
    expect(tryMarkdownShortcut(list, id, "---")).toBeNull();
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
