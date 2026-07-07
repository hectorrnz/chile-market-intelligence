// Phase 9C — Structured Notes multi-issuer parser: shared contracts.
//
// Every issuer parser (Citi/HSBC generic, Crédit Agricole, BNP Paribas,
// Barclays, BBVA) implements the same `IssuerParser` signature and returns
// the same `StructuredNoteExtractionResult` shape defined in `../../types.ts`.
// The router in `index.ts` detects the issuer and dispatches to the matching
// parser — it never guesses; an undetected issuer falls back to the generic
// parser, which is safe because it already requires every critical field to
// be present before it will report `ok: true`.

import type { StructuredNoteExtractionResult } from '../../types.ts'

export interface Line {
  text: string
  page: number
}

export interface IssuerParseContext {
  lines: Line[]
  joined: string
  fileName?: string
}

export type IssuerParser = (ctx: IssuerParseContext) => StructuredNoteExtractionResult

/** Identifiers the router can detect from issuer/guarantor keywords in the document. */
export type DetectedIssuer = 'credit_agricole' | 'bnp_paribas' | 'barclays' | 'bbva' | 'generic'

/** UI-facing bucket for the review workflow (never a blanket "success"/"fail"). */
export type ReviewState = 'ready' | 'review_recommended' | 'review_required' | 'unsupported'
