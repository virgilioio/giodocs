import { describe, expect, it } from "vitest";
import {
  actionableDefs,
  actionLabel,
  nextValue,
  parseTyped,
  typedDefs,
  valueLabel,
  valueRows,
} from "./prop-actions";

const stage = {
  key: "status_2",
  label: "Stage",
  type: "status",
  options: [
    { value: "todo", label: "To do", tint: "sunken", ink: "muted" },
    { value: "done", label: "Done", tint: "accentTint", ink: "accent" },
  ],
};
const who = { key: "assignee", label: "Assignee", type: "person" };
const labels = { key: "labels", label: "Labels", type: "multi_select", options: [{ value: "a", label: "Alpha" }] };
const members = [{ user_id: "u1", profiles: { full_name: "Ana Ruiz", email: null, avatar_tint: null, avatar_ink: null } }];

describe("menus act on each database's own properties", () => {
  it("offers settable types only, never archived or built-in ones", () => {
    const defs = [
      stage,
      who,
      labels,
      { key: "notes", label: "Notes", type: "text" },
      { key: "old", label: "Old", type: "select", archived_at: "2026-01-01" },
      { key: "@edited", label: "Edited", type: "date" },
    ];
    expect(actionableDefs(defs).map((d) => d.key)).toEqual(["status_2", "assignee", "labels"]);
  });
  it("names rows after the property, whatever it is called", () => {
    expect(actionLabel(stage)).toBe("Stage");
    expect(actionLabel(labels)).toBe("Add Labels");
  });
  it("shows labels, not stored values", () => {
    expect(valueLabel(stage, "done", members)).toBe("Done");
    expect(valueLabel(who, "u1", members)).toBe("Ana Ruiz");
    expect(valueLabel(stage, null, members)).toBe("empty");
  });
  it("builds option rows with the current value checked and a clear row", () => {
    const picked: unknown[] = [];
    const rows = valueRows(stage, "todo", members, (v) => picked.push(v));
    const opts = rows.filter((r) => r.kind === "row");
    expect(opts.map((r) => (r.kind === "row" ? r.label : ""))).toEqual(["To do", "Done", "Clear Stage"]);
    expect(opts[0].kind === "row" && opts[0].checked).toBe(true);
    if (opts[1].kind === "row") opts[1].onPick();
    if (opts[2].kind === "row") opts[2].onPick();
    expect(picked).toEqual(["done", null]);
  });
  it("adds to a multi-select instead of replacing it", () => {
    expect(nextValue(labels, ["a"], "b")).toEqual(["a", "b"]);
    expect(nextValue(labels, ["a"], "a")).toEqual(["a"]);
    expect(nextValue(stage, "todo", "done")).toBe("done");
    const rows = valueRows(labels, ["a"], members, () => {}, ["typed"]);
    expect(rows.map((r) => (r.kind === "row" ? r.label : "-"))).toEqual(["Alpha", "typed"]);
  });
});

/* Typed values for the bulk bar's Edit property: checked as their cells
 * check them, empty clears (2026-10-30). */
const typedDef = (type: string) => ({ key: "k", label: "K", type });
const TODAY = new Date("2026-10-30T12:00:00Z");

describe("parseTyped", () => {
  it("clears on an empty field", () => {
    expect(parseTyped(typedDef("number"), "   ", TODAY)).toEqual({ ok: true, value: null });
  });
  it("reads numbers, with thousands separators", () => {
    expect(parseTyped(typedDef("number"), "1,250.5", TODAY)).toEqual({ ok: true, value: 1250.5 });
    expect(parseTyped(typedDef("number"), "lots", TODAY)).toEqual({
      ok: false,
      error: "Type a number.",
    });
  });
  it("reads dates in words and ISO", () => {
    expect(parseTyped(typedDef("date"), "tomorrow", TODAY)).toEqual({
      ok: true,
      value: "2026-10-31",
    });
    expect(parseTyped(typedDef("date"), "2026-11-03", TODAY)).toEqual({
      ok: true,
      value: "2026-11-03",
    });
    expect(parseTyped(typedDef("date"), "someday", TODAY).ok).toBe(false);
  });
  it("checks links, emails and phones as their cells do", () => {
    expect(parseTyped(typedDef("url"), "virgilio.tech", TODAY)).toEqual({
      ok: true,
      value: "https://virgilio.tech",
    });
    expect(parseTyped(typedDef("email"), "not an email", TODAY).ok).toBe(false);
    expect(parseTyped(typedDef("phone"), "+1 (555) 010-2000", TODAY)).toEqual({
      ok: true,
      value: "+1 (555) 010-2000",
    });
  });
  it("keeps text as typed, trimmed", () => {
    expect(parseTyped(typedDef("text"), "  Sprint 14 ", TODAY)).toEqual({
      ok: true,
      value: "Sprint 14",
    });
  });
});

describe("typedDefs", () => {
  it("offers the typed kinds only, never archived or built-in", () => {
    const defs = [
      { key: "a", label: "A", type: "text" },
      { key: "b", label: "B", type: "status" },
      { key: "c", label: "C", type: "date", archived_at: "2026-01-01" },
      { key: "@edited", label: "Edited", type: "date" },
      { key: "d", label: "D", type: "number" },
    ];
    expect(typedDefs(defs).map((d) => d.key)).toEqual(["a", "d"]);
  });
});
