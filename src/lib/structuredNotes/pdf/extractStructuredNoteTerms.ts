// Phase 9A/9B/9C — deterministic structured-note term extraction, multi-issuer.
//
// Pure function: takes already-extracted per-page text (string[]) and returns
// a normalized note payload + per-field provenance/confidence. No PDF
// library, no Supabase, no OCR, no AI.
//
// This module is now a thin entry point over the issuer-parser router in
// `pdf/parsers/`. It detects the issuer from the document and dispatches to
// the matching parser (Citi/HSBC generic, Crédit Agricole, BNP Paribas,
// Barclays, or BBVA) — see `pdf/parsers/index.ts` for the router and
// `docs/structured_notes_workbook_mapping.md` for each issuer's format notes.
// An unrecognized issuer safely falls back to the generic parser, which
// already requires every critical field before reporting `ok: true`.

import { extractWithRouter } from './parsers/index.ts'
import { parseTermSheetDate as parseTermSheetDateShared, dedupeObservationsByDate as dedupeObservationsByDateShared } from './parsers/shared.ts'
import type { StructuredNoteObservation, StructuredNoteExtractionResult } from '../types.ts'

/** @deprecated kept for backward compatibility with existing imports/tests — prefer reading `result.parserVersion`, which reflects the specific issuer parser that ran. */
export const PARSER_VERSION = '9C.router.1'

export const parseTermSheetDate = parseTermSheetDateShared

export interface ExtractOptions {
  fileName?: string
}

export function extractStructuredNoteTerms(pages: string[], opts: ExtractOptions = {}): StructuredNoteExtractionResult {
  const { result } = extractWithRouter(pages, opts)
  return result
}

/**
 * Collapses a persisted note's observations to one row per valuation date
 * (merging any legacy separate coupon/autocall rows) — used by the detail page
 * so already-imported notes show a single, non-double-counted schedule.
 */
export function dedupeObservationsByDate(observations: StructuredNoteObservation[]): StructuredNoteObservation[] {
  return dedupeObservationsByDateShared(observations)
}
