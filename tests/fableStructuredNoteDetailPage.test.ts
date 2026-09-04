// Phase R4 — Fable Structured Note DETAIL page composition.
//
// Guards the /structured-notes/[id] re-skin: the canonical detail route
// adopts the approved Fable note-detail anatomy (nmi-fable-v1 SPECS.md §6
// "Row → panel" + §Overlays "Detail panel"), adapted to a full page in the
// R3 dashboard's visual family, while every piece of NMI substance — the
// detail API contract, monitoring values, terms, underlyings, the complete
// observation schedule, allocation editing, provenance, the delete workflow,
// and R1.5 security — is preserved unchanged. Source-scan style (no rendering
// harness), matching the other fable*Page suites.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const DETAIL = read('src/app/structured-notes/[id]/page.tsx')
const DASH = read('src/app/structured-notes/page.tsx')
const I18N = read('src/lib/i18n.ts')
const SHELL_GATE = read('src/components/layout/ShellGate.tsx')

// Strip comments so negative assertions test code, not prose.
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const DETAIL_CODE = strip(DETAIL)

describe('R4.1 — Fable detail composition on /structured-notes/[id]', () => {
  it('opens with the back link and the shared Fable PageHeader', () => {
    assert.match(DETAIL, /@\/components\/fable\/PageHeader/)
    assert.match(DETAIL, /href="\/structured-notes"/)
    assert.match(DETAIL, /<PageHeader/)
  })

  it('the header carries ISIN eyebrow, wrapping product name, issuer · structure · lifecycle pill', () => {
    assert.match(DETAIL, /eyebrow=\{n\.isin \? <span className="font-mono[^"]*">\{n\.isin\}<\/span> : t\.sn\.tag\}/)
    // the name WRAPS (break-words) — never truncation/hover-only on a touch device
    assert.match(DETAIL, /title=\{<span className="break-words">\{n\.productName\}<\/span>\}/)
    assert.match(DETAIL, /<LifecyclePill status=\{n\.status\} \/>/)
  })

  it('reuses the R3 dashboard capsule + display helpers so the two surfaces cannot drift', () => {
    assert.match(DETAIL, /import \{ fmtPct, fmtNum, distanceTone, shortUnderlying, StatCapsule, RISK_TONE \} from '\.\.\/page'/)
    assert.match(DASH, /export \{ fmtPct, fmtNum, distanceTone, shortUnderlying, StatCapsule, RISK_TONE \}/)
  })

  it('renders the decision-first capsule strip (status, worst, distance, next obs, coupon, notional, maturity)', () => {
    assert.match(DETAIL, /repeat\(auto-fit, minmax\(150px, 1fr\)\)/)
    for (const key of ['colStatus', 'worstPerformer', 'distanceKnockIn', 'dashNextObs', 'colCoupon', 'colNotional', 'colMaturity']) {
      assert.ok(DETAIL.includes(`t.sn.${key}`), `capsule ${key} must be present`)
    }
    // R13.7B2.2 § 6 — the status capsule now also carries the settlement
    // sub-line for a called note, so the assertion is on the bindings rather
    // than on one single-line JSX spelling.
    // R13.7B2.2.1 § 5 — the capsule is labelled "Status" (the shared
    // `colStatus` key), no longer "Risk status": for a called note the value is
    // a lifecycle state, not a risk reading.
    assert.match(DETAIL, /label=\{t\.sn\.colStatus\}/)
    assert.ok(!/label=\{t\.sn\.riskStatus\}/.test(DETAIL), 'the hero capsule must not be labelled "Risk status"')
    assert.match(DETAIL, /value=\{riskLabel\(data\.metrics\.riskStatus\)\}/)
    assert.match(DETAIL, /tone=\{RISK_TONE\[data\.metrics\.riskStatus\]\}/)
  })

  // R13.7B2.2 § 6 — a called note is terminal; the hero says so, and swaps the
  // forward-looking capsules for the ones that still mean something.
  it('a called note shows Called + settlement, not the autocallable forecast', () => {
    assert.match(DETAIL, /const isCalled = n\.status === 'autocalled'/)
    assert.match(DETAIL, /called: t\.sn\.riskCalled/)
    for (const key of ['t.sn.settlementPending', 't.sn.settlementSettled', 't.sn.calledOnLabel', 't.sn.redemptionSettlement']) {
      assert.ok(DETAIL.includes(key), `${key} must be present`)
    }
    // Contractual maturity is NOT erased — it stays in the terms grid.
    assert.match(DETAIL, /<TermField k=\{t\.sn\.colMaturity\} v=\{n\.maturityDate\} \/>/)
  })

  it('uses only shared Fable primitives and reduced-motion-gated wrappers', () => {
    for (const mod of ['GlassSurface', 'TableCard', 'BarrierGauge', 'AsyncState']) {
      assert.ok(DETAIL.includes(`@/components/fable/${mod}`), `${mod} must come from the shared library`)
    }
    assert.match(DETAIL, /@\/components\/fable\/motion/)
    assert.ok(!/animation\s*:/.test(DETAIL_CODE), 'no inline animation styles')
    assert.ok(!DETAIL_CODE.includes('onMouseMove'), 'no pointer-position React state')
  })

  it('uses token-only styling — no raw color scales, hex values, or bg-white/text-black', () => {
    assert.ok(!/bg-(gray|slate|zinc|emerald|red|blue|green)-\d/.test(DETAIL_CODE))
    assert.ok(!DETAIL_CODE.includes('bg-white') && !DETAIL_CODE.includes('text-black'))
    assert.ok(!/#[0-9A-Fa-f]{6}/.test(DETAIL_CODE), 'no hardcoded hex colors on the detail page')
  })

  it('mounts no second shell, TopBar, theme provider, or LangProvider of its own', () => {
    for (const banned of ['AppShell', 'TopBar', 'LangProvider>', 'ThemeProvider', 'AuthShell', 'login-santiago']) {
      assert.ok(!DETAIL_CODE.includes(banned), `page must not mount ${banned}`)
    }
    assert.match(DETAIL, /useLang\(\)/)
    assert.ok(!SHELL_GATE.includes("'/structured-notes'"), 'route stays under the one AppShell')
  })
})

describe('R4.2 — canonical routing preserved', () => {
  it('the canonical file is src/app/structured-notes/[id]/page.tsx and reads the id param', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/structured-notes/[id]/page.tsx')))
    assert.match(DETAIL, /useParams<\{ id: string \}>\(\)/)
  })

  it('back navigation targets /structured-notes; no modal-only or duplicate detail exists', () => {
    assert.match(DETAIL, /href="\/structured-notes"/)
    assert.ok(!DETAIL_CODE.includes('DetailPanel'), 'the supplementary panel never replaces the canonical page')
    // the only modal on this page is the R4.1 delete confirmation — never a
    // shell replacing the canonical detail content
    assert.ok(!DETAIL_CODE.includes('<ModalShell'), 'no modal replaces the canonical detail content')
    assert.ok(!/\?note=|noteId=/.test(DETAIL_CODE), 'no query-string detail navigation')
  })

  it('the R3 dashboard still links every note to the canonical detail route', () => {
    assert.match(DASH, /href=\{`\/structured-notes\/\$\{n\.id\}`\}/)
    assert.match(DASH, /router\.push\(`\/structured-notes\/\$\{n\.id\}`\)/)
  })
})

describe('R4.3 — API contracts and monitoring math unchanged', () => {
  it('the page calls exactly the pre-R4 endpoints with the same payloads', () => {
    assert.match(DETAIL, /fetch\(`\/api\/structured-notes\/\$\{id\}`, \{ cache: 'no-store' \}\)/)
    assert.match(DETAIL, /fetch\(`\/api\/structured-notes\/\$\{id\}\/allocations`, \{/)
    // R7.1B.1 — the allocation payload is unchanged: custody is a NOTE-level
    // fact (all of a note's accounts trade through one custodian), so it is
    // written by the note PATCH below, never as part of an allocation.
    assert.match(DETAIL, /body: JSON\.stringify\(\{ entityName, notionalAmount: notional \}\)/)
    assert.match(DETAIL, /method: 'PATCH'[\s\S]{0,160}custodian: value\.trim\(\) \|\| null/)
    assert.match(DETAIL, /fetch\(`\/api\/structured-notes\/\$\{id\}`, \{ method: 'DELETE' \}\)/)
  })

  it('every detail API route file still exists', () => {
    for (const rel of [
      'src/app/api/structured-notes/[id]/route.ts',
      'src/app/api/structured-notes/[id]/allocations/route.ts',
      'src/app/api/structured-notes/[id]/allocations/[allocationId]/route.ts',
    ]) {
      assert.ok(existsSync(join(ROOT, rel)), `${rel} must exist`)
    }
  })

  it('monitoring values are read from the API — never recomputed from prices on the client', () => {
    assert.match(DETAIL, /data\.metrics\.distances/)
    assert.match(DETAIL, /Never recomputed from prices/)
    assert.ok(!DETAIL_CODE.includes('calculateDistanceToBarrier'), 'no barrier math re-implemented')
    assert.ok(!DETAIL_CODE.includes('calculateWorstPerformer'), 'no worst-of math re-implemented')
    assert.ok(!DETAIL_CODE.includes("from '@/lib/providers"), 'never imports a server-only provider')
    assert.ok(!DETAIL_CODE.includes('supabase'), 'never touches Supabase directly')
  })

  it('the worst-distance capsule is a display-only SELECTION over the API values', () => {
    assert.match(DETAIL, /d\.distanceToKnockInBarrier\)\.filter/)
    assert.match(DETAIL, /Math\.max\(\.\.\.knockInDistances\)/)
  })

  it('the barrier gauge uses the R3 scale semantics as a pure display transform', () => {
    assert.match(DETAIL, /\(d\.currentLevel \/ strike\) \* 100/)
    assert.match(DETAIL, /kind: 'knockIn' as const, level: kiPct \* 100/)
    assert.match(DETAIL, /kind: 'strike' as const, level: 100/)
    assert.match(DETAIL, /distanceTone\(d\.distanceToCouponBarrier\)/)
    assert.match(DETAIL, /distanceTone\(d\.distanceToKnockInBarrier\)/)
  })
})

describe('R4.4 — every real section remains represented', () => {
  it('terms: grouped Fable grid with identity, coupon & barriers, and key dates', () => {
    assert.match(DETAIL, /t\.sn\.generalTerms/)
    for (const key of ['termsIdentity', 'termsEconomics', 'termsDates']) assert.ok(DETAIL.includes(`t.sn.${key}`))
    // R7.1B — the issue-size term is now labelled `totalIssuanceSize`
    // ("Total issuance size") everywhere, so it can never be read as Nevada's
    // own position. The FIELD is unchanged and still present; only its label
    // key moved. Guarded further in structuredNotesCustodianExposure.test.ts.
    for (const field of ['colIsin', 'guarantor', 'payoffType', 'currencyLabel', 'totalIssuanceSize', 'denomination', 'issuePrice', 'couponFrequency', 'couponBarrier', 'colKnockIn', 'autocallBarrier', 'colTrade', 'initialValuation', 'finalValuation', 'colMaturity', 'redemption']) {
      assert.ok(DETAIL.includes(`t.sn.${field}`), `terms field ${field} must be present`)
    }
  })

  it('boolean features render as chips only when TRUE — never a fabricated "No"', () => {
    assert.match(DETAIL, /\{n\.memoryCoupon && <FeatureChip label=\{t\.sn\.memoryCoupon\} \/>\}/)
    assert.match(DETAIL, /\{n\.principalProtection && <FeatureChip label=\{t\.sn\.principalProtection\} \/>\}/)
  })

  it('underlyings: contractual levels table with every real column', () => {
    for (const key of ['colUnderlyings', 'symbolLabel', 'initialLevel', 'strikeLevel']) assert.ok(DETAIL.includes(`t.sn.${key}`))
    for (const field of ['u.underlyingOrder', 'u.underlyingName', 'u.yahooSymbol', 'u.initialLevel', 'u.strikeLevel', 'u.knockInBarrierLevel', 'u.couponBarrierLevel', 'u.autocallBarrierLevel']) {
      assert.ok(DETAIL.includes(field), `underlying field ${field} must be present`)
    }
  })

  it('monitoring: current levels, distances, last-monitored + stale flag, worst designation as VISIBLE text', () => {
    assert.match(DETAIL, /t\.sn\.currentPrices/)
    assert.match(DETAIL, /t\.sn\.currentLevel/)
    assert.match(DETAIL, /d\.lastMonitoredDate/)
    assert.match(DETAIL, /d\.lastMonitoredStale/)
    assert.match(DETAIL, /t\.sn\.monitoring\.never/)
    // the worst chip is real text (t.sn.colWorst), not color- or hover-only
    assert.match(DETAIL, /\{t\.sn\.colWorst\}/)
  })

  // R13.7B2.2 § 2 — REWRITTEN. The canonical de-duplication still runs (coupon
  // and autocall stay separate records — the R13.7 repair), but the TABLE is
  // now built by the presentation aggregator: one row per valuation date,
  // carrying both outcomes. The old assertion required per-observation `o.*`
  // bindings, which is exactly the internal event model the owner review said
  // should not be exposed.
  it('schedule: canonical de-duplication feeds a ONE-ROW-PER-DATE display view', () => {
    assert.match(DETAIL, /dedupeObservationsByDate\(n\.observations\)/)
    assert.match(DETAIL, /buildScheduleRows\(deduped\)/)
    for (const field of ['r.valuationDate', 'r.paymentDate', 'r.couponBarrierPct', 'r.autocallBarrierPct', 'r.state', 'r.coupon', 'r.autocall', 'r.reviewRequired', 'r.reviewReason']) {
      assert.ok(DETAIL.includes(field), `schedule row field ${field} must be present`)
    }
    // Exactly one <tr> generator over the aggregated rows.
    assert.match(DETAIL, /scheduleRows\.map\(\(r\) =>/)
    assert.ok(!DETAIL.includes('deduped.map('), 'the raw canonical rows must not be rendered one-per-<tr>')
  })

  it('schedule statuses are human-readable, never storage enums', () => {
    assert.match(DETAIL, /t\.sn\.obsState\[state\]/)
    assert.match(DETAIL, /t\.sn\.obsOutcome\[outcome\]/)
    // The raw enum must not be printed as a cell value.
    assert.ok(!/\{\s*o\.status\s*\}/.test(DETAIL), 'raw observation status must not be rendered')
  })

  it('schedule rows distinguish past, next, and future from API data — no client date math', () => {
    assert.match(DETAIL, /r\.state === 'scheduled' && nextObs !== null/)
    assert.match(DETAIL, /r\.valuationDate === nextObs\.valuationDate/)
    assert.ok(!DETAIL_CODE.includes('new Date()'), 'no client-side today-classification')
    // the next observation is visually marked AND announced (● + sr-only)
    assert.match(DETAIL, /<span className="sr-only">\{t\.sn\.dashNextObs\}: <\/span>/)
  })

  it('the Fable lifecycle timeline (issued ✓ · observed dates · next ● / called-on · maturity ○) heads the schedule card', () => {
    assert.match(DETAIL, /const timeline:/)
    // R13.7B2.2.1 § 4 — the progress anchor is "Observed dates n / m" over
    // DISPLAY rows, no longer `monitoring.observedAt` over canonical records.
    for (const key of ['colIssued', 'obsProgress', 'dashNextObs', 'calledOnLabel', 'colMaturity']) {
      assert.ok(DETAIL.includes(`t.sn.${key}`), `timeline anchor ${key} must be present`)
    }
    assert.match(DETAIL, /observedCount/)
    assert.match(DETAIL, /value: `\$\{observedCount\} \/ \$\{scheduleRows\.length\}`/)
    assert.ok(!DETAIL.includes('${observedCount}/${deduped.length}'), 'the counter must not mix display rows with canonical records')
  })

  it('allocation: the entity grid workflow is preserved verbatim in behavior', () => {
    assert.match(DETAIL, /DEFAULT_ENTITIES/)
    assert.match(DETAIL, /function EntityAllocationGrid/)
    assert.match(DETAIL, /function formatWithThousands/)
    assert.match(DETAIL, /function parseFormattedNumber/)
    // R7.1B — the single "Allocated total / Issue size" line was replaced by
    // two SEPARATE, separately-explained quantities, because conflating them
    // is exactly what produced the false "does not match" warning. The total
    // is still shown (as Nevada investment notional); `allocationMismatch` is
    // still rendered but now only for the advisory review case.
    assert.match(DETAIL, /t\.sn\.nevadaInvestment\b/)
    assert.match(DETAIL, /t\.sn\.totalIssuanceSize\b/)
    assert.match(DETAIL, /t\.sn\.allocationMismatch/)
    assert.match(DETAIL, /t\.sn\.addAllocation/)
    assert.match(DETAIL, /t\.sn\.allocationsNote/)
    // R7.1B — the per-account custodian field joins the same grid workflow.
    assert.match(DETAIL, /t\.sn\.custodian\b/)
  })

  it('provenance: source type, file name and extraction confidence stay visible', () => {
    assert.match(DETAIL, /t\.sn\.provenance/)
    assert.match(DETAIL, /t\.sn\.sourcePdf/)
    assert.match(DETAIL, /t\.sn\.sourceManual/)
    assert.match(DETAIL, /n\.sourceFileName/)
    assert.match(DETAIL, /n\.confidenceScore/)
  })

  it('the current-levels table keeps the Yahoo footer, real as-of, and the estimate disclaimer', () => {
    assert.match(DETAIL, /source=\{t\.sn\.sourceMarket\} asOf=\{pricesAsOf\}/)
    assert.match(DETAIL, /p\.asOf && \(!max \|\| p\.asOf > max\)/)
    assert.match(DETAIL, /t\.sn\.monitoring\.estimateDisclaimer/)
    // R13.7B2.2 § 11 — these levels are a fixed contractual valuation close, so
    // the as-of is rendered as an unambiguous full date rather than the dense
    // platform-wide "DD-MM" convention.
    assert.match(DETAIL, /asOfFormat="full"/)
  })
})

describe('R4.5 — delete workflow preserved with explicit destructive treatment', () => {
  it('R4.1: the confirmation gate is the shared Fable dialog — window.confirm is gone', () => {
    assert.ok(!DETAIL_CODE.includes('window.confirm'), 'no browser-native confirm dialog')
    assert.match(DETAIL, /import \{ DestructiveConfirm \} from '@\/components\/fable\/ModalShell'/)
    assert.match(DETAIL, /<DestructiveConfirm/)
  })

  it('keeps the confirmation text, endpoint, and success-only redirect', () => {
    assert.match(DETAIL, /t\.sn\.confirmDelete/)
    assert.match(DETAIL, /fetch\(`\/api\/structured-notes\/\$\{id\}`, \{ method: 'DELETE' \}\)/)
    assert.match(DETAIL, /router\.push\('\/structured-notes'\)/)
  })

  it('the trigger only OPENS the dialog; the mutation fires only from the dialog confirm', () => {
    assert.match(DETAIL, /onClick=\{\(\) => \{ setDeleteFailed\(false\); setConfirmingDelete\(true\) \}\}/)
    assert.match(DETAIL, /onConfirm=\{deleteNote\}/)
    assert.match(DETAIL, /onCancel=\{\(\) => setConfirmingDelete\(false\)\}/)
    // exactly one DELETE call site on the page
    assert.equal((DETAIL_CODE.match(/method: 'DELETE'/g) ?? []).length, 1)
  })

  it('honest in-progress and failure states — no redirect on failure, error inside the dialog', () => {
    assert.match(DETAIL, /setDeleting\(true\)/)
    assert.match(DETAIL, /if \(!res\.ok\) \{ setDeleteFailed\(true\); return \}/)
    // the error renders inside the dialog while it is open, and adjacent to
    // the trigger once it is closed — never converted into a redirect
    assert.match(DETAIL, /\{deleteFailed && <p className="mt-2 text-xs text-negative" role="alert">\{t\.sn\.deleteError\}<\/p>\}/)
    assert.match(DETAIL, /\{deleteFailed && !confirmingDelete && <p className="mt-2 text-xs text-negative" role="alert">/)
    assert.match(DETAIL, /\{deleting && <p className="sr-only" role="status">\{t\.sn\.deleting\}<\/p>\}/)
  })

  it('the action is a labeled destructive button, never an ambiguous icon', () => {
    assert.match(DETAIL, /\{deleting \? t\.sn\.deleting : t\.sn\.delete\}/)
    assert.match(DETAIL, /border: '1px solid var\(--negative\)'/)
    assert.match(DETAIL, /disabled=\{deleting\}/)
  })
})

describe('R4.5b — R4.1 shared-dialog contract (locked in the shared component, adopted here)', () => {
  const MODAL = read('src/components/fable/ModalShell.tsx')

  it('DestructiveConfirm provides alertdialog semantics, focus management, and scroll lock', () => {
    assert.match(MODAL, /role="alertdialog"/)
    assert.match(MODAL, /aria-modal="true"/)
    assert.match(MODAL, /aria-labelledby=\{titleId\}/)
    assert.match(MODAL, /aria-describedby=\{description \? descId : undefined\}/)
    assert.match(MODAL, /document\.body\.style\.overflow = 'hidden'/)
    assert.match(MODAL, /triggerRef\.current as HTMLElement \| null\)\?\.focus/)
  })

  it('Escape cancels before submission but is blocked while the mutation is pending', () => {
    assert.match(MODAL, /useEscape\(open && canDismiss, onClose\)/)
    assert.match(MODAL, /dismissDisabled=\{pending\}/)
  })

  it('duplicate submission is guarded at the dialog level and the caller level', () => {
    assert.match(MODAL, /if \(pending \|\| firedRef\.current\) return/)
    assert.match(DETAIL, /pending=\{deleting\}/)
  })

  it('cancel is a safe chip; the destructive action uses the critical fill tokens — never icon-only', () => {
    assert.match(MODAL, /<ChipButton onClick=\{onCancel\} disabled=\{pending\}>/)
    assert.match(MODAL, /var\(--critical-fill\)/)
    assert.match(MODAL, /aria-busy=\{pending \|\| undefined\}/)
  })

  it('the dialog description names the REAL record from existing fields only', () => {
    // R7.1B widened the description; R12 REMOVED the Nevada investment
    // notional from it — it is one of the six documented private amounts and
    // the dialog printed it raw regardless of Privacy Mode. Product, ISIN,
    // issuer and allocation count identify the record unambiguously without
    // disclosing an amount; every part is still read from fields already on
    // the loaded payload — nothing estimated, nothing fabricated.
    const desc = DETAIL.slice(DETAIL.indexOf('description={['), DETAIL.indexOf("].filter(Boolean).join(' · ')"))
    for (const field of ['n.productName', 'n.isin', 'n.issuerDisplayName', 'activeAllocations.length']) {
      assert.ok(desc.includes(field), `${field} must identify the record`)
    }
    assert.ok(!desc.includes('nevadaInvestment'), 'the private amount must not appear in the dialog (R12)')
    assert.doesNotMatch(desc, /Math\.|estimate|approx/i, 'no derived or estimated value in the identification')
  })

  it('EN and ES labels come from the existing dictionary — no new hardcoded copy', () => {
    for (const key of ['t.sn.delete', 't.sn.cancel', 't.sn.confirmDelete', 't.sn.deleting', 't.sn.deleteError']) {
      assert.ok(DETAIL.includes(key), `${key} must label the dialog`)
    }
    assert.ok(I18N.includes("delete: 'Eliminar nota'"))
    assert.ok(I18N.includes("cancel: 'Cancelar'"))
  })

  it('no application-controlled native dialog remains anywhere in src', () => {
    // window.confirm/alert/prompt are banned app-wide now that the shared
    // Fable dialog exists (browser/OS interfaces like file pickers and the
    // print dialog are out of scope by design — window.print stays).
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [])
    for (const rel of walk('src')) {
      const src = strip(read(rel))
      for (const banned of ['window.confirm(', 'window.alert(', 'window.prompt(', 'globalThis.confirm(', 'globalThis.alert(', 'globalThis.prompt(']) {
        assert.ok(!src.includes(banned), `${rel} must not call ${banned}`)
      }
    }
  })
})

describe('R4.6 — real-data states honest and complete', () => {
  it('loading, API-failure, and not-found are three DISTINCT states', () => {
    assert.match(DETAIL, /<AsyncState kind="loading" \/>/)
    assert.match(DETAIL, /<AsyncState kind="error" \/>/)
    assert.match(DETAIL, /<AsyncState kind="empty" message=\{t\.sn\.notFound\} \/>/)
    assert.match(DETAIL, /setLoadFailed\(true\)/)
  })

  it('missing prices render the honest unavailable copy, never zero', () => {
    assert.match(DETAIL, /d\.currentLevel !== null \? fmtNum\(d\.currentLevel\) : <span className="text-muted-fg">\{t\.sn\.unavailable\}<\/span>/)
  })

  it('missing terms render as "—" via the shared TermField, never fabricated values', () => {
    assert.match(DETAIL, /\{v \|\| '—'\}/)
  })
})

describe('R4.7 — no Fable mock structured-note content', () => {
  it('none of the Fable prototype sample notes/issuers/valuations appear', () => {
    for (const mock of [
      'Autocall Worst-of US Tech', 'Reverse Convertible SQM', 'Memory Coupon EURO STOXX',
      'Capital Protected S&P 500', 'Worst-of Chilean Banks', 'Autocall Copper Miners',
      'J.P. Morgan', 'Morgan Stanley', 'Citigroup', 'UBS',
      'Sample data', 'sample data', '112.4', '91.3', '104.8', '108.2', '96.7', '109.4',
      'View termsheet in Documents', 'Q1 2026',
    ]) {
      // stripped source — the header comment legitimately NAMES the omitted
      // Fable elements while the rendered page must never contain them
      assert.ok(!DETAIL_CODE.includes(mock), `Fable mock content "${mock}" must not enter production`)
    }
  })

  it('all note data comes from the real API, never a local fixture', () => {
    assert.ok(!/from '.*fixtures/.test(DETAIL), 'no fixture import')
    assert.ok(!/const NOTE\s*=/.test(DETAIL_CODE), 'no embedded note record')
  })
})

describe('R4.8 — localization and accessibility', () => {
  it('adds every new R4 key in BOTH dictionaries', () => {
    for (const key of [
      'notFound:', 'guarantor:', 'couponBarrier:', 'autocallBarrier:', 'initialValuation:',
      'finalValuation:', 'redemption:', 'payoffType:', 'couponFrequency:', 'denomination:',
      'issuePrice:', 'currencyLabel:', 'memoryCoupon:', 'principalProtection:', 'termsIdentity:',
      'termsEconomics:', 'termsDates:', 'initialLevel:', 'strikeLevel:', 'symbolLabel:',
      'currentLevel:', 'valuationDate:', 'paymentDate:', 'deleting:', 'deleteError:', 'removeEntity:',
    ]) {
      const count = I18N.split(key).length - 1
      assert.ok(count >= 2, `${key} must exist in EN and ES (found ${count})`)
    }
    assert.ok(I18N.includes("'Nota estructurada no encontrada'"))
    assert.ok(I18N.includes("'Cupón y barreras'"))
  })

  it('no hardcoded visible English labels remain from the legacy page', () => {
    for (const legacy of ['>Guarantor<', "'Coupon barrier'", "'Autocall barrier'", "'Final valuation'", ">'Yahoo'<", 'not found', 'title="remove"']) {
      assert.ok(!DETAIL.includes(legacy), `legacy hardcoded label ${legacy} must be translated`)
    }
  })

  it('tables keep semantics: sr-only captions and scoped headers', () => {
    assert.equal((DETAIL.match(/<caption className="sr-only">/g) ?? []).length, 3)
    assert.match(DETAIL, /scope="col"/)
  })

  it('form controls carry accessible names', () => {
    assert.match(DETAIL, /aria-label=\{t\.sn\.entity\}/)
    // R7.1B — the notional input's name says WHICH quantity it is
    // ("Account notional: <entity> — <currency>").
    assert.match(DETAIL, /aria-label=\{`\$\{t\.sn\.accountNotional\}: \$\{name\} — \$\{currency\}`\}/)
    // R7.1B.1 — one labelled custodian field for the whole note.
    assert.match(DETAIL, /<label htmlFor="sn-custodian"/)
    assert.match(DETAIL, /aria-label=\{t\.sn\.custodian\}/)
    assert.match(DETAIL, /aria-label=\{`\$\{t\.sn\.removeEntity\}: \$\{name\}`\}/)
  })

  it('status meaning is never color- or hover-only', () => {
    assert.match(DETAIL, /riskLabel\(data\.metrics\.riskStatus\)/)
    assert.match(DETAIL, /\{t\.sn\.monitoring\.priceStale\}/)
    // the product name wraps rather than relying on a hover tooltip
    assert.match(DETAIL, /className="break-words"/)
  })
})

describe('R4.9 — responsive containment', () => {
  it('all three dense tables scroll horizontally inside their card, never the page', () => {
    // R13.7B2.2.1 § 7 — the underlyings table moved into the combined
    // terms/underlyings block, so two tables use TableCard's minWidth and the
    // third carries the same card-level overflow-x-auto + min-width contract
    // inline (the exact anatomy TableCard implements).
    assert.equal((DETAIL.match(/minWidth=\{680\}/g) ?? []).length, 2, 'monitoring + schedule TableCards')
    assert.ok(!DETAIL.includes('<TableCard title={t.sn.underlyings}'), 'the underlyings table no longer sits in its own card')
    assert.match(DETAIL, /<div className="overflow-x-auto">\s*<div style=\{\{ minWidth: 560 \}\}>/)
  })

  // R13.7B2.2.1 § 1 — the schedule renders in full; the page scrolls.
  it('no table on the detail page has an inner vertical scroll region', () => {
    assert.ok(!/maxHeight=/.test(DETAIL), 'no TableCard maxHeight — the Observation Schedule must not scroll internally')
    assert.ok(!/overflowY|overflow-y-auto/.test(DETAIL_CODE), 'no inline vertical scroll container')
  })

  it('multi-column bands stack below lg; no page-level width rule', () => {
    assert.match(DETAIL, /grid-cols-1 lg:grid-cols-2/)
    assert.ok(!DETAIL_CODE.includes('min-width: 1200px'))
    assert.ok(!DETAIL_CODE.includes('overflow-x-visible'))
  })
})

describe('R4.10 — R1.5 security boundary untouched', () => {
  it('the detail route and APIs stay private under the shared default-deny policy', async () => {
    const { classifyPath, PUBLIC_PAGE_PATHS } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/structured-notes/some-id'), 'private_page')
    assert.equal(classifyPath('/api/structured-notes/some-id'), 'private_api')
    assert.equal(classifyPath('/api/structured-notes/some-id/allocations'), 'private_api')
    assert.deepEqual([...PUBLIC_PAGE_PATHS], ['/login', '/forgot-password', '/auth/reset-password'])
  })

  it('no registration surface returned; middleware never names the route', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/api/auth/register')), 'register route stays absent')
    assert.ok(!read('src/middleware.ts').includes("'/structured-notes'"), 'route never named in middleware')
  })
})

describe('R4.11 — the R3 dashboard is unchanged apart from the display-helper export', () => {
  it('the dashboard still renders its own R3 composition (locked by its own suite)', () => {
    assert.match(DASH, /<PageHeader/)
    assert.match(DASH, /minWidth=\{COLS\.reduce\(\(a, b\) => a \+ b, 0\)\}/)
    assert.match(DASH, /function StatCapsule/)
  })

  it('the compatibility change is export-only — no dashboard behavior was touched for R4', () => {
    assert.match(DASH, /export \{ fmtPct, fmtNum, distanceTone, shortUnderlying, StatCapsule, RISK_TONE \}/)
  })
})
