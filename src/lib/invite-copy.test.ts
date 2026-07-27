import { describe, it, expect } from "vitest";
import {
  copyForState,
  isPasswordValid,
  canSubmitSignup,
  MIN_PASSWORD_LENGTH,
} from "./invite-copy";

describe("copyForState", () => {
  it("not_found: prompts to ask sender", () => {
    const c = copyForState("not_found");
    expect(c.heading).toMatch(/isn't valid/);
    expect(c.body).toMatch(/send a new one/);
  });

  it("expired: names the inviter when available", () => {
    const c = copyForState("expired", { inviterName: "Ada Lovelace" });
    expect(c.heading).toMatch(/expired/);
    expect(c.body).toContain("Ada Lovelace");
  });

  it("expired: falls back when inviter is blank", () => {
    const c = copyForState("expired", { inviterName: "  " });
    expect(c.body).toContain("whoever invited you");
  });

  it("accepted: tells them to sign in", () => {
    const c = copyForState("accepted");
    expect(c.heading).toMatch(/already been used/);
    expect(c.body).toMatch(/[Ss]ign in/);
  });

  it("valid: builds the greeting from inviter + workspace", () => {
    const c = copyForState("valid", {
      inviterName: "Ada",
      workspaceName: "Virgilio LLC",
    });
    expect(c.heading).toBe("Ada invited you to Virgilio LLC");
  });
});

describe("password validity", () => {
  it("requires at least 8 characters", () => {
    expect(isPasswordValid("")).toBe(false);
    expect(isPasswordValid("short")).toBe(false);
    expect(isPasswordValid("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
    expect(isPasswordValid("a".repeat(MIN_PASSWORD_LENGTH))).toBe(true);
    expect(isPasswordValid("longenoughpw")).toBe(true);
  });

  it("submit is only enabled with a name and valid password", () => {
    expect(canSubmitSignup("", "longenoughpw")).toBe(false);
    expect(canSubmitSignup("Ada", "short")).toBe(false);
    expect(canSubmitSignup("   ", "longenoughpw")).toBe(false);
    expect(canSubmitSignup("Ada", "longenoughpw")).toBe(true);
  });
});
