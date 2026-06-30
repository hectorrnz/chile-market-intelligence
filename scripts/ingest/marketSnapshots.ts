// Phase 4C.2 — CLI script for market snapshot ingestion.
// Usage:
//   npm run ingest:market-snapshots:dry
//   npm run ingest:market-snapshots -- --snapshot-type manual --write
//   npm run ingest:market-snapshots -- --snapshot-type close --write

import nextEnv from '@next/env'
const { loadEnvConfig } = nextEnv
import {
  runMarketSnapshotIngestion,
  type SnapshotType,
  type IngestionSource,
} from '../../src/lib/ingestion/marketSnapshotIngestion.ts'

loadEnvConfig(process.cwd())

function parseArgs() {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const dryRun = !write || args.includes('--dry-run')
  const typeIdx = args.indexOf('--snapshot-type')
  const snapshotType: SnapshotType = (typeIdx >= 0 ? args[typeIdx + 1] : 'manual') as SnapshotType
  const source: IngestionSource = 'local'
  return { dryRun, snapshotType, source }
}

async function main() {
  const { dryRun, snapshotType, source } = parseArgs()
  console.log(`\n=== marketSnapshots.ts ===`)
  console.log(`snapshotType: ${snapshotType}  dryRun: ${dryRun}  source: ${source}\n`)

  const result = await runMarketSnapshotIngestion({ snapshotType, source, dryRun })

  console.log(`Status       : ${result.status}`)
  console.log(`SnapshotDate : ${result.snapshotDate}`)
  console.log(`Symbols      : ${result.symbolsSucceeded}/${result.symbolsRequested} succeeded (${result.symbolsFailed} failed)`)
  console.log(`Stock rows   : ${result.stockRowsInserted} upserted`)
  console.log(`Index rows   : ${result.indexRowsInserted} upserted`)
  console.log(`Sector rows  : ${result.sectorRowsInserted} upserted`)
  console.log(`Total rows   : ${result.rowsInserted}/${result.rowsSeen} (${result.rowsFailed} failed)`)
  console.log(`Duration     : ${result.durationMs}ms`)
  if (result.ingestionRunId) console.log(`RunId        : ${result.ingestionRunId}`)
  if (result.errorSummary)   console.log(`Errors       : ${result.errorSummary}`)
  console.log(`\n=== Done ===`)
}

main().catch(e => {
  console.error('Fatal:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
