// Live yield curve (today / 1 week ago / prior year-end) for the Macro page's
// fixed-income chart. SERVER-ONLY.
//
// Reuses ONLY already-verified series codes from bcchSeriesManualMap.ts /
// usFredSeriesManualMap.ts — the exact same series the indicators table
// already sources live — so this never introduces a new, unverified series
// code. BCCh's BTP-10/BCU-5/PDBC-90d/TPM-TNA stay unverified (see
// bcchSeriesManualMap.ts) and are therefore NOT part of the Chile curve;
// FRED's DGS1MO/DGS6MO/DGS1/DGS3/DGS5/DGS7 have not been live-verified this
// phase (network access to FRED was unavailable in this environment) and are
// therefore NOT part of the US curve — both are candidates for a future
// expansion once verified live, never guessed.
//
// A tenor is dropped ENTIRELY (never fabricated/zero-filled) if its series
// fails to fetch or has no usable observation on/before all three target
// dates — this keeps the today/weekAgo/yearEnd arrays aligned index-for-index.

import { fetchBcchSeries } from './bcchClient.ts'
import { fetchFredSeries } from './fredClient.ts'
import { bcchSeriesManualMap, isManualSeriesLive } from '../../config/bcchSeriesManualMap.ts'
import { usFredSeriesManualMap, isFredSeriesLive } from '../../config/usFredSeriesManualMap.ts'

interface TenorDef {
  tenor: string
  provider: 'BCCh' | 'FRED'
  manualKey: string
}

// Chile: TPM (policy rate, short end) + Cámara Swap 1Y/2Y (nominal) + BTU 5Y/10Y
// (UF-indexed REAL rate — the only live 5Y/10Y series BCCh publishes). Mixed
// nominal/real tenors on one chart — labeled explicitly in the curve's source
// line so it is never read as a single homogeneous nominal curve.
export const CL_YIELD_CURVE_TENORS: TenorDef[] = [
  { tenor: 'TPM', provider: 'BCCh', manualKey: 'tpm' },
  { tenor: '1Y', provider: 'BCCh', manualKey: 'camara-swap-1y' },
  { tenor: '2Y', provider: 'BCCh', manualKey: 'camara-swap-2y' },
  { tenor: '5Y (UF)', provider: 'BCCh', manualKey: 'btu-5' },
  { tenor: '10Y (UF)', provider: 'BCCh', manualKey: 'btu-10' },
]

// US: the 5 FRED Treasury constant-maturity series already verified live and
// enabled for the indicators table (us3m/us2y/us10y/us20y/us30y).
export const US_YIELD_CURVE_TENORS: TenorDef[] = [
  { tenor: '3M', provider: 'FRED', manualKey: 'us3m' },
  { tenor: '2Y', provider: 'FRED', manualKey: 'us2y' },
  { tenor: '10Y', provider: 'FRED', manualKey: 'us10y' },
  { tenor: '20Y', provider: 'FRED', manualKey: 'us20y' },
  { tenor: '30Y', provider: 'FRED', manualKey: 'us30y' },
]

export interface LiveYieldCurveResult {
  ok: boolean
  tenors: string[]
  today: number[]
  weekAgo: number[]
  yearEnd: number[]
  todayDate: string | null
  weekAgoDate: string | null
  yearEndDate: string | null
  source: string
  reason?: string
}

interface SeriesPoint {
  date: string
  value: number | null
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return isoDate(d)
}

/** Dec 31 of the prior calendar year — the "year-end" comparison point. */
function priorYearEndIso(): string {
  return `${new Date().getFullYear() - 1}-12-31`
}

/** Comfortably before priorYearEndIso() so a holiday-adjacent Dec 31 always has an on-or-before candidate. */
function fetchWindowStartIso(): string {
  return `${new Date().getFullYear() - 1}-12-01`
}

/** Latest point with date <= cutoff. Points need not be pre-sorted. */
export function latestOnOrBefore(points: SeriesPoint[], cutoff: string): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null
  for (const p of points) {
    if (p.value == null || p.date > cutoff) continue
    if (!best || p.date > best.date) best = { date: p.date, value: p.value }
  }
  return best
}

async function fetchTenorPoints(def: TenorDef, startDate: string): Promise<SeriesPoint[] | null> {
  if (def.provider === 'FRED') {
    const m = usFredSeriesManualMap[def.manualKey]
    if (!m || !isFredSeriesLive(m)) return null
    const res = await fetchFredSeries(m.seriesId, { startDate })
    return res.ok ? res.data : null
  }
  const m = bcchSeriesManualMap[def.manualKey]
  if (!m || !isManualSeriesLive(m)) return null
  const res = await fetchBcchSeries(m.seriesId as string, { firstDate: startDate })
  return res.ok ? res.data : null
}

async function fetchLiveYieldCurve(region: 'CL' | 'US'): Promise<LiveYieldCurveResult> {
  const defs = region === 'US' ? US_YIELD_CURVE_TENORS : CL_YIELD_CURVE_TENORS
  const source = region === 'US'
    ? 'FRED (Federal Reserve Bank of St. Louis)'
    : 'Banco Central de Chile (BCCh)'

  const startDate = fetchWindowStartIso()
  const todayIso = isoDate(new Date())
  const weekAgoIso = daysAgoIso(7)
  const yearEndIso = priorYearEndIso()

  const fetched = await Promise.all(
    defs.map(async (def) => ({ def, points: await fetchTenorPoints(def, startDate) })),
  )

  const tenors: string[] = []
  const today: number[] = []
  const weekAgo: number[] = []
  const yearEnd: number[] = []
  let latestDate = ''

  for (const { def, points } of fetched) {
    if (!points || points.length === 0) continue
    const t = latestOnOrBefore(points, todayIso)
    const w = latestOnOrBefore(points, weekAgoIso)
    const y = latestOnOrBefore(points, yearEndIso)
    // Drop the tenor entirely rather than fabricate any one of the 3 points.
    if (!t || !w || !y) continue
    tenors.push(def.tenor)
    today.push(t.value)
    weekAgo.push(w.value)
    yearEnd.push(y.value)
    if (t.date > latestDate) latestDate = t.date
  }

  if (tenors.length < 2) {
    return {
      ok: false, tenors: [], today: [], weekAgo: [], yearEnd: [],
      todayDate: null, weekAgoDate: null, yearEndDate: null, source,
      reason: 'Not enough live tenors returned to draw a curve',
    }
  }

  return {
    ok: true, tenors, today, weekAgo, yearEnd,
    todayDate: latestDate || null, weekAgoDate: weekAgoIso, yearEndDate: yearEndIso, source,
  }
}

// Server-side cache — mirrors frankfurterFxProvider.ts's pattern: cache only a
// SUCCESSFUL resolution (a transient failure retries on the next request
// rather than being pinned unavailable for the full TTL), 6h TTL.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const cache = new Map<string, { result: LiveYieldCurveResult; fetchedAt: number }>()

/** Resolves the live yield curve for a region, using a 6h server-side cache. Never throws; a partial/total failure returns `ok:false` and the caller falls back to the static curve. */
export async function resolveLiveYieldCurve(region: 'CL' | 'US'): Promise<LiveYieldCurveResult> {
  const cached = cache.get(region)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result

  const result = await fetchLiveYieldCurve(region)
  if (result.ok) cache.set(region, { result, fetchedAt: Date.now() })
  return result
}

/** Test-only: clears the module-scope cache so each test starts fresh. */
export function __resetYieldCurveCacheForTests(): void {
  cache.clear()
}
