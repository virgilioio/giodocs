import { describe, expect, it } from "vitest";
import {
  assignedTo,
  doneValueFor,
  isTaskDone,
  myTasks,
  readTaskConfig,
  suggestTaskConfig,
  taskBucket,
} from "./tasks";

const DB = "db";
const defs = [
  { key: "status", label: "Status", type: "status", database_id: DB, options: [{ value: "Todo", label: "Todo" }, { value: "Done", label: "Done" }] },
  { key: "owner", label: "Owner", type: "person", database_id: DB },
  { key: "assignee", label: "Assignee", type: "person", database_id: DB },
  { key: "due", label: "Due", type: "date", database_id: DB },
  { key: "old", label: "Old", type: "date", database_id: DB, archived_at: "x" },
  { key: "elsewhere", label: "Status", type: "status", database_id: "other" },
];

describe("readTaskConfig", () => {
  it("needs done, assignee and due", () => {
    expect(readTaskConfig(null)).toBeNull();
    expect(readTaskConfig({ done: "s", assignee: "a" })).toBeNull();
    expect(readTaskConfig({ done: "s", assignee: "a", due: "d", done_values: ["X", 2] })).toEqual({
      done: "s",
      assignee: "a",
      due: "d",
      done_values: ["X"],
    });
  });
});

describe("suggestTaskConfig", () => {
  it("picks the database's own live properties, preferring telling names", () => {
    expect(suggestTaskConfig(DB, defs)).toEqual({
      done: "status",
      done_values: ["Done"],
      assignee: "assignee",
      due: "due",
    });
    expect(suggestTaskConfig("none", defs)).toEqual({ done_values: [] });
  });
});

describe("done", () => {
  const cfg = { done: "status", assignee: "a", due: "d", done_values: ["Done", "Shipped"] };
  it("reads checkbox and option values", () => {
    expect(isTaskDone(true, "checkbox", cfg)).toBe(true);
    expect(isTaskDone(false, "checkbox", cfg)).toBe(false);
    expect(isTaskDone("Shipped", "status", cfg)).toBe(true);
    expect(isTaskDone("Todo", "status", cfg)).toBe(false);
    expect(doneValueFor("checkbox", cfg)).toBe(true);
    expect(doneValueFor("status", cfg)).toBe("Done");
  });
});

describe("assignedTo", () => {
  it("reads one id or a list", () => {
    expect(assignedTo("me", "me")).toBe(true);
    expect(assignedTo(["x", "me"], "me")).toBe(true);
    expect(assignedTo(null, "me")).toBe(false);
  });
});

describe("taskBucket", () => {
  const today = "2026-10-10";
  it("groups by due date", () => {
    expect(taskBucket(null, today)).toBe("none");
    expect(taskBucket("2026-10-09", today)).toBe("overdue");
    expect(taskBucket("2026-10-10", today)).toBe("today");
    expect(taskBucket("2026-10-08/2026-10-11", today)).toBe("today");
    expect(taskBucket("2026-10-01/2026-10-09", today)).toBe("overdue");
    expect(taskBucket("2026-10-17", today)).toBe("week");
    expect(taskBucket("2026-10-18", today)).toBe("later");
  });
});

describe("myTasks", () => {
  const pages = [
    { id: DB, is_database: true, task_config: { done: "status", done_values: ["Done"], assignee: "assignee", due: "due" } },
    { id: "plain-db", is_database: true },
    { id: "t1", title: "Later one", database_id: DB, props: { assignee: "me", due: "2026-12-01" } },
    { id: "t2", title: "Late", database_id: DB, props: { assignee: "me", due: "2026-10-01", status: "Todo" } },
    { id: "t3", title: "Finished", database_id: DB, props: { assignee: "me", status: "Done" } },
    { id: "t4", title: "Someone else's", database_id: DB, props: { assignee: "you" } },
    { id: "t5", title: "No date", database_id: DB, props: { assignee: ["me"] } },
    { id: "t6", title: "Not a task db", database_id: "plain-db", props: { assignee: "me" } },
  ];
  it("lists open tasks assigned to me, soonest first", () => {
    const rows = myTasks(pages, defs, "me", "2026-10-10");
    expect(rows.map((r) => [r.page.id, r.bucket])).toEqual([
      ["t2", "overdue"],
      ["t1", "later"],
      ["t5", "none"],
    ]);
  });
  it("filters by database and drops a config whose done property is gone", () => {
    expect(myTasks(pages, defs, "me", "2026-10-10", { databases: new Set(["x"]) })).toEqual([]);
    expect(myTasks(pages, defs.filter((d) => d.key !== "status"), "me", "2026-10-10")).toEqual([]);
  });
});
