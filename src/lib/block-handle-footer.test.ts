import { describe, it, expect } from "vitest";
import { blockHandleFooter } from "./block-handle-footer";

describe("blockHandleFooter", () => {
  it("renders edited + firstName", () => {
    expect(blockHandleFooter({ editedRel: "2h ago", firstName: "Ada" })).toBe(
      "Edited 2h ago by Ada",
    );
  });
  it("drops the 'by …' fragment when firstName missing", () => {
    expect(blockHandleFooter({ editedRel: "2h ago" })).toBe("Edited 2h ago");
    expect(blockHandleFooter({ editedRel: "2h ago", firstName: "" })).toBe(
      "Edited 2h ago",
    );
  });
  it("returns empty string when editedRel is falsy", () => {
    expect(blockHandleFooter({ editedRel: null, firstName: "Ada" })).toBe("");
    expect(blockHandleFooter({ editedRel: "", firstName: "Ada" })).toBe("");
    expect(blockHandleFooter({ editedRel: undefined })).toBe("");
  });
  it("trims whitespace on both sides", () => {
    expect(
      blockHandleFooter({ editedRel: "  2h ago  ", firstName: "  Ada  " }),
    ).toBe("Edited 2h ago by Ada");
  });
});
