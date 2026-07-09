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
import {
  CMF_ISSUER_MAP,
  UNMAPPED_TICKERS,
  getMappedTickers,
  getEnabledTickers,
  getEligibleVerifiedTickers,
} from '@/lib/financials/cmfIssuerMap'
import { buildCmfCoverageReport } from '@/lib/financials/cmfCoverage'
import { getAllCompanies } from '@/lib/data/companies'
import { buildBankCoverageSummary } from '@/lib/financials/banks/bankCoverageStatus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const [runsResult, coverage, bankRunsResult, bankCoverage] = await Promise.all([
    getIngestionRuns({ provider: 'CMF XBRL', limit: 5 }).catch(() => ({ data: [] as Awaited<ReturnType<typeof getIngestionRuns>>['data'] })),
    getSourceTypeCoverage('xbrl').catch(() => []),
    getIngestionRuns({ provider: 'CMF Bank Financials', limit: 5 }).catch(() => ({ data: [] as Awaited<ReturnType<typeof getIngestionRuns>>['data'] })),
    getSourceTypeCoverage('cmf_bank').catch(() => []),
  ])
  const runs = runsResult.data
  const latestRun = runs[0] ?? null
  const coverageByTicker = new Map(coverage.map((c) => [c.ticker, c]))
  const bankRuns = bankRunsResult.data
  const latestBankRun = bankRuns[0] ?? null
  const bankLiveCoverage = Object.fromEntries(
    bankCoverage.map((c) => [c.ticker, { periodCount: c.periodCount, canonicalCount: c.canonicalCount, latestPeriodLabel: c.latestPeriodLabel, latestPeriodEnd: c.latestPeriodEnd }]),
  )

  // Per-issuer detail for every mapped issuer (enabled + eligible_verified).
  const mappedIssuerDetail = Object.values(CMF_ISSUER_MAP).map((issuer) => {
    const cov = coverageByTicker.get(issuer.ticker)
    return {
      ticker: issuer.ticker,
      companyName: issuer.companyName,
      cmfIssuerName: issuer.cmfIssuerName,
      registryGroup: issuer.registryGroup,
      coverageStatus: issuer.coverageStatus, // 'enabled' | 'eligible_verified'
      verificationStatus: issuer.verificationStatus ?? 'verified',
      verifiedAt: issuer.verifiedAt,
      // Coverage is absent (all null/0) until at least one ingestion run has written data for this issuer — never fabricated as "covered".
      periodCount: cov?.periodCount ?? 0,
      canonicalCount: cov?.canonicalCount ?? 0,
      lastFilingPeriod: cov?.latestPeriodLabel ?? null,
      lastFilingPeriodEnd: cov?.latestPeriodEnd ?? null,
    }
  })
  // `enabledIssuers` (production-write set) kept as the primary list for
  // backward compatibility with the Phase 8C.3 response shape.
  const enabledIssuers = mappedIssuerDetail.filter((i) => i.coverageStatus === 'enabled')
  const eligibleVerifiedIssuers = mappedIssuerDetail.filter((i) => i.coverageStatus === 'eligible_verified')

  // Full coverage funnel over the entire app stock universe (Phase 8C.4).
  const coverageReport = buildCmfCoverageReport(
    getAllCompanies().map((c) => ({ ticker: c.ticker, sector: c.sector })),
  )

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
    // ── Coverage summary (Phase 8C.4) ──
    enabledIssuers, // production-write set (coverageStatus === 'enabled')
    eligibleVerifiedIssuers, // verified + dry-run clean, deferred (not production-written)
    notConfiguredIssuers: Object.entries(UNMAPPED_TICKERS).map(([ticker, reason]) => ({ ticker, reason })), // banks (bank_track_required)
    coverageFunnel: {
      totalStocksScanned: coverageReport.totalScanned,
      enabledCount: getEnabledTickers().length,
      eligibleVerifiedCount: getEligibleVerifiedTickers().length,
      counts: coverageReport.counts,
      byStatus: coverageReport.byStatus,
      classifications: coverageReport.classifications.map((c) => ({
        ticker: c.ticker,
        status: c.status,
        rut: c.rut,
        registryGroup: c.registryGroup,
        cmfIssuerName: c.cmfIssuerName,
        reason: c.reason,
      })),
    },
    // Kept for backward compatibility with the Phase 8C.2/8C.3 response shape.
    coverage,
    mappedIssuers: getMappedTickers(),
    unmappedIssuers: Object.entries(UNMAPPED_TICKERS).map(([ticker, reason]) => ({ ticker, reason })),
    // ── Bank track diagnostics (Phase 8C.7 discovery, Phase 8C.8 controlled
    // production ingestion) ── A real, official, non-XBRL structured filing
    // path was discovered for the 4 bank tickers (CMF's monthly "Balance y
    // Estado de Situación Bancos" regulatory release) with a conservative
    // 14-field account-code map. Never mixed into the industrial
    // coverageFunnel above (banks stay bank_track_required there — this is a
    // separate source_type, cmf_bank, not xbrl).
    bankTrack: {
      ...buildBankCoverageSummary(bankLiveCoverage),
      latestIngestionRun: latestBankRun
        ? { status: latestBankRun.status, jobType: latestBankRun.jobType, startedAt: latestBankRun.startedAt, finishedAt: latestBankRun.finishedAt, rowsInserted: latestBankRun.rowsInserted, rowsFailed: latestBankRun.rowsFailed }
        : null,
    },
    note: 'Official CMF XBRL filing data. Automated ingestion runs are reviewable and manually triggered; not on an unattended cron schedule (coverage is still expanding — see docs/cmf_xbrl_financials_ingestion.md). Banks (bank_track_required) report under CMF\'s separate banking track and are not ingestible through this securities-issuer pipeline; see bankTrack for the separate bank discovery/mapping status (docs/bank_financials_ingestion.md). Manual CSV remains a fallback/override source.',
  })
}
