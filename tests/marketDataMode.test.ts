// Run with: npm test
// Phase 4C.3: MARKET_DATA_MODE repurposed to static|supabase|hybrid — 'supabase'
// reads persisted Yahoo Finance snapshots (see supabaseMarketProvider.ts /
// marketReadPriority.test.ts), replacing the old 'live' (Brain Data) value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarketDataMode, decideMarketSource } from '../src/lib/providers/market/marketDataMode.ts'

// ── parseMarketDataMode ───────────────────────────────────────────────────────

test('parseMarketDataMode: recognises static', () => {
  assert.equal(parseMarketDataMode('static'), 'static')
  assert.equal(parseMarketDataMode('STATIC'), 'static')
})

test('parseMarketDataMode: recognises supabase', () => {
  assert.equal(parseMarketDataMode('supabase'), 'supabase')
  assert.equal(parseMarketDataMode('SUPABASE'), 'supabase')
})

test('parseMarketDataMode: recognises hybrid', () => {
  assert.equal(parseMarketDataMode('hybrid'), 'hybrid')
})

test('parseMarketDataMode: unknown/empty falls back to static', () => {
  assert.equal(parseMarketDataMode(undefined), 'static')
  assert.equal(parseMarketDataMode(null), 'static')
  assert.equal(parseMarketDataMode(''), 'static')
  assert.equal(parseMarketDataMode('BRAIN_DATA'), 'static')
  assert.equal(parseMarketDataMode('live'), 'static', 'old "live" value is no longer recognised')
})

// ── decideMarketSource ────────────────────────────────────────────────────────

test('decideMarketSource: static requested → always static, no live', () => {
  const r = decideMarketSource('static', false)
  assert.equal(r.dataModeUsed, 'static')
  assert.equal(r.status, 'static')
  assert.equal(r.liveAvailable, false)
})

test('decideMarketSource: hybrid + supabase ok → persisted', () => {
  const r = decideMarketSource('hybrid', true)
  assert.equal(r.dataModeUsed, 'hybrid')
  assert.equal(r.status, 'persisted')
  assert.equal(r.liveAvailable, true)
})

test('decideMarketSource: hybrid + supabase failed → hybrid-fallback', () => {
  const r = decideMarketSource('hybrid', false, 'Supabase not configured')
  assert.equal(r.dataModeUsed, 'static')
  assert.equal(r.status, 'hybrid-fallback')
  assert.equal(r.liveAvailable, false)
  assert.ok(r.fallbackReason?.includes('Supabase'))
})

test('decideMarketSource: supabase requested + supabase failed → live-unavailable', () => {
  const r = decideMarketSource('supabase', false, 'No persisted stock snapshots available')
  assert.equal(r.status, 'live-unavailable')
  assert.equal(r.liveAvailable, false)
})

test('decideMarketSource: supabase requested + supabase ok → persisted', () => {
  const r = decideMarketSource('supabase', true)
  assert.equal(r.dataModeUsed, 'supabase')
  assert.equal(r.status, 'persisted')
  assert.equal(r.liveAvailable, true)
})
