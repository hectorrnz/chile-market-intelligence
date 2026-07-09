// Phase 8C.7 — pure, network-free bank-track coverage summary. Reused by both
// the status API route and the discovery CLI, mirroring how cmfCoverage.ts
// is the shared read-model over cmfIssuerMap.ts for the non-bank track.

import { BANK_REGISTRY, type BankRegistryEntry } from './bankRegistry.ts'
import { BANK_CONCEPT_MAP, BANK_KNOWN_UNMAPPED_CODES, mappedBankLineItems } from './bankConceptMap.ts'
import { CAPITAL_RATIO_FIELDS } from './bankStatementTypes.ts'

export interface BankCoverageEntry {
  ticker: string
  companyName: string
  cmfLegalName: string
  bankCode: string
  registryStatus: BankRegistryEntry['discoveryStatus']
  isXbrl: false
  mappedFieldCount: number
  mappedFields: string[]
  unmappedKnownGaps: string[]
  capitalRatiosAvailable: false
  yahooFallback: 'active'
  productionIngestion: 'not_enabled'
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
  note: string
}

export function buildBankCoverageSummary(): BankCoverageSummary {
  const mappedFields = mappedBankLineItems()
  const entries: BankCoverageEntry[] = Object.values(BANK_REGISTRY).map((entry) => ({
    ticker: entry.ticker,
    companyName: entry.companyName,
    cmfLegalName: entry.cmfLegalName,
    bankCode: entry.bankCode,
    registryStatus: entry.discoveryStatus,
    isXbrl: false,
    mappedFieldCount: mappedFields.length,
    mappedFields,
    unmappedKnownGaps: Object.keys(BANK_KNOWN_UNMAPPED_CODES),
    capitalRatiosAvailable: false,
    yahooFallback: 'active',
    productionIngestion: 'not_enabled',
    notes: entry.notes,
    sourceUrl: entry.sourceUrl,
    verifiedAt: entry.verifiedAt,
  }))

  return {
    totalBanks: entries.length,
    bankTickers: Object.keys(BANK_REGISTRY),
    entries,
    totalMappedAccountCodes: Object.keys(BANK_CONCEPT_MAP).length,
    totalKnownUnmappedGroups: Object.keys(BANK_KNOWN_UNMAPPED_CODES).length,
    capitalRatioFieldsDeferred: CAPITAL_RATIO_FIELDS,
    note:
      'A real, official, non-XBRL structured filing path was discovered in Phase 8C.7 (CMF\'s monthly "Balance y Estado de Situación Bancos" regulatory release) and a conservative account-code map + dry-run parser were built. Production ingestion is NOT enabled — Yahoo Finance remains the active (unofficial) fallback for all 4 bank tickers until a human reviews mapping coverage and a migration adds cmf_bank as a source_type.',
  }
}
