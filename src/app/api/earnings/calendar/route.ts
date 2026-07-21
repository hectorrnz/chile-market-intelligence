// GET /api/earnings/calendar
// Live CMF earnings (EEFF-sending-date) calendar for the app's tracked tickers.
// Server-cached for 6h per warm instance, so it auto-refreshes on cache expiry
// / cold start — no manual step and no cron needed. Always returns 200 with a
// status envelope so the UI never breaks (and never shows a fabricated date).

import { NextResponse } from 'next/server'
import {
  resolveEarningsCalendar,
  type EarningsCalendarResult,
} from '@/lib/providers/earnings/earningsCalendarProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

let cache: { at: number; data: EarningsCalendarResult } | null = null

export async function GET() {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS && cache.data.status === 'live') {
    return NextResponse.json(cache.data)
  }
  try {
    const data = await resolveEarningsCalendar()
    // Only cache a genuinely live result — never pin an 'unavailable' fetch.
    if (data.status === 'live') cache = { at: now, data }
    return NextResponse.json(data)
  } catch {
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json(
      {
        status: 'unavailable',
        asOf: new Date().toISOString(),
        source: 'Comisión para el Mercado Financiero (CMF)',
        events: [],
        missingTickers: [],
      } satisfies EarningsCalendarResult,
      { status: 200 },
    )
  }
}
