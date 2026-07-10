// Tests for the "a note was called" notice feature: the scheduled monitoring
// cron already auto-transitions a note to an archived status the day its
// autocall observation comes due (monitoring.ts's shouldUpdateNoteStatus) —
// this feature surfaces that to the user via a dismissible banner on next
// visit, backed by a localStorage "seen" list (no schema change).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findNewlyCalledNotes, archivedNoteIds, markNotesSeen } from '../src/lib/structuredNotes/calledNotice.ts'
import type { StructuredNote } from '../src/lib/structuredNotes/types.ts'

const ROOT = join(import.meta.dirname, '..')
const PAGE = join(ROOT, 'src/app/structured-notes/page.tsx')

function note(id: string, status: StructuredNote['status']): StructuredNote {
  return {
    id,
    status,
    isin: `ISIN-${id}`,
    issuerDisplayName: 'Test Issuer',
    productName: null,
    sourceName: null,
    structureType: null,
    currency: 'USD',
    issueSize: null,
    couponRateAnnualized: null,
    tradeDate: null,
    issueDate: null,
    finalValuationDate: null,
    maturityDate: null,
    knockInBarrierPct: null,
    archivedAt: status !== 'active' ? '2026-07-09T21:30:00.000Z' : null,
    underlyings: [],
    observations: [],
    allocations: [],
  } as unknown as StructuredNote
}

describe('findNewlyCalledNotes', () => {
  it('returns [] when the seen-list has never been initialized (seenIds === null) — never floods on first load', () => {
    const notes = [note('a', 'autocalled'), note('b', 'active')]
    assert.deepEqual(findNewlyCalledNotes(notes, null), [])
  })

  it('returns archived notes not yet in the seen-list', () => {
    const notes = [note('a', 'autocalled'), note('b', 'active'), note('c', 'matured')]
    const result = findNewlyCalledNotes(notes, ['a'])
    assert.deepEqual(result.map((n) => n.id), ['c'])
  })

  it('excludes active notes even if somehow present with an id not in the seen-list', () => {
    const notes = [note('a', 'active')]
    assert.deepEqual(findNewlyCalledNotes(notes, []), [])
  })

  it('excludes notes already in the seen-list', () => {
    const notes = [note('a', 'autocalled')]
    assert.deepEqual(findNewlyCalledNotes(notes, ['a']), [])
  })

  it('treats every ARCHIVED_STATUSES value as "called" for notice purposes', () => {
    const notes = [note('a', 'autocalled'), note('b', 'matured'), note('c', 'cancelled'), note('d', 'defaulted')]
    const result = findNewlyCalledNotes(notes, [])
    assert.deepEqual(result.map((n) => n.id).sort(), ['a', 'b', 'c', 'd'])
  })
})

describe('archivedNoteIds', () => {
  it('returns only ids of notes in an archived status', () => {
    const notes = [note('a', 'autocalled'), note('b', 'active'), note('c', 'draft')]
    assert.deepEqual(archivedNoteIds(notes), ['a'])
  })

  it('returns [] for an all-active book', () => {
    assert.deepEqual(archivedNoteIds([note('a', 'active')]), [])
  })
})

describe('markNotesSeen', () => {
  it('unions a null seen-list with new ids', () => {
    assert.deepEqual(markNotesSeen(null, ['a', 'b']), ['a', 'b'])
  })

  it('unions and dedupes against an existing seen-list', () => {
    assert.deepEqual(markNotesSeen(['a'], ['a', 'b']), ['a', 'b'])
  })

  it('is idempotent — marking the same ids seen twice has no effect', () => {
    const once = markNotesSeen(['a'], ['b'])
    const twice = markNotesSeen(once, ['b'])
    assert.deepEqual(once, twice)
  })
})

describe('Structured Notes page wiring', () => {
  const src = readFileSync(PAGE, 'utf8')

  it('persists the seen-called-notes list in localStorage via usePersistentState (per-browser, no schema change)', () => {
    assert.ok(src.includes("usePersistentState<string[] | null>('cmi.sn.seenCalledNoteIds', null)"))
  })

  it('computes newly-called notes during render, not inside a useEffect (avoids the set-state-in-effect lint rule; matches the codebase\'s established render-time previous-value pattern)', () => {
    const startIdx = src.indexOf('if (!loading) {')
    assert.ok(startIdx >= 0, 'expected a render-time "if (!loading)" derived-state block')
    const callIdx = src.indexOf('findNewlyCalledNotes', startIdx)
    assert.ok(callIdx > startIdx && callIdx - startIdx < 700, 'findNewlyCalledNotes should be called shortly after the if (!loading) guard')
    const between = src.slice(startIdx, callIdx)
    assert.ok(!between.includes('useEffect'), 'the derived-state block must not be wrapped in useEffect')
  })

  it('renders a dismissible banner when calledNotice is non-empty', () => {
    assert.ok(src.includes('calledNotice.length > 0'))
    assert.ok(src.includes('dismissCalledNotice'))
    assert.ok(src.includes('t.sn.calledNotice.dismiss'))
  })

  it('marking a note "Called" via the manual checkbox immediately marks it seen (no self-triggered notice)', () => {
    const idx = src.indexOf('async function setCalled')
    const body = src.slice(idx, idx + 500)
    assert.ok(body.includes('markNotesSeen'))
  })

  it('dismissing the notice folds the dismissed note ids into the seen-list', () => {
    const idx = src.indexOf('function dismissCalledNotice')
    const body = src.slice(idx, idx + 300)
    assert.ok(body.includes('markNotesSeen'))
    assert.ok(body.includes('setCalledNotice([])'))
  })
})

describe('i18n — calledNotice keys present in both languages', () => {
  const src = readFileSync(join(ROOT, 'src/lib/i18n.ts'), 'utf8')

  it('has headingOne/headingMany/detail/dismiss keys', () => {
    const count = (src.match(/calledNotice:\s*\{/g) ?? []).length
    assert.equal(count, 2, 'expected one calledNotice block in dict.en and one in dict.es')
  })
})
