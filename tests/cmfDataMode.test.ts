// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCmfDataMode, decideCmfSource } from '../src/lib/providers/cmf/cmfDataMode.ts'

// ── parseCmfDataMode ──────────────────────────────────────────────────────────

test('parseCmfDataMode: recognises static', () => {
  assert.equal(parseCmfDataMode('static'), 'static')
  assert.equal(parseCmfDataMode('STATIC'), 'static')
})

test('parseCmfDataMode: recognises live', () => {
  assert.equal(parseCmfDataMode('live'), 'live')
  assert.equal(parseCmfDataMode('LIVE'), 'live')
})

test('parseCmfDataMode: recognises hybrid', () => {
  assert.equal(parseCmfDataMode('hybrid'), 'hybrid')
})

test('parseCmfDataMode: unknown/empty/null falls back to static', () => {
  assert.equal(parseCmfDataMode(undefined), 'static')
  assert.equal(parseCmfDataMode(null), 'static')
  assert.equal(parseCmfDataMode(''), 'static')
  assert.equal(parseCmfDataMode('scrape'), 'static')
  assert.equal(parseCmfDataMode('CMF_LIVE'), 'static')
})

// ── decideCmfSource ───────────────────────────────────────────────────────────

test('decideCmfSource: static requested → always static', () => {
  const r = decideCmfSource('static', false)
  assert.equal(r.dataModeUsed, 'static')
  assert.equal(r.status, 'static')
  assert.equal(r.liveAvailable, false)
})

test('decideCmfSource: static requested with liveOk true → still static', () => {
  const r = decideCmfSource('static', true)
  assert.equal(r.status, 'static')
  assert.equal(r.liveAvailable, false)
})

test('decideCmfSource: hybrid + live ok → live', () => {
  const r = decideCmfSource('hybrid', true)
  assert.equal(r.dataModeUsed, 'hybrid')
  assert.equal(r.status, 'live')
  assert.equal(r.liveAvailable, true)
})

test('decideCmfSource: hybrid + live failed → hybrid-fallback with reason', () => {
  const r = decideCmfSource('hybrid', false, 'CMF live ingestion not configured')
  assert.equal(r.dataModeUsed, 'static')
  assert.equal(r.status, 'hybrid-fallback')
  assert.equal(r.liveAvailable, false)
  assert.ok(r.fallbackReason?.includes('CMF'))
})

test('decideCmfSource: live requested + live failed → live-unavailable', () => {
  const r = decideCmfSource('live', false, 'CMF live parser pending')
  assert.equal(r.status, 'live-unavailable')
  assert.equal(r.liveAvailable, false)
  assert.ok(r.fallbackReason?.includes('pending'))
})

test('decideCmfSource: live requested + live ok → live', () => {
  const r = decideCmfSource('live', true)
  assert.equal(r.dataModeUsed, 'live')
  assert.equal(r.status, 'live')
  assert.equal(r.liveAvailable, true)
})
