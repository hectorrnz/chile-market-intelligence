// Phase 8D — FRED (Federal Reserve Economic Data, St. Louis Fed) client.
//
// SERVER-ONLY. Uses FRED's public CSV "graph" endpoint
// (https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES_ID>) — a
// genuinely free, official, publicly-documented download that requires NO
// API key (verified live, Phase 8D: HTTP 200, Content-Type: application/csv,
// real current data for FEDFUNDS/CPIAUCSL/DGS10/UNRATE/DGS2/DGS20/DGS30/
// DGS3MO). This is the same underlying data FRED's keyed JSON API serves —
// just via the public CSV download used by fredgraph.stlouisfed.org itself —
// so no secret, no paid tier, no scraping of rendered HTML.
//
// Mirrors bcchClient.ts's shape (ProviderResult<SeriesPoint[]>) so the same
// transforms.ts / macro-history plumbing works unchanged for both providers.

import type { ProviderResult } from './types'

const BASE_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv'
const TIMEOUT_MS = 15000

export interface FredSeriesPoint {
  date: string          // YYYY-MM-DD (FRED's own CSV format, no normalization needed)
  value: number | null   // null for FRED's "." missing-observation marker
}

/** FRED's CSV graph endpoint needs no credentials — always available if the network is. */
export function isFredConfigured(): boolean {
  return true
}

/** Parses FRED's two-column CSV ("date,value", value="." for missing) into normalized points. Never throws — a malformed line is skipped, not fatal. */
export function parseFredCsv(csvText: string): FredSeriesPoint[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  // First line is the header (e.g. "observation_date,FEDFUNDS" or "DATE,VALUE") — skip it.
  const points: FredSeriesPoint[] = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length < 2) continue
    const date = parts[0].trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const raw = parts[1].trim()
    const value = raw === '.' || raw === '' ? null : Number(raw)
    points.push({ date, value: value != null && Number.isFinite(value) ? value : null })
  }
  return points
}

export interface FredFetchOptions {
  /** Chart observation start date (FRED's `cosd` param), YYYY-MM-DD. Omit for full history. */
  startDate?: string
  /** Chart observation end date (FRED's `coed` param), YYYY-MM-DD. Omit for "today". */
  endDate?: string
}

/**
 * Fetches one FRED series via the public CSV endpoint. Never throws; a
 * network failure, timeout, or empty/malformed response returns a structured
 * `{ ok: false, reason }` — the caller falls back to static data exactly like
 * a BCCh failure does.
 *
 * Always passes `cosd`/`coed` (verified live, Phase 8D — the same "chart
 * observation start/end date" params fredgraph.stlouisfed.org's own chart
 * embed uses) so a request for a daily series that has decades of history
 * (e.g. DGS10 since 1962) doesn't download the entire series just to read
 * the latest value — the full-history default caused real production
 * timeouts before this fix (verified live: /api/macro?region=US exceeded
 * 60s; per-request latency, not payload size alone, was the dominant cost).
 */
export async function fetchFredSeries(
  seriesId: string,
  options: FredFetchOptions = {},
): Promise<ProviderResult<FredSeriesPoint[]>> {
  if (!seriesId) return { ok: false, reason: 'No FRED series id provided' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const params = new URLSearchParams({ id: seriesId })
    if (options.startDate) params.set('cosd', options.startDate)
    if (options.endDate) params.set('coed', options.endDate)
    const url = `${BASE_URL}?${params.toString()}`
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/csv' }, cache: 'no-store' })
    if (!res.ok) return { ok: false, reason: `FRED request failed (HTTP ${res.status})` }
    const text = await res.text()
    const points = parseFredCsv(text)
    if (points.length === 0) return { ok: false, reason: 'FRED returned no parseable observations' }
    const withValues = points.filter((p) => p.value != null)
    if (withValues.length === 0) return { ok: false, reason: 'FRED series has no non-missing observations' }
    const lastUpdated = withValues[withValues.length - 1].date
    return { ok: true, data: points, source: 'FRED (Federal Reserve Bank of St. Louis)', lastUpdated }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, reason: aborted ? 'FRED request timed out' : 'FRED request failed' }
  } finally {
    clearTimeout(timer)
  }
}
