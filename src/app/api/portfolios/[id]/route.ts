// Phase 6C — GET /api/portfolios/[id]  Portfolio detail: positions + valuation.
// Ownership is enforced by RLS (the session client only ever sees its own rows);
// a portfolio_id belonging to another user simply returns an empty position list.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getPortfolioPositions } from '@/lib/db/repositories/portfolioRepository'
import { getLatestStockSnapshots } from '@/lib/db/repositories/marketRepository'
import { getAllCompanies } from '@/lib/data/companies'
import {
  valuePositions,
  calculatePortfolioTotals,
  calculateSectorExposure,
  type PositionInput,
} from '@/lib/portfolio/valuation'

export const dynamic = 'force-dynamic'

const sectorByTicker = new Map(getAllCompanies().map((c) => [c.ticker.toUpperCase(), c.sector ?? null]))
const nameByTicker = new Map(getAllCompanies().map((c) => [c.ticker.toUpperCase(), c.shortName ?? c.name]))

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: portfolioId } = await params
  const positions = await getPortfolioPositions(client, portfolioId)

  const snapshots = await getLatestStockSnapshots()
  const pricesByTicker = new Map(
    snapshots.data.map((s) => [s.ticker.toUpperCase(), { price: s.price, currency: s.currency }]),
  )

  const inputs: PositionInput[] = positions.map((p) => ({
    ticker: p.ticker,
    quantity: p.quantity,
    averageCost: p.averageCost,
    costCurrency: p.costCurrency,
    sector: sectorByTicker.get(p.ticker.toUpperCase()) ?? null,
  }))

  const valued = valuePositions(inputs, pricesByTicker)
  const totals = calculatePortfolioTotals(valued)
  const sectorExposure = calculateSectorExposure(valued)

  const positionsOut = positions.map((p, i) => ({
    ...p,
    companyName: nameByTicker.get(p.ticker.toUpperCase()) ?? p.ticker,
    sector: valued[i].sector,
    latestPrice: valued[i].latestPrice,
    marketValue: valued[i].marketValue,
    costBasis: valued[i].costBasis,
    unrealizedPnL: valued[i].unrealizedPnL,
    unrealizedPnLPct: valued[i].unrealizedPnLPct,
    weight: valued[i].weight,
    mixedCurrency: valued[i].mixedCurrency,
  }))

  return NextResponse.json({
    portfolioId,
    positions: positionsOut,
    totals,
    sectorExposure,
    priceSource: snapshots.available ? 'supabase' : 'unavailable',
  })
}
