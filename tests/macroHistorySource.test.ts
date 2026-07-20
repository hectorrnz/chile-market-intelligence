// 2026-07-20 — pickFreshestMacroSource, the pure decision helper behind the
// resolveMacroHistory freshness fix (macro popup charts showing stale
// persisted data — e.g. May CPI when a June print already existed live).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pickFreshestMacroSource } from '../src/lib/providers/macroHistorySource.ts'

describe('pickFreshestMacroSource', () => {
  it('prefers live when it is strictly fresher than persisted', () => {
    const result = pickFreshestMacroSource({
      persistedOk: true, persistedLatestDate: '2026-05-01',
      liveOk: true, liveLatestDate: '2026-06-01',
    })
    assert.equal(result, 'live')
  })

  it('prefers persisted when live is not fresher (equal dates)', () => {
    // Avoids an unnecessary preference for live when both sources already
    // agree — persisted is the cheaper read.
    const result = pickFreshestMacroSource({
      persistedOk: true, persistedLatestDate: '2026-07-20',
      liveOk: true, liveLatestDate: '2026-07-20',
    })
    assert.equal(result, 'persisted')
  })

  it('prefers persisted when live is actually older', () => {
    const result = pickFreshestMacroSource({
      persistedOk: true, persistedLatestDate: '2026-07-20',
      liveOk: true, liveLatestDate: '2026-07-13',
    })
    assert.equal(result, 'persisted')
  })

  it('falls back to live when persisted is unusable, regardless of live freshness', () => {
    const result = pickFreshestMacroSource({
      persistedOk: false, persistedLatestDate: '',
      liveOk: true, liveLatestDate: '2020-01-01',
    })
    assert.equal(result, 'live')
  })

  it('falls back to persisted when live is unusable', () => {
    const result = pickFreshestMacroSource({
      persistedOk: true, persistedLatestDate: '2026-05-01',
      liveOk: false, liveLatestDate: '',
    })
    assert.equal(result, 'persisted')
  })

  it('returns none when neither source is usable', () => {
    const result = pickFreshestMacroSource({
      persistedOk: false, persistedLatestDate: '',
      liveOk: false, liveLatestDate: '',
    })
    assert.equal(result, 'none')
  })
})

describe('resolveMacroHistory — wired to fetch both sources and compare freshness', () => {
  const src = readFileSync(new URL('../src/lib/providers/macroProvider.ts', import.meta.url), 'utf8')

  it('fetches persisted and live in parallel rather than only falling through on failure', () => {
    assert.ok(src.includes('const [persistedResult, liveResult] = await Promise.all(['))
  })

  it('uses pickFreshestMacroSource rather than a bare point-count check to choose', () => {
    assert.ok(src.includes('pickFreshestMacroSource({ persistedOk, persistedLatestDate, liveOk, liveLatestDate })'))
  })

  it('strict Supabase mode (DB_MODE=supabase) is untouched — persisted-only, no freshness comparison', () => {
    assert.ok(src.includes("dbSource === 'supabase' && dbMode === 'supabase'"))
  })
})
