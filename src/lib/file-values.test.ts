import { describe, expect, it } from "vitest";
import { filesSummary, readFileList, withFile, withoutFile } from "./file-values";

describe("file values", () => {
  it("reads defensively", () => {
    expect(readFileList(null)).toEqual([]);
    expect(readFileList([{ path: "w/p/files/a.pdf" }, { name: "x" }, "y"])).toEqual([
      { path: "w/p/files/a.pdf", name: "a.pdf", size: 0, mime: "" },
    ]);
  });
  it("summarises, adds and removes", () => {
    const a = { path: "a", name: "brief.pdf", size: 1, mime: "" };
    const b = { path: "b", name: "cv.docx", size: 2, mime: "" };
    expect(filesSummary([])).toBe("");
    expect(filesSummary([a, b])).toBe("brief.pdf +1");
    expect(withFile([a], b)).toEqual([a, b]);
    expect(withFile([a, b], a)).toEqual([b, a]);
    expect(withoutFile([a, b], "a")).toEqual([b]);
  });
});
