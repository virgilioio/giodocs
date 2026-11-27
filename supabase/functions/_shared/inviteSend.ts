// Gio Docs - sending a workspace invitation email (2026-11-27).
// Shared by os-provision (a grant or resend from People & Access) and
// invite-renew (the person asking for a new link from an expired one), so both
// send the same email. Keep this file ASCII only: the deploy tool rewrites
// escape sequences.
import { renderMemberInviteEmail } from './memberInviteEmail.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const APP_URL = (Deno.env.get('APP_URL') || 'https://docs.gogio.io').replace(/\/+$/, '')
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'Gio Docs <noreply@docs.gogio.io>'
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', member: 'Member' }
const AVATAR_PALETTE = ['#6F3FF5', '#12B886', '#E8590C', '#1C7ED6', '#D6336C', '#4C6EF5', '#F59F00', '#0CA678']

/** The address a link opens. */
export const inviteUrl = (token: string) => `${APP_URL}/invite/${token}`

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

/**
 * Emails one invitation with the link for `token`, signed by whoever asks
 * (`inviterEmail`), else by whoever invited them. Records the send on the
 * invitation. Answers whether the email went out.
 */
export async function sendInviteEmail(
  db: Db,
  inviteId: string,
  token: string,
  inviterEmail?: string | null,
): Promise<{ status: 'sent' | 'failed'; error: string | null }> {
  const { data: invite } = await db.from('workspace_invites').select('id, email, role, expires_at, invited_by').eq('id', inviteId).single()
  if (!invite) return { status: 'failed', error: 'The invitation is gone.' }
  const [{ data: ws }, { data: actor }] = await Promise.all([
    db.from('workspaces').select('name').order('created_at').limit(1).single(),
    inviterEmail
      ? db.from('profiles').select('full_name, email').ilike('email', inviterEmail).maybeSingle()
      : db.from('profiles').select('full_name, email').eq('id', invite.invited_by).maybeSingle(),
  ])
  const inviterName = (actor?.full_name || '').trim() || actor?.email || 'Gio OS'
  const rendered = renderMemberInviteEmail({
    recipient_name: invite.email.split('@')[0],
    workspace_name: ws?.name || 'your workspace',
    inviter_name: inviterName,
    inviter_initials: initialsOf(inviterName),
    inviter_color: colorOf(inviterName),
    role_label: ROLE_LABEL[invite.role] || invite.role,
    invite_url: inviteUrl(token),
    expiry_date: fmtExpiry(invite.expires_at),
  })
  const sent = await sendEmail(invite.email, rendered.subject, rendered.html, rendered.text)
  await db.from('workspace_invites').update(
    sent.ok ? { email_status: 'sent', email_error: null } : { email_status: 'failed', email_error: sent.error },
  ).eq('id', invite.id)
  return sent.ok ? { status: 'sent', error: null } : { status: 'failed', error: sent.error }
}
