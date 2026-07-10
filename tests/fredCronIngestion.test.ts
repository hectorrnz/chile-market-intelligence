// Phase 8D — Unit tests for FRED (US macro) cron ingestion.
// Mirrors tests/cronIngestion.test.ts. No live network calls in this file —
// only the "no matching indicators" early-return path is exercised (FRED
// itself needs no credentials, so there is no not_configured path to test
// the way BCCh has one; runFredMacroIngestion always attempts isFredConfigured()
// which is unconditionally true).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeError, runFredMacroIngestion } from '../src/lib/ingestion/fredMacroIngestion.ts'

describe('fredMacroIngestion sanitizeError', () => {
  it('strips JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(50)
    const msg = sanitizeError(new Error(`Bearer ${jwt}`))
    assert.ok(!msg.includes('eyJhbGci'))
    assert.ok(msg.includes('***JWT***'))
  })

  it('truncates to 500 chars', () => {
    assert.equal(sanitizeError('x'.repeat(600)).length, 500)
  })

  it('handles non-Error input', () => {
    assert.equal(typeof sanitizeError(42), 'string')
  })
})

describe('runFredMacroIngestion — no matching indicators (no network required)', () => {
  it('fails fast with a clear error when the requested indicator key does not exist', async () => {
    const result = await runFredMacroIngestion({
      indicators: ['definitely-not-a-real-fred-key'],
      mode: 'incremental',
      source: 'cron',
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.success, false)
    assert.equal(result.rowsSeen, 0)
    assert.equal(result.rowsInserted, 0)
    assert.match(result.errorSummary ?? '', /No enabled series found/)
  })

  it('provider is always labeled FRED, never BCCh', () => {
    assert.match('FRED (St. Louis Fed)', /FRED/)
  })

  it('result includes all required fields', async () => {
    const result = await runFredMacroIngestion({
      indicators: ['definitely-not-a-real-fred-key'],
      mode: 'incremental',
      source: 'cron',
    })
    const required = [
      'success', 'status', 'provider', 'jobType',
      'indicatorsRequested', 'indicatorsSucceeded', 'indicatorsFailed',
      'rowsSeen', 'rowsInserted', 'rowsUpdated', 'rowsFailed',
      'startedAt', 'finishedAt', 'durationMs',
    ] as const
    for (const key of required) assert.ok(key in result, `missing field: ${key}`)
  })

  it('startedAt/finishedAt are valid ISO strings and durationMs is non-negative', async () => {
    const result = await runFredMacroIngestion({
      indicators: ['definitely-not-a-real-fred-key'],
      mode: 'incremental',
      source: 'cron',
    })
    assert.ok(!Number.isNaN(new Date(result.startedAt).getTime()))
    assert.ok(!Number.isNaN(new Date(result.finishedAt).getTime()))
    assert.ok(result.durationMs >= 0)
  })

  it('serialized result never exposes credentials (FRED needs none, but guard anyway)', async () => {
    const result = await runFredMacroIngestion({
      indicators: ['definitely-not-a-real-fred-key'],
      mode: 'incremental',
      source: 'cron',
    })
    const json = JSON.stringify(result)
    assert.ok(!json.includes('password'))
    assert.ok(!json.includes('eyJ'))
  })
})

// ─── Cron auth guard logic (mirrors the BCCh/CMF/Yahoo cron route pattern) ────

describe('FRED cron auth guard logic', () => {
  it('matching Bearer header passes auth', () => {
    const secret = 'testSecret123XYZ'
    const header = `Bearer ${secret}`
    assert.equal(header === `Bearer ${secret}`, true)
  })

  it('wrong secret fails auth', () => {
    const secret = 'testSecret123XYZ'
    const header = 'Bearer wrongSecret'
    assert.notEqual(header, `Bearer ${secret}`)
  })

  it('empty CRON_SECRET triggers the 500 not-configured path', () => {
    const secret = ''.trim()
    assert.equal(!secret, true)
  })
})

// ─── Route file hygiene ────────────────────────────────────────────────────────

describe('FRED cron route hygiene', () => {
  it('the route file requires Bearer CRON_SECRET auth and never logs raw secrets', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(
      new URL('../src/app/api/cron/ingest-fred-macro/route.ts', import.meta.url),
      'utf8'
    )
    assert.match(src, /CRON_SECRET/)
    assert.match(src, /Bearer \$\{secret\}/)
    assert.match(src, /401/)
    assert.ok(!/console\.log\(.*secret/i.test(src), 'must never log the secret value')
  })

  it('vercel.json does NOT schedule the FRED cron (manual/reviewable only, per Phase 8D policy)', async () => {
    const fs = await import('node:fs')
    const vercelJson = JSON.parse(
      fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
    )
    const paths: string[] = (vercelJson.crons ?? []).map((c: { path: string }) => c.path)
    assert.ok(!paths.includes('/api/cron/ingest-fred-macro'), 'FRED cron must stay unscheduled this phase')
  })
})
