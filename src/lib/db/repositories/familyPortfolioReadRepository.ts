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

// ---------------------------------------------------------------------------
// R13.7 — Overview reads. Same client discipline as above: everything below
// reads through the CALLER'S OWN session, so `nmi_can_access_scope` RLS is the
// authority on every row (performance rows and commentary both carry the
// scope-select policy from their migrations).
// ---------------------------------------------------------------------------

export interface PerformanceRowRead {
  basis: string
  metric: string
  value: number | null
  valueClass: string
  /** The snapshot row this block was NUMERICALLY bound to at parse time. */
  boundRowKey: string | null
}

type ScopedOrderedSelect<T> = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: unknown) => {
        eq: (col: string, v: unknown) => Promise<{ data: T[] | null; error: unknown }>
      }
    }
  }
}

/** One publication's performance rows for one scope (user session, RLS). */
export async function getPerformanceRowsForScope(
  publicationId: string,
  scope: string,
): Promise<{ ok: true; rows: PerformanceRowRead[] } | { ok: false; code: 'not_configured' | 'read_failed' }> {
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as ScopedOrderedSelect<{
    basis: string
    metric: string
    value: number | null
    value_class: string
    metadata: Record<string, unknown> | null
  }>)
    .from('portfolio_performance_rows')
    .select('basis, metric, value, value_class, metadata')
    .eq('publication_id', publicationId)
    .eq('scope', scope)

  if (error) return { ok: false, code: 'read_failed' }
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      basis: r.basis,
      metric: r.metric,
      value: r.value,
      valueClass: r.value_class,
      boundRowKey: metaString(r.metadata, 'boundRowKey'),
    })),
  }
}

export interface PublicationBinding {
  publicationId: string
  basis: string
  boundRowKey: string | null
}

type InScopedSelect<T> = {
  from: (t: string) => {
    select: (c: string) => {
      in: (col: string, v: readonly string[]) => {
        eq: (col: string, v: unknown) => Promise<{ data: T[] | null; error: unknown }>
      }
    }
  }
}

/**
 * Performance-block bindings for MANY publications at once — the evolution
 * charts resolve each week's SUBTOTAL/TOTAL through that week's OWN bindings,
 * never through a label match on historical rows.
 */
export async function getPerformanceBindings(
  publicationIds: readonly string[],
  scope: string,
): Promise<{ ok: true; bindings: PublicationBinding[] } | { ok: false; code: 'not_configured' | 'read_failed' }> {
  if (publicationIds.length === 0) return { ok: true, bindings: [] }
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as InScopedSelect<{
    publication_id: string
    basis: string
    metadata: Record<string, unknown> | null
  }>)
    .from('portfolio_performance_rows')
    .select('publication_id, basis, metadata')
    .in('publication_id', publicationIds)
    .eq('scope', scope)

  if (error) return { ok: false, code: 'read_failed' }

  // One binding per (publication, basis): rows of one block share it.
  const seen = new Map<string, PublicationBinding>()
  for (const r of data ?? []) {
    const key = `${r.publication_id}|${r.basis}`
    const bound = metaString(r.metadata, 'boundRowKey')
    const existing = seen.get(key)
    if (!existing || (existing.boundRowKey === null && bound !== null)) {
      seen.set(key, { publicationId: r.publication_id, basis: r.basis, boundRowKey: bound })
    }
  }
  return { ok: true, bindings: [...seen.values()] }
}

export interface PerformanceMetricPoint {
  publicationId: string
  basis: string
  value: number | null
  /**
   * The publication's own classification of the value — `source_provided_flow`
   * for a flow the source stated, `unavailable` when it could not be read.
   * Carried so an unreadable flow is never mistaken for a sparse-event blank.
   */
  valueClass: string | null
}

type InEqEqSelect<T> = {
  from: (t: string) => {
    select: (c: string) => {
      in: (col: string, v: readonly string[]) => {
        eq: (col: string, v: unknown) => {
          eq: (col: string, v: unknown) => Promise<{ data: T[] | null; error: unknown }>
        }
      }
    }
  }
}

/**
 * ONE performance metric across MANY publications, for one scope — the shape
 * the flow-adjusted evolution path needs (R13.R2 pass 4 § 2).
 *
 * Read through the CALLER'S OWN session so `nmi_can_access_scope` re-derives
 * the entitlement in the database: a net flow is a portfolio amount and is
 * protected exactly like the level it is subtracted from.
 *
 * A week that published no row for the metric is simply ABSENT from the result.
 * Nothing is coalesced here: this layer reports what the book holds, and the
 * SPARSE-EVENT reading of an absent flow (R13.R2E.1 § 2) belongs to the pure
 * adjuster, which is where it can be stated, documented and tested.
 *
 * `valueClass` travels with the value so the caller can tell a flow the source
 * STATED from one it published as unavailable — the two are read in opposite
 * directions and must never arrive indistinguishable.
 */
export async function getPerformanceMetricSeries(
  publicationIds: readonly string[],
  scope: string,
  metric: string,
): Promise<
  { ok: true; points: PerformanceMetricPoint[] } | { ok: false; code: 'not_configured' | 'read_failed' }
> {
  if (publicationIds.length === 0) return { ok: true, points: [] }
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as InEqEqSelect<{
    publication_id: string
    basis: string
    value: number | null
    value_class: string | null
  }>)
    .from('portfolio_performance_rows')
    .select('publication_id, basis, value, value_class')
    .in('publication_id', publicationIds)
    .eq('scope', scope)
    .eq('metric', metric)

  if (error) return { ok: false, code: 'read_failed' }
  return {
    ok: true,
    points: (data ?? []).map((r) => ({
      publicationId: r.publication_id,
      basis: r.basis,
      value: r.value,
      valueClass: r.value_class ?? null,
    })),
  }
}

export interface BoundRowValue {
  publicationId: string
  rowKey: string
  value: number | null
}

type InInScopedSelect<T> = {
  from: (t: string) => {
    select: (c: string) => {
      in: (col: string, v: readonly string[]) => {
        in: (col: string, v: readonly string[]) => {
          eq: (col: string, v: unknown) => Promise<{ data: T[] | null; error: unknown }>
        }
      }
    }
  }
}

/** Values of specific rows across many publications (user session, RLS). */
export async function getSnapshotValuesByKeys(
  publicationIds: readonly string[],
  scope: string,
  rowKeys: readonly string[],
): Promise<{ ok: true; values: BoundRowValue[] } | { ok: false; code: 'not_configured' | 'read_failed' }> {
  if (publicationIds.length === 0 || rowKeys.length === 0) return { ok: true, values: [] }
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as InInScopedSelect<{
    publication_id: string
    row_key: string
    value: number | null
  }>)
    .from('portfolio_snapshot_rows')
    .select('publication_id, row_key, value')
    .in('publication_id', publicationIds)
    .in('row_key', rowKeys)
    .eq('scope', scope)

  if (error) return { ok: false, code: 'read_failed' }
  return {
    ok: true,
    values: (data ?? []).map((r) => ({
      publicationId: r.publication_id,
      rowKey: r.row_key,
      // null stays null — a missing week must surface as a gap, never a 0.
      value: r.value,
    })),
  }
}

export interface CurrentCommentary {
  body: string
  revision: number
  updatedAt: string
}

type CommentarySelect = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: unknown) => {
        eq: (col: string, v: unknown) => {
          is: (col: string, v: null) => {
            maybeSingle: () => Promise<{
              data: { body: string; revision: number; updated_at: string } | null
              error: unknown
            }>
          }
        }
      }
    }
  }
}

/**
 * The LIVE commentary revision for one (publication, scope) — liveness is
 * `superseded_by is null`, the same partial-unique predicate the R13.5
 * lifecycle enforces, so a superseded revision can never surface here.
 *
 * The author's account id is deliberately NOT selected: members see the text,
 * its revision and its date, attributed generically as administrator
 * commentary — never another account's identifier.
 */
export async function getCurrentCommentary(
  publicationId: string,
  scope: string,
): Promise<
  | { ok: true; commentary: CurrentCommentary | null }
  | { ok: false; code: 'not_configured' | 'read_failed' }
> {
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as CommentarySelect)
    .from('portfolio_commentary')
    .select('body, revision, updated_at')
    .eq('publication_id', publicationId)
    .eq('scope', scope)
    .is('superseded_by', null)
    .maybeSingle()

  if (error) return { ok: false, code: 'read_failed' }
  if (!data) return { ok: true, commentary: null }
  return {
    ok: true,
    commentary: { body: data.body, revision: data.revision, updatedAt: data.updated_at },
  }
}

// ---------------------------------------------------------------------------
// R13.9 — Alternatives reads. Same client discipline: every holding and event
// row goes through the CALLER'S OWN session, so the `nmi_can_access_scope`
// RLS policy on both tables (R13.4) independently re-derives the shared
// `alternatives` entitlement. Rows are ordered by their source row in SQL —
// the workbook's own presentation order — but source coordinates are NOT
// selected: they are provenance for the admin surface, not member content
// (doc 07 § 7.4).
// ---------------------------------------------------------------------------

/** One published alternatives holding — no source coordinates, no metadata. */
export interface AlternativesHoldingRow {
  id: string
  category: string
  currency: string
  investmentName: string
  sociedad: string
  capitalCommitted: number | null
  contributions: number | null
  unfunded: number | null
  lastStatementDate: string | null
  lastStatementLabel: string | null
  lastValuation: number | null
  flowSinceStatement: number | null
  currentValue: number | null
  reportedIrr: number | null
  calculatedIrr: number | null
}

/** One published alternatives event. Classification is the parser's. */
export interface AlternativesEventRow {
  holdingId: string | null
  eventDate: string
  amount: number
  currency: string
  eventType: string
}

type OrderedByPublication<T> = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: unknown) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{ data: T[] | null; error: unknown }>
      }
    }
  }
}

/** Holdings of ONE (current) alternatives publication (user session, RLS). */
export async function getAlternativesHoldings(
  publicationId: string,
): Promise<
  | { ok: true; holdings: AlternativesHoldingRow[] }
  | { ok: false; code: 'not_configured' | 'read_failed' }
> {
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as OrderedByPublication<{
    id: string
    category: string
    currency: string
    investment_name: string
    sociedad: string
    capital_committed: number | null
    contributions: number | null
    unfunded: number | null
    last_statement_date: string | null
    last_statement_label: string | null
    last_valuation: number | null
    flow_since_statement: number | null
    current_value: number | null
    reported_irr: number | null
    calculated_irr: number | null
  }>)
    .from('alternatives_holdings')
    .select(
      'id, category, currency, investment_name, sociedad, capital_committed, contributions, unfunded, last_statement_date, last_statement_label, last_valuation, flow_since_statement, current_value, reported_irr, calculated_irr',
    )
    .eq('publication_id', publicationId)
    .order('source_row', { ascending: true })

  if (error) return { ok: false, code: 'read_failed' }
  return {
    ok: true,
    holdings: (data ?? []).map((h) => ({
      id: h.id,
      category: h.category,
      currency: h.currency,
      investmentName: h.investment_name,
      sociedad: h.sociedad,
      // Every numeric passes through as-is — null stays null, never 0.
      capitalCommitted: h.capital_committed,
      contributions: h.contributions,
      unfunded: h.unfunded,
      lastStatementDate: h.last_statement_date,
      lastStatementLabel: h.last_statement_label,
      lastValuation: h.last_valuation,
      flowSinceStatement: h.flow_since_statement,
      currentValue: h.current_value,
      reportedIrr: h.reported_irr,
      calculatedIrr: h.calculated_irr,
    })),
  }
}

/** Events of ONE (current) alternatives publication (user session, RLS). */
export async function getAlternativesEvents(
  publicationId: string,
): Promise<
  | { ok: true; events: AlternativesEventRow[] }
  | { ok: false; code: 'not_configured' | 'read_failed' }
> {
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as OrderedByPublication<{
    holding_id: string | null
    event_date: string
    amount: number
    currency: string
    event_type: string
  }>)
    .from('alternatives_events')
    .select('holding_id, event_date, amount, currency, event_type')
    .eq('publication_id', publicationId)
    .order('event_date', { ascending: true })

  if (error) return { ok: false, code: 'read_failed' }
  return {
    ok: true,
    events: (data ?? []).map((e) => ({
      holdingId: e.holding_id,
      eventDate: e.event_date,
      amount: e.amount,
      currency: e.currency,
      // The parser's classification, verbatim — `unclassified` included.
      eventType: e.event_type,
    })),
  }
}

// ---------------------------------------------------------------------------
// R13.R1 § 9 — weekly evolution history
// ---------------------------------------------------------------------------

/** One persisted evolution observation, as the chart consumes it. */
export interface EvolutionObservationRead {
  basis: string
  observationDate: string
  value: number
}

type EvolutionSelect = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: unknown) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{
          data: Array<{ basis: string; observation_date: string; value: number }> | null
          error: unknown
        }>
      }
    }
  }
}

/**
 * The full persisted weekly evolution history of one scope, ascending.
 *
 * Read through the CALLER'S OWN session, so `nmi_can_access_scope` re-derives
 * the entitlement in the database — an evolution point is a portfolio value and
 * is protected exactly like the snapshot row it was read from.
 *
 * Gaps are absent rows, never null values: a week the source could not supply
 * simply has no row, so nothing here needs to filter or coalesce.
 */
export async function getEvolutionObservations(
  scope: string,
): Promise<
  | { ok: true; observations: EvolutionObservationRead[] }
  | { ok: false; code: 'not_configured' | 'read_failed' }
> {
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as EvolutionSelect)
    .from('portfolio_evolution_observations')
    .select('basis, observation_date, value')
    .eq('scope', scope)
    .order('observation_date', { ascending: true })

  if (error) return { ok: false, code: 'read_failed' }
  return {
    ok: true,
    observations: (data ?? []).map((o) => ({
      basis: o.basis,
      observationDate: o.observation_date,
      value: o.value,
    })),
  }
}
