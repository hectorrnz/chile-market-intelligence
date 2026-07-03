// Phase 8C — GET /api/financials/coverage
// Public read-only: which tickers have persisted (manual CSV) financials, and
// how many reporting periods each has. Drives fallback decisions client-side.

import { NextResponse } from 'next/server'
import { getFinancialsCoverage } from '@/lib/db/repositories/financialsRepository'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const coverage = await getFinancialsCoverage()
    return NextResponse.json({ coverage })
  } catch {
    return NextResponse.json({ coverage: [] }, { status: 200 })
  }
}
