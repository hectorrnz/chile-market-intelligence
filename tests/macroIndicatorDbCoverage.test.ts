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
