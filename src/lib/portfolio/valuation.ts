// Phase 6C — Portfolio valuation. Pure functions, no side effects, no imports
// from Next.js or Supabase — safe to unit-test directly.
//
// CLP-first: base_currency is CLP and all covered tickers (companies.json) are
// Chilean equities priced in CLP, so no FX conversion is implemented yet. If a
// position's cost_currency differs from its live price currency, the position
// is flagged `mixedCurrency: true` instead of silently mixing amounts — Phase
// 6D/later can add real FX conversion.
//
// Every numeric output is guarded against division-by-zero / missing price so
// the UI never has to render NaN or Infinity — callers get `null` instead.

export interface PositionInput {
  ticker: string
  quantity: number
  averageCost: number | null
  costCurrency: string
  sector?: string | null
}

export interface LatestPrice {
  price: number | null
  currency: string | null
}

export interface ValuedPosition extends PositionInput {
  latestPrice: number | null
  marketValue: number | null
  costBasis: number | null
  unrealizedPnL: number | null
  unrealizedPnLPct: number | null
  weight: number | null
  mixedCurrency: boolean
}

function safeNumber(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null
  return Number.isFinite(n) ? n : null
}

export function calculatePositionMarketValue(
  position: PositionInput,
  latestPrice: LatestPrice,
): number | null {
  const price = safeNumber(latestPrice.price)
  if (price === null) return null
  const value = position.quantity * price
  return Number.isFinite(value) ? value : null
}

export function calculateCostBasis(position: PositionInput): number | null {
  const cost = safeNumber(position.averageCost)
  if (cost === null) return null
  const basis = position.quantity * cost
  return Number.isFinite(basis) ? basis : null
}

export function calculateUnrealizedPnL(
  position: PositionInput,
  latestPrice: LatestPrice,
): number | null {
  const marketValue = calculatePositionMarketValue(position, latestPrice)
  const costBasis = calculateCostBasis(position)
  if (marketValue === null || costBasis === null) return null
  const pnl = marketValue - costBasis
  return Number.isFinite(pnl) ? pnl : null
}

export function calculateUnrealizedPnLPct(
  position: PositionInput,
  latestPrice: LatestPrice,
): number | null {
  const pnl = calculateUnrealizedPnL(position, latestPrice)
  const costBasis = calculateCostBasis(position)
  if (pnl === null || costBasis === null || costBasis === 0) return null
  const pct = (pnl / costBasis) * 100
  return Number.isFinite(pct) ? pct : null
}

/** True when the position's cost currency differs from the live price currency. */
export function isMixedCurrency(position: PositionInput, latestPrice: LatestPrice): boolean {
  if (!latestPrice.currency) return false
  return position.costCurrency.toUpperCase() !== latestPrice.currency.toUpperCase()
}

/** Enriches each position with market value, P&L, weight, and a mixed-currency flag. */
export function valuePositions(
  positions: PositionInput[],
  pricesByTicker: Map<string, LatestPrice>,
): ValuedPosition[] {
  const withValues = positions.map((position) => {
    const latestPriceEntry = pricesByTicker.get(position.ticker.toUpperCase()) ?? { price: null, currency: null }
    return {
      ...position,
      latestPrice: safeNumber(latestPriceEntry.price),
      marketValue: calculatePositionMarketValue(position, latestPriceEntry),
      costBasis: calculateCostBasis(position),
      unrealizedPnL: calculateUnrealizedPnL(position, latestPriceEntry),
      unrealizedPnLPct: calculateUnrealizedPnLPct(position, latestPriceEntry),
      mixedCurrency: isMixedCurrency(position, latestPriceEntry),
    }
  })

  const totalMarketValue = withValues.reduce((sum, p) => sum + (p.marketValue ?? 0), 0)

  return withValues.map((p) => ({
    ...p,
    weight:
      totalMarketValue > 0 && p.marketValue !== null
        ? (p.marketValue / totalMarketValue) * 100
        : null,
  }))
}

export interface PortfolioTotals {
  totalMarketValue: number
  totalCostBasis: number
  totalUnrealizedPnL: number | null
  totalUnrealizedPnLPct: number | null
  positionCount: number
  pricedPositionCount: number
}

export function calculatePortfolioTotals(positions: ValuedPosition[]): PortfolioTotals {
  const totalMarketValue = positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0)
  const totalCostBasis = positions.reduce((sum, p) => sum + (p.costBasis ?? 0), 0)
  const pricedPositionCount = positions.filter((p) => p.marketValue !== null).length

  const totalUnrealizedPnL =
    pricedPositionCount > 0 ? totalMarketValue - totalCostBasis : null
  const totalUnrealizedPnLPct =
    totalUnrealizedPnL !== null && totalCostBasis > 0
      ? (totalUnrealizedPnL / totalCostBasis) * 100
      : null

  return {
    totalMarketValue,
    totalCostBasis,
    totalUnrealizedPnL,
    totalUnrealizedPnLPct,
    positionCount: positions.length,
    pricedPositionCount,
  }
}

export interface SectorExposure {
  sector: string
  marketValue: number
  weight: number | null
  positionCount: number
}

export function calculateSectorExposure(positions: ValuedPosition[]): SectorExposure[] {
  const totalMarketValue = positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0)
  const bySector = new Map<string, { marketValue: number; positionCount: number }>()

  for (const p of positions) {
    const sector = p.sector?.trim() || 'Unknown'
    const entry = bySector.get(sector) ?? { marketValue: 0, positionCount: 0 }
    entry.marketValue += p.marketValue ?? 0
    entry.positionCount += 1
    bySector.set(sector, entry)
  }

  return Array.from(bySector.entries())
    .map(([sector, { marketValue, positionCount }]) => ({
      sector,
      marketValue,
      weight: totalMarketValue > 0 ? (marketValue / totalMarketValue) * 100 : null,
      positionCount,
    }))
    .sort((a, b) => b.marketValue - a.marketValue)
}
