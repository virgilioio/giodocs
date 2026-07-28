import { describe, it, expect } from "vitest";
import {
  CALLOUT_COLORS,
  calloutBg,
  calloutLabel,
  isCalloutColor,
  type CalloutColor,
} from "./callout-color";
import { blockToMarkdown } from "./export";
import { parseMarkdown } from "./markdown-import";

describe("callout-color", () => {
  it("resolves every CalloutColor to a token expression", () => {
    for (const c of CALLOUT_COLORS) {
      const bg = calloutBg(c);
      expect(bg).toMatch(/^var\(--color-\w+\)$/);
    }
  });

  it("falls back to neutral for absent / unknown / non-string values", () => {
    const neutral = calloutBg("neutral");
    expect(calloutBg(undefined)).toBe(neutral);
    expect(calloutBg(null)).toBe(neutral);
    expect(calloutBg("purpleish")).toBe(neutral);
    expect(calloutBg(42 as unknown)).toBe(neutral);
    // Never throws.
    expect(() => calloutBg({} as unknown)).not.toThrow();
  });

  it("isCalloutColor is a strict guard", () => {
    for (const c of CALLOUT_COLORS) expect(isCalloutColor(c)).toBe(true);
    expect(isCalloutColor("teal")).toBe(false);
    expect(isCalloutColor(undefined)).toBe(false);
  });

  it("calloutLabel returns Neutral for absent", () => {
    expect(calloutLabel(undefined)).toBe("Neutral");
    expect(calloutLabel("green")).toBe("Green");
  });
});

describe("callout colour — export", () => {
  it("blockHtml emits the resolved background inline for every colour", async () => {
    const { toHtml } = await import("./export");
    for (const c of CALLOUT_COLORS) {
      const html = toHtml({
        title: "t",
        blocks: [
          { id: "1", type: "callout", text: "hi", icon: "💡", color: c } as never,
        ],
      });
      expect(html).toContain(`background:${calloutBg(c)}`);
    }
  });

  it("blockHtml emits neutral background when colour is absent", async () => {
    const { toHtml } = await import("./export");
    const html = toHtml({
      title: "t",
      blocks: [{ id: "1", type: "callout", text: "hi", icon: "💡" } as never],
    });
    expect(html).toContain(`background:${calloutBg("neutral")}`);
  });

  it("markdown round-trip drops colour (documented loss, not a crash)", () => {
    const src = {
      id: "1",
      type: "callout",
      text: "note",
      icon: "💡",
      color: "green" as CalloutColor,
    };
    const md = blockToMarkdown(src as never);
    const back = parseMarkdown(md);
    expect(back).toHaveLength(1);
    expect(back[0].type).toBe("callout");
    // The parser MUST NOT invent a colour from the emoji.
    expect((back[0] as { color?: string }).color).toBeUndefined();
  });
});
