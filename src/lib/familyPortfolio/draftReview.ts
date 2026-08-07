// R13.5 — draft review (doc 08 Stage 5, "administrator preview → confirm").
//
// SERVER-ONLY. Never import from a client component.
//
// Turns a stored upload into the material an administrator needs to DECIDE
// whether to publish, and nothing more.
//
// WHY THE PREVIEW CARRIES NO AMOUNTS. The publication decision is about
// validity, not about reading the portfolio: is the proposed date right, did any
// required cell error, did the source's own identities reconcile, is any event
// still unclassified. None of those questions needs a figure to answer. Shipping
// the full financial payload through a new API surface would create a second
// amount-bearing endpoint before the stage that owns portfolio presentation
// (Stage 6) has designed one — so the preview reports COUNTS, CELL REFERENCES,
// ROW LABELS and PASS/FAIL, exactly the vocabulary doc 05 § 4 permits in a
// response. The amounts go straight from the parser into the publication RPC
// without ever being serialized to a client.
//
// THE DRAFT IS RECOMPUTED ON EVERY PREVIEW, never cached. A cached draft would
// be a second copy of private financial content with its own lifetime, and it
// could silently diverge from the stored workbook after a parser change.

import { createHash } from 'node:crypto'

import { parseResumen, RESUMEN_PARSER_VERSION, type ResumenDraft } from './resumen/parseResumen.ts'
import { parseAlternatives, ALTERNATIVES_PARSER_VERSION, type AlternativesDraft } from './alternatives/parseAlternatives.ts'
import {
  applyEventClassifications,
  assessPublishability,
  type EventClassificationDecision,
  type PublicationRefusalCode,
  type UploadKind,
} from './publication.ts'
import {
  getUpload,
  getUploadFindings,
  downloadUploadBytes,
  type StoredFinding,
  type UploadRecord,
} from '@/lib/db/repositories/portfolioPublicationRepository'

export interface ReviewFinding {
  severity: 'blocking' | 'warning' | 'info'
  code: string
  detail: string
  scope?: string
  sourceSheet?: string
  sourceCell?: string
  rowLabel?: string
}

export interface ScopeSummary {
  scope: string
  rowCount: number
  /** Rows whose publication-column value is genuinely unavailable, never zeroed. */
  unavailableCount: number
  rowTypes: Record<string, number>
}

export interface PerformanceSummary {
  scope: string
  basis: string
  metric: string
  /** NMI's recomputation agreed with the source's own stated figure. */
  agrees: boolean
  /** No comparison was possible — absence of evidence, not a mismatch. */
  indeterminate: boolean
}

export interface GroupSummary {
  category: string
  currency: string
  holdings: number
}

export interface DraftReview {
  uploadId: string
  uploadKind: UploadKind
  status: string
  originalFilename: string
  fileSha256: string
  uploadedAt: string
  parserVersion: string
  parsed: boolean

  /** Portfolio only. Proposed, never asserted (doc 04 § 6). */
  detectedAsOfDate: string | null
  previousWeekDate: string | null
  beginningOfYearDate: string | null
  /** Any date an administrator already confirmed for this upload. */
  confirmedAsOfDate: string | null

  scopes: ScopeSummary[]
  performance: PerformanceSummary[]
  groups: GroupSummary[]
  legend: Array<{ event: string; hex: string }>

  /** Cells still unclassified after any supplied decisions. Blocks publication. */
  unclassifiedEventCells: string[]

  findings: ReviewFinding[]
  storedFindings: StoredFinding[]

  recordCount: number
  publishable: boolean
  refusals: PublicationRefusalCode[]
  warningCount: number
}

export type DraftReviewFailure =
  | { ok: false; code: 'not_configured' }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'download_failed' }
  | { ok: false; code: 'source_digest_mismatch' }

/** Everything the publish path needs, kept server-side. */
export interface LoadedDraft {
  upload: UploadRecord
  bytes: Buffer
  resumen: ResumenDraft | null
  alternatives: AlternativesDraft | null
}

/**
 * Loads and parses one upload.
 *
 * The parse never throws to the caller: a workbook that cannot be read produces
 * a draft with `ok: false` and blocking findings, which is exactly what the
 * publication gate needs. A thrown exception would otherwise leak parser text
 * into a response or a log (doc 05 § 4).
 */
export async function loadDraft(uploadId: string): Promise<{ ok: true; draft: LoadedDraft } | DraftReviewFailure> {
  const found = await getUpload(uploadId)
  if (!found.ok) return found.code === 'not_configured' ? { ok: false, code: 'not_configured' } : { ok: false, code: 'not_found' }

  // The object path comes from the UPLOAD ROW, never from the request. A caller
  // names an upload id and nothing else, so no request can point the parser at a
  // different object.
  const downloaded = await downloadUploadBytes(found.upload.storageObjectPath)
  if (!downloaded.ok) {
    return downloaded.code === 'not_configured' ? { ok: false, code: 'not_configured' } : { ok: false, code: 'download_failed' }
  }

  // TIME-OF-CHECK / TIME-OF-USE. The bytes were validated and hashed at upload;
  // they are parsed again here, minutes or days later. R13.2 already makes
  // silent replacement very hard — the bucket is private with no `authenticated`
  // policy, keys are opaque per-upload UUIDs, and the upload uses
  // `upsert: false` so a key is never overwritten — but "hard" is not "proven".
  // Re-hashing costs one pass over ~450 KB and turns the guarantee into a
  // verified fact: what gets published is exactly the object the upload record
  // describes, or nothing is published at all.
  const digest = createHash('sha256').update(downloaded.bytes).digest('hex')
  if (digest !== found.upload.fileSha256) {
    return { ok: false, code: 'source_digest_mismatch' }
  }

  const kind = found.upload.uploadKind
  return {
    ok: true,
    draft: {
      upload: found.upload,
      bytes: downloaded.bytes,
      resumen: kind === 'portfolio' ? parseResumen(downloaded.bytes) : null,
      alternatives: kind === 'alternatives' ? parseAlternatives(downloaded.bytes) : null,
    },
  }
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    const k = key(item)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

/**
 * Builds the administrator-facing review for a loaded draft.
 *
 * `decisions` are the administrator's classifications for unclassified events.
 * They are applied here so the preview shows the state the publish attempt would
 * actually see — a preview that reported "publishable" without them and then
 * failed at publish would be worse than no preview.
 */
export function summarizeDraft(
  loaded: LoadedDraft,
  storedFindings: StoredFinding[],
  decisions: readonly EventClassificationDecision[] = [],
): DraftReview {
  const { upload, resumen, alternatives } = loaded

  const findings: ReviewFinding[] = [
    ...(resumen?.findings ?? []),
    ...(alternatives?.findings ?? []),
  ].map((f) => ({ ...f }))

  // A blocking finding recorded at UPLOAD time still blocks now. It described
  // the file, and the file has not changed.
  const combined: ReviewFinding[] = [
    ...findings,
    ...storedFindings.map((f) => ({
      severity: f.severity,
      code: f.code,
      detail: f.detail,
      scope: f.scope ?? undefined,
      sourceSheet: f.sourceSheet ?? undefined,
      sourceCell: f.sourceCell ?? undefined,
      rowLabel: f.rowLabel ?? undefined,
    })),
  ]

  let unclassified: string[] = []
  let groups: GroupSummary[] = []
  let legend: Array<{ event: string; hex: string }> = []
  let recordCount = 0

  if (alternatives) {
    const applied = applyEventClassifications(alternatives.events, decisions)
    unclassified = applied.unresolved
    groups = alternatives.subtotals.map((s) => ({
      category: s.category,
      currency: s.currency,
      holdings: s.holdings,
    }))
    legend = alternatives.legend.map((l) => ({ event: l.event, hex: l.hex }))
    recordCount = alternatives.holdings.length
  }

  const scopes: ScopeSummary[] = []
  const performance: PerformanceSummary[] = []
  if (resumen) {
    recordCount = resumen.rows.length
    const byScope = new Map<string, typeof resumen.rows>()
    for (const row of resumen.rows) {
      const list = byScope.get(row.scope) ?? []
      list.push(row)
      byScope.set(row.scope, list)
    }
    for (const [scope, rows] of byScope) {
      scopes.push({
        scope,
        rowCount: rows.length,
        unavailableCount: rows.filter((r) => r.valueClass === 'unavailable').length,
        rowTypes: countBy(rows, (r) => r.rowType),
      })
    }
    for (const p of resumen.performance) {
      for (const c of p.crossChecks) {
        performance.push({
          scope: p.scope,
          basis: p.basis,
          metric: c.metric,
          agrees: c.agrees,
          indeterminate: c.indeterminate,
        })
      }
    }
  }

  const parsed = resumen ? resumen.ok : alternatives ? alternatives.ok : false
  const verdict = assessPublishability({
    findings: combined,
    parsed,
    recordCount,
    unresolvedEventCells: unclassified,
  })

  return {
    uploadId: upload.id,
    uploadKind: upload.uploadKind,
    status: upload.status,
    originalFilename: upload.originalFilename,
    fileSha256: upload.fileSha256,
    uploadedAt: upload.uploadedAt,
    parserVersion: resumen ? RESUMEN_PARSER_VERSION : ALTERNATIVES_PARSER_VERSION,
    parsed,
    detectedAsOfDate: resumen?.detectedAsOfDate ?? null,
    previousWeekDate: resumen?.previousWeekDate ?? null,
    beginningOfYearDate: resumen?.beginningOfYearDate ?? null,
    confirmedAsOfDate: upload.confirmedAsOfDate,
    scopes: scopes.sort((a, b) => a.scope.localeCompare(b.scope)),
    performance,
    groups,
    legend,
    unclassifiedEventCells: unclassified,
    findings: combined,
    storedFindings,
    recordCount,
    publishable: verdict.publishable,
    refusals: verdict.refusals,
    warningCount: verdict.warningCount,
  }
}

/** Convenience: load, read stored findings, and summarize in one call. */
export async function buildDraftReview(
  uploadId: string,
  decisions: readonly EventClassificationDecision[] = [],
): Promise<{ ok: true; review: DraftReview; loaded: LoadedDraft } | DraftReviewFailure> {
  const loaded = await loadDraft(uploadId)
  if (!loaded.ok) return loaded
  const stored = await getUploadFindings(uploadId)
  return { ok: true, review: summarizeDraft(loaded.draft, stored, decisions), loaded: loaded.draft }
}
