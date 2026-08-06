import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useToast } from "@/lib/toast";
import type { PendingInvite } from "@/components/add-members-modal";

// Palette matches AddMembersModal's on-the-fly hashing so the same email
// gets a consistent tint everywhere it appears.
const AVATAR_TINTS = [
  "var(--color-accentTint)",
  "var(--color-amberRing)",
  "var(--color-blueWash)",
  "var(--color-purpleTint)",
  "var(--color-pinkTint)",
  "var(--color-yellowTint)",
];
const AVATAR_INKS = [
  "var(--color-accent)",
  "var(--color-amberInk)",
  "var(--color-blueInk)",
  "var(--color-purple)",
  "var(--color-pinkInk)",
  "var(--color-yellowInk)",
];

function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase())
      .join(" ") || email
  );
}

type InviteRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: "owner" | "member";
  invited_at: string;
  expires_at: string;
  accepted_at: string | null;
  email_status: string;
};

/**
 * Live-read pending workspace invites. Returns them in PendingInvite shape so
 * the existing settings-modal member list can render them alongside members
 * without any UI changes. Invites disappear once accepted_at is set.
 */
export function useWorkspaceInvites() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: qk.invites(ws),
    queryFn: async (): Promise<PendingInvite[]> => {
      const { data, error } = await supabase
        .from("workspace_invites_public")
        .select("id, workspace_id, email, role, invited_at, expires_at, accepted_at, email_status")
        .eq("workspace_id", ws)
        .is("accepted_at", null)
        .order("invited_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as InviteRow[]).map((r) => {
        const idx = hashIndex(r.email, 6);
        return {
          email: r.email,
          name: nameFromEmail(r.email),
          role: r.role === "owner" ? "Owner" : "Member",
          tint: AVATAR_TINTS[idx],
          ink: AVATAR_INKS[idx],
          // accepted_at is checked FIRST: an accepted invite is spent and can
          // never be "expired", however old its expires_at is.
          accepted: r.accepted_at != null,
          expiresAt: r.expires_at,
        } satisfies PendingInvite;
      });

    },
    staleTime: 30_000,
  });
}

type SendInvitesArgs = {
  invites: { email: string; role: "member" | "owner" }[];
  message?: string;
};
type SendInvitesResult = {
  sent: number;
  total: number;
  results: { email: string; ok: boolean; error?: string }[];
};

/**
 * Calls the send-workspace-invite edge function, which creates one
 * workspace_invites row per email (RPC create_workspace_invite) and mails
 * each recipient via Resend. Any failed recipient is reported per-row so
 * the caller can toast partial success.
 */
export function useSendInvites() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  return useMutation({
    mutationFn: async (args: SendInvitesArgs): Promise<SendInvitesResult> => {
      const { data, error } = await supabase.functions.invoke("send-workspace-invite", {
        body: { workspaceId: ws, invites: args.invites, message: args.message },
      });
      if (error) {
        // supabase-js wraps non-2xx in FunctionsHttpError; surface the server msg when we can.
        const asAny = error as unknown as { context?: { json?: () => Promise<{ error?: string }> } };
        const serverJson = await asAny.context?.json?.().catch(() => null);
        throw new Error(serverJson?.error || error.message);
      }
      return data as SendInvitesResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.invites(ws) });
    },
  });
}

/**
 * Owner-only: hard-deletes a pending invite row. Used by the "Revoke" action
 * in settings and the resend flow (delete + re-send). Realtime + invalidate
 * keeps the sidebar list in sync.
 */
export function useCancelInvite() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase
        .from("workspace_invites")
        .delete()
        .eq("workspace_id", ws)
        .eq("email", email)
        .is("accepted_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites(ws) }),
    onError: (err) => toast.push(`Couldn't revoke: ${(err as Error).message}`),
  });
}
