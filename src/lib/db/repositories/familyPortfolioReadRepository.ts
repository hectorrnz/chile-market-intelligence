// R13.6 — Family Portfolio CLIENT-FACING read layer.
//
// SERVER-ONLY. Never import from a client component.
//
// Deliberately separate from `portfolioPublicationRepository.ts`, which is the
// Stage-5 ADMINISTRATOR surface: keeping the member read path in its own module
// keeps the service-role boundary legible. Two different clients are used here,
// and the split is the point (doc 05 § 2.1, four independent layers):
//
//   * The PUBLICATION SPINE (`portfolio_publications`) is read with the
//     service-role client. Its RLS read policy is administrator-only by design
//     (R13.3), because the spine is operational metadata — ids, dates,
//     revisions, parser versions. It carries NO financial value, NO scope
//     column and NO row content. Every route reaches this module only AFTER
//     `guardPrivateApi()` and an explicit `canReadScope` check, and only spine
//     fields for CURRENT publications are ever returned.
//
//   * The SNAPSHOT ROWS (`portfolio_snapshot_rows`) — the actual financial
//     data — are read with the USER-SESSION client, so PostgreSQL RLS
//     (`nmi_can_access_scope`) independently re-derives the caller's
//     entitlement from their own profile row. Even if a route handler forgot
//     its scope check, the database would return zero rows for a scope the
//     caller does not hold. The service-role client is deliberately NOT used
//     for row reads.
//
// CURRENT PUBLICATIONS ONLY. Snapshot rows of superseded or rolled-back
// revisions remain in the table (nothing is ever deleted) and remain visible to
// scope RLS — so filtering by `is_current` here is what keeps a rolled-back
// revision out of every member view. Draft uploads never appear at all: this
// module reads no upload table and touches no storage object.
//
// UNAVAILABLE IS NEVER ZERO. `value`, `previousValue`, `beginningOfYearValue`
// and `difference` pass through as `null` when null — no coalescing, no
// defaults (doc 02 § 9).

import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import type { UploadKind } from '@/lib/familyPortfolio/publication'

/** Spine metadata of one CURRENT publication — no financial content. */
export interface CurrentPublication {
  id: string
  asOfDate: string
  revision: number
  publishedAt: string
  parserVersion: string
  /**
   * The workbook's own previous-week / beginning-of-year column dates,
   * recorded at publish time (R13.6). Null on a publication made before they
   * were recorded — the UI then shows the column without a date rather than
   * inferring one from adjacent publications.
   */
  previousWeekDate: string | null
  beginningOfYearDate: string | null
}

/** One hierarchy row of a published snapshot, with its four dated values. */
export interface SnapshotRowRead {
  rowKey: string
  parentRowKey: string | null
  depth: number
  displayOrder: number
  rowType: string
  labelEs: string
  labelEn: string | null
  currency: string
  value: number | null
  valueClass: string
  previousValue: number | null
  beginningOfYearValue: number | null
  difference: number | null
  differenceClass: string | null
}

function spineDate(meta: Record<string, unknown> | null, key: string): string | null {
  const v = meta?.[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Every CURRENT publication of one kind, newest week first.
 *
 * This is the week list behind the historical-week selector, and the only
 * place the member read path resolves which revision of a week readers see.
 */
export async function listCurrentPublications(
  kind: UploadKind,
): Promise<{ ok: true; publications: CurrentPublication[] } | { ok: false; code: 'not_configured' | 'read_failed' }> {
  const client = getSupabaseAdminClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: unknown) => {
          eq: (col: string, v: unknown) => {
            order: (col: string, opts: { ascending: boolean }) => Promise<{
              data:
                | Array<{
                    id: string
                    as_of_date: string
                    revision: number
                    published_at: string
                    parser_version: string
                    metadata: Record<string, unknown> | null
                  }>
                | null
              error: unknown
            }>
          }
        }
      }
    }
  })
    .from('portfolio_publications')
    .select('id, as_of_date, revision, published_at, parser_version, metadata')
    .eq('upload_kind', kind)
    .eq('is_current', true)
    .order('as_of_date', { ascending: false })

  if (error) return { ok: false, code: 'read_failed' }
  return {
    ok: true,
    publications: (data ?? []).map((p) => ({
      id: p.id,
      asOfDate: p.as_of_date,
      revision: p.revision,
      publishedAt: p.published_at,
      parserVersion: p.parser_version,
      previousWeekDate: spineDate(p.metadata, 'previousWeekDate'),
      beginningOfYearDate: spineDate(p.metadata, 'beginningOfYearDate'),
    })),
  }
}

function metaNumber(meta: Record<string, unknown> | null, key: string): number | null {
  const v = meta?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function metaString(meta: Record<string, unknown> | null, key: string): string | null {
  const v = meta?.[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * The hierarchy rows of ONE scope inside ONE (current) publication, in display
 * order — read through the caller's OWN session so RLS is the authority.
 *
 * Returns `rls_denied_or_empty` when the query succeeds but yields nothing:
 * the caller cannot distinguish "not entitled" from "publication carries no
 * rows for this scope" at this layer, and does not need to — the route already
 * made its own entitlement decision, and an entitled-but-empty scope is an
 * honest empty state.
 */
export async function getSnapshotRowsForScope(
  publicationId: string,
  scope: string,
): Promise<
  | { ok: true; rows: SnapshotRowRead[] }
  | { ok: false; code: 'not_configured' | 'read_failed' }
> {
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: unknown) => {
          eq: (col: string, v: unknown) => {
            order: (col: string, opts: { ascending: boolean }) => Promise<{
              data:
                | Array<{
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
                    metadata: Record<string, unknown> | null
                  }>
                | null
              error: unknown
            }>
          }
        }
      }
    }
  })
    .from('portfolio_snapshot_rows')
    .select(
      'row_key, parent_row_key, depth, display_order, row_type, label_es, label_en, currency, value, value_class, metadata',
    )
    .eq('publication_id', publicationId)
    .eq('scope', scope)
    .order('display_order', { ascending: true })

  if (error) return { ok: false, code: 'read_failed' }
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      rowKey: r.row_key,
      parentRowKey: r.parent_row_key,
      depth: r.depth,
      displayOrder: r.display_order,
      rowType: r.row_type,
      labelEs: r.label_es,
      labelEn: r.label_en,
      currency: r.currency,
      // null stays null in all four value fields — never coalesced to 0.
      value: r.value,
      valueClass: r.value_class,
      previousValue: metaNumber(r.metadata, 'previousValue'),
      beginningOfYearValue: metaNumber(r.metadata, 'beginningOfYearValue'),
      difference: metaNumber(r.metadata, 'difference'),
      differenceClass: metaString(r.metadata, 'differenceClass'),
    })),
  }
}
