// Phase 8D.1 — Dates-only FRED economic release calendar.
//
// GET /api/macro/fred-release-calendar?days=60
//
// Public, read-only (no auth — matches the other /api/macro* routes). Reads
// FRED_API_KEY server-side only; never returns the key or any raw FRED
// payload — only the sanitized event list built by resolveFredReleaseCalendar.
// If FRED_API_KEY is not configured, returns `configured: false` and an empty
// list rather than erroring — the app must run fine with no key.

import { NextResponse } from 'next/server'
import { resolveFredReleaseCalendar } from '@/lib/providers/fredReleaseCalendar'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const daysParam = parseInt(searchParams.get('days') ?? '60', 10)
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 180 ? daysParam : 60

  try {
    const result = await resolveFredReleaseCalendar(days)
    return NextResponse.json({
      ok: result.ok,
      configured: result.configured,
      datesOnly: true,
      events: result.events,
      ...(result.reason ? { reason: result.reason } : {}),
    })
  } catch {
    return NextResponse.json(
      { ok: false, configured: false, datesOnly: true, events: [], reason: 'Internal error' },
      { status: 200 },
    )
  }
}
