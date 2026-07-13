// Santander parser ("Autocallable Memory Coupon Phoenix Index Basket" family).
//
// Distinctive format vs the other issuer parsers:
//   - Labels use "ISIN Code" (extractIsin already handles this alias).
//   - The underlying table gives only ONE absolute level per row (Initial
//     Level) — barriers are stated once, note-level, as plain-English
//     "<Label> means <N>%" clauses ("Coupon Barrier Level means 65%", "AER
//     Level means 100%", "Redemption Barrier Level means 65%") rather than
//     per-underlying absolute levels or an inline "(Bloomberg: XXX)" cell.
//   - The underlying row wraps across physical lines (a real PDF-extraction
//     artifact, same class of issue as BNP's mid-phrase label wrapping):
//     "1 S&P 500 SPX Index New York Stock\nExchange\nUS78378X1072 USD 5239.6"
//     — every underlying-row token gap is matched with `\s+` (which spans the
//     joined text's embedded newlines) rather than a per-line regex.
//   - The coupon/autocall observation schedule is printed as two SEPARATE
//     numbered vertical lists ("Observation Date (n)" then "Interest Payment
//     Date (n)", each "n <D Month YYYY>" one per line) instead of a combined
//     table row — collected separately and zipped by position.
//   - "Rate means 2.0125%" is the periodic coupon rate; "SumRate" (a running
//     memory-coupon accumulator, not a rate itself) must never be matched by
//     the same regex — guarded with a leading `\b` so "SumRate" never matches
//     `\bRate\s+means`.

import type { ExtractedField, StructuredNote, StructuredNoteObservation, StructuredNoteUnderlying } from '../../types.ts'
import { calculateCouponAnnualized, frequencyToPeriodsPerYear } from '../../calculations.ts'
import { resolveUnderlyingSymbol } from '../../underlyingSymbolMap.ts'
import { extractIsin, field, labelDateJoined, labelValue, mapIssuerDisplay, parseNum, parseTermSheetDate } from './shared.ts'
import type { IssuerParser, Line } from './types.ts'

export const SANTANDER_PARSER_VERSION = '9F.santander.1'

/** Collects an ordered list of dates from a numbered vertical list following a header line, e.g. "1 1 July 2024" / "2 1 October 2024" ... Stops at the first line that doesn't match the "<n> <date>" shape once collection has started. */
function collectNumberedDateList(lines: Line[], headerRe: RegExp): string[] {
  const idx = lines.findIndex((l) => headerRe.test(l.text))
  if (idx < 0) return []
  const rowRe = /^(\d+)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})$/
  const out: string[] = []
  for (let i = idx + 1; i < lines.length; i++) {
    const m = rowRe.exec(lines[i].text)
    if (!m) { if (out.length > 0) break; continue }
    const iso = parseTermSheetDate(m[2])
    if (iso) out.push(iso)
  }
  return out
}

export const parseSantander: IssuerParser = (ctx) => {
  const { lines, joined } = ctx
  const fields: ExtractedField<unknown>[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const push = (f: ExtractedField<unknown>) => { fields.push(f); return f.value }

  const { isin, rawExcerpt: isinExcerpt } = extractIsin(joined)
  push(field('isin', isin, { rawExcerpt: isinExcerpt, sourceSection: 'General Terms', confidence: isin ? 'high' : 'low', warning: isin ? null : 'ISIN not found' }))

  const issuerLV = labelValue(lines, [/^Issuer\s+/])
  const issuerName = issuerLV ? issuerLV.value.replace(/\s*\(.*$/, '').trim() : null
  push(field('issuerName', issuerName, { rawExcerpt: issuerLV?.value ?? null, sourcePage: issuerLV?.page ?? null, sourceSection: 'General Terms', confidence: issuerName ? 'high' : 'low', warning: issuerName ? null : 'Issuer not found' }))
  const issuerDisplay = issuerName ? mapIssuerDisplay(issuerName) : (/santander/i.test(joined) ? 'Santander' : null)
  push(field('issuerDisplayName', issuerDisplay, { confidence: issuerDisplay ? 'high' : 'low' }))

  const guarantorLV = labelValue(lines, [/^Guarantor\s+/])
  const guarantorName = guarantorLV ? guarantorLV.value.replace(/\s*\(.*$/, '').trim() : null
  push(field('guarantorName', guarantorName, { rawExcerpt: guarantorLV?.value ?? null }))

  const titleMatch = /(\d+Y\s+[A-Za-z0-9 ]*?Notes)/i.exec(joined) ?? /(Autocallable\s+Memory\s+Coupon[^\n]{0,80})/i.exec(joined)
  const productName = titleMatch ? titleMatch[0].replace(/\s+/g, ' ').trim() : (isin ? `Structured Note ${isin}` : 'Structured Note')
  push(field('productName', productName, { rawExcerpt: titleMatch?.[0] ?? null, confidence: titleMatch ? 'high' : 'medium' }))

  // ── Amounts ──────────────────────────────────────────────────────────────
  const issueSizeM = /Issue\s+Size\s+([A-Z]{3})\s+([\d,]+)/i.exec(joined)
  const currency = issueSizeM?.[1] ?? (labelValue(lines, [/^Currency\s+/])?.value.trim() ?? 'USD')
  push(field('currency', currency, { rawExcerpt: issueSizeM?.[0] ?? null, sourceSection: 'General Terms' }))
  push(field('issueSize', issueSizeM ? parseNum(issueSizeM[2]) : null, { rawExcerpt: issueSizeM?.[0] ?? null }))

  const calcAmountM = /Calculation\s+Amount\s+([A-Z]{3})\s+([\d,]+)/i.exec(joined)
  push(field('denomination', calcAmountM ? parseNum(calcAmountM[2]) : null, { rawExcerpt: calcAmountM?.[0] ?? null }))

  const issuePriceM = /Issue\s+Price\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const issuePricePct = issuePriceM ? Number(issuePriceM[1]) / 100 : null
  push(field('issuePricePct', issuePricePct, { rawExcerpt: issuePriceM?.[0] ?? null }))

  // ── Dates ──────────────────────────────────────────────────────────────────
  const trade = labelDateJoined(joined, 'Trade Date')
  const strikeD = labelDateJoined(joined, 'Strike Date')
  const issueD = labelDateJoined(joined, 'Issue Date')
  const maturity = labelDateJoined(joined, 'Maturity Date')
  const finalObs = labelDateJoined(joined, 'Final Observation Date')
  const tradeDate = trade?.iso ?? strikeD?.iso ?? null
  const issueDate = issueD?.iso ?? null
  const maturityDate = maturity?.iso ?? null
  const finalValuationDate = finalObs?.iso ?? null
  push(field('tradeDate', tradeDate, { rawExcerpt: trade?.raw ?? strikeD?.raw ?? null, sourceSection: 'General Terms', confidence: tradeDate ? 'high' : 'low', warning: tradeDate ? null : 'Trade date not found' }))
  push(field('issueDate', issueDate, { rawExcerpt: issueD?.raw ?? null }))
  push(field('finalValuationDate', finalValuationDate, { rawExcerpt: finalObs?.raw ?? null }))
  push(field('maturityDate', maturityDate, { rawExcerpt: maturity?.raw ?? null, sourceSection: 'General Terms', confidence: maturityDate ? 'high' : 'low', warning: maturityDate ? null : 'Maturity date not found' }))

  // ── Barriers (note-level %, plain-English "<Label> means N%" clauses) ─────
  const couponBarrierM = /Coupon\s+Barrier\s+Level\s+means\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const aerLevelM = /\bAER\s+Level\s+means\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const redemptionBarrierM = /Redemption\s+Barrier\s+Level\s+means\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const couponBarrierPct = couponBarrierM ? Number(couponBarrierM[1]) / 100 : null
  const autocallPct = aerLevelM ? Number(aerLevelM[1]) / 100 : 1
  const knockInPct = redemptionBarrierM ? Number(redemptionBarrierM[1]) / 100 : couponBarrierPct
  push(field('knockInBarrierPct', knockInPct, { rawExcerpt: redemptionBarrierM?.[0] ?? null, sourceSection: 'Redemption Provisions', confidence: knockInPct !== null ? 'high' : 'low', warning: knockInPct !== null ? null : 'Redemption barrier not found' }))
  push(field('couponBarrierPct', couponBarrierPct, { rawExcerpt: couponBarrierM?.[0] ?? null, confidence: couponBarrierPct !== null ? 'high' : 'low', warning: couponBarrierPct !== null ? null : 'Coupon barrier not found' }))
  push(field('autocallBarrierPct', autocallPct, { rawExcerpt: aerLevelM?.[0] ?? null, confidence: aerLevelM ? 'high' : 'medium' }))

  // ── Coupon: "Rate means 2.0125%" (the `\b` guards against matching inside "SumRate means...") ──
  const rateM = /\bRate\s+means\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const couponRatePeriodic = rateM ? Number(rateM[1]) / 100 : null
  const couponFrequency = 'quarterly' // confirmed by the ~3-month spacing of the Observation Date list below
  const couponRateAnnualized = calculateCouponAnnualized(couponRatePeriodic, frequencyToPeriodsPerYear(couponFrequency))
  push(field('couponFrequency', couponFrequency, { confidence: 'medium' }))
  push(field('couponRatePeriodic', couponRatePeriodic, { rawExcerpt: rateM?.[0] ?? null, confidence: couponRatePeriodic !== null ? 'high' : 'low', warning: couponRatePeriodic !== null ? null : 'Coupon rate not found' }))
  push(field('couponRateAnnualized', couponRateAnnualized, { confidence: couponRateAnnualized !== null ? 'medium' : 'low' }))

  // ── Underlyings — one absolute level per row, wraps across physical lines ──
  // "<j> <Name> <TICKER> Index <Exchange...> <ISIN> <CCY> <Initial Level>"
  const underlyings: StructuredNoteUnderlying[] = []
  const rowRe = /(\d+)\s+([A-Za-z0-9&®'.]+(?:\s+[A-Za-z0-9&®'.]+)*?)\s+([A-Z]{2,6})\s+Index\s+(?:[A-Za-z]+\s+){1,5}?Exchange\s+\S+\s+([A-Z]{3})\s+([\d,]+\.?\d*)/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(joined))) {
    const ticker = m[3]
    const initial = parseNum(m[5])
    if (initial === null || initial <= 0) continue
    const sourceTicker = `${ticker} Index`
    const resolved = resolveUnderlyingSymbol(ticker) ?? resolveUnderlyingSymbol(sourceTicker)
    const strike = initial
    underlyings.push({
      underlyingOrder: underlyings.length + 1,
      underlyingName: sourceTicker, sourceTicker, bloombergTicker: sourceTicker,
      yahooSymbol: resolved?.yahooSymbol ?? null, assetClass: resolved?.assetClass ?? 'index',
      initialLevel: initial, strikeLevel: strike,
      knockInBarrierLevel: knockInPct !== null ? strike * knockInPct : null,
      couponBarrierLevel: couponBarrierPct !== null ? strike * couponBarrierPct : null,
      autocallBarrierLevel: strike * autocallPct,
      knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    })
  }
  push(field('underlyings.count', String(underlyings.length), { sourceSection: 'General Terms', confidence: underlyings.length > 0 ? 'high' : 'low', warning: underlyings.length > 0 ? null : 'No underlyings extracted' }))

  // ── Schedule — two separate numbered vertical lists, zipped by position ───
  const observationDates = collectNumberedDateList(lines, /^Observation\s+Date\s*\(n\)/i)
  const paymentDates = collectNumberedDateList(lines, /^Interest\s+Payment\s+Date\s*\(n\)/i)
  const observations: StructuredNoteObservation[] = observationDates.map((valuationDate, i): StructuredNoteObservation => {
    const isFinal = finalValuationDate !== null && valuationDate === finalValuationDate && i === observationDates.length - 1
    const paymentDate = paymentDates[i] ?? valuationDate
    return {
      observationNumber: i + 1,
      observationType: isFinal ? 'final' : 'coupon',
      valuationDate, paymentDate, redemptionDate: isFinal ? (maturityDate ?? paymentDate) : paymentDate,
      couponDuePct: isFinal ? null : couponRatePeriodic,
      autocallBarrierPct: isFinal ? null : autocallPct,
      couponBarrierPct: isFinal ? knockInPct : couponBarrierPct,
      status: 'scheduled',
    }
  })
  push(field('observations.count', String(observations.length), { sourceSection: 'Observation Date (n)', confidence: observations.length > 0 ? 'high' : 'low', warning: observations.length > 0 ? null : 'No observation schedule extracted' }))

  // ── Structure ─────────────────────────────────────────────────────────────
  const isMemory = /SumRate|memory\s+coupon/i.test(joined)
  const isAutocall = /Automatic\s+Early\s+Redemption/i.test(joined)
  const structureType = [underlyings.length > 1 ? 'worst_of' : null, isMemory ? 'memory_coupon' : null, isAutocall ? 'autocall' : 'note'].filter(Boolean).join('_')
  push(field('structureType', structureType, { confidence: isAutocall ? 'high' : 'medium' }))

  const note: StructuredNote = {
    isin, productName, issuerName, issuerDisplayName: issuerDisplay, guarantorName,
    structureType: structureType || 'note', payoffType: null, currency,
    issueSize: issueSizeM ? parseNum(issueSizeM[2]) : null,
    denomination: calcAmountM ? parseNum(calcAmountM[2]) : null, issuePricePct,
    tradeDate, issueDate, initialValuationDate: tradeDate, finalValuationDate, maturityDate, redemptionDate: maturityDate,
    couponFrequency, couponRatePeriodic, couponRateAnnualized,
    memoryCoupon: isMemory, principalProtection: false,
    knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    status: 'draft', sourceType: 'pdf_extraction', sourceName: 'Term sheet (Santander)',
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

  const fieldsSeen = fields.length
  const fieldsExtracted = fields.filter((f) => f.value !== null && f.value !== '' && f.value !== '0').length
  const fieldsLowConfidence = fields.filter((f) => f.confidence === 'low' && f.value !== null).length
  const criticalPresent = critical.filter(([, ok]) => ok).length
  const confidenceScore = Math.round((criticalPresent / critical.length) * 100) / 100
  note.confidenceScore = confidenceScore

  return { ok: errors.length === 0, parserVersion: SANTANDER_PARSER_VERSION, note, fields, warnings, errors, fieldsSeen, fieldsExtracted, fieldsLowConfidence, confidenceScore }
}
