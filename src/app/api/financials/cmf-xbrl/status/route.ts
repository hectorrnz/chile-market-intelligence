// Phase 8C.2/8C.3 — CMF/XBRL financials ingestion status (public read-only).
//
// GET /api/financials/cmf-xbrl/status
//
// Read-only diagnostics, consistent with the app's other public
// ingestion-status endpoints (/api/health/ingestion, /api/macro/ingestion-status,
// /api/market/ingestion-status). Exposes only aggregate run/coverage info —
// never secrets, never raw XBRL fact payloads, never a source URL token.
//
// Surfaces: latest CMF/XBRL ingestion run, per-issuer detail (enabled issuers
// with their RUT/verification info + XBRL coverage — period count, latest
// period, canonical count), and the not-configured issuers with documented
// reasons (Phase 8C.3: BSANTANDER/CHILE — banks sit under a CMF registry track
// this public XBRL search tool does not expose).

import { NextResponse } from 'next/server'
import { getIngestionRuns } from '@/lib/db/repositories/ingestionRunsRepository'
import { getSourceTypeCoverage } from '@/lib/db/repositories/financialsRepository'
import { CMF_ISSUER_MAP, UNMAPPED_TICKERS, getMappedTickers } from '@/lib/financials/cmfIssuerMap'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const [runsResult, coverage] = await Promise.all([
    getIngestionRuns({ provider: 'CMF XBRL', limit: 5 }).catch(() => ({ data: [] as Awaited<ReturnType<typeof getIngestionRuns>>['data'] })),
    getSourceTypeCoverage('xbrl').catch(() => []),
  ])
  const runs = runsResult.data
  const latestRun = runs[0] ?? null
  const coverageByTicker = new Map(coverage.map((c) => [c.ticker, c]))

  const enabledIssuers = Object.values(CMF_ISSUER_MAP).map((issuer) => {
    const cov = coverageByTicker.get(issuer.ticker)
    return {
      ticker: issuer.ticker,
      companyName: issuer.companyName,
      cmfIssuerName: issuer.cmfIssuerName,
      verificationStatus: issuer.verificationStatus ?? 'verified',
      verifiedAt: issuer.verifiedAt,
      // Coverage is absent (all null/0) until at least one ingestion run has written data for this issuer — never fabricated as "covered".
      periodCount: cov?.periodCount ?? 0,
      canonicalCount: cov?.canonicalCount ?? 0,
      lastFilingPeriod: cov?.latestPeriodLabel ?? null,
      lastFilingPeriodEnd: cov?.latestPeriodEnd ?? null,
    }
  })

  return NextResponse.json({
    source: 'CMF XBRL (Estados Financieros IFRS)',
    sourceType: 'xbrl',
    provider: 'cmf-xbrl',
    latestRun: latestRun
      ? {
          status: latestRun.status,
          jobType: latestRun.jobType,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
          rowsInserted: latestRun.rowsInserted,
          rowsFailed: latestRun.rowsFailed,
          errorMessage: latestRun.errorMessage,
        }
      : null,
    recentRuns: runs.map((r) => ({ status: r.status, jobType: r.jobType, startedAt: r.startedAt, rowsInserted: r.rowsInserted })),
    enabledIssuers,
    notConfiguredIssuers: Object.entries(UNMAPPED_TICKERS).map(([ticker, reason]) => ({ ticker, reason })),
    // Kept for backward compatibility with the Phase 8C.2 response shape.
    coverage,
    mappedIssuers: getMappedTickers(),
    unmappedIssuers: Object.entries(UNMAPPED_TICKERS).map(([ticker, reason]) => ({ ticker, reason })),
    note: 'Official CMF XBRL filing data. Automated ingestion runs are reviewable and manually triggered; not yet on an unattended cron schedule (issuer coverage is still narrow — see docs/cmf_xbrl_financials_ingestion.md). Manual CSV remains a fallback/override source.',
  })
}
