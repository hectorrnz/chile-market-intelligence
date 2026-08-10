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
  buildChangeNodes,
  buildTotalMetrics,
  reconcileFlowAndProfit,
  deriveDrivers,
  buildWaterfall,
  buildWeeklyChangeTrend,
  resolvePreviousPortfolioTotal,
  type DriverGrouping,
} from '@/lib/familyPortfolio/weeklyChanges'
import { dict } from '@/lib/i18n'
import {
  listCurrentPublications,
  getSnapshotRowsForScope,
  getPerformanceRowsForScope,
  getPerformanceBindings,
  getSnapshotValuesByKeys,
} from '@/lib/db/repositories/familyPortfolioReadRepository'

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
  const grouping = parseGrouping(url.searchParams.get('grouping'), scope)

  // --- Publication spine (operational metadata only, after entitlement).
  const spine = await listCurrentPublications('portfolio')
  if (!spine.ok) return fail(spine.code, spine.code === 'not_configured' ? 503 : 502)

  const pair = selectWeekPair(spine.publications, asOf)
  if (!pair.ok) {
    return NextResponse.json(
      { scope, state: pair.code, weeks: [], publication: null, previousPublication: null },
      { status: pair.code === 'week_not_found' ? 404 : 200, headers: NO_STORE },
    )
  }

  const { current, previous } = pair.selection
  const weeks = spine.publications.map((p) => ({ asOfDate: p.asOfDate, revision: p.revision }))
  const publication = {
    id: current.id,
    asOfDate: current.asOfDate,
    revision: current.revision,
    publishedAt: current.publishedAt,
    parserVersion: current.parserVersion,
  }

  // The earliest published week genuinely has no comparison. An honest state,
  // never a zero change (doc 07 § 6b).
  if (previous === null) {
    return NextResponse.json(
      { scope, state: 'no_previous_week', weeks, publication, previousPublication: null },
      { headers: NO_STORE },
    )
  }

  // --- Financial rows: the caller's own session, RLS is the authority.
  const [currentRows, previousRows, performance] = await Promise.all([
    getSnapshotRowsForScope(current.id, scope),
    getSnapshotRowsForScope(previous.id, scope),
    getPerformanceRowsForScope(current.id, scope),
  ])
  if (!currentRows.ok) return fail(currentRows.code, currentRows.code === 'not_configured' ? 503 : 502)
  if (!previousRows.ok) return fail(previousRows.code, previousRows.code === 'not_configured' ? 503 : 502)
  if (!performance.ok) return fail(performance.code, performance.code === 'not_configured' ? 503 : 502)

  if (currentRows.rows.length === 0) {
    return NextResponse.json(
      { scope, state: 'empty', weeks, publication, previousPublication: { asOfDate: previous.asOfDate, publishedAt: previous.publishedAt } },
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
  const previousTotal = resolvePreviousPortfolioTotal(currentRows.rows, previousRows.rows, boundKey)

  const nodes = buildChangeNodes(currentRows.rows, previousRows.rows, previousTotal)
  const total = buildTotalMetrics(nodes, perfRows, basis)
  const drivers = deriveDrivers(nodes, grouping)
  const waterfall = buildWaterfall(total, drivers, STEP_LABELS)
  const flowReconciliation = reconcileFlowAndProfit(total)

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
      previousPublication: { asOfDate: previous.asOfDate, publishedAt: previous.publishedAt },
      basis,
      grouping,
      /** Every grouping this scope may present — Main has exactly one. */
      availableGroupings: scope === 'main' ? ['top_level'] : ['sociedad', 'asset_class'],
      total,
      flowReconciliation,
      waterfall,
      driverRowKeys: drivers.map((d) => d.rowKey),
      nodes,
      trend,
    },
    { headers: NO_STORE },
  )
}
