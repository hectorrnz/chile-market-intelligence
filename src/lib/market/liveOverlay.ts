// Pure aggregation helpers for the Yahoo Finance live market overlay.
// No Next.js imports — safe to use in both server routes and unit tests.
// (The one import below is type-only — erased at compile time.)

import type { DataSourceStatus } from '../providers/types'

export const TICKER_YF: Record<string, string> = {
  'BSANTANDER': 'BSANTANDER.SN',
  'CHILE':      'CHILE.SN',
  'BCI':        'BCI.SN',
  'LAS-CONDES': 'LAS-CONDES.SN',
  'ITAUCL':     'ITAUCL.SN',
  'SQM-B':      'SQM-B.SN',
  'CAP':        'CAP.SN',
  'ENELAM':     'ENELAM.SN',
  'ENELCHILE':  'ENELCHILE.SN',
  'COLBUN':     'COLBUN.SN',
  'AGUAS-A':    'AGUAS-A.SN',
  'CMPC':       'CMPC.SN',
  'COPEC':      'COPEC.SN',
  'FALABELLA':  'FALABELLA.SN',
  'CENCOSUD':   'CENCOSUD.SN',
  'RIPLEY':     'RIPLEY.SN',
  'PARAUCO':    'PARAUCO.SN',
  'MALLPLAZA':  'MALLPLAZA.SN',
  'ENTEL':      'ENTEL.SN',
  'SONDA':      'SONDA.SN',
  'ANDINA-B':   'ANDINA-B.SN',
  'CCU':        'CCU.SN',
  'CONCHATORO': 'CONCHATORO.SN',
  'LTM':        'LTM.SN',
  'VAPORES':    'VAPORES.SN',
}

export const SECTOR_MAP: Record<string, string[]> = {
  'Banking':              ['BSANTANDER', 'CHILE', 'BCI', 'ITAUCL'],
  'Retail':               ['FALABELLA', 'CENCOSUD', 'RIPLEY'],
  'Utilities':            ['ENELCHILE', 'ENELAM', 'COLBUN', 'AGUAS-A'],
  'Mining / Lithium':     ['SQM-B', 'CAP'],
  'Pulp & Forestry':      ['CMPC'],
  'Industrials':          ['COPEC', 'VAPORES'],
  'Healthcare':           ['LAS-CONDES'],
  'Real Estate / Malls':  ['PARAUCO', 'MALLPLAZA'],
  'Telecom':              ['ENTEL', 'SONDA'],
  'Consumer':             ['CCU', 'ANDINA-B', 'CONCHATORO'],
  'Transport / Airlines': ['LTM'],
}

// Original index each proxy instrument represents.
export const INDEX_PROXY_OF: Partial<Record<string, string>> = {
  'colcap':   'COLCAP',  // ^SPCOSLCP proxies the COLCAP index
  'bvl-peru': 'BVL',     // EPU (iShares MSCI Peru ETF) proxies the BVL General index
}

export const INDEX_YF: Record<string, string> = {
  'ipsa':        '^IPSA',
  'sp500':       '^GSPC',
  'ibovespa':    '^BVSP',
  'ipc-mexico':  '^MXX',
  'colcap':      '^SPCOSLCP',
  'bvl-peru':    'EPU',
  'eurostoxx50': '^STOXX50E',
  'ftse100':     '^FTSE',
  'nikkei225':   '^N225',
  'hangseng':    '^HSI',
  'kospi':       '^KS11',
}

const YF_TO_INTERNAL = Object.fromEntries(Object.entries(TICKER_YF).map(([k, v]) => [v, k]))

export interface YFQuote {
  symbol: string
  regularMarketPrice?: number
  regularMarketChangePercent?: number
  marketCap?: number
}

export interface StockLive {
  price: number
  dayChangePct: number
  marketCapCLP: number | null
}

export interface SectorLive {
  sector: string
  dayChangePct: number
  ytdChangePct: number
  numberOfStocks: number
  topContributor: string
  topContributorPct: number
  worstContributor: string
  worstContributorPct: number
}

export interface IndexLive {
  id: string
  value: number
  dayChangePct: number
  ytdChangePct: number
  /** 'live' = overlaid from a complete Yahoo quote; 'base' = the committed
   *  snapshot row passed through unchanged as one coherent fallback unit. */
  source: 'live' | 'base'
}

export interface LiveSnapshot {
  stocks: Record<string, StockLive>
  sectors: SectorLive[]
  indices: IndexLive[]
  lastUpdated: string
  provider: 'yahoo-finance'
  symbolsSucceeded: number
  symbolsFailed: number
}

export type StaticSector = {
  sector: string; dayChangePct: number; ytdChangePct: number; numberOfStocks: number
  topContributor: string; topContributorPct: number; worstContributor: string; worstContributorPct: number
}

export type StaticIndex = {
  id: string; name?: string; country?: string; currency?: string
  value: number; dayChangePct: number; ytdChangePct: number
  /**
   * First close of the current year — the YTD baseline, written by the
   * twice-daily GitHub refresh (refreshMarketData.py `_year_start()`). Lets
   * YTD be recomputed from the live price on every snapshot even for symbols
   * whose history Yahoo won't serve at request time (notably ^IPSA).
   * Optional: absent → static YTD is used.
   */
  yearStartClose?: number
}

export function buildStocks(
  quotes: YFQuote[],
): { stocks: Record<string, StockLive>; dayByTicker: Record<string, number>; succeeded: number; failed: number } {
  const bySymbol = Object.fromEntries(quotes.map(q => [q.symbol, q]))
  const stocks: Record<string, StockLive> = {}
  const dayByTicker: Record<string, number> = {}
  let succeeded = 0
  let failed = 0

  for (const [yf, internal] of Object.entries(YF_TO_INTERNAL)) {
    const q = bySymbol[yf]
    // Coherent-row policy (R12): a usable live row needs BOTH a price and a
    // day change. A quote missing its change% must not fabricate a live
    // "0.00%" — the ticker counts as failed and its row keeps the coherent
    // persisted/static values instead. (A genuinely flat day arrives as an
    // explicit 0, which passes the `!= null` check.)
    if (!q?.regularMarketPrice || q.regularMarketChangePercent == null) { failed++; continue }
    const dayPct = q.regularMarketChangePercent
    stocks[internal] = {
      price:        Math.round(q.regularMarketPrice * 100) / 100,
      dayChangePct: Math.round(dayPct * 100) / 100,
      marketCapCLP: q.marketCap ? Math.round(q.marketCap / 1_000_000) : null,
    }
    dayByTicker[internal] = dayPct
    succeeded++
  }

  return { stocks, dayByTicker, succeeded, failed }
}

export function buildSectors(
  dayByTicker: Record<string, number>,
  base: StaticSector[],
): SectorLive[] {
  return base.map(s => {
    const members = (SECTOR_MAP[s.sector] ?? []).filter(t => t in dayByTicker)
    if (!members.length) return { ...s }
    const dayAvg = members.reduce((sum, t) => sum + dayByTicker[t], 0) / members.length
    const best   = members.reduce((a, b) => dayByTicker[a] > dayByTicker[b] ? a : b)
    const worst  = members.reduce((a, b) => dayByTicker[a] < dayByTicker[b] ? a : b)
    return {
      sector:              s.sector,
      dayChangePct:        Math.round(dayAvg * 100) / 100,
      ytdChangePct:        s.ytdChangePct,
      numberOfStocks:      members.length,
      topContributor:      best,
      topContributorPct:   Math.round(dayByTicker[best] * 100) / 100,
      worstContributor:    worst,
      worstContributorPct: Math.round(dayByTicker[worst] * 100) / 100,
    }
  })
}

export function buildIndices(
  quotes: YFQuote[],
  base: StaticIndex[],
  // Live year-start (previous year's final close) per index id, from Yahoo
  // chart history. When present for an index, YTD is computed live from the
  // same live price shown; otherwise it falls back to the static YTD. Yahoo's
  // quote payload carries no YTD field for indices, so this baseline is the
  // only way to make IPSA (and every index) YTD genuinely live.
  yearStartByIndex?: Record<string, number>,
): IndexLive[] {
  const bySymbol = Object.fromEntries(quotes.map(q => [q.symbol, q]))
  return base.map(idx => {
    const yf = INDEX_YF[idx.id]
    const q  = yf ? bySymbol[yf] : undefined
    const price = q?.regularMarketPrice
    const day   = q?.regularMarketChangePercent
    // Coherent-row policy (R12, same as buildStocks): overlay only when the
    // quote carries BOTH a usable price and a day change — a price-only quote
    // would render a fresh-price/stale-return hybrid row. A non-overlaid row
    // passes every committed value through as one coherent unit and says so
    // via `source: 'base'`, so consumers can gate their badge per instrument.
    if (price == null || price <= 0 || day == null) {
      return { id: idx.id, value: idx.value, dayChangePct: idx.dayChangePct, ytdChangePct: idx.ytdChangePct, source: 'base' as const }
    }
    const baseline = yearStartByIndex?.[idx.id]
    const liveYtd = baseline != null && baseline > 0
      ? Math.round(((price / baseline - 1) * 100) * 100) / 100
      : null
    return {
      id:           idx.id,
      value:        price,
      dayChangePct: Math.round(day * 100) / 100,
      ytdChangePct: liveYtd ?? idx.ytdChangePct,
      source:       'live' as const,
    }
  })
}

// ── Per-instrument overlay coverage (R12) ────────────────────────────────────
// A module-level "Live" badge must describe the instruments actually on
// screen, never the snapshot's mere existence: one successful symbol must not
// make another failed symbol's fallback row read as live. Consumers derive
// their badge from the coverage of the rows they display — full coverage is
// the only state allowed to claim `live`; partial coverage discloses the
// mixture as `hybrid-fallback`; zero coverage keeps the fallback layer's own
// word (`persisted`/`static`).

export type OverlayCoverage = 'full' | 'partial' | 'none'

/** Coverage of `displayedTickers` by the snapshot's per-symbol successes. */
export function stockOverlayCoverage(
  liveStocks: Record<string, StockLive> | null | undefined,
  displayedTickers: string[],
): OverlayCoverage {
  if (!liveStocks || displayedTickers.length === 0) return 'none'
  const covered = displayedTickers.filter(t => liveStocks[t] != null).length
  if (covered === 0) return 'none'
  return covered === displayedTickers.length ? 'full' : 'partial'
}

/** Coverage of the displayed sectors' full member lists (a sector tile built
 *  from only some of its members is itself partial). */
export function sectorOverlayCoverage(
  liveStocks: Record<string, StockLive> | null | undefined,
  sectors: Array<{ sector: string }>,
): OverlayCoverage {
  return stockOverlayCoverage(liveStocks, sectors.flatMap(s => SECTOR_MAP[s.sector] ?? []))
}

/** Coverage of the index rows via their own `source` flags. */
export function indexOverlayCoverage(indices: Array<{ source: 'live' | 'base' }> | null | undefined): OverlayCoverage {
  if (!indices || indices.length === 0) return 'none'
  const covered = indices.filter(i => i.source === 'live').length
  if (covered === 0) return 'none'
  return covered === indices.length ? 'full' : 'partial'
}

/** Module badge word from coverage: full → live, partial → hybrid-fallback,
 *  none → the fallback layer's own word. */
export function overlayStatus(coverage: OverlayCoverage, fallback: DataSourceStatus): DataSourceStatus {
  if (coverage === 'full') return 'live'
  if (coverage === 'partial') return 'hybrid-fallback'
  return fallback
}
