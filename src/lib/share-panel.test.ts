import { describe, it, expect } from "vitest";
import {
  normAccess,
  guestNameFromEmail,
  isCompleteEmail,
  panelCopy,
} from "./share-panel";
import type { PageAccessRow } from "./types";

const M = [
  {
    user_id: "u1",
    full_name: "Alice",
    email: "alice@acme.com",
    avatar_tint: "var(--color-sunken)",
    avatar_ink: "var(--color-noir)",
  },
  {
    user_id: "u2",
    full_name: "Bob",
    email: "bob@acme.com",
    avatar_tint: null,
    avatar_ink: null,
  },
];

describe("guestNameFromEmail", () => {
  it("uses the local part of the email as the display name", () => {
    expect(guestNameFromEmail("sam.brown+work@example.com")).toBe(
      "sam.brown+work",
    );
    expect(guestNameFromEmail("root@x.io")).toBe("root");
  });
});

describe("isCompleteEmail", () => {
  it("accepts a syntactically complete email", () => {
    expect(isCompleteEmail("me@foo.com")).toBe(true);
    expect(isCompleteEmail("  me@foo.com  ")).toBe(true);
  });
  it("rejects partials", () => {
    expect(isCompleteEmail("me")).toBe(false);
    expect(isCompleteEmail("me@")).toBe(false);
    expect(isCompleteEmail("me@foo")).toBe(false);
    expect(isCompleteEmail("")).toBe(false);
  });
});

describe("normAccess", () => {
  it("splits members and guests into two separate lists", () => {
    const rows: PageAccessRow[] = [
      { page_id: "p", user_id: "u1", guest_email: null, capability: "write" },
      {
        page_id: "p",
        user_id: null,
        guest_email: "ext@partner.com",
        capability: "read",
      },
    ];
    const n = normAccess(
      { access_type: "restricted", ws_role: "edit" },
      rows,
      M,
    );
    expect(n.type).toBe("restricted");
    expect(n.people).toHaveLength(1);
    expect(n.people[0]).toMatchObject({ id: "u1", role: "edit", name: "Alice" });
    expect(n.guests).toHaveLength(1);
    expect(n.guests[0]).toMatchObject({
      email: "ext@partner.com",
      name: "ext",
      role: "view",
    });
  });
});

describe("panelCopy — §6.4 (members and guests are never summed)", () => {
  it("1 member + 2 guests renders '1 person … plus 2 guests', never '3 people'", () => {
    const copy = panelCopy(
      {
        type: "restricted",
        wsRole: "edit",
        people: [
          {
            id: "u1",
            name: "Alice",
            email: "a@x",
            role: "edit",
            tint: null,
            ink: null,
          },
        ],
        guests: [
          { email: "g1@x.com", name: "g1", role: "view" },
          { email: "g2@x.com", name: "g2", role: "view" },
        ],
      },
      "Acme",
      10,
      "Engineering",
    );
    expect(copy.warnings[0]).toContain("1 person at Acme");
    expect(copy.warnings[0]).toContain("2 guests outside it");
    expect(copy.warnings[0]).not.toContain("3 people");
    expect(copy.chipLabel).toBe("Only 1 person · 2 guests");
  });

  it("singular/plural correct in both fragments", () => {
    const c1 = panelCopy(
      {
        type: "restricted",
        wsRole: "edit",
        people: [
          { id: "u1", name: "A", email: null, role: "edit", tint: null, ink: null },
          { id: "u2", name: "B", email: null, role: "edit", tint: null, ink: null },
        ],
        guests: [{ email: "g@x.com", name: "g", role: "view" }],
      },
      "Acme",
      10,
      null,
    );
    expect(c1.warnings[0]).toContain("2 people");
    expect(c1.warnings[0]).toContain("1 guest outside it");
    expect(c1.chipLabel).toBe("Only 2 people · 1 guest");
  });

  it("the outside-guest line appears in BOTH modes when guests > 0 (not an else branch)", () => {
    const restricted = panelCopy(
      {
        type: "restricted",
        wsRole: "edit",
        people: [
          { id: "u1", name: "A", email: null, role: "edit", tint: null, ink: null },
        ],
        guests: [{ email: "g@x.com", name: "g", role: "view" }],
      },
      "Acme",
      10,
      "Design",
    );
    expect(restricted.warnings).toHaveLength(2);
    expect(restricted.warnings[1]).toContain(
      "1 person outside Acme can see this page.",
    );
    expect(restricted.warnings[1]).toContain(
      "Removing them does not change who at Acme can open it.",
    );

    const workspace = panelCopy(
      {
        type: "workspace",
        wsRole: "edit",
        people: [],
        guests: [{ email: "g@x.com", name: "g", role: "view" }],
      },
      "Acme",
      10,
      "Design",
    );
    expect(workspace.warnings).toHaveLength(1);
    expect(workspace.warnings[0]).toContain("1 person outside Acme");
    expect(workspace.warnings[0]).toContain("The rest of Design has no guests.");
  });

  it("no warnings when workspace mode with no guests", () => {
    const c = panelCopy(
      { type: "workspace", wsRole: "edit", people: [], guests: [] },
      "Acme",
      5,
      "Design",
    );
    expect(c.warnings).toHaveLength(0);
    expect(c.chipLabel).toBe("Everyone at Acme");
  });
});
