// Phase 9B/9C — Structured Notes parser: shared utilities.
//
// Pure helpers reused by every issuer parser. Extending this file must never
// regress the Citi/HSBC generic parser — see `citiHsbcParser.ts` and its
// tests in `tests/structuredNotesPdfExtraction.test.ts`.

import type { ExtractedField, FieldConfidence, StructuredNoteObservation } from '../../types.ts'
import type { Line, ReviewState } from './types.ts'

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const NOISE = /Investment Products|PLEASE SEE THE DISCLAIMER|^Page \d+$|^\d+ \| \d+$/i

export function toLines(pages: string[]): Line[] {
  const out: Line[] = []
  pages.forEach((pageText, i) => {
    for (const raw of pageText.split('\n')) {
      const text = raw.replace(/\s+/g, ' ').trim()
      if (!text || NOISE.test(text)) continue
      out.push({ text, page: i + 1 })
    }
  })
  return out
}

/** Strips an ordinal suffix from a day number: "09th" -> "09", "5th" -> "5". */
export function normalizeOrdinalDate(raw: string): string {
  return raw.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1')
}

/**
 * Parses a date in any of the term-sheet formats seen across issuers:
 *   - "June 4, 2026"        (Month DD, YYYY — US style, Citi)
 *   - "April 09th, 2025"    (ordinal Month DDth, YYYY — BNP Paribas)
 *   - "04 Sep 2026"         (DD Mon YYYY — EU schedule tables, HSBC)
 *   - "5 January 2026"      (D Month YYYY, no ordinal — Barclays/BBVA/Crédit Agricole prose)
 *   - "03/06/2026"          (DD/MM/YYYY — EU general info; day-first)
 * Returns ISO "YYYY-MM-DD" or null. Ordinal suffixes are stripped first so
 * they never break the underlying Month/day parse.
 */
export function parseTermSheetDate(rawInput: string): string | null {
  const s = normalizeOrdinalDate(rawInput.trim())
  const iso = (y: number, m: number, d: number): string | null =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null

  // Month DD, YYYY
  let m = /([A-Za-z]{3,})\s+(\d{1,2}),\s+(\d{4})/.exec(s)
  if (m) { const mo = MONTHS[m[1].toLowerCase()]; return mo ? iso(Number(m[3]), mo, Number(m[2])) : null }

  // DD Mon YYYY / D Month YYYY (both share this shape once ordinals are stripped)
  m = /\b(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})\b/.exec(s)
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; return mo ? iso(Number(m[3]), mo, Number(m[1])) : null }

  // DD/MM/YYYY (day-first)
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s)
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]))

  return null
}

export function parseNum(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Elapsed time in (fractional) years between two ISO dates, simple ACT/365.25. Null on any bad input. */
export function yearsBetweenIsoDates(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null
  return (to - from) / (1000 * 60 * 60 * 24 * 365.25)
}

export function parsePct(raw: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(raw)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n / 100 : null
}

/** Extracts the first ISIN, accepting both "ISIN XS123..." and "ISIN: XS123..." / "ISIN Code : XS123...". */
export function extractIsin(joined: string): { isin: string | null; rawExcerpt: string | null } {
  const m = /\bISIN(?:\s+Code)?\s*:?\s+([A-Z]{2}\d{9,10})\b/i.exec(joined) ?? /\b([A-Z]{2}\d{10})\b/.exec(joined)
  return { isin: m ? m[1].toUpperCase() : null, rawExcerpt: m?.[0] ?? null }
}

/** Extracts a "CCY amount" pair, e.g. "USD 2,000,000" or "USD 2,000,000.00". */
export function extractCurrencyAmount(text: string, labelRe: RegExp): { currency: string | null; amount: number | null; rawExcerpt: string | null } {
  const m = labelRe.exec(text)
  if (!m) return { currency: null, amount: null, rawExcerpt: null }
  const ccyAmt = /([A-Z]{3})\s+([\d,]+(?:\.\d+)?)/.exec(m[0])
  if (!ccyAmt) return { currency: null, amount: null, rawExcerpt: m[0] }
  return { currency: ccyAmt[1], amount: parseNum(ccyAmt[2]), rawExcerpt: m[0] }
}

/** Extracts the first percentage occurring after a label, tolerant of extra words in between. */
export function extractPercentage(text: string, labelRe: RegExp): { pct: number | null; rawExcerpt: string | null } {
  const m = labelRe.exec(text)
  if (!m) return { pct: null, rawExcerpt: null }
  const pctMatch = /(-?\d+(?:\.\d+)?)\s*%/.exec(text.slice(m.index, m.index + m[0].length + 40))
  return { pct: pctMatch ? Number(pctMatch[1]) / 100 : null, rawExcerpt: m[0] }
}

export function field<T>(fieldPath: string, value: T | null, opts: Partial<ExtractedField<T>> = {}): ExtractedField<T> {
  return {
    fieldPath,
    value,
    rawExcerpt: opts.rawExcerpt ?? null,
    confidence: opts.confidence ?? (value !== null ? 'high' : 'low'),
    sourcePage: opts.sourcePage ?? null,
    sourceSection: opts.sourceSection ?? null,
    warning: opts.warning ?? null,
  }
}

/** First line matching one of the label regexes -> { value after the label, page }. */
export function labelValue(lines: Line[], labels: RegExp[]): { value: string; page: number } | null {
  for (const l of lines) {
    for (const label of labels) {
      const m = label.exec(l.text)
      if (m) return { value: l.text.slice(m[0].length).trim(), page: l.page }
    }
  }
  return null
}

/** First date found after any of the given label aliases (value may be on the same line). */
export function labelDate(lines: Line[], labels: RegExp[]): { iso: string; raw: string; page: number } | null {
  const lv = labelValue(lines, labels)
  if (!lv) return null
  const iso = parseTermSheetDate(lv.value)
  return iso ? { iso, raw: lv.value, page: lv.page } : null
}

/**
 * Builds a whitespace-tolerant regex from a plain-English label, so it still
 * matches when the source PDF's text extraction wraps the label mid-phrase
 * across physical lines (a real, observed artifact on several EU issuer
 * templates — e.g. BNP Paribas prints "Redemption Valuation" on one line and
 * "Date October 09th, 2026" on the next). Every internal word gap becomes
 * `\s+`, which matches the `joined` string's embedded newlines.
 */
export function buildLabelRegex(label: string, flags = 'i'): RegExp {
  const pattern = label.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  return new RegExp(pattern, flags)
}

/**
 * Finds `label` anywhere in `joined` (wrap-tolerant, see buildLabelRegex) and
 * returns the raw text immediately following it, up to `maxLen` characters —
 * for pulling a value out of a label that may not fit on one physical line.
 */
export function extractAfterLabel(joined: string, label: string, maxLen = 60): { value: string; rawExcerpt: string } | null {
  const m = buildLabelRegex(label).exec(joined)
  if (!m) return null
  const rest = joined.slice(m.index + m[0].length, m.index + m[0].length + maxLen)
  return { value: rest.trim(), rawExcerpt: (m[0] + rest).trim() }
}

/**
 * Wrap-tolerant counterpart to `labelDate` — searches the joined text, not
 * per-line. Tries EVERY occurrence of `label` in order and returns the first
 * one immediately followed by a parseable date — not just the first
 * occurrence. A label like "Final Observation Date" often also appears
 * earlier in explanatory prose ("...the performance of the Underlying on
 * Final Observation Date, the...") with no date attached; blindly taking the
 * first hit would silently fail to find the real data line further down the
 * document. This can only find MORE valid dates than a first-occurrence-only
 * search, never fewer, so it is a strict improvement for every existing caller.
 */
export function labelDateJoined(joined: string, label: string): { iso: string; raw: string } | null {
  const re = new RegExp(buildLabelRegex(label).source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(joined))) {
    const rest = joined.slice(m.index + m[0].length, m.index + m[0].length + 40).trim()
    const iso = parseTermSheetDate(rest)
    if (iso) return { iso, raw: rest }
    // Guard against a zero-width match looping forever (shouldn't occur for
    // a non-empty label, but exec() on a global regex can stall on one).
    if (m[0].length === 0) re.lastIndex += 1
  }
  return null
}

/** Maps a legal issuer/guarantor name to the app's short display name. Returns null if unrecognized. */
export function mapIssuerDisplay(legal: string): string | null {
  const s = legal.toLowerCase()
  if (s.includes('citigroup') || s.includes('citi')) return 'Citi'
  if (s.includes('jpmorgan') || s.includes('j.p. morgan') || s.includes('jp morgan')) return 'JP Morgan'
  if (s.includes('barclays')) return 'Barclays'
  if (s.includes('bnp')) return 'BNP Paribas'
  if (s.includes('hsbc')) return 'HSBC'
  if (s.includes('bbva')) return 'BBVA'
  if (s.includes('credit agricole') || s.includes('crédit agricole')) return 'Crédit Agricole'
  if (s.includes('santander')) return 'Santander'
  if (s.includes('marex')) return 'Marex'
  if (s.includes('goldman')) return 'Goldman Sachs'
  if (s.includes('morgan stanley')) return 'Morgan Stanley'
  if (s.includes('ubs')) return 'UBS'
  return null
}

/** Underlying tickers this app can recognize inline (Bloomberg-style short codes). */
export const KNOWN_TICKERS = ['SPX', 'RTY', 'NDX', 'SX5E', 'SPY', 'IWM']

/**
 * Parses a mixed ticker cell like:
 *   "S&P 500 Index (Bloomberg Screen: SPX Index; Refinitiv Screen: .SPX)"
 * Bloomberg is the source of truth for market-data mapping; the Refinitiv
 * code (if present) is returned only as metadata — never used as the
 * primary source ticker, per the Barclays parser rule.
 */
export function parseMixedTickerCell(cell: string): { name: string; bloombergTicker: string | null; refinitivCode: string | null } {
  const nameMatch = /^([^(]+)/.exec(cell)
  const name = nameMatch ? nameMatch[1].trim() : cell.trim()
  const bloomberg = /Bloomberg Screen:\s*([A-Z0-9]{2,6})\s*Index/i.exec(cell)
  const refinitiv = /Refinitiv Screen:\s*(\.[A-Z]{2,6})/i.exec(cell)
  return {
    name,
    bloombergTicker: bloomberg ? bloomberg[1].toUpperCase() : null,
    refinitivCode: refinitiv ? refinitiv[1].toUpperCase() : null,
  }
}

/**
 * Detects whether a table header line looks "compressed" — i.e. multiple
 * column labels run together with no reliable separator (a known PDF text-
 * extraction artifact, seen on BNP Paribas underlying tables). Used to
 * decide whether to trust a positional column split or fall back to a
 * lower-confidence, warning-flagged extraction instead of guessing a
 * column alignment that may not hold.
 */
export function detectCompressedTableHeaders(headerLine: string): boolean {
  // Heuristic: a run of 4+ capitalized words with no punctuation and no
  // digits, longer than ~50 chars, immediately followed by more column-like
  // words — a normal label ("Trade Date") is short; a compressed header row
  // ("Underlying Indices Initi Strike Level") mashes several together.
  const words = headerLine.trim().split(/\s+/)
  if (words.length < 5) return false
  const looksLikeRunOnHeader = /Initi(?:al)?\b.*Level/i.test(headerLine) || /\w{3,}i\b/.test(headerLine)
  return looksLikeRunOnHeader
}

export type BarrierRole = 'coupon' | 'autocall' | 'knock_in' | 'strike' | 'unknown'

/** Maps a raw barrier label (as printed on the term sheet) to its functional role. */
export function classifyBarrierRole(label: string): BarrierRole {
  const s = label.toLowerCase()
  if (/interest barrier|coupon barrier|coupon level/.test(s)) return 'coupon'
  if (/early redemption barrier|autocall barrier|autocall level/.test(s)) return 'autocall'
  if (/final redemption barrier|knock-?in barrier|knock-?in level|barrier level/.test(s)) return 'knock_in'
  if (/^strike$|strike price|strike level/.test(s)) return 'strike'
  return 'unknown'
}

/**
 * Generic schedule-pair extractor: scans lines after a header match for rows
 * of the shape `<index> <date> <date>`, ignoring stray single/double-digit
 * tokens that bleed in from page-break footnotes (a real artifact observed
 * in the Crédit Agricole and BBVA sample documents) by matching on the date
 * pair itself rather than trusting the leading index number.
 */
export function extractSchedulePairs(
  lines: Line[],
  headerRe: RegExp,
  stopRe: RegExp,
  datePairRe: RegExp,
): { valuation: string; payment: string }[] {
  const idx = lines.findIndex((l) => headerRe.test(l.text))
  if (idx < 0) return []
  const pairs: { valuation: string; payment: string }[] = []
  for (let i = idx + 1; i < lines.length; i++) {
    const t = lines[i].text
    if (stopRe.test(t)) break
    const m = datePairRe.exec(t)
    if (m) {
      const v = parseTermSheetDate(m[1])
      const p = parseTermSheetDate(m[2])
      if (v && p) pairs.push({ valuation: v, payment: p })
    } else if (pairs.length > 0) break
  }
  return pairs
}

/** Simple confidence-rank helper, kept for parity with the generic parser. */
export const CONFIDENCE_RANK: Record<FieldConfidence, number> = { high: 3, medium: 2, low: 1 }

/**
 * Classifies an extraction result into the UI-facing review bucket. Critical
 * fields missing (result.ok === false) is ALWAYS review-required — no
 * confidence score can override that. Otherwise a note with any low-
 * confidence field is capped at "review recommended", never "ready".
 */
export function classifyReviewState(ok: boolean, confidenceScore: number, fieldsLowConfidence: number, unsupported = false): ReviewState {
  if (unsupported) return 'unsupported'
  if (!ok) return 'review_required'
  if (fieldsLowConfidence === 0 && confidenceScore >= 0.9) return 'ready'
  if (confidenceScore >= 0.7) return 'review_recommended'
  return 'review_required'
}

/**
 * A coupon rate outside this range is never a real structured-note coupon —
 * it means a parser mistook a redemption/payout MULTIPLIER (principal +
 * premium, e.g. "113.70%" of notional) for the premium itself. Real
 * memory-coupon/autocall coupons observed across all issuer families in this
 * app are single-digit to low-double-digit % p.a.; 60% is a generous upper
 * bound that still catches a mixed-up multiplier (which is always >= 100%
 * once a principal component is bundled in) with margin to spare.
 */
export const MAX_PLAUSIBLE_ANNUALIZED_COUPON = 0.6
export const MIN_PLAUSIBLE_ANNUALIZED_COUPON = -0.6

/**
 * Sanity-checks an extracted annualized/periodic coupon rate against the
 * plausible range above. Returns a human-readable reason string when the
 * value is out of range (implausible), or null when it's fine or absent.
 * Never fabricates a "corrected" number — just flags it so the router can
 * force the note to review-required rather than trusting a parser bug (or a
 * genuinely malformed source document) at face value.
 */
export function checkCouponPlausibility(couponRateAnnualized: number | null, couponRatePeriodic: number | null): string | null {
  for (const [label, v] of [['annualized', couponRateAnnualized], ['periodic', couponRatePeriodic]] as const) {
    if (v === null || !Number.isFinite(v)) continue
    if (v > MAX_PLAUSIBLE_ANNUALIZED_COUPON || v < MIN_PLAUSIBLE_ANNUALIZED_COUPON) {
      return `implausible coupon rate: ${label} rate of ${(v * 100).toFixed(2)}% is outside the plausible ${(MIN_PLAUSIBLE_ANNUALIZED_COUPON * 100).toFixed(0)}% to ${(MAX_PLAUSIBLE_ANNUALIZED_COUPON * 100).toFixed(0)}% range — likely a redemption multiplier mistaken for a coupon, or a malformed source document; flagged for manual review`
    }
  }
  return null
}

/**
 * Collapses a persisted note's observations to one row per valuation date
 * (merging any legacy separate coupon/autocall rows) — used by the detail
 * page so already-imported notes show a single, non-double-counted schedule.
 */
export function dedupeObservationsByDate(observations: StructuredNoteObservation[]): StructuredNoteObservation[] {
  const byDate = new Map<string, StructuredNoteObservation>()
  for (const o of observations) {
    const existing = byDate.get(o.valuationDate)
    if (!existing) { byDate.set(o.valuationDate, { ...o }); continue }
    // Merge: keep the coupon/final row; fold in the autocall barrier + payment.
    const keep = o.observationType === 'autocall' ? existing : o
    const other = o.observationType === 'autocall' ? o : existing
    byDate.set(o.valuationDate, {
      ...keep,
      observationType: keep.observationType === 'autocall' ? 'coupon' : keep.observationType,
      paymentDate: keep.paymentDate ?? other.paymentDate ?? null,
      redemptionDate: keep.redemptionDate ?? other.redemptionDate ?? null,
      couponDuePct: keep.couponDuePct ?? other.couponDuePct,
      couponBarrierPct: keep.couponBarrierPct ?? other.couponBarrierPct,
      autocallBarrierPct: keep.autocallBarrierPct ?? other.autocallBarrierPct,
    })
  }
  return [...byDate.values()]
    .sort((a, b) => a.valuationDate.localeCompare(b.valuationDate))
    .map((o, i) => ({ ...o, observationNumber: i + 1 }))
}
