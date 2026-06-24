// Phase 4A — Banco Central de Chile (BDE / SieteRestWS) client.
//
// SERVER-ONLY. Reads BCCH_API_USER / BCCH_API_PASSWORD from server env and
// talks to the BCCh SieteRestWS GetSeries endpoint. Credentials are never
// logged and never returned to the client — only normalized points or a short,
// non-sensitive `reason` string leave this module.
//
// `normalizeBcchDate` and `normalizeBcchSeries` are PURE (no env, no fetch) so
// the response-parsing logic is unit-tested directly. The response shape mirrors
// the documented SieteRestWS GetSeries payload ({ Codigo, Series: { Obs: [...] }})
// and is parsed defensively; it must be validated against a live response in 4B.

import type { ProviderResult } from './types'

const DEFAULT_BASE_URL = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx'
const TIMEOUT_MS = 8000

export interface BcchSeriesPoint {
  date: string          // normalized YYYY-MM-DD
  value: number | null  // null for missing/NaN observations
}

/** True only when both BCCh credentials are present in server env. */
export function isBcchConfigured(): boolean {
  return Boolean(process.env.BCCH_API_USER && process.env.BCCH_API_PASSWORD)
}

/** BCCh returns observation dates as DD-MM-YYYY → normalize to YYYY-MM-DD. */
export function normalizeBcchDate(s: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec((s ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (s ?? '').trim()
}

interface RawObs { indexDateString?: string; value?: string | number; statusCode?: string }

/**
 * Parse a SieteRestWS GetSeries JSON payload into normalized points.
 * Defensive: tolerates missing fields, non-zero Codigo, and NaN/empty values.
 */
export function normalizeBcchSeries(json: unknown): ProviderResult<BcchSeriesPoint[]> {
  try {
    if (!json || typeof json !== 'object') return { ok: false, reason: 'Empty BCCh response' }
    const root = json as { Codigo?: number; Series?: { Obs?: RawObs[] } }
    if (typeof root.Codigo === 'number' && root.Codigo !== 0) {
      return { ok: false, reason: `BCCh response code ${root.Codigo}` }
    }
    const obs = root.Series?.Obs
    if (!Array.isArray(obs)) return { ok: false, reason: 'BCCh response missing Series.Obs' }

    const points: BcchSeriesPoint[] = obs
      .map((o): BcchSeriesPoint => {
        const raw = typeof o?.value === 'string' ? o.value : o?.value != null ? String(o.value) : ''
        const num = Number(raw)
        const value = raw === '' || Number.isNaN(num) ? null : num
        return { date: normalizeBcchDate(String(o?.indexDateString ?? '')), value }
      })
      .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date))

    if (points.length === 0) return { ok: false, reason: 'BCCh series returned no usable observations' }

    return {
      ok: true,
      data: points,
      source: 'Banco Central de Chile (BDE)',
      lastUpdated: points[points.length - 1].date,
    }
  } catch {
    return { ok: false, reason: 'Failed to parse BCCh response' }
  }
}

/**
 * Fetch a single BCCh series. Returns a provider-unavailable result (never
 * throws) when credentials are missing, the request times out, or parsing
 * fails. Credentials are placed in the query string per the SieteRestWS spec
 * but the URL is never logged.
 */
export async function fetchBcchSeries(
  seriesCode: string,
  opts?: { firstDate?: string; lastDate?: string }
): Promise<ProviderResult<BcchSeriesPoint[]>> {
  const user = process.env.BCCH_API_USER
  const pass = process.env.BCCH_API_PASSWORD
  const base = process.env.BCCH_API_BASE_URL || DEFAULT_BASE_URL
  if (!user || !pass) return { ok: false, reason: 'BCCh credentials not configured' }
  if (!seriesCode) return { ok: false, reason: 'No BCCh series code provided' }

  const params = new URLSearchParams({ user, pass, function: 'GetSeries', timeseries: seriesCode })
  if (opts?.firstDate) params.set('firstdate', opts.firstDate)
  if (opts?.lastDate) params.set('lastdate', opts.lastDate)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, reason: `BCCh request failed (HTTP ${res.status})` }
    const json = await res.json()
    return normalizeBcchSeries(json)
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, reason: aborted ? 'BCCh request timed out' : 'BCCh request failed' }
  } finally {
    clearTimeout(timer)
  }
}
