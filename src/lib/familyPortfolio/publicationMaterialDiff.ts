// R13.8C.2 — is this workbook's CURRENT SNAPSHOT materially the same as the one
// already published for its week?
//
// PURE. No Next.js, no Supabase, no I/O — so the definition of "materially the
// same" is unit-testable on its own, and so the server, the console and the
// database can all be held to one definition instead of three.
//
// WHY THIS EXISTS. R13.8C.1 treated an import as a no-op when its evolution
// series carried no NEW week, no GAP FILL and no CHANGED value. A workbook can
// satisfy all three and still restate a holding, a flow, a sociedad total or a
// performance figure inside the current snapshot. Under that test the import was
// refused as "nothing to append" and the stale published snapshot stayed
// standing — a refusal that silently preserved a figure the owner had corrected.
// History equality is NOT publication equality, and this module is the second
// half that was missing.
//
// THE DATABASE IS STILL AUTHORITATIVE. `nmi_portfolio_publication_unchanged`
// (migration 20260821000000 § 5b) performs the same comparison in SQL against
// Production's own rows under the publication lock. This module exists so the
// route can answer without entering a write path and so the console can say
// something true; it is not the enforcement point, and the two definitions are
// held together by `tests/portfolioImportNoOpGuard.test.ts`.

/**
 * `not_compared` is not a third outcome — it is the ABSENCE of one, for a caller
 * that could not read the stored publication (a review fixture, a pure unit
 * test). It is treated as "no evidence of a publication change", which preserves
 * exactly the pre-R13.8C.2 behaviour and never invents a change nobody observed.
 */
export type PublicationComparison = 'unchanged' | 'changed' | 'not_compared'

/** The publication payload's snapshot row, in the shape the RPC receives it. */
export interface ComparableSnapshotRow {
  scope: string
  row_key: string
  parent_row_key: string | null
  depth: number
  display_order: number
  row_type: string
  label_es: string
  label_en: string | null
  currency: string
  value: number | null
  value_class: string
  source_sheet?: string
  source_cell?: string
  metadata: Record<string, unknown>
}

/** The publication payload's performance row, in the shape the RPC receives it. */
export interface ComparablePerformanceRow {
  scope: string
  basis: string
  metric: string
  value: number | null
  value_class: string
  source_sheet?: string
  source_cell?: string
  metadata: Record<string, unknown>
}

export interface ComparablePublication {
  rows: readonly ComparableSnapshotRow[]
  performance: readonly ComparablePerformanceRow[]
}

/**
 * OPERATIONAL — ignored, because it says where a figure was read, not what it is.
 *
 * A workbook that gains a blank line above a section moves every source cell and
 * source row beneath it while changing no published number. Treating that as a
 * publication mutation would mint a revision on every cosmetic edit.
 *
 * The list is deliberately SHORT and enumerated rather than derived. Everything
 * not named here stays material — including `metadata.previousValue`,
 * `metadata.beginningOfYearValue`, `metadata.difference` and
 * `metadata.differenceClass`, which are PUBLISHED FIGURES that happen to live in
 * the metadata column and must not be discarded along with the provenance.
 * Misclassifying a real figure as operational would refuse a legitimate
 * correction; the opposite error only mints an honest revision.
 */
export const OPERATIONAL_ROW_COLUMNS = ['source_sheet', 'source_cell'] as const
export const OPERATIONAL_SNAPSHOT_METADATA_KEYS = ['sourceRow'] as const
export const OPERATIONAL_PERFORMANCE_METADATA_KEYS = ['sourceRow', 'boundSourceCell'] as const

/**
 * Publication-header fields are operational too, and are never even read here:
 * the id, upload id, revision, actor, timestamps, admin note and parser version
 * describe HOW a week was published, not WHAT it says. A parser upgrade that
 * reproduces byte-identical figures changes nothing about the book.
 */
export const OPERATIONAL_PUBLICATION_FIELDS = [
  'id',
  'upload_id',
  'revision',
  'published_by',
  'published_at',
  'admin_note',
  'parser_version',
  'metadata',
] as const

/** Compared in this order, so the field a difference is reported against is stable. */
const SNAPSHOT_MATERIAL_FIELDS = [
  'parent_row_key',
  'depth',
  'display_order',
  'row_type',
  'label_es',
  'label_en',
  'currency',
  'value',
  'value_class',
  'metadata',
] as const

const PERFORMANCE_MATERIAL_FIELDS = ['value', 'value_class', 'metadata'] as const

export interface PublicationDifference {
  area: 'snapshot' | 'performance'
  /** `scope|row_key`, or `scope|basis|metric`. Never a source coordinate. */
  identity: string
  kind: 'added' | 'removed' | 'changed'
  /** The first material field that differs, in the fixed order above. */
  field?: string
  /** Present only for a numeric `value`, so a difference never carries an object. */
  beforeValue?: number | null
  afterValue?: number | null
  /** The row's own Spanish label, so a difference reads as a line of the book. */
  label?: string
  /**
   * R13.8D.1 — the identity, PARSED.
   *
   * `identity` stays the single joined key every comparison and fingerprint uses,
   * so nothing downstream has to split a string to say WHICH series moved. A
   * historical restatement is reported as "scope · basis · metric", and building
   * that from a `|`-join at the presentation layer would put a second, weaker
   * parser next to the canonical one.
   */
  scope: string
  /** Performance rows only. */
  basis?: string
  metric?: string
  /** Snapshot rows only. */
  rowKey?: string
}

export interface PublicationDiffResult {
  comparison: 'unchanged' | 'changed'
  reason: 'equivalent' | 'no_current_publication' | 'material_difference'
  /** Capped. Doc 14 § AE: a preview never dumps ~500 unchanged holdings. */
  differences: PublicationDifference[]
  /** The true count, even when `differences` was capped. */
  differenceCount: number
  snapshotRowsCompared: number
  performanceRowsCompared: number
}

/** How many differences a result carries. Beyond this only the count is kept. */
export const MAX_REPORTED_DIFFERENCES = 25

function stripKeys(
  value: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value ?? {})) {
    if (!keys.includes(k)) out[k] = v
  }
  return out
}

/**
 * A stable serialization, so `{a:1,b:2}` and `{b:2,a:1}` compare equal — which is
 * what PostgreSQL's own `jsonb` equality does, and this module must agree with it.
 *
 * `-0` normalizes to `0`: a signed zero is not a different amount of money, and
 * a round trip through JSON and `numeric` does not preserve the sign anyway.
 */
function canonical(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // An absent key and an explicit `undefined` are the same absence, exactly
      // as `JSON.stringify` treats them on the way into the database.
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function snapshotIdentity(r: ComparableSnapshotRow): string {
  return `${r.scope}|${r.row_key}`
}

function performanceIdentity(r: ComparablePerformanceRow): string {
  return `${r.scope}|${r.basis}|${r.metric}`
}

function firstDifferingField(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  fields: readonly string[],
  metadataKeys: readonly string[],
): string | null {
  for (const field of fields) {
    if (field === 'metadata') {
      const a = canonical(stripKeys(stored.metadata as Record<string, unknown>, metadataKeys))
      const b = canonical(stripKeys(incoming.metadata as Record<string, unknown>, metadataKeys))
      if (a !== b) return 'metadata'
      continue
    }
    if (canonical(stored[field]) !== canonical(incoming[field])) return field
  }
  return null
}

/**
 * Compares the publication a packet would mint against the one already standing.
 *
 * `stored` is null when NO publication stands for that week — which is never
 * "unchanged", because there is plainly something to publish.
 *
 * Identity is `(scope, row_key)` and `(scope, basis, metric)`, both unique per
 * publication by the R13.5 schema. The comparison is set-based on that identity,
 * so an added row, a removed row and a changed row are all differences, and the
 * ORDER the rows arrive in is never itself compared — `display_order` is compared
 * as an ordinary value.
 */
export function comparePublicationPayload(
  stored: ComparablePublication | null,
  incoming: ComparablePublication,
): PublicationDiffResult {
  const snapshotRowsCompared = incoming.rows.length
  const performanceRowsCompared = incoming.performance.length

  if (stored === null) {
    return {
      comparison: 'changed',
      reason: 'no_current_publication',
      differences: [],
      differenceCount: 0,
      snapshotRowsCompared,
      performanceRowsCompared,
    }
  }

  const differences: PublicationDifference[] = []
  let differenceCount = 0
  const push = (d: PublicationDifference) => {
    differenceCount += 1
    if (differences.length < MAX_REPORTED_DIFFERENCES) differences.push(d)
  }

  const storedRows = new Map(stored.rows.map((r) => [snapshotIdentity(r), r]))
  const seenRows = new Set<string>()
  for (const row of incoming.rows) {
    const identity = snapshotIdentity(row)
    seenRows.add(identity)
    const before = storedRows.get(identity)
    if (!before) {
      push({
        area: 'snapshot',
        identity,
        kind: 'added',
        label: row.label_es,
        scope: row.scope,
        rowKey: row.row_key,
      })
      continue
    }
    const field = firstDifferingField(
      before as unknown as Record<string, unknown>,
      row as unknown as Record<string, unknown>,
      SNAPSHOT_MATERIAL_FIELDS,
      OPERATIONAL_SNAPSHOT_METADATA_KEYS,
    )
    if (field !== null) {
      push({
        area: 'snapshot',
        identity,
        kind: 'changed',
        field,
        label: row.label_es,
        scope: row.scope,
        rowKey: row.row_key,
        ...(field === 'value' ? { beforeValue: before.value, afterValue: row.value } : {}),
      })
    }
  }
  for (const row of stored.rows) {
    const identity = snapshotIdentity(row)
    if (!seenRows.has(identity)) {
      push({
        area: 'snapshot',
        identity,
        kind: 'removed',
        label: row.label_es,
        scope: row.scope,
        rowKey: row.row_key,
      })
    }
  }

  const storedPerf = new Map(stored.performance.map((r) => [performanceIdentity(r), r]))
  const seenPerf = new Set<string>()
  for (const row of incoming.performance) {
    const identity = performanceIdentity(row)
    seenPerf.add(identity)
    const before = storedPerf.get(identity)
    if (!before) {
      push({
        area: 'performance',
        identity,
        kind: 'added',
        scope: row.scope,
        basis: row.basis,
        metric: row.metric,
      })
      continue
    }
    const field = firstDifferingField(
      before as unknown as Record<string, unknown>,
      row as unknown as Record<string, unknown>,
      PERFORMANCE_MATERIAL_FIELDS,
      OPERATIONAL_PERFORMANCE_METADATA_KEYS,
    )
    if (field !== null) {
      push({
        area: 'performance',
        identity,
        kind: 'changed',
        field,
        scope: row.scope,
        basis: row.basis,
        metric: row.metric,
        ...(field === 'value' ? { beforeValue: before.value, afterValue: row.value } : {}),
      })
    }
  }
  for (const row of stored.performance) {
    const identity = performanceIdentity(row)
    if (!seenPerf.has(identity)) {
      push({
        area: 'performance',
        identity,
        kind: 'removed',
        scope: row.scope,
        basis: row.basis,
        metric: row.metric,
      })
    }
  }

  return {
    comparison: differenceCount === 0 ? 'unchanged' : 'changed',
    reason: differenceCount === 0 ? 'equivalent' : 'material_difference',
    differences,
    differenceCount,
    snapshotRowsCompared,
    performanceRowsCompared,
  }
}
