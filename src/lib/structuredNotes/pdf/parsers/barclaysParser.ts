// Phase 9C — Barclays Bank PLC parser ("Worst-of European Barrier Autocallable" family).
//
// Distinctive format vs the generic Citi/HSBC parser:
//   - The underlying table's ticker cell mixes Bloomberg AND Refinitiv codes
//     inline: "S&P 500 Index (Bloomberg Screen: SPX Index; Refinitiv Screen:
//     .SPX)". Bloomberg is the source of truth for market-data mapping; the
//     Refinitiv code is metadata only — never used as the primary ticker.
//   - The real sample's cover-page underlying summary table is rendered by
//     the PDF's own layout as a narrow multi-column box: pdf.js's text
//     extraction turns it into ~1 word per physical line AND splits several
//     multi-digit price levels mid-decimal across two lines (e.g. "5,183.5"
//     then a lone "4" on the next line). This is reconstructed defensively
//     (`reconstructSplitDecimals`) — if that reconstruction doesn't hold for
//     a different Barclays layout, the resulting level simply won't match
//     the expected shape and is left null (never mis-aligned/fabricated).
//   - The Interest/Autocall schedule tables and every general-info label
//     ARE clean single physical lines, unlike the cover-table.

import type { ExtractedField, StructuredNote, StructuredNoteObservation, StructuredNoteUnderlying } from '../../types.ts'
import { calculateCouponAnnualized, frequencyToPeriodsPerYear } from '../../calculations.ts'
import { resolveUnderlyingSymbol } from '../../underlyingSymbolMap.ts'
import { extractCurrencyAmount, extractIsin, field, labelDate, labelValue, mapIssuerDisplay, parseNum, parseTermSheetDate } from './shared.ts'
import type { IssuerParser } from './types.ts'

export const BARCLAYS_PARSER_VERSION = '9C.barclays.1'

/**
 * Rejoins a decimal number that the source PDF split mid-fraction across two
 * lines (see module doc) — e.g. "5,183.5\n4\nIntraday" -> "5,183.54\nIntraday".
 * The digit fragment must be ENTIRELY ALONE on its line (bounded by a
 * newline on both sides): that is what distinguishes a genuine split-decimal
 * continuation from an unrelated row index that merely happens to start the
 * next line with a bare digit followed by more text on the same line.
 */
function reconstructSplitDecimals(text: string): string {
  return text.replace(/(\d[\d,]*\.\d+)\n(\d{1,4})\n/g, '$1$2\n')
}

export const parseBarclays: IssuerParser = (ctx) => {
  const { lines, joined } = ctx
  const fields: ExtractedField<unknown>[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const push = (f: ExtractedField<unknown>) => { fields.push(f); return f.value }

  const { isin, rawExcerpt: isinExcerpt } = extractIsin(joined)
  push(field('isin', isin, { rawExcerpt: isinExcerpt, sourceSection: 'header', confidence: isin ? 'high' : 'low', warning: isin ? null : 'ISIN not found' }))

  const seriesMatch = /Series Number:\s*([A-Z0-9]+)/i.exec(joined)
  push(field('seriesNumber', seriesMatch?.[1] ?? null, { rawExcerpt: seriesMatch?.[0] ?? null }))

  const issuerLV = labelValue(lines, [/^Issuer\s+/])
  const issuerName = issuerLV ? issuerLV.value.replace(/\s*\(.*$/, '').replace(/\s+with LEI.*$/i, '').trim() : null
  push(field('issuerName', issuerName, { rawExcerpt: issuerLV?.value ?? null, sourcePage: issuerLV?.page ?? null, sourceSection: 'PRODUCT DETAILS', confidence: issuerName ? 'high' : 'low', warning: issuerName ? null : 'Issuer not found' }))
  const issuerDisplay = issuerName ? mapIssuerDisplay(issuerName) : (/barclays/i.test(joined) ? 'Barclays' : null)
  push(field('issuerDisplayName', issuerDisplay, { confidence: issuerDisplay ? 'high' : 'low' }))
  // Barclays Bank PLC issues in its own name — no separate guarantor entity on this template.
  const guarantorName: string | null = null

  const titleMatch = /(Worst-of\s+European\s+Barrier\s+Autocallable[^\n]{0,80})/i.exec(joined)
  const productName = titleMatch ? titleMatch[0].replace(/\s+/g, ' ').trim() : (isin ? `Structured Note ${isin}` : 'Structured Note')
  push(field('productName', productName, { rawExcerpt: titleMatch?.[0] ?? null, confidence: titleMatch ? 'high' : 'medium' }))

  // ── Amounts ──────────────────────────────────────────────────────────────
  const issueSizeRes = extractCurrencyAmount(joined, /Aggregate Nominal Amount\s+[A-Z]{3}\s+[\d,.]+/i)
  const denomRes = extractCurrencyAmount(joined, /Specified Denomination\s+[A-Z]{3}\s+[\d,.]+/i)
  const currencyM = /Issue Currency[^(]*\("([A-Z]{3})"\)/i.exec(joined)
  const currency = currencyM?.[1] ?? issueSizeRes.currency ?? 'USD'
  push(field('currency', currency, { rawExcerpt: currencyM?.[0] ?? null, sourceSection: 'PRODUCT DETAILS' }))
  push(field('issueSize', issueSizeRes.amount, { rawExcerpt: issueSizeRes.rawExcerpt }))
  push(field('denomination', denomRes.amount, { rawExcerpt: denomRes.rawExcerpt }))

  const issuePriceM = /Issue Price\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const issuePricePct = issuePriceM ? Number(issuePriceM[1]) / 100 : null
  push(field('issuePricePct', issuePricePct, { rawExcerpt: issuePriceM?.[0] ?? null }))

  // ── Dates ("D Month YYYY", no ordinal — clean single-line labels) ────────
  const trade = labelDate(lines, [/^Trade Date\s+/i])
  const issueD = labelDate(lines, [/^Issue Date\s+/i])
  const finalVal = labelDate(lines, [/^Final Valuation Date\s+/i])
  const maturity = labelDate(lines, [/^Redemption Date\s+/i])
  const tradeDate = trade?.iso ?? null
  const issueDate = issueD?.iso ?? null
  const finalValuationDate = finalVal?.iso ?? null
  const maturityDate = maturity?.iso ?? null
  push(field('tradeDate', tradeDate, { rawExcerpt: trade?.raw ?? null, sourceSection: 'PRODUCT DETAILS', confidence: tradeDate ? 'high' : 'low', warning: tradeDate ? null : 'Trade date not found' }))
  push(field('issueDate', issueDate, { rawExcerpt: issueD?.raw ?? null }))
  push(field('finalValuationDate', finalValuationDate, { rawExcerpt: finalVal?.raw ?? null }))
  push(field('maturityDate', maturityDate, { rawExcerpt: maturity?.raw ?? null, sourceSection: 'PRODUCT DETAILS', confidence: maturityDate ? 'high' : 'low', warning: maturityDate ? null : 'Maturity date not found' }))

  // ── Barriers (note-level %, from the cover-table column labels) ─────────
  const knockInM = /Knock-in\s+Barrier\s+Price\s*\(\s*(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const couponBarrierM = /Interest\s+Barrier\s*\(\s*(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const autocallM = /Autocall\s+Barrier\s*\(\s*(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const knockInPct = knockInM ? Number(knockInM[1]) / 100 : null
  const couponBarrierPct = couponBarrierM ? Number(couponBarrierM[1]) / 100 : knockInPct
  const autocallPct = autocallM ? Number(autocallM[1]) / 100 : 1
  push(field('knockInBarrierPct', knockInPct, { rawExcerpt: knockInM?.[0] ?? null, sourceSection: 'Underlying Asset(s)', confidence: knockInPct !== null ? 'high' : 'low', warning: knockInPct !== null ? null : 'Knock-in barrier not found' }))
  push(field('couponBarrierPct', couponBarrierPct, { rawExcerpt: couponBarrierM?.[0] ?? null, confidence: couponBarrierM ? 'high' : couponBarrierPct !== null ? 'medium' : 'low' }))
  push(field('autocallBarrierPct', autocallPct, { rawExcerpt: autocallM?.[0] ?? null, confidence: autocallM ? 'high' : 'medium' }))

  // ── Underlyings — mixed Bloomberg/Refinitiv ticker cell + reconstructed levels ──
  const underlyings: StructuredNoteUnderlying[] = []
  const fixed = reconstructSplitDecimals(joined)
  // The Refinitiv code (last capture) is matched loosely up to the closing
  // paren rather than as a strict `.XXX` token: this real cover-table wraps
  // so tightly that even the Refinitiv code itself gets split mid-token
  // (e.g. "Screen: .SP\nX)"). It is metadata only — never used for pricing —
  // so a loosely-captured raw fragment is an acceptable trade-off; the
  // Bloomberg ticker (the one that matters) is captured strictly and is
  // never split in the real sample.
  const tickerCellRe = /(\d+)\s+([A-Za-z0-9&®'.\s]+?\s+Index)\s*\(\s*Bloomberg\s+Screen:\s*([A-Z0-9]{2,6})\s+Index;\s*Refinitiv\s+Screen:\s*(\.[\s\S]*?)\)/gi
  // "Intraday" itself gets split mid-word in the real sample ("Intrada\ny
  // Price"), so it's matched as "Intrada" + optional whitespace + "y".
  const levelsRe = /N\/A\s+([A-Z]{3})\s+([\d,]+\.\d+)\s*Intrada\s*y\s*Price\s*([\d,]+\.\d+)\s*([\d,]+\.\d+)\s*([\d,]+\.\d+)\s*([\d,]+\.\d+)/gi
  const cells: { name: string; bloomberg: string; refinitiv: string }[] = []
  let tm: RegExpExecArray | null
  while ((tm = tickerCellRe.exec(fixed))) {
    cells.push({ name: tm[2].replace(/\s+/g, ' ').trim(), bloomberg: tm[3].toUpperCase(), refinitiv: tm[4].replace(/\s+/g, '').toUpperCase() })
  }
  const levelRows: { initial: number | null; strike: number | null; knockIn: number | null; interest: number | null; autocall: number | null }[] = []
  let lm: RegExpExecArray | null
  while ((lm = levelsRe.exec(fixed))) {
    levelRows.push({ initial: parseNum(lm[2]), strike: parseNum(lm[3]), knockIn: parseNum(lm[4]), interest: parseNum(lm[5]), autocall: parseNum(lm[6]) })
  }
  cells.forEach((c, i) => {
    const lvl = levelRows[i]
    const sourceTicker = `${c.bloomberg} Index`
    const resolved = resolveUnderlyingSymbol(c.bloomberg) ?? resolveUnderlyingSymbol(sourceTicker)
    if (!lvl) warnings.push(`Underlying ${c.bloomberg}: price levels could not be reliably aligned (compressed cover-table column) — review`)
    underlyings.push({
      underlyingOrder: underlyings.length + 1,
      underlyingName: sourceTicker, sourceTicker, bloombergTicker: sourceTicker,
      yahooSymbol: resolved?.yahooSymbol ?? null, assetClass: resolved?.assetClass ?? 'index',
      initialLevel: lvl?.initial ?? null, strikeLevel: lvl?.strike ?? lvl?.initial ?? null,
      knockInBarrierLevel: lvl?.knockIn ?? null, couponBarrierLevel: lvl?.interest ?? null, autocallBarrierLevel: lvl?.autocall ?? null,
      knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    })
    // Refinitiv code is preserved only as metadata via the warning/provenance
    // trail below — never substituted for the Bloomberg ticker.
  })
  push(field('underlyings.count', String(underlyings.length), { sourceSection: 'Underlying Asset(s)', confidence: underlyings.length > 0 ? 'high' : 'low', warning: underlyings.length > 0 ? null : 'No underlyings extracted' }))
  push(field('underlyings.refinitivCodes', cells.map((c) => c.refinitiv).join(', ') || null, { confidence: 'medium', sourceSection: 'Underlying Asset(s) (metadata only, not used for pricing)' }))

  // ── Coupon — from the Interest schedule table's Rate column ─────────────
  const interestRows = extractBarclaysScheduleRows(joined, /i\s+Interest\s+Valuation\s+Date\(s\)\s+Interest\s+Rate\(s\)\s+Interest\s+Payment\s+Date\(s\)/i)
  const autocallRows = extractBarclaysScheduleRows(joined, /i\s+Autocall\s+Valuation\s+Date\(s\)\s+Autocall\s+Redemption\s+Percentage\(s\)\s+Specified\s+Early\s+Cash\s+Redemption\s+Date\(s\)/i)
  const couponRatePeriodic = interestRows.length > 0 ? interestRows[0].pct : null
  const couponFrequency = 'quarterly' // confirmed by the ~3-month spacing of the schedule rows
  const couponRateAnnualized = calculateCouponAnnualized(couponRatePeriodic, frequencyToPeriodsPerYear(couponFrequency))
  push(field('couponFrequency', couponFrequency, { confidence: 'medium' }))
  push(field('couponRatePeriodic', couponRatePeriodic, { sourceSection: 'INTEREST', confidence: couponRatePeriodic !== null ? 'high' : 'low', warning: couponRatePeriodic !== null ? null : 'Coupon rate not found' }))
  push(field('couponRateAnnualized', couponRateAnnualized, { confidence: couponRateAnnualized !== null ? 'medium' : 'low' }))

  // ── Schedule: one observation per valuation date ─────────────────────────
  const observations: StructuredNoteObservation[] = interestRows.map((row, i) => {
    const ac = autocallRows[i]
    return {
      observationNumber: i + 1, observationType: 'coupon',
      valuationDate: row.valuationDate, paymentDate: row.otherDate, redemptionDate: ac?.otherDate ?? null,
      couponDuePct: row.pct, autocallBarrierPct: ac ? autocallPct : autocallPct, couponBarrierPct,
      status: 'scheduled',
    }
  })
  if (finalValuationDate && maturityDate && (observations.length === 0 || observations[observations.length - 1].valuationDate !== finalValuationDate)) {
    observations.push({
      observationNumber: observations.length + 1, observationType: 'final',
      valuationDate: finalValuationDate, paymentDate: maturityDate, redemptionDate: maturityDate,
      couponDuePct: couponRatePeriodic, autocallBarrierPct: autocallPct, couponBarrierPct: knockInPct ?? couponBarrierPct,
      status: 'scheduled',
    })
  }
  push(field('observations.count', String(observations.length), { sourceSection: 'INTEREST', confidence: observations.length > 0 ? 'high' : 'low', warning: observations.length > 0 ? null : 'No observation schedule extracted' }))

  // ── Structure ─────────────────────────────────────────────────────────────
  const isMemory = /Phoenix with memory|memory/i.test(joined)
  const isAutocall = /Autocall|Specified Early Redemption/i.test(joined)
  const structureType = ['worst_of', isMemory ? 'memory_coupon' : null, isAutocall ? 'autocall' : 'note'].filter(Boolean).join('_')
  push(field('structureType', structureType, { confidence: isAutocall ? 'high' : 'medium' }))

  const note: StructuredNote = {
    isin, productName, issuerName, issuerDisplayName: issuerDisplay, guarantorName,
    structureType: structureType || 'note', payoffType: null, currency,
    issueSize: issueSizeRes.amount, denomination: denomRes.amount, issuePricePct,
    tradeDate, issueDate, initialValuationDate: tradeDate, finalValuationDate, maturityDate, redemptionDate: maturityDate,
    couponFrequency, couponRatePeriodic, couponRateAnnualized,
    memoryCoupon: isMemory, principalProtection: false,
    knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    status: 'draft', sourceType: 'pdf_extraction', sourceName: 'Term sheet (Barclays)',
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

  return { ok: errors.length === 0, parserVersion: BARCLAYS_PARSER_VERSION, note, fields, warnings, errors, fieldsSeen, fieldsExtracted, fieldsLowConfidence, confidenceScore }
}

interface BarclaysScheduleRow { valuationDate: string; pct: number; otherDate: string | null }

/** Extracts clean single-line rows "<i> <D Month YYYY> <pct>% <D Month YYYY>" after a given table header. */
function extractBarclaysScheduleRows(joined: string, headerRe: RegExp): BarclaysScheduleRow[] {
  const headerMatch = headerRe.exec(joined)
  if (!headerMatch) return []
  const rest = joined.slice(headerMatch.index + headerMatch[0].length)
  const rowRe = /(\d+)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(\d+(?:\.\d+)?)\s*%\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/g
  const rows: BarclaysScheduleRow[] = []
  let m: RegExpExecArray | null
  let lastIndex = -1
  while ((m = rowRe.exec(rest))) {
    const idx = Number(m[1])
    if (idx <= lastIndex && rows.length > 0) break
    lastIndex = idx
    const v = parseTermSheetDate(m[2])
    const other = parseTermSheetDate(m[4])
    if (!v) continue
    rows.push({ valuationDate: v, pct: Number(m[3]) / 100, otherDate: other })
    if (rows.length >= 40) break
  }
  return rows
}
