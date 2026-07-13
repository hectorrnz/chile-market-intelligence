// Phase 8D.3 — Weekday post-close calendar-enrichment refresh.
//
// Scheduled `30 22 * * 1-5` (vercel.json) — ~30 min after the US market close
// (16:00 ET → 20:00/21:00 UTC across DST) so macro data published during the
// day is picked up. Protected by Bearer CRON_SECRET (same pattern as every
// other cron route). Also invocable manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/refresh-calendar-enrichment
//
// Calendar enrichment is STATELESS this phase (no persistence — see
// docs/macro_market_source_coverage.md §11), so this run recomputes the
// enrichment against FRED and returns a structured availability/health summary
// rather than writing rows. It never returns the FRED key or any raw payload —
// only sanitized counts. Provider errors are isolated: a failed value fetch
// degrades to `unavailable` and yields `partial_success`, never a crash.

import { NextResponse } from 'next/server'
import { resolveFredReleaseCalendar } from '@/lib/providers/fredReleaseCalendar'
import { resolveCalendarEnrichment, summarizeEnrichment } from '@/lib/providers/calendarEnrichment'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'Cron not configured — CRON_SECRET missing' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  try {
    const cal = await resolveFredReleaseCalendar(60)
    if (!cal.configured) {
      return NextResponse.json({ status: 'not_configured', reason: 'FRED release calendar key not configured', startedAt, finishedAt: new Date().toISOString() })
    }
    if (!cal.ok) {
      return NextResponse.json({ status: 'failure', reason: 'FRED release calendar unavailable', startedAt, finishedAt: new Date().toISOString() })
    }

    const enriched = await resolveCalendarEnrichment(cal.events)
    const summary = summarizeEnrichment(enriched)

    // success = every metric resolved to a real published/pending value;
    // partial_success = some metrics were unavailable (a provider gap);
    // failure = nothing resolved.
    const resolved = summary.published + summary.pending
    const status = summary.metricsTotal === 0
      ? 'failure'
      : summary.unavailable === 0
        ? 'success'
        : resolved > 0
          ? 'partial_success'
          : 'failure'

    return NextResponse.json({
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      persisted: false, // stateless: this run validates/refreshes availability, it does not write
      summary,
    })
  } catch {
    return NextResponse.json({ status: 'failure', reason: 'Enrichment refresh failed', startedAt, finishedAt: new Date().toISOString() }, { status: 500 })
  }
}
