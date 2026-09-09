// R13.8 — GET /api/family-portfolio/weekly-changes/[scope]
//
// The Weekly Changes surface for ONE entitled scope and ONE selected published
// week (doc 07 Parts A2/A3, page order § 6h).
//
// AUTHORIZATION ORDER: approved session → entitlement → explicit
// `canReadScope` → database. Identical ladder to every other member read; a
// denial carries nothing — not a scope name, not a publication date, not a
// principal. Unlike the Stage-7 Overview this route serves EVERY entitled
// scope, because doc 07 §§ 6e/6g define personal hierarchies explicitly
// (Sociedad → Asset Class → Subasset → Asset) alongside Main's.
//
// CLIENT DISCIPLINE (unchanged): the publication SPINE via the service-role
// client AFTER the entitlement decision — operational metadata only, never a
// financial figure — and every snapshot row, performance row and binding via
// the CALLER'S OWN session, so PostgreSQL RLS re-derives entitlement
// independently of anything decided here.
//
// WHAT THIS ROUTE DELIBERATELY RETURNS: the change NODES themselves, plus the
// server-computed aggregates. The client drills into the hierarchy and toggles
// cash by calling the SAME pure functions this route calls — it never computes
// a portfolio semantic of its own, and it only ever holds rows RLS already
// released to it. No Alternatives data is touched: that is Stage 9.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { canReadScope } from '@/lib/portfolioAccess/entitlements'
import {
  selectWeekPair,
  selectComparisonRange,
  buildChangeNodes,
  buildTotalMetrics,
  suppressSingleWeekMetrics,
  detectReclassifications,
  reconcileFlowAndProfit,
  deriveDrivers,
  buildWaterfall,
  buildWeeklyChangeTrend,
  resolvePreviousPortfolioTotal,
  sourcePreviousWeekRows,
  hasSourceWeeklyBasis,
  type DriverGrouping,
  type WeeklyBasis,
  type WeeklyChangeInputRow,
} from '@/lib/familyPortfolio/weeklyChanges'
import { dict } from '@/lib/i18n'
import {
  listCurrentPublications,
  getSnapshotRowsForScope,
  getPerformanceRowsForScope,
  getPerformanceBindings,
  getSnapshotValuesByKeys,
  getRowHistoryForScope,
  listRowHistoryDates,
  getPerformanceHistoryRange,
  listPerformanceHistoryDates,
} from '@/lib/db/repositories/familyPortfolioReadRepository'
import {
  buildPeriodPerformance,
  type PeriodPerformance,
} from '@/lib/familyPortfolio/periodPerformance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

function fail(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE })
}

/**
 * Main's Weekly Changes binds to `with_chilean_equities` — doc 07 § 6e's
 * waterfall reconciles to the portfolio TOTAL and its driver list includes
 * Chilean Equities, which sits only inside that total. A personal scope
 * publishes a single `total` basis (doc 05 § 5.3). The basis is never inferred
 * from row order or label text.
 */
function basisFor(scope: string): string {
  return scope === 'main' ? 'with_chilean_equities' : 'total'
}

/** Main tiles by its top-level rows; a personal scope by sociedad (doc 07 § 6e). */
function defaultGroupingFor(scope: string): DriverGrouping {
  return scope === 'main' ? 'top_level' : 'sociedad'
}

function parseGrouping(raw: string | null, scope: string): DriverGrouping {
  if (scope === 'main') return 'top_level'
  return raw === 'asset_class' ? 'asset_class' : defaultGroupingFor(scope)
}

// The labels the waterfall's synthetic steps carry. Both languages travel with
// the payload so the client never has to reconstruct a financial label — and
// they come from the ONE dictionary the page also reads, so the server and
// client waterfalls can never drift apart on a label (R13.8 audit).
const STEP_LABELS = {
  opening: {
    es: dict.es.fp.weeklyChanges.previousValueLabel,
    en: dict.en.fp.weeklyChanges.previousValueLabel,
  },
  closing: {
    es: dict.es.fp.weeklyChanges.currentValueLabel,
    en: dict.en.fp.weeklyChanges.currentValueLabel,
  },
  residual: {
    es: dict.es.fp.weeklyChanges.residualStep,
    en: dict.en.fp.weeklyChanges.residualStep,
  },
} as const

export async function GET(request: Request, context: { params: Promise<{ scope: string }> }) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const { scope } = await context.params
  const entitlement = await getFamilyPortfolioEntitlement()
  if (!canReadScope(entitlement.input, scope)) return fail('not_authorized', 403)

  const url = new URL(request.url)
  const asOf = url.searchParams.get('asOf')
  // R13.R1.1 § 13 — `from` opts into CUSTOM COMPARE: any earlier published week
  // becomes the opening endpoint. Absent, the surface keeps its default and
  // compares with the immediately preceding published week.
  const from = url.searchParams.get('from')
  const grouping = parseGrouping(url.searchParams.get('grouping'), scope)

  // --- Publication spine (operational metadata only, after entitlement).
  const spine = await listCurrentPublications('portfolio')
  if (!spine.ok) return fail(spine.code, spine.code === 'not_configured' ? 503 : 502)

  // Both endpoints must be weeks the book actually holds; neither is snapped to
  // a nearest date (§ 12), so a stale bookmark fails loudly instead of quietly
  // reporting a different period under the dates that were asked for.
  const latest = spine.publications.reduce<string | null>(
    (a, p) => (a === null || p.asOfDate > a ? p.asOfDate : a),
    null,
  )
  // ── R13.8E — WHICH REPORTING WEEKS CAN OPEN A ROLLING WINDOW ──────────────
  //
  // A frozen reporting week the source closed but the book never published now
  // carries persisted row-level values. That is enough to OPEN a multi-week
  // comparison — the rolling 1M contributors window opens at 2026-08-07, a week
  // with no publication and no revision.
  //
  // It is NOT enough to make that week a publication, and this route never
  // treats it as one: the closing endpoint is always a published week, the
  // `weeks` list the client offers in Compare is still publications only, and a
  // row-history opening is labelled as such in the response.
  //
  // A failed read yields an EMPTY list, so a window that cannot be opened is
  // reported as unbuildable rather than opened from somewhere else.
  const rowHistory = await listRowHistoryDates(scope)
  const rowHistoryDates = rowHistory.ok ? rowHistory.dates : []
  const publishedDates = new Set(spine.publications.map((p) => p.asOfDate))
  const rowHistoryOpening =
    from !== null && !publishedDates.has(from) && rowHistoryDates.includes(from) ? from : null

  const pair =
    from !== null && latest !== null && rowHistoryOpening === null
      ? selectComparisonRange(spine.publications, from, asOf ?? latest)
      : selectWeekPair(spine.publications, rowHistoryOpening !== null ? (asOf ?? latest) : asOf)
  if (!pair.ok) {
    return NextResponse.json(
      { scope, state: pair.code, weeks: [], publication: null, previousPublication: null },
      { status: pair.code === 'no_publications' ? 200 : 404, headers: NO_STORE },
    )
  }
  // The ordering check `selectComparisonRange` performs, applied to the opening
  // endpoint it never sees. An opening that is not strictly before the closing
  // week is a bad request, not a window of zero length.
  if (rowHistoryOpening !== null && !(rowHistoryOpening < pair.selection.current.asOfDate)) {
    return NextResponse.json(
      { scope, state: 'from_not_before_to', weeks: [], publication: null, previousPublication: null },
      { status: 404, headers: NO_STORE },
    )
  }

  const mode = from !== null ? 'custom' : 'weekly'
  const { current, previous } = pair.selection
  const weeks = spine.publications.map((p) => ({ asOfDate: p.asOfDate, revision: p.revision }))
  const publication = {
    id: current.id,
    asOfDate: current.asOfDate,
    revision: current.revision,
    publishedAt: current.publishedAt,
    parserVersion: current.parserVersion,
  }

  // --- The selected week's own rows first: in WEEKLY mode they may already
  //     answer the whole question, and a second publication read would then be
  //     both unnecessary and wrong (see `WeeklyBasis`).
  const [currentRows, performance] = await Promise.all([
    getSnapshotRowsForScope(current.id, scope),
    getPerformanceRowsForScope(current.id, scope),
  ])
  if (!currentRows.ok) return fail(currentRows.code, currentRows.code === 'not_configured' ? 503 : 502)
  if (!performance.ok) return fail(performance.code, performance.code === 'not_configured' ? 503 : 502)

  // ── THE WEEKLY BASIS ──────────────────────────────────────────────────────
  //
  // CUSTOM compare always reads two publications: the reader chose both
  // endpoints and the range is deliberately multi-week.
  //
  // WEEKLY prefers this publication's OWN previous-week column. That is the
  // week the source actually closed before this one — 2026-08-28 for the
  // 2026-09-04 publication — which after a catch-up import is NOT the previous
  // publication (2026-07-31, five weeks back). Reading it here keeps the level
  // change, the source's one-week flow/profit figures and the reconciliation
  // identity all describing the SAME interval, without publishing a single
  // catch-up week or touching the locked import architecture.
  const sourcePreviousDate =
    mode === 'weekly' &&
    hasSourceWeeklyBasis(currentRows.rows, current.previousWeekDate, current.asOfDate)
      ? current.previousWeekDate
      : null
  const weeklyBasis: WeeklyBasis =
    sourcePreviousDate !== null ? 'source_previous_week' : 'adjacent_publication'

  /** The opening endpoint as the surface will label it. Never inferred. */
  let openingEndpoint: { asOfDate: string; publishedAt: string | null }
  let previousRowSet: WeeklyChangeInputRow[]
  /** WHERE the opening rows came from. Reported, never guessed by the client. */
  let openingSource: 'source_previous_week' | 'publication' | 'row_history'

  if (sourcePreviousDate !== null) {
    // One week, out of this publication alone.
    openingEndpoint = { asOfDate: sourcePreviousDate, publishedAt: null }
    previousRowSet = sourcePreviousWeekRows(currentRows.rows)
    openingSource = 'source_previous_week'
  } else if (rowHistoryOpening !== null) {
    // R13.8E — a frozen reporting week with persisted row-level values and no
    // publication. The rolling contributors window opens here.
    const openingRows = await getRowHistoryForScope(scope, rowHistoryOpening)
    if (!openingRows.ok) {
      return fail(openingRows.code, openingRows.code === 'not_configured' ? 503 : 502)
    }
    if (openingRows.rows.length === 0) {
      // The coverage view said this week had rows and the scope-filtered read
      // returned none. Honest emptiness — never a comparison against nothing,
      // which would report every position as newly created.
      return NextResponse.json(
        {
          scope,
          state: 'opening_not_available',
          weeks,
          publication,
          previousPublication: null,
          mode,
          weeklyBasis,
          rowHistoryDates,
        },
        { headers: NO_STORE },
      )
    }
    openingEndpoint = { asOfDate: rowHistoryOpening, publishedAt: null }
    previousRowSet = openingRows.rows
    openingSource = 'row_history'
  } else if (previous !== null) {
    // The publication before this one — a custom range, or a week whose own
    // previous-week column is unusable.
    openingEndpoint = { asOfDate: previous.asOfDate, publishedAt: previous.publishedAt }
    const previousRows = await getSnapshotRowsForScope(previous.id, scope)
    if (!previousRows.ok) return fail(previousRows.code, previousRows.code === 'not_configured' ? 503 : 502)
    previousRowSet = previousRows.rows
    openingSource = 'publication'
  } else {
    // The earliest published week genuinely has no comparison, and the source
    // states no preceding one. An honest state, never a zero change (doc 07 § 6b).
    return NextResponse.json(
      { scope, state: 'no_previous_week', weeks, publication, previousPublication: null, mode, weeklyBasis, rowHistoryDates },
      { headers: NO_STORE },
    )
  }

  if (currentRows.rows.length === 0) {
    return NextResponse.json(
      { scope, state: 'empty', weeks, publication, previousPublication: openingEndpoint, mode, weeklyBasis, rowHistoryDates },
      { headers: NO_STORE },
    )
  }

  const basis = basisFor(scope)
  const perfRows = performance.rows.map((p) => ({
    basis: p.basis,
    metric: p.metric,
    value: p.value,
    boundRowKey: p.boundRowKey,
  }))

  // The portfolio's OPENING value — the denominator of Impact on Portfolio
  // Value. Resolved through the previous week's own rows and this week's
  // binding, never assumed; the pure helper fails closed if the bound row is
  // missing from either week or changed currency between them.
  const boundKey = perfRows.find((p) => p.basis === basis && p.boundRowKey !== null)?.boundRowKey ?? null
  const previousTotal = resolvePreviousPortfolioTotal(currentRows.rows, previousRowSet, boundKey)

  const nodes = buildChangeNodes(currentRows.rows, previousRowSet, previousTotal)
  // Over a custom range the source's own single-week flow/profit describe the
  // wrong period and are withheld (§ 13); the value change itself is derived
  // from the two snapshots and is correct over any span.
  const total = mode === 'custom'
    ? suppressSingleWeekMetrics(buildTotalMetrics(nodes, perfRows, basis))
    : buildTotalMetrics(nodes, perfRows, basis)
  const drivers = deriveDrivers(nodes, grouping)
  const waterfall = buildWaterfall(total, drivers, STEP_LABELS)
  const flowReconciliation = reconcileFlowAndProfit(total)
  // § 7 — an asset that left one parent and arrived under another is reported,
  // never merged. Both nodes keep their own identity and their own change.
  const reclassifications = detectReclassifications(nodes)

  // ── FOLLOW-UP D — CUSTOM COMPARE IS A PERIOD, NOT A WEEK ─────────────────
  //
  // Over an arbitrary FROM → TO the source's own single-week flow, profit and
  // return describe the wrong interval, so `suppressSingleWeekMetrics` removes
  // them (above) and they are replaced here by CUMULATIVE figures summed over
  // every reporting interval in (FROM, TO].
  //
  // The half-open window is the whole point: the FROM week's own flow already
  // moved the book to the value this comparison OPENS at, so counting it again
  // would double-count it. The TO week's flow happened inside the period and
  // counts.
  //
  // WEEKLY MODE COMPUTES NONE OF THIS. Its figures are the source's own stated
  // week, unchanged, and reaching for a period aggregate there would replace a
  // published number with a derived one.
  let periodPerformance: PeriodPerformance | null = null
  if (mode === 'custom') {
    const [spineDates, metrics] = await Promise.all([
      listPerformanceHistoryDates(scope, basis),
      getPerformanceHistoryRange(scope, basis, openingEndpoint.asOfDate, current.asOfDate),
    ])
    // A FAILED READ IS NOT AN EMPTY PERIOD. Both degrade to `null`, which the
    // surface renders as unavailable and names — never a flow of zero, which
    // would silently attribute every deposit in the period to performance.
    if (spineDates.ok && metrics.ok) {
      const pick = (metric: string) =>
        metrics.rows
          .filter((r) => r.metric === metric)
          .map((r) => ({ observationDate: r.observationDate, value: r.value }))

      periodPerformance = buildPeriodPerformance({
        fromDate: openingEndpoint.asOfDate,
        toDate: current.asOfDate,
        // The spine of THIS basis, so a window is never judged incomplete for
        // weeks that were never part of this series. Main's
        // `with_chilean_equities` block only begins at 2026-01-02.
        reportingDates: spineDates.dates,
        openingValue: total.previousValue,
        closingValue: total.currentValue,
        flows: pick('flow'),
        profits: pick('weekly_profit'),
        returns: pick('weekly_return'),
      })
    }
  }

  // --- Historical weekly-change trend: each week through its OWN binding.
  const publicationIds = spine.publications.map((p) => p.id)
  const bindings = await getPerformanceBindings(publicationIds, scope)

  let trend: Array<{ date: string; value: number }> = []
  if (bindings.ok) {
    const boundByPublication = new Map<string, string | null>()
    for (const b of bindings.bindings) {
      if (b.basis === basis) boundByPublication.set(b.publicationId, b.boundRowKey)
    }
    const keys = [...new Set([...boundByPublication.values()].filter((k): k is string => k !== null))]
    const values = await getSnapshotValuesByKeys(publicationIds, scope, keys)
    if (values.ok) {
      const valueByRow = new Map<string, number | null>()
      for (const v of values.values) valueByRow.set(`${v.publicationId}::${v.rowKey}`, v.value)
      trend = buildWeeklyChangeTrend({
        publications: spine.publications.map((p) => ({ id: p.id, asOfDate: p.asOfDate })),
        boundKeyByPublication: boundByPublication,
        valueByPublicationRow: valueByRow,
      })
    }
  }

  return NextResponse.json(
    {
      scope,
      state: 'ok',
      weeks,
      publication,
      previousPublication: openingEndpoint,
      /**
       * WHICH TWO THINGS THE CHANGE IS A DIFFERENCE OF.
       * `source_previous_week` — this publication's own previous-week column, a
       * true one-week step even across a catch-up gap. `adjacent_publication` —
       * the publication before it, which may be several weeks earlier.
       */
      weeklyBasis,
      /**
       * R13.8E - WHERE THE OPENING ENDPOINT'S ROWS CAME FROM.
       * `source_previous_week` - this publication's own previous-week column.
       * `publication` - an earlier full publication.
       * `row_history` - a frozen reporting week the source closed that the book
       * never published, whose row-level values are persisted analytically. It
       * is never a publication and never appears in `weeks`.
       */
      openingSource,
      /**
       * Every reporting week this scope has ROW-LEVEL history for. The client
       * uses it to decide whether a rolling window can be opened; it must never
       * be offered as a list of publications.
       */
      rowHistoryDates,
      /**
       * `weekly` — the immediately preceding published week (the default).
       * `custom` — an explicit earlier endpoint. The client titles the surface
       * from this, so a multi-week range is never called a Weekly Change.
       */
      mode,
      reclassifications,
      basis,
      grouping,
      /** Every grouping this scope may present — Main has exactly one. */
      availableGroupings: scope === 'main' ? ['top_level'] : ['sociedad', 'asset_class'],
      total,
      flowReconciliation,
      /**
       * FOLLOW-UP D — the CUSTOM-PERIOD reconciliation, present only in `custom`
       * mode and null in `weekly` mode.
       *
       * `From value + Period P&L + Period Net Flows = To value`, with P&L
       * derived from that identity and the source's own weekly profits summed
       * separately as an independent cross-check. `periodReturn` chain-links the
       * source's weekly returns; it is never P&L divided by the opening value,
       * which a mid-period contribution would distort.
       */
      periodPerformance,
      waterfall,
      driverRowKeys: drivers.map((d) => d.rowKey),
      nodes,
      trend,
    },
    { headers: NO_STORE },
  )
}
