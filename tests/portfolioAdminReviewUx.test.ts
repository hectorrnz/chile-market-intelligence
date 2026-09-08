// R13.8C §§ 2-13 — the owner-review presentation of the weekly import.
//
// WHAT THIS FILE PROVES. R13.8B proved the workflow's SEMANTICS (classification,
// atomic apply, rollback lineage) and did not change here. This file proves the
// PRESENTATION of those semantics: that the console says what confirming does,
// shows every catch-up week, keeps a gap fill visibly apart from a correction,
// gates an overwrite behind a reason, never offers an enabled Apply for a no-op,
// reports the live column as a diagnostic rather than a control, keeps every
// administrator control behind the administrator-ready state — and that the
// synthetic review states are produced by the REAL planner through the REAL
// preview mapping, are served only after the administrator guard and only off
// production, and can never be written.
//
// NO PRIVATE DATA. Every figure in the fixtures is a small synthetic integer.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  IMPORT_FIXTURE_IDS,
  IMPORT_FIXTURE_ID_LIST,
  IMPORT_FIXTURE_OPERATION_IDS,
  FIXTURE_UPLOAD_STATUS,
  buildImportFixture,
  isImportFixtureId,
  isImportFixtureOperationId,
  listImportFixtureUploads,
  listImportFixtureOperations,
} from '../src/lib/familyPortfolio/fixtures/importPreviewFixtures.ts'
import { reviewFixturesEnabled } from '../src/lib/reviewFixtures.ts'
import { reviewFixturesEnabled as snGate } from '../src/lib/structuredNotes/fixtures/calledStateFixture.ts'
import {
  WORKFLOW_STEPS,
  TONE,
  describeImportPlan,
  isNoOp,
  nonCorrectionBlockCodes,
  correctionDelta,
  fill,
} from '../src/lib/familyPortfolio/importPlanPresentation.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Strips comments so a prose mention never satisfies a code assertion. */
const codeOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const PAGE = 'src/app/portfolio/admin/page.tsx'
const COMPONENT = 'src/components/familyPortfolio/ImportPlanPreview.tsx'
const PRESENTATION = 'src/lib/familyPortfolio/importPlanPresentation.ts'
const FIXTURES = 'src/lib/familyPortfolio/fixtures/importPreviewFixtures.ts'
const GATE = 'src/lib/reviewFixtures.ts'
const UPLOADS_ROUTE = 'src/app/api/family-portfolio/admin/uploads/route.ts'
const DRAFT_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/route.ts'
const PUBLISH_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts'
const IMPORT_ROLLBACK_ROUTE = 'src/app/api/family-portfolio/admin/imports/[id]/rollback/route.ts'
const PREVIEW_MODULE = 'src/lib/familyPortfolio/weeklyImportPreview.ts'

const page = read(PAGE)
const component = read(COMPONENT)
const surface = page + component

/** The source of one function declared in the component file, up to the next top-level declaration. */
function fnSource(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} must exist`)
  const ends = ['\nfunction ', '\nexport function ', '\nexport interface ', '\ninterface ', '\n// ──']
    .map((marker) => src.indexOf(marker, start + 1))
    .filter((i) => i > start)
  return src.slice(start, ends.length ? Math.min(...ends) : undefined)
}

const fixture = (key: keyof typeof IMPORT_FIXTURE_IDS) => {
  const f = buildImportFixture(IMPORT_FIXTURE_IDS[key])
  assert.ok(f, `${key} must resolve`)
  return f
}

// ═══════════════════════════════════════════════════════════════════════════
// § 2 · The front door
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 2 — the upload front door', () => {
  test('the file input still posts to the EXISTING upload endpoint', () => {
    assert.match(page, /fetch\('\/api\/family-portfolio\/admin\/uploads', \{ method: 'POST', body: form \}\)/)
    assert.match(page, /type="file"/)
    assert.match(page, /accept="\.xlsx/)
  })

  test('the selected filename is shown, never a path', () => {
    // The browser supplies a bare `File.name`; the page renders exactly that and
    // never reads or composes a filesystem path.
    assert.match(page, /\{file \? file\.name : a\.noFileChosen\}/)
    assert.ok(!/webkitRelativePath|\.path\b/.test(codeOf(page)))
  })

  test('the five-step indicator names every step in both languages', () => {
    assert.match(page, /<WorkflowSteps current=\{step\} \/>/)
    assert.deepEqual([...WORKFLOW_STEPS], ['choose', 'upload', 'parse', 'preview', 'confirm'])
    for (const lang of [dict.en, dict.es]) {
      for (const step of WORKFLOW_STEPS) {
        assert.ok(lang.fpAdmin.steps[step].length > 0, `${step} must be labelled`)
      }
    }
  })

  test('the parse state is announced while the draft loads', () => {
    assert.match(page, /\{loading && \([\s\S]{0,120}a\.parsing/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 3 · Hierarchy
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 3 — the preview is composed in order of consequence', () => {
  const composition = fnSource(component, 'ImportPlanPreview')

  test('verdict → publication facts → new/gap-fill → historical changes → warnings → details', () => {
    const order = ['<ImportVerdictBanner', '<PublicationFacts', '<NewWeeksCard', '<GapFillsCard', '<HistoricalChangesCard', '<PlanWarnings', '<ReviewDetails']
    const positions = order.map((tag) => composition.indexOf(tag))
    for (let i = 0; i < positions.length; i++) {
      assert.ok(positions[i] >= 0, `${order[i]} must be rendered`)
      if (i > 0) assert.ok(positions[i] > positions[i - 1], `${order[i]} must follow ${order[i - 1]}`)
    }
  })

  test('the secondary material is folded into a details block', () => {
    const details = fnSource(component, 'ReviewDetails')
    assert.match(details, /<details/)
    for (const key of ['planUnchanged', 'planCadence', 'planSchema', 'planFrozenColumn', 'scopeSummary', 'performanceChecks', 'findings']) {
      assert.ok(details.includes(`a.${key}`), `${key} is secondary`)
    }
  })

  test('the R13.5 review substance survives — nothing was removed to make room', () => {
    for (const key of ['scopeSummary', 'groups', 'performanceChecks', 'unclassified', 'findings', 'noFindings', 'detectedDate', 'previousWeek', 'beginningOfYear', 'noAmountsNote']) {
      assert.ok(component.includes(`a.${key}`), `${key} must still render`)
    }
    assert.match(component, /review\.groups\.map/)
    assert.match(component, /unclassifiedEventCells/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 4 · Catch-up
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 4 — a catch-up shows every week and names the one that becomes current', () => {
  const f = fixture('threeNewWeeks')
  const plan = f.importPlan!

  test('the fixture is a three-week catch-up planned by the real planner', () => {
    assert.equal(plan.action, 'multi_week_append')
    assert.deepEqual(plan.newDates, ['2026-08-07', '2026-08-14', '2026-08-21'])
    assert.equal(plan.productionEndpoint, '2026-07-31')
    assert.equal(plan.publicationDate, '2026-08-21')
    assert.equal(plan.blocked, false)
  })

  test('the verdict says all three are stored and which one becomes current', () => {
    const v = describeImportPlan(plan, dict.en.fpAdmin)
    assert.equal(v.kind, 'append')
    assert.match(v.title, /^3 new weeks/)
    assert.match(v.body, /All 3 weeks/)
    assert.match(v.body, /2026-08-21 becomes the current publication/)
    const es = describeImportPlan(plan, dict.es.fpAdmin)
    assert.match(es.title, /3 semanas nuevas/)
    assert.match(es.body, /2026-08-21/)
  })

  test('every new date is rendered as a chip, and the current one is labelled in words', () => {
    const card = fnSource(component, 'NewWeeksCard')
    assert.match(card, /dates=\{plan\.newDates\}/)
    assert.match(card, /currentDate=\{plan\.publicationDate\}/)
    assert.match(card, /currentLabel=\{a\.planBecomesCurrent\}/)
    const chips = fnSource(component, 'DateChips')
    assert.match(chips, /dates\.map\(/, 'all dates, never a slice')
    assert.ok(!/slice\(|\.length > 1/.test(chips))
  })

  test('the publication facts show endpoint, new publication and newest frozen week', () => {
    const facts = fnSource(component, 'PublicationFacts')
    for (const key of ['planEndpoint', 'planPublication', 'planNewestFrozen', 'planSource', 'planSourceFrozen']) {
      assert.ok(facts.includes(`a.${key}`), key)
    }
  })

  test('a one-week append reads as one week, and only the count changes', () => {
    const one = describeImportPlan(fixture('oneNewWeek').importPlan!, dict.en.fpAdmin)
    assert.equal(one.kind, 'append')
    assert.equal(one.title, dict.en.fpAdmin.verdictAppendOneTitle)
    assert.match(one.body, /2026-08-07 becomes the current publication/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 5 · Gap fill
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 5 — a gap fill looks like an insertion, not a correction', () => {
  const plan = fixture('gapFillAndNew').importPlan!

  test('the fixture inserts one week below the endpoint and one above it', () => {
    assert.deepEqual(plan.gapFillDates, ['2026-07-03'])
    assert.deepEqual(plan.newDates, ['2026-08-07'])
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.blocked, false)
  })

  test('the verdict is an ordinary append that mentions the gap fill', () => {
    const v = describeImportPlan(plan, dict.en.fpAdmin)
    assert.equal(v.kind, 'append')
    assert.equal(v.tone, TONE.new)
    assert.match(v.body, /1 gap fill is inserted below the current endpoint/)
  })

  test('the gap-fill card uses its own tone and carries no correction control', () => {
    assert.notEqual(TONE.gapFill, TONE.changed)
    const gap = fnSource(component, 'GapFillsCard')
    assert.match(gap, /TONE\.gapFill/)
    assert.ok(!gap.includes('TONE.changed'))
    assert.ok(!/checkbox|correctionReason|onAuthorizedChange/.test(gap), 'a gap fill needs no authorization')
    assert.ok(gap.includes('a.planGapFillHint'))
  })

  test('the copy says insertions, not overwrites, in both languages', () => {
    assert.match(dict.en.fpAdmin.planGapFillHint, /insertions, not overwrites/)
    assert.match(dict.en.fpAdmin.planGapFillHint, /normal confirmation remains available/i)
    assert.match(dict.es.fpAdmin.planGapFillHint, /inserciones, no sobrescrituras/)
  })

  test('a gap fill never triggers correction mode', () => {
    // Structural, on the whole surface: the gate reads one field.
    assert.ok(!/gapFillDates\.length > 0 &&[\s\S]{0,80}correction/i.test(surface))
    assert.ok(!/newDates\.length > 1/.test(surface))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 6 · Historical correction
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 6 — an overwrite is unmistakable and needs a reason', () => {
  const plan = fixture('changedRequiresReason').importPlan!

  test('the fixture overwrites two identities and is blocked without authorization', () => {
    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.deepEqual(plan.blockCodes, ['historical_correction_required'])
    assert.equal(plan.corrections.length, 2)
    for (const c of plan.corrections) {
      assert.notEqual(c.beforeValue, c.afterValue)
      assert.equal(c.observationDate, '2026-07-17')
      assert.equal(typeof correctionDelta(c), 'number')
    }
    assert.equal(plan.newDates.length + plan.gapFillDates.length, 0)
  })

  test('the verdict is the correction kind and says nothing is added', () => {
    const v = describeImportPlan(plan, dict.en.fpAdmin)
    assert.equal(v.kind, 'correction')
    assert.equal(v.tone, TONE.changed)
    assert.equal(v.title, dict.en.fpAdmin.verdictCorrectionTitle)
    assert.match(v.body, /2 published value\(s\) would be overwritten\. Nothing is added/)
  })

  test('the correction card shows scope, date, metric, current value, workbook value and change', () => {
    const card = fnSource(component, 'HistoricalChangesCard')
    for (const key of ['colScope', 'colObservationDate', 'colMetric', 'colCurrentValue', 'colWorkbookValue', 'colDelta']) {
      assert.ok(card.includes(`a.${key}`), key)
    }
    assert.match(card, /formatUsd\(c\.beforeValue, 0\)/)
    assert.match(card, /formatUsd\(c\.afterValue, 0\)/)
    assert.match(card, /correctionDelta\(c\)/)
  })

  test('the reason field sits INSIDE the correction card, with the stronger confirmation', () => {
    const card = fnSource(component, 'HistoricalChangesCard')
    assert.match(card, /type="checkbox"/)
    assert.match(card, /controls\.onReasonChange/)
    assert.match(card, /\{controls\.action\}/)
    assert.match(card, /TONE\.changed/)
    // It is the only card that renders a form control.
    for (const other of ['NewWeeksCard', 'GapFillsCard', 'PublicationFacts', 'ImportVerdictBanner']) {
      assert.ok(!/<input/.test(fnSource(component, other)), `${other} carries no control`)
    }
  })

  test('the stronger confirmation is gated on authorization AND a non-empty reason', () => {
    assert.match(page, /correctionIncomplete\s*=\s*[\r\n]?\s*needsCorrection && \(!correctionAuthorized \|\| correctionReason\.trim\(\)\.length === 0\)/)
    assert.match(page, /disabled=\{cannotSubmit \|\| correctionIncomplete\}/)
    assert.ok(page.includes('a.applyCorrection'))
  })

  test('the normal confirmation is disabled whenever an overwrite is present', () => {
    assert.match(page, /disabled=\{[\s\S]{0,600}needsCorrection \|\|[\s\S]{0,40}correctionIncomplete[\s\S]{0,40}\}/)
    assert.ok(page.includes('a.normalConfirmDisabled'))
  })

  test('the mixed fixture carries NEW + GAP_FILL + CHANGED and is still gated on the overwrite alone', () => {
    const mixed = fixture('mixed').importPlan!
    assert.equal(mixed.action, 'append_with_correction')
    assert.equal(mixed.newDates.length, 2)
    assert.equal(mixed.gapFillDates.length, 1)
    assert.equal(mixed.corrections.length, 2)
    assert.deepEqual(mixed.blockCodes, ['historical_correction_required'])
    const v = describeImportPlan(mixed, dict.en.fpAdmin)
    assert.equal(v.kind, 'correction')
    assert.match(v.body, /2 new week\(s\) and 1 gap fill\(s\) would be stored, and 2 published value\(s\) overwritten/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 7 · No changes
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 7 — a no-op is calm and offers no enabled Apply', () => {
  const plan = fixture('noChanges').importPlan!

  test('the fixture is nothing_to_append and unblocked', () => {
    assert.equal(plan.action, 'nothing_to_append')
    assert.equal(isNoOp(plan), true)
    assert.equal(plan.blocked, false)
    assert.equal(plan.newDates.length + plan.gapFillDates.length + plan.corrections.length, 0)
    assert.equal(plan.unchangedCount, 14)
  })

  test('the verdict is neutral and says no changes will be made', () => {
    const v = describeImportPlan(plan, dict.en.fpAdmin)
    assert.equal(v.kind, 'nothing')
    assert.equal(v.tone, TONE.neutral)
    assert.match(v.body, /already reflected in the portfolio history\. No changes will be made/)
  })

  test('the page disables the confirm button for a no-op and relabels it', () => {
    assert.match(page, /const nothingToApply = plan !== null && isNoOp\(plan\)/)
    assert.match(page, /disabled=\{[\s\S]{0,300}nothingToApply \|\|/)
    assert.match(page, /\{nothingToApply \? a\.nothingToApply : a\.publish\}/)
  })

  test('a no-op is decided by the plan the server sent, never by the page', () => {
    // The page reads `action` through the presentation module only.
    assert.ok(!codeOf(page).includes('nothing_to_append'))
    assert.match(read(PRESENTATION), /plan\.action === 'nothing_to_append'/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 8 · Live column
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 8 — the live column is a diagnostic, never a control', () => {
  test('it is reported as detected and marked not used for publication', () => {
    const facts = fnSource(component, 'PublicationFacts')
    assert.ok(facts.includes('a.planLiveDetected'))
    assert.ok(facts.includes('a.planLiveNotUsed'))
    assert.match(facts, /data-diagnostic="live-column"/)
  })

  test('nothing in the diagnostic line is interactive', () => {
    const facts = fnSource(component, 'PublicationFacts')
    const start = facts.indexOf('data-diagnostic="live-column"')
    const end = facts.indexOf('</p>', start)
    const line = facts.slice(start, end)
    assert.ok(line.length > 0)
    assert.ok(!/<button|<select|<input|onClick|href=/.test(line), 'the live column must not look selectable')
  })

  test('the publication source is named as the frozen snapshot', () => {
    assert.equal(dict.en.fpAdmin.planSourceFrozen, 'Frozen weekly snapshot')
    assert.ok(dict.es.fpAdmin.planSourceFrozen.length > 0)
  })

  test('no fixture ever proposes the live date, and the live column is structurally unpublishable', () => {
    for (const id of IMPORT_FIXTURE_ID_LIST) {
      const f = buildImportFixture(id)!
      const frozen = f.review.frozen!
      assert.equal(frozen.liveColumnPublishable, false)
      if (f.importPlan) {
        assert.ok(frozen.liveColumnDate! > f.importPlan.publicationDate!, 'the live column is newer than the frozen publication')
        assert.ok(!f.importPlan.newDates.includes(frozen.liveColumnDate!), 'the live date is never a NEW week')
      }
    }
  })

  test('no raw #NAME? dump reaches the normal UI', () => {
    assert.ok(!surface.includes('#NAME?'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 9 · Admin-only
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 9 — every administrator control stays behind the ready state', () => {
  test('the step indicator, upload, preview and ledger render only when the console index returned 200', () => {
    const ready = page.indexOf("state === 'ready'")
    assert.ok(ready > 0)
    for (const tag of ['<WorkflowSteps', '<UploadPanel', '<ReviewPanel', 'a.importsTitle', '<DeleteButton']) {
      assert.ok(page.indexOf(tag) > ready, `${tag} lives inside the ready branch`)
    }
    assert.match(page, /state === 'denied'[\s\S]{0,80}notAuthorized/)
  })

  test('the correction reason field exists only inside the preview component, which the page renders only for a loaded review', () => {
    assert.ok(!/correctionReason[\s\S]{0,40}<input/.test(page), 'the page has no reason input of its own')
    assert.match(page, /\{review && \([\s\S]{0,200}<ImportPlanPreview/)
  })

  test('authorization did not change: every route still guards session then capability', () => {
    for (const rel of [UPLOADS_ROUTE, DRAFT_ROUTE, PUBLISH_ROUTE, IMPORT_ROLLBACK_ROUTE]) {
      const src = read(rel)
      assert.match(src, /await guardPrivateApi\(\)/, rel)
      assert.match(src, /isAdministrator/, rel)
      assert.match(src, /403/, rel)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 10 · Rollback
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 10 — the rollback control names what it reverses', () => {
  test('both rollbacks use the shared destructive control with a visible question', () => {
    assert.match(page, /import \{ DeleteButton \} from '@\/components\/fable\/DeleteButton'/)
    assert.equal((page.match(/<DeleteButton/g) ?? []).length, 2)
    assert.match(page, /confirmLabel=\{a\.rollbackImportConfirm\}/)
    assert.match(page, /confirmLabel=\{a\.rollbackPublicationConfirm\}/)
    assert.match(dict.en.fpAdmin.rollbackImportHint, /Removes every week it inserted, restores every value it corrected/)
  })

  test('the import rollback is labelled with its publication date and source workbook', () => {
    assert.match(page, /label=\{`\$\{a\.rollbackImport\}: \$\{op\.asOfDate\} · \$\{source\}`\}/)
    assert.match(page, /const source = filenameOf\(op\.uploadId\)/)
    assert.ok(page.includes('a.colImportSource'))
  })

  test('the ledger shows NEW / GAP_FILL / CHANGED counts, each in its own tone', () => {
    assert.match(page, /<CountToken label=\{a\.planNew\} value=\{c\.new \?\? 0\} tone=\{TONE\.new\} \/>/)
    assert.match(page, /<CountToken label=\{a\.planGapFill\} value=\{c\.gapFill \?\? 0\} tone=\{TONE\.gapFill\} \/>/)
    assert.match(page, /<CountToken label=\{a\.planChanged\} value=\{c\.changed \?\? 0\} tone=\{TONE\.changed\} \/>/)
  })

  test('the handlers are unchanged: same endpoints, refusal surfaced, boolean resolved for the control', () => {
    assert.match(page, /\/api\/family-portfolio\/admin\/imports\/\$\{id\}\/rollback/)
    assert.match(page, /\/api\/family-portfolio\/admin\/publications\/\$\{id\}\/rollback/)
    assert.match(page, /setRollbackError\(/)
    assert.match(page, /async \(id: string\): Promise<boolean> =>/)
    assert.match(page, /\{!op\.rolledBackAt && \(/)
  })

  test('the fixture ledger carries one active and one reversed import', () => {
    const ops = listImportFixtureOperations()
    assert.equal(ops.length, 2)
    const active = ops.find((o) => o.id === IMPORT_FIXTURE_OPERATION_IDS.activeCatchUp)!
    const reversed = ops.find((o) => o.id === IMPORT_FIXTURE_OPERATION_IDS.rolledBackCorrection)!
    assert.equal(active.rolledBackAt, null)
    assert.equal(active.counts.new, 15)
    assert.ok(reversed.rolledBackAt)
    assert.equal(reversed.correctionAuthorized, true)
    assert.match(reversed.correctionReason!, /FIXTURE/)
    for (const o of ops) assert.ok(isImportFixtureId(o.uploadId), 'a fixture import points at a fixture upload')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 12 · Synthetic states
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C § 12 — the review fixtures are real-planner output and cannot touch Production', () => {
  test('eight fixed ids, one per required state, and nothing else resolves', () => {
    // R13.8C.2 added H: history settled, standing snapshot restated — the one
    // state real data can least produce and the one R13.8C.1 got wrong.
    assert.equal(IMPORT_FIXTURE_ID_LIST.length, 8)
    const actions = Object.fromEntries(
      Object.entries(IMPORT_FIXTURE_IDS).map(([k, id]) => [k, buildImportFixture(id)!.importPlan?.action ?? null]),
    )
    assert.deepEqual(actions, {
      noChanges: 'nothing_to_append',
      oneNewWeek: 'append_single_week',
      threeNewWeeks: 'multi_week_append',
      gapFillAndNew: 'multi_week_append',
      changedRequiresReason: 'historical_correction_only',
      mixed: 'append_with_correction',
      validationFailure: null,
      publicationCorrection: 'publication_correction',
    })
    assert.equal(buildImportFixture('00000000-0000-4000-8000-0000000f1c99'), null)
    assert.equal(buildImportFixture('not-a-fixture'), null)
    assert.equal(isImportFixtureId('00000000-0000-4000-8000-0000000f1c99'), false)
  })

  test('every fixture id is a well-formed v4 UUID, so it passes the routes\' shape check and reaches the fixture branch', () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    for (const id of [...IMPORT_FIXTURE_ID_LIST, ...Object.values(IMPORT_FIXTURE_OPERATION_IDS)]) {
      assert.match(id, UUID)
    }
  })

  test('the validation-failure state has no plan, a blocking finding and is not publishable', () => {
    const g = fixture('validationFailure')
    assert.equal(g.importPlan, null)
    assert.equal(g.review.publishable, false)
    assert.deepEqual(g.review.refusals, ['draft_not_parsed', 'blocking_findings'])
    assert.ok(g.review.findings.some((f) => f.severity === 'blocking' && f.code === 'no_publishable_frozen_column'))
    assert.equal(g.review.frozen!.refusal, 'no_publishable_frozen_column')
  })

  test('fixtures are produced by the REAL planner through the REAL preview mapping — no second planner', () => {
    const src = read(FIXTURES)
    assert.match(src, /import \{[\s\S]*?planWeeklyImport[\s\S]*?\} from '\.\.\/weeklyImportPlan\.ts'/)
    assert.match(src, /previewFromPlan\(plan, \{/)
    // It supplies observations and reads dispositions; it never assigns one.
    assert.ok(!/disposition:/.test(codeOf(src)), 'the fixture must not classify')
    assert.ok(!/newDates:|gapFillDates:|corrections:/.test(codeOf(src)), 'the fixture must not hand-build a plan')
    // …and the real path uses the same mapping.
    const preview = read(PREVIEW_MODULE)
    const build = preview.indexOf('export function buildWeeklyImportPreview')
    assert.ok(preview.indexOf('previewFromPlan(plan, {', build) > build)
  })

  test('the fixture module is pure — no database, network, environment or clock', () => {
    const src = read(FIXTURES)
    for (const forbidden of ['supabase', 'fetch(', 'from(', 'await ', 'process.env', '@/lib/db', 'Date.now', 'new Date()']) {
      assert.ok(!src.includes(forbidden), `the fixture must stay pure — found ${forbidden}`)
    }
  })

  test('every fixture is openly synthetic — FIXTURE in every filename and reason, a sentinel status, no real amount', () => {
    for (const u of listImportFixtureUploads()) {
      assert.match(u.originalFilename, /^FIXTURE-/)
      assert.equal(u.status, FIXTURE_UPLOAD_STATUS)
      assert.equal(u.uploadKind, 'portfolio')
    }
    // No literal shaped like a real portfolio amount: strip the UUID prefix and
    // the id literals, then look for six-plus consecutive digits.
    const src = read(FIXTURES)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4,12}/g, '')
      .replace(/86_400_000/g, '')
    assert.deepEqual(src.match(/\b\d{6,}\b/g) ?? [], [])
    // Every synthetic value stays a small integer.
    for (const id of IMPORT_FIXTURE_ID_LIST) {
      for (const c of buildImportFixture(id)!.importPlan?.corrections ?? []) {
        assert.ok(Math.abs(c.beforeValue!) < 100_000 && Math.abs(c.afterValue!) < 100_000)
      }
    }
  })

  test('the ONE environment gate is shared with Structured Notes and closed on production', () => {
    assert.equal(reviewFixturesEnabled, snGate, 'both surfaces must consult the same function')
    assert.equal(reviewFixturesEnabled({ VERCEL_ENV: 'production' } as unknown as NodeJS.ProcessEnv), false)
    assert.equal(reviewFixturesEnabled({ VERCEL_ENV: 'preview' } as unknown as NodeJS.ProcessEnv), true)
    assert.equal(reviewFixturesEnabled({} as unknown as NodeJS.ProcessEnv), true)
    assert.match(read(GATE), /env\.VERCEL_ENV !== 'production'/)
  })

  test('the index and draft routes consult the gate AFTER the administrator check', () => {
    for (const rel of [UPLOADS_ROUTE, DRAFT_ROUTE]) {
      const src = read(rel)
      const admin = src.indexOf('isAdministrator')
      const gate = src.indexOf('reviewFixturesEnabled()')
      assert.ok(admin > 0 && gate > admin, `${rel}: the gate must follow the administrator check`)
    }
    const draft = read(DRAFT_ROUTE)
    assert.ok(draft.indexOf('reviewFixturesEnabled()') < draft.indexOf('buildImportFixture(id)'))
    assert.ok(draft.indexOf('buildImportFixture(id)') < draft.indexOf('createUploadSignedUrl(id)'), 'a fixture never reaches storage')
  })

  test('a fixture can never be written: publish and rollback refuse it before any work', () => {
    const publish = read(PUBLISH_ROUTE)
    const refuse = publish.indexOf("isImportFixtureId(id)) return fail('read_only_fixture', 403)")
    assert.ok(refuse > 0)
    assert.ok(refuse < publish.indexOf('await request.json()'), 'refused before the body is read')
    assert.ok(refuse < publish.indexOf('loadDraft(id)'), 'refused before the workbook is touched')

    const rollback = read(IMPORT_ROLLBACK_ROUTE)
    const refuseRb = rollback.indexOf('isImportFixtureOperationId(id)')
    assert.ok(refuseRb > 0)
    assert.ok(refuseRb < rollback.indexOf('rollbackPortfolioImport('), 'refused before the RPC')
    assert.match(rollback, /read_only_fixture/)
    assert.equal(isImportFixtureOperationId(IMPORT_FIXTURE_OPERATION_IDS.activeCatchUp), true)
    assert.equal(isImportFixtureOperationId(IMPORT_FIXTURE_IDS.noChanges), false)
  })

  test('the refusal is named to the administrator in both languages', () => {
    assert.ok(dict.en.fpAdmin.refusalImport.read_only_fixture.length > 0)
    assert.ok(dict.es.fpAdmin.refusalImport.read_only_fixture.length > 0)
    assert.ok(page.includes('a.fixtureBadge') && page.includes('a.fixtureNote'))
  })

  test('the fixture rows are APPENDED to the real console lists, never replacing them', () => {
    const src = read(UPLOADS_ROUTE)
    assert.match(src, /uploads: \[\.\.\.uploads, \.\.\.listImportFixtureUploads\(\)\]/)
    assert.match(src, /importOperations: \[\.\.\.importOperations, \.\.\.listImportFixtureOperations\(\)\]/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Presentation helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C — presentation helpers', () => {
  test('fill substitutes named placeholders and leaves unknown ones alone', () => {
    assert.equal(fill('{n} weeks, {date}', { n: 3, date: '2026-08-21' }), '3 weeks, 2026-08-21')
    assert.equal(fill('{x}', {}), '{x}')
  })

  test('a hard block outranks a correction, which outranks an append', () => {
    const base = fixture('mixed').importPlan!
    const blocked = { ...base, blockCodes: ['invalid_observation'], invalidDates: ['2026-07-10'] }
    assert.equal(describeImportPlan(blocked, dict.en.fpAdmin).kind, 'blocked')
    assert.deepEqual(nonCorrectionBlockCodes(blocked), ['invalid_observation'])
    assert.deepEqual(nonCorrectionBlockCodes(base), [])
  })

  test('the correction delta is null when either side is unavailable', () => {
    assert.equal(correctionDelta({ beforeValue: null, afterValue: 1 }), null)
    assert.equal(correctionDelta({ beforeValue: 10, afterValue: 12 }), 2)
  })

  test('the presentation module decides nothing financial', () => {
    const src = codeOf(read(PRESENTATION))
    for (const forbidden of ['planWeeklyImport', 'observationsToWrite', 'priorValue', 'fetch(', 'process.env']) {
      assert.ok(!src.includes(forbidden), forbidden)
    }
  })

  test('both dictionaries carry every R13.8C key', () => {
    for (const key of [
      'steps', 'parsing', 'verdictNothingTitle', 'verdictAppendManyTitle', 'verdictCorrectionTitle', 'verdictBlockedTitle',
      'planSource', 'planLiveDetected', 'planLiveNotUsed', 'applyCorrection', 'nothingToApply', 'warningsTitle', 'detailsTitle',
      'colImportSource', 'rollbackImportConfirm', 'rollbackPublicationConfirm', 'importApplied', 'fixtureBadge',
    ] as const) {
      assert.ok(key in dict.en.fpAdmin, `en.${key}`)
      assert.ok(key in dict.es.fpAdmin, `es.${key}`)
    }
  })
})
