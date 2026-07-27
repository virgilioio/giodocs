// Gio Docs — workspace invite email template.
// Small, self-contained HTML with inline styles + plain text alternative.
// Uses only HTML-escaped merge tokens; safe for arbitrary names/messages.

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMemberInviteEmail(
  vars: MemberInviteVars,
): RenderedMemberInviteEmail {
  const inviterName = vars.inviter_name?.trim() || "a teammate";
  const s = {
    recipient_name: escapeHtml(vars.recipient_name),
    workspace_name: escapeHtml(vars.workspace_name),
    inviter_name: escapeHtml(inviterName),
    inviter_initials: escapeHtml(vars.inviter_initials),
    inviter_color: escapeHtml(vars.inviter_color),
    role_label: escapeHtml(vars.role_label),
    invite_url: encodeURI(vars.invite_url),
    invite_url_text: escapeHtml(vars.invite_url),
    expiry_date: escapeHtml(vars.expiry_date),
  };

  const subject = `${inviterName} invited you to ${vars.workspace_name} on Gio Docs`;
  const preheader = `Join ${vars.workspace_name} on Gio Docs`;

  const messageBlock = vars.personal_message?.trim()
    ? `<tr><td style="padding:0 32px 8px 32px;">
        <div style="border-left:3px solid #E5E1D8;padding:6px 0 6px 14px;color:#4A4A44;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(vars.personal_message.trim())}</div>
      </td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F7F4EE;font-family:'Helvetica Neue',Arial,sans-serif;color:#1F1F1B;">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F4EE;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFCF7;border:1px solid #EDE7DA;border-radius:16px;">
      <tr><td style="padding:26px 32px 0 32px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#8A8377;">Gio Docs · Members</div>
        <h1 style="margin:14px 0 6px 0;font-family:'Poppins','Helvetica Neue',Arial,sans-serif;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:#1F1F1B;">Join ${s.workspace_name} on Gio Docs</h1>
        <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:#4A4A44;">Hi ${s.recipient_name}, ${s.inviter_name} invited you to collaborate on pages, views, and areas in ${s.workspace_name}.</p>
      </td></tr>
      <tr><td style="padding:0 32px 16px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #EDE7DA;border-radius:12px;">
          <tr><td style="padding:16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="padding-right:12px;vertical-align:middle;">
                <div style="width:40px;height:40px;border-radius:9999px;background:${s.inviter_color};color:#fffcf9;font-weight:700;font-size:14px;line-height:40px;text-align:center;letter-spacing:-0.01em;">${s.inviter_initials}</div>
              </td>
              <td style="vertical-align:middle;">
                <div style="font-size:14px;font-weight:700;color:#1F1F1B;">${s.inviter_name}</div>
                <div style="font-size:12.5px;color:#6A6459;">invited you as <strong style="color:#1F1F1B;font-weight:600;">${s.role_label}</strong></div>
              </td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>
      ${messageBlock}
      <tr><td style="padding:8px 32px 8px 32px;">
        <a href="${s.invite_url}" style="display:inline-block;background:#1F1F1B;color:#FFFCF7;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:10px;">Accept invitation</a>
      </td></tr>
      <tr><td style="padding:8px 32px 26px 32px;">
        <p style="margin:0;font-size:12.5px;color:#8A8377;line-height:1.55;">This invitation expires on ${s.expiry_date}. If the button doesn't work, paste this link:<br /><span style="color:#4A4A44;word-break:break-all;">${s.invite_url_text}</span></p>
      </td></tr>
    </table>
    <div style="margin-top:18px;font-size:11.5px;color:#8A8377;">Gio Docs · one object · many views</div>
  </td></tr>
</table></body></html>`;

  const text = [
    `${inviterName} invited you to ${vars.workspace_name} on Gio Docs.`,
    "",
    `Role: ${vars.role_label}`,
    vars.personal_message?.trim() ? `\nMessage:\n${vars.personal_message.trim()}\n` : "",
    `Accept: ${vars.invite_url}`,
    `Expires: ${vars.expiry_date}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
