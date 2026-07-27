// Gio Docs — workspace invite email template.
//
// Shell mirrors the Gio ATS member-invite email (560px cream card, masthead,
// preview card, "What's next", CTA, secure-expiry line, footer) but recoloured
// to the Gio Docs cream / noir palette and rewritten with Gio Docs copy.
//
// The caller (`send-workspace-invite/index.ts`) already provides every field
// the template consumes; no signature changes there.

export interface MemberInviteVars {
  recipient_name: string;
  workspace_name: string;
  inviter_name: string;
  inviter_initials: string;
  inviter_color: string;
  role_label: string;
  invite_url: string;
  expiry_date: string;
  personal_message?: string;
}

export interface RenderedMemberInviteEmail {
  subject: string;
  html: string;
  text: string;
}

const LOGO_URL = "https://docs.gogio.io/gio-docs-logo.svg";

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function merge(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    key in vars ? vars[key] : `{{${key}}}`,
  );
}

export function renderMemberInviteEmail(
  vars: MemberInviteVars,
): RenderedMemberInviteEmail {
  const inviterName = vars.inviter_name?.trim() || "a teammate";
  const recipientName = vars.recipient_name?.trim() || "there";

  const safe: Record<string, string> = {
    recipient_name: escapeHtml(recipientName),
    workspace_name: escapeHtml(vars.workspace_name),
    inviter_name: escapeHtml(inviterName),
    inviter_initials: escapeHtml(vars.inviter_initials),
    inviter_color: escapeHtml(vars.inviter_color),
    role_label: escapeHtml(vars.role_label),
    invite_url: encodeURI(vars.invite_url),
    invite_url_text: escapeHtml(vars.invite_url),
    expiry_date: escapeHtml(vars.expiry_date),
    logo_url: LOGO_URL,
  };

  const subject = `${inviterName} invited you to ${vars.workspace_name} on Gio Docs`;
  const preheader = `Join ${vars.workspace_name} on Gio Docs`;

  const trimmedMessage = vars.personal_message?.trim() ?? "";
  const messageBlockHtml = trimmedMessage
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
        <tr><td style="border-left:3px solid #EDE7DA;padding:4px 0 4px 14px;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#1F1F1B;white-space:pre-wrap;">${escapeHtml(trimmedMessage)}</td></tr>
      </table>`
    : "";

  const avatarBlock = `<div style="width:40px;height:40px;border-radius:9999px;background:${safe.inviter_color};color:#fffcf9;font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:14px;line-height:40px;text-align:center;letter-spacing:-0.01em;">${safe.inviter_initials}</div>`;

  const html = merge(BODY_TEMPLATE, {
    ...safe,
    subject: escapeHtml(subject),
    preheader: escapeHtml(preheader),
    avatar_block: avatarBlock,
    message_block: messageBlockHtml,
  });

  const text = renderText({ ...vars, recipient_name: recipientName, inviter_name: inviterName });

  return { subject, html, text };
}

function renderText(vars: MemberInviteVars): string {
  const lines = [
    `You've been invited to join ${vars.workspace_name} on Gio Docs.`,
    "",
    `Hi ${vars.recipient_name} — ${vars.inviter_name} invited you to collaborate on pages, views, and areas in ${vars.workspace_name}.`,
    "",
    `Your role: ${vars.role_label}`,
    "",
  ];
  const msg = vars.personal_message?.trim();
  if (msg) {
    lines.push(`Message from ${vars.inviter_name}:`, msg, "");
  }
  lines.push(
    "What's next:",
    "1. Accept your invitation with the link below",
    "2. Sign in with your workspace email",
    "3. Start writing and organising pages",
    "",
    "Accept your invitation:",
    vars.invite_url,
    "",
    `Your invitation is secure and expires on ${vars.expiry_date}.`,
    "",
    "If you weren't expecting this invitation, you can safely ignore this email.",
  );
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// HTML template. Cream / noir palette. No purple.
// ---------------------------------------------------------------------------

const BODY_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>{{subject}}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet" />
    <style>
      @media only screen and (max-width: 600px) {
        .gio-card { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; }
        .gio-pad-40 { padding-left: 24px !important; padding-right: 24px !important; }
        .gio-headline { font-size: 26px !important; line-height: 1.15 !important; }
        .gio-mast-right { text-align: right !important; }
      }
      @media (prefers-color-scheme: dark) {
        body, .gio-desk { background: #ECEAE2 !important; }
      }
      a { color: #0d0d09; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#ECEAE2;-webkit-text-size-adjust:100%;">
    <div style="display:none;font-size:1px;color:#ECEAE2;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{{preheader}}</div>
    <table role="presentation" class="gio-desk" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ECEAE2" style="background:#ECEAE2;">
      <tr>
        <td align="center" style="padding:40px 20px;">
          <table role="presentation" class="gio-card" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:#FFFCF7;border-radius:20px;box-shadow:0 12px 32px -8px rgba(13,13,9,0.08);overflow:hidden;">
            <!-- MASTHEAD -->
            <tr>
              <td class="gio-pad-40" style="padding:26px 40px;border-bottom:1px solid #F1F0EC;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="left" valign="middle">
                      <img src="{{logo_url}}" height="22" alt="Gio Docs" style="display:block;height:22px;width:auto;border:0;outline:none;text-decoration:none;" />
                    </td>
                    <td align="right" valign="middle" class="gio-mast-right">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block;">
                        <tr>
                          <td valign="middle" style="background:#0d0d09;border-radius:9999px;padding:6px 12px 6px 10px;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:11.5px;font-weight:600;letter-spacing:0.02em;color:#fffcf9;">
                            <span style="display:inline-block;width:14px;height:14px;line-height:14px;text-align:center;color:#fffcf9;font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-weight:700;font-size:14px;vertical-align:middle;margin-right:4px;">+</span><span style="vertical-align:middle;">Members</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- BODY -->
            <tr>
              <td class="gio-pad-40" style="padding:38px 40px 34px;">
                <p style="margin:0 0 14px;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-weight:600;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#0d0d09;">You've been invited</p>
                <h1 class="gio-headline" style="margin:0 0 16px;font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:30px;line-height:1.12;letter-spacing:-0.035em;color:#0d0d09;">
                  Join {{workspace_name}} on Gio Docs.
                </h1>
                <p style="margin:0 0 26px;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:14.5px;line-height:1.62;color:#4A4A44;">
                  Hi <strong style="color:#0d0d09;font-weight:600;">{{recipient_name}}</strong> — <strong style="color:#0d0d09;font-weight:600;">{{inviter_name}}</strong> invited you to collaborate on pages, views, and areas in <strong style="color:#0d0d09;font-weight:600;">{{workspace_name}}</strong>.
                </p>

                {{message_block}}

                <!-- PREVIEW CARD -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #EDE7DA;border-radius:16px;box-shadow:0 4px 14px -6px rgba(13,13,9,0.06);margin:0 0 28px;">
                  <tr>
                    <td style="padding:18px;">
                      <!-- Header row -->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #F1F0EC;padding-bottom:15px;">
                        <tr>
                          <td width="52" valign="middle" style="width:52px;padding-bottom:15px;">{{avatar_block}}</td>
                          <td valign="middle" style="font-family:'Poppins','Helvetica Neue',Arial,sans-serif;padding-bottom:15px;">
                            <div style="font-weight:600;font-size:13.5px;color:#0d0d09;letter-spacing:-0.01em;line-height:1.2;">{{inviter_name}}</div>
                            <div style="font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-weight:400;font-size:11.5px;color:#8B8F9E;margin-top:2px;">{{workspace_name}}</div>
                          </td>
                          <td align="right" valign="middle" style="white-space:nowrap;padding-bottom:15px;">
                            <span style="display:inline-block;background:#F1F0EC;color:#0d0d09;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:9999px;line-height:1.4;">
                              Role · {{role_label}}
                            </span>
                          </td>
                        </tr>
                      </table>

                      <!-- What's next -->
                      <p style="margin:15px 0 12px;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-weight:600;font-size:10.5px;letter-spacing:0.07em;text-transform:uppercase;color:#8B8F9E;">What's next</p>

                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="30" valign="top" style="width:30px;padding-bottom:10px;">
                            <div style="width:22px;height:22px;border-radius:9999px;background:#0d0d09;color:#fffcf9;font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:11.5px;line-height:22px;text-align:center;">1</div>
                          </td>
                          <td valign="middle" style="padding-bottom:10px;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.5;color:#1F1F1B;">
                            Accept your invitation with the button below
                          </td>
                        </tr>
                        <tr>
                          <td width="30" valign="top" style="width:30px;padding-bottom:10px;">
                            <div style="width:22px;height:22px;border-radius:9999px;background:#0d0d09;color:#fffcf9;font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:11.5px;line-height:22px;text-align:center;">2</div>
                          </td>
                          <td valign="middle" style="padding-bottom:10px;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.5;color:#1F1F1B;">
                            Sign in with your workspace email
                          </td>
                        </tr>
                        <tr>
                          <td width="30" valign="top" style="width:30px;">
                            <div style="width:22px;height:22px;border-radius:9999px;background:#0d0d09;color:#fffcf9;font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:11.5px;line-height:22px;text-align:center;">3</div>
                          </td>
                          <td valign="middle" style="font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.5;color:#1F1F1B;">
                            Start writing and organising pages
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- CTA -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 15px;">
                  <tr>
                    <td bgcolor="#0d0d09" style="border-radius:12px;box-shadow:0 6px 16px -6px rgba(13,13,9,0.35);">
                      <a href="{{invite_url}}" style="display:inline-block;padding:15px 26px;font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:15px;color:#fffcf9;text-decoration:none;line-height:20px;letter-spacing:-0.005em;">
                        Accept invitation&nbsp;&nbsp;→
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 22px;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:12px;color:#8B8F9E;line-height:1.5;">
                  <span style="display:inline-block;vertical-align:middle;margin-right:6px;">🔒</span>Your invitation is secure and expires on <strong style="color:#4A4A44;font-weight:600;">{{expiry_date}}</strong>.
                </p>

                <p style="margin:0;font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-size:11.5px;color:#8B8F9E;line-height:1.5;">
                  If you weren't expecting this invitation, you can safely ignore this email — it expires automatically on {{expiry_date}}.
                </p>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td class="gio-pad-40" bgcolor="#FBFAF7" style="padding:22px 40px 30px;background:#FBFAF7;border-top:1px solid #F1F0EC;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="left" style="font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:13px;color:#0d0d09;letter-spacing:-0.02em;">
                      <span style="vertical-align:middle;">Gio Docs</span><span style="display:inline-block;vertical-align:middle;width:4px;height:4px;background:#0d0d09;border-radius:9999px;margin-left:3px;"></span>
                      <span style="font-family:'Inter',-apple-system,'Segoe UI',Arial,sans-serif;font-weight:400;font-size:11.5px;color:#8B8F9E;margin-left:6px;">· Pages, views, and areas</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
