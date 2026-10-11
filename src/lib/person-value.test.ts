import { describe, expect, it } from "vitest";
import { onePersonOnly, personIds, personValue, togglePerson } from "./person-value";

const A = "a11a0000-0000-4000-8000-000000000001";
const B = "b22b0000-0000-4000-8000-000000000002";

describe("person values", () => {
  it("reads one id or a list", () => {
    expect(personIds(A)).toEqual([A]);
    expect(personIds([A, B, A])).toEqual([A, B]);
    expect(personIds(null)).toEqual([]);
    expect(personIds(7)).toEqual([]);
  });
  it("knows a limit of one", () => {
    expect(onePersonOnly({ config: { limit: 1 } })).toBe(true);
    expect(onePersonOnly({ config: {} })).toBe(false);
    expect(onePersonOnly(null)).toBe(false);
  });
  it("stores a list without a limit, one id with", () => {
    expect(personValue([A], false)).toEqual([A]);
    expect(personValue([A, B], true)).toBe(A);
    expect(personValue([], false)).toBeNull();
  });
  it("toggles people on a list and replaces with a limit", () => {
    expect(togglePerson(A, B, false)).toEqual([A, B]);
    expect(togglePerson([A, B], A, false)).toEqual([B]);
    expect(togglePerson([A], A, false)).toBeNull();
    expect(togglePerson(A, B, true)).toBe(B);
  });
});
