// Phase 9A — Structured Notes domain types.
//
// Pure type declarations only (no runtime imports) — safe to import anywhere,
// including client components and plain `node --test`.

export type NoteStatus = 'active' | 'autocalled' | 'matured' | 'defaulted' | 'cancelled' | 'draft'

/** The in-house sociedades the book is split across (workbook rows R42–R50). */
export const DEFAULT_ENTITIES = [
  'Watermill', 'Dubai', 'Staten', 'La Esperanza', 'Naidelt',
  'Los Sauzales', 'Retboy', 'Los Laureles', 'Vanglor',
] as const

/** A note is "archived" (off the live book) when it has been called or has ended. */
export const ARCHIVED_STATUSES: NoteStatus[] = ['autocalled', 'matured', 'cancelled', 'defaulted']
export type NoteSourceType = 'pdf_extraction' | 'manual' | 'vendor_feed' | 'import'
export type ObservationType = 'coupon' | 'autocall' | 'final'
export type ObservationStatus =
  | 'scheduled'
  | 'observed'
  | 'coupon_paid'
  | 'coupon_missed'
  | 'autocalled'
  | 'matured'
  | 'cancelled'
export type AssetClass = 'index' | 'etf' | 'equity' | 'fund' | 'other'
export type FieldConfidence = 'high' | 'medium' | 'low'

/** Live/computed risk classification for a note as of a valuation date. */
export type RiskStatus =
  | 'safe' // all underlyings comfortably above coupon barrier
  | 'watch' // at least one underlying within the watch band above coupon barrier
  | 'breached' // at least one underlying at/below its knock-in/coupon barrier
  | 'autocallable' // all underlyings at/above autocall barrier (would autocall on next date)
  | 'unavailable' // insufficient market data to classify — never a fake status

export interface StructuredNoteUnderlying {
  id?: string
  underlyingOrder: number
  underlyingName: string
  sourceTicker: string | null
  bloombergTicker: string | null
  yahooSymbol: string | null
  assetClass: AssetClass
  initialLevel: number | null
  strikeLevel: number | null
  knockInBarrierLevel: number | null
  couponBarrierLevel: number | null
  autocallBarrierLevel: number | null
  knockInBarrierPct: number | null
  couponBarrierPct: number | null
  autocallBarrierPct: number | null
}

export interface StructuredNoteObservation {
  id?: string
  observationNumber: number
  observationType: ObservationType
  valuationDate: string // ISO yyyy-mm-dd
  paymentDate: string | null
  redemptionDate: string | null
  couponDuePct: number | null
  autocallBarrierPct: number | null
  couponBarrierPct: number | null
  status: ObservationStatus
}

export interface StructuredNoteAllocation {
  id?: string
  entityName: string
  custodian: string | null
  notionalAmount: number
  currency: string
  active: boolean
}

export interface StructuredNote {
  id?: string
  isin: string | null
  productName: string
  issuerName: string | null
  issuerDisplayName: string | null
  guarantorName: string | null
  structureType: string
  payoffType: string | null
  currency: string
  issueSize: number | null
  denomination: number | null
  issuePricePct: number | null
  tradeDate: string | null
  issueDate: string | null
  initialValuationDate: string | null
  finalValuationDate: string | null
  maturityDate: string | null
  redemptionDate: string | null
  couponFrequency: string | null
  couponRatePeriodic: number | null
  couponRateAnnualized: number | null
  memoryCoupon: boolean
  principalProtection: boolean
  knockInBarrierPct: number | null
  couponBarrierPct: number | null
  autocallBarrierPct: number | null
  status: NoteStatus
  sourceType: NoteSourceType
  sourceName: string | null
  sourceFileName: string | null
  confidenceScore: number | null
  /** ISO timestamp the note was marked Called/archived by a user. Null while live. */
  archivedAt: string | null
  underlyings: StructuredNoteUnderlying[]
  observations: StructuredNoteObservation[]
  allocations: StructuredNoteAllocation[]
}

/** A current price for one underlying, from the market provider. */
export interface UnderlyingPrice {
  underlyingOrder: number
  yahooSymbol: string | null
  price: number | null
  source: string // e.g. 'yahoo-finance' | 'persisted' | 'unavailable'
  sourceSymbol: string | null
  asOf: string | null // ISO timestamp, null if unavailable
}

// ── PDF extraction result shapes ─────────────────────────────────────────────

export interface ExtractedField<T = string> {
  fieldPath: string
  value: T | null
  rawExcerpt: string | null
  confidence: FieldConfidence
  sourcePage: number | null
  sourceSection: string | null
  warning: string | null
}

export interface StructuredNoteExtractionResult {
  ok: boolean
  parserVersion: string
  /** The normalized note payload, ready for review-then-import. Never persisted directly on a failed extraction. */
  note: StructuredNote | null
  fields: ExtractedField<unknown>[]
  warnings: string[]
  errors: string[]
  fieldsSeen: number
  fieldsExtracted: number
  fieldsLowConfidence: number
  confidenceScore: number
}
