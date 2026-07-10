// Phase 8D.1 — FRED release-date calendar client.
//
// SERVER-ONLY. Uses FRED's official Releases API
// (https://api.stlouisfed.org/fred/release/dates) which requires FRED_API_KEY
// — a free, server-only key (never NEXT_PUBLIC_, never sent to the browser).
// This endpoint returns ONLY release dates, never consensus/actual/prior
// values — a genuinely different, narrower API surface than the public CSV
// graph endpoint fredClient.ts uses for macro time series. Actual reported
// values continue to come exclusively from the macro time-series providers
// (BCCh / FRED CSV) — this client must never fabricate a value.

import type { ProviderResult } from './types.ts'

const BASE_URL = 'https://api.stlouisfed.org/fred/release/dates'
const TIMEOUT_MS = 15000
const USER_AGENT = 'Mozilla/5.0 (compatible; NevadaMarketIntelligence/1.0; +https://nevada-market-intelligence.vercel.app)'

export interface FredReleaseDate {
  releaseId: number
  date: string // YYYY-MM-DD
}

/** True only when FRED_API_KEY is set server-side. Never exposes the key itself. */
export function isFredCalendarConfigured(): boolean {
  return Boolean(process.env.FRED_API_KEY?.trim())
}

/**
 * Fetches upcoming/recent release dates for one FRED release id within
 * [start, end]. Never throws — a missing key, network failure, timeout, or
 * malformed response returns a structured `{ ok: false, reason }`.
 */
export async function fetchFredReleaseDates(
  releaseId: number,
  range: { start: string; end: string },
): Promise<ProviderResult<FredReleaseDate[]>> {
  const apiKey = process.env.FRED_API_KEY?.trim()
  if (!apiKey) return { ok: false, reason: 'FRED_API_KEY not configured' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const params = new URLSearchParams({
      release_id: String(releaseId),
      api_key: apiKey,
      file_type: 'json',
      realtime_start: range.start,
      realtime_end: range.end,
      include_release_dates_with_no_data: 'true',
    })
    const res = await fetch(`${BASE_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, reason: `FRED release-dates request failed (HTTP ${res.status})` }
    const json = (await res.json()) as { release_dates?: Array<{ release_id: number; date: string }> }
    const dates = (json.release_dates ?? [])
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
      .map((d) => ({ releaseId: d.release_id, date: d.date }))
    return {
      ok: true,
      data: dates,
      source: 'FRED (Federal Reserve Bank of St. Louis) — release dates API',
      lastUpdated: new Date().toISOString().slice(0, 10),
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, reason: aborted ? 'FRED release-dates request timed out' : 'FRED release-dates request failed' }
  } finally {
    clearTimeout(timer)
  }
}
