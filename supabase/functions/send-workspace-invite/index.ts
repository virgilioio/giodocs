// send-workspace-invite: creates workspace_invites rows and emails each
// invitee via Resend. Ported from Gio ATS's send-invitation, adapted to
// Gio Docs' single-workspace model.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { renderMemberInviteEmail } from "../_shared/memberInviteEmail.ts";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Gio Docs <noreply@docs.gogio.io>";
const APP_URL = (Deno.env.get("APP_URL") || "https://docs.gogio.io").replace(/\/+$/, "");

const AVATAR_PALETTE = ["#6F3FF5", "#12B886", "#E8590C", "#1C7ED6", "#D6336C", "#4C6EF5", "#F59F00", "#0CA678"];

type Role = "member" | "owner";

interface InvitePayload {
  email: string;
  role: Role;
}

interface RequestBody {
  workspaceId: string;
  invites: InvitePayload[];
  message?: string;
}

interface InviteResult {
  email: string;
  ok: boolean;
  error?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function firstNameOf(fullName: string, email: string): string {
  const trimmed = (fullName || "").trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  return email.split("@")[0] || "there";
}

serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: jsonHeaders,
      });
    }

    if (!RESEND_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not configured on the server." }),
        { status: 500, headers: jsonHeaders },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client scoped to the caller — used to verify identity and ownership via RLS.
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    // Service-role client — used for the create_workspace_invite RPC and the
    // subsequent email_status writes (bypasses RLS on purpose).
    const asService = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not signed in" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }
    const inviterUserId = userData.user.id;

    const body = (await req.json()) as RequestBody;
    if (!body || typeof body.workspaceId !== "string" || !Array.isArray(body.invites)) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    const workspaceId = body.workspaceId;
    const message = (body.message || "").slice(0, 2000);

    // Owner check via is_owner (RLS-friendly, security definer).
    const { data: isOwner, error: ownErr } = await asUser.rpc("is_owner", { p_ws: workspaceId });
    if (ownErr || !isOwner) {
      return new Response(JSON.stringify({ error: "Only workspace owners can invite." }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    // Look up workspace name + inviter profile for the email template.
    const { data: ws } = await asService
      .from("workspaces")
      .select("name")
      .eq("id", workspaceId)
      .maybeSingle();
    const workspaceName = ws?.name || "your workspace";

    const { data: inviterProfile } = await asService
      .from("profiles")
      .select("full_name, email")
      .eq("id", inviterUserId)
      .maybeSingle();
    const inviterName = (inviterProfile?.full_name || "").trim() || inviterProfile?.email || "A teammate";

    const resend = new Resend(RESEND_KEY);
    const results: InviteResult[] = [];

    for (const raw of body.invites) {
      const email = (raw?.email || "").trim().toLowerCase();
      const role: Role = raw?.role === "owner" ? "owner" : "member";
      if (!email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
        results.push({ email: raw?.email || "", ok: false, error: "Invalid email" });
        continue;
      }

      // 1) Create or refresh the invite row via SECURITY DEFINER RPC.
      const { data: inv, error: rpcErr } = await asService.rpc("create_workspace_invite", {
        p_workspace: workspaceId,
        p_email: email,
        p_role: role,
        p_invited_by: inviterUserId,
      });
      if (rpcErr || !inv) {
        results.push({ email, ok: false, error: rpcErr?.message || "Could not create invite" });
        continue;
      }
      const invite = inv as { id: string; token: string; expires_at: string };
      const inviteUrl = `${APP_URL}/invite/${invite.token}`;
      const expiryDate = new Date(invite.expires_at).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const rendered = renderMemberInviteEmail({
        recipient_name: firstNameOf("", email),
        workspace_name: workspaceName,
        inviter_name: inviterName,
        inviter_initials: initials(inviterName),
        inviter_color: colorFor(inviterName),
        role_label: role === "owner" ? "Owner" : "Member",
        invite_url: inviteUrl,
        expiry_date: expiryDate,
        personal_message: message || undefined,
      });

      // 2) Send with 3 retries and exponential backoff.
      let sent = false;
      let lastErr: string | null = null;
      for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
        try {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: [email],
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          sent = true;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (attempt < 3) {
            const wait = 2 ** (attempt - 1) * 500;
            await new Promise((r) => setTimeout(r, wait));
          }
        }
      }

      // 3) Record delivery status back on the invite row.
      await asService
        .from("workspace_invites")
        .update({
          email_status: sent ? "sent" : "failed",
          email_error: sent ? null : lastErr,
        })
        .eq("id", invite.id);

      results.push({ email, ok: sent, error: sent ? undefined : lastErr ?? "Send failed" });
    }

    const sentCount = results.filter((r) => r.ok).length;
    return new Response(
      JSON.stringify({ sent: sentCount, total: results.length, results }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("send-workspace-invite error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
