// R13.8C — the import plan's PRESENTATION MODEL, and nothing else.
//
// PURE. No React, no fetch, no environment. It turns the plan the server
// returned into the words and tones the administrator sees, so the same
// derivation can be unit-tested under plain Node and rendered by the page.
//
// IT DECIDES NOTHING FINANCIAL. Every classification here (`newDates`,
// `gapFillDates`, `corrections`, `requiresHistoricalCorrection`, `blocked`,
// `action`) arrives already decided by `weeklyImportPlan.ts` on the server and
// is only READ. This module chooses a sentence and a colour for a decision; it
// never makes one. In particular the correction gate is `requiresHistoricalCorrection`
// alone — never a week count, never the presence of a gap fill.

/** One material difference between the standing snapshot and the proposed one. */
export interface PublicationDifference {
  area: 'snapshot' | 'performance'
  identity: string
  kind: 'added' | 'removed' | 'changed'
  field?: string
  beforeValue?: number | null
  afterValue?: number | null
  label?: string
  scope?: string
  basis?: string
  metric?: string
  rowKey?: string
}

/**
 * R13.8D.1 — one restated field of one ALREADY-PUBLISHED week, as the console
 * shows it: what Production holds, what the workbook says, and the difference.
 */
export interface RestatedField {
  area: 'snapshot' | 'performance'
  identity: string
  kind: 'added' | 'removed' | 'changed'
  scope: string
  basis: string | null
  metric: string | null
  rowKey: string | null
  label: string | null
  field: string | null
  productionValue: number | null
  workbookValue: number | null
  delta: number | null
}

/** One already-published week the workbook now states differently. */
export interface HistoricalRestatement {
  asOfDate: string
  publicationId: string
  revision: number
  differenceCount: number
  fields: RestatedField[]
}

export interface PreviewCorrection {
  scope: string
  basis: string
  seriesIdentity?: string
  observationDate: string
  beforeValue: number | null
  afterValue: number | null
}

export interface ImportPlan {
  contractVersion: string
  contractVerdict: string
  sheetNames: string[]
  frozen: {
    publicationColumnLetter: string | null
    publicationDate: string | null
    historicalColumnCount: number
    liveColumnLetter: string | null
    liveColumnDate: string | null
    refusal: string | null
  }
  productionEndpoint: string | null
  workbookLatest: string | null
  publicationDate: string | null
  newDates: string[]
  gapFillDates: string[]
  corrections: PreviewCorrection[]
  unchangedCount: number
  invalidDates: string[]
  cadenceGaps: Array<{ from: string; to: string; days: number }>
  action: string
  requiresHistoricalCorrection: boolean
  /**
   * R13.8C.2 — whether this week's STANDING published snapshot is materially
   * restated by this workbook, decided on the server against Production's own
   * rows. `not_compared` means nobody looked, which is never treated as a change.
   */
  publicationComparison?: 'unchanged' | 'changed' | 'not_compared'
  publicationChanged?: boolean
  publicationDifferences?: PublicationDifference[]
  publicationDifferenceCount?: number
  /**
   * R13.8D.1 — already-published weeks this workbook materially restates,
   * decided on the server against Production's own publications. Optional so a
   * pre-R13.8D.1 payload renders unchanged; absent means "none observed".
   */
  historicalRestatements?: HistoricalRestatement[]
  historicalRestatementDates?: string[]
  historicalRestatementCount?: number
  requiresEvolutionCorrection?: boolean
  requiresPublicationRestatementCorrection?: boolean
  /**
   * R13.8E — the row-level history this workbook would write, decided on the
   * server against Production's own rows. Optional so a pre-R13.8E payload
   * renders unchanged; absent means "none observed".
   */
  requiresRowHistoryCorrection?: boolean
  rowHistory?: {
    insertedCount: number
    changedCount: number
    readonly datesInserted: readonly string[]
    readonly datesChanged: readonly string[]
  }
  blocked: boolean
  blockCodes: string[]
  counts: { new: number; gapFill: number; changed: number; unchanged: number; invalid: number }
  planFingerprint: string
}

/** The five steps of the administrator's weekly update, in order. */
export const WORKFLOW_STEPS = ['choose', 'upload', 'parse', 'preview', 'confirm'] as const
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number]

/**
 * Signal tones, by disposition. One token each, never a hex value:
 *   NEW is an ordinary addition (positive); a GAP_FILL is an ordinary insertion
 *   below the endpoint (accent — informational, deliberately NOT the warning
 *   token, because nothing is overwritten); a CHANGED point is an overwrite
 *   (warning); an uninterpretable point blocks (negative).
 */
export const TONE = {
  new: 'var(--positive)',
  gapFill: 'var(--accent)',
  changed: 'var(--warning)',
  blocked: 'var(--negative)',
  neutral: 'var(--muted-fg)',
} as const

/** `{name}` placeholders → values. Unknown placeholders are left in place. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m))
}

/** Block codes the correction card does NOT own — anything else is a hard block. */
export function nonCorrectionBlockCodes(plan: Pick<ImportPlan, 'blockCodes'>): string[] {
  return plan.blockCodes.filter(
    (c) => c !== 'historical_correction_required' && c !== 'correction_reason_required',
  )
}

/**
 * A plan that mutates nothing at all. The console never offers an enabled Apply.
 *
 * R13.8C.2 — THE TEST IS THE WHOLE IMPORT, NOT ONLY ITS HISTORY. `action` is
 * already the full-import classification (`nothing_to_append` is emitted only
 * when history is settled AND the standing snapshot is materially unchanged), so
 * reading it is correct; `publicationChanged` is checked as well so a plan
 * assembled by hand, or one whose action a future edit forgets to downgrade,
 * cannot present a real publication correction as nothing to do.
 */
export function isNoOp(
  plan: Pick<ImportPlan, 'action' | 'publicationChanged' | 'historicalRestatementCount'>,
): boolean {
  return (
    plan.action === 'nothing_to_append' &&
    plan.publicationChanged !== true &&
    // R13.8D.1 — an import that appends nothing and leaves this week equivalent
    // may still be correcting already-published weeks. Calling that "nothing to
    // apply" is exactly the false sentence this stage exists to remove.
    (plan.historicalRestatementCount ?? 0) === 0
  )
}

/** `after − before` when both are numbers; null when either side is unavailable. */
export function correctionDelta(c: Pick<PreviewCorrection, 'beforeValue' | 'afterValue'>): number | null {
  if (c.beforeValue === null || c.afterValue === null) return null
  return c.afterValue - c.beforeValue
}

export type VerdictKind = 'nothing' | 'append' | 'correction' | 'publication' | 'blocked'

export interface ImportVerdict {
  kind: VerdictKind
  tone: string
  title: string
  body: string
}

/** The dictionary keys the verdict reads. `t.fpAdmin` satisfies it structurally. */
export interface VerdictStrings {
  verdictNothingTitle: string
  verdictNothingBody: string
  verdictAppendOneTitle: string
  verdictAppendManyTitle: string
  verdictAppendBody: string
  verdictAppendManyBody: string
  verdictEndpointUnchanged: string
  verdictGapFillOne: string
  verdictGapFillMany: string
  verdictCorrectionTitle: string
  verdictCorrectionOnlyBody: string
  verdictCorrectionMixedBody: string
  verdictBlockedTitle: string
  verdictBlockedBody: string
  verdictPublicationTitle: string
  verdictPublicationBody: string
  verdictPublicationMixedBody: string
  /** R13.8E — row-level values for reporting dates the book holds none for. */
  verdictRowHistoryTitle: string
  verdictRowHistoryBody: string
  /** R13.8D.1 — already-published weeks the workbook now states differently. */
  verdictRestatementTitle: string
  verdictRestatementOnlyBody: string
  verdictRestatementAppendBody: string
  verdictRestatementEvolutionBody: string
}

/** Total restated fields across every restated week. */
export function restatedFieldCount(plan: Pick<ImportPlan, 'historicalRestatements'>): number {
  return (plan.historicalRestatements ?? []).reduce((sum, r) => sum + r.differenceCount, 0)
}

/**
 * One sentence pair that says what confirming would do.
 *
 * Priority: a hard block outranks a correction, a correction outranks an
 * append, and an append outranks "nothing". The correction branch keys on
 * `requiresHistoricalCorrection` ONLY.
 */
export function describeImportPlan(plan: ImportPlan, a: VerdictStrings): ImportVerdict {
  const n = plan.newDates.length
  const g = plan.gapFillDates.length
  const c = plan.corrections.length
  const date = plan.publicationDate ?? '—'

  if (nonCorrectionBlockCodes(plan).length > 0 || plan.invalidDates.length > 0) {
    return { kind: 'blocked', tone: TONE.blocked, title: a.verdictBlockedTitle, body: a.verdictBlockedBody }
  }

  // R13.8D.1 — A RESTATEMENT OF ALREADY-PUBLISHED WEEKS OUTRANKS EVERY OTHER
  // SENTENCE except a hard block.
  //
  // It has to. The pre-R13.8D.1 verdict for the real catch-up read "5 new weeks
  // appended" and said nothing at all about seven published weeks being
  // re-published — the administrator would authorize a correction whose subject
  // was never named. Where evolution corrections are also present both are
  // stated, because they are different rewrites of different things.
  const r = plan.historicalRestatementCount ?? 0
  if (r > 0) {
    const d = restatedFieldCount(plan)
    return {
      kind: 'correction',
      tone: TONE.changed,
      title: a.verdictRestatementTitle,
      body:
        c > 0
          ? fill(a.verdictRestatementEvolutionBody, { c, r, d })
          : n + g === 0
            ? fill(a.verdictRestatementOnlyBody, { r, d })
            : fill(a.verdictRestatementAppendBody, { n, r, d }),
    }
  }

  if (plan.requiresHistoricalCorrection) {
    return {
      kind: 'correction',
      tone: TONE.changed,
      title: a.verdictCorrectionTitle,
      body:
        n + g === 0
          ? // R13.8C.2 — a correction that ALSO restates the standing snapshot is
            // both at once, and saying only "history" would understate it.
            plan.publicationChanged === true
            ? fill(a.verdictPublicationMixedBody, { c, d: plan.publicationDifferenceCount ?? 0 })
            : fill(a.verdictCorrectionOnlyBody, { c })
          : fill(a.verdictCorrectionMixedBody, { n, g, c }),
    }
  }

  if (n + g === 0) {
    // R13.8C.2 — THE CORRECTION THIS STAGE EXISTS FOR. History is settled, so the
    // pre-R13.8C.2 console said "nothing to apply" and disabled Apply. If the
    // standing snapshot is materially restated that sentence is false, and acting
    // on it leaves a figure the owner corrected still published.
    if (plan.publicationChanged === true) {
      return {
        kind: 'publication',
        tone: TONE.changed,
        title: a.verdictPublicationTitle,
        body: fill(a.verdictPublicationBody, { date, d: plan.publicationDifferenceCount ?? 0 }),
      }
    }
    // R13.8E — no week to append and no published figure moved, but the workbook
    // carries row-level values for reporting dates the book has never held at
    // row grain. Calling that "nothing to apply" is what would leave the rolling
    // contributor window permanently unbuildable.
    const rhInserted = plan.rowHistory?.insertedCount ?? 0
    const rhDates = plan.rowHistory?.datesInserted.length ?? 0
    if (rhInserted > 0) {
      return {
        kind: 'append',
        tone: TONE.gapFill,
        title: a.verdictRowHistoryTitle,
        body: fill(a.verdictRowHistoryBody, { n: rhDates, r: rhInserted }),
      }
    }
    return { kind: 'nothing', tone: TONE.neutral, title: a.verdictNothingTitle, body: a.verdictNothingBody }
  }

  const gapNote = g === 0 ? '' : g === 1 ? a.verdictGapFillOne : fill(a.verdictGapFillMany, { g })
  const endpointMoves = plan.publicationDate !== null && plan.publicationDate !== plan.productionEndpoint

  if (n === 0) {
    // Gap fills only: the endpoint does not move.
    return {
      kind: 'append',
      tone: TONE.gapFill,
      title: gapNote,
      body: fill(a.verdictEndpointUnchanged, { date }),
    }
  }

  const title = n === 1 ? a.verdictAppendOneTitle : fill(a.verdictAppendManyTitle, { n })
  const appendBody = endpointMoves
    ? n === 1
      ? fill(a.verdictAppendBody, { date })
      : fill(a.verdictAppendManyBody, { n, date })
    : fill(a.verdictEndpointUnchanged, { date })
  return {
    kind: 'append',
    tone: TONE.new,
    title,
    body: gapNote ? `${appendBody} ${gapNote}` : appendBody,
  }
}
