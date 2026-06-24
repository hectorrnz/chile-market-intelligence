// Run with: npm test  (Node strips TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDataMode, decideSource } from '../src/lib/providers/dataMode.ts'

test('parseDataMode normalizes valid modes and defaults to static', () => {
  assert.equal(parseDataMode('static'), 'static')
  assert.equal(parseDataMode('live'), 'live')
  assert.equal(parseDataMode('hybrid'), 'hybrid')
  assert.equal(parseDataMode('HYBRID'), 'hybrid')
  assert.equal(parseDataMode('  live  '), 'live')
})

test('parseDataMode falls back to static for unknown/empty input', () => {
  assert.equal(parseDataMode(undefined), 'static')
  assert.equal(parseDataMode(null), 'static')
  assert.equal(parseDataMode(''), 'static')
  assert.equal(parseDataMode('nonsense'), 'static')
})

test('decideSource: static mode never goes live', () => {
  const d = decideSource('static', true)
  assert.equal(d.dataModeUsed, 'static')
  assert.equal(d.status, 'static')
  assert.equal(d.liveAvailable, false)
})

test('decideSource: live mode with working provider serves live', () => {
  const d = decideSource('live', true)
  assert.equal(d.dataModeUsed, 'live')
  assert.equal(d.status, 'live')
  assert.equal(d.liveAvailable, true)
})

test('decideSource: live mode with failed provider reports live-unavailable', () => {
  const d = decideSource('live', false, 'BCCh credentials not configured')
  assert.equal(d.dataModeUsed, 'static')
  assert.equal(d.status, 'live-unavailable')
  assert.equal(d.liveAvailable, false)
  assert.equal(d.fallbackReason, 'BCCh credentials not configured')
})

test('decideSource: hybrid mode falls back to static silently', () => {
  const d = decideSource('hybrid', false, 'No live provider series code mapped yet')
  assert.equal(d.dataModeUsed, 'static')
  assert.equal(d.status, 'hybrid-fallback')
  assert.equal(d.liveAvailable, false)
  assert.equal(d.fallbackReason, 'No live provider series code mapped yet')
})

test('decideSource: hybrid mode with working provider serves live', () => {
  const d = decideSource('hybrid', true)
  assert.equal(d.dataModeUsed, 'hybrid')
  assert.equal(d.status, 'live')
  assert.equal(d.liveAvailable, true)
})
