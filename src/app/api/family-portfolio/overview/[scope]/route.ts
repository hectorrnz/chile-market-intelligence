// R13.7 — GET /api/family-portfolio/overview/[scope]
//
// The generated Overview (One Pager) for the LATEST current portfolio
// publication (docs 05 § 7.4, 06 § 5, 07 § 7.1).
//
// AUTHORIZATION ORDER: approved session → explicit `canReadScope` → shape
// check → database. Identical ladder to the Stage-6 read routes; a denial
// carries nothing.
//
// STAGE-7 SCOPE: the composition is defined for `main` only — the One Pager
// IS the Main portfolio's weekly close (doc 06 §§ 1-2), and every entitled
// caller holds `main` by the access matrix (doc 05 § 2.3). Another scope,
// even an entitled one, is 404: no personal-scope Overview composition exists
// in the committed contract, and inventing one here would be fabrication.
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
  extractPerformanceBlocks,
  buildEvolutionSeries,
  inretailImpact,
} from '@/lib/familyPortfolio/overview'
import { resolveOverviewMarketContext } from '@/lib/familyPortfolio/overviewMarket'
import {
  listCurrentPublications,
  getSnapshotRowsForScope,
  getPerformanceRowsForScope,
  getPerformanceBindings,
  getSnapshotValuesByKeys,
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
  // Entitlement first — an unentitled caller learns nothing, not even that
  // only `main` has an Overview composition.
  if (!canReadScope(entitlement.input, scope)) return fail('not_authorized', 403)
  if (scope !== 'main') return fail('not_found', 404)

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

  const [rowsResult, perfResult] = await Promise.all([
    getSnapshotRowsForScope(selected.id, 'main'),
    getPerformanceRowsForScope(selected.id, 'main'),
  ])
  if (!rowsResult.ok) return fail(rowsResult.code, rowsResult.code === 'not_configured' ? 503 : 502)
  if (!perfResult.ok) return fail(perfResult.code, perfResult.code === 'not_configured' ? 503 : 502)

  const structure = identifyMainStructure(rowsResult.rows, perfResult.rows)
  const comparison = buildComparisonRows(structure)
  const allocation = buildAllocation(structure)
  const hero = buildHero(structure, perfResult.rows)
  const performanceBlocks = extractPerformanceBlocks(perfResult.rows)
  const impact = inretailImpact(structure)

  // --- Evolution: every current publication contributes at most one point per
  // series, resolved through its OWN performance bindings.
  const publicationIds = spine.publications.map((p) => p.id)
  const bindingsResult = await getPerformanceBindings(publicationIds, 'main')
  let evolution: ReturnType<typeof buildEvolutionSeries> = { exChilean: [], withChilean: [] }
  if (bindingsResult.ok) {
    const boundKeys = [
      ...new Set(
        bindingsResult.bindings
          .map((b) => b.boundRowKey)
          .filter((k): k is string => k !== null),
      ),
    ]
    const valuesResult = await getSnapshotValuesByKeys(publicationIds, 'main', boundKeys)
    if (valuesResult.ok) {
      evolution = buildEvolutionSeries({
        publications: spine.publications.map((p) => ({ id: p.id, asOfDate: p.asOfDate })),
        bindings: bindingsResult.bindings,
        boundValues: valuesResult.values,
      })
    }
  }

  // --- Commentary: the live revision only, generically attributed.
  const commentaryResult = await getCurrentCommentary(selected.id, 'main')
  const commentary = commentaryResult.ok ? commentaryResult.commentary : null

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
      publication: {
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
      evolution,
      inretailImpact: impact,
      marketContext,
      commentary,
      freshness: {
        portfolio: { asOfDate: selected.asOfDate, publishedAt: selected.publishedAt },
        alternatives: alternativesFreshness,
      },
    },
    { headers: NO_STORE },
  )
}
