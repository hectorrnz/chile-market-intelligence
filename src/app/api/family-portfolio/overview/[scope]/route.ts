// R13.7 — GET /api/family-portfolio/overview/[scope]
//
// The generated Overview (One Pager) for the LATEST current portfolio
// publication (docs 05 § 7.4, 06 § 5, 07 § 7.1).
//
// AUTHORIZATION ORDER: approved session → explicit `canReadScope` → shape
// check → database. Identical ladder to the Stage-6 read routes; a denial
// carries nothing.
//
// SCOPE (R13.R2 § 10 — widened from R13.7's main-only rule). Two compositions
// exist, and they are deliberately DIFFERENT rather than one parameterised
// shape:
//
//   * `main` — the One Pager's full weekly close (doc 06 §§ 1-2): two
//     performance bases, three allocation denominators, the InRetail portfolio
//     impact, and the two-year evolution history. Unchanged from R13.7.
//   * a PERSONAL scope (`jaime`/`andres`/`pablo`) — that portfolio's OWN
//     supported figures only: its single bound `total` performance basis, its
//     single allocation denominator, and its own weekly snapshot. It carries
//     no Ex/Incl-Chilean-equities split (a personal portfolio has none), no
//     InRetail impact, and — critically — not one Main row: every query below
//     is filtered to the requested scope, and PostgreSQL RLS re-derives that
//     filter independently.
//
// `alternatives` and `admin` remain 404: neither is a portfolio with a weekly
// close, and inventing a composition for them would be fabrication.
//
// PERSONAL EVOLUTION IS HONESTLY UNAVAILABLE (§ 24). The R13.R1.1 backfill
// normalised MAIN's 102-week history; no personal-scope observation exists
// (verified against the live book: 204 observations, all `main`). A personal
// scope therefore reports `evolutionSource: 'unavailable'` with an empty
// series. Back-projecting today's personal holdings across historical dates
// would manufacture a two-year history nobody ever published.
//
// CLIENT DISCIPLINE (unchanged from R13.6): publication SPINES via the
// service-role client AFTER the entitlement decision (operational metadata
// only); every financial row and the commentary via the CALLER'S OWN session
// under RLS. The alternatives spine is consulted ONLY for its as-of date
// (dual freshness, doc 06 § 5 element 21) and only when the caller holds the
// alternatives scope.
//
// Market benchmarks are resolved through the verified-symbol gate — at the
// time of writing every candidate is unverified, so the market context
// reports `unverified` per metric and no market request leaves this server.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { canReadScope } from '@/lib/portfolioAccess/entitlements'
import { selectPublicationWeek } from '@/lib/familyPortfolio/memberRead'
import {
  identifyMainStructure,
  buildComparisonRows,
  buildAllocation,
  buildHero,
  buildWeeklySnapshot,
  extractPerformanceBlocks,
  extractPerformanceBlocksFor,
  buildEvolutionSeries,
  buildPersonalEvolutionSeries,
  inretailImpact,
  type EvolutionPoint,
  identifyPersonalStructure,
  buildPersonalAllocation,
  buildPersonalComparisonRows,
  buildPersonalHero,
  PERSONAL_PERFORMANCE_BASES,
} from '@/lib/familyPortfolio/overview'
import { resolveOverviewMarketContext } from '@/lib/familyPortfolio/overviewMarket'
import { scopeHasWeeklyNotes } from '@/lib/familyPortfolio/weeklyNotes'
import { getWeeklyNotes } from '@/lib/db/repositories/familyPortfolioWeeklyNotesRepository'
import {
  listCurrentPublications,
  getSnapshotRowsForScope,
  getPerformanceRowsForScope,
  getPerformanceBindings,
  getPerformanceMetricSeries,
  getSnapshotValuesByKeys,
  getEvolutionObservations,
  getCurrentCommentary,
} from '@/lib/db/repositories/familyPortfolioReadRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

function fail(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE })
}

export async function GET(_request: Request, context: { params: Promise<{ scope: string }> }) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const { scope } = await context.params

  const entitlement = await getFamilyPortfolioEntitlement()
  // Entitlement FIRST — an unentitled caller learns nothing, not even which
  // scopes have an Overview composition at all.
  if (!canReadScope(entitlement.input, scope)) return fail('not_authorized', 403)
  const isMain = scope === 'main'
  const isPersonal = scope === 'jaime' || scope === 'andres' || scope === 'pablo'
  if (!isMain && !isPersonal) return fail('not_found', 404)

  const spine = await listCurrentPublications('portfolio')
  if (!spine.ok) return fail(spine.code, spine.code === 'not_configured' ? 503 : 502)

  // Honest empty state: nothing has ever been published.
  if (spine.publications.length === 0) {
    return NextResponse.json(
      { scope, publication: null },
      { headers: NO_STORE },
    )
  }

  const selection = selectPublicationWeek(spine.publications, null)
  if (!selection.ok) return fail('week_not_found', 404)
  const selected = selection.selected

  // EVERY read below is filtered to the REQUESTED scope. A personal request
  // never loads a Main row, so no Main monetary value can reach a personal
  // response even by accident (§ 10).
  const [rowsResult, perfResult] = await Promise.all([
    getSnapshotRowsForScope(selected.id, scope),
    getPerformanceRowsForScope(selected.id, scope),
  ])
  if (!rowsResult.ok) return fail(rowsResult.code, rowsResult.code === 'not_configured' ? 503 : 502)
  if (!perfResult.ok) return fail(perfResult.code, perfResult.code === 'not_configured' ? 503 : 502)

  // The two compositions stay separate: Main's is the R13.7 One Pager, byte for
  // byte; a personal scope's is its own smaller, honestly-bounded set.
  const mainStructure = isMain ? identifyMainStructure(rowsResult.rows, perfResult.rows) : null
  const personalStructure = isMain
    ? null
    : identifyPersonalStructure(rowsResult.rows, perfResult.rows)

  const comparison = mainStructure
    ? buildComparisonRows(mainStructure)
    : buildPersonalComparisonRows(personalStructure!)
  const allocation = mainStructure
    ? buildAllocation(mainStructure)
    : buildPersonalAllocation(personalStructure!)
  const hero = mainStructure
    ? buildHero(mainStructure, perfResult.rows)
    : buildPersonalHero(personalStructure!, perfResult.rows)
  const performanceBlocks = mainStructure
    ? extractPerformanceBlocks(perfResult.rows)
    : extractPerformanceBlocksFor(perfResult.rows, PERSONAL_PERFORMANCE_BASES)

  // The four Weekly Snapshot figures (§§ 11-12), read off the row the parser
  // bound to the scope's own basis — Main's TOTAL, or a personal scope's total.
  const weeklySnapshot = buildWeeklySnapshot(
    mainStructure ? mainStructure.totalRow : personalStructure!.totalRow,
  )

  // The InRetail portfolio-value impact is a MAIN One Pager concept (doc 06
  // § 3.3). A personal scope reports it as absent rather than searching that
  // scope's own holdings for a similarly-named row, which would be a different
  // metric wearing the same label.
  const impact = mainStructure ? inretailImpact(mainStructure) : { rowKey: null, value: null }

  // --- Evolution (R13.R1 § 9). TWO honest sources, in this order:
  //
  //   1. the PERSISTED weekly history ingested from the workbook's own
  //      historical column grid — the owner-confirmed series that begins
  //      2024-08-23 and covers every published week since;
  //   2. failing that, the points derivable from the publications themselves,
  //      resolved through each week's OWN performance bindings (the R13.7
  //      behaviour, retained so a database without the ingest still charts
  //      whatever has genuinely been published).
  //
  // The two are never blended: mixing a two-year source-backed series with a
  // handful of publication-derived points would present one provenance as the
  // other. `evolutionSource` states which one the client is looking at.
  //
  // R13.R2C §§ 15-18 — A PERSONAL SCOPE NOW HAS A HISTORY TOO, and it is the
  // SAME two sources in the same order, for the same reasons. The R13.R1
  // deferral ("no personal-scope observation has ever been published") was a
  // statement about the ingest, not about the source: the workbook's historical
  // column grid carries each personal scope's own numerically-bound total row in
  // every column it existed for. Widening `extractEvolutionHistory` to every
  // scope publishes those series through the identical path Main's uses, into
  // the identical table — whose `scope` CHECK, unique key and
  // `nmi_can_access_scope` read policy already covered the personal scopes, so
  // no schema changed. Nothing is back-projected: a scope that joined the book
  // later simply starts later (§ 16).
  //
  // A PERSONAL SCOPE HAS ONE BASIS, `total` — never a Main basis name (§ 28).
  const publicationIds = spine.publications.map((p) => p.id)
  let evolution: { exChilean: EvolutionPoint[]; withChilean: EvolutionPoint[]; total: EvolutionPoint[] } = {
    exChilean: [],
    withChilean: [],
    total: [],
  }
  let evolutionSource: 'persisted_history' | 'publications' | 'unavailable' = 'unavailable'

  const persisted = await getEvolutionObservations(scope)
  if (persisted.ok && persisted.observations.length > 0) {
    // Gaps are ABSENT ROWS in the table, so there is nothing to filter here and
    // nothing is ever interpolated or carried forward.
    const pointsFor = (basis: string): EvolutionPoint[] =>
      persisted.observations
        .filter((o) => o.basis === basis)
        .map((o) => ({ date: o.observationDate, value: o.value }))
    evolution = {
      exChilean: isMain ? pointsFor('ex_chilean_equities') : [],
      withChilean: isMain ? pointsFor('with_chilean_equities') : [],
      total: isMain ? [] : pointsFor('total'),
    }
    if (evolution.exChilean.length > 0 || evolution.withChilean.length > 0 || evolution.total.length > 0) {
      evolutionSource = 'persisted_history'
    }
  } else {
    // Fallback: the points derivable from the publications themselves, resolved
    // through each week's OWN performance bindings. The two sources are never
    // blended — `evolutionSource` states which one the client is looking at.
    const bindingsResult = await getPerformanceBindings(publicationIds, scope)
    if (bindingsResult.ok) {
      const boundKeys = [
        ...new Set(
          bindingsResult.bindings
            .map((b) => b.boundRowKey)
            .filter((k): k is string => k !== null),
        ),
      ]
      const valuesResult = await getSnapshotValuesByKeys(publicationIds, scope, boundKeys)
      if (valuesResult.ok) {
        const input = {
          publications: spine.publications.map((p) => ({ id: p.id, asOfDate: p.asOfDate })),
          bindings: bindingsResult.bindings,
          boundValues: valuesResult.values,
        }
        evolution = isMain
          ? { ...buildEvolutionSeries(input), total: [] }
          : { exChilean: [], withChilean: [], total: buildPersonalEvolutionSeries(input) }
        if (
          evolution.exChilean.length > 0 ||
          evolution.withChilean.length > 0 ||
          evolution.total.length > 0
        ) {
          evolutionSource = 'publications'
        }
      }
    }
  }

  // --- R13.R2 PASS 4 § 2 — ATTACH EACH WEEK'S STATED NET FLOW to its level.
  //
  // The chart must not jump on a contribution or a withdrawal, so the client
  // plots `value − Σ net flows since the anchor`. That subtraction needs the
  // SOURCE'S OWN flow figure per week, which lives in the same week's
  // performance block (`portfolio_performance_rows`, metric `flow`, value class
  // `source_provided_flow`) — never a difference this server derives.
  //
  // Matched by EXACT week date and by basis.
  //
  // R13.R2E.1 § 2 — AN ABSENT FLOW ROW IS A BLANK SPARSE-EVENT CELL, WHICH IS
  // ZERO. Contributions and withdrawals are unusual events; the flow field's
  // normal state is empty, and the workbook bears that out exactly — across all
  // five flow rows × 102 week columns, 477 cells are blank, 33 are non-zero
  // numbers, and there is not one literal zero, error or text cell.
  //
  // A row can be missing here for two different upstream reasons, and both mean
  // the same thing about the money: either the parser read a blank cell in a
  // maintained block (and wrote an explicit zero), or the whole performance
  // block was unmaintained that week and was not published at all — which is
  // Main's `with_chilean_equities` case before 2026. An unmaintained block means
  // nobody computed that week's RETURN. It says nothing about whether money
  // moved, and reading it as "flow unknown" is what previously truncated Main's
  // Incl.-Chile history to its last 32 weeks.
  //
  // Only a flow the publication marked UNAVAILABLE is genuinely unknown, and it
  // travels separately so the adjuster can refuse that step alone. No week in
  // the current book carries one.
  const flowsResult = await getPerformanceMetricSeries(publicationIds, scope, 'flow')
  if (flowsResult.ok) {
    const dateOf = new Map(spine.publications.map((p) => [p.id, p.asOfDate]))
    const flowByBasisDate = new Map<string, number>()
    const unavailable = new Set<string>()
    for (const point of flowsResult.points) {
      const date = dateOf.get(point.publicationId)
      if (date === undefined) continue
      const key = `${point.basis}|${date}`
      if (point.value === null || !Number.isFinite(point.value) || point.valueClass === 'unavailable') {
        unavailable.add(key)
        continue
      }
      flowByBasisDate.set(key, point.value)
    }
    const withFlows = (basis: string, points: EvolutionPoint[]): EvolutionPoint[] =>
      points.map((p) => {
        const key = `${basis}|${p.date}`
        if (unavailable.has(key)) return { ...p, flow: null, flowUnavailable: true }
        const flow = flowByBasisDate.get(key)
        return { ...p, flow: flow === undefined ? null : flow }
      })
    evolution = {
      exChilean: withFlows('ex_chilean_equities', evolution.exChilean),
      withChilean: withFlows('with_chilean_equities', evolution.withChilean),
      total: withFlows('total', evolution.total),
    }
  }

  // --- Commentary: the live revision only, for THIS scope, generically
  // attributed. Commentary is stored per scope, so a personal reader gets the
  // note written for their own portfolio and never Main's.
  const commentaryResult = await getCurrentCommentary(selected.id, scope)
  const commentary = commentaryResult.ok ? commentaryResult.commentary : null

  // --- R13.R2C §§ 7-8: the week's Weekly Notes — SEVERAL of them, each with its
  // own identity. MAIN ONLY, and that is a product rule the server applies, not
  // a layout convenience: a personal scope receives an empty list and the
  // surface renders no notes region at all rather than an empty column.
  // Tombstoned notes never arrive here — the RLS predicate excludes them.
  //
  // R13.R2 PASS 4 § 1 — AND THE READ STATE TRAVELS WITH THEM. Previously any
  // read failure was flattened to `[]`, which the panel rendered as "no note has
  // been written for this week" — a false statement about the week whenever the
  // real answer was "this table does not exist yet". `weeklyNotesState`
  // distinguishes the three cases the surface must word differently: notes read
  // fine (`ok`), the schema is not applied (`schema_missing`), or the read
  // failed for some other reason (`unavailable`).
  const notesResult = scopeHasWeeklyNotes(scope)
    ? await getWeeklyNotes(selected.id, scope)
    : ({ ok: true, notes: [] } as const)
  const weeklyNotes = notesResult.ok ? notesResult.notes : []
  const weeklyNotesState: 'ok' | 'schema_missing' | 'unavailable' = notesResult.ok
    ? 'ok'
    : notesResult.code === 'schema_missing'
      ? 'schema_missing'
      : 'unavailable'

  // --- Market context, through the verified-symbol gate.
  const marketContext = await resolveOverviewMarketContext(
    selected.asOfDate,
    selected.previousWeekDate,
  )

  // --- Dual freshness (doc 06 § 5 element 21): the alternatives as-of shown
  // beside the portfolio's, never blended — and only for a caller entitled to
  // the alternatives scope.
  let alternativesFreshness: { asOfDate: string; publishedAt: string } | null = null
  if (canReadScope(entitlement.input, 'alternatives')) {
    const altSpine = await listCurrentPublications('alternatives')
    if (altSpine.ok && altSpine.publications.length > 0) {
      const latest = selectPublicationWeek(altSpine.publications, null)
      if (latest.ok) {
        alternativesFreshness = {
          asOfDate: latest.selected.asOfDate,
          publishedAt: latest.selected.publishedAt,
        }
      }
    }
  }

  return NextResponse.json(
    {
      scope,
      // R13.R2B §§ 10-13 — Weekly Notes is authored IN NMI, and its write path
      // is the EXISTING administrator commentary route, which is keyed by
      // publication id. Two fields therefore join the payload:
      //
      //   `publication.id` — the note's week key. It is not a secret: it is the
      //     identifier of a publication this caller is already reading, and
      //     holding it grants nothing, because the write route re-derives
      //     administrator capability server-side and the RPC runs service-role
      //     behind that check.
      //   `canEditNotes` — PRESENTATION CONVENIENCE ONLY, so a member is not
      //     shown a control that would refuse them. It is never the gate: the
      //     write route's own `entitlement.isAdministrator` test is (§ 10).
      canEditNotes: entitlement.isAdministrator === true,
      publication: {
        id: selected.id,
        asOfDate: selected.asOfDate,
        revision: selected.revision,
        publishedAt: selected.publishedAt,
        parserVersion: selected.parserVersion,
        dates: {
          beginningOfYear: selected.beginningOfYearDate,
          previousWeek: selected.previousWeekDate,
          thisWeek: selected.asOfDate,
        },
      },
      hero,
      comparison,
      allocation,
      performanceBlocks,
      weeklySnapshot,
      evolution,
      evolutionSource,
      inretailImpact: impact,
      marketContext,
      commentary,
      weeklyNotes,
      weeklyNotesState,
      freshness: {
        portfolio: { asOfDate: selected.asOfDate, publishedAt: selected.publishedAt },
        alternatives: alternativesFreshness,
      },
    },
    { headers: NO_STORE },
  )
}
