// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarketDataMode, decideMarketSource } from '../src/lib/providers/market/marketDataMode.ts'

// ── parseMarketDataMode ───────────────────────────────────────────────────────

test('parseMarketDataMode: recognises static', () => {
  assert.equal(parseMarketDataMode('static'), 'static')
  assert.equal(parseMarketDataMode('STATIC'), 'static')
})

test('parseMarketDataMode: recognises live', () => {
  assert.equal(parseMarketDataMode('live'), 'live')
  assert.equal(parseMarketDataMode('LIVE'), 'live')
})

test('parseMarketDataMode: recognises hybrid', () => {
  assert.equal(parseMarketDataMode('hybrid'), 'hybrid')
})

test('parseMarketDataMode: unknown/empty falls back to static', () => {
  assert.equal(parseMarketDataMode(undefined), 'static')
  assert.equal(parseMarketDataMode(null), 'static')
  assert.equal(parseMarketDataMode(''), 'static')
  assert.equal(parseMarketDataMode('BRAIN_DATA'), 'static')
})

// ── decideMarketSource ────────────────────────────────────────────────────────

test('decideMarketSource: static requested → always static, no live', () => {
  const r = decideMarketSource('static', false)
  assert.equal(r.dataModeUsed, 'static')
  assert.equal(r.status, 'static')
  assert.equal(r.liveAvailable, false)
})

test('decideMarketSource: hybrid + live ok → live', () => {
  const r = decideMarketSource('hybrid', true)
  assert.equal(r.dataModeUsed, 'hybrid')
  assert.equal(r.status, 'live')
  assert.equal(r.liveAvailable, true)
})

test('decideMarketSource: hybrid + live failed → hybrid-fallback', () => {
  const r = decideMarketSource('hybrid', false, 'Brain Data credentials not configured')
  assert.equal(r.dataModeUsed, 'static')
  assert.equal(r.status, 'hybrid-fallback')
  assert.equal(r.liveAvailable, false)
  assert.ok(r.fallbackReason?.includes('Brain Data'))
})

test('decideMarketSource: live requested + live failed → live-unavailable', () => {
  const r = decideMarketSource('live', false, 'Brain Data endpoint mapping pending')
  assert.equal(r.status, 'live-unavailable')
  assert.equal(r.liveAvailable, false)
})

test('decideMarketSource: live requested + live ok → live', () => {
  const r = decideMarketSource('live', true)
  assert.equal(r.dataModeUsed, 'live')
  assert.equal(r.status, 'live')
  assert.equal(r.liveAvailable, true)
})
