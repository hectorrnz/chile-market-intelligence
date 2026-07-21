// GET /api/valuation/AGUAS-A
// Live per-ticker valuation (price, market cap, currency + full fundamentals)
// for the company/stocks detail page. Same resolver/fundamentals as Compare, so
// the two surfaces always agree. Always returns 200 (data null for an unknown
// or unavailable ticker) so the page never breaks.

import { NextResponse } from 'next/server'
import { resolveValuation } from '@/lib/compare/resolveCompareData'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: Request, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params
  try {
    const data = await resolveValuation(ticker)
    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ data: null }, { status: 200 })
  }
}
