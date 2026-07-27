## Goal

Rebrand the workspace invite email to match the Gio ATS invite design — same 560px cream card, Poppins/Inter typography, masthead + kicker + headline + preview card + "What's next" + CTA + secure-expiry line + footer — but in Gio Docs's cream/noir palette (no purple), with the Gio Docs SVG logo in the masthead and Gio Docs copy throughout.

Scope: one file. Nothing else changes.

## Files changed

- `supabase/functions/_shared/memberInviteEmail.ts` — rewritten to the ATS shell adapted for Gio Docs.

Not touched: `send-workspace-invite/index.ts` (the existing call signature already provides every variable the new template needs — `recipient_name`, `workspace_name`, `inviter_name`, `inviter_initials`, `inviter_color`, `role_label`, `invite_url`, `expiry_date`, `personal_message`), the DB, the client, secrets, or `AGENTS.md` scope. No new dependencies. Redeploy is one command after the change lands.

## Design decisions (locked from your answers)

- **Palette — cream / noir only.** Background `#ECEAE2`, card `#FFFCF7`, ink `#0d0d09`, prose `#4A4A44`, meta `#8B8F9E`, hairlines `#F1F0EC` / `#EDE7DA`. No purple anywhere: kicker text becomes ink, the wordmark dot / role pill / step badges / CTA use noir on cream (same treatment ATS uses for its dark CTA), links use ink underline.
- **Masthead logo — SVG from `https://docs.gogio.io/gio-docs-logo.svg`**, rendered as `<img height="22" alt="Gio Docs">`. Right side keeps the ATS "Members" badge, restyled as a noir chip (`#0d0d09` bg / `#fffcf9` text) with a small `+` glyph — matches the login and app tone.
- **Footer — no help line.** Left: small Gio Docs wordmark (Poppins, same treatment as ATS) with the tagline "· Pages, views, and areas". Right side empty.

## Copy (Gio Docs, not ATS)

- Subject: `{{inviter_name}} invited you to {{workspace_name}} on Gio Docs`
- Preheader: `Join {{workspace_name}} on Gio Docs`
- Kicker: `YOU'VE BEEN INVITED`
- Headline: `Join {{workspace_name}} on Gio Docs.` (period is ink, no purple accent)
- Intro: `Hi {{recipient_name}} — {{inviter_name}} invited you to collaborate on pages, views, and areas in {{workspace_name}}.`
- Role pill: `Role · {{role_label}}`
- What's next:
  1. `Accept your invitation with the button below`
  2. `Sign in with your workspace email`
  3. `Start writing and organising pages`
- CTA: `Accept invitation  →`
- Secure line: `🔒 Your invitation is secure and expires on {{expiry_date}}.`
- Ignore line: `If you weren't expecting this invitation, you can safely ignore this email — it expires automatically on {{expiry_date}}.`
- Footer tagline: `Gio Docs · Pages, views, and areas`

## Personal message

The current caller passes `personal_message` (optional). Preserved: when present, render it as an inset quote block **above** the preview card — 3px left border in `#EDE7DA`, ink text, `white-space: pre-wrap`, HTML-escaped. When absent, the block is omitted.

## Template signature

Function stays `renderMemberInviteEmail(vars) → { subject, html, text }`. Field names match what `send-workspace-invite/index.ts` already passes today. `inviter_title` and `support_email` from the ATS version are dropped (unused).

## Text alternative

Rewritten to the Gio Docs copy (workspace, pages/views/areas, no "recruiting", no support email line). Includes the personal message when set.

## After the change

Run `supabase functions deploy send-workspace-invite` once. No DB migration, no secrets, no client change.
