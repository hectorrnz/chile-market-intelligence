// Phase 8C.7 — CMF bank financials discovery/dry-run CLI. DRY-RUN ONLY —
// there is no --write flag; this script never touches Supabase.
//
// Usage:
//   npm run discover:cmf-bank                    # coverage summary (no network)
//   npm run discover:cmf-bank -- --live           # + live fetch/parse/validate dry-run for all 4 banks
//   npm run discover:cmf-bank -- --live --ticker BCI --year 2025

import { buildBankCoverageSummary } from '../../src/lib/financials/banks/bankCoverageStatus.ts'
import { dryRunBankFinancials } from '../../src/lib/financials/providers/cmfBankProvider.ts'
import { getAllBankTickers } from '../../src/lib/financials/banks/bankRegistry.ts'

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

async function main() {
  const live = process.argv.includes('--live')
  const summary = buildBankCoverageSummary()

  console.log(`[cmf-bank] bank track coverage: ${summary.totalBanks} banks, ${summary.totalMappedAccountCodes} mapped account codes, ${summary.totalKnownUnmappedGroups} documented unmapped groups`)
  for (const e of summary.entries) {
    console.log(`  ${e.ticker.padEnd(12)} bank_code=${e.bankCode}  status=${e.registryStatus}  mapped=${e.mappedFieldCount}`)
  }
  console.log(`[cmf-bank] capital ratio fields (never populated this phase): ${summary.capitalRatioFieldsDeferred.join(', ')}`)

  if (!live) {
    console.log('[cmf-bank] (run with --live to fetch + parse + validate the most recent annual release for each bank — dry-run only, never writes)')
    return
  }

  const onlyTicker = arg('ticker')
  const yearArg = arg('year')
  const fromYear = yearArg ? Number(yearArg) : undefined
  const tickers = onlyTicker ? [onlyTicker.toUpperCase()] : getAllBankTickers()

  console.log('\n[cmf-bank] LIVE dry-run (fetch + parse + map + validate — no database write):')
  for (const ticker of tickers) {
    const result = await dryRunBankFinancials(ticker, fromYear)
    if (!result.ok) {
      console.log(`  ${ticker.padEnd(12)} FAILED: ${result.error.code} — ${result.error.reason}`)
      continue
    }
    const r = result.value
    console.log(`  ${ticker.padEnd(12)} ${r.bankName} — FY${r.year} — mapped ${r.mappedFieldCount}/${r.totalConceptsInMap} fields — validation: ${r.validation.status} (${r.validation.warnings.length} warning(s))`)
    for (const w of r.validation.warnings) console.log(`      [${w.code}] ${w.detail}`)
  }
}

main().catch((e) => {
  console.error(`[cmf-bank] error: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`)
  process.exitCode = 1
})
