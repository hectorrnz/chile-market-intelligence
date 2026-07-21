// Production audit (2026-07-21) — every DB-ingested macro series must have a
// macro_indicators parent row in COMMITTED SQL (seed or a migration).
//
// Root cause this guards against: BTP 2 / PDBC 14d were promoted to live BCCh
// ingestion on 2026-07-15 but never got macro_indicators rows, so the daily
// 12:30 UTC cron FK-failed on pdbc-90d every weekday (partial_success) and
// neither series could ever persist history. eurclp had the sibling gap: its
// row was inserted directly into production and never committed, so a fresh
// environment would have reproduced the same failure.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getEnabledBcchSeries, getEnabledFredSeries } from '../src/config/macroSeries.ts'

const ROOT = join(import.meta.dirname, '..')
const SQL_DIR = join(ROOT, 'supabase')

/** All ids inserted into macro_indicators across seed.sql + every migration. */
function committedIndicatorIds(): Set<string> {
  const files = [
    join(SQL_DIR, 'seed.sql'),
    ...readdirSync(join(SQL_DIR, 'migrations')).map((f) => join(SQL_DIR, 'migrations', f)),
  ].filter((f) => f.endsWith('.sql'))

  const ids = new Set<string>()
  for (const file of files) {
    const sql = readFileSync(file, 'utf8')
    // Each "insert into macro_indicators ... ;" statement, then every tuple's
    // first quoted value inside it.
    const stmts = sql.split(/insert into macro_indicators/i).slice(1)
    for (const stmt of stmts) {
      const body = stmt.split(';')[0]
      for (const m of body.matchAll(/\(\s*'([a-z0-9-]+)'/g)) ids.add(m[1])
    }
  }
  return ids
}

describe('macro_indicators DB coverage for ingested series', () => {
  const committed = committedIndicatorIds()

  test('every enabled BCCh series has a committed macro_indicators row', () => {
    const missing = getEnabledBcchSeries()
      .map((d) => d.fallbackStaticId)
      .filter((id) => !committed.has(id))
    assert.deepEqual(
      missing,
      [],
      `Enabled BCCh series without a macro_indicators row (the daily cron will FK-fail): ${missing.join(', ')}`,
    )
  })

  test('every enabled FRED series has a committed macro_indicators row', () => {
    const missing = getEnabledFredSeries()
      .map((d) => d.fallbackStaticId)
      .filter((id) => !committed.has(id))
    assert.deepEqual(
      missing,
      [],
      `Enabled FRED series without a macro_indicators row: ${missing.join(', ')}`,
    )
  })

  test('the audit migration exists, is idempotent, and covers btp10/pdbc90/eurclp', () => {
    const sql = readFileSync(
      join(SQL_DIR, 'migrations', '20260721120000_macro_indicators_btp2_pdbc14.sql'),
      'utf8',
    )
    assert.match(sql, /on conflict \(id\) do nothing/i)
    for (const id of ['btp10', 'pdbc90', 'eurclp']) {
      assert.ok(committed.has(id), `${id} committed`)
      assert.match(sql, new RegExp(`'${id}'`))
    }
  })
})

describe('incremental ingestion can actually store monthly prints', () => {
  // A monthly print's observation_date lags its publication by 4-8 weeks
  // (May's IPC arrives in June dated 2026-05-01), so a 14-day incremental
  // window could never persist a new monthly observation — desempleo/imacec
  // sat frozen on April data while BCCh already served May/June (confirmed
  // live 2026-07-21: the widened window immediately advanced all 5 monthlies).
  test('monthly-frequency series get a widened incremental window', () => {
    const src = readFileSync(join(ROOT, 'src/lib/ingestion/bcchMacroIngestion.ts'), 'utf8')
    assert.match(src, /MONTHLY_INCREMENTAL_DAYS_BACK = 120/)
    assert.match(src, /def\.frequency === 'monthly'/)
    assert.match(src, /p\.date >= seriesRangeFrom/)
  })
})
