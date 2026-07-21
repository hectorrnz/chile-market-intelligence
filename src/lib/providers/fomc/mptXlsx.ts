// Minimal, dependency-free reader for the Atlanta Fed Market Probability
// Tracker (MPT) historical-data workbook (mpt_histdata.xlsx).
//
// SERVER-ONLY. The workbook's DATA sheet is a ~17 MB tidy/long table:
//   date | reference_start | target_range | field | value
// keyed by observation date and 3-month-SOFR reference quarter. This module
// pulls, for the LATEST observation date, the market-implied probabilities per
// reference quarter — specifically Prob: cut / Prob: hike and the concurrent
// FOMC target range. It NEVER fabricates: a shape it can't parse yields null.
//
// This is a purpose-built extractor, not a general xlsx library — it only
// understands the two constructs this one workbook uses (shared-string cells
// `t="s"` and plain numeric cells). Pure string/Buffer work, so it is fully
// unit-testable with no network.

export interface MptRow {
  /** Observation date, YYYY-MM-DD. */
  date: string
  /** Reference-quarter start (the 3-month SOFR window), YYYY-MM-DD. */
  referenceStart: string
  /** Concurrent FOMC target range string, verbatim (e.g. "400bps - 425bps"). */
  targetRange: string
  /** Statistic name, verbatim (e.g. "Prob: cut", "Prob: hike", "Rate: mode"). */
  field: string
  /** Numeric value of the statistic. */
  value: number
}

/** Parses xl/sharedStrings.xml into an index→string array. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // Concatenate every <t>…</t> run inside the shared-string item.
    let s = ''
    for (const t of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += t[1]
    out.push(decodeXmlEntities(s))
  }
  return out
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
}

/** Excel 1900-system serial date → YYYY-MM-DD (accounts for the 1900 leap bug). */
export function excelSerialToIso(serial: number): string {
  // Excel day 1 = 1900-01-01, but it wrongly treats 1900 as a leap year, so the
  // usable epoch offset is 1899-12-30.
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** Column letter(s) of a cell reference (e.g. "AB12" → "AB") → 0-based index. */
function colIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * Parses the DATA sheet's rows into MptRow[]. Columns are fixed by position:
 * 0=date(str) 1=reference_start(serial) 2=target_range(str) 3=field(str)
 * 4=value(num). `sinceIso` (optional) skips rows whose date column is a
 * shared-string earlier than it — a cheap way to parse only recent rows.
 */
export function parseDataSheet(sheetXml: string, shared: string[], sinceIso?: string): MptRow[] {
  const rows: MptRow[] = []
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    // Each cell resolves to a string (shared-string cell, t="s") or a raw
    // token (numeric cell). Column layout is fixed: 0=date 1=reference_start
    // 2=target_range 3=field 4=value. In this workbook the value AND date
    // columns are shared strings (numbers stored as text), only
    // reference_start is a numeric cell — so resolve first, coerce after.
    const cells: (string | null)[] = [null, null, null, null, null]
    for (const c of rowMatch[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g)) {
      const idx = colIndex(c[1])
      if (idx < 0 || idx > 4) continue
      const attrs = c[2]
      const raw = c[3]
      if (raw == null) { cells[idx] = null; continue }
      if (/\bt="s"/.test(attrs)) {
        const si = Number(raw)
        cells[idx] = Number.isInteger(si) ? (shared[si] ?? null) : null
      } else {
        cells[idx] = raw // numeric/inline token, coerced below
      }
    }
    const [date, refRaw, targetRange, field, valueRaw] = cells
    const refSerial = refRaw != null ? Number(refRaw) : NaN
    const value = valueRaw != null ? Number(valueRaw) : NaN
    if (typeof date !== 'string' || !Number.isFinite(refSerial) || !Number.isFinite(value)) continue
    if (typeof targetRange !== 'string' || typeof field !== 'string') continue
    if (sinceIso && date < sinceIso) continue
    rows.push({ date, referenceStart: excelSerialToIso(refSerial), targetRange, field, value })
  }
  return rows
}

export interface QuarterProbabilities {
  referenceStart: string
  targetRange: string
  /** Probability (%) the average rate falls BELOW the current target range. */
  probCut: number | null
  /** Probability (%) it falls ABOVE. */
  probHike: number | null
  /** Implied probability (%) of no change = 100 − cut − hike (clamped ≥ 0). */
  probHold: number | null
  /** Modal expected rate in basis points, if present. */
  modeBps: number | null
}

export interface MptLatest {
  date: string
  quarters: QuarterProbabilities[]
}

/**
 * Reduces MptRow[] to the latest observation date's per-quarter probabilities.
 * Returns null if no usable rows.
 */
export function summarizeLatest(rows: MptRow[]): MptLatest | null {
  if (rows.length === 0) return null
  const latestDate = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0].date)
  const byQuarter = new Map<string, { targetRange: string; fields: Map<string, number> }>()
  for (const r of rows) {
    if (r.date !== latestDate) continue
    let q = byQuarter.get(r.referenceStart)
    if (!q) { q = { targetRange: r.targetRange, fields: new Map() }; byQuarter.set(r.referenceStart, q) }
    q.fields.set(r.field, r.value)
  }
  const quarters: QuarterProbabilities[] = [...byQuarter.entries()]
    .map(([referenceStart, q]) => {
      const probCut = q.fields.get('Prob: cut') ?? null
      const probHike = q.fields.get('Prob: hike') ?? null
      const probHold = probCut != null && probHike != null ? Math.max(0, 100 - probCut - probHike) : null
      return {
        referenceStart,
        targetRange: q.targetRange,
        probCut,
        probHike,
        probHold,
        modeBps: q.fields.get('Rate: mode') ?? null,
      }
    })
    .sort((a, b) => a.referenceStart.localeCompare(b.referenceStart))
  return { date: latestDate, quarters }
}
