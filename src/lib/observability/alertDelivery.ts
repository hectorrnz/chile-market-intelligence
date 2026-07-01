// Phase 5D.1 — Alert delivery via generic webhook.
// SERVER-ONLY. Never called from client components.
// ALERTS_ENABLED must be 'true' for any delivery to occur.
// Missing env vars log nothing and return false — never crash the caller.

import type { OverallHealthResult } from './ingestionHealth'
import { formatHealthSummary } from './ingestionHealth'

export interface AlertDeliveryResult {
  sent: boolean
  suppressed: boolean
  reason?: string
}

/**
 * Deliver an alert webhook if ALERTS_ENABLED=true and the overall health is
 * not 'healthy'. Returns a sanitized result — never logs secrets.
 */
export async function deliverAlertIfNeeded(
  result: OverallHealthResult,
  opts?: { force?: boolean; dryRun?: boolean },
): Promise<AlertDeliveryResult> {
  const enabled = process.env.ALERTS_ENABLED?.trim().toLowerCase() === 'true'
  if (!enabled && !opts?.force) {
    return { sent: false, suppressed: true, reason: 'ALERTS_ENABLED is not true' }
  }

  if (result.overallStatus === 'healthy' && !opts?.force) {
    return { sent: false, suppressed: false, reason: 'Status is healthy — no alert needed' }
  }

  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim()
  if (!webhookUrl) {
    return { sent: false, suppressed: true, reason: 'ALERT_WEBHOOK_URL not configured' }
  }

  if (opts?.dryRun) {
    return { sent: false, suppressed: false, reason: 'dry-run mode — webhook not called' }
  }

  return await postWebhook(webhookUrl, result)
}

async function postWebhook(
  webhookUrl: string,
  result: OverallHealthResult,
): Promise<AlertDeliveryResult> {
  const secret = process.env.ALERT_WEBHOOK_SECRET?.trim()
  const summary = formatHealthSummary(result)

  // Provider-agnostic JSON payload. Compatible with Slack incoming webhooks
  // (text field) and most generic webhook receivers.
  const payload = {
    text: summary,
    status: result.overallStatus,
    generatedAt: result.generatedAt,
    alertCount: result.alerts.length,
    alerts: result.alerts.map(a => ({
      severity: a.severity,
      code: a.code,
      message: a.message,
    })),
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (secret) {
    headers['Authorization'] = `Bearer ${secret}`
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) {
      // Return non-revealing error — don't include webhookUrl or secret in output
      return { sent: false, suppressed: false, reason: `Webhook returned HTTP ${res.status}` }
    }

    return { sent: true, suppressed: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown network error'
    return { sent: false, suppressed: false, reason: `Webhook delivery failed: ${msg}` }
  }
}
