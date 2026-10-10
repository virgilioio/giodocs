import { describe, expect, it } from "vitest";
import { colorAt, normalizeColors, setColor, type TableColors } from "./table-colors";
import { applyTableOp } from "./table-ops";

const rows3 = () => [
  ["a", "b", "c"],
  ["d", "e", "f"],
  ["g", "h", "i"],
];

describe("table colours", () => {
  it("reads stored colours defensively", () => {
    expect(
      normalizeColors(
        { cells: { "1,1": { bg: "blue", fg: "crimson" }, "9,9": { bg: "red" } }, rows: { x: { bg: "red" } }, cols: { "0": { fg: "neutral" } } },
        3,
        3,
      ),
    ).toEqual({ cells: { "1,1": { bg: "blue" } } });
    expect(normalizeColors("nope", 3, 3)).toBeUndefined();
  });
  it("cell beats row beats column, per property", () => {
    const c: TableColors = {
      cols: { "1": { bg: "gray", fg: "blue" } },
      rows: { "1": { bg: "yellow" } },
      cells: { "1,1": { fg: "red" } },
    };
    expect(colorAt(c, 1, 1)).toEqual({ fg: "red", bg: "yellow" });
    expect(colorAt(c, 0, 1)).toEqual({ fg: "blue", bg: "gray" });
    expect(colorAt(c, 2, 2)).toEqual({ fg: undefined, bg: undefined });
  });
  it("colouring a row lifts that property off its cells", () => {
    let c = setColor(undefined, { kind: "cells", r0: 1, c0: 0, r1: 1, c1: 1 }, { bg: "red", fg: "blue" });
    c = setColor(c, { kind: "row", r: 1 }, { bg: "green" });
    expect(colorAt(c, 1, 0)).toEqual({ fg: "blue", bg: "green" });
    expect(setColor(c, { kind: "row", r: 1 }, { bg: null })?.rows).toBeUndefined();
  });
  it("removing every colour leaves nothing stored", () => {
    const c = setColor(undefined, { kind: "col", c: 0 }, { fg: "red" });
    expect(setColor(c, { kind: "col", c: 0 }, { fg: null })).toBeUndefined();
  });
});

describe("structural ops carry colours", () => {
  const base = () => ({
    rows: rows3(),
    align: ["left", "left", "right"] as ("left" | "right")[],
    colors: {
      rows: { "1": { bg: "yellow" } },
      cols: { "2": { fg: "red" } },
      cells: { "2,0": { bg: "blue" } },
    } as TableColors,
  });
  it("insert a row above shifts row colours down", () => {
    const s = applyTableOp(base(), { op: "addRow", at: 1 });
    expect(s.rows[1]).toEqual(["", "", ""]);
    expect(s.colors?.rows).toEqual({ "2": { bg: "yellow" } });
    expect(s.colors?.cells).toEqual({ "3,0": { bg: "blue" } });
  });
  it("delete a row drops its colour", () => {
    const s = applyTableOp(base(), { op: "deleteRow", index: 1 });
    expect(s.colors?.rows).toBeUndefined();
    expect(s.colors?.cells).toEqual({ "1,0": { bg: "blue" } });
  });
  it("duplicate a row copies its colour", () => {
    const s = applyTableOp(base(), { op: "duplicateRow", index: 1 });
    expect(s.colors?.rows).toEqual({ "1": { bg: "yellow" }, "2": { bg: "yellow" } });
  });
  it("move a column moves its colour, align and cells", () => {
    const s = applyTableOp(base(), { op: "moveCol", from: 2, to: 0 });
    expect(s.rows[0]).toEqual(["c", "a", "b"]);
    expect(s.align).toEqual(["right", "left", "left"]);
    expect(s.colors?.cols).toEqual({ "0": { fg: "red" } });
    expect(s.colors?.cells).toEqual({ "2,1": { bg: "blue" } });
  });
  it("move a row down", () => {
    const s = applyTableOp(base(), { op: "moveRow", from: 1, to: 2 });
    expect(s.rows[2]).toEqual(["d", "e", "f"]);
    expect(s.colors?.rows).toEqual({ "2": { bg: "yellow" } });
    expect(s.colors?.cells).toEqual({ "1,0": { bg: "blue" } });
  });
  it("delete the only row is refused", () => {
    const one = { rows: [["x"]], align: ["left" as const] };
    expect(applyTableOp(one, { op: "deleteRow", index: 0 })).toBe(one);
  });
  it("duplicate a column copies cells, align and colour", () => {
    const s = applyTableOp(base(), { op: "duplicateCol", index: 2 });
    expect(s.rows[0]).toEqual(["a", "b", "c", "c"]);
    expect(s.align).toEqual(["left", "left", "right", "right"]);
    expect(s.colors?.cols).toEqual({ "2": { fg: "red" }, "3": { fg: "red" } });
  });
});
