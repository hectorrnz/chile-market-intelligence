// Phase 9A/9B — deterministic structured-note term extraction (multi-issuer).
//
// Pure function: takes already-extracted per-page text (string[]) and returns a
// normalized note payload + per-field provenance/confidence. No PDF library, no
// Supabase, no OCR, no AI — regex/keyword anchoring against the common
// "autocallable worst-of Phoenix memory" product as issued by several banks.
//
// Handles two dominant term-sheet templates observed in the real book:
//   - US style (Citi CGMFL): labels like "Strike Date / Trade Date", dates
//     "Month DD, YYYY", underlying rows with 5 trailing levels, and two
//     separate coupon/autocall date-pair schedule blocks.
//   - EU style (HSBC / Santander / BNP / Barclays): labels like "Principal
//     Amount", "Settlement Currency", dates "DD/MM/YYYY", underlying rows with
//     3 trailing levels (initial, strike, barrier), and one combined schedule
//     table with "DD Mon YYYY" dates.
//
// Unknown templates extract what they can and are flagged for human review via
// critical-field validation — never mis-parsed into fabricated values.

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

export const PARSER_VERSION = '9B.multi.1'

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const NOISE = /Investment Products|PLEASE SEE THE DISCLAIMER|^Page \d+$|^\d+ \| \d+$/i

interface Line {
  text: string
  page: number
}

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

/**
 * Parses a date in any of the three term-sheet formats:
 *   - "June 4, 2026"      (Month DD, YYYY — US style)
 *   - "04 Sep 2026"       (DD Mon YYYY — EU schedule tables)
 *   - "03/06/2026"        (DD/MM/YYYY — EU general info; day-first)
 * Returns ISO "YYYY-MM-DD" or null.
 */
export function parseTermSheetDate(raw: string): string | null {
  const s = raw.trim()
  const iso = (y: number, m: number, d: number): string | null =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null

  // Month DD, YYYY
  let m = /([A-Za-z]{3,})\s+(\d{1,2}),\s+(\d{4})/.exec(s)
  if (m) { const mo = MONTHS[m[1].toLowerCase()]; return mo ? iso(Number(m[3]), mo, Number(m[2])) : null }

  // DD Mon YYYY
  m = /\b(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})\b/.exec(s)
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; return mo ? iso(Number(m[3]), mo, Number(m[1])) : null }

  // DD/MM/YYYY (day-first)
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s)
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]))

  return null
}

function parseNum(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

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
  if (s.includes('marex')) return 'Marex'
  if (s.includes('goldman')) return 'Goldman Sachs'
  if (s.includes('morgan stanley')) return 'Morgan Stanley'
  if (s.includes('ubs')) return 'UBS'
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

/** First line matching one of the label regexes → { value after the label, page }. */
function labelValue(lines: Line[], labels: RegExp[]): { value: string; page: number } | null {
  for (const l of lines) {
    for (const label of labels) {
      const m = label.exec(l.text)
      if (m) return { value: l.text.slice(m[0].length).trim(), page: l.page }
    }
  }
  return null
}

/** First date found after any of the given label aliases (value may be on the same line). */
function labelDate(lines: Line[], labels: RegExp[]): { iso: string; raw: string; page: number } | null {
  const lv = labelValue(lines, labels)
  if (!lv) return null
  const iso = parseTermSheetDate(lv.value)
  return iso ? { iso, raw: lv.value, page: lv.page } : null
}

const KNOWN_TICKERS = ['SPX', 'RTY', 'NDX', 'SX5E', 'SPY', 'IWM']

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
  const isinMatch = /\bISIN\s+([A-Z]{2}\d{9,10})\b/.exec(joined) ?? /\b([A-Z]{2}\d{10})\b/.exec(joined)
  const isin = isinMatch ? isinMatch[1] : null
  push(field('isin', isin, { rawExcerpt: isinMatch?.[0] ?? null, sourceSection: 'Additional Information', confidence: isin ? 'high' : 'low', warning: isin ? null : 'ISIN not found' }))

  const seriesMatch = /Series Number\s+([A-Z0-9]+)/.exec(joined) ?? /\b(CGMFL\d+)\b/.exec(joined)
  const seriesNumber = seriesMatch ? seriesMatch[1] : null
  push(field('seriesNumber', seriesNumber, { rawExcerpt: seriesMatch?.[0] ?? null }))

  // ── Issuer / guarantor / product ─────────────────────────────────────────────
  const issuerLV = labelValue(lines, [/^Issuer\s+/])
  const issuerName = issuerLV ? issuerLV.value.replace(/\s*\(.*$/, '').trim() : null
  push(field('issuerName', issuerName, { rawExcerpt: issuerLV?.value ?? null, sourcePage: issuerLV?.page ?? null, sourceSection: 'General Information', confidence: issuerName ? 'high' : 'low', warning: issuerName ? null : 'Issuer not found' }))
  const issuerDisplay = issuerName ? mapIssuerDisplay(issuerName) : null
  push(field('issuerDisplayName', issuerDisplay, { confidence: issuerDisplay ? 'high' : 'low', warning: issuerDisplay ? null : 'Issuer display name not mapped — review' }))

  const guarantorLV = labelValue(lines, [/^Guarantor\s+/])
  const guarantorName = guarantorLV ? guarantorLV.value.replace(/\s*\(.*$/, '').trim() : null
  push(field('guarantorName', guarantorName, { rawExcerpt: guarantorLV?.value ?? null }))

  const titleMatch = /([A-Z][A-Za-z0-9 ]*Notes Based Upon[^\n]*?Index)/.exec(joined)
    ?? /(Autocallable[^\n]{0,80})/i.exec(joined)
    ?? /(Memory Coupon[^\n]{0,80})/i.exec(joined)
  const productName = titleMatch ? titleMatch[1].replace(/\s*\(“Notes”\).*/, '').replace(/[®™]/g, '').trim() : null
  push(field('productName', productName, { rawExcerpt: titleMatch?.[0]?.slice(0, 120) ?? null, sourceSection: 'header', confidence: productName ? 'high' : 'low' }))

  // ── Amounts ─────────────────────────────────────────────────────────────────
  const issueSizeMatch = /(?:Issue Size|Principal Amount|Aggregate Nominal Amount)\s+([A-Z]{3})\s+([\d,]+)/i.exec(joined)
  const currencyMatch = /(?:Settlement Currency|Currency)\s+(?:[A-Za-z. ]*\()?([A-Z]{3})/i.exec(joined) ?? issueSizeMatch
  const currency = currencyMatch ? (currencyMatch[1].length === 3 ? currencyMatch[1] : 'USD') : (issueSizeMatch?.[1] ?? 'USD')
  const issueSize = issueSizeMatch ? parseNum(issueSizeMatch[2]) : null
  push(field('currency', currency, { rawExcerpt: currencyMatch?.[0] ?? null, sourceSection: 'General Information' }))
  push(field('issueSize', issueSize, { rawExcerpt: issueSizeMatch?.[0] ?? null, sourceSection: 'General Information' }))

  const denomMatch = /(?:Specified Denomination|Denomination|Calculation Amount)\s+[A-Z]{3}\s+([\d,]+)/i.exec(joined)
  const denomination = denomMatch ? parseNum(denomMatch[1]) : null
  push(field('denomination', denomination, { rawExcerpt: denomMatch?.[0] ?? null }))

  const issuePriceMatch = /Issue Price\s+(?:[A-Z]{3}\s+)?(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const issuePricePct = issuePriceMatch ? Number(issuePriceMatch[1]) / 100 : null
  push(field('issuePricePct', issuePricePct, { rawExcerpt: issuePriceMatch?.[0] ?? null }))

  // ── Dates (label aliases + multi-format) ─────────────────────────────────────
  const trade = labelDate(lines, [/^Strike Date \/ Trade Date\s+/i, /^Trade Date\s+/i])
  const issueD = labelDate(lines, [/^Issue Date\s+/i])
  const strikeD = labelDate(lines, [/^Strike Date\s+/i])
  const finalVal = labelDate(lines, [/^Final Valuation Date\s+/i])
  let maturity = labelDate(lines, [/^Maturity Date\s+/i, /^Redemption Date\s+/i])
  // Fallback: some EU templates only carry the maturity as "Due DD/MM/YYYY" in the header.
  if (!maturity) {
    const due = /\bDue\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i.exec(joined)
    const iso = due ? parseTermSheetDate(due[1]) : null
    if (iso) maturity = { iso, raw: due![1], page: 1 }
  }
  const tradeDate = trade?.iso ?? strikeD?.iso ?? null
  const issueDate = issueD?.iso ?? null
  const finalValuationDate = finalVal?.iso ?? null
  const maturityDate = maturity?.iso ?? null
  push(field('tradeDate', tradeDate, { rawExcerpt: trade?.raw ?? strikeD?.raw ?? null, sourceSection: 'General Information', confidence: tradeDate ? 'high' : 'low', warning: tradeDate ? null : 'Trade date not found' }))
  push(field('issueDate', issueDate, { rawExcerpt: issueD?.raw ?? null }))
  push(field('finalValuationDate', finalValuationDate, { rawExcerpt: finalVal?.raw ?? null }))
  push(field('maturityDate', maturityDate, { rawExcerpt: maturity?.raw ?? null, sourceSection: 'General Information', confidence: maturityDate ? 'high' : 'low', warning: maturityDate ? null : 'Maturity date not found' }))

  const seq = [tradeDate, issueDate, finalValuationDate, maturityDate].filter(Boolean) as string[]
  for (let i = 1; i < seq.length; i++) {
    if (Date.parse(seq[i]) < Date.parse(seq[i - 1])) { warnings.push('date sequence is not monotonic — review'); break }
  }

  // ── Barriers (note-level %) ──────────────────────────────────────────────────
  // Aliases across templates: Knock-In/Barrier Level (65%), Coupon Barrier/Level (65%), Autocall Barrier/Level (100%).
  const kiPct = parsePct(/(?:Knock-?In Barrier Level|Barrier Level)[^\n]*?(\d+(?:\.\d+)?\s*%)/i.exec(joined)?.[1] ?? '')
  const couponBarrierPct = parsePct(/(?:Coupon Barrier Level|Coupon Level)[^\n]*?(\d+(?:\.\d+)?\s*%)/i.exec(joined)?.[1] ?? '') ?? kiPct
  const autocallPct = parsePct(/(?:Autocall Barrier Level|Autocall Level)[^\n]*?(\d+(?:\.\d+)?\s*%)/i.exec(joined)?.[1] ?? '') ?? 1
  push(field('knockInBarrierPct', kiPct, { sourceSection: 'The Underlyings', confidence: kiPct ? 'high' : 'low', warning: kiPct ? null : 'Knock-in barrier not found' }))
  push(field('couponBarrierPct', couponBarrierPct, { confidence: couponBarrierPct ? 'high' : 'low' }))
  push(field('autocallBarrierPct', autocallPct, { confidence: autocallPct ? 'high' : 'low' }))

  // ── Coupon ────────────────────────────────────────────────────────────────────
  // Periodic: "2.5375% per quarter" (Citi) or "j × 2.5125%" / "Coupon Rate 2.5125%" (HSBC).
  const couponPeriodicMatch = /(\d+(?:\.\d+)?)\s*%\s*per quarter/i.exec(joined)
    ?? /[j×xX]\s*[×xX]?\s*(\d+(?:\.\d+)?)\s*%/.exec(joined)
    ?? /Coupon Rate[^\n]*?(\d+(?:\.\d+)?)\s*%/i.exec(joined)
  const couponRatePeriodic = couponPeriodicMatch ? Number(couponPeriodicMatch[1]) / 100 : null
  // Annualized: "10.15% per annum" or "(10.05% p.a.)" from the title.
  const couponAnnualMatch = /(?:approximately\s+)?(\d+(?:\.\d+)?)\s*%\s*(?:per annum|p\.?a\.?)/i.exec(joined)
  const couponFrequency = /per quarter|quarterly/i.test(joined) ? 'quarterly'
    : /semi-?annual/i.test(joined) ? 'semiannual'
    : /monthly/i.test(joined) ? 'monthly'
    : /per annum|annually/i.test(joined) ? 'annual'
    : 'quarterly' // default for this product family
  const periodsPerYear = frequencyToPeriodsPerYear(couponFrequency)
  const couponRateAnnualized = couponAnnualMatch ? Number(couponAnnualMatch[1]) / 100 : calculateCouponAnnualized(couponRatePeriodic, periodsPerYear)
  push(field('couponFrequency', couponFrequency, { sourceSection: 'The Payout', confidence: /per quarter|quarterly|monthly|annual/i.test(joined) ? 'high' : 'medium' }))
  push(field('couponRatePeriodic', couponRatePeriodic, { rawExcerpt: couponPeriodicMatch?.[0] ?? null, sourceSection: 'The Payout', confidence: couponRatePeriodic ? 'high' : 'low', warning: couponRatePeriodic ? null : 'Coupon rate not found' }))
  push(field('couponRateAnnualized', couponRateAnnualized, { rawExcerpt: couponAnnualMatch?.[0] ?? null, confidence: couponAnnualMatch ? 'high' : couponRateAnnualized ? 'medium' : 'low' }))

  // ── Underlyings (numeric rows with 2–5 trailing levels) ──────────────────────
  const underlyings: StructuredNoteUnderlying[] = []
  const trailingNums = /((?:\d[\d,]*\.\d+)(?:\s+\d[\d,]*\.\d+){1,4})\s*$/
  let mostRecentTicker: string | null = null
  const seen = new Set<string>()
  for (const l of lines) {
    // Track an "XXX Index" ticker on a preceding line (Citi style).
    const idxTk = /\b([A-Z]{2,5})\s+Index\b/.exec(l.text)
    if (idxTk && KNOWN_TICKERS.includes(idxTk[1])) mostRecentTicker = idxTk[1]

    const nm = trailingNums.exec(l.text)
    if (!nm) continue
    const nums = nm[1].split(/\s+/).map(parseNum).filter((x): x is number => x !== null)
    if (nums.length < 2) continue
    // Levels look like index/ETF levels (> 1), not percentages already stripped.
    if (nums.some((x) => x <= 0)) continue

    // Ticker: inline bare token on this row (HSBC) or the most-recent "XXX Index" (Citi).
    let ticker: string | null = null
    for (const t of KNOWN_TICKERS) if (new RegExp(`\\b${t}\\b`).test(l.text)) { ticker = t; break }
    if (!ticker) ticker = mostRecentTicker
    if (!ticker) continue // a numeric row we can't attribute to a known underlying — skip
    if (seen.has(ticker)) continue
    seen.add(ticker)

    const initial = nums[0] ?? null
    const strike = nums[1] ?? initial
    let knockIn: number | null = null
    let coupon: number | null = null
    let autocall: number | null = null
    if (nums.length >= 5) { knockIn = nums[2]; coupon = nums[3]; autocall = nums[4] } // Citi
    else if (nums.length === 3) { knockIn = nums[2]; coupon = nums[2] } // HSBC: initial, strike, barrier

    const sourceTicker = `${ticker} Index`
    const resolved = resolveUnderlyingSymbol(ticker) ?? resolveUnderlyingSymbol(sourceTicker)
    underlyings.push({
      underlyingOrder: underlyings.length + 1,
      underlyingName: sourceTicker,
      sourceTicker,
      bloombergTicker: sourceTicker,
      yahooSymbol: resolved?.yahooSymbol ?? null,
      assetClass: resolved?.assetClass ?? 'index',
      initialLevel: initial,
      strikeLevel: strike,
      knockInBarrierLevel: knockIn,
      couponBarrierLevel: coupon,
      autocallBarrierLevel: autocall,
      knockInBarrierPct: kiPct,
      couponBarrierPct,
      autocallBarrierPct: autocallPct,
    })
    mostRecentTicker = null
  }
  // Fill missing absolute barrier levels from strike × pct.
  for (const u of underlyings) {
    if (u.couponBarrierLevel === null) u.couponBarrierLevel = calculateBarrierLevel(u.strikeLevel ?? u.initialLevel, couponBarrierPct)
    if (u.knockInBarrierLevel === null) u.knockInBarrierLevel = calculateBarrierLevel(u.strikeLevel ?? u.initialLevel, kiPct)
    if (u.autocallBarrierLevel === null) u.autocallBarrierLevel = calculateBarrierLevel(u.strikeLevel ?? u.initialLevel, autocallPct)
  }
  push(field('underlyings.count', String(underlyings.length), { sourceSection: 'The Underlyings', confidence: underlyings.length > 0 ? 'high' : 'low', warning: underlyings.length > 0 ? null : 'No underlyings extracted' }))

  // ── Schedules ────────────────────────────────────────────────────────────────
  const observations = extractSchedule(lines, { couponRatePeriodic, couponBarrierPct, autocallPct, finalValuationDate, maturityDate })
  push(field('observations.count', String(observations.length), { sourceSection: 'Schedules', confidence: observations.length > 0 ? 'high' : 'low', warning: observations.length > 0 ? null : 'No observation schedule extracted' }))

  // ── Structure / payoff ───────────────────────────────────────────────────────
  const isWorstOf = /Worst Performing|Worst Of|Worst-Of/i.test(joined)
  const isMemory = /Memory Coupon|Phoenix Memory|previously missed interest/i.test(joined)
  const isAutocall = /Autocall|Mandatory Early Redemption|Early Redemption/i.test(joined)
  const structureType = [isWorstOf ? 'worst_of' : null, isMemory ? 'memory_coupon' : null, isAutocall ? 'autocall' : 'note'].filter(Boolean).join('_')
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
    status: 'draft', sourceType: 'pdf_extraction', sourceName: issuerDisplay ? `Term sheet (${issuerDisplay})` : 'Term sheet',
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
  void rank

  return { ok: errors.length === 0, parserVersion: PARSER_VERSION, note, fields, warnings, errors, fieldsSeen, fieldsExtracted, fieldsLowConfidence, confidenceScore }
}

// ── Schedule extraction (both templates) ───────────────────────────────────────

function extractSchedule(
  lines: Line[],
  ctx: { couponRatePeriodic: number | null; couponBarrierPct: number | null; autocallPct: number | null; finalValuationDate: string | null; maturityDate: string | null },
): StructuredNoteObservation[] {
  const observations: StructuredNoteObservation[] = []

  // Template A (Citi): two "date value date value" pair blocks under known headers.
  const datePairRe = /^([A-Za-z]+ \d{1,2}, \d{4})\s+([A-Za-z]+ \d{1,2}, \d{4})$/
  function collectPairs(headerRe: RegExp): { valuation: string; payment: string }[] {
    const idx = lines.findIndex((l) => headerRe.test(l.text))
    if (idx < 0) return []
    const pairs: { valuation: string; payment: string }[] = []
    for (let i = idx + 1; i < lines.length; i++) {
      const t = lines[i].text
      if (/^Final Valuation Date\s+Maturity Date$/i.test(t)) break
      const m = datePairRe.exec(t)
      if (m) { const v = parseTermSheetDate(m[1]); const p = parseTermSheetDate(m[2]); if (v && p) pairs.push({ valuation: v, payment: p }) }
      else if (pairs.length > 0) break
    }
    return pairs
  }
  const couponPairs = collectPairs(/^Contingent Coupon Valuation Date\s+Contingent Coupon Payment Date$/i)
  const autocallPairs = collectPairs(/^Autocall Valuation Date\s+Mandatory Early Redemption Date$/i)

  if (couponPairs.length > 0 || autocallPairs.length > 0) {
    couponPairs.forEach((pr, i) => observations.push({ observationNumber: i + 1, observationType: 'coupon', valuationDate: pr.valuation, paymentDate: pr.payment, redemptionDate: null, couponDuePct: ctx.couponRatePeriodic, autocallBarrierPct: null, couponBarrierPct: ctx.couponBarrierPct, status: 'scheduled' }))
    autocallPairs.forEach((pr, i) => observations.push({ observationNumber: i + 1, observationType: 'autocall', valuationDate: pr.valuation, paymentDate: null, redemptionDate: pr.payment, couponDuePct: null, autocallBarrierPct: ctx.autocallPct, couponBarrierPct: null, status: 'scheduled' }))
    if (ctx.finalValuationDate && ctx.maturityDate) {
      observations.push({ observationNumber: couponPairs.length + 1, observationType: 'final', valuationDate: ctx.finalValuationDate, paymentDate: ctx.maturityDate, redemptionDate: ctx.maturityDate, couponDuePct: ctx.couponRatePeriodic, autocallBarrierPct: ctx.autocallPct, couponBarrierPct: ctx.couponBarrierPct, status: 'scheduled' })
    }
    return observations
  }

  // Template B (HSBC/EU): one combined table. Each data row starts with an index j
  // and contains several "DD Mon YYYY" dates and percentages. We pull the coupon
  // valuation/payment (the last date-pair on the row) and the autocall
  // valuation/redemption (the first date-pair) when present.
  const dmy = /\d{1,2} [A-Za-z]{3,}\.? \d{4}/g
  let couponN = 0
  let autocallN = 0
  for (const l of lines) {
    if (!/^\d{1,2}\s/.test(l.text)) continue // must start with the row index j
    const dates = l.text.match(dmy)
    if (!dates || dates.length < 2) continue
    const isoDates = dates.map(parseTermSheetDate).filter((x): x is string => !!x)
    if (isoDates.length < 2) continue
    // Coupon valuation/payment = the last two dates on the row.
    const couponVal = isoDates[isoDates.length - 2]
    const couponPay = isoDates[isoDates.length - 1]
    couponN += 1
    const isFinal = isoDates.length === 2 && /(?:^|\s)-(?:\s|$)/.test(l.text) // final row has dashes in the autocall columns
    observations.push({ observationNumber: couponN, observationType: isFinal ? 'final' : 'coupon', valuationDate: couponVal, paymentDate: couponPay, redemptionDate: isFinal ? couponPay : null, couponDuePct: ctx.couponRatePeriodic, autocallBarrierPct: isFinal ? ctx.autocallPct : null, couponBarrierPct: ctx.couponBarrierPct, status: 'scheduled' })
    // Autocall valuation/redemption = the first two dates on the row (present on non-final rows).
    if (isoDates.length >= 4) {
      autocallN += 1
      observations.push({ observationNumber: autocallN, observationType: 'autocall', valuationDate: isoDates[0], paymentDate: null, redemptionDate: isoDates[1], couponDuePct: null, autocallBarrierPct: ctx.autocallPct, couponBarrierPct: null, status: 'scheduled' })
    }
  }
  return observations
}
