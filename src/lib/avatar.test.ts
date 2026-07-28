import { describe, expect, it } from "vitest";
import { FACES, SKIN, TINT_LIT, avaBg, applyAvatarRender } from "./avatar";

describe("avaBg", () => {
  it("returns the plain colour for face 0 (Initials)", () => {
    expect(avaBg("#DCEAFE", 0, 0)).toBe("#DCEAFE");
    expect(avaBg("#DCEAFE", null, null)).toBe("#DCEAFE");
  });

  it("returns a data-url background layered on a ground for face 1..8", () => {
    for (let f = 1; f <= 8; f++) {
      const bg = avaBg("#DCEAFE", f, 0);
      expect(bg).toMatch(/^url\("data:image\/svg\+xml,/);
      expect(bg).toContain(", #DCEAFE");
    }
  });

  it("theming: the resolved ground is byte-identical whether a token name or its light hex is passed", () => {
    // TINT_LIT wins — the disc must not follow dark mode. This is the
    // regression guard for the failed first attempt (see avatar.ts docstring).
    const byName = avaBg("blueWash", 1, 0);
    const byHex  = avaBg(TINT_LIT.blueWash, 1, 0);
    expect(byName).toBe(byHex);
    expect(byName.endsWith(`, ${TINT_LIT.blueWash}`)).toBe(true);
  });

  it("every one of the eight portraits produces distinct SVG markup", () => {
    const seen = new Set<string>();
    for (let f = 1; f <= 8; f++) {
      const bg = avaBg("#DCEAFE", f, 0);
      expect(seen.has(bg)).toBe(false);
      seen.add(bg);
    }
    expect(seen.size).toBe(8);
  });

  it("skin index out of range clamps rather than throwing", () => {
    expect(() => avaBg("#DCEAFE", 1, -3)).not.toThrow();
    expect(() => avaBg("#DCEAFE", 1, 99)).not.toThrow();
    expect(avaBg("#DCEAFE", 1, -3)).toBe(avaBg("#DCEAFE", 1, 0));
    expect(avaBg("#DCEAFE", 1, 99)).toBe(avaBg("#DCEAFE", 1, SKIN.length - 1));
  });

  it("FACES has one Initials entry plus eight portraits", () => {
    expect(FACES.length).toBe(9);
    expect(FACES[0]?.svg).toBeNull();
    for (let f = 1; f <= 8; f++) expect(typeof FACES[f]?.svg).toBe("function");
  });
});

describe("applyAvatarRender", () => {
  it("ink is 'transparent' when face > 0 and the real ink when face === 0", () => {
    const initials = applyAvatarRender({
      avatar_tint: "#DCEAFE",
      avatar_ink: "#2563EB",
      avatar_face: 0,
      avatar_skin: 0,
    });
    expect(initials.avatar_ink).toBe("#2563EB");

    const portrait = applyAvatarRender({
      avatar_tint: "#DCEAFE",
      avatar_ink: "#2563EB",
      avatar_face: 3,
      avatar_skin: 1,
    });
    expect(portrait.avatar_ink).toBe("transparent");
    expect(portrait.avatar_tint).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it("passes null profiles through unchanged", () => {
    expect(applyAvatarRender(null)).toBeNull();
    expect(applyAvatarRender(undefined)).toBeUndefined();
  });
});
