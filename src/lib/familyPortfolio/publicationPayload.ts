// R13.8C.2 — the publication payload, built in ONE place.
//
// PURE. It maps a parsed RESUMEN draft to the exact rows the publication RPC
// receives. Nothing here reads the database or the network.
//
// WHY IT WAS EXTRACTED. R13.8C.2 needs to answer "would this workbook change the
// published snapshot?" during PREVIEW, one request before the same payload is
// actually sent by CONFIRM. Two copies of this mapping — one for the comparison,
// one for the write — would be a diff computed against a payload nobody sends,
// and the failure would be silent: the preview would say "no change" while the
// import wrote a different row set. So the mapping lives here and both callers
// use it, exactly as `planImportForDraft` is shared so preview and confirm cannot
// disagree about what Production currently holds.
//
// The row shapes are the repository's payload types, imported TYPE-ONLY so this
// module stays free of the server-only Supabase client and can run under the
// plain test runner.

import type { ResumenDraft } from './resumen/parseResumen.ts'
import type {
  SnapshotRowPayload,
  PerformanceRowPayload,
} from '@/lib/db/repositories/portfolioPublicationRepository'

/**
 * The snapshot rows of the current publication.
 *
 * A NULL value stays NULL. An unavailable value is not zero (doc 02 § 9), and a
 * leaf with no beginning-of-year baseline keeps its comparison suppressed rather
 * than computed off a fabricated 0.
 */
export function buildSnapshotRowPayload(resumen: ResumenDraft): SnapshotRowPayload[] {
  return resumen.rows.map((r) => ({
    scope: r.scope,
    row_key: r.rowKey,
    parent_row_key: r.parentRowKey,
    depth: r.depth,
    display_order: r.displayOrder,
    row_type: r.rowType,
    label_es: r.labelEs,
    label_en: null,
    currency: 'USD',
    value: r.value,
    value_class: r.valueClass,
    source_sheet: r.sourceSheet,
    source_cell: r.sourceCell,
    metadata: {
      sourceRow: r.sourceRow,
      previousValue: r.previousValue,
      beginningOfYearValue: r.beginningOfYearValue,
      // NMI-derived, never imported from the workbook's own `Diferencia` column,
      // which measures the PREVIOUS week (doc 04 § 2).
      difference: r.difference,
      differenceClass: r.differenceClass,
    },
  }))
}

/**
 * The performance rows of the current publication.
 *
 * The SOURCE's own stated figure is what is stored and displayed. NMI's
 * recomputation rides in metadata as a cross-check and never replaces it
 * (doc 04 § 7).
 */
export function buildPerformanceRowPayload(resumen: ResumenDraft): PerformanceRowPayload[] {
  return resumen.performance.map((p) => ({
    scope: p.scope,
    basis: p.basis,
    metric: p.metric,
    value: p.sourceValue,
    value_class: p.valueClass,
    source_sheet: p.sourceSheet,
    source_cell: p.sourceCell,
    metadata: {
      sourceRow: p.sourceRow,
      boundRowKey: p.boundRowKey,
      boundSourceCell: p.boundSourceCell,
      crossChecks: p.crossChecks,
    },
  }))
}
