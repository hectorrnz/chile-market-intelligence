// Pure aggregation helpers for the Yahoo Finance live market overlay.
// No Next.js imports — safe to use in both server routes and unit tests.

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
  'Real Estate / Malls':  ['PARAUCO', 'MALLPLAZA', 'LAS-CONDES'],
  'Telecom':              ['ENTEL', 'SONDA'],
  'Consumer':             ['CCU', 'ANDINA-B', 'CONCHATORO'],
  'Transport / Airlines': ['LTM'],
}

export const INDEX_YF: Record<string, string> = {
  'ipsa':        '^IPSA',
  'sp500':       '^GSPC',
  'ibovespa':    '^BVSP',
  'ipc-mexico':  '^MXX',
  'colcap':      '^COLCAP',
  'bvl-peru':    '^BVL',
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

export type StaticIndex = { id: string; value: number; dayChangePct: number; ytdChangePct: number }

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
    if (!q?.regularMarketPrice) { failed++; continue }
    const dayPct = q.regularMarketChangePercent ?? 0
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
): IndexLive[] {
  const bySymbol = Object.fromEntries(quotes.map(q => [q.symbol, q]))
  return base.map(idx => {
    const yf = INDEX_YF[idx.id]
    const q  = yf ? bySymbol[yf] : undefined
    return {
      id:           idx.id,
      value:        q?.regularMarketPrice ?? idx.value,
      dayChangePct: q?.regularMarketChangePercent != null
        ? Math.round(q.regularMarketChangePercent * 100) / 100
        : idx.dayChangePct,
      ytdChangePct: idx.ytdChangePct,
    }
  })
}
