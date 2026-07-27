import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { areaMenuFooter } from "./area-menu-footer";

const ANNA = { user_id: "u-anna", full_name: "Anna Torres", email: "anna@ex.com" };
const BEA = { user_id: "u-bea", full_name: null, email: "bea.long@ex.com" };
const MEMBERS = [ANNA, BEA];

describe("areaMenuFooter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns empty string with no pages", () => {
    expect(areaMenuFooter({ pages: [], members: MEMBERS, needsReverify: 0 })).toBe("");
  });

  it("returns empty string when no page has an edited_at", () => {
    expect(
      areaMenuFooter({
        pages: [{ edited_at: null, edited_by: null }],
        members: MEMBERS,
        needsReverify: 0,
      }),
    ).toBe("");
  });

  it("uses newest edit and first name only, no re-verify clause at zero", () => {
    const s = areaMenuFooter({
      pages: [
        { edited_at: "2026-07-25T12:00:00Z", edited_by: "u-anna" }, // 7d ago
        { edited_at: "2026-07-31T12:00:00Z", edited_by: "u-anna" }, // 1d ago
      ],
      members: MEMBERS,
      needsReverify: 0,
    });
    expect(s).toBe("Newest edit 1d ago by Anna");
    expect(s).not.toContain("re-verifying");
  });

  it("pluralises: 1 needs, N need", () => {
    const one = areaMenuFooter({
      pages: [{ edited_at: "2026-07-31T12:00:00Z", edited_by: "u-anna" }],
      members: MEMBERS,
      needsReverify: 1,
    });
    expect(one.endsWith("· 1 needs re-verifying")).toBe(true);
    const many = areaMenuFooter({
      pages: [{ edited_at: "2026-07-31T12:00:00Z", edited_by: "u-anna" }],
      members: MEMBERS,
      needsReverify: 4,
    });
    expect(many.endsWith("· 4 need re-verifying")).toBe(true);
  });

  it("drops 'by …' when the editor is unknown or unnamed", () => {
    const s = areaMenuFooter({
      pages: [{ edited_at: "2026-07-31T12:00:00Z", edited_by: "u-ghost" }],
      members: MEMBERS,
      needsReverify: 0,
    });
    expect(s).toBe("Newest edit 1d ago");
  });

  it("derives first name from email local part when full_name is missing", () => {
    const s = areaMenuFooter({
      pages: [{ edited_at: "2026-07-31T12:00:00Z", edited_by: "u-bea" }],
      members: MEMBERS,
      needsReverify: 2,
    });
    expect(s).toBe("Newest edit 1d ago by bea.long · 2 need re-verifying");
  });
});
