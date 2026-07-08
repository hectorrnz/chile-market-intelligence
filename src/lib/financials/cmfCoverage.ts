// Phase 8C.4 — CMF/XBRL coverage classification model.
//
// A pure, network-free classifier that assigns every app stock a single
// CMF/XBRL coverage status, so the status endpoint can expose the full
// coverage funnel (how many issuers are ingested, verified-but-deferred,
// bank-track, unsupported, etc.) rather than only the enabled set.
//
// This module is the read-model over the verified maps in cmfIssuerMap.ts —
// it never hits the network and never guesses. The authoritative RUT/identity
// evidence lives in cmfIssuerMap.ts; this file only classifies and counts.
//
// The discovery SWEEP that produces the evidence to update those maps is a
// separate CLI (scripts/discover/cmfCoverageSweep.ts) that DOES hit CMF's
// public directory — this classifier reflects the current known state.

import {
  CMF_ISSUER_MAP,
  UNMAPPED_TICKERS,
  UNSUPPORTED_XBRL_TICKERS,
} from './cmfIssuerMap.ts'

/**
 * The full coverage status set. Only a subset is currently populated by this
 * app's 25-stock universe; the rest are defined so the model can classify a
 * broader universe (and a future bank-track/foreign expansion) without a shape
 * change.
 */
export type CmfCoverageStatus =
  | 'enabled' // production-ingested
  | 'eligible_verified' // verified + dry-run clean, deferred
  | 'candidate_needs_review' // partial evidence, needs human review
  | 'not_configured' // no CMF mapping attempted yet
  | 'missing_rut' // legal identity found but no usable RUT
  | 'not_found_in_cmf_directory' // not present in CMF's issuer directory
  | 'no_xbrl_filing_found' // issuer valid but no XBRL filing for the period
  | 'taxonomy_only' // archive had only taxonomy, no instance
  | 'unsupported_page_shape' // real filing, but parser can't extract this dialect
  | 'bank_track_required' // bank — needs the separate CMF banking track
  | 'bank_track_discovered' // bank filing path found, mapping pending
  | 'bank_xbrl_mapping_required' // bank XBRL exists, needs bank-specific mapping
  | 'foreign_or_not_cmf_eligible' // non-Chile security, no CMF filing
  | 'etf_or_index_not_cmf_eligible' // ETF/index, no CMF issuer filing
  | 'inactive_or_delisted'
  | 'unsupported_security_type'
  | 'review_required'

/** Coverage groups that mean "an automated XBRL filing is or could be persisted". */
export const INGESTED_STATUSES: CmfCoverageStatus[] = ['enabled']
export const VERIFIED_STATUSES: CmfCoverageStatus[] = ['enabled', 'eligible_verified']

export interface CoverageClassification {
  ticker: string
  status: CmfCoverageStatus
  /** RUT (sin dígito verificador) when known from a verified mapping. */
  rut: string | null
  registryGroup: 'RVEMI' | null
  cmfIssuerName: string | null
  /** Human-readable reason/evidence — never a secret, never a guess. */
  reason: string
}

export interface CmfCoverageReport {
  totalScanned: number
  counts: Record<CmfCoverageStatus, number>
  byStatus: Record<string, string[]> // status → tickers (only non-empty groups)
  classifications: CoverageClassification[]
}

/** Sector labels (from companies.json) that indicate a Chilean bank. */
const BANK_SECTORS = new Set(['Banking', 'Banks', 'Bank'])

/**
 * Classify a single app ticker. Consults the verified maps in cmfIssuerMap.ts
 * in priority order (enabled/eligible → bank → unsupported dialect), then falls
 * back to a sector-informed default for anything not yet researched.
 */
export function classifyTickerCoverage(ticker: string, sector?: string | null): CoverageClassification {
  const t = ticker.toUpperCase()

  const issuer = CMF_ISSUER_MAP[t]
  if (issuer) {
    return {
      ticker: t,
      status: issuer.coverageStatus, // 'enabled' | 'eligible_verified'
      rut: issuer.rut,
      registryGroup: issuer.registryGroup,
      cmfIssuerName: issuer.cmfIssuerName,
      reason: issuer.notes,
    }
  }

  if (t in UNMAPPED_TICKERS) {
    return {
      ticker: t,
      status: 'bank_track_required',
      rut: null,
      registryGroup: null,
      cmfIssuerName: null,
      reason: UNMAPPED_TICKERS[t],
    }
  }

  if (t in UNSUPPORTED_XBRL_TICKERS) {
    return {
      ticker: t,
      status: 'unsupported_page_shape',
      rut: null,
      registryGroup: null,
      cmfIssuerName: null,
      reason: UNSUPPORTED_XBRL_TICKERS[t],
    }
  }

  // Not yet researched. Give a sector-informed default so an unclassified bank
  // is never silently treated as a plain not_configured industrial candidate.
  if (sector && BANK_SECTORS.has(sector)) {
    return {
      ticker: t,
      status: 'bank_track_required',
      rut: null,
      registryGroup: null,
      cmfIssuerName: null,
      reason: 'Bank sector — not researched against the securities-issuer XBRL directory; banks report under CMF\'s separate banking track. Do not guess a RUT.',
    }
  }

  return {
    ticker: t,
    status: 'not_configured',
    rut: null,
    registryGroup: null,
    cmfIssuerName: null,
    reason: 'Not yet researched against CMF\'s issuer directory. Run the coverage sweep (scripts/discover/cmfCoverageSweep.ts) and verify before enabling.',
  }
}

function emptyCounts(): Record<CmfCoverageStatus, number> {
  return {
    enabled: 0,
    eligible_verified: 0,
    candidate_needs_review: 0,
    not_configured: 0,
    missing_rut: 0,
    not_found_in_cmf_directory: 0,
    no_xbrl_filing_found: 0,
    taxonomy_only: 0,
    unsupported_page_shape: 0,
    bank_track_required: 0,
    bank_track_discovered: 0,
    bank_xbrl_mapping_required: 0,
    foreign_or_not_cmf_eligible: 0,
    etf_or_index_not_cmf_eligible: 0,
    inactive_or_delisted: 0,
    unsupported_security_type: 0,
    review_required: 0,
  }
}

/**
 * Build the full coverage funnel over a set of app tickers. Pure — the caller
 * supplies the app universe (ticker + sector) so this stays testable and free
 * of any data-layer import.
 */
export function buildCmfCoverageReport(appTickers: { ticker: string; sector?: string | null }[]): CmfCoverageReport {
  const classifications = appTickers.map((c) => classifyTickerCoverage(c.ticker, c.sector))
  const counts = emptyCounts()
  const byStatus: Record<string, string[]> = {}
  for (const c of classifications) {
    counts[c.status] += 1
    ;(byStatus[c.status] ??= []).push(c.ticker)
  }
  return {
    totalScanned: classifications.length,
    counts,
    byStatus,
    classifications,
  }
}
