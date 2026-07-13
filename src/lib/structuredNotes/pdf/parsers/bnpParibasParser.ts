// Phase 9C — BNP Paribas parser ("Phoenix Snowball" certificate family).
//
// Distinctive format vs the generic Citi/HSBC parser:
//   - Ordinal dates throughout: "April 09th, 2025" (handled generically by
//     `parseTermSheetDate`'s ordinal-stripping — no special-casing needed here).
//   - Many labels wrap mid-phrase across physical lines (e.g. "Redemption
//     Valuation" / "Date October 09th, 2026") — every label lookup here goes
//     through the wrap-tolerant `extractAfterLabel`/`labelDateJoined` helpers
//     rather than the per-line `labelValue`/`labelDate`.
//   - The underlying table row IS a single clean physical line and directly
//     gives absolute initial/knock-in/autocall/coupon-barrier LEVELS per
//     underlying (no percentage-of-strike computation needed): e.g.
//     "1 Russell 2000 RTY 1913.16 1,243.55 1,913.163 1,243.556 FTSE ...".
//   - A single barrier percentage (65%) is used for BOTH the knock-in and
//     coupon conditions in this product; autocall is 100%.

import type { ExtractedField, StructuredNote, StructuredNoteObservation, StructuredNoteUnderlying } from '../../types.ts'
import { calculateCouponAnnualized, frequencyToPeriodsPerYear } from '../../calculations.ts'
import { resolveUnderlyingSymbol } from '../../underlyingSymbolMap.ts'
import { extractIsin, field, labelDateJoined, labelValue, mapIssuerDisplay, parseNum, parseTermSheetDate, yearsBetweenIsoDates } from './shared.ts'
import type { IssuerParser } from './types.ts'

export const BNP_PARIBAS_PARSER_VERSION = '9C.bnpParibas.2'

export const parseBnpParibas: IssuerParser = (ctx) => {
  const { lines, joined } = ctx
  const fields: ExtractedField<unknown>[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const push = (f: ExtractedField<unknown>) => { fields.push(f); return f.value }

  const { isin, rawExcerpt: isinExcerpt } = extractIsin(joined)
  push(field('isin', isin, { rawExcerpt: isinExcerpt, sourceSection: 'Form Clearing System', confidence: isin ? 'high' : 'low', warning: isin ? null : 'ISIN not found' }))

  // Issuer/Guarantor fit on one physical line each — per-line lookup is safe here.
  const issuerLV = labelValue(lines, [/^Issuer\s+/])
  const issuerName = issuerLV ? issuerLV.value.replace(/\s*\(.*$/, '').trim() : null
  push(field('issuerName', issuerName, { rawExcerpt: issuerLV?.value ?? null, sourcePage: issuerLV?.page ?? null, sourceSection: 'header', confidence: issuerName ? 'high' : 'low', warning: issuerName ? null : 'Issuer not found' }))
  const issuerDisplay = issuerName ? mapIssuerDisplay(issuerName) : (/bnp paribas/i.test(joined) ? 'BNP Paribas' : null)
  push(field('issuerDisplayName', issuerDisplay, { confidence: issuerDisplay ? 'high' : 'low' }))

  const guarantorLV = labelValue(lines, [/^Guarantor\s+/])
  const guarantorName = guarantorLV ? guarantorLV.value.replace(/\s*\(.*$/, '').trim() : null
  push(field('guarantorName', guarantorName, { rawExcerpt: guarantorLV?.value ?? null }))

  const titleMatch = /(\d+M\s+Phoenix\s+Snowball[^\n]{0,80})/i.exec(joined) ?? /(Phoenix\s+Snowball[^\n]{0,80})/i.exec(joined)
  const productName = titleMatch ? titleMatch[0].replace(/\s+/g, ' ').trim() : (isin ? `Structured Note ${isin}` : 'Structured Note')
  push(field('productName', productName, { rawExcerpt: titleMatch?.[0] ?? null, confidence: titleMatch ? 'high' : 'medium' }))

  // ── Amounts ──────────────────────────────────────────────────────────────
  const issueAmountM = /Issue\s+Amount\s+([A-Z]{3})\s+([\d,]+)/i.exec(joined)
  const currency = issueAmountM?.[1] ?? (labelValue(lines, [/^Currency\s+/])?.value.trim() ?? 'USD')
  push(field('currency', currency, { rawExcerpt: issueAmountM?.[0] ?? null, sourceSection: 'header' }))
  push(field('issueSize', issueAmountM ? parseNum(issueAmountM[2]) : null, { rawExcerpt: issueAmountM?.[0] ?? null }))

  // "1 Certificate = USD 1,000" — the per-certificate notional / denomination.
  const denomM = /1\s+Certificate\s*=\s*([A-Z]{3})\s+([\d,]+)/i.exec(joined)
  push(field('denomination', denomM ? parseNum(denomM[2]) : null, { rawExcerpt: denomM?.[0] ?? null }))

  const issuePriceM = /Issue\s+Price\s+per\s+Certificate\s+(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const issuePricePct = issuePriceM ? Number(issuePriceM[1]) / 100 : null
  push(field('issuePricePct', issuePricePct, { rawExcerpt: issuePriceM?.[0] ?? null }))

  // ── Dates (ordinal "Month DDth, YYYY"; several labels wrap mid-phrase) ────
  const trade = labelDateJoined(joined, 'Trade Date')
  const issueD = labelDateJoined(joined, 'Issue Date')
  // "Redemption Valuation Date" must be looked up BEFORE the plain "Redemption
  // Date" (the final maturity label) — they share a prefix, but \s+ between
  // "Redemption" and "Date" in the plain-label regex will NOT match across
  // the word "Valuation", so the two never collide.
  const finalVal = labelDateJoined(joined, 'Redemption Valuation Date')
  const maturity = labelDateJoined(joined, 'Redemption Date')
  const tradeDate = trade?.iso ?? null
  const issueDate = issueD?.iso ?? null
  const finalValuationDate = finalVal?.iso ?? null
  const maturityDate = maturity?.iso ?? null
  push(field('tradeDate', tradeDate, { rawExcerpt: trade?.raw ?? null, sourceSection: 'header', confidence: tradeDate ? 'high' : 'low', warning: tradeDate ? null : 'Trade date not found' }))
  push(field('issueDate', issueDate, { rawExcerpt: issueD?.raw ?? null }))
  push(field('finalValuationDate', finalValuationDate, { rawExcerpt: finalVal?.raw ?? null }))
  push(field('maturityDate', maturityDate, { rawExcerpt: maturity?.raw ?? null, sourceSection: 'header', confidence: maturityDate ? 'high' : 'low', warning: maturityDate ? null : 'Maturity date not found' }))

  // ── Barriers (note-level %) ───────────────────────────────────────────────
  // Two BNP templates observed: the memory-coupon "Phoenix Snowball" (labels
  // "Knock-in Level"/coupon-barrier prose above) and the zero-coupon
  // "Autocallable Certificate Plus"/Catapult template, which states its single
  // barrier inline in the underlying row as "Kick-out Level" (see the
  // underlying-row fallback below) rather than as a standalone label.
  const autocallM = /Automatic\s+Early\s+i\s+(\d+(?:\.\d+)?)\s*%\s*x\s*Index/i.exec(joined)
  const knockInM = /Knock-?in\s+Level\w*\s+(\d+(?:\.\d+)?)\s*%\s*x\s*Index/i.exec(joined)
  const couponBarrierM = /greater\s+than\s+or\s+equal\s+to\s+(\d+(?:\.\d+)?)\s*%\s*of\s+Indexi?Initial/i.exec(joined)
  const autocallPct = autocallM ? Number(autocallM[1]) / 100 : 1
  let knockInPct = knockInM ? Number(knockInM[1]) / 100 : null
  let couponBarrierPct = couponBarrierM ? Number(couponBarrierM[1]) / 100 : knockInPct
  push(field('knockInBarrierPct', knockInPct, { rawExcerpt: knockInM?.[0] ?? null, sourceSection: 'Automatic Early Redemption', confidence: knockInPct !== null ? 'high' : 'low', warning: knockInPct !== null ? null : 'Knock-in barrier not found' }))
  push(field('couponBarrierPct', couponBarrierPct, { rawExcerpt: couponBarrierM?.[0] ?? null, confidence: couponBarrierM ? 'high' : couponBarrierPct !== null ? 'medium' : 'low' }))
  push(field('autocallBarrierPct', autocallPct, { rawExcerpt: autocallM?.[0] ?? null, confidence: autocallM ? 'high' : 'medium' }))

  // ── Coupon: "N x 3.41% x (1 + T)" (Phoenix Snowball memory coupon) ─────────
  const couponM = /N\s*x\s*(\d+(?:\.\d+)?)\s*%\s*x\s*\(\s*1\s*\+\s*T\s*\)/i.exec(joined)
  const couponRatePeriodic = couponM ? Number(couponM[1]) / 100 : null
  const couponFrequency: string | null = couponM ? 'quarterly' : null // confirmed by the ~3-month spacing of the schedule rows below
  let couponRateAnnualized = couponM ? calculateCouponAnnualized(couponRatePeriodic, frequencyToPeriodsPerYear(couponFrequency)) : null
  let couponRatePeriodicExcerpt = couponM?.[0] ?? null
  // Fallback: the "Autocallable Certificate Plus"/Catapult template has NO
  // periodic coupon at all — the entire return is a single fixed premium paid
  // if/when the note autocalls, e.g. "N x 113.70%". This is genuinely absent,
  // not unextracted, so it is reported as `couponRateAnnualized` (the
  // return-if-called) with `couponRatePeriodic`/`couponFrequency` left null —
  // never fabricate a periodic rate the term sheet doesn't have.
  //
  // BUG FIX: "N x 113.70%" is the TOTAL Automatic Early Redemption Amount —
  // it bundles the 100% principal repayment together with the premium, e.g.
  // 113.70% = 100% principal + 13.70% premium. A prior version of this parser
  // used the raw 113.70% directly as the coupon rate, producing an impossible
  // >100% p.a. "coupon" (caught via a real uploaded document — see
  // tests/structuredNotesBnpParser.test.ts). The premium is the multiplier
  // minus the bundled 100% principal, then annualized over the time from
  // trade date to the autocall observation date (the date this premium is
  // actually paid on) — not treated as already-annualized at face value,
  // since a note whose first call date isn't ~1 year out would otherwise
  // silently misstate the true annual rate.
  let isZeroCouponAutocallPremium = false
  let couponAnnualizationWarning: string | null = null
  if (!couponM) {
    const premiumM = /\bN\s*x\s*(\d+(?:\.\d+)?)\s*%/i.exec(joined)
    if (premiumM) {
      isZeroCouponAutocallPremium = true
      const totalRedemptionPct = Number(premiumM[1]) / 100
      const premiumPct = totalRedemptionPct - 1
      const aerDateM = /If,\s+on\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th),\s+\d{4}),/i.exec(joined)
      const aerObservationDate = aerDateM ? parseTermSheetDate(aerDateM[1]) : null
      const yearsToObservation = yearsBetweenIsoDates(tradeDate ?? issueDate, aerObservationDate)
      if (yearsToObservation !== null) {
        couponRateAnnualized = premiumPct / yearsToObservation
      } else {
        couponRateAnnualized = premiumPct
        couponAnnualizationWarning = 'Could not determine time to the autocall observation date — reporting the raw redemption premium, not a true annualized rate'
      }
      couponRatePeriodicExcerpt = premiumM[0]
    }
  }
  push(field('couponFrequency', couponFrequency, { confidence: couponFrequency ? 'medium' : 'low' }))
  push(field('couponRatePeriodic', couponRatePeriodic, {
    rawExcerpt: couponRatePeriodicExcerpt,
    confidence: couponRatePeriodic !== null ? 'high' : isZeroCouponAutocallPremium ? 'medium' : 'low',
    warning: couponRatePeriodic !== null ? null : isZeroCouponAutocallPremium ? 'No periodic coupon in this product — return paid as a single autocall premium (see couponRateAnnualized)' : 'Coupon rate not found',
  }))
  push(field('couponRateAnnualized', couponRateAnnualized, {
    confidence: couponAnnualizationWarning ? 'low' : couponRateAnnualized !== null ? 'medium' : 'low',
    warning: couponAnnualizationWarning,
  }))

  // ── Underlyings — clean single-line table row with absolute levels ──────
  // "<n> <Name> <TICKER> <initial> <knockIn> <autocall> <couponBarrier> <sponsor...>"
  const underlyings: StructuredNoteUnderlying[] = []
  const rowRe = /(\d+)\s+([A-Za-z0-9&®' .]+?)\s+([A-Z]{2,6})\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(joined))) {
    const ticker = m[3]
    const initial = parseNum(m[4])
    const knockIn = parseNum(m[5])
    const autocall = parseNum(m[6])
    const couponBarrier = parseNum(m[7])
    if (initial === null || initial <= 0) continue
    const sourceTicker = `${ticker} Index`
    const resolved = resolveUnderlyingSymbol(ticker) ?? resolveUnderlyingSymbol(sourceTicker)
    underlyings.push({
      underlyingOrder: underlyings.length + 1,
      underlyingName: sourceTicker, sourceTicker, bloombergTicker: sourceTicker,
      yahooSymbol: resolved?.yahooSymbol ?? null, assetClass: resolved?.assetClass ?? 'index',
      initialLevel: initial, strikeLevel: initial,
      knockInBarrierLevel: knockIn, couponBarrierLevel: couponBarrier, autocallBarrierLevel: autocall,
      knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    })
  }
  // Fallback: the "Autocallable Certificate Plus"/Catapult template has a
  // single-underlying cover-table row with the ticker inline in "(Bloomberg:
  // XXX)" and barrier percentages inline in parens next to each level, e.g.
  // "S&P 500® (Bloomberg: SPX) 5,074.08 5,074.08 (100%) 3,298.15 (65%)" —
  // structurally different from the compressed multi-underlying table above
  // (no leading row index, no separate absolute coupon-barrier column).
  if (underlyings.length === 0) {
    const singleRowRe = /([A-Za-z0-9&®'.]+(?:\s+[A-Za-z0-9&®'.]+)*?)\s*\(Bloomberg:\s*([A-Z]{2,6})\)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s*\((\d+(?:\.\d+)?)%\)\s+([\d,]+\.\d+)\s*\((\d+(?:\.\d+)?)%\)/i
    const sm2 = singleRowRe.exec(joined)
    if (sm2) {
      const ticker = sm2[2]
      const initial = parseNum(sm2[3])
      const strike = parseNum(sm2[4])
      const strikePct = Number(sm2[5]) / 100
      const kickOut = parseNum(sm2[6])
      const kickOutPct = Number(sm2[7]) / 100
      if (initial !== null && initial > 0) {
        const sourceTicker = `${ticker} Index`
        const resolved = resolveUnderlyingSymbol(ticker) ?? resolveUnderlyingSymbol(sourceTicker)
        // A single global barrier (the Kick-out Level) plays the same role
        // this parser's other fields call "knock-in"/"coupon barrier" — never
        // leave the note-level barrier fields null just because this
        // template states it inline instead of as a standalone label.
        if (knockInPct === null) knockInPct = kickOutPct
        if (couponBarrierPct === null) couponBarrierPct = kickOutPct
        underlyings.push({
          underlyingOrder: 1,
          underlyingName: sourceTicker, sourceTicker, bloombergTicker: sourceTicker,
          yahooSymbol: resolved?.yahooSymbol ?? null, assetClass: resolved?.assetClass ?? 'index',
          initialLevel: initial, strikeLevel: strike,
          knockInBarrierLevel: kickOut, couponBarrierLevel: kickOut, autocallBarrierLevel: strike,
          knockInBarrierPct: kickOutPct, couponBarrierPct: kickOutPct, autocallBarrierPct: strikePct,
        })
      }
    }
  }
  push(field('underlyings.count', String(underlyings.length), { sourceSection: 'Term Sheet', confidence: underlyings.length > 0 ? 'high' : 'low', warning: underlyings.length > 0 ? null : 'No underlyings extracted' }))

  // ── Schedule — clean single-line rows: "<t> <date> <date> <date>" (valuation, autocall redemption, coupon payment) ──
  const observations: StructuredNoteObservation[] = []
  const scheduleRowRe = /(\d+)\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th),\s+\d{4})\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th),\s+\d{4})\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th),\s+\d{4})/g
  let sm: RegExpExecArray | null
  let n = 0
  while ((sm = scheduleRowRe.exec(joined))) {
    const valuation = parseTermSheetDate(sm[2])
    const autocallDate = parseTermSheetDate(sm[3])
    const couponPay = parseTermSheetDate(sm[4])
    if (!valuation || !couponPay) continue
    n += 1
    observations.push({
      observationNumber: n, observationType: 'coupon',
      valuationDate: valuation, paymentDate: couponPay, redemptionDate: autocallDate ?? couponPay,
      couponDuePct: couponRatePeriodic, autocallBarrierPct: autocallPct, couponBarrierPct,
      status: 'scheduled',
    })
  }
  // Fallback: the "Autocallable Certificate Plus"/Catapult template has no
  // periodic schedule table at all — its single early-redemption opportunity
  // is stated only in prose: "If, on April 06th, 2026, the official closing
  // level ... redeem each Certificate on April 13th, 2026 at ...". Extract it
  // as one 'autocall' observation rather than silently dropping the note's
  // only interim observation date.
  if (observations.length === 0) {
    const aerProseM = /If,\s+on\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th),\s+\d{4}),[^]*?redeem\s+each\s+Certificate\s+on\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th),\s+\d{4})/i.exec(joined)
    if (aerProseM) {
      const aerValuation = parseTermSheetDate(aerProseM[1])
      const aerRedemption = parseTermSheetDate(aerProseM[2])
      if (aerValuation && aerRedemption) {
        observations.push({
          observationNumber: observations.length + 1, observationType: 'autocall',
          valuationDate: aerValuation, paymentDate: aerRedemption, redemptionDate: aerRedemption,
          couponDuePct: null, autocallBarrierPct: autocallPct, couponBarrierPct: null,
          status: 'scheduled',
        })
      }
    }
  }
  if (finalValuationDate && maturityDate && (observations.length === 0 || observations[observations.length - 1].valuationDate !== finalValuationDate)) {
    observations.push({
      observationNumber: observations.length + 1, observationType: 'final',
      valuationDate: finalValuationDate, paymentDate: maturityDate, redemptionDate: maturityDate,
      couponDuePct: couponRatePeriodic, autocallBarrierPct: autocallPct, couponBarrierPct: knockInPct ?? couponBarrierPct,
      status: 'scheduled',
    })
  }
  push(field('observations.count', String(observations.length), { sourceSection: 'schedule', confidence: observations.length > 0 ? 'high' : 'low', warning: observations.length > 0 ? null : 'No observation schedule extracted' }))

  // ── Structure ─────────────────────────────────────────────────────────────
  const isMemory = /Snowball|previously\s+paid\s+coupons|\(1\s*\+\s*T\)/i.test(joined)
  const isAutocall = /Automatic Early Redemption/i.test(joined)
  const structureType = ['worst_of', isMemory ? 'memory_coupon' : null, isAutocall ? 'autocall' : 'note'].filter(Boolean).join('_')
  push(field('structureType', structureType, { confidence: isAutocall ? 'high' : 'medium' }))

  const note: StructuredNote = {
    isin, productName, issuerName, issuerDisplayName: issuerDisplay, guarantorName,
    structureType: structureType || 'note', payoffType: null, currency,
    issueSize: issueAmountM ? parseNum(issueAmountM[2]) : null,
    denomination: denomM ? parseNum(denomM[2]) : null, issuePricePct,
    tradeDate, issueDate, initialValuationDate: tradeDate, finalValuationDate, maturityDate, redemptionDate: maturityDate,
    couponFrequency, couponRatePeriodic, couponRateAnnualized,
    memoryCoupon: isMemory, principalProtection: false,
    knockInBarrierPct: knockInPct, couponBarrierPct, autocallBarrierPct: autocallPct,
    status: 'draft', sourceType: 'pdf_extraction', sourceName: 'Term sheet (BNP Paribas)',
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

  return { ok: errors.length === 0, parserVersion: BNP_PARIBAS_PARSER_VERSION, note, fields, warnings, errors, fieldsSeen, fieldsExtracted, fieldsLowConfidence, confidenceScore }
}
