// Phase 8D.1 — Dates-only FRED economic release calendar.
// Phase 8D.3 — additionally enriched with actual/previous values.
//
// GET /api/macro/fred-release-calendar?days=60
// GET /api/macro/fred-release-calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Public, read-only (no auth — matches the other /api/macro* routes). Reads
// FRED_API_KEY server-side only; never returns the key or any raw FRED
// payload — only the sanitized event list built by resolveFredReleaseCalendar,
// enriched (Phase 8D.3) with actual/previous values derived from verified FRED
// time-series (never consensus/forecast/surprise). If FRED_API_KEY is not
// configured, returns `configured: false` and an empty list rather than
// erroring — the app must run fine with no key. Enrichment is best-effort: if
// the value fetches fail, the dates-only calendar still returns (metrics = []).
//
// `start`/`end` (both must be valid YYYY-MM-DD) take precedence over `days` —
// used by the Macro page's "current month" calendar embed, which needs an
// explicit window (e.g. the 1st through the last day of the current month)
// rather than the `days`-based rolling window /macro/calendar uses.

import { NextResponse } from 'next/server'
import { resolveFredReleaseCalendar, resolveFredReleaseCalendarRange } from '@/lib/providers/fredReleaseCalendar'
import { resolveCalendarEnrichment, type EnrichedFredCalendarEvent } from '@/lib/providers/calendarEnrichment'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  try {
    const result = start && end && ISO_DATE.test(start) && ISO_DATE.test(end)
      ? await resolveFredReleaseCalendarRange(start, end)
      : await resolveFredReleaseCalendar((() => {
          const daysParam = parseInt(searchParams.get('days') ?? '60', 10)
          return Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 180 ? daysParam : 60
        })())

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
