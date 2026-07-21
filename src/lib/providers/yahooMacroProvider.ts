// Yahoo-backed macro indicators — SERVER-ONLY.
//
// Two US macro indicators have NO source in FRED or BCCh and were therefore
// never live: `bitcoin` (BTC/USD) and `dxy` (the ICE US Dollar Index). Both sat
// frozen on their static macroIndicators.json values, stamped 2025-06-17, with
// `bitcoin` additionally attributed to "CoinMarketCap" — a vendor this project
// has no relationship with. Reported as "Bitcoin price seems to not be updating;
// verify it has a clear source."
//
// FRED genuinely does not carry either: it has no crypto series at all, and its
// dollar-index series (DTWEXBGS, a Fed *broad* trade-weighted index) is a
// different index from ICE's DXY, so publishing it under the "DXY" label would
// misattribute the number. Yahoo Finance — already this app's live market-data
// provider for every equity and index — carries both directly and is named
// honestly as the source.
//
// Values AND history both come from here, so the popup chart matches the row.
// Never fabricates: an unreachable quote simply yields no indicator and the
// caller keeps its existing (static) fallback.

import type { MacroIndicator, MacroHistoryPoint } from '@/types'
import { getAllIndicators } from '@/lib/data/macro'
import { YAHOO_MACRO_SYMBOLS, isYahooMacroIndicator } from '@/config/yahooMacroSeries'
import { isPlausible } from './plausibility'

export { isYahooMacroIndicator }

const SOURCE = 'Yahoo Finance'
const TIMEOUT_MS = 10_000

const round2 = (n: number) => Math.round(n * 100) / 100

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function yahooClient(): Promise<any> {
  const YahooFinance = (await import('yahoo-finance2')).default
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] })
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

/**
 * Live BTC/USD + DXY as MacroIndicator rows, preserving each indicator's static
 * name/category/region/unit and overriding only the value, change, as-of date
 * and source. Returns [] on any failure — never throws, never partial-fakes.
 */
export async function getYahooMacroIndicators(region?: 'CL' | 'US'): Promise<MacroIndicator[]> {
  if (region === 'CL') return [] // both are US-region indicators
  const base = getAllIndicators()
  try {
    const yf = await yahooClient()
    const symbols = Object.values(YAHOO_MACRO_SYMBOLS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await withTimeout(yf.quote(symbols, {}, { validateResult: false }), TIMEOUT_MS)
    const quotes = Array.isArray(raw) ? raw : [raw]
    const bySymbol = Object.fromEntries(quotes.filter(Boolean).map((q) => [q.symbol, q]))
    const today = new Date().toISOString().slice(0, 10)

    const out: MacroIndicator[] = []
    for (const [id, symbol] of Object.entries(YAHOO_MACRO_SYMBOLS)) {
      const q = bySymbol[symbol]
      const price = q?.regularMarketPrice
      if (typeof price !== 'number' || !Number.isFinite(price)) continue
      // Reject an implausible value rather than display a wrong mapping.
      if (!isPlausible(id, price)) continue
      const staticBase = base.find((i) => i.id === id)
      if (!staticBase) continue
      const chgRaw = q?.regularMarketChangePercent
      const chg = typeof chgRaw === 'number' && Number.isFinite(chgRaw) ? round2(chgRaw) : null
      out.push({
        ...staticBase,
        value: round2(price),
        change: chg ?? undefined,
        changeLabel: chg != null ? `${chg >= 0 ? '+' : ''}${chg}%` : undefined,
        period: today,
        lastUpdated: today,
        source: SOURCE,
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Live daily history for a Yahoo-backed macro indicator, for the popup chart.
 * Weekly bars keep a 10Y request small; the caller applies the same monthly
 * frequency policy every other macro chart uses. Returns [] on any failure so
 * the caller falls back to static.
 */
export async function getYahooMacroHistory(
  indicatorId: string,
  years: number,
): Promise<MacroHistoryPoint[]> {
  const symbol = YAHOO_MACRO_SYMBOLS[indicatorId]
  if (!symbol) return []
  const from = new Date()
  from.setFullYear(from.getFullYear() - years)
  try {
    const yf = await yahooClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await withTimeout(
      yf.chart(symbol, { period1: from, period2: new Date(), interval: '1wk' }, { validateResult: false }),
      TIMEOUT_MS,
    )
    const quotes: { date?: Date | string | number; close?: number | null }[] = Array.isArray(r?.quotes) ? r.quotes : []
    const points: MacroHistoryPoint[] = []
    for (const q of quotes) {
      if (q.close == null || q.date == null || !Number.isFinite(q.close)) continue
      const d = q.date instanceof Date ? q.date : new Date(q.date)
      if (Number.isNaN(d.getTime())) continue
      points.push({ indicatorId, date: d.toISOString().slice(0, 10), value: round2(q.close) })
    }
    return points
  } catch {
    return []
  }
}
