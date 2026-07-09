// Phase 8C.7/8C.8 — CMF bank financials discovery/dry-run/ingestion CLI.
// Dry-run by default. Pass --write to actually persist via the orchestrator
// (src/lib/financials/banks/runCmfBankFinancialsIngestion.ts) — same
// dry-run-default / explicit-write-opt-in convention as
// scripts/discover/cmfXbrlFinancials.ts and scripts/ingest/yahooFinancials.ts.
//
// Usage:
//   npm run discover:cmf-bank                       # coverage summary (no network)
//   npm run discover:cmf-bank -- --live              # + live fetch/parse/validate dry-run for all 4 banks
//   npm run discover:cmf-bank -- --live --ticker BCI --year 2025
//   npm run ingest:cmf-bank:dry                      # same as --live (orchestrator dry-run, no write)
//   npm run ingest:cmf-bank -- --write               # real persistence (source_type: cmf_bank)
//   npm run ingest:cmf-bank -- --write --ticker BCI

// @next/env is CJS — import via default, then destructure after all imports
// (same pattern as scripts/ingest/yahooFinancials.ts and
// scripts/discover/cmfXbrlFinancials.ts). Without this, --write silently runs
// with no Supabase admin credentials in the environment and both upserts fail
// closed with "Admin Supabase client not configured" — a real bug caught
// during Phase 8C.8 production validation (surfaced as a generic "2 row(s)
// failed to write" until traced back to this missing call).
import pkg from '@next/env'

import { buildBankCoverageSummary } from '../../src/lib/financials/banks/bankCoverageStatus.ts'
import { dryRunBankFinancials } from '../../src/lib/financials/providers/cmfBankProvider.ts'
import { getAllBankTickers } from '../../src/lib/financials/banks/bankRegistry.ts'
import { runCmfBankFinancialsIngestion } from '../../src/lib/financials/banks/runCmfBankFinancialsIngestion.ts'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

async function main() {
  const live = process.argv.includes('--live')
  const write = process.argv.includes('--write')
  const onlyTicker = arg('ticker')
  const yearArg = arg('year')
  const fiscalYear = yearArg ? Number(yearArg) : undefined
  const tickers = onlyTicker ? [onlyTicker.toUpperCase()] : getAllBankTickers()

  if (write) {
    console.log(`[cmf-bank] WRITE mode — persisting via runCmfBankFinancialsIngestion (source_type: cmf_bank)`)
    const summary = await runCmfBankFinancialsIngestion({ tickers, fiscalYear, write: true })
    console.log(`[cmf-bank] run status: ${summary.status} — ${summary.banksSucceeded} succeeded, ${summary.banksPartial} partial, ${summary.banksDeferred} deferred, ${summary.banksFailed} failed`)
    console.log(`[cmf-bank] ${summary.normalizedFactsPersisted} row(s) written across ${summary.fieldsMapped} mapped field(s)`)
    for (const b of summary.banks) {
      console.log(`  ${b.ticker.padEnd(12)} FY${b.fiscalYear ?? '?'} — ${b.status} — mapped ${b.fieldsMapped}/${b.fieldsExpected} — validation: ${b.validationStatus ?? 'n/a'} — rowsWritten: ${b.rowsWritten}${b.reason ? ` — ${b.reason}` : ''}`)
    }
    if (summary.errors.length > 0) console.log(`[cmf-bank] errors: ${summary.errors.join('; ')}`)
    return
  }

  const summary = buildBankCoverageSummary()
  console.log(`[cmf-bank] bank track coverage: ${summary.totalBanks} banks, ${summary.totalMappedAccountCodes} mapped account codes, ${summary.totalKnownUnmappedGroups} documented unmapped groups`)
  for (const e of summary.entries) {
    console.log(`  ${e.ticker.padEnd(12)} bank_code=${e.bankCode}  status=${e.registryStatus}  mapped=${e.mappedFieldCount}`)
  }
  console.log(`[cmf-bank] capital ratio fields (never populated this phase): ${summary.capitalRatioFieldsDeferred.join(', ')}`)

  if (!live) {
    console.log('[cmf-bank] (run with --live to fetch + parse + validate the most recent annual release for each bank — dry-run only; --write to persist)')
    return
  }

  console.log('\n[cmf-bank] LIVE dry-run (fetch + parse + map + validate — no database write):')
  for (const ticker of tickers) {
    const result = await dryRunBankFinancials(ticker, fiscalYear)
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
