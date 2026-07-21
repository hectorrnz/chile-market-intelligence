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
   * Prior-year-end close — the YTD baseline, written by the twice-daily GitHub
   * refresh (refreshMarketData.py). Lets YTD be recomputed from the live price
   * on every snapshot even for symbols whose history Yahoo won't serve at
   * request time (notably ^IPSA). Optional: absent → static YTD is used.
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
    const value = q?.regularMarketPrice ?? idx.value
    const baseline = yearStartByIndex?.[idx.id]
    const liveYtd = baseline != null && baseline > 0 && q?.regularMarketPrice != null
      ? Math.round(((value / baseline - 1) * 100) * 100) / 100
      : null
    return {
      id:           idx.id,
      value,
      dayChangePct: q?.regularMarketChangePercent != null
        ? Math.round(q.regularMarketChangePercent * 100) / 100
        : idx.dayChangePct,
      ytdChangePct: liveYtd ?? idx.ytdChangePct,
    }
  })
}
