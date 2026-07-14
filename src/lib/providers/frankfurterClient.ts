// FX Integrity Task — Frankfurter (free, open-source, no-key) FX client.
//
// SERVER-ONLY. Never import from a client component. Frankfurter requires NO
// API key at all (verified live 2026-07-14: https://frankfurter.dev/ — "Free,
// open-source exchange rates API sourcing from 84 central banks. Current and
// historical rates for 201 currencies. No API key required."). Backs ONLY the
// Macro / US forex table — Chile FX stays BCCh-official and untouched.
//
// Endpoint (v2, confirmed live): https://api.frankfurter.dev/v2/rates
//   - latest:      ?base=USD&quotes=EUR,GBP,...
//   - historical:  ?base=USD&quotes=EUR,GBP,...&date=YYYY-MM-DD
//   - time series: ?base=USD&quotes=EUR,GBP,...&from=YYYY-MM-DD&to=YYYY-MM-DD
// Response shape (verified live): a flat JSON array of
// { date, base, quote, rate }, one entry per (date, quote) pair — NOT the
// classic frankfurter.app v1 { amount, base, date, rates: {...} } shape.
//
// Verified live: this v2 endpoint publishes an observation for every calendar
// day, including weekends (it blends 84 central-bank feeds, not ECB-only), so
// no special weekend-carry-forward logic is needed here — the caller instead
// asks over a bounded recent window and picks the most recent distinct dates,
// which naturally tolerates any provider gap without guessing or fabricating.

import type { ProviderResult } from './types'

const BASE_URL = 'https://api.frankfurter.dev/v2/rates'
const TIMEOUT_MS = 10000

export interface FrankfurterRatePoint {
  date: string   // YYYY-MM-DD
  quote: string  // ISO currency code
  rate: number
}

/** Frankfurter needs no credentials — always available if the network is. */
export function isFrankfurterConfigured(): boolean {
  return true
}

function parseRateArray(json: unknown): FrankfurterRatePoint[] {
  if (!Array.isArray(json)) return []
  const out: FrankfurterRatePoint[] = []
  for (const row of json) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const date = typeof r.date === 'string' ? r.date : null
    const quote = typeof r.quote === 'string' ? r.quote : null
    const rate = typeof r.rate === 'number' ? r.rate : Number(r.rate)
    // Reject missing, zero, negative, non-finite — never coerce a bad rate.
    if (!date || !quote || !Number.isFinite(rate) || rate <= 0) continue
    out.push({ date, quote, rate })
  }
  return out
}

async function fetchJson(params: URLSearchParams): Promise<ProviderResult<FrankfurterRatePoint[]>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, reason: `Frankfurter request failed (HTTP ${res.status})` }
    const json = await res.json()
    const points = parseRateArray(json)
    if (points.length === 0) return { ok: false, reason: 'Frankfurter returned no valid rates' }
    const lastUpdated = points.reduce((max, p) => (p.date > max ? p.date : max), points[0].date)
    return { ok: true, data: points, source: 'Frankfurter', lastUpdated }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, reason: aborted ? 'Frankfurter request timed out' : 'Frankfurter request failed' }
  } finally {
    clearTimeout(timer)
  }
}

/** Latest (or a single historical date, if `date` is given) rates for `base` against `quotes`. */
export async function fetchFrankfurterRates(
  base: string,
  quotes: string[],
  date?: string,
): Promise<ProviderResult<FrankfurterRatePoint[]>> {
  if (quotes.length === 0) return { ok: false, reason: 'No quote currencies requested' }
  const params = new URLSearchParams({ base, quotes: quotes.join(',') })
  if (date) params.set('date', date)
  return fetchJson(params)
}

/** Time series of rates for `base` against `quotes`, from..to inclusive (YYYY-MM-DD). */
export async function fetchFrankfurterTimeSeries(
  base: string,
  quotes: string[],
  from: string,
  to: string,
): Promise<ProviderResult<FrankfurterRatePoint[]>> {
  if (quotes.length === 0) return { ok: false, reason: 'No quote currencies requested' }
  const params = new URLSearchParams({ base, quotes: quotes.join(','), from, to })
  return fetchJson(params)
}
