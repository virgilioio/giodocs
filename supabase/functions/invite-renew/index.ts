// Gio Docs - invite-renew (public: the invitee has no account yet), 2026-11-27.
// POST { token } from the invite page's "Email me a new link" on an expired
// invitation. invite_renew_request() gives the invitation a new link with 7 days
// (the expired link stops opening it) and this emails the new link to the
// invited address only, so nothing comes back to the caller but a state:
// renewed, valid, expired (the email failed), accepted, revoked, not_found.
// Keep this file ASCII only: the deploy tool rewrites escape sequences.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendInviteEmail } from '../_shared/inviteSend.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let p: Record<string, unknown>
  try { p = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const token = String(p.token ?? '')
  if (!UUID.test(token)) return json({ state: 'not_found' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.rpc('invite_renew_request', { p_token: token })
  if (error) return json({ error: "We couldn't renew this invitation. Try again." }, 500)
  const r = data as { state: string; invite_id?: string; token?: string }
  if (r.state !== 'renewed' || !r.invite_id || !r.token) return json({ state: r.state })

  const sent = await sendInviteEmail(db, r.invite_id, r.token)
  if (sent.status !== 'sent') {
    return json({ state: 'expired', error: "The new link couldn't be emailed. Try again in a minute." }, 502)
  }
  return json({ state: 'renewed' })
})
