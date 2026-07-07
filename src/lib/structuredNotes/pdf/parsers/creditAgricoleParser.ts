// Phase 9C — Crédit Agricole CIB parser ("Climber Reload Autocall" family).
//
// Distinctive format vs the generic Citi/HSBC parser:
//   - Numbered-section layout ("3) Underlying(s)", "4) Indicative Barrier
//     Level(s)", "5) General Information", "6) Dates").
//   - Barriers are labeled Interest Barrier / Early Redemption Barrier /
//     Final Redemption Barrier / Strike — NOT Knock-In/Coupon/Autocall.
//   - Two separate schedule tables sharing the same row shape:
//     "t <valuation date> <payment date> <barrier %> <rate %>".
//   - Dates are DD/MM/YYYY throughout (day-first).
//
// Barrier mapping (see classifyBarrierRole in shared.ts):
//   Interest Barrier        -> couponBarrierPct
//   Early Redemption Barrier -> autocallBarrierPct
//   Final Redemption Barrier -> knockInBarrierPct, but ONLY treated as
//     equivalent to the payoff's knock-in threshold if the "Favourable
//     Scenario" / "Performance is higher than or equal to X% on the
//     Redemption Observation Date" wording confirms the same percentage —
//     never assumed from the label alone.

import type { ExtractedField, StructuredNote, StructuredNoteObservation, StructuredNoteUnderlying } from '../../types.ts'
import { calculateBarrierLevel, calculateCouponAnnualized, frequencyToPeriodsPerYear } from '../../calculations.ts'
import { resolveUnderlyingSymbol } from '../../underlyingSymbolMap.ts'
import { extractIsin, extractCurrencyAmount, field, labelValue, labelDate, mapIssuerDisplay, parseNum, parseTermSheetDate } from './shared.ts'
import type { IssuerParser } from './types.ts'

export const CREDIT_AGRICOLE_PARSER_VERSION = '9C.creditAgricole.1'

const UNDERLYING_NAME_TO_TICKER: Record<string, string> = {
  'S&P 500': 'SPX', 'S&P 500 INDEX': 'SPX', 'RUSSELL 2000': 'RTY', 'RUSSELL 2000 INDEX': 'RTY',
}

export const parseCreditAgricole: IssuerParser = (ctx) => {
  const { lines, joined } = ctx
  const fields: ExtractedField<unknown>[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const push = (f: ExtractedField<unknown>) => { fields.push(f); return f.value }

  const { isin, rawExcerpt: isinExcerpt } = extractIsin(joined)
  push(field('isin', isin, { rawExcerpt: isinExcerpt, sourceSection: 'header', confidence: isin ? 'high' : 'low', warning: isin ? null : 'ISIN not found' }))

  const seriesMatch = /SeriesCode:\s*([A-Z0-9]+)/i.exec(joined)
  push(field('seriesNumber', seriesMatch?.[1] ?? null, { rawExcerpt: seriesMatch?.[0] ?? null }))

  // Issuer / Guarantor — "Issuer Crédit Agricole CIB Financial Solutions LEI : ..."
  const issuerLV = labelValue(lines, [/^Issuer\s+/])
  const issuerName = issuerLV ? issuerLV.value.replace(/\s*LEI\s*:.*/i, '').trim() : null
  push(field('issuerName', issuerName, { rawExcerpt: issuerLV?.value ?? null, sourcePage: issuerLV?.page ?? null, sourceSection: 'General Information', confidence: issuerName ? 'high' : 'low', warning: issuerName ? null : 'Issuer not found' }))
  const issuerDisplay = issuerName ? mapIssuerDisplay(issuerName) : (/cr[ée]dit agricole/i.test(joined) ? 'Crédit Agricole' : null)
  push(field('issuerDisplayName', issuerDisplay, { confidence: issuerDisplay ? 'high' : 'low' }))

  const guarantorLV = labelValue(lines, [/^Guarantor\s+/])
  const guarantorName = guarantorLV ? guarantorLV.value.replace(/\s*LEI\s*:.*/i, '').replace(/\s*\(“[^”]*”\)/, '').trim() : null
  push(field('guarantorName', guarantorName, { rawExcerpt: guarantorLV?.value ?? null }))

  const titleMatch = /(Climber Reload Autocall[^\n]{0,80})/i.exec(joined) ?? /(Autocallable[^\n]{0,80})/i.exec(joined)
  const productName = titleMatch ? titleMatch[1].trim() : (isin ? `Structured Note ${isin}` : 'Structured Note')
  push(field('productName', productName, { rawExcerpt: titleMatch?.[0] ?? null, confidence: titleMatch ? 'high' : 'medium' }))

  // ── Amounts ──────────────────────────────────────────────────────────────
  const issueSizeRes = extractCurrencyAmount(joined, /Aggregate Nominal Amount\s+[A-Z]{3}\s+[\d,.]+/i)
  const denomRes = extractCurrencyAmount(joined, /Specified Denomination\s+[A-Z]{3}\s+[\d,.]+/i)
  const currencyLV = labelValue(lines, [/^Specified Currency\s+/])
  const currency = currencyLV?.value.trim() || issueSizeRes.currency || 'USD'
  push(field('currency', currency, { rawExcerpt: currencyLV?.value ?? null, sourceSection: 'General Information' }))
  push(field('issueSize', issueSizeRes.amount, { rawExcerpt: issueSizeRes.rawExcerpt, sourceSection: 'General Information' }))
  push(field('denomination', denomRes.amount, { rawExcerpt: denomRes.rawExcerpt }))

  const issuePriceMatch = /Issue Price\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const issuePricePct = issuePriceMatch ? Number(issuePriceMatch[1]) / 100 : null
  push(field('issuePricePct', issuePricePct, { rawExcerpt: issuePriceMatch?.[0] ?? null }))

  // ── Dates (all DD/MM/YYYY) ───────────────────────────────────────────────
  const trade = labelDate(lines, [/^Trade Date\s+/i])
  const issueD = labelDate(lines, [/^Issue Date\s+/i])
  const maturity = labelDate(lines, [/^Redemption Date\s+/i])
  const finalVal = labelDate(lines, [/^Redemption Observation Date\s+/i])
  const tradeDate = trade?.iso ?? null
  const issueDate = issueD?.iso ?? null
  const maturityDate = maturity?.iso ?? null
  const finalValuationDate = finalVal?.iso ?? null
  push(field('tradeDate', tradeDate, { rawExcerpt: trade?.raw ?? null, sourceSection: 'General Information', confidence: tradeDate ? 'high' : 'low', warning: tradeDate ? null : 'Trade date not found' }))
  push(field('issueDate', issueDate, { rawExcerpt: issueD?.raw ?? null }))
  push(field('finalValuationDate', finalValuationDate, { rawExcerpt: finalVal?.raw ?? null }))
  push(field('maturityDate', maturityDate, { rawExcerpt: maturity?.raw ?? null, sourceSection: 'General Information', confidence: maturityDate ? 'high' : 'low', warning: maturityDate ? null : 'Maturity date not found' }))

  // ── Barriers (from the "Indicative Barrier Level(s)" header row) ────────
  const couponBarrierPctRes = extractLabeledBarrierPct(joined, 'Interest Barrier')
  const autocallPctRes = extractLabeledBarrierPct(joined, 'Early Redemption Barrier')
  const finalRedemptionPctRes = extractLabeledBarrierPct(joined, 'Final Redemption Barrier')
  push(field('couponBarrierPct', couponBarrierPctRes.pct, { rawExcerpt: couponBarrierPctRes.rawExcerpt, sourceSection: 'Indicative Barrier Level(s)', confidence: couponBarrierPctRes.pct !== null ? 'high' : 'low', warning: couponBarrierPctRes.pct !== null ? null : 'Interest Barrier not found' }))
  push(field('autocallBarrierPct', autocallPctRes.pct ?? 1, { rawExcerpt: autocallPctRes.rawExcerpt, confidence: autocallPctRes.pct !== null ? 'high' : 'medium' }))

  // Do NOT assume Final Redemption Barrier == knock-in unless the payoff
  // wording explicitly confirms the same percentage threshold drives the
  // Redemption Observation Date outcome.
  const payoffConfirm = /Performance\s+is\s+higher\s+than\s+or\s+equal\s+to\s+(\d+(?:\.\d+)?)\s*%\s*on\s+the\s+Redemption\s+Observation\s+Date/i.exec(joined)
  const payoffPct = payoffConfirm ? Number(payoffConfirm[1]) / 100 : null
  const knockInPct = finalRedemptionPctRes.pct
  let knockInConfidence: 'high' | 'medium' | 'low' = 'low'
  let knockInWarning: string | null = 'Final Redemption Barrier not found'
  if (knockInPct !== null) {
    if (payoffPct !== null && Math.abs(payoffPct - knockInPct) < 0.0001) {
      knockInConfidence = 'high'
      knockInWarning = null
    } else {
      knockInConfidence = 'medium'
      knockInWarning = 'knock-in equivalence inferred from the Final Redemption Barrier label only, not confirmed by payoff wording — review'
      warnings.push(knockInWarning)
    }
  }
  push(field('knockInBarrierPct', knockInPct, { rawExcerpt: finalRedemptionPctRes.rawExcerpt, sourceSection: 'Indicative Barrier Level(s)', confidence: knockInConfidence, warning: knockInWarning }))

  const couponBarrierPct = couponBarrierPctRes.pct
  const autocallPct = autocallPctRes.pct ?? 1

  // ── Underlyings — Section 3) table row: "<n> <NAME> Index <sponsor...> <TICKER> <initial> Not Applicable" ──
  // Real term sheets wrap the sponsor name across several physical lines
  // (e.g. "...Index S&P Dow Jones Indices\nLLC\nSPX 6,443.1200 Not Applicable"),
  // and the second row's index is glued to a footnote marker ("N=2..."), so
  // the row index is matched as a bare digit substring (found inside "N=2"
  // too) rather than anchored to line/string start, and the sponsor gap uses
  // [\s\S] so it can cross the joined string's embedded newlines.
  const underlyings: StructuredNoteUnderlying[] = []
  const underlyingRowRe = /(\d+)\s+([A-Z0-9&' .]+?)\s+Index\s+[\s\S]+?\s+([A-Z]{2,6})\s+([\d,]+\.\d+)\s+Not Applicable/g
  let um: RegExpExecArray | null
  while ((um = underlyingRowRe.exec(joined))) {
    const name = um[2].trim()
    const ticker = um[3]
    const initial = parseNum(um[4])
    if (initial === null || initial <= 0) continue
    const sourceTicker = `${ticker} Index`
    const resolved = resolveUnderlyingSymbol(ticker) ?? resolveUnderlyingSymbol(sourceTicker) ?? resolveUnderlyingSymbol(UNDERLYING_NAME_TO_TICKER[name] ?? name)
    underlyings.push({
      underlyingOrder: underlyings.length + 1,
      underlyingName: sourceTicker, sourceTicker, bloombergTicker: sourceTicker,
      yahooSymbol: resolved?.yahooSymbol ?? null, assetClass: resolved?.assetClass ?? 'index',
      initialLevel: initial, strikeLevel: initial,
      knockInBarrierLevel: null, couponBarrierLevel: null, autocallBarrierLevel: null,
      knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    })
  }
  // Absolute barrier levels from the "Indicative Barrier Level(s)" table:
  // per-underlying row "<n> <NAME> <interestLvl> <earlyRedemptionLvl> <finalRedemptionLvl> <strikeLvl>".
  // Matched positionally (by table row order), not by name-string matching —
  // the underlying's display name here ("S&P 500 INDEX") and its Bloomberg
  // ticker-derived sourceTicker ("SPX Index") share no common substring, and
  // both tables list underlyings in the same order for this issuer.
  const barrierRowRe = /(\d+)\s+([A-Z0-9&' .]+?)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/g
  const barrierRows: { coupon: number; autocall: number; finalRedemption: number; strike: number }[] = []
  let bm: RegExpExecArray | null
  while ((bm = barrierRowRe.exec(joined))) {
    barrierRows.push({
      coupon: parseNum(bm[3]) ?? 0, autocall: parseNum(bm[4]) ?? 0,
      finalRedemption: parseNum(bm[5]) ?? 0, strike: parseNum(bm[6]) ?? 0,
    })
  }
  underlyings.forEach((u, i) => {
    const row = barrierRows[i]
    if (row) {
      u.strikeLevel = row.strike || u.strikeLevel
      u.couponBarrierLevel = row.coupon || calculateBarrierLevel(u.strikeLevel, couponBarrierPct)
      u.autocallBarrierLevel = row.autocall || calculateBarrierLevel(u.strikeLevel, autocallPct)
      u.knockInBarrierLevel = row.finalRedemption || calculateBarrierLevel(u.strikeLevel, knockInPct)
    } else {
      u.couponBarrierLevel = calculateBarrierLevel(u.strikeLevel, couponBarrierPct)
      u.autocallBarrierLevel = calculateBarrierLevel(u.strikeLevel, autocallPct)
      u.knockInBarrierLevel = calculateBarrierLevel(u.strikeLevel, knockInPct)
    }
  })
  push(field('underlyings.count', String(underlyings.length), { sourceSection: 'Underlying(s)', confidence: underlyings.length > 0 ? 'high' : 'low', warning: underlyings.length > 0 ? null : 'No underlyings extracted' }))

  // ── Coupon (from the Interest schedule's Fixed Rate column) ─────────────
  // Header phrases wrap unpredictably mid-word in the real documents (e.g.
  // "Interest Observation Dates\nand Interest Payment Dates..."), so every
  // internal word gap uses \s+ (which matches the embedded newlines) rather
  // than a literal space.
  const interestRows = extractCaScheduleRows(joined, /Interest\s+Observation\s+Dates?\s+and\s+Interest\s+Payment\s+Dates?/i)
  const earlyRedemptionRows = extractCaScheduleRows(joined, /Automatic\s+Early\s+Redemption\s+Observation\s+Dates?\s+and\s+Automatic\s+Early\s+Redemption\s+Dates?/i)
  const couponRatePeriodic = interestRows.length > 0 ? interestRows[0].rate : null
  const couponFrequency = 'quarterly' // this product family pays quarterly; confirmed by ~3-month spacing in the schedule
  const periodsPerYear = frequencyToPeriodsPerYear(couponFrequency)
  const couponRateAnnualized = calculateCouponAnnualized(couponRatePeriodic, periodsPerYear)
  push(field('couponFrequency', couponFrequency, { sourceSection: 'Interest and Redemption', confidence: 'medium' }))
  push(field('couponRatePeriodic', couponRatePeriodic, { sourceSection: 'Interest and Redemption', confidence: couponRatePeriodic !== null ? 'high' : 'low', warning: couponRatePeriodic !== null ? null : 'Coupon rate not found' }))
  push(field('couponRateAnnualized', couponRateAnnualized, { confidence: couponRateAnnualized !== null ? 'medium' : 'low' }))

  // ── Schedule: one observation per valuation date (interest date drives; early-redemption barrier folded in) ──
  const observations: StructuredNoteObservation[] = interestRows.map((row, i) => {
    const er = earlyRedemptionRows[i]
    return {
      observationNumber: i + 1,
      observationType: 'coupon',
      valuationDate: row.valuationDate,
      paymentDate: row.paymentDate,
      redemptionDate: er?.paymentDate ?? row.paymentDate,
      couponDuePct: row.rate,
      autocallBarrierPct: er?.barrierPct ?? autocallPct,
      couponBarrierPct: row.barrierPct,
      status: 'scheduled',
    }
  })
  if (finalValuationDate && maturityDate && observations.length > 0 && observations[observations.length - 1].valuationDate !== finalValuationDate) {
    observations.push({
      observationNumber: observations.length + 1, observationType: 'final',
      valuationDate: finalValuationDate, paymentDate: maturityDate, redemptionDate: maturityDate,
      couponDuePct: couponRatePeriodic, autocallBarrierPct: autocallPct, couponBarrierPct: knockInPct ?? couponBarrierPct,
      status: 'scheduled',
    })
  }
  push(field('observations.count', String(observations.length), { sourceSection: 'Dates', confidence: observations.length > 0 ? 'high' : 'low', warning: observations.length > 0 ? null : 'No observation schedule extracted' }))

  // ── Structure ─────────────────────────────────────────────────────────────
  const isMemory = /Memory Digital|memory effect/i.test(joined)
  const isAutocall = /Automatic Early Redemption/i.test(joined)
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
    status: 'draft', sourceType: 'pdf_extraction', sourceName: 'Term sheet (Crédit Agricole)',
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

  return { ok: errors.length === 0, parserVersion: CREDIT_AGRICOLE_PARSER_VERSION, note, fields, warnings, errors, fieldsSeen, fieldsExtracted, fieldsLowConfidence, confidenceScore }
}

/**
 * Extracts "<pct>% (<label>)" where `label` may itself be wrapped across
 * physical lines in the source PDF (e.g. "(Early Redemption\nBarrier)") — the
 * label's internal word gaps are matched with \s+ rather than a literal
 * space so the joined (newline-preserved) text still matches.
 */
function extractLabeledBarrierPct(joined: string, label: string): { pct: number | null; rawExcerpt: string | null } {
  const labelPattern = label.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%\\s*\\(${labelPattern}\\)`, 'i')
  const m = re.exec(joined)
  return { pct: m ? Number(m[1]) / 100 : null, rawExcerpt: m?.[0] ?? null }
}

interface CaScheduleRow { valuationDate: string; paymentDate: string; barrierPct: number; rate: number }

/**
 * Extracts rows shaped "<t> <DD/MM/YYYY> <DD/MM/YYYY> <pct>% <pct>%" following
 * a given table header, stopping at the next numbered section or the end of
 * the table (a non-matching, non-empty line after at least one row).
 */
function extractCaScheduleRows(joined: string, headerRe: RegExp): CaScheduleRow[] {
  const headerMatch = headerRe.exec(joined)
  if (!headerMatch) return []
  const rest = joined.slice(headerMatch.index + headerMatch[0].length)
  const rowRe = /(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%/g
  const rows: CaScheduleRow[] = []
  let m: RegExpExecArray | null
  let lastIndex = -1
  while ((m = rowRe.exec(rest))) {
    // Stop once row indices stop increasing (we've drifted into an unrelated table).
    const idx = Number(m[1])
    if (idx <= lastIndex && rows.length > 0) break
    lastIndex = idx
    const v = parseTermSheetDate(m[2])
    const p = parseTermSheetDate(m[3])
    if (!v || !p) continue
    rows.push({ valuationDate: v, paymentDate: p, barrierPct: Number(m[4]) / 100, rate: Number(m[5]) / 100 })
    if (rows.length >= 40) break // safety bound
  }
  return rows
}
