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
//
// R5.2 (2026-07-31) — the keyless CSV graph endpoint STOPPED SERVING
// programmatic requests: every request to fred.stlouisfed.org/graph/fredgraph.csv
// now stalls until the caller's timeout (verified live from two independent
// clients — curl and Node's fetch — with the app UA, a full browser UA, and
// curl's own default: HTTP status 000, 0 bytes, 40s; the same machine reached
// Frankfurter, Yahoo and example.com normally, and TCP:443 to FRED's own edge
// connected fine). That is the documented Phase 8D failure mode ("FRED's edge
// appears to silently stall such requests") now applying everywhere, not just
// to Vercel. Because EVERY series fetch failed, every calendar metric degraded
// to `unavailable` — the schedule layer kept working because it uses a
// different host.
//
// The repair keeps FRED as the only source and adds no vendor: when the
// server-only FRED_API_KEY is present (it already exists for the release
// calendar) the series come from FRED's official keyed JSON observations API
// on api.stlouisfed.org — verified live returning real current data while the
// CSV host stalls. With no key configured the client behaves exactly as
// before (CSV endpoint), so the standing "must build and run with zero env
// vars" rule is preserved; the CSV path is also the fallback if the keyed
// request fails.

import type { ProviderResult } from './types'

const BASE_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv'
const OBSERVATIONS_URL = 'https://api.stlouisfed.org/fred/series/observations'
const TIMEOUT_MS = 15000
const USER_AGENT = 'Mozilla/5.0 (compatible; NevadaMarketIntelligence/1.0; +https://nevada-market-intelligence.vercel.app)'

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

/**
 * Parses FRED's keyed JSON observations payload into the same normalized
 * points the CSV parser produces (value "." → null). Never throws — a
 * malformed entry is skipped, not fatal.
 */
export function parseFredObservations(json: unknown): FredSeriesPoint[] {
  const obs = (json as { observations?: Array<{ date?: unknown; value?: unknown }> })?.observations
  if (!Array.isArray(obs)) return []
  const points: FredSeriesPoint[] = []
  for (const o of obs) {
    const date = typeof o?.date === 'string' ? o.date.trim() : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const raw = typeof o?.value === 'string' ? o.value.trim() : o?.value
    if (raw === '.' || raw === '' || raw == null) {
      points.push({ date, value: null })
      continue
    }
    const value = Number(raw)
    points.push({ date, value: Number.isFinite(value) ? value : null })
  }
  return points
}

export interface FredFetchOptions {
  /** Chart observation start date (FRED's `cosd` param), YYYY-MM-DD. Omit for full history. */
  startDate?: string
  /** Chart observation end date (FRED's `coed` param), YYYY-MM-DD. Omit for "today". */
  endDate?: string
}

/** True when the server-only keyed observations API can be used. Never exposes the key. */
export function isFredApiKeyConfigured(): boolean {
  return Boolean(process.env.FRED_API_KEY?.trim())
}

/**
 * Builds the ProviderResult for a parsed FRED series, or a structured failure
 * when it carries no usable observation. Shared by both transports so the CSV
 * and JSON paths can never diverge in what counts as a usable series.
 */
function toSeriesResult(points: FredSeriesPoint[], transport: string): ProviderResult<FredSeriesPoint[]> {
  if (points.length === 0) return { ok: false, reason: `FRED returned no parseable observations (${transport})` }
  const withValues = points.filter((p) => p.value != null)
  if (withValues.length === 0) return { ok: false, reason: `FRED series has no non-missing observations (${transport})` }
  return {
    ok: true,
    data: points,
    source: 'FRED (Federal Reserve Bank of St. Louis)',
    lastUpdated: withValues[withValues.length - 1].date,
  }
}

/**
 * Fetches one series from FRED's official keyed JSON observations API
 * (api.stlouisfed.org — the same host the release-date calendar already uses,
 * and the one transport verified live to still serve series data). Requires
 * the server-only FRED_API_KEY; returns a structured failure when unset.
 *
 * The key is sent as a query parameter because FRED's API accepts no other
 * form. It is NEVER logged and NEVER placed in a `reason` string (failure
 * reasons carry only the HTTP status), so it cannot leak into a response body,
 * a cron summary, or a server log.
 */
export async function fetchFredObservationsApi(
  seriesId: string,
  options: FredFetchOptions = {},
): Promise<ProviderResult<FredSeriesPoint[]>> {
  const apiKey = process.env.FRED_API_KEY?.trim()
  if (!apiKey) return { ok: false, reason: 'FRED_API_KEY not configured' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const params = new URLSearchParams({ series_id: seriesId, api_key: apiKey, file_type: 'json' })
    if (options.startDate) params.set('observation_start', options.startDate)
    if (options.endDate) params.set('observation_end', options.endDate)
    const res = await fetch(`${OBSERVATIONS_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, reason: `FRED observations request failed (HTTP ${res.status})` }
    return toSeriesResult(parseFredObservations(await res.json()), 'observations API')
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, reason: aborted ? 'FRED observations request timed out' : 'FRED observations request failed' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetches one FRED series. Never throws; a network failure, timeout, or
 * empty/malformed response returns a structured `{ ok: false, reason }` — the
 * caller falls back to static data exactly like a BCCh failure does.
 *
 * Transport precedence (R5.2): the keyed JSON observations API when
 * FRED_API_KEY is set, otherwise — and as a fallback if that request fails —
 * the keyless CSV graph endpoint. Same official source either way; the app
 * still runs with zero env vars, it just depends on the CSV host being
 * healthy in that configuration.
 *
 * The CSV path always passes `cosd`/`coed` (verified live, Phase 8D — the same
 * "chart observation start/end date" params fredgraph.stlouisfed.org's own
 * chart embed uses) so a request for a daily series that has decades of
 * history (e.g. DGS10 since 1962) doesn't download the entire series just to
 * read the latest value.
 */
export async function fetchFredSeries(
  seriesId: string,
  options: FredFetchOptions = {},
): Promise<ProviderResult<FredSeriesPoint[]>> {
  if (!seriesId) return { ok: false, reason: 'No FRED series id provided' }

  if (isFredApiKeyConfigured()) {
    const viaApi = await fetchFredObservationsApi(seriesId, options)
    if (viaApi.ok) return viaApi
    // Fall through to the keyless CSV transport rather than failing outright,
    // so a key problem degrades to the original behaviour instead of removing
    // a source that might still work.
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const params = new URLSearchParams({ id: seriesId })
    if (options.startDate) params.set('cosd', options.startDate)
    if (options.endDate) params.set('coed', options.endDate)
    const url = `${BASE_URL}?${params.toString()}`
    // A real User-Agent is required — verified live: Vercel's serverless
    // functions (Node's default fetch UA) hung indefinitely against FRED
    // while the identical request worked instantly from a normal machine and
    // from this same deployment against Yahoo Finance, pointing at basic bot
    // protection on FRED's edge rather than a payload/latency problem.
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/csv',
        'User-Agent': 'Mozilla/5.0 (compatible; NevadaMarketIntelligence/1.0; +https://nevada-market-intelligence.vercel.app)',
      },
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, reason: `FRED request failed (HTTP ${res.status})` }
    return toSeriesResult(parseFredCsv(await res.text()), 'CSV endpoint')
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, reason: aborted ? 'FRED request timed out' : 'FRED request failed' }
  } finally {
    clearTimeout(timer)
  }
}
