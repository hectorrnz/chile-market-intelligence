// R13.6F — the invitation email: template, and an INJECTABLE send boundary.
//
// Reuses the existing Resend integration (`src/lib/notifications/emailProvider.ts`,
// a dependency-free POST to Resend's HTTP API) rather than adding a second mail
// path. What is new here is the seam: `sendInviteEmail` takes its transport as a
// parameter, so tests exercise the real template, the real recipient handling and
// the real failure propagation against an in-memory sender and never touch the
// network. §29 requires exactly that, and it is also the only way to assert the
// one property that matters most below.
//
// THE ACTION LINK IS A CREDENTIAL
// ───────────────────────────────
// `properties.action_link` from `generateLink` is a bearer token in URL form:
// anyone holding it can establish a session as the invited user. It must therefore
// never be logged, never be echoed in an API response, and never appear in an
// error message. `describeSendFailure` exists specifically so a failure can be
// reported without the caller being tempted to serialize the whole request. The
// tests assert the link is absent from every diagnostic string this module
// produces.

/** What the caller must supply to render an invitation. */
export interface InviteEmailInput {
  /** The invited person's address. The only place it is used. */
  readonly to: string
  /** Their display name, for the greeting. */
  readonly displayName: string
  /** The username they will sign in with — they cannot discover it otherwise. */
  readonly username: string
  /** The one-time Supabase action link. NEVER logged. */
  readonly actionLink: string
}

/** The transport seam. `sendNotificationEmail` satisfies this shape. */
export type InviteEmailTransport = (
  recipients: string[],
  subject: string,
  html: string,
) => Promise<{ ok: boolean; configured: boolean; sent: string[]; failed: { email: string; error: string }[] }>

export const INVITE_SUBJECT = 'Your Nevada Market Intelligence account'

/** Minimal HTML escaping — every interpolated value below is user-supplied. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The invitation body.
 *
 * Deliberately plain: no tracking pixel, no external image, no web font, no
 * remote CSS. A private family-office invitation should not phone anywhere, and
 * every one of those would also be a way for the action link to leak through a
 * referrer.
 *
 * The link is rendered ONCE, as both the href and the visible text, so a client
 * that strips anchors still shows something usable.
 */
export function renderInviteEmail(input: InviteEmailInput): string {
  const name = esc(input.displayName)
  const username = esc(input.username)
  // The href is NOT escaped with `esc` for the URL itself — it is placed in an
  // attribute, so only the quote and angle characters matter, which `esc` handles.
  const link = esc(input.actionLink)
  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;background:#f1f1f1;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;color:#231f20">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">',
    `<p style="margin:0 0 16px;font-size:15px">Hello ${name},</p>`,
    '<p style="margin:0 0 16px;font-size:15px;line-height:1.5">',
    'An account has been created for you on <strong>Nevada Market Intelligence</strong>. ',
    'Use the link below to set your password and finish activating it.',
    '</p>',
    `<p style="margin:0 0 20px;font-size:15px">Your username is <strong>${username}</strong>.</p>`,
    `<p style="margin:0 0 24px"><a href="${link}" `,
    'style="display:inline-block;background:#004a64;color:#ffffff;text-decoration:none;',
    'padding:11px 20px;border-radius:8px;font-size:15px">Set your password</a></p>',
    '<p style="margin:0 0 8px;font-size:12px;color:#5b6770">',
    'If the button does not work, copy this link into your browser:</p>',
    `<p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:#5b6770">${link}</p>`,
    '<p style="margin:0;font-size:12px;color:#5b6770;line-height:1.5">',
    'This link can be used once and will expire. If you were not expecting this ',
    'invitation, you can ignore this message.</p>',
    '</div></body></html>',
  ].join('')
}

/** The outcome of an invitation send. Never carries the action link. */
export interface InviteSendResult {
  /** True only when the message was actually accepted for delivery. */
  readonly sent: boolean
  /** False when no RESEND_API_KEY is configured in this environment. */
  readonly configured: boolean
  /** A short, link-free reason. Null when `sent` is true. */
  readonly failure: string | null
}

/**
 * Renders and sends the invitation.
 *
 * HONEST ABOUT FAILURE (§13). An unconfigured or refused send returns
 * `sent: false` with a reason; it never returns success. The caller surfaces that
 * to the administrator as "invited, email not delivered — resend", which is a real
 * and recoverable state, rather than reporting a delivery that did not happen.
 */
export async function sendInviteEmail(
  input: InviteEmailInput,
  transport: InviteEmailTransport,
): Promise<InviteSendResult> {
  const to = input.to.trim()
  if (!to) return { sent: false, configured: true, failure: 'missing_recipient' }

  let result: Awaited<ReturnType<InviteEmailTransport>>
  try {
    result = await transport([to], INVITE_SUBJECT, renderInviteEmail(input))
  } catch (e) {
    return { sent: false, configured: true, failure: describeSendFailure(e) }
  }

  if (!result.configured) return { sent: false, configured: false, failure: 'email_not_configured' }
  if (result.sent.length > 0 && result.failed.length === 0) {
    return { sent: true, configured: true, failure: null }
  }
  return {
    sent: false,
    configured: true,
    failure: describeSendFailure(result.failed[0]?.error ?? 'delivery_failed'),
  }
}

/**
 * Reduces any thrown value to a short, safe reason string.
 *
 * Caps the length and strips anything URL-shaped, because a transport error can
 * echo the request it failed on — and that request contains the action link.
 * Belt and braces: the link is not passed to the transport as a separate field,
 * but a provider that quotes the body back would otherwise leak it into a log.
 */
export function describeSendFailure(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown_error'
  return raw.replace(/https?:\/\/\S+/gi, '[link]').slice(0, 120)
}
