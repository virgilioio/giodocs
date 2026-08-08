import { describe, expect, it } from "vitest";
import { blockToMarkdown, blocksHtmlFragment } from "./export";
import type { Block } from "./types";

/** A small sheet: a frozen header, a formula, a pipe in user text and a
 *  total row carrying a rule above. */
function sheet(extra: Partial<Record<string, unknown>> = {}): Block {
  return {
    id: "s1",
    type: "sheet",
    cells: [
      [{ v: "Deal | Q" }, { v: "Value" }],
      [{ v: "Alpha" }, { v: 100 }],
      [{ v: "Beta" }, { v: 200 }],
      [{ v: "Total", b: true }, { v: "=SUM(B2:B3)", rt: true, f: "cur" }],
    ],
    cw: [160, 120],
    ...extra,
  } as Block;
}

const html = (b: Block) => blocksHtmlFragment([b]);

describe("sheet → markdown", () => {
  it("emits computed values, not formulas", () => {
    const md = blockToMarkdown(sheet());
    expect(md).toContain("$300.00");
    expect(md).not.toContain("=SUM");
  });

  it("bolds the header row when frozen and escapes pipes", () => {
    const md = blockToMarkdown(sheet({ freeze: true }));
    const lines = md.split("\n");
    expect(lines[0]).toBe("| **Deal \\| Q** | **Value** |");
    expect(lines[1]).toContain(":---");
  });

  it("emits an empty header line when not frozen", () => {
    const lines = blockToMarkdown(sheet()).split("\n");
    expect(lines[0]).toBe("|  |  |");
    expect(lines[2]).toBe("| Deal \\| Q | Value |");
  });
});

describe("sheet → html", () => {
  it("uses thead / th scope=col when frozen", () => {
    const out = html(sheet({ freeze: true }));
    expect(out).toContain("<thead>");
    expect(out).toContain('<th scope="col"');
  });

  it("uses a plain td grid when not frozen", () => {
    const out = html(sheet());
    expect(out).not.toContain("<thead>");
    expect(out).toContain("<td");
  });

  it("carries alignment and the rule-above through", () => {
    const out = html(sheet());
    expect(out).toContain("text-align:right");
    expect(out).toContain("border-top:2px solid");
  });

  it("escapes user text", () => {
    const out = html(
      sheet({ cells: [[{ v: "<b>x</b>" }, { v: "y" }]], cw: [160, 120] }),
    );
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(out).not.toContain("<b>x</b>");
  });
});

describe("sheet edge cases", () => {
  it("an empty sheet exports as nothing", () => {
    const empty = { id: "s2", type: "sheet", cells: [[null, null], [null, null]], cw: [160, 120] } as Block;
    expect(blockToMarkdown(empty)).toBe("");
    expect(html(empty).includes("<table")).toBe(false);
  });

  it("an error cell exports the error token rather than crashing", () => {
    const bad = {
      id: "s3",
      type: "sheet",
      cells: [[{ v: "=A1+1" }, { v: "=NOPE(1)" }]],
      cw: [160, 120],
    } as Block;
    expect(blockToMarkdown(bad)).toContain("#CYCLE");
    expect(html(bad)).toContain("#NAME");
  });
});
