// R13.7 — server-side One Pager market-context resolution (doc 06 §§ 3-4).
//
// SERVER-ONLY (imports the Yahoo provider). The arithmetic lives in the pure
// module (`overview.ts`); this file only decides WHETHER an instrument may be
// fetched and feeds the results through that arithmetic.
//
// THE GATE IS ABSOLUTE: an instrument whose config entry is not `verified` is
// NEVER fetched — not fetched-and-hidden, not fetched-and-labelled — and its
// metric reports `unverified` (doc 06 § 4.3: "a benchmark is never published
// from an unverified symbol"). At the time of writing every candidate ships
// unverified, so this module performs zero network calls in production; the
// operator flips a symbol only after the discovery script reproduces the
// workbook's own derived rows from it.
//
// The fetcher is injectable so the composition logic is testable without a
// network and without weakening the gate.

// Relative `.ts` imports, not the `@/` alias — this module runs directly under
// Node's native test runner (the standing provider-file convention).
import {
  ONE_PAGER_BENCHMARKS,
  FIXED_INCOME_COMPONENT_IDS,
  getBenchmark,
  type OnePagerBenchmark,
} from '../../config/onePagerBenchmarks.ts'
import { getYahooDailyCloses } from '../providers/market/yahooHistoryProvider.ts'
import {
  alignWeeklyClose,
  benchmarkWeeklyReturn,
  fixedIncomeAverage,
  type BenchmarkBar,
} from './overview.ts'

export interface MarketMetric {
  /**
   * unverified  — the symbol has not passed the doc 06 § 4.3 protocol; nothing
   *               was fetched and no number exists
   * unavailable — the symbol is verified but no observation satisfied the
   *               5-day alignment window (or a required component is missing)
   * ok          — a genuine aligned observation
   */
  status: 'unverified' | 'unavailable' | 'ok'
  value: number | null
  observationDate: string | null
  previousObservationDate: string | null
}

export interface OverviewMarketContext {
  globalEquity: MarketMetric
  globalFixedIncome: MarketMetric
  inretailPrice: MarketMetric
  inretailVariation: MarketMetric
}

const UNVERIFIED: MarketMetric = {
  status: 'unverified',
  value: null,
  observationDate: null,
  previousObservationDate: null,
}

const UNAVAILABLE: MarketMetric = {
  status: 'unavailable',
  value: null,
  observationDate: null,
  previousObservationDate: null,
}

export type BenchmarkFetcher = (
  symbol: string,
  from: Date,
  to: Date,
) => Promise<{ ok: true; closes: BenchmarkBar[] } | { ok: false }>

async function defaultFetcher(
  symbol: string,
  from: Date,
  to: Date,
): ReturnType<BenchmarkFetcher> {
  const result = await getYahooDailyCloses(symbol, from, to)
  if (!result.ok) return { ok: false }
  return { ok: true, closes: result.data.closes }
}

/** ~3 weeks of bars comfortably covers both 5-day alignment windows. */
function fetchWindow(previousWeekDate: string | null, thisWeekDate: string): { from: Date; to: Date } {
  const anchor = previousWeekDate ?? thisWeekDate
  const from = new Date(`${anchor}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - 10)
  const to = new Date(`${thisWeekDate}T00:00:00Z`)
  to.setUTCDate(to.getUTCDate() + 1)
  return { from, to }
}

async function barsFor(
  benchmark: OnePagerBenchmark,
  thisWeekDate: string,
  previousWeekDate: string | null,
  fetcher: BenchmarkFetcher,
): Promise<BenchmarkBar[] | null> {
  // THE gate. An unverified candidate performs no request at all.
  if (benchmark.verified !== true) return null
  const { from, to } = fetchWindow(previousWeekDate, thisWeekDate)
  const result = await fetcher(benchmark.candidateSymbol, from, to)
  return result.ok ? result.closes : []
}

/**
 * Resolves the four market-context metrics for a publication's two column
 * dates. Degradation is per-metric: one instrument failing never takes the
 * others down, and the fixed-income mean requires ALL THREE components — a
 * partial mean is a different metric wearing the same label (doc 06 § 4.6).
 */
export async function resolveOverviewMarketContext(
  thisWeekDate: string,
  previousWeekDate: string | null,
  fetcher: BenchmarkFetcher = defaultFetcher,
): Promise<OverviewMarketContext> {
  const acwi = getBenchmark('acwi')
  const inret = getBenchmark('inretc1')
  const fiComponents = FIXED_INCOME_COMPONENT_IDS.map((id) => getBenchmark(id))

  // --- Global equity: ACWI ALONE (doc 06 § 3.1 — 80/80; never an average).
  let globalEquity: MarketMetric = UNVERIFIED
  if (acwi.verified === true) {
    const bars = await barsFor(acwi, thisWeekDate, previousWeekDate, fetcher)
    globalEquity = bars === null ? UNVERIFIED : benchmarkWeeklyReturn(bars, thisWeekDate, previousWeekDate)
  }

  // --- Global fixed income: mean of AGGG/GHYG/CEMB, all three or nothing.
  let globalFixedIncome: MarketMetric = UNVERIFIED
  if (fiComponents.every((b) => b.verified === true)) {
    const results = await Promise.all(
      fiComponents.map(async (b) => {
        const bars = await barsFor(b, thisWeekDate, previousWeekDate, fetcher)
        return bars === null
          ? { status: 'unavailable' as const, value: null, observationDate: null, previousObservationDate: null }
          : benchmarkWeeklyReturn(bars, thisWeekDate, previousWeekDate)
      }),
    )
    const mean = fixedIncomeAverage(results.map((r) => r.value))
    globalFixedIncome =
      mean === null
        ? UNAVAILABLE
        : {
            status: 'ok',
            value: mean,
            // The latest component observation date is the honest composite
            // as-of; individual dates can differ by venue calendar.
            observationDate: results
              .map((r) => r.observationDate)
              .filter((d): d is string => d !== null)
              .sort()
              .at(-1) ?? null,
            previousObservationDate: results
              .map((r) => r.previousObservationDate)
              .filter((d): d is string => d !== null)
              .sort()
              .at(-1) ?? null,
          }
  }

  // --- InRetail price + weekly variation (one fetch feeds both).
  let inretailPrice: MarketMetric = UNVERIFIED
  let inretailVariation: MarketMetric = UNVERIFIED
  if (inret.verified === true) {
    const bars = await barsFor(inret, thisWeekDate, previousWeekDate, fetcher)
    if (bars !== null) {
      const aligned = alignWeeklyClose(bars, thisWeekDate)
      inretailPrice = aligned
        ? { status: 'ok', value: aligned.close, observationDate: aligned.date, previousObservationDate: null }
        : UNAVAILABLE
      inretailVariation = benchmarkWeeklyReturn(bars, thisWeekDate, previousWeekDate)
    }
  }

  return { globalEquity, globalFixedIncome, inretailPrice, inretailVariation }
}

/** Exported for tests: the full instrument set the resolver may ever touch. */
export const RESOLVER_BENCHMARK_IDS = ONE_PAGER_BENCHMARKS.map((b) => b.id)
