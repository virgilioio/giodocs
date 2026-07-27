## What the data says

The latest invite row for `javier@virgilio.tech` (2026‑07‑27 18:28 UTC) is `email_status = sent`, `email_error = null`. That means Resend's API accepted the send — our edge function did its job. The email is being lost **after** hand‑off to Resend, so the fix is not in our code path. Edge function logs also show only boot/shutdown, no runtime errors.

## Most likely causes, in order

1. **Delivered but filtered** — landed in Spam / Promotions / a Google Groups quarantine on the recipient side. Very common for a brand‑new sender domain.
2. **Async bounce after Resend accepted** — recipient's mail server rejected on delivery. Our code only records the synchronous API result, so a later bounce leaves `email_status = 'sent'` misleadingly. Resend's dashboard will show `bounced` for the message.
3. **SPF/DKIM/DMARC not fully aligned** on `docs.gogio.io` even though the domain shows "verified" in Resend. Strict receivers (Google Workspace especially) can still drop mail if DMARC alignment fails.
4. **Recipient address on Resend's suppression list** from an earlier bounce/complaint — Resend then silently drops future sends to that address. Also visible in the Resend dashboard.

## What I need you to check (2 minutes, no code)

Open Resend → Emails, find the message to `javier@virgilio.tech` at 18:28 UTC and report its final status: `Delivered`, `Bounced`, `Complained`, or still `Sent`. Also check Resend → Suppressions for that address. That single lookup tells us which of the four causes it is; every fix below depends on which one.

Also ask Javier to check Spam / All Mail / Promotions and search for `docs.gogio.io`.

## Then, depending on the answer

- **Delivered in Resend, missing in inbox** → cause 1. Nothing to fix in code. Ask him to mark as "Not spam" and add `noreply@docs.gogio.io` to contacts. If it's a Google Workspace tenant, a workspace admin can allowlist the domain.
- **Bounced** → cause 2 or 3. Read the bounce reason string in Resend; it names the receiver's rule. Then re‑check DNS: SPF (`v=spf1 include:...`), DKIM CNAMEs, and a DMARC record on `docs.gogio.io` or `gogio.io`. If DMARC is `p=reject` without alignment, Google will drop it.
- **On suppression list** → remove him from Resend → Suppressions, then resend from our app. He'll receive it.
- **Still "Sent" after 10+ min** → Resend is stuck; open a Resend support ticket with the message id.

## Small code follow‑ups (only after we know the cause, not now)

- Add a Resend webhook → edge function → update `workspace_invites.email_status` to `bounced` / `complained` so the settings UI stops claiming these invites were delivered. Optional; only worth building if bounces become a recurring class of failure.
- Nothing else in our code changes.

## Not in scope

Changing the email template, the send path, the accept flow, DNS records, or the `workspace_invites` schema. This is a delivery diagnosis, not a rebuild.
