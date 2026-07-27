/**
 * Pure helpers for the share panel (permissions popover).
 *
 * The panel keeps members and guests as TWO SEPARATE LISTS all the way to
 * the copy — §6.4 in the spec. Every helper here honours that split; a
 * "3 people" that summed 1 member + 2 guests would be a regression.
 */

import type { PageAccessRow } from "./types";

export type MemberInfo = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_tint: string | null;
  avatar_ink: string | null;
};

export type NormPerson = {
  id: string;
  name: string;
  email: string | null;
  role: "edit" | "view";
  tint: string | null;
  ink: string | null;
};

export type NormGuest = {
  email: string;
  name: string;
  role: "edit" | "view";
};

export type NormAccess = {
  type: "workspace" | "restricted";
  wsRole: "edit" | "view";
  people: NormPerson[];
  guests: NormGuest[];
};

/** "sam.brown+work@example.com" → "sam.brown". Display-only. */
export function guestNameFromEmail(email: string): string {
  const local = String(email).split("@")[0] ?? "";
  return local || email;
}

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Syntactically-complete email — used only to gate the guest-invite row. */
export function isCompleteEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

function capToRole(cap: string | null | undefined): "edit" | "view" {
  return cap === "write" ? "edit" : "view";
}

export function normAccess(
  page: { access_type: string; ws_role: string; props?: Record<string, unknown> | null },
  rows: PageAccessRow[],
  members: MemberInfo[],
): NormAccess {
  const byId = new Map(members.map((m) => [m.user_id, m]));
  const people: NormPerson[] = [];
  const guests: NormGuest[] = [];
  for (const r of rows) {
    if (r.user_id) {
      const m = byId.get(r.user_id);
      people.push({
        id: r.user_id,
        name: m?.full_name || m?.email || "Unnamed",
        email: m?.email ?? null,
        role: capToRole(r.capability),
        tint: m?.avatar_tint ?? null,
        ink: m?.avatar_ink ?? null,
      });
    } else if (r.guest_email) {
      const email = r.guest_email.toLowerCase();
      guests.push({
        email,
        name: guestNameFromEmail(email),
        role: capToRole(r.capability),
      });
    }
  }
  const type: "workspace" | "restricted" =
    page.access_type === "restricted" ? "restricted" : "workspace";
  const wsRole: "edit" | "view" = page.ws_role === "view" ? "view" : "edit";
  return { type, wsRole, people, guests };
}

/* ────────────── Copy builder ────────────── */

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export type PanelCopy = {
  /** Text shown on the on-page permissions chip. */
  chipLabel: string;
  /** Header count suffix on "PEOPLE WITH ACCESS". */
  peopleCountSuffix: string;
  /** Amber lines, top-to-bottom. Empty array when neither applies. */
  warnings: string[];
};

export function panelCopy(
  norm: NormAccess,
  workspaceName: string,
  memberTotal: number,
  areaLabel: string | null,
): PanelCopy {
  const ws = workspaceName || "this workspace";
  const nPeople = norm.people.length;
  const nGuests = norm.guests.length;

  // Chip: "Only 0 people" is unreachable (RPC enforces the floor).
  const chipLabel =
    norm.type === "workspace"
      ? nGuests > 0
        ? `Everyone at ${ws} · ${plural(nGuests, "guest", "guests")}`
        : `Everyone at ${ws}`
      : nGuests > 0
        ? `Only ${plural(Math.max(1, nPeople), "person", "people")} · ${plural(
            nGuests,
            "guest",
            "guests",
          )}`
        : `Only ${plural(Math.max(1, nPeople), "person", "people")}`;

  const peopleCountSuffix =
    norm.type === "restricted"
      ? ` · ${nPeople}`
      : nGuests > 0
        ? ` · everyone + ${nGuests}`
        : ` · everyone`;

  const warnings: string[] = [];

  if (norm.type === "restricted") {
    const area = areaLabel ? areaLabel : "this area";
    const guestBit =
      nGuests > 0 ? `, plus ${plural(nGuests, "guest", "guests")} outside it` : "";
    warnings.push(
      `Most of ${area} is open to everyone at ${ws} — this page is visible to only ${plural(
        Math.max(1, nPeople),
        "person",
        "people",
      )} at ${ws}${guestBit}.`,
    );
  }

  // §6.4 — the outside-guest line is INDEPENDENT of mode. Not an else branch.
  if (nGuests > 0) {
    const suffix =
      norm.type === "restricted"
        ? " Removing them does not change who at " + ws + " can open it."
        : areaLabel
          ? ` The rest of ${areaLabel} has no guests.`
          : " The rest of this area has no guests.";
    warnings.push(
      `${plural(nGuests, "person", "people")} outside ${ws} can see this page.${suffix}`,
    );
  }

  return { chipLabel, peopleCountSuffix, warnings };
}
