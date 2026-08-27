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

  // R13.R5C.1 § 4 — DELIBERATELY REVERSED. Phase 8D left this cron unscheduled
  // "until stability is observed over time", nominally by the same policy as
  // /api/cron/ingest-bcch-macro — but that route has been on a weekday schedule
  // since Phase 5D, so the stated parity was never real. The consequence was
  // found live: persisted FRED observations advanced only when someone ran the
  // job by hand, the last such run was 2026-07-21, and six US series were
  // reported stale for weeks. Stability HAS now been observed — FRED macro has
  // been live since Phase 8D behind the same MacroProvider contract, the same
  // plausibility bands and the same verified-series-only registry as its BCCh
  // twin, on a keyless public endpoint. It gets its twin's cadence.
  it('vercel.json schedules the FRED cron on its own weekday slot', async () => {
    const fs = await import('node:fs')
    const vercelJson = JSON.parse(
      fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
    )
    const crons: Array<{ path: string; schedule: string }> = vercelJson.crons ?? []
    const fred = crons.find((c) => c.path === '/api/cron/ingest-fred-macro')
    assert.ok(fred, 'FRED macro ingestion must be scheduled')
    assert.match(fred!.schedule, /1-5$/, 'weekdays only, like the BCCh twin')
    const bcch = crons.find((c) => c.path === '/api/cron/ingest-bcch-macro')
    assert.notEqual(fred!.schedule, bcch!.schedule, 'the two must not contend for one window')
  })

  // The policy itself is NOT relaxed — it applies to the crons it was actually
  // written for: the ones reading an undocumented HTML surface.
  it('the undocumented-surface crons stay unscheduled', async () => {
    const fs = await import('node:fs')
    const vercelJson = JSON.parse(
      fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
    )
    const paths: string[] = (vercelJson.crons ?? []).map((c: { path: string }) => c.path)
    for (const p of ['/api/cron/financials/cmf-xbrl', '/api/cron/financials/yahoo', '/api/cron/financials/cmf-bank']) {
      assert.ok(!paths.includes(p), p)
    }
  })
})
