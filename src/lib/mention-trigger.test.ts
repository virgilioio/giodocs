import { describe, expect, it } from "vitest";
import { mentionCandidates, shouldOpenMentionTrigger } from "./mention-trigger";

describe("shouldOpenMentionTrigger", () => {
  it("opens after a space or at the start", () => {
    expect(shouldOpenMentionTrigger("@")).toEqual({ open: true, at: 0, query: "" });
    expect(shouldOpenMentionTrigger("ask @sa")).toEqual({ open: true, at: 4, query: "sa" });
    expect(shouldOpenMentionTrigger("ask @sam riv")).toMatchObject({ open: true, query: "sam riv" });
  });
  it("stays shut for emails, old mentions and sentences", () => {
    expect(shouldOpenMentionTrigger("mail allan@virg").open).toBe(false);
    expect(shouldOpenMentionTrigger("@[Sam](user:x) and more").open).toBe(false);
    expect(shouldOpenMentionTrigger("@ sam").open).toBe(false);
    expect(shouldOpenMentionTrigger("@one two three four").open).toBe(false);
  });
});

describe("mentionCandidates", () => {
  const users = new Map([
    ["u1", "Allan Bravo"],
    ["u2", "Sam Rivera"],
    ["u3", "Ángela Sánchez"],
  ]);
  const pages = new Map([
    ["p1", { title: "Sales playbook", icon: null }],
    ["p2", { title: "Onboarding guide", icon: "📘" }],
    ["p3", { title: "Hiring: sales roles", icon: null }],
  ]);
  it("puts people first, then pages, best match first", () => {
    const r = mentionCandidates("sa", users, pages);
    expect(r.map((c) => c.id)).toEqual(["u2", "u3", "p1", "p3"]);
  });
  it("ignores accents and lists everyone for an empty query", () => {
    expect(mentionCandidates("ange", users, pages).map((c) => c.id)).toEqual(["u3"]);
    expect(mentionCandidates("", users, pages, { maxPages: 2 }).length).toBe(5);
  });
});
