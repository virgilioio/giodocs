import { describe, it, expect } from "vitest";
import { mergeAreas } from "./use-workspace-data";

describe("mergeAreas", () => {
  it("returns derived-only areas from pages with counts", () => {
    const pages = [
      { props: { area: "Product" } },
      { props: { area: "Product" } },
      { props: { area: "Legal" } },
    ];
    expect(mergeAreas(pages, [])).toEqual([
      { area: "Legal", page_count: 1 },
      { area: "Product", page_count: 2 },
    ]);
  });

  it("returns registered-only areas with count 0", () => {
    const propDefs = [
      { key: "area", options: [{ value: "Ops" }, { value: "Sales" }] },
    ];
    expect(mergeAreas([], propDefs)).toEqual([
      { area: "Ops", page_count: 0 },
      { area: "Sales", page_count: 0 },
    ]);
  });

  it("unions both sources without duplication (derived counts win)", () => {
    const pages = [
      { props: { area: "Product" } },
      { props: { area: "Product" } },
    ];
    const propDefs = [
      {
        key: "area",
        options: [{ value: "Product" }, { value: "Legal" }],
      },
    ];
    expect(mergeAreas(pages, propDefs)).toEqual([
      { area: "Legal", page_count: 0 },
      { area: "Product", page_count: 2 },
    ]);
  });

  it("ignores non-area property_defs and malformed props", () => {
    const pages = [
      { props: null },
      { props: { area: 42 } },
      { props: { area: "Ops" } },
    ];
    const propDefs = [
      { key: "status", options: [{ value: "Draft" }] },
      { key: "area", options: [{ value: "Ops" }] },
    ];
    expect(mergeAreas(pages, propDefs)).toEqual([
      { area: "Ops", page_count: 1 },
    ]);
  });
});
