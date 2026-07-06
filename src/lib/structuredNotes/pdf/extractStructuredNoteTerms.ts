// Phase 9A — deterministic structured-note term extraction (Citi CGMFL family).
//
// Pure function: takes already-extracted per-page text (string[]) and returns a
// normalized note payload + per-field provenance/confidence. No PDF library, no
// Supabase, no OCR, no AI — regex/keyword anchoring against the known Citi
// "Memory Coupon Barrier Autocall" term-sheet layout (see
// docs/structured_notes_workbook_mapping.md §6 for the anchors).
//
// Scope: MVP for the sample Citi family. Other issuers/families will extract
// partially and be flagged for human review rather than silently mis-parsed.

import type {
  StructuredNote,
  StructuredNoteUnderlying,
  StructuredNoteObservation,
  ExtractedField,
  StructuredNoteExtractionResult,
  FieldConfidence,
} from '../types.ts'
import { frequencyToPeriodsPerYear, calculateBarrierLevel, calculateCouponAnnualized } from '../calculations.ts'
import { resolveUnderlyingSymbol } from '../underlyingSymbolMap.ts'

export const PARSER_VERSION = '9A.citi.1'

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

const NOISE = /Investment Products|PLEASE SEE THE DISCLAIMER|^Page \d+$/i

interface Line {
  text: string
  page: number
}

/** Flattens per-page text into page-tagged, noise-filtered, trimmed lines. */
function toLines(pages: string[]): Line[] {
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

/** "June 4, 2026" → "2026-06-04". Returns null if unparseable. */
export function parseTermSheetDate(raw: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(raw)
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase()]
  const day = Number(m[2])
  const year = Number(m[3])
  if (!month || !Number.isFinite(day) || !Number.isFinite(year) || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Parses a number that may contain thousands separators, e.g. "1,050,000" or "2927.000". */
function parseNum(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Parses "65.00%" → 0.65. */
function parsePct(raw: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(raw)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n / 100 : null
}

function mapIssuerDisplay(legal: string): string | null {
  const s = legal.toLowerCase()
  if (s.includes('citigroup') || s.includes('citi')) return 'Citi'
  if (s.includes('jpmorgan') || s.includes('j.p. morgan') || s.includes('jp morgan')) return 'JP Morgan'
  if (s.includes('barclays')) return 'Barclays'
  if (s.includes('bnp')) return 'BNP Paribas'
  if (s.includes('hsbc')) return 'HSBC'
  if (s.includes('bbva')) return 'BBVA'
  if (s.includes('credit agricole') || s.includes('crédit agricole')) return 'Crédit Agricole'
  if (s.includes('santander')) return 'Santander'
  return null
}

function field<T>(fieldPath: string, value: T | null, opts: Partial<ExtractedField<T>> = {}): ExtractedField<T> {
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

/** Finds the first line whose text starts with `label` and returns the remainder + page. */
function labelValue(lines: Line[], label: RegExp): { value: string; page: number } | null {
  for (const l of lines) {
    const m = label.exec(l.text)
    if (m) return { value: l.text.slice(m[0].length).trim(), page: l.page }
  }
  return null
}

export interface ExtractOptions {
  fileName?: string
}

export function extractStructuredNoteTerms(pages: string[], opts: ExtractOptions = {}): StructuredNoteExtractionResult {
  const lines = toLines(pages)
  const joined = lines.map((l) => l.text).join('\n')
  const fields: ExtractedField<unknown>[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const push = (f: ExtractedField<unknown>) => { fields.push(f); return f.value }

  // ── Identifiers ────────────────────────────────────────────────────────────
  const isinMatch = /\bISIN\s+(XS\d{10})\b/.exec(joined) ?? /\b(XS\d{10})\b/.exec(joined)
  const isin = isinMatch ? isinMatch[1] : null
  push(field('isin', isin, { rawExcerpt: isinMatch?.[0] ?? null, sourceSection: 'Additional Information', confidence: isin ? 'high' : 'low', warning: isin ? null : 'ISIN not found' }))

  const seriesMatch = /Series Number\s+([A-Z0-9]+)/.exec(joined)
  const seriesNumber = seriesMatch ? seriesMatch[1] : null
  push(field('seriesNumber', seriesNumber, { rawExcerpt: seriesMatch?.[0] ?? null, sourceSection: 'Additional Information' }))

  // ── Issuer / guarantor / product ─────────────────────────────────────────────
  const issuerLV = labelValue(lines, /^Issuer\s+/)
  const issuerName = issuerLV ? issuerLV.value.replace(/\s*\(.*$/, '').trim() : null
  push(field('issuerName', issuerName, { rawExcerpt: issuerLV?.value ?? null, sourcePage: issuerLV?.page ?? null, sourceSection: 'General Information', confidence: issuerName ? 'high' : 'low', warning: issuerName ? null : 'Issuer not found' }))
  const issuerDisplay = issuerName ? mapIssuerDisplay(issuerName) : null
  push(field('issuerDisplayName', issuerDisplay, { confidence: issuerDisplay ? 'high' : 'low', sourceSection: 'General Information', warning: issuerDisplay ? null : 'Issuer display name not mapped — review' }))

  const guarantorLV = labelValue(lines, /^Guarantor\s+/)
  const guarantorName = guarantorLV ? guarantorLV.value.replace(/\s*\(.*$/, '').trim() : null
  push(field('guarantorName', guarantorName, { rawExcerpt: guarantorLV?.value ?? null, sourcePage: guarantorLV?.page ?? null, sourceSection: 'General Information' }))

  const titleMatch = /([A-Z][A-Za-z0-9 ]*Notes Based Upon[^\n]*?Index)/.exec(joined)
  const productName = titleMatch ? titleMatch[1].replace(/\s*\(“Notes”\).*/, '').replace(/[®™]/g, '').trim() : null
  push(field('productName', productName, { rawExcerpt: titleMatch?.[0]?.slice(0, 120) ?? null, sourceSection: 'header', confidence: productName ? 'high' : 'low' }))

  // ── Amounts ─────────────────────────────────────────────────────────────────
  const issueSizeMatch = /Issue Size\s+([A-Z]{3})\s+([\d,]+)/.exec(joined)
  const currency = issueSizeMatch ? issueSizeMatch[1] : 'USD'
  const issueSize = issueSizeMatch ? parseNum(issueSizeMatch[2]) : null
  push(field('currency', currency, { rawExcerpt: issueSizeMatch?.[0] ?? null, sourceSection: 'General Information' }))
  push(field('issueSize', issueSize, { rawExcerpt: issueSizeMatch?.[0] ?? null, sourceSection: 'General Information' }))

  const denomMatch = /Specified Denomination\s+[A-Z]{3}\s+([\d,]+)/.exec(joined)
  const denomination = denomMatch ? parseNum(denomMatch[1]) : null
  push(field('denomination', denomination, { rawExcerpt: denomMatch?.[0] ?? null, sourceSection: 'General Information' }))

  const issuePriceMatch = /Issue Price\s+(\d+(?:\.\d+)?)\s*%/.exec(joined)
  const issuePricePct = issuePriceMatch ? Number(issuePriceMatch[1]) / 100 : null
  push(field('issuePricePct', issuePricePct, { rawExcerpt: issuePriceMatch?.[0] ?? null, sourceSection: 'General Information' }))

  // ── Dates (label→value pairs on same line) ───────────────────────────────────
  const tradeLV = labelValue(lines, /^Strike Date \/ Trade Date\s+/)
  const issueLV = labelValue(lines, /^Issue Date\s+/)
  const finalValLV = labelValue(lines, /^Final Valuation Date\s+/)
  const maturityLV = labelValue(lines, /^Maturity Date\s+/)
  const tradeDate = tradeLV ? parseTermSheetDate(tradeLV.value) : null
  const issueDate = issueLV ? parseTermSheetDate(issueLV.value) : null
  const finalValuationDate = finalValLV ? parseTermSheetDate(finalValLV.value) : null
  const maturityDate = maturityLV ? parseTermSheetDate(maturityLV.value) : null
  push(field('tradeDate', tradeDate, { rawExcerpt: tradeLV?.value ?? null, sourcePage: tradeLV?.page ?? null, sourceSection: 'General Information', confidence: tradeDate ? 'high' : 'low', warning: tradeDate ? null : 'Trade date not found' }))
  push(field('issueDate', issueDate, { rawExcerpt: issueLV?.value ?? null, sourcePage: issueLV?.page ?? null, sourceSection: 'General Information' }))
  push(field('finalValuationDate', finalValuationDate, { rawExcerpt: finalValLV?.value ?? null, sourcePage: finalValLV?.page ?? null, sourceSection: 'General Information' }))
  push(field('maturityDate', maturityDate, { rawExcerpt: maturityLV?.value ?? null, sourcePage: maturityLV?.page ?? null, sourceSection: 'General Information', confidence: maturityDate ? 'high' : 'low', warning: maturityDate ? null : 'Maturity date not found' }))

  // Sanity ordering check (non-fatal warning only).
  const order = [tradeDate, issueDate, finalValuationDate, maturityDate].filter(Boolean) as string[]
  for (let i = 1; i < order.length; i++) {
    if (Date.parse(order[i]) < Date.parse(order[i - 1])) { warnings.push('date sequence is not monotonic — review'); break }
  }

  // ── Coupon ────────────────────────────────────────────────────────────────────
  const couponPeriodicMatch = /(\d+(?:\.\d+)?)\s*%\s*per quarter/i.exec(joined)
  const couponRatePeriodic = couponPeriodicMatch ? Number(couponPeriodicMatch[1]) / 100 : null
  const couponAnnualMatch = /approximately\s+(\d+(?:\.\d+)?)\s*%\s*per annum/i.exec(joined)
  const couponFrequency = /per quarter/i.test(joined) ? 'quarterly' : /per annum|annually/i.test(joined) ? 'annual' : /semi-?annual/i.test(joined) ? 'semiannual' : null
  const periodsPerYear = frequencyToPeriodsPerYear(couponFrequency)
  const couponRateAnnualized = couponAnnualMatch
    ? Number(couponAnnualMatch[1]) / 100
    : calculateCouponAnnualized(couponRatePeriodic, periodsPerYear)
  push(field('couponFrequency', couponFrequency, { sourceSection: 'The Payout', confidence: couponFrequency ? 'high' : 'low' }))
  push(field('couponRatePeriodic', couponRatePeriodic, { rawExcerpt: couponPeriodicMatch?.[0] ?? null, sourceSection: 'The Payout', confidence: couponRatePeriodic ? 'high' : 'low', warning: couponRatePeriodic ? null : 'Coupon rate not found' }))
  push(field('couponRateAnnualized', couponRateAnnualized, { rawExcerpt: couponAnnualMatch?.[0] ?? null, sourceSection: 'The Payout', confidence: couponAnnualMatch ? 'high' : couponRateAnnualized ? 'medium' : 'low' }))

  // ── Barriers (note-level %) ──────────────────────────────────────────────────
  const kiPct = parsePct(/Knock-?In Barrier Level[^\n]*?(\d+(?:\.\d+)?\s*%)/i.exec(joined)?.[1] ?? '')
  const couponBarrierPct = parsePct(/Coupon Barrier Level[^\n]*?(\d+(?:\.\d+)?\s*%)/i.exec(joined)?.[1] ?? '')
  const autocallPct = parsePct(/Autocall Barrier Level[^\n]*?(\d+(?:\.\d+)?\s*%)/i.exec(joined)?.[1] ?? '')
  push(field('knockInBarrierPct', kiPct, { sourceSection: 'The Underlyings', confidence: kiPct ? 'high' : 'low', warning: kiPct ? null : 'Knock-in barrier not found' }))
  push(field('couponBarrierPct', couponBarrierPct, { sourceSection: 'The Underlyings', confidence: couponBarrierPct ? 'high' : 'low' }))
  push(field('autocallBarrierPct', autocallPct, { sourceSection: 'The Underlyings', confidence: autocallPct ? 'high' : 'low' }))

  // ── Underlyings (numeric data rows: initial strike knockIn coupon autocall) ──
  const underlyings: StructuredNoteUnderlying[] = []
  const numRowRe = /(\d[\d,]*\.\d+)\s+(\d[\d,]*\.\d+)\s+(\d[\d,]*\.\d+)\s+(\d[\d,]*\.\d+)\s+(\d[\d,]*\.\d+)\s*$/
  let mostRecentTicker: string | null = null
  const tickerRe = /\b([A-Z]{2,5})\s+Index\b/
  let uOrder = 0
  for (const l of lines) {
    const tk = tickerRe.exec(l.text)
    if (tk && /RTY|SPX|NDX|SX5E/.test(tk[1])) mostRecentTicker = `${tk[1]} Index`
    const nm = numRowRe.exec(l.text)
    if (nm) {
      uOrder += 1
      const [, initial, strike, ki, coupon, autocall] = nm
      const sourceTicker = mostRecentTicker
      const resolved = resolveUnderlyingSymbol(sourceTicker)
      underlyings.push({
        underlyingOrder: uOrder,
        underlyingName: sourceTicker ?? `Underlying ${uOrder}`,
        sourceTicker,
        bloombergTicker: sourceTicker,
        yahooSymbol: resolved?.yahooSymbol ?? null,
        assetClass: resolved?.assetClass ?? 'index',
        initialLevel: parseNum(initial),
        strikeLevel: parseNum(strike),
        knockInBarrierLevel: parseNum(ki),
        couponBarrierLevel: parseNum(coupon),
        autocallBarrierLevel: parseNum(autocall),
        knockInBarrierPct: kiPct,
        couponBarrierPct,
        autocallBarrierPct: autocallPct,
      })
      mostRecentTicker = null
    }
  }
  push(field('underlyings.count', String(underlyings.length), { sourceSection: 'The Underlyings', confidence: underlyings.length > 0 ? 'high' : 'low', warning: underlyings.length > 0 ? null : 'No underlyings extracted' }))
  // If barrier levels were only given as %, derive missing levels from strike × pct.
  for (const u of underlyings) {
    if (u.couponBarrierLevel === null) u.couponBarrierLevel = calculateBarrierLevel(u.strikeLevel ?? u.initialLevel, couponBarrierPct)
    if (u.knockInBarrierLevel === null) u.knockInBarrierLevel = calculateBarrierLevel(u.strikeLevel ?? u.initialLevel, kiPct)
    if (u.autocallBarrierLevel === null) u.autocallBarrierLevel = calculateBarrierLevel(u.strikeLevel ?? u.initialLevel, autocallPct)
  }

  // ── Schedules (coupon + autocall date-pair blocks) ───────────────────────────
  const observations: StructuredNoteObservation[] = []
  const datePairRe = /^([A-Za-z]+ \d{1,2}, \d{4})\s+([A-Za-z]+ \d{1,2}, \d{4})$/
  function collectPairs(headerRe: RegExp): { valuation: string; payment: string }[] {
    const idx = lines.findIndex((l) => headerRe.test(l.text))
    if (idx < 0) return []
    const pairs: { valuation: string; payment: string }[] = []
    for (let i = idx + 1; i < lines.length; i++) {
      const t = lines[i].text
      if (/^Final Valuation Date\s+Maturity Date$/i.test(t)) break
      const m = datePairRe.exec(t)
      if (m) {
        const v = parseTermSheetDate(m[1]); const p = parseTermSheetDate(m[2])
        if (v && p) pairs.push({ valuation: v, payment: p })
      } else if (pairs.length > 0) {
        break // schedule block ended
      }
    }
    return pairs
  }
  const couponPairs = collectPairs(/^Contingent Coupon Valuation Date\s+Contingent Coupon Payment Date$/i)
  const autocallPairs = collectPairs(/^Autocall Valuation Date\s+Mandatory Early Redemption Date$/i)

  couponPairs.forEach((pr, i) => observations.push({
    observationNumber: i + 1, observationType: 'coupon', valuationDate: pr.valuation, paymentDate: pr.payment,
    redemptionDate: null, couponDuePct: couponRatePeriodic, autocallBarrierPct: null, couponBarrierPct, status: 'scheduled',
  }))
  autocallPairs.forEach((pr, i) => observations.push({
    observationNumber: i + 1, observationType: 'autocall', valuationDate: pr.valuation, paymentDate: null,
    redemptionDate: pr.payment, couponDuePct: null, autocallBarrierPct: autocallPct, couponBarrierPct: null, status: 'scheduled',
  }))
  // Final observation from the note-level final valuation / maturity dates.
  if (finalValuationDate && maturityDate) {
    observations.push({
      observationNumber: couponPairs.length + 1, observationType: 'final', valuationDate: finalValuationDate,
      paymentDate: maturityDate, redemptionDate: maturityDate, couponDuePct: couponRatePeriodic,
      autocallBarrierPct: autocallPct, couponBarrierPct, status: 'scheduled',
    })
  }
  push(field('observations.count', String(observations.length), { sourceSection: 'Schedules', confidence: observations.length > 0 ? 'high' : 'low', warning: observations.length > 0 ? null : 'No observation schedule extracted' }))

  // ── Structure / payoff ───────────────────────────────────────────────────────
  const isWorstOf = /Worst Performing/i.test(joined)
  const isMemory = /Memory Coupon/i.test(joined)
  const isAutocall = /Autocall|Mandatory Early Redemption/i.test(joined)
  const structureType = [isWorstOf ? 'worst_of' : null, isMemory ? 'memory_coupon' : null, isAutocall ? 'autocall' : 'note']
    .filter(Boolean).join('_')
  const payoffType = /Barrier Event/i.test(joined) ? 'barrier_contingent' : null
  push(field('structureType', structureType, { sourceSection: 'title/payout', confidence: isAutocall ? 'high' : 'medium' }))

  // ── Assemble note payload ────────────────────────────────────────────────────
  const note: StructuredNote = {
    isin, productName: productName ?? (isin ? `Structured Note ${isin}` : 'Structured Note'),
    issuerName, issuerDisplayName: issuerDisplay, guarantorName,
    structureType: structureType || 'note', payoffType, currency,
    issueSize, denomination, issuePricePct,
    tradeDate, issueDate, initialValuationDate: tradeDate, finalValuationDate, maturityDate, redemptionDate: maturityDate,
    couponFrequency, couponRatePeriodic, couponRateAnnualized,
    memoryCoupon: isMemory, principalProtection: false,
    knockInBarrierPct: kiPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    status: 'draft', sourceType: 'pdf_extraction', sourceName: 'Term sheet (Citi CGMFL family)',
    sourceFileName: opts.fileName ?? null, confidenceScore: 0,
    underlyings, observations, allocations: [],
  }

  // ── Critical-field validation ────────────────────────────────────────────────
  const critical: [string, boolean][] = [
    ['ISIN', !!isin],
    ['issuer', !!issuerName],
    ['trade date', !!tradeDate],
    ['maturity date', !!maturityDate],
    ['underlyings', underlyings.length > 0],
    ['initial/strike levels', underlyings.length > 0 && underlyings.every((u) => u.initialLevel !== null || u.strikeLevel !== null)],
    ['barriers', kiPct !== null],
    ['coupon rate', couponRatePeriodic !== null || couponRateAnnualized !== null],
    ['observation schedule', observations.length > 0],
  ]
  for (const [name, ok] of critical) if (!ok) errors.push(`missing critical field: ${name}`)

  const fieldsSeen = fields.length
  const fieldsExtracted = fields.filter((f) => f.value !== null && f.value !== '' && f.value !== '0').length
  const fieldsLowConfidence = fields.filter((f) => f.confidence === 'low' && f.value !== null).length
  const criticalPresent = critical.filter(([, ok]) => ok).length
  const confidenceScore = Math.round((criticalPresent / critical.length) * 100) / 100
  note.confidenceScore = confidenceScore

  const rank: Record<FieldConfidence, number> = { high: 3, medium: 2, low: 1 }
  void rank // reserved for future weighting

  return {
    ok: errors.length === 0,
    parserVersion: PARSER_VERSION,
    note,
    fields,
    warnings,
    errors,
    fieldsSeen,
    fieldsExtracted,
    fieldsLowConfidence,
    confidenceScore,
  }
}
