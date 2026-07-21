// GET /api/macro/fomc-expectations
// Market-implied FOMC rate outlook (Atlanta Fed Market Probability Tracker,
// SOFR-based, per reference quarter) + current fed-funds target range (FRED
// fallback). Server-cached 12h per warm instance so it auto-refreshes on cache
// expiry / cold start. Always 200 with a status envelope; never fabricated.

import { NextResponse } from 'next/server'
import {
  resolveFomcExpectations,
  type FomcExpectationsResult,
} from '@/lib/providers/fomc/fomcExpectations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CACHE_TTL_MS = 12 * 60 * 60 * 1000

let cache: { at: number; data: FomcExpectationsResult } | null = null

export async function GET() {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS && cache.data.status !== 'unavailable') {
    return NextResponse.json(cache.data)
  }
  try {
    const data = await resolveFomcExpectations()
    if (data.status !== 'unavailable') cache = { at: now, data }
    return NextResponse.json(data)
  } catch {
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json(
      {
        status: 'unavailable',
        asOf: new Date().toISOString(),
        observationDate: null,
        currentTargetRange: null,
        currentTargetSource: null,
        quarters: [],
        source: 'Federal Reserve Bank of Atlanta — Market Probability Tracker',
      } satisfies FomcExpectationsResult,
      { status: 200 },
    )
  }
}
