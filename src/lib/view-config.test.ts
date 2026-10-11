import { describe, expect, it } from "vitest";
import {
  allPropKeys,
  defaultProps,
  hideProp,
  moveProp,
  readConfig,
  sameIgnoringWidths,
  setWidth,
  showProp,
  shownProps,
  sortNameOf,
  trackOf,
  widthOf,
} from "./view-config";

const DEFS = [
  { key: "area", type: "select", is_system: true, position: 1 },
  { key: "owner", type: "person", is_system: true, position: 2 },
  { key: "status", type: "status", is_system: true, position: 3 },
  { key: "tags", type: "multi_select", is_system: true, position: 4 },
  { key: "stage", type: "select", is_system: false, position: 5 },
  { key: "due", type: "date", is_system: false, position: 7 },
  { key: "effort", type: "number", is_system: false, position: 8 },
  { key: "reviewer", type: "person", is_system: false, position: 9 },
  { key: "site", type: "url", is_system: false, position: 10 },
];

describe("defaultProps", () => {
  it("keeps the set tables always had, then dates, numbers, text, checkboxes", () => {
    expect(defaultProps(DEFS, new Set())).toEqual([
      "area",
      "owner",
      "status",
      "tags",
      "@verified",
      "@edited",
      "due",
      "effort",
    ]);
  });
  it("newer kinds appear once a page uses them; people never by default", () => {
    expect(defaultProps(DEFS, new Set(["stage", "site", "reviewer"]))).toEqual([
      "area",
      "owner",
      "status",
      "tags",
      "@verified",
      "@edited",
      "stage",
      "due",
      "effort",
      "site",
    ]);
  });
});

describe("shownProps", () => {
  it("uses the view's own list, dropping archived properties", () => {
    expect(shownProps({ props: ["due", "gone", "@created", "owner"] }, DEFS)).toEqual([
      "due",
      "@created",
      "owner",
    ]);
  });
  it("an empty list shows only the title", () => {
    expect(shownProps({ props: [] }, DEFS)).toEqual([]);
  });
});

describe("arranging", () => {
  const shown = ["area", "owner", "status"];
  it("moves, hides and shows", () => {
    expect(moveProp(shown, "status", 0)).toEqual(["status", "area", "owner"]);
    expect(moveProp(shown, "area", 2)).toEqual(["owner", "status", "area"]);
    expect(moveProp(shown, "area", 99)).toEqual(["owner", "status", "area"]);
    expect(moveProp(shown, "nope", 0)).toBe(shown);
    expect(hideProp(shown, "owner")).toEqual(["area", "status"]);
    expect(showProp(shown, "due")).toEqual(["area", "owner", "status", "due"]);
    expect(showProp(shown, "area")).toBe(shown);
  });
  it("lists hidden properties after shown ones, built-ins last", () => {
    const all = allPropKeys(["due", "owner"], DEFS);
    expect(all.slice(0, 3)).toEqual(["due", "owner", "area"]);
    expect(all.slice(-5)).toEqual(["@created", "@created_by", "@edited", "@edited_by", "@verified"]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("widths", () => {
  it("defaults by type, clamps, and resets", () => {
    expect(widthOf({}, "title", "title")).toBe(300);
    expect(widthOf({}, "effort", "number")).toBe(110);
    const c = setWidth({}, "effort", 2000);
    expect(widthOf(c, "effort", "number")).toBe(800);
    expect(widthOf(setWidth(c, "effort", null), "effort", "number")).toBe(110);
    expect(widthOf(setWidth({}, "due", 12), "due", "date")).toBe(60);
  });
});

describe("readConfig", () => {
  it("drops anything malformed", () => {
    expect(readConfig(null)).toEqual({});
    expect(readConfig([1])).toEqual({});
    expect(
      readConfig({
        props: ["due", 3, "due", "title", "owner"],
        widths: { due: 150, bad: "x" },
        calcs: { due: "earliest", x: 1 },
        group: "status",
      }),
    ).toEqual({
      props: ["due", "owner"],
      widths: { due: 150 },
      calcs: { due: "earliest" },
      group: "status",
    });
  });
});

describe("sameIgnoringWidths", () => {
  it("resizing alone is not a change", () => {
    expect(sameIgnoringWidths({ widths: { due: 200 } }, {})).toBe(true);
    expect(sameIgnoringWidths({ props: ["due"] }, {})).toBe(false);
    expect(sameIgnoringWidths({ calcs: {} }, {})).toBe(true);
  });
});

describe("sortNameOf", () => {
  it("keeps the names older views use", () => {
    expect(sortNameOf("title")).toBe("title");
    expect(sortNameOf("@edited")).toBe("edited");
    expect(sortNameOf("@verified")).toBe("verified");
    expect(sortNameOf("@created_by")).toBe("@created_by");
    expect(sortNameOf("due")).toBe("p:due");
  });
});

describe("trackOf", () => {
  it("a set width is exact; otherwise the column flexes above its minimum", () => {
    expect(trackOf({ widths: { due: 150 } }, "due", "date")).toEqual({
      css: "150px",
      min: 150,
      fixed: true,
    });
    expect(trackOf({}, "title", "title")).toEqual({
      css: "minmax(200px, 3fr)",
      min: 200,
      fixed: false,
    });
    expect(trackOf({}, "@edited", "timestamp").min).toBe(92);
  });
});

describe("wrap and insert", () => {
  it("reads wrap defensively and toggles it", async () => {
    const { readConfig: rc, toggleWrap, insertProp } = await import("./view-config");
    expect(rc({ wrap: ["notes", 3, "notes", ""] }).wrap).toEqual(["notes"]);
    expect(rc({ wrap: [] }).wrap).toBeUndefined();
    expect(toggleWrap({}, "notes")).toEqual({ wrap: ["notes"] });
    expect(toggleWrap({ wrap: ["notes"] }, "notes")).toEqual({});
    expect(insertProp(["a", "b", "c"], "x", 1)).toEqual(["a", "x", "b", "c"]);
    expect(insertProp(["a", "b"], "x", 9)).toEqual(["a", "b", "x"]);
  });
});
