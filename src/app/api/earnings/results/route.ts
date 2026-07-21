// GET /api/earnings/results
//
// Real reported quarterly results (rolling two most recent quarters per ticker)
// from Yahoo Finance — replaces the Earnings tab's fabricated static sample.
// See src/lib/earnings/resolveEarningsResults.ts for the sourcing rules.
//
// `?force=1` skips the 6h server cache (used by the Update Data button); a
// normal navigation stays cached so the page doesn't refan-out 25 Yahoo
// requests on every visit.

import { NextResponse } from 'next/server'
import { resolveEarningsResults } from '@/lib/earnings/resolveEarningsResults'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1'
  try {
    return NextResponse.json(await resolveEarningsResults({ force }))
  } catch {
    return NextResponse.json(
      { status: 'unavailable', asOf: new Date().toISOString(), source: 'Yahoo Finance', rows: [], missingTickers: [] },
      { status: 200 },
    )
  }
}
