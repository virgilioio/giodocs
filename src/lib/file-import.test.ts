import { describe, expect, it } from "vitest";
import { escapeInline, importFile, parseCsv, titleFromFileName } from "./file-import";
import { STARTERS, starterBlocks } from "./starter-templates";

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, line breaks and pads rows", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines"')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", ""],
    ]);
  });
  it("reads semicolon files and drops blank lines", () => {
    expect(parseCsv("﻿nombre;sueldo\r\nAna;10\r\n\r\n")).toEqual([
      ["nombre", "sueldo"],
      ["Ana", "10"],
    ]);
  });
});

describe("importFile", () => {
  it("names the page after the file, or a leading heading", () => {
    expect(titleFromFileName("Q3_plan.final.md")).toBe("Q3 plan.final");
    const md = importFile("notes.md", "# Launch\n\nHello\n\n- a");
    expect(md.ok && md.title).toBe("Launch");
    expect(md.ok && md.blocks.map((b) => b.type)).toEqual(["text", "bullet"]);
  });
  it("turns a CSV into a table with literal cells", () => {
    const r = importFile("people.csv", "Name,Note\nAna,*star*");
    expect(r.ok && r.blocks[0].type).toBe("table");
    expect(r.ok && (r.blocks[0] as unknown as { rows: string[][] }).rows).toEqual([
      ["Name", "Note"],
      ["Ana", "\\*star\\*"],
    ]);
  });
  it("reads HTML bodies and titles", () => {
    const r = importFile("x.html", "<html><head><title>Doc</title></head><body><h2>Hi</h2><p>There</p></body></html>");
    expect(r.ok && r.title).toBe("Doc");
    expect(r.ok && r.blocks.map((b) => b.type)).toEqual(["h2", "text"]);
  });
  it("refuses other files plainly", () => {
    const r = importFile("cv.docx", "");
    expect(r.ok).toBe(false);
  });
  it("escapes markup", () => {
    expect(escapeInline("a_b [c]")).toBe("a\\_b \\[c\\]");
  });
});

describe("starters", () => {
  it("each starter makes blocks", () => {
    for (const s of STARTERS) expect(starterBlocks(s.id).length).toBeGreaterThan(1);
    expect(starterBlocks("todo").some((b) => b.type === "todo")).toBe(true);
    expect(starterBlocks("brief").some((b) => b.type === "table")).toBe(true);
  });
});

describe("groupTemplates", () => {
  it("puts page templates first, then each database's, and searches", async () => {
    const { groupTemplates } = await import("./template-groups");
    const t = [
      { id: "1", title: "Weekly sync", icon: null, database_id: null },
      { id: "2", title: "Bug report", icon: null, database_id: "db2" },
      { id: "3", title: "Candidate", icon: null, database_id: "db1" },
    ];
    const pages = [{ id: "db1", title: "Hiring" }, { id: "db2", title: "Engineering" }];
    expect(groupTemplates(t, pages).map((g) => g.label)).toEqual(["Pages", "Rows of Engineering", "Rows of Hiring"]);
    expect(groupTemplates(t, pages, "hir").map((g) => g.items.map((x) => x.id))).toEqual([["3"]]);
  });
});
