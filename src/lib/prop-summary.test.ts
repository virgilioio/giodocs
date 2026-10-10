import { describe, expect, it } from "vitest";
import { summarizeProp } from "./prop-summary";

const names = (id: string) => (id === "u1" ? "Allan" : null);

describe("summarizeProp", () => {
  it("skips empty values", () => {
    expect(summarizeProp(null, { type: "text" }, "Notes", names)).toBeNull();
    expect(summarizeProp("  ", { type: "text" }, "Notes", names)).toBeNull();
    expect(summarizeProp([], { type: "multi_select" }, "Tags", names)).toBeNull();
    expect(summarizeProp(false, { type: "checkbox" }, "Confidential", names)).toBeNull();
  });
  it("shows option labels", () => {
    const def = { type: "status", options: [{ value: "doing", label: "In progress" }] };
    expect(summarizeProp("doing", def, "Status", names)).toBe("In progress");
    expect(summarizeProp("other", def, "Status", names)).toBe("other");
  });
  it("joins multi-select and counts links", () => {
    const def = { type: "multi_select", options: [{ value: "a", label: "Alpha" }] };
    expect(summarizeProp(["a", "b"], def, "Tags", names)).toBe("Alpha, b");
    expect(summarizeProp(["x"], { type: "links" }, "Related", names)).toBe("1 link");
    expect(summarizeProp(["x", "y"], { type: "links" }, "Related", names)).toBe("2 links");
  });
  it("names people and labels ticked checkboxes", () => {
    expect(summarizeProp("u1", { type: "person" }, "Owner", names)).toBe("Allan");
    expect(summarizeProp("u2", { type: "person" }, "Owner", names)).toBeNull();
    expect(summarizeProp(true, { type: "checkbox" }, "Confidential", names)).toBe("Confidential");
  });
  it("keeps a date-only value on its calendar day", () => {
    const s = summarizeProp("2026-03-05", { type: "date" }, "Due", names)!;
    expect(s).toMatch(/5/);
    expect(s).toMatch(/Mar/);
  });
});
