import { describe, it, expect, afterEach, vi } from "vitest";
import { primaryMod } from "./platform";

describe("primaryMod", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("on a Mac only ⌘ counts, so Ctrl+A/E/D/K stay the Mac's own text keys", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(primaryMod({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(primaryMod({ metaKey: false, ctrlKey: true })).toBe(false);
  });
  it("elsewhere Ctrl counts", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(primaryMod({ metaKey: false, ctrlKey: true })).toBe(true);
  });
});
