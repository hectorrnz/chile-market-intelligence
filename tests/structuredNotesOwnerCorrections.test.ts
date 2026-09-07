// R13.7B2.2.3 § 12 A–AF — the owner's three final layout corrections on the
// Structured Notes detail page, plus the regression floor they must not move.
//
//   § 1-2  Allocation by Entity is composed identically in EVERY DeleteButton
//          state. Root cause of the B2.2.2 defect: the CLOSED inline panel
//          wrapper was `width: 0` with an AUTO height, and its question was
//          allowed to wrap — so inside a zero-width box it wrapped one character
//          per line, and the hidden panel (hundreds of pixels tall) sized the
//          card header until the control armed. Fixed in CSS: the closed wrapper
//          is a zero-by-zero box, the closed question never wraps, and the open
//          panel's height equals the trigger's.
//   § 3-7  Current levels & distance to barrier FITS its card: fixed table
//          layout, widths from its own <colgroup>, wrapping headers, no minWidth,
//          no card-level horizontal scroll; below md it stacks one block per
//          underlying with every metric labelled.
//   § 8-11 The lifecycle timeline's maturity step is state-aware: struck, muted
//          and named "Void after call" for a called note; strong for a matured
//          note; plain otherwise. The persisted maturity is untouched.
//
// Source-scan (this repo's convention — no DOM harness) plus pure-function and
// fixture checks wherever a claim depends on data. Pure: no Supabase, no
// network, no Next.js runtime.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { maturityPresentation, buildScheduleRows, findCallDate } from '../src/lib/structuredNotes/observationSchedule.ts'
import { buildReviewFixture, CALLED_PENDING_FIXTURE_ID, CALLED_SETTLED_FIXTURE_ID } from '../src/lib/structuredNotes/fixtures/calledStateFixture.ts'
import { dedupeObservationsByDate } from '../src/lib/structuredNotes/pdf/parsers/shared.ts'
import { calculateCurrentNotional } from '../src/lib/structuredNotes/calculations.ts'
import { replay, transition, invokesHandler } from '../src/components/fable/deleteButtonState.ts'
import * as engine from '../src/lib/structuredNotes/contractualEvents.ts'
import { dict } from '../src/lib/i18n.ts'
import type { NoteStatus } from '../src/lib/structuredNotes/types.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DETAIL = read('../src/app/structured-notes/[id]/page.tsx')
const DETAIL_CODE = code(DETAIL)
const CSS = read('../src/app/globals.css')
const COMPONENT = read('../src/components/fable/DeleteButton.tsx')
const COMPONENT_CODE = code(COMPONENT)
const GAUGE = read('../src/components/fable/BarrierGauge.tsx')
const WORKFLOW = read('../.github/workflows/structured-notes-event-state.yml')

const ROW1 = DETAIL.slice(DETAIL.indexOf('{/* ROW 1'), DETAIL.indexOf('{/* ROW 2'))
const ROW2 = DETAIL.slice(DETAIL.indexOf('{/* ROW 2'), DETAIL.indexOf('{/* Observation schedule'))
const SCHEDULE = DETAIL.slice(DETAIL.indexOf('{/* Observation schedule'))
/** The Allocation card only — from its own marker to the end of row 1. */
const ALLOC = ROW1.slice(ROW1.indexOf('{/* Allocation (internal)'))
/** The current-levels TableCard only. */
const LEVELS = ROW2.slice(ROW2.indexOf('title={t.sn.currentPrices}'), ROW2.indexOf('title={t.sn.underlyings}'))
/** The shared DeleteButton CSS layer and its reduced-motion block. */
const DEL_LAYER = CSS.slice(CSS.indexOf('Shared DeleteButton (R13.7B2.2.2'), CSS.indexOf('/* Fit table (R13.7B2.2.3'))
const FIT_LAYER = CSS.slice(CSS.indexOf('/* Fit table (R13.7B2.2.3'), CSS.indexOf('/* Ken-Burns drift.'))
// R13.7B2.2.4: the stacked mode is a CONTAINER query on `.nv-tbl-fit-host`
// (the table stacks when ITS CARD is too narrow, not when the viewport is).
const STACK_MEDIA = FIT_LAYER.slice(FIT_LAYER.indexOf('@container (max-width: 519px)'))
const TIMELINE = DETAIL.slice(DETAIL.indexOf('const maturityMode ='), DETAIL.indexOf('const thBase ='))

const px = (rem: string) => Number(rem.replace('rem', ''))

// ═════════════════════════════════════════════════════════════════════════════
// A–E · ALLOCATION LAYOUT
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.3 § 1-2 — the Allocation card is composed identically in every DeleteButton state', () => {
  it('A · the allocation content has ONE structural position: header → body → totals, and nothing in the card reads the delete state', () => {
    assert.ok(ALLOC.length > 0, 'the allocation card marker exists')
    const header = ALLOC.indexOf('<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-3">')
    const del = ALLOC.indexOf('<DeleteButton')
    const headerClose = ALLOC.indexOf('</div>', del)
    const custodian = ALLOC.indexOf('<CustodianField')
    const grid = ALLOC.indexOf('<EntityAllocationGrid')
    const totals = ALLOC.indexOf('<dl className="mt-3')
    assert.ok(header > 0 && header < del && del < headerClose && headerClose < custodian && custodian < grid && grid < totals,
      'header (with the control) closes before the body begins; totals come last')
    // The card is a plain top-to-bottom flex column: no rule distributes the
    // remaining height by content size, so no child's geometry can move another.
    assert.match(ALLOC, /<GlassSurface variant="card" as="section" className="px-5 py-4 h-full flex flex-col">/)
    assert.doesNotMatch(code(ALLOC), /justify-between(?![^>]*gap-x-3 gap-y-2 mb-3)|flex-1|grow|mt-auto|justify-end|justify-around|justify-evenly/, 'no height-distributing rule on the card body')
    // The parent never learns the control's state — the component exposes no
    // state callback and the page reads none.
    const props = COMPONENT.slice(COMPONENT.indexOf('export interface DeleteButtonProps'), COMPONENT.indexOf('/** How long the success check stays'))
    assert.doesNotMatch(props, /onArm|onOpen|onStateChange|armed\??:|state\??:/)
    assert.doesNotMatch(code(ALLOC), /data-state|armed|pending\b/)
  })

  it('B · CLOSED, the inline panel wrapper is a ZERO-BY-ZERO box and its question never wraps — the hidden panel can no longer size its parent', () => {
    assert.match(DEL_LAYER, /\.nv-del--inline \.nv-del-panelwrap \{\s*display: inline-flex;\s*min-width: 0;\s*width: 0;\s*height: 0;\s*overflow: hidden;\s*\}/)
    assert.match(DEL_LAYER, /\.nv-del--inline \.nv-del-question \{ flex: 1 1 auto; min-width: 0; white-space: nowrap; line-height: 1\.2; \}/)
    // Wrapping is permitted only while OPEN — when the panel has a real width to wrap in.
    assert.match(DEL_LAYER, /\.nv-del--inline\[data-state='armed'\] \.nv-del-question,\s*\.nv-del--inline\[data-state='pending'\] \.nv-del-question \{ white-space: normal; overflow-wrap: break-word; \}/)
    // The defect's own shape is gone: no closed-state rule lets the question wrap inside a zero box.
    const closedQuestion = DEL_LAYER.match(/\.nv-del--inline \.nv-del-question \{[^}]*\}/)![0]
    assert.doesNotMatch(closedQuestion, /white-space: normal|overflow-wrap/)
  })

  it('B · OPEN, the panel is exactly the trigger\'s height (md 2rem, sm 1.5rem) — arming never changes the control\'s height', () => {
    const trigMd = DEL_LAYER.match(/\.nv-del--md \.nv-del-trigger \{[^}]*height: (\d(?:\.\d+)?rem);/)![1]
    const trigSm = DEL_LAYER.match(/\.nv-del--sm \.nv-del-trigger \{[^}]*height: (\d(?:\.\d+)?rem);/)![1]
    const panelMd = DEL_LAYER.match(/\.nv-del--md \.nv-del-panel \{ min-height: (\d(?:\.\d+)?rem); \}/)![1]
    const panelSm = DEL_LAYER.match(/\.nv-del--sm \.nv-del-panel \{ min-height: (\d(?:\.\d+)?rem); \}/)![1]
    assert.equal(px(panelMd), px(trigMd), 'md panel height == md trigger height')
    assert.equal(px(panelSm), px(trigSm), 'sm panel height == sm trigger height')
    // No block padding to push the panel past that height; the root centres its children.
    assert.match(DEL_LAYER, /\.nv-del-panel \{[^}]*padding: 0 \.25rem 0 \.625rem;/)
    assert.match(DEL_LAYER, /\.nv-del \{[^}]*align-items: center;/)
    // The actions fit inside the panel height in both size classes.
    assert.match(DEL_LAYER, /\.nv-del-action \{[^}]*height: 1\.5rem;/)
    assert.match(DEL_LAYER, /\.nv-del--sm \.nv-del-action \{ width: 1\.25rem; height: 1\.25rem; \}/)
  })

  it('C · idle → armed → cancel returns to idle with nothing left over — and the page derives no layout from the control', () => {
    const ctx = { disabled: false }
    const out = replay([{ type: 'ARM' }, { type: 'CANCEL' }], ctx)
    assert.equal(out.state, 'idle')
    assert.equal(out.invocations, 0)
    assert.deepEqual(out.trace, ['idle', 'armed', 'idle'])
    const esc = replay([{ type: 'ARM' }, { type: 'ESCAPE' }], ctx)
    assert.equal(esc.state, 'idle')
    assert.equal(esc.invocations, 0)
    // The armed and pending rules open the SAME box; the closed rules are one
    // declaration — so idle-before equals idle-after by construction.
    assert.match(DEL_LAYER, /\.nv-del--inline\[data-state='armed'\] \.nv-del-panelwrap,\s*\.nv-del--inline\[data-state='pending'\] \.nv-del-panelwrap \{\s*width: auto;\s*height: auto;\s*margin-left: \.375rem;\s*overflow: visible;\s*\}/)
    assert.equal((DEL_LAYER.match(/\.nv-del--inline \.nv-del-panelwrap \{/g) ?? []).length, 1, 'one closed-state rule')
  })

  it('D · pending shares the armed geometry exactly, so the lock never shifts unrelated content', () => {
    const armedPanel = DEL_LAYER.match(/\.nv-del--inline\[data-state='armed'\] \.nv-del-panel,\s*\.nv-del--inline\[data-state='pending'\] \.nv-del-panel \{[^}]*\}/)
    assert.ok(armedPanel, 'armed and pending panel rules are ONE declaration')
    // Every rule that mentions the pending state is a rule shared with the armed
    // state — there is no pending-only geometry anywhere in the layer.
    const rules = DEL_LAYER.split('}').filter((r) => r.includes("[data-state='pending']"))
    assert.ok(rules.length >= 3, 'pending appears in the lid, wrapper and panel rules')
    for (const r of rules) assert.ok(r.includes("[data-state='armed']"), `pending-only rule found: ${r.trim().slice(0, 80)}`)
    // Overlay mode is untouched: absolutely positioned, out of the row's flow.
    assert.match(DEL_LAYER, /\.nv-del--overlay \.nv-del-panel \{\s*position: absolute;/)
  })

  it('E · deletion semantics are unchanged — reducer, handler, endpoint, gate', () => {
    const ctx = { disabled: false }
    // Confirm fires ONCE per arming; cancel and Escape never fire; a second CONFIRM while pending is refused.
    const ok = replay([{ type: 'ARM' }, { type: 'CONFIRM' }, { type: 'CONFIRM' }, { type: 'RESOLVE', ok: true }], ctx)
    assert.equal(ok.invocations, 1)
    assert.equal(ok.state, 'success')
    assert.equal(transition('idle', { type: 'CONFIRM' }, ctx), 'idle')
    assert.equal(invokesHandler('idle', { type: 'CONFIRM' }, ctx), false)
    assert.equal(invokesHandler('armed', { type: 'CONFIRM' }, { disabled: true }), false)
    const fail = replay([{ type: 'ARM' }, { type: 'CONFIRM' }, { type: 'RESOLVE', ok: false }], ctx)
    assert.equal(fail.state, 'idle', 'a failed deletion returns to a usable idle state')
    // The page's handler is the same DELETE, same gate, same success-only redirect.
    assert.match(DETAIL_CODE, /async function deleteNote\(\): Promise<boolean>/)
    assert.match(DETAIL_CODE, /fetch\(`\/api\/structured-notes\/\$\{id\}`, \{ method: 'DELETE' \}\)/)
    assert.equal((DETAIL_CODE.match(/method: 'DELETE'/g) ?? []).length, 1)
    // Overlay here: the 2fr header (~500px) cannot hold the title block (~300px)
    // AND an open inline panel with its bin (~350px) without wrapping — the
    // floating panel is the one way the card body stays put while armed.
    assert.match(ALLOC, /\{canManage && \(\s*<DeleteButton\s+size="md"\s+layout="overlay"\s+className="ml-auto no-print"/)
    assert.match(ALLOC, /onConfirm=\{deleteNote\}/)
    // The failure line reuses the meta line's one-line slot — an error never moves the body either.
    assert.match(ALLOC, /\{deleteFailed\s*\? <p className="ui-meta text-negative" role="alert">\{t\.sn\.deleteError\}<\/p>\s*: <p className="ui-meta text-muted-fg">\{t\.sn\.allocationsNote\}<\/p>\}/)
    assert.doesNotMatch(ALLOC, /deleteFailed && <p/)
    // The component still owns no semantics.
    assert.ok(!/fetch\(|\/api\/|useRouter|router\.|canManage|isAdministrator|supabase/i.test(COMPONENT_CODE))
    assert.match(COMPONENT_CODE, /inert=\{!armed && !pending\}/)
    assert.match(COMPONENT_CODE, /if \(e\.key === 'Escape'\) cancel\('ESCAPE'\)/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// F–P · CURRENT LEVELS & DISTANCE TO BARRIER FITS ITS CARD
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.3 § 3-7 — Current levels & distance to barrier has no horizontal scroll and loses no column', () => {
  const colgroup = LEVELS.slice(LEVELS.indexOf('<colgroup>'), LEVELS.indexOf('</colgroup>'))
  const widths = [...colgroup.matchAll(/<col style=\{\{ width: '(\d+)%' \}\} \/>/g)].map((m) => Number(m[1]))

  it('F · the card declares no horizontal-scroll contract: no minWidth, a fixed-layout fit table instead', () => {
    assert.ok(LEVELS.length > 0)
    assert.match(ROW2, /<TableCard\s+title=\{t\.sn\.currentPrices\}\s+className="h-full"\s+footer=/, 'no minWidth prop on the current-levels TableCard')
    assert.doesNotMatch(code(LEVELS), /minWidth/)
    assert.match(LEVELS, /<table className="nv-tbl-fit nv-tbl-fit--stack" style=\{\{ fontSize: 'var\(--fs-table-cell\)' \}\}>/)
    assert.match(FIT_LAYER, /\.nv-tbl-fit \{ table-layout: fixed; width: 100%; border-collapse: collapse; \}/)
  })

  it('G · the old forced-overflow behaviour is gone from this card and only from this card', () => {
    assert.doesNotMatch(LEVELS, /style=\{\{ minWidth: 190 \}\}/, 'the gauge header no longer forces 190px')
    assert.doesNotMatch(code(LEVELS), /overflow-x|w-full/)
    assert.equal((DETAIL.match(/minWidth=\{680\}/g) ?? []).length, 1, 'the schedule keeps its in-card scroll')
    // R13.7B2.2.4 (INVERTED from "the underlyings table keeps its in-card
    // scroll"): the owner does not want that scrollbar either — Underlyings is
    // the second fit table on the page, same layer, own column budget.
    assert.match(ROW2, /<TableCard\s+title=\{t\.sn\.underlyings\}\s+className="h-full"\s+footer=/, 'no minWidth prop on the underlyings TableCard')
    assert.equal((DETAIL.match(/nv-tbl-fit nv-tbl-fit--stack/g) ?? []).length, 2, 'exactly two fit tables on the page (current levels, underlyings)')
  })

  it('H · long headers wrap — no nowrap on the fit table\'s headers, balanced wrapping in CSS', () => {
    assert.match(DETAIL, /const thFit = 'border-b border-border ui-table-header text-muted-fg'/)
    assert.doesNotMatch(DETAIL.match(/const thFit = '([^']*)'/)![1], /whitespace-nowrap|px-|py-|text-center/)
    assert.equal((LEVELS.match(/className=\{thFit\}/g) ?? []).length + (LEVELS.match(/className=\{`\$\{thFit\} nv-tbl-fit-name`\}/g) ?? []).length, 7, 'all seven headers use thFit')
    assert.doesNotMatch(LEVELS, /thBase/)
    assert.match(FIT_LAYER, /\.nv-tbl-fit th \{ white-space: normal; text-wrap: balance; overflow-wrap: normal; vertical-align: bottom; line-height: 1\.25; \}/)
    // `.ui-table-header` itself is nowrap; the fit rule outranks it (same layer, higher specificity).
    assert.match(CSS, /\.ui-table-header \{[^}]*white-space: nowrap;/)
  })

  it('I · all seven semantic columns remain, in order, each with its own stacked-mode label', () => {
    const order = ['t.sn.colUnderlyings', 't.sn.gaugeNormalized', 't.sn.currentLevel', 't.sn.distanceCoupon', 't.sn.distanceKnockIn', 't.sn.distanceAutocall', 't.sn.monitoring.lastMonitored']
    const thead = LEVELS.slice(LEVELS.indexOf('<thead>'), LEVELS.indexOf('</thead>'))
    let last = -1
    for (const key of order) {
      const at = thead.indexOf(`>{${key}}</th>`)
      assert.ok(at > last, `header ${key} present and in order`)
      last = at
    }
    assert.equal((thead.match(/<th /g) ?? []).length, 7)
    const labels = [...LEVELS.matchAll(/data-label=\{([^}]+)\}/g)].map((m) => m[1])
    assert.deepEqual(labels, order, 'every <td> names its column for the stacked mode')
    assert.equal(widths.length, 7, 'seven <col> widths')
    // The header tooltips survive.
    assert.match(LEVELS, /title=\{t\.sn\.gaugeLegend\}>\{t\.sn\.gaugeNormalized\}/)
    assert.equal((LEVELS.match(/title=\{t\.sn\.distanceConvention\}/g) ?? []).length, 3)
  })

  it('J · numeric cells stay aligned and on one line; the identity column may wrap', () => {
    for (const key of ['t.sn.currentLevel', 't.sn.distanceCoupon', 't.sn.distanceKnockIn', 't.sn.distanceAutocall']) {
      assert.match(LEVELS, new RegExp(`<td className="ui-number[^"]*" data-label=\\{${key.replace(/\./g, '\\.')}\\}`), `${key} cell is ui-number`)
    }
    // Last monitored: the DATE is the one-line numeral; the stale flag wraps beneath it.
    assert.match(LEVELS, /<td className="text-xs" data-label=\{t\.sn\.monitoring\.lastMonitored\}>/)
    assert.match(LEVELS, /<span className="ui-number">\{d\.lastMonitoredDate\}<\/span>/)
    assert.match(FIT_LAYER, /\.nv-tbl-fit \.ui-number \{ white-space: nowrap; \}/)
    assert.match(FIT_LAYER, /\.nv-tbl-fit th,\s*\.nv-tbl-fit td \{ padding: \.5rem \.25rem; text-align: center; \}/)
    assert.match(FIT_LAYER, /\.nv-tbl-fit \.nv-tbl-fit-name \{ text-align: left; \}/)
    // A header word never breaks mid-word; only the identity CELL may break a long name.
    assert.match(FIT_LAYER, /\.nv-tbl-fit th \{[^}]*overflow-wrap: normal;/)
    assert.match(FIT_LAYER, /\.nv-tbl-fit td\.nv-tbl-fit-name \{ overflow-wrap: break-word; \}/)
    assert.match(LEVELS, /<td className="nv-tbl-fit-name" data-label=\{t\.sn\.colUnderlyings\}>/)
    assert.doesNotMatch(LEVELS, /whitespace-nowrap/, 'no cell forces its width any more')
    // The distance tone and plain-language readings are untouched.
    assert.match(LEVELS, /style=\{\{ color: distanceTone\(d\.distanceToCouponBarrier\) \}\}/)
    assert.equal((LEVELS.match(/title=\{moveText\(t, /g) ?? []).length, 3)
  })

  it('K · Current levels remains LEFT (first) and L · Underlyings remains RIGHT (last) in row 2', () => {
    const grid = ROW2.indexOf('lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')
    const levels = ROW2.indexOf('title={t.sn.currentPrices}')
    const under = ROW2.indexOf('title={t.sn.underlyings}')
    assert.ok(grid > 0 && grid < levels && levels < under)
    assert.equal(ROW2.indexOf('<TableCard', under + 1), -1)
    assert.doesNotMatch(ROW2, /\border-\d|order-first|order-last|flex-row-reverse/)
    // Shared column edge with row 1, unchanged split.
    assert.equal(ROW1.match(/lg:grid-cols-\[[^\]]+\]/)![0], ROW2.match(/lg:grid-cols-\[[^\]]+\]/)![0])
  })

  it('M/N · the width contract that makes 1440 and 1024 scroll-free: fixed layout, a budget that sums to exactly 100%, a gauge that scales into its column', () => {
    assert.equal(widths.reduce((a, b) => a + b, 0), 100, 'the column budget is exactly the table width — nothing can overflow the card')
    assert.ok(widths.every((w) => w >= 10), 'no column is starved')
    // The identity and gauge columns carry the widest unbreakable header words and the widest content.
    const sorted = [...widths].sort((a, b) => b - a)
    assert.ok(widths[0] === sorted[0] && widths[1] === sorted[1], 'identity and gauge are the two widest columns')
    assert.deepEqual(widths, [19, 17, 11, 12, 12, 13, 16], 'the measured budget of the R13.7B2.2.3 sweep')
    // A fixed-layout table with a 100% width and no minWidth is as wide as its
    // container at ANY width, so `scrollWidth === clientWidth` on the wrapper —
    // the rendered proof at 1440 and 1024 is in the stage's headless sweep.
    assert.match(GAUGE, /style=\{\{ maxWidth: '100%', height: 'auto' \}\}/, 'the SVG never exceeds its cell')
    assert.match(LEVELS, /<BarrierGauge\s+current=\{gaugeLevel\}\s+marks=\{gaugeMarks\}\s+width=\{150\}\s+height=\{18\}/)
  })

  it('O · below md the same DOM stacks — every value keeps its column name; no metric is hidden', () => {
    assert.ok(STACK_MEDIA.length > 0, 'a stacked mode exists')
    assert.match(STACK_MEDIA, /\.nv-tbl-fit--stack td::before \{\s*content: attr\(data-label\);/)
    assert.match(STACK_MEDIA, /\.nv-tbl-fit--stack,\s*\.nv-tbl-fit--stack tbody,\s*\.nv-tbl-fit--stack tr \{ display: block; \}/)
    // Only the header row and the column template are hidden — never a cell, never a row.
    const hidden = [...STACK_MEDIA.matchAll(/([^{}]+)\{[^}]*display: none;[^}]*\}/g)].map((m) => m[1].trim())
    assert.deepEqual(hidden, ['.nv-tbl-fit--stack colgroup,\n    .nv-tbl-fit--stack thead'])
    assert.doesNotMatch(STACK_MEDIA, /td[^{]*\{[^}]*display: none|tr[^{]*\{[^}]*display: none|visibility: hidden/)
    // The label re-uses the section-label tokens, so it reads as a table header.
    assert.match(STACK_MEDIA, /font-size: var\(--fs-section-label\);/)
    assert.match(STACK_MEDIA, /letter-spacing: var\(--tracking-section-label\);/)
    // R13.7B2.2.4: the switch is the HOST's width (a container query on
    // .nv-tbl-fit-host, in px so the 17px root rem cannot shift it) — a 573px
    // Current-levels card at 1024 stays a table, a 381px Underlyings card stacks.
    assert.match(FIT_LAYER, /\.nv-tbl-fit-host \{ container-type: inline-size; \}/)
    assert.match(FIT_LAYER, /@container \(max-width: 519px\)/)
    assert.doesNotMatch(FIT_LAYER, /@media/, 'no viewport media query decides a fit table any more')
  })

  it('P · every gauge semantic from B2.2.1 survives the re-layout', () => {
    assert.match(LEVELS, /const gaugeLevel = d\.currentLevel !== null && strike \? \(d\.currentLevel \/ strike\) \* 100 : null/)
    assert.match(LEVELS, /mergeCoincidingMarks\(rawMarks\)/)
    assert.match(LEVELS, /markLevelKey\(autocallPct \* 100\) === 100 \? t\.sn\.gaugeBasis : t\.sn\.gaugeBasisInitialOnly/)
    assert.match(LEVELS, /fmtNum\(d\.currentLevel\)/, 'the raw market level stays beside the gauge')
    assert.match(LEVELS, /title=\{t\.sn\.worstExplain\}/)
    assert.match(LEVELS, /\{t\.sn\.colWorst\}/)
    // The stale flag keeps its warning colour and tooltip; it now sits under the date so the cell never widens.
    assert.match(LEVELS, /<span className=\{d\.lastMonitoredStale \? 'text-warning' : 'text-muted-fg'\} title=\{d\.lastMonitoredStale \? t\.sn\.monitoring\.priceStale : undefined\}>/)
    assert.match(LEVELS, /\{d\.lastMonitoredStale \? <span className="block break-words">⚠ \{t\.sn\.monitoring\.priceStale\}<\/span> : null\}/)
    assert.match(LEVELS, /\{t\.sn\.monitoring\.never\}/)
    assert.match(ROW2, /<GaugeLegend marks=\{legendMarks\} \/>/)
    assert.match(ROW2, /asOfFormat="full"/)
    assert.match(ROW2, /t\.sn\.monitoring\.estimateDisclaimer/)
    assert.match(GAUGE, /className="nv-level-pulse"/)
    assert.match(CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)')), /\.nv-level-pulse \{\s*animation: none !important;/)
    // The gauge still draws the same marks, dot and halo — only its box can scale.
    assert.match(GAUGE, /<circle className="nv-level-pulse" cx=\{toX\(current\)\}/)
    assert.match(GAUGE, /<circle cx=\{toX\(current\)\} cy=\{height \/ 2\} r=\{4\} fill=\{dotColor\}>/)
    assert.match(GAUGE, /<svg viewBox=\{`0 0 \$\{width\} \$\{height\}`\} width=\{width\} height=\{height\} style=\{\{ maxWidth: '100%', height: 'auto' \}\}/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Q–V · MATURITY LEGEND
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.3 § 8-11 — the timeline\'s maturity step is state-aware', () => {
  const called = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
  const deduped = dedupeObservationsByDate(called.note.observations)

  it('Q · an ACTIVE note shows its maturity plainly — not struck, not strong, no note', () => {
    assert.equal(maturityPresentation('active'), 'plain')
    assert.match(TIMELINE, /const maturityMode = maturityPresentation\(n\.status\)/)
    assert.match(TIMELINE, /const maturityVoid = maturityMode === 'void'/)
    assert.match(TIMELINE, /const maturityTerminal = maturityMode === 'terminal'/)
    assert.match(TIMELINE, /label: t\.sn\.colMaturity,\s*value: n\.maturityDate \?\? '—',\s*dot: maturityTerminal \? 'var\(--foreground\)' : 'var\(--muted-fg\)',\s*strong: maturityTerminal,\s*void: maturityVoid,\s*note: maturityVoid \? t\.sn\.maturityVoidAfterCall : undefined,\s*title: maturityVoid \? t\.sn\.maturityVoidHelp : undefined,/)
  })

  it('R · a CALLED note shows the contractual maturity struck through and muted', () => {
    assert.equal(maturityPresentation('autocalled'), 'void')
    assert.equal(called.note.status, 'autocalled')
    assert.match(SCHEDULE, /\{step\.void \? \(\s*<s className="ui-number text-xs text-muted-fg line-through opacity-70">\{step\.value\}<\/s>/)
    // Neutral, not red: the void treatment must not compete with "Called on".
    const voidRender = SCHEDULE.slice(SCHEDULE.indexOf('{step.void ? ('), SCHEDULE.indexOf('{step.note && ('))
    assert.doesNotMatch(voidRender, /negative|critical/)
  })

  it('S · the meaning is stated in words — "Void after call" — never by the strikethrough alone', () => {
    assert.equal(dict.en.sn.maturityVoidAfterCall, 'Void after call')
    assert.ok(dict.es.sn.maturityVoidAfterCall.length > 0)
    assert.notEqual(dict.es.sn.maturityVoidAfterCall, dict.en.sn.maturityVoidAfterCall)
    assert.ok(dict.en.sn.maturityVoidHelp.length > 0 && dict.es.sn.maturityVoidHelp.length > 0)
    assert.match(SCHEDULE, /\{step\.note && \(\s*<span className="inline-flex items-center h-4 px-1\.5 rounded-full ui-micro-label text-muted-fg" style=\{\{ backgroundColor: 'var\(--nv-chip\)', border: '1px solid var\(--nv-chipbd\)' \}\}>\s*\{step\.note\}/)
    assert.match(SCHEDULE, /title=\{step\.title\}/, 'the full explanation rides on the step tooltip')
    // Vocabulary is the schedule's own: the post-call rows are already "Void (after call)".
    assert.match(dict.en.sn.obsState.void, /^Void/)
  })

  it('T · the original contractual maturity value is preserved — in the timeline, in General Terms and in the fixture', () => {
    assert.match(TIMELINE, /value: n\.maturityDate \?\? '—'/)
    assert.match(ROW1, /<TermField k=\{t\.sn\.colMaturity\} v=\{n\.maturityDate\} \/>/)
    assert.equal(called.note.maturityDate, '2028-06-06')
    assert.equal(buildReviewFixture(CALLED_SETTLED_FIXTURE_ID)!.note.maturityDate, '2028-06-06')
    // Presentation only: nothing here writes, and the module stays pure.
    const sched = code(read('../src/lib/structuredNotes/observationSchedule.ts'))
    assert.ok(!/from ['"]@supabase|from ['"]next|fetch\(/i.test(sched), 'the display module imports no runtime')
    assert.match(sched, /export function maturityPresentation\(status: NoteStatus\): MaturityPresentation/)
  })

  it('U · a MATURED note keeps its maturity as the terminal event — strong, never struck; other statuses stay plain', () => {
    assert.equal(maturityPresentation('matured'), 'terminal')
    for (const s of ['cancelled', 'defaulted', 'draft'] as NoteStatus[]) assert.equal(maturityPresentation(s), 'plain', s)
    // Render: strong + foreground dot, and the void branch is unreachable for it.
    assert.match(SCHEDULE, /<span className=\{`ui-number text-xs \$\{step\.strong \? 'text-foreground font-medium' : 'text-muted-fg'\}`\}>\{step\.value\}<\/span>/)
  })

  it('V · in the called fixture "Called on" is the terminal event: the call date is real, the next-observation slot is swapped for it, the maturity is void', () => {
    const callDate = findCallDate(deduped)
    assert.equal(callDate, '2026-08-28')
    const rows = buildScheduleRows(deduped)
    assert.equal(rows.find((r) => r.valuationDate === callDate)?.state, 'called')
    assert.ok(rows.filter((r) => r.state === 'void').length > 0, 'later dates are void after the call')
    assert.match(TIMELINE, /isCalled\s*\? \{ label: t\.sn\.calledOnLabel, value: calledOnDate \?\? '—', dot: 'var\(--negative\)', strong: true, title: t\.sn\.legendCalled \}/)
    // Order: issued → observed progress → called on → (void) maturity.
    const i = TIMELINE.indexOf('t.sn.colIssued'), o = TIMELINE.indexOf('t.sn.obsProgress'), c = TIMELINE.indexOf('t.sn.calledOnLabel'), m = TIMELINE.indexOf('label: t.sn.colMaturity')
    assert.ok(i < o && o < c && c < m)
    // The hero keeps Redemption / settlement for a called note — the timeline does not duplicate it.
    assert.match(DETAIL, /<StatCapsule label=\{t\.sn\.redemptionSettlement\}/)
    assert.doesNotMatch(TIMELINE, /redemptionSettlement/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// W–AF · REGRESSION FLOOR
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.3 — regression floor', () => {
  const pending = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
  const settled = buildReviewFixture(CALLED_SETTLED_FIXTURE_ID)!

  it('W · the Observation Schedule (and every table) has no inner vertical scroll region', () => {
    assert.ok(!/maxHeight=/.test(DETAIL))
    assert.ok(!/overflowY|overflow-y-auto/.test(DETAIL_CODE))
    assert.match(SCHEDULE, /minWidth=\{680\}/, 'the schedule keeps card-level horizontal containment')
  })

  it('X · observed-dates semantics and Y · Called / Paid / Met wording are unchanged', () => {
    assert.match(DETAIL_CODE, /const observedCount = scheduleRows\.filter\(\(r\) => r\.state === 'observed' \|\| r\.state === 'called' \|\| r\.state === 'matured'\)\.length/)
    assert.match(TIMELINE, /value: `\$\{observedCount\} \/ \$\{scheduleRows\.length\}`/)
    assert.match(SCHEDULE, /<RowStateChip state=\{r\.state\} \/>/)
    assert.match(SCHEDULE, /<OutcomeCell outcome=\{r\.coupon\} \/>/)
    assert.match(SCHEDULE, /<OutcomeCell outcome=\{r\.autocall\} \/>/)
    for (const d of [dict.en, dict.es]) {
      for (const k of ['called', 'void', 'matured', 'observed', 'scheduled'] as const) assert.ok(d.sn.obsState[k].length > 0)
    }
    assert.equal(dict.en.sn.obsState.called, 'Called')
  })

  it('Z · percentage formatting on the schedule is unchanged (decimal fractions through fmtPct)', () => {
    assert.match(SCHEDULE, /\{fmtPct\(r\.couponBarrierPct\)\}/)
    assert.match(SCHEDULE, /\{fmtPct\(r\.autocallBarrierPct\)\}/)
    const row = buildScheduleRows(dedupeObservationsByDate(pending.note.observations))[0]
    assert.ok(row.couponBarrierPct !== null && row.couponBarrierPct > 0 && row.couponBarrierPct <= 1, 'barrier stored as a fraction, never 6500')
  })

  it('AA · pending-settlement notional is nonzero and AB · settled notional is zero', () => {
    assert.ok(calculateCurrentNotional(pending.note, pending.note.allocations, 'pending') > 0)
    assert.equal(calculateCurrentNotional(settled.note, settled.note.allocations, 'settled'), 0)
  })

  it('AC · the contractual engine is untouched by this presentation stage', () => {
    for (const fn of ['relativeToThreshold', 'moveToThreshold', 'evaluateLeg', 'evaluateAllUnderlyingCondition', 'evaluateCouponEvent', 'evaluateAutocallEvent', 'evaluateKnockInEvent', 'isBarrierEvent', 'deriveSettlementStatus', 'deriveNoteLifecycle', 'isVoidedByLifecycle']) {
      assert.equal(typeof (engine as Record<string, unknown>)[fn], 'function', fn)
    }
    // The locked distance formula: threshold / current − 1.
    assert.ok(Math.abs(engine.moveToThreshold(100, 65)! - -0.35) < 1e-12)
    assert.ok(Math.abs(engine.relativeToThreshold(130, 100)! - 0.3) < 1e-12)
    // This stage touches no engine, API, migration or data file.
    assert.doesNotMatch(TIMELINE + LEVELS + ALLOC, /supabase|\/api\/cron|migration/i)
  })

  it('AD/AE/AF · concurrency, T-1/T0 and notification/security suites remain the CI gate, alongside this stage\'s suite', () => {
    for (const suite of ['tests/structuredNotesEventState.test.ts', 'tests/structuredNotesMonitoring.test.ts', 'tests/structuredNotesMonitoringRoutes.test.ts', 'tests/notificationsPlatform.test.ts', 'tests/structuredNotesAlertAccess.test.ts', 'tests/sensitiveSurfaceHardening.test.ts', 'tests/structuredNotesOwnerCorrections.test.ts', 'tests/deleteButton.test.ts', 'tests/structuredNotesDetailLayout.test.ts']) {
      assert.ok(WORKFLOW.includes(suite), suite)
    }
  })
})
