// Phase 8C.7/8C.8 — pure, network-free bank-track coverage summary. Reused by
// both the status API route and the discovery CLI, mirroring how
// cmfCoverage.ts is the shared read-model over cmfIssuerMap.ts for the
// non-bank track. Live per-ticker persistence detail (period count, latest
// ingested release) is optionally overlaid by the caller — this module never
// makes a network/DB call itself.

import { BANK_REGISTRY, type BankRegistryEntry } from './bankRegistry.ts'
import { BANK_CONCEPT_MAP, BANK_KNOWN_UNMAPPED_CODES, mappedBankLineItems } from './bankConceptMap.ts'
import { CAPITAL_RATIO_FIELDS } from './bankStatementTypes.ts'
import { PILLAR3_DISCOVERY, type Pillar3DiscoveryResult } from './pillar3Discovery.ts'

/** Optional live persistence detail for one bank ticker, sourced from getSourceTypeCoverage('cmf_bank'). */
export interface BankLiveCoverage {
  periodCount: number
  canonicalCount: number
  latestPeriodLabel: string | null
  latestPeriodEnd: string | null
}

export interface BankCoverageEntry {
  ticker: string
  companyName: string
  cmfLegalName: string
  bankCode: string
  registryStatus: BankRegistryEntry['discoveryStatus']
  sourceType: 'cmf_bank'
  isXbrl: false
  mappedFieldCount: number
  mappedFields: string[]
  unmappedKnownGaps: string[]
  capitalRatiosAvailable: false
  yahooFallback: 'active'
  /** 'enabled' once at least one ingestion run has persisted a cmf_bank row for this ticker; 'not_enabled' otherwise. Never fabricated — absent live coverage means not_enabled. */
  productionIngestion: 'enabled' | 'not_enabled'
  /** Absent (all null/0) until at least one ingestion run has written data for this ticker. */
  periodCount: number
  canonicalCount: number
  latestIngestedRelease: string | null
  notes: string
  sourceUrl: string
  verifiedAt: string
}

export interface BankCoverageSummary {
  totalBanks: number
  bankTickers: string[]
  entries: BankCoverageEntry[]
  totalMappedAccountCodes: number
  totalKnownUnmappedGroups: number
  capitalRatioFieldsDeferred: string[]
  pillar3: Pillar3DiscoveryResult
  note: string
}

export function buildBankCoverageSummary(liveCoverage?: Record<string, BankLiveCoverage>): BankCoverageSummary {
  const mappedFields = mappedBankLineItems()
  const entries: BankCoverageEntry[] = Object.values(BANK_REGISTRY).map((entry) => {
    const live = liveCoverage?.[entry.ticker]
    return {
      ticker: entry.ticker,
      companyName: entry.companyName,
      cmfLegalName: entry.cmfLegalName,
      bankCode: entry.bankCode,
      registryStatus: entry.discoveryStatus,
      sourceType: 'cmf_bank',
      isXbrl: false,
      mappedFieldCount: mappedFields.length,
      mappedFields,
      unmappedKnownGaps: Object.keys(BANK_KNOWN_UNMAPPED_CODES),
      capitalRatiosAvailable: false,
      yahooFallback: 'active',
      productionIngestion: live && live.canonicalCount > 0 ? 'enabled' : 'not_enabled',
      periodCount: live?.periodCount ?? 0,
      canonicalCount: live?.canonicalCount ?? 0,
      latestIngestedRelease: live?.latestPeriodLabel ?? null,
      notes: entry.notes,
      sourceUrl: entry.sourceUrl,
      verifiedAt: entry.verifiedAt,
    }
  })

  return {
    totalBanks: entries.length,
    bankTickers: Object.keys(BANK_REGISTRY),
    entries,
    totalMappedAccountCodes: Object.keys(BANK_CONCEPT_MAP).length,
    totalKnownUnmappedGroups: Object.keys(BANK_KNOWN_UNMAPPED_CODES).length,
    capitalRatioFieldsDeferred: CAPITAL_RATIO_FIELDS,
    pillar3: PILLAR3_DISCOVERY,
    note:
      'A real, official, non-XBRL structured filing path was discovered in Phase 8C.7 (CMF\'s monthly "Balance y Estado de Situación Bancos" regulatory release) and a conservative 14-field account-code map was built. Phase 8C.8 enabled controlled production ingestion (source_type: cmf_bank, priority 180 — above yahoo_finance, below xbrl/cmf_fecu). Yahoo Finance remains the active fallback for bank quarterly/TTM/earlier-year/unmapped-field data. Capital/regulatory ratios (CET1, RWA, NPL, coverage) remain unavailable — see `pillar3` for why (CMF\'s Pillar 3 disclosure is a per-bank self-hosted PDF directory, not a structured official file).',
  }
}
