import { describe, it, expect } from "vitest";
import {
  createUndoState,
  push,
  undo,
  redo,
  shouldCoalesce,
  UNDO_CAP,
  COALESCE_MS,
  type UndoEntry,
} from "./undo-stack";

type B = { id: string; text: string };
const mk = (blocks: B[], caret: UndoEntry<B>["caret"] = null): UndoEntry<B> => ({
  blocks,
  caret,
});

describe("undo-stack", () => {
  it("push then undo returns the pushed blocks and its caret", () => {
    const s0 = createUndoState<B>();
    const a = mk([{ id: "a", text: "hi" }], { blockId: "a", offset: 2 });
    const s1 = push(s0, a);
    const current = mk([{ id: "a", text: "hi there" }], {
      blockId: "a",
      offset: 8,
    });
    const r = undo(s1, current);
    expect(r).not.toBeNull();
    expect(r!.entry).toEqual(a);
    expect(r!.entry.caret).toEqual({ blockId: "a", offset: 2 });
    expect(r!.state.past).toEqual([]);
    expect(r!.state.future).toEqual([current]);
  });

  it("undo then redo round-trips blocks and caret", () => {
    let s = createUndoState<B>();
    const past = mk([{ id: "a", text: "one" }], { blockId: "a", offset: 3 });
    s = push(s, past);
    const cur = mk([{ id: "a", text: "one two" }], { blockId: "a", offset: 7 });
    const u = undo(s, cur)!;
    // After undo, current becomes future's head.
    const r = redo(u.state, u.entry)!;
    expect(r.entry).toEqual(cur);
    expect(r.entry.caret).toEqual({ blockId: "a", offset: 7 });
    expect(r.state.future).toEqual([]);
    expect(r.state.past).toEqual([past]);
  });

  it("a new push clears the redo (future) stack", () => {
    let s = createUndoState<B>();
    s = push(s, mk([{ id: "a", text: "one" }]));
    const cur = mk([{ id: "a", text: "two" }]);
    const u = undo(s, cur)!;
    expect(u.state.future.length).toBe(1);
    const s2 = push(u.state, mk([{ id: "a", text: "three" }]));
    expect(s2.future).toEqual([]);
    expect(s2.past.length).toBe(1);
  });

  it("cap at UNDO_CAP drops the OLDEST and never the newest", () => {
    let s = createUndoState<B>();
    for (let i = 0; i < UNDO_CAP + 25; i++) {
      s = push(s, mk([{ id: "a", text: `v${i}` }]));
    }
    expect(s.past.length).toBe(UNDO_CAP);
    // Newest survived.
    expect(s.past[s.past.length - 1].blocks[0].text).toBe(
      `v${UNDO_CAP + 25 - 1}`,
    );
    // Oldest dropped: v0 is gone, first is v25.
    expect(s.past[0].blocks[0].text).toBe(`v25`);
  });

  it("undo on empty past is a no-op (returns null)", () => {
    const s = createUndoState<B>();
    expect(undo(s, mk([]))).toBeNull();
  });

  it("redo on empty future is a no-op (returns null)", () => {
    const s = createUndoState<B>();
    expect(redo(s, mk([]))).toBeNull();
  });

  it("shouldCoalesce: true within COALESCE_MS on same block", () => {
    expect(shouldCoalesce(1_000, 1_000 + COALESCE_MS - 1, "a", "a")).toBe(true);
  });

  it("shouldCoalesce: false after COALESCE_MS elapsed on same block", () => {
    expect(shouldCoalesce(1_000, 1_000 + COALESCE_MS + 1, "a", "a")).toBe(false);
    expect(shouldCoalesce(1_000, 1_000 + COALESCE_MS, "a", "a")).toBe(false);
  });

  it("shouldCoalesce: false on a different block, even within window", () => {
    expect(shouldCoalesce(1_000, 1_010, "a", "b")).toBe(false);
  });

  it("shouldCoalesce: false when there is no previous push", () => {
    expect(shouldCoalesce(null, 1_000, null, "a")).toBe(false);
  });

  it("carries caret through undo and redo", () => {
    let s = createUndoState<B>();
    const past = mk([{ id: "b1", text: "abc" }], { blockId: "b1", offset: 3 });
    s = push(s, past);
    const cur = mk([{ id: "b2", text: "" }], { blockId: "b2", offset: 0 });
    const u = undo(s, cur)!;
    expect(u.entry.caret).toEqual({ blockId: "b1", offset: 3 });
    const r = redo(u.state, u.entry)!;
    expect(r.entry.caret).toEqual({ blockId: "b2", offset: 0 });
  });
});
