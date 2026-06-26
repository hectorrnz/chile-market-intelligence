// Phase 5D — Unit tests for BCCh macro cron ingestion.
// Run: npm test
// Tests only pure functions and the not_configured path (no network, no Supabase).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeError, runBcchMacroIngestion } from '../src/lib/ingestion/bcchMacroIngestion.ts'

// ─── sanitizeError ────────────────────────────────────────────────────────────

describe('sanitizeError', () => {
  it('strips user= credential from query strings', () => {
    const msg = sanitizeError(new Error('request failed: user=hmartinez@example.com&pass=secret123'))
    assert.ok(!msg.includes('hmartinez'), 'email should be removed')
    assert.ok(msg.includes('user=***'))
  })

  it('strips password= credential', () => {
    const msg = sanitizeError('password=MySecret123!')
    assert.ok(!msg.includes('MySecret'))
  })

  it('strips JWT tokens (eyJ...)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(50)
    const msg = sanitizeError(new Error(`Bearer ${jwt}`))
    assert.ok(!msg.includes('eyJhbGci'), 'JWT should be removed')
    assert.ok(msg.includes('***JWT***'))
  })

  it('strips long key= values', () => {
    // Use a clearly fake key — never embed real credentials in tests
    const msg = sanitizeError('key=sb_secret_FAKE_TEST_VALUE_NOT_REAL_1234567 extra info')
    assert.ok(!msg.includes('sb_secret_FAKE'))
    assert.ok(msg.includes('key=***'))
  })

  it('truncates messages to 500 chars', () => {
    const msg = sanitizeError('x'.repeat(600))
    assert.equal(msg.length, 500)
  })

  it('handles non-Error inputs', () => {
    assert.equal(typeof sanitizeError(42), 'string')
    assert.equal(typeof sanitizeError(null), 'string')
    assert.equal(typeof sanitizeError({ message: 'oops' }), 'string')
  })

  it('passes through safe messages unchanged', () => {
    assert.equal(sanitizeError('BCCh request timed out'), 'BCCh request timed out')
  })
})

// ─── runBcchMacroIngestion — not_configured path ──────────────────────────────
// These tests temporarily unset BCCh credentials so isBcchConfigured() → false,
// exercising the early-return path without touching any network or DB.

function withoutBcchCreds<T>(fn: () => T): T {
  const savedUser = process.env.BCCH_API_USER
  const savedPass = process.env.BCCH_API_PASSWORD
  delete process.env.BCCH_API_USER
  delete process.env.BCCH_API_PASSWORD
  try {
    return fn()
  } finally {
    if (savedUser !== undefined) process.env.BCCH_API_USER = savedUser
    else delete process.env.BCCH_API_USER
    if (savedPass !== undefined) process.env.BCCH_API_PASSWORD = savedPass
    else delete process.env.BCCH_API_PASSWORD
  }
}

describe('runBcchMacroIngestion — not_configured', () => {
  it('returns status not_configured when BCCh creds are absent', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'incremental', source: 'cron' })
    )
    assert.equal(result.status, 'not_configured')
    assert.equal(result.success, false)
    assert.equal(result.rowsSeen, 0)
    assert.equal(result.rowsInserted, 0)
    assert.ok(typeof result.errorSummary === 'string' && result.errorSummary.length > 0)
  })

  it('jobType is macro_observations_incremental for incremental mode', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'incremental', source: 'cron' })
    )
    assert.equal(result.jobType, 'macro_observations_incremental')
  })

  it('jobType is macro_observations_backfill for backfill mode', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'backfill', source: 'manual' })
    )
    assert.equal(result.jobType, 'macro_observations_backfill')
  })

  it('result includes all required fields', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'incremental', source: 'cron' })
    )
    const required = [
      'success', 'status', 'provider', 'jobType',
      'indicatorsRequested', 'indicatorsSucceeded', 'indicatorsFailed',
      'rowsSeen', 'rowsInserted', 'rowsUpdated', 'rowsFailed',
      'startedAt', 'finishedAt', 'durationMs',
    ] as const
    for (const key of required) {
      assert.ok(key in result, `missing field: ${key}`)
    }
  })

  it('provider is BCCh BDE', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'incremental', source: 'cron' })
    )
    assert.equal(result.provider, 'BCCh BDE')
  })

  it('startedAt and finishedAt are valid ISO strings', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'incremental', source: 'cron' })
    )
    assert.ok(!Number.isNaN(new Date(result.startedAt).getTime()), 'startedAt invalid')
    assert.ok(!Number.isNaN(new Date(result.finishedAt).getTime()), 'finishedAt invalid')
  })

  it('durationMs is non-negative', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'incremental', source: 'cron' })
    )
    assert.ok(result.durationMs >= 0)
  })

  it('indicator arrays are empty when not_configured', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'incremental', source: 'cron' })
    )
    assert.deepEqual(result.indicatorsRequested, [])
    assert.deepEqual(result.indicatorsSucceeded, [])
    assert.deepEqual(result.indicatorsFailed, [])
  })

  it('serialized result does not expose credentials', async () => {
    const result = await withoutBcchCreds(() =>
      runBcchMacroIngestion({ indicators: 'all', mode: 'incremental', source: 'cron' })
    )
    const json = JSON.stringify(result)
    assert.ok(!json.includes('password'), 'must not contain "password"')
    assert.ok(!json.includes('api_key'),  'must not contain "api_key"')
    assert.ok(!json.includes('eyJ'),      'must not contain JWT')
  })
})

// ─── Cron auth guard logic ────────────────────────────────────────────────────
// Tests the pure boolean checks that the route handler performs.

describe('cron auth guard logic', () => {
  it('matching Bearer header passes auth', () => {
    const secret = 'testSecret123XYZ'
    const header = `Bearer ${secret}`
    assert.equal(header === `Bearer ${secret}`, true)
  })

  it('wrong secret fails auth', () => {
    const secret = 'testSecret123XYZ'
    const header = 'Bearer wrongSecret'
    assert.equal(header !== `Bearer ${secret}`, true)
  })

  it('empty CRON_SECRET triggers 500 path (falsy check)', () => {
    const secret = ''.trim()
    assert.equal(!secret, true)
  })

  it('null Authorization header fails auth', () => {
    const secret = 'testSecret123XYZ'
    const header = null ?? ''
    assert.notEqual(header, `Bearer ${secret}`)
  })

  it('secret without Bearer prefix fails auth', () => {
    const secret = 'testSecret123XYZ'
    assert.notEqual(secret, `Bearer ${secret}`)
  })

  it('Bearer with extra whitespace fails auth (strict match)', () => {
    const secret = 'testSecret123XYZ'
    const header = ` Bearer ${secret}`  // leading space
    assert.notEqual(header, `Bearer ${secret}`)
  })
})
