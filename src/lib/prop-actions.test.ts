import { describe, expect, it } from "vitest";
import { actionableDefs, actionLabel, nextValue, valueLabel, valueRows } from "./prop-actions";

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
