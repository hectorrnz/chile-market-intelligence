// Phase 8D.1 — Dates-only FRED economic release calendar.
// Phase 8D.3 — additionally enriched with actual/previous values.
//
// GET /api/macro/fred-release-calendar?days=60
//
// Public, read-only (no auth — matches the other /api/macro* routes). Reads
// FRED_API_KEY server-side only; never returns the key or any raw FRED
// payload — only the sanitized event list built by resolveFredReleaseCalendar,
// enriched (Phase 8D.3) with actual/previous values derived from verified FRED
// time-series (never consensus/forecast/surprise). If FRED_API_KEY is not
// configured, returns `configured: false` and an empty list rather than
// erroring — the app must run fine with no key. Enrichment is best-effort: if
// the value fetches fail, the dates-only calendar still returns (metrics = []).

import { NextResponse } from 'next/server'
import { resolveFredReleaseCalendar } from '@/lib/providers/fredReleaseCalendar'
import { resolveCalendarEnrichment, type EnrichedFredCalendarEvent } from '@/lib/providers/calendarEnrichment'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const daysParam = parseInt(searchParams.get('days') ?? '60', 10)
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 180 ? daysParam : 60

  try {
    const result = await resolveFredReleaseCalendar(days)

    // Best-effort actual/previous enrichment. Any failure degrades to the
    // dates-only list (each event with an empty `metrics` array) — never throws.
    let events: EnrichedFredCalendarEvent[]
    try {
      events = result.ok ? await resolveCalendarEnrichment(result.events) : result.events.map((e) => ({ ...e, metrics: [] }))
    } catch {
      events = result.events.map((e) => ({ ...e, metrics: [] }))
    }

    return NextResponse.json({
      ok: result.ok,
      configured: result.configured,
      datesOnly: true,
      enriched: true,
      // Enrichment adds official actual/previous only; consensus/forecast are never produced.
      consensusAvailable: false,
      events,
      ...(result.reason ? { reason: result.reason } : {}),
    })
  } catch {
    return NextResponse.json(
      { ok: false, configured: false, datesOnly: true, enriched: false, consensusAvailable: false, events: [], reason: 'Internal error' },
      { status: 200 },
    )
  }
}
