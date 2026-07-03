// Phase 8C — GET /api/earnings[?ticker=SQM-B]
// Returns persisted earnings_events (manual CSV import). Empty array means
// no ticker has imported earnings yet — the page falls back to earnings.json
// for any ticker not present in `tickersCovered`.

import { NextResponse } from 'next/server'
import { getEarningsEvents } from '@/lib/db/repositories/financialsRepository'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ticker = searchParams.get('ticker') ?? undefined

  try {
    const events = await getEarningsEvents(ticker)
    const tickersCovered = Array.from(new Set(events.map((e) => e.ticker)))
    return NextResponse.json({ events, tickersCovered })
  } catch {
    return NextResponse.json({ events: [], tickersCovered: [] }, { status: 200 })
  }
}
