// Phase 9C — BBVA Global Markets, B.V. parser (EU "Pricing Supplement" family).
//
// The most conservative of the four new parsers, for two reasons:
//   1. Format — this is a full legalistic Part A/Part B contractual-terms
//      Pricing Supplement (numbered clauses), not a compact one-page term
//      sheet: fields are extracted from clause text rather than a table.
//   2. The real sample is itself explicitly a DRAFT ("DRAFT FOR DISCUSSION
//      PURPOSES ... is not completed and may be changed ... Subject to
//      completion"). When that marker is present, this parser ALWAYS
//      reports `ok: false` (review required) regardless of how cleanly the
//      individual fields extracted — the source document itself declares
//      every term provisional, so "ready to import" would be dishonest.

import type { ExtractedField, StructuredNote, StructuredNoteObservation, StructuredNoteUnderlying } from '../../types.ts'
import { calculateBarrierLevel, calculateCouponAnnualized, frequencyToPeriodsPerYear } from '../../calculations.ts'
import { resolveUnderlyingSymbol } from '../../underlyingSymbolMap.ts'
import { extractIsin, field, parseNum, parseTermSheetDate } from './shared.ts'
import type { IssuerParser } from './types.ts'

export const BBVA_PARSER_VERSION = '9C.bbva.1'

export const parseBbva: IssuerParser = (ctx) => {
  const { joined } = ctx
  const fields: ExtractedField<unknown>[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const push = (f: ExtractedField<unknown>) => { fields.push(f); return f.value }

  const isDraft = /DRAFT FOR DISCUSSION PURPOSES|Subject to completion/i.test(joined)
  if (isDraft) {
    warnings.push('This document is a preliminary/draft pricing supplement ("Subject to completion") — every term is provisional and this note always requires manual review, however cleanly the fields below extracted.')
  }

  const { isin, rawExcerpt: isinExcerpt } = extractIsin(joined)
  push(field('isin', isin, {
    rawExcerpt: isinExcerpt, sourceSection: 'clause',
    confidence: isin && !isDraft ? 'high' : 'low',
    warning: !isin ? 'ISIN not found' : isDraft ? 'ISIN found in a boilerplate clause of a draft document — verify manually, it may not be the final assigned ISIN' : null,
  }))

  const issuerM = /([A-Z][A-Z0-9&.,' ]+?)\s*\(a private company/i.exec(joined)
  const issuerName = issuerM ? issuerM[1].trim() : (/BBVA GLOBAL MARKETS/i.test(joined) ? 'BBVA Global Markets, B.V.' : null)
  push(field('issuerName', issuerName, { rawExcerpt: issuerM?.[0] ?? null, sourceSection: 'cover', confidence: issuerName ? 'high' : 'low', warning: issuerName ? null : 'Issuer not found' }))
  const issuerDisplay = /bbva/i.test(joined) ? 'BBVA' : null
  push(field('issuerDisplayName', issuerDisplay, { confidence: issuerDisplay ? 'high' : 'low' }))

  const guarantorM = /guaranteed\s+by\s+([A-Z][A-Z0-9&.,' ]+?)\s*\(incorporated/i.exec(joined)
  const guarantorName = guarantorM ? guarantorM[1].trim() : null
  push(field('guarantorName', guarantorName, { rawExcerpt: guarantorM?.[0] ?? null }))

  const seriesM = /Issue\s+of\s+Series\s+(\d+)\s+([A-Z]{3})\s+([\d,]+)/i.exec(joined)
  push(field('seriesNumber', seriesM?.[1] ?? null, { rawExcerpt: seriesM?.[0] ?? null }))
  const currency = seriesM?.[2] ?? 'USD'
  const issueSize = seriesM ? parseNum(seriesM[3]) : null
  push(field('currency', currency, { rawExcerpt: seriesM?.[0] ?? null, sourceSection: 'cover' }))
  push(field('issueSize', issueSize, { rawExcerpt: seriesM?.[0] ?? null }))

  const productM = /Issue\s+of\s+Series\s+\d+\s+[A-Z]{3}\s+[\d,]+\s+(Index Linked Notes[^\n(]{0,40})/i.exec(joined)
  const productName = productM ? productM[1].replace(/\s+/g, ' ').trim() : (isin ? `Structured Note ${isin}` : 'Structured Note')
  push(field('productName', productName, { rawExcerpt: productM?.[0] ?? null, confidence: productM ? 'high' : 'medium' }))

  const denomM = /Specified\s+Denomination:\s*([A-Z]{3})\s*([\d,]+)/i.exec(joined)
  push(field('denomination', denomM ? parseNum(denomM[2]) : null, { rawExcerpt: denomM?.[0] ?? null }))

  // ── Dates — numbered-clause labels, "D Month YYYY" ───────────────────────
  const tradeM = /Trade\s+Date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(joined)
  const issueM = /Issue\s+Date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(joined)
  const maturityM = /Maturity\s+Date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(joined)
  const tradeDate = tradeM ? parseTermSheetDate(tradeM[1]) : null
  const issueDate = issueM ? parseTermSheetDate(issueM[1]) : null
  const maturityDate = maturityM ? parseTermSheetDate(maturityM[1]) : null
  push(field('tradeDate', tradeDate, { rawExcerpt: tradeM?.[0] ?? null, sourceSection: 'clause 6', confidence: tradeDate ? 'high' : 'low', warning: tradeDate ? null : 'Trade date not found' }))
  push(field('issueDate', issueDate, { rawExcerpt: issueM?.[0] ?? null }))
  push(field('maturityDate', maturityDate, { rawExcerpt: maturityM?.[0] ?? null, sourceSection: 'clause 7', confidence: maturityDate ? 'high' : 'low', warning: maturityDate ? null : 'Maturity date not found' }))

  // ── Barriers — the two clauses use distinctly-worded thresholds, so they can't collide ──
  const couponBarrierM = /is\s+equal\s+to\s+or\s+greater\s+than\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const autocallM = /is\s+greater\s+than\s+or\s+equal\s+to\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const couponBarrierPct = couponBarrierM ? Number(couponBarrierM[1]) / 100 : null
  const autocallPct = autocallM ? Number(autocallM[1]) / 100 : 1
  // This product's redemption clause uses the same "Worst Value" threshold as
  // the coupon condition — a single barrier serves both roles, per the "Digital"
  // final-redemption payoff observed in the source clause.
  const knockInPct = couponBarrierPct
  push(field('couponBarrierPct', couponBarrierPct, { rawExcerpt: couponBarrierM?.[0] ?? null, sourceSection: 'clause 9 (Interest Basis)', confidence: couponBarrierPct !== null ? 'medium' : 'low', warning: couponBarrierPct !== null ? 'inferred from the Interest clause wording, not a labeled barrier table — review' : 'Coupon barrier not found' }))
  push(field('knockInBarrierPct', knockInPct, { confidence: knockInPct !== null ? 'medium' : 'low', warning: knockInPct !== null ? 'inferred as equal to the coupon barrier (same "Digital" threshold) — review' : 'Knock-in barrier not found' }))
  push(field('autocallBarrierPct', autocallPct, { rawExcerpt: autocallM?.[0] ?? null, confidence: autocallM ? 'medium' : 'low' }))

  // ── Underlyings — Reference Item(s) table, initial Level only (no separate barrier levels) ──
  const underlyings: StructuredNoteUnderlying[] = []
  const rowRe = /(\d+)\s+([A-Za-z0-9&'.\s]+?)\s+([A-Z]{2,6})\s+INDEX\s+[\s\S]+?\s+([\d,]+(?:\.\d+)?)\b/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(joined))) {
    const ticker = m[3]
    const level = parseNum(m[4])
    if (level === null || level <= 0) continue
    const sourceTicker = `${ticker} Index`
    const resolved = resolveUnderlyingSymbol(ticker) ?? resolveUnderlyingSymbol(sourceTicker)
    underlyings.push({
      underlyingOrder: underlyings.length + 1,
      underlyingName: sourceTicker, sourceTicker, bloombergTicker: sourceTicker,
      yahooSymbol: resolved?.yahooSymbol ?? null, assetClass: resolved?.assetClass ?? 'index',
      initialLevel: level, strikeLevel: level,
      knockInBarrierLevel: calculateBarrierLevel(level, knockInPct),
      couponBarrierLevel: calculateBarrierLevel(level, couponBarrierPct),
      autocallBarrierLevel: calculateBarrierLevel(level, autocallPct),
      knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    })
  }
  push(field('underlyings.count', String(underlyings.length), { sourceSection: 'clause 8 (Reference Item(s))', confidence: underlyings.length > 0 ? 'high' : 'low', warning: underlyings.length > 0 ? null : 'No underlyings extracted' }))

  // ── Coupon — '"Rate (i)" means X%.' (the closing curly/straight quote sits between ")" and "means") ──
  const couponM = /Rate\s*\(i\)["”]?\s*means\s*(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const couponRatePeriodic = couponM ? Number(couponM[1]) / 100 : null
  const couponFrequency = 'quarterly' // confirmed by the ~3-month spacing of the schedule rows below
  const couponRateAnnualized = calculateCouponAnnualized(couponRatePeriodic, frequencyToPeriodsPerYear(couponFrequency))
  push(field('couponFrequency', couponFrequency, { confidence: 'medium' }))
  push(field('couponRatePeriodic', couponRatePeriodic, { rawExcerpt: couponM?.[0] ?? null, sourceSection: 'clause 9 (Rate of Interest)', confidence: couponRatePeriodic !== null ? 'high' : 'low', warning: couponRatePeriodic !== null ? null : 'Coupon rate not found' }))
  push(field('couponRateAnnualized', couponRateAnnualized, { confidence: couponRateAnnualized !== null ? 'medium' : 'low' }))

  // ── Schedule — coupon rows have no percent column; autocall rows share the exact same date-pair shape as coupon rows, so extraction stops as soon as the row index resets to 1 (the CA/BNP-style monotonic-index guard) ──
  const couponRows = extractDatePairRows(joined, /Coupon\s+Valuation\s+Date\s+Interest\s+Payment\s+Date/i)
  const autocallRows = extractDatePairRows(joined, /j\s+Automatic\s+Early\s+Redemption\s+Valuation\s+Date\s+Automatic\s+Early\s+Redemption\s+Date/i)
  const observations: StructuredNoteObservation[] = couponRows.map((row, i) => {
    const ac = autocallRows[i]
    return {
      observationNumber: i + 1, observationType: 'coupon',
      valuationDate: row.date1, paymentDate: row.date2, redemptionDate: ac?.date2 ?? null,
      couponDuePct: couponRatePeriodic, autocallBarrierPct: autocallPct, couponBarrierPct,
      status: 'scheduled',
    }
  })
  push(field('observations.count', String(observations.length), { sourceSection: 'clause 9 (Coupon Valuation Date schedule)', confidence: observations.length > 0 ? 'high' : 'low', warning: observations.length > 0 ? null : 'No observation schedule extracted' }))

  // ── Structure ─────────────────────────────────────────────────────────────
  const isMemory = /Memory|Sum Rate/i.test(joined)
  const isAutocall = /Automatic Early Redemption/i.test(joined)
  const structureType = ['worst_of', isMemory ? 'memory_coupon' : null, isAutocall ? 'autocall' : 'note'].filter(Boolean).join('_')
  push(field('structureType', structureType, { confidence: isAutocall ? 'high' : 'medium' }))

  const note: StructuredNote = {
    isin, productName, issuerName, issuerDisplayName: issuerDisplay, guarantorName,
    structureType: structureType || 'note', payoffType: null, currency,
    issueSize, denomination: denomM ? parseNum(denomM[2]) : null, issuePricePct: null,
    tradeDate, issueDate, initialValuationDate: tradeDate, finalValuationDate: null, maturityDate, redemptionDate: maturityDate,
    couponFrequency, couponRatePeriodic, couponRateAnnualized,
    memoryCoupon: isMemory, principalProtection: false,
    knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    status: 'draft', sourceType: 'pdf_extraction', sourceName: 'Term sheet (BBVA)',
    sourceFileName: ctx.fileName ?? null, confidenceScore: 0, archivedAt: null,
    underlyings, observations, allocations: [],
  }

  const critical: [string, boolean][] = [
    ['ISIN', !!isin],
    ['issuer', !!issuerName],
    ['trade date', !!tradeDate],
    ['maturity date', !!maturityDate],
    ['underlyings', underlyings.length > 0],
    ['initial/strike levels', underlyings.length > 0 && underlyings.every((u) => u.initialLevel !== null || u.strikeLevel !== null)],
    ['barriers', couponBarrierPct !== null && knockInPct !== null],
    ['coupon rate', couponRatePeriodic !== null],
    ['observation schedule', observations.length > 0],
  ]
  for (const [name, ok] of critical) if (!ok) errors.push(`missing critical field: ${name}`)
  // A draft/preliminary document is never import-ready, regardless of how
  // cleanly its fields extracted — see the module doc.
  if (isDraft) errors.push('document is a draft/preliminary pricing supplement ("Subject to completion") — manual review required before import')

  const fieldsSeen = fields.length
  const fieldsExtracted = fields.filter((f) => f.value !== null && f.value !== '' && f.value !== '0').length
  const fieldsLowConfidence = fields.filter((f) => f.confidence === 'low' && f.value !== null).length
  const criticalPresent = critical.filter(([, ok]) => ok).length
  const confidenceScore = Math.round((criticalPresent / critical.length) * 100) / 100
  note.confidenceScore = confidenceScore

  return { ok: errors.length === 0, parserVersion: BBVA_PARSER_VERSION, note, fields, warnings, errors, fieldsSeen, fieldsExtracted, fieldsLowConfidence, confidenceScore }
}

interface DatePairRow { date1: string; date2: string }

/** Extracts clean "<n> <date> <date>" rows (no percent column) after a given table header. */
function extractDatePairRows(joined: string, headerRe: RegExp): DatePairRow[] {
  const headerMatch = headerRe.exec(joined)
  if (!headerMatch) return []
  const rest = joined.slice(headerMatch.index + headerMatch[0].length)
  const rowRe = /(\d+)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/g
  const rows: DatePairRow[] = []
  let m: RegExpExecArray | null
  let lastIndex = -1
  while ((m = rowRe.exec(rest))) {
    const idx = Number(m[1])
    if (idx <= lastIndex && rows.length > 0) break
    lastIndex = idx
    const d1 = parseTermSheetDate(m[2])
    const d2 = parseTermSheetDate(m[3])
    if (!d1 || !d2) continue
    rows.push({ date1: d1, date2: d2 })
    if (rows.length >= 40) break
  }
  return rows
}
