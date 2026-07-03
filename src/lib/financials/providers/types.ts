// Phase 8C.1 — source-agnostic financials provider abstraction.
//
// Manual CSV (Phase 8C) is one implementation of this interface, not the
// conceptual model. CMF/XBRL (this phase) is a second implementation. Any
// future vendor feed, broker feed, or document-ingestion pipeline should also
// implement this interface and normalize to the exact same
// `FinancialImportPayload` shape from src/lib/financials/csvFinancials.ts, so
// every provider ultimately calls the same financialsRepository.ts upsert
// functions — no duplicated repository logic, no provider-specific tables.

import type { FinancialImportPayload, SourceType } from '../csvFinancials.ts'

/** A reference to one discoverable filing, before it has been fetched. */
export interface FinancialFilingRef {
  ticker: string
  sourceType: SourceType
  /** Where this filing can be fetched from (URL, path, or provider-specific key). */
  locator: string
  fiscalYear: number | null
  fiscalPeriod: string | null
  periodType: string | null
  /** Human-readable description for logs (never includes secrets). */
  description: string
}

/** The raw bytes/text fetched for one filing, before parsing. */
export interface FinancialRawFiling {
  ref: FinancialFilingRef
  /** Raw file contents (e.g. XBRL/XML instance text) or a structured raw payload. */
  raw: string
  /** ISO timestamp the raw content was fetched. */
  fetchedAt: string
  /** Bare filename only (never a path) — becomes source_file. */
  sourceFile: string | null
  sourceUrl: string | null
}

/** A filing after provider-specific parsing, before normalization. */
export interface FinancialParsedFiling {
  ref: FinancialFilingRef
  /** Raw concept -> value facts, preserved for auditability even if unmapped. */
  facts: Record<string, unknown>
  /** Non-fatal parse warnings (e.g. unmapped concepts) — never thrown away silently. */
  warnings: string[]
}

export type FinancialProviderErrorCode =
  | 'issuer_not_mapped'
  | 'not_found'
  | 'network_error'
  | 'parse_error'
  | 'unstable_source'
  | 'not_implemented'

export interface FinancialProviderError {
  code: FinancialProviderErrorCode
  reason: string
  nextAction: string
}

export type FinancialProviderResult<T> = { ok: true; value: T } | { ok: false; error: FinancialProviderError }

export interface FinancialProviderCoverage {
  ticker: string
  mapped: boolean
  status: 'feasible_now' | 'feasible_with_mapping' | 'blocked' | 'needs_vendor' | 'unknown'
  notes: string
}

export interface FinancialsProvider {
  providerId: string
  providerName: string
  sourceType: SourceType

  /** Optional: list all companies this provider knows about (not always feasible). */
  discoverCompanies?(): Promise<FinancialProviderResult<FinancialProviderCoverage[]>>

  /** List discoverable filings for one ticker (e.g. one per fiscal year/period). */
  discoverFilings(ticker: string): Promise<FinancialProviderResult<FinancialFilingRef[]>>

  /** Fetch the raw content for one filing reference. */
  fetchFiling(ref: FinancialFilingRef): Promise<FinancialProviderResult<FinancialRawFiling>>

  /** Parse raw content into provider-specific facts. */
  parseFiling(raw: FinancialRawFiling): FinancialProviderResult<FinancialParsedFiling>

  /** Normalize parsed facts into the same payload shape manual CSV produces. */
  normalizeToFinancialImportPayload(parsed: FinancialParsedFiling): FinancialProviderResult<FinancialImportPayload>

  /** Validate a payload without writing (always safe, no admin client needed). */
  dryRunImport(payload: FinancialImportPayload): { valid: boolean; errorCount: number; summary: string }

  /** Write a payload via financialsRepository.ts upsert functions (admin client, --write only). */
  writeImport(
    payload: FinancialImportPayload,
    ingestionRunId?: string | null,
  ): Promise<FinancialProviderResult<{ rowsInserted: number; rowsFailed: number }>>
}
