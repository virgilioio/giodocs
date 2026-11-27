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
// A resend keeps the same link and gives it 7 more days (2026-11-27).
// Kind 'invite' (2026-11-27) is People & Access asking about one person's
// invitation: { kind: 'invite', action: 'status' | 'link' | 'renew', email,
// actor_email }. 'link' answers the invitation's link (url) to hand over
// directly, 'renew' extends it 7 days; both only for an owner here.
// Keep this file ASCII only: the deploy tool rewrites escape sequences.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendInviteEmail, inviteUrl } from '../_shared/inviteSend.ts'

const MAX_SKEW_SECONDS = 300
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

  // One person's invitation, asked by People & Access (2026-11-27).
  if (p.kind === 'invite') {
    const action = String(p.action ?? '')
    const iEmail = String(p.email ?? '').trim().toLowerCase()
    const iActor = String(p.actor_email ?? '').trim().toLowerCase()
    if (!['status', 'link', 'renew'].includes(action)) return json({ error: 'Unknown invitation action.' }, 400)
    if (!iEmail || !iActor) return json({ error: 'email and actor_email are required.' }, 400)
    const idb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await idb.rpc('os_invite_action', { p_email: iEmail, p_actor_email: iActor, p_action: action })
    if (error) return json({ error: error.message, code: error.code }, 400)
    const { token, ...r } = data as Record<string, unknown>
    return json({ ok: r.outcome !== 'refused', ...r, url: typeof token === 'string' ? inviteUrl(token) : null })
  }
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
    const sent = await sendInviteEmail(db, result.invite_id, result.token, actorEmail)
    email_status = sent.status
    email_error = sent.error
  }

  // The token is for the email only; it never goes back to the caller.
  const { token: _token, ...answer } = result
  return json({ ok: result.outcome !== 'refused', ...answer, email_status, email_error })
})
