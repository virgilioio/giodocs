import { describe, expect, it } from "vitest";
import {
  composerHint,
  customFor,
  emojiStoragePath,
  icoBg,
  icoCh,
  isValidEmojiName,
  nameFromFilename,
  sanitizeEmojiName,
  type CustomEmoji,
} from "./custom-emoji";

const set: CustomEmoji[] = [
  {
    name: "ship-it",
    description: "",
    path: "ws/emoji/ship-it.png",
    url: "https://x/ship-it.png",
    created_by: null,
    created_at: "",
  },
];

describe("resolver", () => {
  it("returns null for unicode", () => {
    expect(customFor("🚀", set)).toBeNull();
    expect(icoBg("🚀", set)).toBe("none");
    expect(icoCh("🚀", set)).toBe("🚀");
  });
  it("resolves a shortcode", () => {
    expect(customFor(":ship-it:", set)?.name).toBe("ship-it");
    expect(icoBg(":ship-it:", set)).toBe('url("https://x/ship-it.png")');
    expect(icoCh(":ship-it:", set)).toBe("");
  });
  it("falls back to text for an unknown shortcode", () => {
    expect(icoBg(":nope:", set)).toBe("none");
    expect(icoCh(":nope:", set)).toBe(":nope:");
  });
  it("handles null", () => {
    expect(icoCh(null, set)).toBe("");
    expect(icoBg(undefined, set)).toBe("none");
  });
});

describe("names", () => {
  it("sanitises", () => {
    expect(sanitizeEmojiName("Ship It!")).toBe("ship-it");
    expect(sanitizeEmojiName("--lead")).toBe("lead");
    expect(sanitizeEmojiName("a".repeat(40)).length).toBe(24);
  });
  it("defaults from a filename", () => {
    expect(nameFromFilename("Ship It@2x.png")).toBe("ship-it-2x");
  });
  it("agrees with the database check", () => {
    expect(isValidEmojiName(sanitizeEmojiName("Ship It@2x.png"))).toBe(true);
    expect(isValidEmojiName("")).toBe(false);
  });
  it("builds the storage path", () => {
    expect(emojiStoragePath("ws1", "ship-it")).toBe("ws1/emoji/ship-it.png");
  });
});

describe("composerHint", () => {
  const base = { hasImage: true, name: "ship-it", taken: false, editing: false };
  it("covers six states", () => {
    expect(composerHint({ ...base, hasImage: false }).tone).toBe("secondary");
    expect(composerHint({ ...base, name: "" }).text).toMatch(/Give it a name/);
    expect(composerHint({ ...base, taken: true }).tone).toBe("danger");
    expect(composerHint(base).text).toMatch(/Ready\./);
    expect(
      composerHint({ ...base, editing: true, originalName: "ship-it" }).text,
    ).toBe("Saving updates it everywhere it is used.");
    expect(
      composerHint({ ...base, editing: true, originalName: "old" }).text,
    ).toBe("Renaming to :ship-it: updates every page wearing it.");
  });
});
