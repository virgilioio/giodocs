/**
 * Pure copy + validation helpers for the /invite/$token flow.
 * No React, no supabase — just strings so the tests can pin them down.
 */

export type InviteState = "valid" | "expired" | "accepted" | "not_found";

export type InviteCopy = {
  heading: string;
  body: string;
};

export function copyForState(
  state: InviteState,
  ctx: { inviterName?: string | null; workspaceName?: string | null } = {},
): InviteCopy {
  switch (state) {
    case "not_found":
      return {
        heading: "This invite link isn't valid.",
        body: "Ask whoever invited you to send a new one.",
      };
    case "expired":
      return {
        heading: "This invite has expired.",
        body: `Invites last 7 days. Ask ${
          ctx.inviterName?.trim() || "whoever invited you"
        } to send a new one.`,
      };
    case "accepted":
      return {
        heading: "This invite has already been used.",
        body: "Sign in to your account to open the workspace.",
      };
    case "valid":
      return {
        heading: `${ctx.inviterName?.trim() || "Someone"} invited you to ${
          ctx.workspaceName?.trim() || "a workspace"
        }`,
        body: "Set a password to join.",
      };
  }
}

export const MIN_PASSWORD_LENGTH = 8;

export function isPasswordValid(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export function canSubmitSignup(fullName: string, password: string): boolean {
  return fullName.trim().length > 0 && isPasswordValid(password);
}

export function humanizeAcceptError(msg: string): string {
  if (/expired/i.test(msg)) return "This invite has expired.";
  if (/different email/i.test(msg))
    return "This invite is for a different email address.";
  if (/not found/i.test(msg)) return "This invite link isn't valid.";
  return msg;
}
