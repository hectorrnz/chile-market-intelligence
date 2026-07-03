// Phase 8C — GET /api/financials/[ticker]/metrics
// Public read-only: all persisted financial_metrics (manual + derived) for a
// ticker across every imported period. Empty array means nothing imported.

import { NextResponse } from 'next/server'
import { getFinancialMetrics } from '@/lib/db/repositories/financialsRepository'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  try {
    const metrics = await getFinancialMetrics(ticker)
    return NextResponse.json({ ticker: ticker.toUpperCase(), metrics })
  } catch {
    return NextResponse.json({ ticker: ticker.toUpperCase(), metrics: [] }, { status: 200 })
  }
}
