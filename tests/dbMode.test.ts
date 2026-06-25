import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseDbMode, decideDbSource } from '../src/lib/db/dbMode.ts'

describe('parseDbMode', () => {
  it('returns static for undefined', () => {
    assert.equal(parseDbMode(undefined), 'static')
  })

  it('returns static for empty string', () => {
    assert.equal(parseDbMode(''), 'static')
  })

  it('returns static for unknown value', () => {
    assert.equal(parseDbMode('postgres'), 'static')
  })

  it('returns supabase for "supabase"', () => {
    assert.equal(parseDbMode('supabase'), 'supabase')
  })

  it('returns hybrid for "hybrid"', () => {
    assert.equal(parseDbMode('hybrid'), 'hybrid')
  })

  it('is case-insensitive', () => {
    assert.equal(parseDbMode('SUPABASE'), 'supabase')
    assert.equal(parseDbMode('Hybrid'), 'hybrid')
  })

  it('trims whitespace', () => {
    assert.equal(parseDbMode('  supabase  '), 'supabase')
  })
})

describe('decideDbSource', () => {
  it('returns static for static mode regardless of Supabase config', () => {
    // No env vars set in test — Supabase is not configured.
    assert.equal(decideDbSource('static'), 'static')
  })

  it('returns static for supabase mode when Supabase is not configured', () => {
    // NEXT_PUBLIC_SUPABASE_URL is not set in test env.
    assert.equal(decideDbSource('supabase'), 'static')
  })

  it('returns static for hybrid mode when Supabase is not configured', () => {
    assert.equal(decideDbSource('hybrid'), 'static')
  })
})
