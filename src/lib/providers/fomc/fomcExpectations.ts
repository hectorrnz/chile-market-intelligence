// FOMC market-implied rate outlook — SERVER-ONLY.
//
// Combines two free/official sources, honestly labeled:
//  1. The Federal Reserve Bank of Atlanta's Market Probability Tracker (MPT)
//     workbook — market-implied probabilities of the average 3-month SOFR
//     landing below / in / above the current FOMC target range, per forward
//     reference quarter, plus a modal expected rate. This is a DERIVED,
//     SOFR-based, per-QUARTER estimate — deliberately NOT presented per FOMC
//     meeting and NOT the (paid) CME FedWatch per-meeting product.
//  2. FRED's fed-funds target range (DFEDTARL/DFEDTARU) — the current policy
//     band, used as a resilient fallback for the "current target range" if the
//     Atlanta Fed workbook can't be fetched (it sits behind a WAF).
//
// Never fabricates: a failed fetch/parse degrades to 'partial' (target range
// only) or 'unavailable', never invented numbers.

import { unzip } from '../../financials/xbrl/unzip.ts'
import { fetchFredSeries } from '../fredClient.ts'
import {
  parseSharedStrings,
  parseDataSheet,
  summarizeLatest,
  type QuarterProbabilities,
} from './mptXlsx.ts'

const MPT_URL =
  'https://www.atlantafed.org/-/media/Project/Atlanta/FRBA/Documents/cenfis/market-probability-tracker/mpt_histdata.xlsx'
const SOURCE = 'Federal Reserve Bank of Atlanta — Market Probability Tracker'
// The workbook is date-ascending; the latest observation's ~500 rows sit at the
// very end, so we only need to decode the tail of the (17 MB) DATA sheet.
const TAIL_BYTES = 1_200_000
const TIMEOUT_MS = 20_000

export interface FomcQuarterOutlook {
  /** Reference-quarter start (IMM date), YYYY-MM-DD. */
  referenceStart: string
  /** Human label for the 3-month SOFR window (e.g. "Sep–Dec 2026"). */
  windowLabel: string
  /** Modal market-implied average rate for the window, in percent. */
  expectedRatePct: number | null
  /** P(avg rate BELOW the current target range), %. */
  probBelowPct: number | null
  /** P(avg rate WITHIN the current target range), %. */
  probInRangePct: number | null
  /** P(avg rate ABOVE the current target range), %. */
  probAbovePct: number | null
}

export interface FomcExpectationsResult {
  status: 'live' | 'partial' | 'unavailable'
  asOf: string
  /** MPT observation date the outlook is drawn from (null when MPT unavailable). */
  observationDate: string | null
  /** Current FOMC target range, e.g. "3.50%–3.75%". */
  currentTargetRange: string | null
  currentTargetSource: 'atlanta_fed_mpt' | 'fred' | null
  quarters: FomcQuarterOutlook[]
  source: string
}

/** "350bps - 375bps" → "3.50%–3.75%" (or null if unparseable). */
export function formatBpsRange(range: string): string | null {
  const m = /(\d+)\s*bps\s*-\s*(\d+)\s*bps/i.exec(range)
  if (!m) return null
  const lo = Number(m[1]) / 100
  const hi = Number(m[2]) / 100
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return `${lo.toFixed(2)}%–${hi.toFixed(2)}%`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** IMM reference-quarter start (YYYY-MM-DD) → "Sep–Dec 2026" 3-month window label. */
export function windowLabelFor(referenceStart: string): string {
  const [y, m] = referenceStart.split('-').map(Number)
  if (!y || !m) return referenceStart
  const startM = MONTHS[m - 1] ?? '?'
  const endMonthIdx = (m - 1 + 3) % 12
  const endYear = m - 1 + 3 >= 12 ? y + 1 : y
  const endM = MONTHS[endMonthIdx] ?? '?'
  return endYear === y ? `${startM}–${endM} ${y}` : `${startM} ${y}–${endM} ${endYear}`
}

const round1 = (v: number | null): number | null => (v == null ? null : Math.round(v * 10) / 10)

function toOutlook(q: QuarterProbabilities): FomcQuarterOutlook {
  return {
    referenceStart: q.referenceStart,
    windowLabel: windowLabelFor(q.referenceStart),
    expectedRatePct: q.modeBps != null ? Math.round((q.modeBps / 100) * 100) / 100 : null,
    probBelowPct: round1(q.probCut),
    probInRangePct: round1(q.probHold),
    probAbovePct: round1(q.probHike),
  }
}

/** Fetches + parses the Atlanta Fed MPT workbook. Returns null on any failure. */
async function fetchMpt(): Promise<{ observationDate: string; targetRange: string | null; quarters: QuarterProbabilities[] } | null> {
  let buf: Buffer
  try {
    const res = await fetch(MPT_URL, {
      headers: {
        // The MPT sits behind an Akamai WAF that 403s Node's default UA.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return null
    buf = Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }

  const zip = unzip(buf)
  if (!zip.ok) return null
  const sharedEntry = zip.entries.find((e) => e.name === 'xl/sharedStrings.xml')
  // The DATA sheet is by far the largest worksheet — pick it by size rather
  // than hard-coding sheet3, which could change between workbook revisions.
  const dataEntry = zip.entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => b.data.length - a.data.length)[0]
  if (!sharedEntry || !dataEntry) return null

  const shared = parseSharedStrings(sharedEntry.data.toString('utf8'))
  const tail = dataEntry.data.subarray(Math.max(0, dataEntry.data.length - TAIL_BYTES)).toString('utf8')
  const rows = parseDataSheet(tail, shared)
  const latest = summarizeLatest(rows)
  if (!latest) return null
  const targetRange = latest.quarters[0]?.targetRange ? formatBpsRange(latest.quarters[0].targetRange) : null
  return { observationDate: latest.date, targetRange, quarters: latest.quarters }
}

/** FRED fed-funds target range latest values → "3.50%–3.75%" (fallback). */
async function fetchFredTargetRange(): Promise<string | null> {
  try {
    const [lower, upper] = await Promise.all([
      fetchFredSeries('DFEDTARL', { startDate: isoDaysAgo(30) }),
      fetchFredSeries('DFEDTARU', { startDate: isoDaysAgo(30) }),
    ])
    if (!lower.ok || !upper.ok) return null
    const lo = lastValue(lower.data)
    const hi = lastValue(upper.data)
    if (lo == null || hi == null) return null
    return `${lo.toFixed(2)}%–${hi.toFixed(2)}%`
  } catch {
    return null
  }
}

function lastValue(points: { date: string; value: number | null }[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value != null && Number.isFinite(points[i].value!)) return points[i].value!
  }
  return null
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

export async function resolveFomcExpectations(opts?: { maxQuarters?: number }): Promise<FomcExpectationsResult> {
  const asOf = new Date().toISOString()
  // The nearest 4 forward quarters carry the full below/in/above probability
  // set; further-out quarters have only rate-distribution stats, so stop at 4.
  const maxQuarters = opts?.maxQuarters ?? 4

  const mpt = await fetchMpt()

  if (mpt) {
    const quarters = mpt.quarters.slice(0, maxQuarters).map(toOutlook)
    // Prefer the MPT's own concurrent target range; fall back to FRED only if
    // the workbook didn't carry a parseable one.
    const currentTargetRange = mpt.targetRange ?? (await fetchFredTargetRange())
    return {
      status: 'live',
      asOf,
      observationDate: mpt.observationDate,
      currentTargetRange,
      currentTargetSource: mpt.targetRange ? 'atlanta_fed_mpt' : currentTargetRange ? 'fred' : null,
      quarters,
      source: SOURCE,
    }
  }

  // MPT unavailable (e.g. WAF-blocked from this host) — still surface the
  // reliable current target range from FRED so the FOMC rows aren't empty.
  const fredRange = await fetchFredTargetRange()
  return {
    status: fredRange ? 'partial' : 'unavailable',
    asOf,
    observationDate: null,
    currentTargetRange: fredRange,
    currentTargetSource: fredRange ? 'fred' : null,
    quarters: [],
    source: fredRange ? 'FRED (Federal Reserve Bank of St. Louis)' : SOURCE,
  }
}
