import { describe, expect, it } from "vitest";
import { groupOf, groupOfValue, isFinished } from "./status-groups";

describe("status groups", () => {
  it("uses the set group, else the name", () => {
    expect(groupOf({ value: "x", label: "Live", group: "doing" })).toBe("doing");
    expect(groupOf({ label: "Done" })).toBe("done");
    expect(groupOf({ label: "In review" })).toBe("doing");
    expect(groupOf({ label: "Not started" })).toBe("todo");
    expect(groupOfValue("done", [{ value: "done", label: "Done" }])).toBe("done");
    expect(groupOfValue(null, [])).toBeNull();
  });
  it("a row is finished when a status is Complete", () => {
    const defs = [{ key: "status", type: "status", options: [{ value: "a", label: "Alpha", group: "done" }] }];
    expect(isFinished({ status: "a" }, defs)).toBe(true);
    expect(isFinished({ status: "b" }, defs)).toBe(false);
    expect(isFinished({}, defs)).toBe(false);
  });
});
