// R13.8B — the server-side half of the import preview.
//
// SERVER-ONLY. Never import from a client component.
//
// `weeklyImportPreview.ts` is pure: it takes bytes and Production's state and
// returns a plan. This module is the thin part that READS Production's state, so
// the preview route and the confirm route can never disagree about what "current"
// means — they call the same function, one request apart.

import {
  buildWeeklyImportPreview,
  type WeeklyImportPreview,
} from './weeklyImportPreview.ts'
import type { WeeklyImportPlan } from './weeklyImportPlan.ts'
import type { EvolutionExtraction } from './resumen/evolutionHistory.ts'
import type { LoadedDraft } from './draftReview.ts'
import {
  listPersistedEvolutionObservations,
  listPublications,
} from '@/lib/db/repositories/portfolioPublicationRepository'

export type ImportPreviewFailure =
  | { ok: false; code: 'not_configured' }
  | { ok: false; code: 'evolution_read_failed' }
  | { ok: false; code: 'not_a_portfolio_draft' }

export interface ImportPreviewSuccess {
  ok: true
  preview: WeeklyImportPreview
  plan: WeeklyImportPlan
  extraction: EvolutionExtraction
}

/**
 * Reads Production's current history and plans the import for one loaded draft.
 *
 * `latestPublishedAsOf` is the newest CURRENT portfolio publication. It matters
 * because `is_current` is unique per `(upload_kind, as_of_date)` rather than
 * globally — each week stays current for itself — so the book's endpoint is the
 * maximum such date, not "the one current row". A week published without ever
 * yielding an evolution point still bounds the endpoint through it, which is
 * what keeps a hole below that week a GAP_FILL instead of a spurious NEW week.
 */
export async function planImportForDraft(
  loaded: LoadedDraft,
  options: { historicalCorrectionAuthorized?: boolean; correctionReason?: string | null } = {},
): Promise<ImportPreviewSuccess | ImportPreviewFailure> {
  if (!loaded.resumen || !loaded.frozen) return { ok: false, code: 'not_a_portfolio_draft' }

  const persisted = await listPersistedEvolutionObservations()
  if (!persisted.ok) {
    return persisted.code === 'not_configured'
      ? { ok: false, code: 'not_configured' }
      : { ok: false, code: 'evolution_read_failed' }
  }

  const publications = await listPublications()
  const latestPublishedAsOf =
    publications
      .filter((p) => p.uploadKind === 'portfolio' && p.isCurrent)
      .map((p) => p.asOfDate)
      .sort()
      .pop() ?? null

  const built = buildWeeklyImportPreview({
    bytes: loaded.bytes,
    selection: loaded.frozen,
    draft: loaded.resumen,
    published: persisted.observations,
    latestPublishedAsOf,
    historicalCorrectionAuthorized: options.historicalCorrectionAuthorized,
    correctionReason: options.correctionReason,
  })

  return { ok: true, preview: built.preview, plan: built.plan, extraction: built.extraction }
}
