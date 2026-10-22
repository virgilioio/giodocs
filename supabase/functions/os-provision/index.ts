// Gio Docs - os-provision
// Receives access grants from Gio OS (People & Access, in Gio ATS) and applies
// them with os_apply_grant(), which keeps Gio Docs' own member rules.
//
// POST { request_id, email, role, actor_email, resend? }
//   role: 'member' | 'owner', or null to remove access.
//   resend: true sends the invitation again (os_resend_invite): a fresh link
//   for anyone not in the workspace yet, nothing for members.
// Auth: x-gio-timestamp (unix seconds) and x-gio-signature, the hex HMAC-SHA256
// of `${timestamp}.${rawBody}` with OS_PROVISION_SECRET (Gio Docs' own value,
// not Gio Sales'). Requests older than 5 minutes are
// refused, and each request_id applies only once (os_provision_log).
// When the grant creates an invitation, the usual Gio Docs invite email goes out.
// Keep this file ASCII only: the deploy tool rewrites escape sequences.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { renderMemberInviteEmail } from '../_shared/memberInviteEmail.ts'

const APP_URL = (Deno.env.get('APP_URL') || 'https://docs.gogio.io').replace(/\/+$/, '')
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'Gio Docs <noreply@docs.gogio.io>'
const MAX_SKEW_SECONDS = 300
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', member: 'Member' }
const AVATAR_PALETTE = ['#6F3FF5', '#12B886', '#E8590C', '#1C7ED6', '#D6336C', '#4C6EF5', '#F59F00', '#0CA678']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'G'
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function colorOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}
const fmtExpiry = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'Email is not configured (RESEND_API_KEY is missing).' }
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) return { ok: true }
      lastError = body?.message || body?.error || `HTTP ${res.status}`
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break
    } catch (e) {
      lastError = String(e)
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
  }
  return { ok: false, error: lastError.slice(0, 500) }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secret = Deno.env.get('OS_PROVISION_SECRET')
  if (!secret) return json({ error: 'Provisioning is not configured.' }, 503)

  const raw = await req.text()
  const ts = req.headers.get('x-gio-timestamp') || ''
  const got = (req.headers.get('x-gio-signature') || '').trim().toLowerCase().replace(/^sha256=/, '')
  const now = Math.floor(Date.now() / 1000)
  if (!/^\d{9,11}$/.test(ts) || Math.abs(now - Number(ts)) > MAX_SKEW_SECONDS) {
    return json({ error: 'Request expired.' }, 401)
  }
  if (!got || !safeEqual(got, await hmac(secret, `${ts}.${raw}`))) return json({ error: 'Invalid signature.' }, 401)

  let p: Record<string, unknown>
  try { p = JSON.parse(raw) } catch { return json({ error: 'Invalid JSON.' }, 400) }
  const requestId = String(p.request_id ?? '')
  const email = String(p.email ?? '').trim().toLowerCase()
  const actorEmail = String(p.actor_email ?? '').trim().toLowerCase()
  const role = p.role === null || p.role === undefined ? null : String(p.role)
  const resend = p.resend === true
  if (!UUID.test(requestId)) return json({ error: 'request_id must be a UUID.' }, 400)
  if (!email || !actorEmail) return json({ error: 'email and actor_email are required.' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await db.rpc(resend ? 'os_resend_invite' : 'os_apply_grant', {
    p_request_id: requestId,
    p_email: email,
    p_role: role,
    p_actor_email: actorEmail,
  })
  if (error) return json({ error: error.message, code: error.code }, 400)

  const result = data as { outcome: string; detail: string | null; invite_id: string | null; token: string | null; repeat: boolean }
  let email_status: 'sent' | 'failed' | null = null
  let email_error: string | null = null

  if (result.outcome === 'invited' && !result.repeat && result.invite_id && result.token) {
    const [{ data: invite }, { data: ws }, { data: actor }] = await Promise.all([
      db.from('workspace_invites').select('id, email, role, expires_at').eq('id', result.invite_id).single(),
      db.from('workspaces').select('name').order('created_at').limit(1).single(),
      db.from('profiles').select('full_name, email').ilike('email', actorEmail).maybeSingle(),
    ])
    if (invite) {
      const inviterName = (actor?.full_name || '').trim() || actor?.email || 'Gio OS'
      const rendered = renderMemberInviteEmail({
        recipient_name: invite.email.split('@')[0],
        workspace_name: ws?.name || 'your workspace',
        inviter_name: inviterName,
        inviter_initials: initialsOf(inviterName),
        inviter_color: colorOf(inviterName),
        role_label: ROLE_LABEL[invite.role] || invite.role,
        invite_url: `${APP_URL}/invite/${result.token}`,
        expiry_date: fmtExpiry(invite.expires_at),
      })
      const sent = await sendEmail(invite.email, rendered.subject, rendered.html, rendered.text)
      email_status = sent.ok ? 'sent' : 'failed'
      email_error = sent.ok ? null : sent.error
      await db.from('workspace_invites').update(
        sent.ok ? { email_status: 'sent', email_error: null } : { email_status: 'failed', email_error: sent.error },
      ).eq('id', invite.id)
    }
  }

  // The token is for the email only; it never goes back to the caller.
  const { token: _token, ...answer } = result
  return json({ ok: result.outcome !== 'refused', ...answer, email_status, email_error })
})
