// Notifications — Resend email delivery (server-only).
//
// This module must never be imported by a client component — it reads
// RESEND_API_KEY, a server-only secret. Sending is entirely optional: with no
// key configured, sendNotificationEmail() is a no-op that reports
// `configured: false` rather than throwing, so in-app notifications keep
// working even if email was never set up (same "static fallback is
// mandatory" spirit CLAUDE.md applies to every other live integration here).
//
// No SDK dependency — Resend's HTTP API is a single POST, so this uses the
// built-in fetch rather than adding the `resend` npm package for one call.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim()
}

function fromAddress(): string {
  return process.env.NOTIFICATION_EMAIL_FROM?.trim() || 'onboarding@resend.dev'
}

export interface SendEmailResult {
  ok: boolean
  configured: boolean
  sent: string[]
  failed: { email: string; error: string }[]
}

/** Never throws — a delivery failure is reported per-recipient, never blocks the caller (e.g. the monitoring cron must still complete even if email delivery is degraded). */
export async function sendNotificationEmail(
  recipients: string[],
  subject: string,
  html: string,
): Promise<SendEmailResult> {
  if (!isEmailConfigured()) return { ok: false, configured: false, sent: [], failed: [] }
  if (recipients.length === 0) return { ok: true, configured: true, sent: [], failed: [] }

  const apiKey = process.env.RESEND_API_KEY!.trim()
  const sent: string[] = []
  const failed: { email: string; error: string }[] = []

  // One request per recipient (not a single multi-"to" send) so one bad
  // address never blocks delivery to the others.
  for (const email of recipients) {
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddress(), to: [email], subject, html }),
      })
      if (res.ok) {
        sent.push(email)
      } else {
        const body = await res.text().catch(() => '')
        failed.push({ email, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` })
      }
    } catch (e) {
      failed.push({ email, error: e instanceof Error ? e.message.slice(0, 200) : 'unknown error' })
    }
  }

  return { ok: failed.length === 0, configured: true, sent, failed }
}
