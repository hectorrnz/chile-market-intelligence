// FX Data Task — CurrencyFreaks (unofficial third-party) latest-rates client.
//
// SERVER-ONLY. Never import from a client component. Reads
// `process.env.CURRENCYFREAKS_API_KEY` only — never `NEXT_PUBLIC_*`, never
// hardcoded, never logged, never echoed in a thrown error. This client backs
// ONLY the Macro / US forex table — Chile FX stays BCCh-only and untouched
// (see bcchMacroProvider.ts / macroSeries.ts's FX category).
//
// Endpoint: https://api.currencyfreaks.com/v2.0/rates/latest — verified live
// (2026-07-14): base is USD, `rates` values are numeric strings, `date` is a
// daily snapshot ("YYYY-MM-DD HH:MM:SS+00") — the free plan does not appear to
// refresh intraday, which is exactly why the caller uses a conservative
// server-side cache (see currencyFreaksFxProvider.ts) rather than fetching on
// every request.

import type { ProviderResult } from './types'

const BASE_URL = 'https://api.currencyfreaks.com/v2.0/rates/latest'
const TIMEOUT_MS = 10000

export interface CurrencyFreaksRates {
  base: string
  date: string
  rates: Record<string, number>
}

/** True only when CURRENCYFREAKS_API_KEY is set server-side. Never exposes the key itself. */
export function isCurrencyFreaksConfigured(): boolean {
  return Boolean(process.env.CURRENCYFREAKS_API_KEY?.trim())
}

/** Strips the apikey query value from any URL/error text before it can reach a log or response. */
function sanitize(text: string): string {
  return text.replace(/apikey=[^&\s]+/gi, 'apikey=***').slice(0, 400)
}

/**
 * Fetches latest USD-base rates for the given ISO currency codes. Never
 * throws — a missing key, network failure, timeout, or malformed response
 * returns a structured `{ ok: false, reason }` with no raw payload or key.
 */
export async function fetchCurrencyFreaksRates(symbols: string[]): Promise<ProviderResult<CurrencyFreaksRates>> {
  const apiKey = process.env.CURRENCYFREAKS_API_KEY?.trim()
  if (!apiKey) return { ok: false, reason: 'CURRENCYFREAKS_API_KEY not configured' }
  if (symbols.length === 0) return { ok: false, reason: 'No symbols requested' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const params = new URLSearchParams({ apikey: apiKey, symbols: symbols.join(',') })
    const res = await fetch(`${BASE_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, reason: `CurrencyFreaks request failed (HTTP ${res.status})` }

    const json = (await res.json()) as { base?: string; date?: string; rates?: Record<string, unknown> }
    if (!json.rates || typeof json.rates !== 'object') {
      return { ok: false, reason: 'CurrencyFreaks returned no rates' }
    }

    const rates: Record<string, number> = {}
    for (const [code, raw] of Object.entries(json.rates)) {
      const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
      // Reject missing, zero, negative, non-finite — never coerce a bad rate to a number.
      if (Number.isFinite(n) && n > 0) rates[code] = n
    }
    if (Object.keys(rates).length === 0) return { ok: false, reason: 'CurrencyFreaks returned no valid rates' }

    const base = json.base ?? 'USD'
    const date = json.date ?? new Date().toISOString()
    return { ok: true, data: { base, date, rates }, source: 'CurrencyFreaks', lastUpdated: date }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    const reason = aborted ? 'CurrencyFreaks request timed out' : 'CurrencyFreaks request failed'
    // Defense in depth: even though we never interpolate the key into `e`,
    // sanitize any unexpected error text before it could be surfaced.
    void sanitize(e instanceof Error ? e.message : String(e))
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}
