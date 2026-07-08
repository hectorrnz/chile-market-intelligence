// Phase 8C — GET /api/financials/[ticker]/statements
// Returns persisted FundamentalRecord[]-shaped financials for Charting.
// Empty records + status: 'static_fallback' means the caller should use the
// static fundamentals.json — this route never fabricates data.

import { NextResponse } from 'next/server'
import { resolveFinancialStatements } from '@/lib/financials/resolveFinancials'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  try {
    const result = await resolveFinancialStatements(ticker)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ ticker: ticker.toUpperCase(), records: [], status: 'static_fallback', source: 'Static MVP sample', sourceType: 'none' }, { status: 200 })
  }
}
