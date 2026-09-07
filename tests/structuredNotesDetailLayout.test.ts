// R13.7B2.2.2 § 1-3, § 11-13 A-K — Structured Notes detail page, final layout.
//
//   ROW 1  [ General Terms (LEFT, 3fr)                     ][ Allocation by Entity (RIGHT, 2fr) ]
//   ROW 2  [ Current levels & distance to barrier (LEFT, 3fr) ][ Underlyings (RIGHT, 2fr)      ]
//   then the Observation Schedule.
//
// Source-scan over the page (this repo's convention — no DOM harness), plus
// data checks against the review fixture where a layout claim depends on data.
// Everything B2.2 / B2.2.1 established is asserted by their own suites and is
// only re-touched here where this stage could have disturbed it (§ 12).
//
// Pure: no Supabase, no network, no Next.js runtime.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DEFAULT_ENTITIES } from '../src/lib/structuredNotes/types.ts'
import { buildReviewFixture, CALLED_PENDING_FIXTURE_ID } from '../src/lib/structuredNotes/fixtures/calledStateFixture.ts'
import { dict } from '../src/lib/i18n.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DETAIL = read('../src/app/structured-notes/[id]/page.tsx')
const DETAIL_CODE = code(DETAIL)
const GAUGE = read('../src/components/fable/BarrierGauge.tsx')
const CSS = read('../src/app/globals.css')
const WORKFLOW = read('../.github/workflows/structured-notes-event-state.yml')

/** The two rows and the schedule, sliced by their own markers so an assertion cannot match the wrong region. */
const ROW1 = DETAIL.slice(DETAIL.indexOf('{/* ROW 1'), DETAIL.indexOf('{/* ROW 2'))
const ROW2 = DETAIL.slice(DETAIL.indexOf('{/* ROW 2'), DETAIL.indexOf('{/* Observation schedule'))
const SCHEDULE = DETAIL.slice(DETAIL.indexOf('{/* Observation schedule'))

const TWO_COL = 'grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3.5 mb-3.5 lg:items-stretch'
const TRACKS = /lg:grid-cols-\[minmax\(0,(\d+)fr\)_minmax\(0,(\d+)fr\)\]/

// ═════════════════════════════════════════════════════════════════════════════
// A–C · ROW 1
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 1 — General Terms and Allocation by Entity share one desktop row', () => {
  it('A · both sections sit inside ONE two-column grid', () => {
    assert.ok(ROW1.length > 0 && ROW2.length > 0, 'the row markers exist')
    assert.ok(ROW1.includes(TWO_COL), 'row 1 uses the shared two-column grid')
    assert.ok(ROW1.includes('{t.sn.generalTerms}'))
    assert.ok(ROW1.includes('{t.sn.allocations}'))
    assert.equal((ROW1.match(/<GlassSurface variant="card" as="section"/g) ?? []).length, 2, 'exactly two cards in row 1')
  })

  it('B · General Terms is the FIRST (left) child, Allocation by Entity the SECOND (right)', () => {
    const grid = ROW1.indexOf(TWO_COL)
    const terms = ROW1.indexOf('{t.sn.generalTerms}')
    const alloc = ROW1.indexOf('{t.sn.allocations}')
    assert.ok(grid < terms && terms < alloc, 'DOM order is left → right and top → bottom when stacked')
    // No order/reverse utility may reorder them visually.
    assert.doesNotMatch(ROW1, /\border-\d|order-first|order-last|flex-row-reverse|grid-flow-col-dense/)
  })

  it('C · the note-level Delete control belongs to the Allocation section header — not to the terms card, not detached', () => {
    const alloc = ROW1.slice(ROW1.indexOf('{t.sn.allocations}'))
    const terms = ROW1.slice(ROW1.indexOf('{t.sn.generalTerms}'), ROW1.indexOf('{t.sn.allocations}'))
    assert.ok(!terms.includes('<DeleteButton'), 'the terms card carries no delete control')
    const del = alloc.indexOf('<DeleteButton')
    const custodian = alloc.indexOf('<CustodianField')
    assert.ok(del > 0 && del < custodian, 'the DeleteButton sits in the header area, above the custodian field and the grid')
    // In the header flex row, aligned to its end, only for a caller who may manage.
    // R13.7B2.2.3 § 1-2 (INVERTED from `layout="inline"`): the overlay panel floats
    // beside the bin over the header's own text, so the ~500px header of the 2fr
    // card never wraps to a second line while armed and the card body never moves.
    assert.match(alloc, /\{canManage && \(\s*<DeleteButton\s+size="md"\s+layout="overlay"\s+className="ml-auto no-print"/)
    assert.match(alloc, /onConfirm=\{deleteNote\}/)
    assert.match(alloc, /confirmLabel=\{t\.sn\.confirmDeleteInline\}/)
    // The header still carries the section title and its explanatory note — the
    // note's one-line slot doubles as the failure line, so an error never moves the body.
    assert.match(alloc, /^\{t\.sn\.allocations\}<\/h2>[\s\S]*?\{deleteFailed\s*\? <p className="ui-meta text-negative" role="alert">\{t\.sn\.deleteError\}<\/p>\s*: <p className="ui-meta text-muted-fg">\{t\.sn\.allocationsNote\}<\/p>\}/)
    assert.match(ROW1, /<h2 className="ui-label text-muted-fg">\{t\.sn\.allocations\}<\/h2>/)
    // Not visually dominant: the shared trigger is a chip-material pill, not a filled red button.
    assert.match(CSS, /\.nv-del--md \.nv-del-trigger \{[^}]*background: var\(--nv-chip\);/)
    // No second delete workflow remains on the page.
    assert.ok(!DETAIL_CODE.includes('DestructiveConfirm'))
    assert.ok(!DETAIL_CODE.includes('confirmingDelete'))
  })

  it('C · provenance moved INTO General Terms — every one of its facts is still rendered', () => {
    const terms = ROW1.slice(ROW1.indexOf('{t.sn.generalTerms}'), ROW1.indexOf('{t.sn.allocations}'))
    assert.match(terms, /<TermGroup label=\{t\.sn\.provenance\} last>/)
    for (const needle of ['t.sn.source', 't.sn.sourcePdf', 't.sn.sourceManual', 'n.sourceFileName', 't.sn.confidence', 'n.confidenceScore']) {
      assert.ok(terms.includes(needle), `${needle} missing from the provenance group`)
    }
    assert.equal((DETAIL.match(/\{t\.sn\.provenance\}/g) ?? []).length, 1, 'rendered once — no orphaned provenance card')
  })

  it('sizing · the terms grid opens 2 → 3 → 4 columns; the entity grid never compresses its notional inputs', () => {
    assert.match(DETAIL, /grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-2\.5 text-sm/)
    assert.ok(!/lg:grid-cols-6/.test(DETAIL), 'the full-width six-column grid of B2.2.1 is gone with the full-width card')
    // One column inside the 2fr card at lg/xl; two only where the card is genuinely wide.
    assert.match(DETAIL, /grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2 gap-x-4 gap-y-1\.5/)
    assert.match(DETAIL, /className="w-32 px-2\.5 py-1 text-sm text-right border border-border rounded-lg bg-surface ui-number no-print"/, 'the notional input keeps its width')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// D–G · ROW 2
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 2 — Current levels & distance to barrier and Underlyings share one desktop row', () => {
  it('D · both TableCards sit inside ONE two-column grid', () => {
    assert.ok(ROW2.includes(TWO_COL), 'row 2 uses the shared two-column grid')
    assert.equal((ROW2.match(/<TableCard\b/g) ?? []).length, 2)
    assert.match(ROW2, /title=\{t\.sn\.currentPrices\}/)
    assert.match(ROW2, /title=\{t\.sn\.underlyings\}/)
  })

  it('E · Current levels & distance to barrier is the FIRST (left) child', () => {
    const grid = ROW2.indexOf(TWO_COL)
    const levels = ROW2.indexOf('title={t.sn.currentPrices}')
    const under = ROW2.indexOf('title={t.sn.underlyings}')
    assert.ok(grid < levels, 'the monitoring card opens the row')
    assert.ok(levels < under, 'Current levels precedes Underlyings in the DOM — LEFT on desktop, FIRST when stacked')
  })

  it('F · Underlyings is the SECOND (right) child and the last thing in the row', () => {
    const under = ROW2.indexOf('title={t.sn.underlyings}')
    assert.ok(under > 0)
    assert.equal(ROW2.indexOf('<TableCard', under + 1), -1, 'nothing follows the underlyings card in row 2')
    assert.doesNotMatch(ROW2, /\border-\d|order-first|order-last|flex-row-reverse/)
  })

  it('G · Current levels receives the larger track (3fr vs 2fr) — and both rows share the SAME split so card edges align', () => {
    const m1 = ROW1.match(TRACKS)
    const m2 = ROW2.match(TRACKS)
    assert.ok(m1 && m2, 'both rows declare explicit fr tracks')
    assert.ok(Number(m1![1]) > Number(m2![2]) && Number(m2![1]) > Number(m2![2]), 'the left (dominant) track is wider')
    assert.equal(m1![0], m2![0], 'identical templates → one shared column edge')
    // ~60/40: the modest adjustment from 65/35 that keeps an 8-column
    // underlyings table (560px) readable inside the right-hand card.
    assert.equal(`${m2![1]}/${m2![2]}`, '3/2')
  })

  it('equal height · both rows stretch their cards; nothing pads table rows to fake height', () => {
    assert.ok(ROW1.includes('lg:items-stretch') && ROW2.includes('lg:items-stretch'))
    assert.equal((ROW1.match(/className="px-5 py-4 h-full flex flex-col"/g) ?? []).length, 2, 'both row-1 cards fill the row height')
    assert.equal((ROW2.match(/className="h-full"/g) ?? []).length, 2, 'both row-2 TableCards fill the row height')
    // No artificial spacers, no min-height on rows, no padding on <tr>.
    assert.doesNotMatch(ROW2, /min-h-\[|minHeight|<tr[^>]*py-|spacer/)
    // The card stretches — TableCard is a flex column whose body keeps natural height.
    assert.match(read('../src/components/fable/TableCard.tsx'), /overflow-hidden flex flex-col \$\{className\}/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// H–K · RESPONSIVE STACKING · NO FIELD LOST · NO INNER SCROLL
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 1-2 — responsive behaviour and content preservation', () => {
  it('H · both row pairs stack below lg (single column base, two columns only at lg+)', () => {
    for (const row of [ROW1, ROW2]) {
      assert.ok(row.includes('grid grid-cols-1 lg:grid-cols-['), 'mobile-first single column')
      assert.doesNotMatch(row, /(^|[\s"])grid-cols-\[/, 'no unprefixed multi-column template')
      assert.doesNotMatch(row, /(^|[\s"])(sm|md):grid-cols-\[/, 'the pair opens only at lg')
    }
  })

  it('I · on narrow layouts Current levels appears BEFORE Underlyings, and General Terms before Allocation', () => {
    // Stacking order is DOM order (asserted for both rows above); no responsive reorder utility exists on the page.
    assert.doesNotMatch(DETAIL_CODE, /\b(sm|md|lg|xl):order-/)
    assert.ok(ROW2.indexOf('title={t.sn.currentPrices}') < ROW2.indexOf('title={t.sn.underlyings}'))
    assert.ok(ROW1.indexOf('{t.sn.generalTerms}') < ROW1.indexOf('{t.sn.allocations}'))
  })

  it('J · no content field disappeared — terms, provenance, allocation, monitoring columns, underlying columns, legend', () => {
    for (const field of ['colIsin', 'colIssuer', 'guarantor', 'colStructure', 'payoffType', 'currencyLabel', 'totalIssuanceSize', 'denomination', 'issuePrice', 'colCoupon', 'couponFrequency', 'couponBarrier', 'colKnockIn', 'autocallBarrier', 'colTrade', 'colIssued', 'initialValuation', 'finalValuation', 'colMaturity', 'redemption', 'memoryCoupon', 'principalProtection']) {
      assert.ok(ROW1.includes(`t.sn.${field}`), `term ${field} missing`)
    }
    for (const field of ['allocationsNote', 'nevadaInvestment', 'nevadaInvestmentHelp', 'totalIssuanceSizeHelp', 'allocationMismatch']) {
      assert.ok(ROW1.includes(`t.sn.${field}`), `allocation field ${field} missing`)
    }
    // The custodian field and the entity grid are the same components as before.
    assert.match(ROW1, /<CustodianField\s+value=\{n\.custodian\}/)
    assert.match(ROW1, /<EntityAllocationGrid\s+allocations=\{n\.allocations\}/)
    assert.match(DETAIL, /t\.sn\.custodian\b/)
    assert.match(DETAIL, /t\.sn\.addAllocation/)
    for (const col of ['colUnderlyings', 'gaugeNormalized', 'currentLevel', 'distanceCoupon', 'distanceKnockIn', 'distanceAutocall', 'monitoring.lastMonitored', 'monitoring.priceStale', 'monitoring.never', 'colWorst', 'worstExplain', 'gaugeMarkAutocall']) {
      assert.ok(ROW2.includes(`t.sn.${col}`), `monitoring column/help ${col} missing`)
    }
    for (const col of ['u.underlyingOrder', 'u.underlyingName', 'u.yahooSymbol', 'u.initialLevel', 'u.strikeLevel', 'u.knockInBarrierLevel', 'u.couponBarrierLevel', 'u.autocallBarrierLevel']) {
      assert.ok(ROW2.includes(col), `underlying column ${col} missing`)
    }
    // Raw level, normalized gauge, merged marks, legend, footer, disclaimer, full as-of.
    assert.match(ROW2, /fmtNum\(d\.currentLevel\)/)
    assert.match(ROW2, /<BarrierGauge\s+current=\{gaugeLevel\}\s+marks=\{gaugeMarks\}/)
    assert.match(ROW2, /mergeCoincidingMarks\(rawMarks\)/)
    assert.match(ROW2, /<GaugeLegend marks=\{legendMarks\} \/>/)
    assert.match(ROW2, /asOfFormat="full"/)
    assert.match(ROW2, /t\.sn\.monitoring\.estimateDisclaimer/)
    assert.match(ROW2, /t\.sn\.underlyingsNote/, 'the underlyings card explains what its levels are')
    // The halo and its reduced-motion path are untouched.
    assert.match(GAUGE, /className="nv-level-pulse"/)
    assert.match(CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)')), /\.nv-level-pulse \{\s*animation: none !important;/)
    // Captions: current levels, underlyings, schedule — three tables, three captions.
    assert.equal((DETAIL.match(/<caption className="sr-only">/g) ?? []).length, 3)
  })

  it('K · the Observation Schedule (and every table) still has no inner vertical scroll region', () => {
    assert.ok(SCHEDULE.includes('title={t.sn.schedule}'))
    assert.ok(!/maxHeight=/.test(DETAIL), 'no TableCard maxHeight anywhere')
    assert.ok(!/overflowY|overflow-y-auto/.test(DETAIL_CODE), 'no inline vertical scroll container')
    // Card-level HORIZONTAL containment: the schedule and the underlyings tables
    // scroll inside their card; the current-levels table FITS its card instead
    // (R13.7B2.2.3 § 3-5 — no minWidth, fixed layout, wrapping headers).
    assert.equal((DETAIL.match(/minWidth=\{680\}/g) ?? []).length, 1, 'schedule only')
    assert.match(ROW2, /<TableCard\s+title=\{t\.sn\.currentPrices\}\s+className="h-full"\s+footer=/)
    assert.match(ROW2, /<table className="nv-tbl-fit nv-tbl-fit--stack"/)
    assert.match(ROW2, /<TableCard\s+title=\{t\.sn\.underlyings\}\s+className="h-full"\s+minWidth=\{560\}/)
    assert.ok(!DETAIL.includes('<GlassSurface variant="dense">'), 'no hand-rolled dense surface — the B2.2.1 divider composition is gone')
  })

  it('§ 3 · the B2.2.1 General Terms / Underlyings combination is gone', () => {
    assert.ok(!/border-t border-border">\s*<h2 className="ui-label text-muted-fg">\{t\.sn\.underlyings\}/.test(DETAIL))
    assert.ok(!/overflow-hidden flex flex-col">\s*<div className="px-5 pt-4 pb-4">\s*<h2 className="ui-label text-muted-fg mb-3">\{t\.sn\.generalTerms\}/.test(DETAIL))
    // The old bottom row (allocation + provenance cards) is gone too.
    assert.ok(!/lg:grid-cols-2 gap-3\.5 items-start/.test(DETAIL))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// § 11 · THE ALLOCATION-SECTION DELETE CONTROLS
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 11 — the Allocation section\'s delete controls keep their semantics', () => {
  it('the note-level control targets the same note, through the same DELETE, redirecting on success only', () => {
    assert.match(DETAIL_CODE, /async function deleteNote\(\): Promise<boolean>/)
    assert.match(DETAIL_CODE, /fetch\(`\/api\/structured-notes\/\$\{id\}`, \{ method: 'DELETE' \}\)/)
    assert.match(DETAIL_CODE, /if \(!res\.ok\) \{ setDeleteFailed\(true\); return false \}\s*router\.push\('\/structured-notes'\)\s*return true/)
    assert.match(DETAIL_CODE, /catch \{\s*setDeleteFailed\(true\)\s*return false/)
    assert.equal((DETAIL_CODE.match(/method: 'DELETE'/g) ?? []).length, 1)
    // Failure is stated beside the control (in the header's meta-line slot, R13.7B2.2.3); nothing pretends the note is gone.
    assert.match(DETAIL, /\{deleteFailed\s*\? <p className="ui-meta text-negative" role="alert">\{t\.sn\.deleteError\}<\/p>/)
    assert.match(DETAIL, /\{deleting && <p className="sr-only" role="status">\{t\.sn\.deleting\}<\/p>\}/)
  })

  it('the per-entity Remove is the same upsert-to-zero, administrator-gated, and refreshes the same data', () => {
    const grid = DETAIL.slice(DETAIL.indexOf('function EntityAllocationGrid'))
    assert.match(grid, /removable=\{extras\.includes\(name\) && !readOnly\}/)
    assert.match(grid, /onRemove=\{\(\) => onSet\(name, 0\)\}/)
    assert.match(grid, /<DeleteButton\s+size="sm"\s+layout="overlay"\s+className="no-print"\s+label=\{`\$\{t\.sn\.removeEntity\}: \$\{name\}`\}/)
    assert.match(grid, /confirmLabel=\{t\.sn\.removeEntityConfirm\}/)
    assert.match(grid, /onConfirm=\{onRemove\}/)
    // The upsert reports success only after the server accepted it and the note was reloaded.
    assert.match(DETAIL_CODE, /async function setEntityAllocation\(entityName: string, notional: number\): Promise<boolean>/)
    assert.match(DETAIL_CODE, /if \(!res\.ok\) \{ setAllocError\(t\.sn\.saveError\); return false \}\s*await load\(\)\s*return true/)
    // Fixture data: both fixture allocations are custom entities, so the Remove control renders there for an administrator.
    const fx = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)
    assert.ok(fx !== null)
    const customs = fx!.note.allocations.filter((a) => !(DEFAULT_ENTITIES as readonly string[]).includes(a.entityName))
    assert.equal(customs.length, fx!.note.allocations.length)
  })

  it('both languages carry the two questions and the underlyings note', () => {
    for (const d of [dict.en, dict.es]) {
      for (const k of ['confirmDeleteInline', 'removeEntityConfirm', 'underlyingsNote'] as const) assert.ok(d.sn[k].length > 0, k)
    }
    assert.notEqual(dict.en.sn.underlyingsNote, dict.es.sn.underlyingsNote)
  })
})

describe('R13.7B2.2.2 — CI runs this stage\'s suites', () => {
  it('the event-state workflow executes the layout and delete-button suites', () => {
    assert.match(WORKFLOW, /tests\/structuredNotesDetailLayout\.test\.ts/)
    assert.match(WORKFLOW, /tests\/deleteButton\.test\.ts/)
  })
})
