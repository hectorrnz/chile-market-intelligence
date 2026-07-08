// Phase 8C.2 — CMF/XBRL financials ingestion status (public read-only).
//
// GET /api/financials/cmf-xbrl/status
//
// Read-only diagnostics, consistent with the app's other public
// ingestion-status endpoints (/api/health/ingestion, /api/macro/ingestion-status,
// /api/market/ingestion-status). Exposes only aggregate run/coverage info —
// never secrets, never raw XBRL fact payloads, never a source URL token.
//
// Surfaces: latest CMF/XBRL ingestion run, per-issuer XBRL coverage (period
// counts + latest period), the mapped issuer list, and the documented
// unmapped-issuer reasons.

import { NextResponse } from 'next/server'
import { getIngestionRuns } from '@/lib/db/repositories/ingestionRunsRepository'
import { getSourceTypeCoverage } from '@/lib/db/repositories/financialsRepository'
import { getMappedTickers, UNMAPPED_TICKERS } from '@/lib/financials/cmfIssuerMap'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const [runsResult, coverage] = await Promise.all([
    getIngestionRuns({ provider: 'CMF XBRL', limit: 5 }).catch(() => ({ data: [] as Awaited<ReturnType<typeof getIngestionRuns>>['data'] })),
    getSourceTypeCoverage('xbrl').catch(() => []),
  ])
  const runs = runsResult.data
  const latestRun = runs[0] ?? null

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
    coverage,
    mappedIssuers: getMappedTickers(),
    unmappedIssuers: Object.entries(UNMAPPED_TICKERS).map(([ticker, reason]) => ({ ticker, reason })),
    note: 'Official CMF XBRL filing data. Automated ingestion runs are reviewable and manually triggered; not yet on an unattended cron schedule. Manual CSV remains a fallback/override source.',
  })
}
