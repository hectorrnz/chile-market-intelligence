import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MIGRATION = join(ROOT, 'supabase/migrations/20260625000000_create_market_intelligence_core.sql')
const SEED = join(ROOT, 'supabase/seed.sql')

describe('Supabase schema files', () => {
  it('migration file exists', () => {
    assert.ok(existsSync(MIGRATION), 'migration SQL not found')
  })

  it('migration defines all 11 tables', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const expected = [
      'data_sources',
      'companies',
      'macro_indicators',
      'macro_observations',
      'stock_snapshots',
      'stock_ohlcv',
      'index_snapshots',
      'sector_performance',
      'cmf_filings',
      'documents',
      'ingestion_runs',
    ]
    for (const table of expected) {
      assert.ok(sql.includes(`create table if not exists ${table}`), `migration missing table: ${table}`)
    }
  })

  it('migration enables RLS on all tables', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const tables = [
      'data_sources', 'companies', 'macro_indicators', 'macro_observations',
      'stock_snapshots', 'stock_ohlcv', 'index_snapshots', 'sector_performance',
      'cmf_filings', 'documents', 'ingestion_runs',
    ]
    for (const table of tables) {
      assert.ok(
        sql.includes(`alter table ${table} enable row level security`),
        `RLS not enabled on: ${table}`
      )
    }
  })

  it('seed file exists', () => {
    assert.ok(existsSync(SEED), 'seed.sql not found')
  })

  it('seed file inserts into data_sources, companies, macro_indicators', () => {
    const sql = readFileSync(SEED, 'utf8')
    assert.ok(sql.includes('insert into data_sources'))
    assert.ok(sql.includes('insert into companies'))
    assert.ok(sql.includes('insert into macro_indicators'))
  })

  it('seed file uses upsert (on conflict)', () => {
    const sql = readFileSync(SEED, 'utf8')
    assert.ok(sql.includes('on conflict'), 'seed should use ON CONFLICT for idempotency')
  })
})
