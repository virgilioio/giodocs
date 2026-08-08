import { describe, expect, it } from "vitest";
import {
  activeCall,
  canPick,
  footerText,
  FUNCTION_TOTAL,
  insertFunction,
  insertRef,
  matchFunctions,
  moveHighlight,
  offersHere,
  panelPlacement,
  suggestFor,
  wordUnderCaret,
} from "./sheet-formula";
import { FUNCTION_META } from "./sheet-engine";
import { keyWhenEditing } from "./sheet-select";

describe("wordUnderCaret", () => {
  it("reads the word under the caret, not the tail of the draft", () => {
    const src = "=SUM(A1)+MIN(B1)";
    // caret just after "MI" inside MIN
    expect(wordUnderCaret(src, 11).text).toBe("MIN");
    // caret inside SUM near the start
    expect(wordUnderCaret(src, 3).text).toBe("SUM");
  });

  it("returns an empty token where no identifier sits", () => {
    expect(wordUnderCaret("=1+", 3).text).toBe("");
  });
});

describe("offersHere", () => {
  it("offers after =, an operator, a comma and an open paren", () => {
    for (const s of ["=", "=1+", "=1*", "=SUM(", "=SUM(A1,", "=A1:"])
      expect(offersHere(s)).toBe(true);
  });
  it("does not offer after a complete reference or a digit", () => {
    expect(offersHere("=B2")).toBe(false);
    expect(offersHere("=12")).toBe(false);
    expect(offersHere("=SUM(A1)")).toBe(false);
  });
});

describe("suggestFor", () => {
  it("'=' opens the whole engine table", () => {
    const s = suggestFor("=", 1)!;
    expect(s.items.length).toBe(FUNCTION_TOTAL);
    expect(s.total).toBe(20);
  });
  it("narrows as you type", () => {
    expect(suggestFor("=C", 2)!.items.map((f) => f.name)).toEqual(["COUNT", "CONCAT"]);
  });
  it("reopens after an operator and a comma", () => {
    expect(suggestFor("=1+", 3)!.items.length).toBe(FUNCTION_TOTAL);
    expect(suggestFor("=IF(A1,", 7)!.items.length).toBe(FUNCTION_TOTAL);
  });
  it("stays shut for a plain value and for an unknown prefix", () => {
    expect(suggestFor("Hello", 5)).toBeNull();
    expect(suggestFor("=ZZ", 3)).toBeNull();
  });
  it("offers from the caret mid-formula", () => {
    const s = suggestFor("=MI+SUM(A1)", 3)!;
    expect(s.items.map((f) => f.name)).toEqual(["MIN", "MINUS"]);
  });
});

describe("footerText", () => {
  it("reports the whole list, then the narrowed count", () => {
    expect(footerText(20, 20)).toBe("All 20 functions · type to narrow · ↑↓ Tab");
    expect(footerText(2, 20)).toBe("2 of 20 · ↑↓ to choose · Tab to insert");
  });
});

describe("insertFunction", () => {
  it("inserts NAME( with the caret inside", () => {
    const meta = matchFunctions("SU")[0];
    expect(insertFunction("=SU", 3, meta)).toEqual({ draft: "=SUM(", caret: 5 });
  });
  it("TODAY lands complete, caret after the paren", () => {
    const meta = FUNCTION_META.find((f) => f.name === "TODAY")!;
    expect(insertFunction("=TOD", 4, meta)).toEqual({ draft: "=TODAY()", caret: 8 });
  });
  it("replaces the word under the caret, not the tail", () => {
    const meta = FUNCTION_META.find((f) => f.name === "MIN")!;
    expect(insertFunction("=MI+SUM(A1)", 3, meta).draft).toBe("=MIN(+SUM(A1)");
  });
});

describe("moveHighlight", () => {
  it("wraps at both ends", () => {
    expect(moveHighlight(0, -1, 3)).toBe(2);
    expect(moveHighlight(2, 1, 3)).toBe(0);
  });
});

describe("keyboard precedence with the panel open", () => {
  const k = (key: string) => ({ key });
  it("the panel takes ↑↓ Tab Enter Escape", () => {
    expect(keyWhenEditing(k("ArrowUp"), 0, 0, 10, 5, true)).toEqual({ kind: "panelPrev" });
    expect(keyWhenEditing(k("ArrowDown"), 0, 0, 10, 5, true)).toEqual({ kind: "panelNext" });
    expect(keyWhenEditing(k("Tab"), 0, 0, 10, 5, true)).toEqual({ kind: "panelInsert" });
    expect(keyWhenEditing(k("Enter"), 0, 0, 10, 5, true)).toEqual({ kind: "panelInsert" });
    expect(keyWhenEditing(k("Escape"), 0, 0, 10, 5, true)).toEqual({ kind: "panelClose" });
  });
  it("with the panel closed the editing bindings stand", () => {
    expect(keyWhenEditing(k("Tab"), 0, 0, 10, 5, false)).toEqual({
      kind: "commit",
      r: 0,
      c: 1,
    });
    expect(keyWhenEditing(k("Enter"), 0, 0, 10, 5, false)).toEqual({
      kind: "commit",
      r: 1,
      c: 0,
    });
    expect(keyWhenEditing(k("Escape"), 0, 0, 10, 5, false)).toEqual({ kind: "discard" });
    expect(keyWhenEditing(k("ArrowUp"), 0, 0, 10, 5, false)).toEqual({ kind: "pass" });
  });
});

describe("activeCall", () => {
  it("names the innermost call the caret sits in", () => {
    expect(activeCall("=SUM(", 5)!.sig).toBe("SUM(range)");
    expect(activeCall("=SUM(MIN(A1", 11)!.sig).toBe("MIN(range)");
    expect(activeCall("=SUM(MIN(A1),", 13)!.sig).toBe("SUM(range)");
  });
  it("is null once the call is closed", () => {
    expect(activeCall("=SUM(A1)", 8)).toBeNull();
  });
});

describe("click-to-reference", () => {
  it("permits a pick where an operand belongs", () => {
    expect(canPick("=SUM(", 5, null)).toBe(true);
    expect(canPick("=SUM(A1", 7, null)).toBe(false);
  });

  it("two consecutive picks REPLACE rather than append", () => {
    const first = insertRef("=SUM(", 5, "B2", null);
    expect(first.draft).toBe("=SUM(B2)".slice(0, 7));
    const second = insertRef(first.draft, first.caret, "C3", first.span);
    expect(second.draft).toBe("=SUM(C3");
    expect(second.span).toEqual({ start: 5, len: 2 });
  });

  it("dragging widens the pick into a range", () => {
    const first = insertRef("=", 1, "B2", null);
    const dragged = insertRef(first.draft, first.caret, "B2:B5", first.span);
    expect(dragged.draft).toBe("=B2:B5");
  });

  it("a typed character ends the pick, so the next click inserts fresh", () => {
    const first = insertRef("=", 1, "B2", null);
    // typing "+" moves the caret past the span; with the pick cleared the
    // next reference appends.
    const typed = first.draft + "+";
    expect(canPick(typed, typed.length, null)).toBe(true);
    const next = insertRef(typed, typed.length, "C3", null);
    expect(next.draft).toBe("=B2+C3");
  });
});

describe("panelPlacement", () => {
  it("flips above in the bottom few rows", () => {
    expect(panelPlacement(0, 40)).toBe("below");
    expect(panelPlacement(38, 40)).toBe("above");
    expect(panelPlacement(1, 4)).toBe("below");
  });
});
