// R13.7 — One Pager benchmark symbol verification (doc 06 § 4.3).
//
// Run: npm run discover:onepager-benchmarks [-- --weeks 2026-07-24,2026-07-31
//        --expect-equity 0.0123 --expect-fixed -0.0042 --expect-inretail 0.0088]
//
// PROTOCOL (mirrors the bcchSeriesManualMap.ts discipline — never guess an
// identifier, never promote one without proof):
//
//   1. For each candidate symbol in `src/config/onePagerBenchmarks.ts`, fetch
//      ~90 days of daily closes and report: bar count, date span, price band,
//      and the venue's quote currency vs the expected USD.
//   2. THE DECISIVE TEST needs the private workbook, which never enters this
//      repository: the operator reads the derived rows 77 (`Bolsas
//      Mundiales`), 78 (`Promedio Renta Fija`) and 79 (`Inretail`) for a
//      recent week pair from their own copy and passes them as `--expect-*`
//      (ratios, e.g. 0.0123 for +1.23%). The script recomputes each metric
//      from the fetched history using the EXACT production arithmetic
//      (`alignWeeklyClose` / `weeklyPriceReturn` / `fixedIncomeAverage` from
//      overview.ts) and compares.
//   3. Only when step 2 matches may the operator flip that symbol's
//      `verified` flag in the config, recording the evidence in `notes`.
//      This script never edits the config itself.
//
// Read-only against Yahoo; no credential, no env var, nothing written.

import {
  ONE_PAGER_BENCHMARKS,
  FIXED_INCOME_COMPONENT_IDS,
} from '../../src/config/onePagerBenchmarks.ts'
import { getYahooDailyCloses } from '../../src/lib/providers/market/yahooHistoryProvider.ts'
import {
  alignWeeklyClose,
  weeklyPriceReturn,
  fixedIncomeAverage,
  type BenchmarkBar,
} from '../../src/lib/familyPortfolio/overview.ts'

interface Args {
  weeks: [string, string] | null
  expectEquity: number | null
  expectFixed: number | null
  expectInretail: number | null
}

function parseArgs(argv: string[]): Args {
  const args: Args = { weeks: null, expectEquity: null, expectFixed: null, expectInretail: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--weeks') {
      const parts = (next() ?? '').split(',')
      if (parts.length === 2 && parts.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p))) {
        args.weeks = [parts[0], parts[1]]
      } else {
        console.error('--weeks expects PREV,THIS as YYYY-MM-DD,YYYY-MM-DD')
        process.exit(2)
      }
    } else if (a === '--expect-equity') args.expectEquity = Number(next())
    else if (a === '--expect-fixed') args.expectFixed = Number(next())
    else if (a === '--expect-inretail') args.expectInretail = Number(next())
  }
  return args
}

const fmt = (r: number | null) => (r === null ? 'n/a' : `${(r * 100).toFixed(4)}%`)

function compare(label: string, computed: number | null, expected: number | null): void {
  if (expected === null || !Number.isFinite(expected)) {
    console.log(`  ${label}: computed ${fmt(computed)} — no expected value supplied, NOT verified`)
    return
  }
  if (computed === null) {
    console.log(`  ${label}: computed n/a vs expected ${fmt(expected)} — FAIL`)
    return
  }
  const diff = Math.abs(computed - expected)
  const verdict = diff < 1e-6 ? 'MATCH (exact)' : diff < 5e-4 ? 'CLOSE (inspect rounding)' : 'MISMATCH'
  console.log(`  ${label}: computed ${fmt(computed)} vs expected ${fmt(expected)} → ${verdict}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const to = new Date()
  const from = new Date(to.getTime() - 95 * 86_400_000)

  console.log('One Pager benchmark discovery (doc 06 § 4.3)')
  console.log(`History window: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}\n`)

  const barsBySymbol = new Map<string, BenchmarkBar[]>()

  for (const b of ONE_PAGER_BENCHMARKS) {
    console.log(`── ${b.sourceLabel} → candidate ${b.candidateSymbol} (verified: ${b.verified})`)
    const result = await getYahooDailyCloses(b.candidateSymbol, from, to)
    if (!result.ok) {
      console.log(`  FETCH FAILED: ${result.reason}\n`)
      continue
    }
    const closes = result.data.closes
    barsBySymbol.set(b.id, closes)
    if (closes.length === 0) {
      console.log('  0 bars — history does NOT resolve (the ^IPSA precedent). Candidate fails.\n')
      continue
    }
    const prices = closes.map((c) => c.close)
    console.log(`  bars: ${closes.length} · span ${closes[0].date} → ${closes[closes.length - 1].date}`)
    console.log(`  price band: ${Math.min(...prices).toFixed(2)} … ${Math.max(...prices).toFixed(2)}`)
    const cur = result.data.quoteCurrency
    console.log(
      `  quote currency: ${cur ?? 'ABSENT'} ${cur === b.expectedCurrency ? '(matches expected USD)' : `(EXPECTED ${b.expectedCurrency} — investigate before verifying)`}`,
    )
    console.log('')
  }

  if (!args.weeks) {
    console.log('No --weeks supplied — fetch-half only. The decisive workbook-reproduction')
    console.log('test was NOT run; every candidate stays verified: false.')
    return
  }

  const [prevWeek, thisWeek] = args.weeks
  console.log(`── Workbook reproduction for weeks ${prevWeek} → ${thisWeek}`)

  const ret = (id: string): number | null => {
    const bars = barsBySymbol.get(id) ?? []
    const t = alignWeeklyClose(bars, thisWeek)
    const p = alignWeeklyClose(bars, prevWeek)
    return weeklyPriceReturn(t?.close ?? null, p?.close ?? null)
  }

  compare('row 77 Bolsas Mundiales (ACWI alone)', ret('acwi'), args.expectEquity)
  compare(
    'row 78 Promedio Renta Fija (mean AGGG/GHYG/CEMB)',
    fixedIncomeAverage(FIXED_INCOME_COMPONENT_IDS.map((id) => ret(id))),
    args.expectFixed,
  )
  compare('row 79 Inretail (INRETC1)', ret('inretc1'), args.expectInretail)

  console.log('\nA MATCH permits flipping that symbol to verified: true in')
  console.log('src/config/onePagerBenchmarks.ts, recording this run in `notes`.')
}

main().catch((e) => {
  console.error('discovery failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
