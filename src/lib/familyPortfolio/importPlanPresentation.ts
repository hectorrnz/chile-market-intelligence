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

/** A plan that writes nothing. The console never offers an enabled Apply for it. */
export function isNoOp(plan: Pick<ImportPlan, 'action'>): boolean {
  return plan.action === 'nothing_to_append'
}

/** `after − before` when both are numbers; null when either side is unavailable. */
export function correctionDelta(c: Pick<PreviewCorrection, 'beforeValue' | 'afterValue'>): number | null {
  if (c.beforeValue === null || c.afterValue === null) return null
  return c.afterValue - c.beforeValue
}

export type VerdictKind = 'nothing' | 'append' | 'correction' | 'blocked'

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

  if (plan.requiresHistoricalCorrection) {
    return {
      kind: 'correction',
      tone: TONE.changed,
      title: a.verdictCorrectionTitle,
      body:
        n + g === 0
          ? fill(a.verdictCorrectionOnlyBody, { c })
          : fill(a.verdictCorrectionMixedBody, { n, g, c }),
    }
  }

  if (n + g === 0) {
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
