import { describe, expect, it } from "vitest";
import { checkTypedValue, displayFor, hrefFor, keyForLabel } from "./property-kinds";

const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;

describe("keyForLabel", () => {
  it("makes a valid database key", () => {
    expect(keyForLabel("Hiring manager", [])).toBe("hiring_manager");
    expect(keyForLabel("Próxima revisión", [])).toBe("proxima_revision");
    expect(keyForLabel("2nd interview", [])).toBe("p_2nd_interview");
    expect(keyForLabel("!!!", [])).toMatch(KEY_RE);
  });
  it("never takes an existing key", () => {
    expect(keyForLabel("Status", ["status"])).toBe("status_2");
    expect(keyForLabel("Status", ["status", "status_2"])).toBe("status_3");
  });
  it("stays within 31 characters", () => {
    const k = keyForLabel("A very long property name that keeps going and going", ["a_very_long_property_name_th"]);
    expect(k).toMatch(KEY_RE);
    expect(k.length).toBeLessThanOrEqual(31);
  });
});

describe("checkTypedValue", () => {
  it("adds https to a bare link and rejects nonsense", () => {
    expect(checkTypedValue("url", "virgilio.tech/jobs")).toEqual({ ok: true, value: "https://virgilio.tech/jobs" });
    expect(checkTypedValue("url", "https://a.io").ok).toBe(true);
    expect(checkTypedValue("url", "not a link").ok).toBe(false);
    expect(checkTypedValue("url", "hello").ok).toBe(false);
  });
  it("matches the database's email and phone rules", () => {
    expect(checkTypedValue("email", "allan@virgilio.tech")).toEqual({ ok: true, value: "allan@virgilio.tech" });
    expect(checkTypedValue("email", "allan@virgilio").ok).toBe(false);
    expect(checkTypedValue("phone", "+52 (33) 1234-5678")).toEqual({ ok: true, value: "+52 (33) 1234-5678" });
    expect(checkTypedValue("phone", "call me").ok).toBe(false);
  });
});

describe("hrefFor / displayFor", () => {
  it("opens the right kind of link", () => {
    expect(hrefFor("email", "a@b.co")).toBe("mailto:a@b.co");
    expect(hrefFor("phone", "+52 (33) 1234-5678")).toBe("tel:+523312345678");
    expect(hrefFor("url", "a.io")).toBe("https://a.io");
  });
  it("shows a link without its scheme", () => {
    expect(displayFor("url", "https://www.virgilio.tech/jobs/")).toBe("virgilio.tech/jobs");
  });
});
