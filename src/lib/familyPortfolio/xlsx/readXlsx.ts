// R13.3 — scoped, dependency-free `.xlsx` reader (open decision D3).
//
// PURE MODULE except for `node:zlib` via the shared unzip reader. No Next.js,
// Supabase, environment, or filesystem import.
//
// SCOPE IS DELIBERATELY NARROW. This reads only the subset documents 02 and 03
// require: shared strings, the number-format half of styles, and cell values
// with their cached results. It is NOT a general spreadsheet library.
//
// THREE RULES CARRIED FROM THE SOURCE CONTRACTS, ALL SAFETY-CRITICAL:
//
//   1. NEVER EVALUATE A FORMULA (doc 02 § 6.2). Only the cached `<v>` is read.
//      Evaluating `TODAY()` would silently re-stamp an old workbook with the
//      server's date; resolving an external link would reach SharePoint; and
//      `_xll.BDP(...)` is Bloomberg, which this project has no relationship
//      with. The formula text is retained only so a column can be CLASSIFIED
//      (doc 02 § 3.4 B) — never computed.
//
//   2. AN ERROR CELL IS A FIRST-CLASS VALUE (doc 02 § 6.3). `t="e"` cells are
//      surfaced as errors, never coerced to 0, null, or "missing". The sample
//      workbook's Main TOTAL is `#NAME?` in the live column, and that must
//      block rather than quietly publish a wrong total.
//
//   3. `<xf>` IS MATCHED ON OPENING TAGS ONLY, WITH A COUNT ASSERTION
//      (doc 03 § 5). A combined `(?:\/>|>[\s\S]*?<\/xf>)` alternation swallows
//      runs of self-closing elements — measured 630 real entries parsed as 211,
//      after which every style lookup silently returned null. It is a
//      FAIL-SILENT defect, so the count is asserted against `cellXfs/@count`.

import { unzip, type ZipEntry } from '../../financials/xbrl/unzip.ts'
import { parseCellRef } from './cellRef.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CellValueKind = 'number' | 'text' | 'boolean' | 'error' | 'empty'

export interface XlsxCell {
  ref: string
  column: number
  row: number
  kind: CellValueKind
  /** Cached numeric value. Null unless `kind === 'number'`. */
  number: number | null
  /** Text for `text`, the error literal (e.g. `#NAME?`) for `error`. */
  text: string | null
  /** Formula source text when present. RETAINED FOR CLASSIFICATION, NEVER EVALUATED. */
  formula: string | null
  /** True when the cell's style resolves to a date number format. */
  isDateFormatted: boolean
  /** Raw fill as stored, or null when the cell is unfilled. */
  fill: FillSpec | null
}

export interface XlsxSheet {
  name: string
  /** Sparse: only cells the file actually stores. Keyed `"<row>:<col>"`. */
  cells: Map<string, XlsxCell>
  maxRow: number
  maxColumn: number
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[]
  /** True when the workbook uses the 1904 date system (Mac legacy). */
  date1904: boolean
  /** Theme palette in Excel's theme-attribute index order (may be empty). */
  themeColours: string[]
  /** Diagnostics from the styles parse — see rule 3 above. */
  styleCounts: { declared: number | null; parsed: number }
}

export type XlsxReadErrorCode =
  | 'not_a_zip'
  | 'malformed_workbook'
  | 'unsafe_xml'
  | 'style_count_mismatch'
  | 'sheet_not_found'

export type XlsxReadResult =
  | { ok: true; workbook: XlsxWorkbook }
  | { ok: false; code: XlsxReadErrorCode; detail: string }

// ---------------------------------------------------------------------------
// XML helpers — deliberately minimal, never a general XML parser
// ---------------------------------------------------------------------------

const DOCTYPE_OR_ENTITY = /<!\s*(DOCTYPE|ENTITY)/i

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    // Ampersand LAST so an encoded entity is not double-decoded.
    .replace(/&amp;/g, '&')
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag)
  if (!m) return null
  return decodeXmlText(m[2] ?? m[3] ?? '')
}

// ---------------------------------------------------------------------------
// Shared strings
// ---------------------------------------------------------------------------

/**
 * Builds the shared-string table.
 *
 * A shared string may be split across several `<t>` runs (rich text); all runs
 * of one `<si>` concatenate into a single value. `<rPh>` (phonetic) runs are
 * excluded — they are pronunciation hints, not content.
 */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml)) !== null) {
    const body = m[1]
    if (body === undefined) { out.push(''); continue }
    const withoutPhonetic = body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    let text = ''
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g
    let t: RegExpExecArray | null
    while ((t = tRe.exec(withoutPhonetic)) !== null) {
      text += t[1] === undefined ? '' : decodeXmlText(t[1])
    }
    out.push(text)
  }
  return out
}

// ---------------------------------------------------------------------------
// Styles — number formats only
// ---------------------------------------------------------------------------

/** Built-in numFmt ids that are dates or date-times (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

/**
 * True when a custom format string renders a date.
 *
 * Literal sections are stripped first so a currency format like
 * `"$"#,##0.00` — whose literal contains no date token but whose quoted text
 * might — cannot be misread. Colour/condition sections (`[Red]`, `[$-409]`)
 * are stripped for the same reason.
 */
export function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
  return /[dmyhs]/i.test(stripped) && /(d|m{1,5}|y{2,4}|h|s)/i.test(stripped)
}

/**
 * A cell fill exactly as the file stores it (doc 03 § 3.2).
 *
 * The RAW representation is preserved verbatim, never only its resolved hex, so
 * a future re-classification can be re-derived from the source (doc 03 § 3.4
 * provenance requirement).
 */
export interface FillSpec {
  rgb: string | null
  theme: number | null
  tint: number | null
  indexed: number | null
  /** `patternType`; `none` means the cell is genuinely unfilled. */
  patternType: string | null
}

export interface StyleTable {
  /** Per cellXf index: does this style render a date? */
  isDate: boolean[]
  /** Per cellXf index: the fill it points at, or null when unfilled. */
  fill: (FillSpec | null)[]
  declaredCount: number | null
}

/**
 * Parses `xl/styles.xml`'s number formats.
 *
 * See rule 3 in the file header: `<xf>` OPENING TAGS ONLY. The regex must not
 * attempt to span to a closing `</xf>`, because a self-closing run would be
 * swallowed wholesale and every subsequent style index would be wrong while
 * raising no error at all.
 */
export function parseStyles(xml: string): StyleTable {
  const customDate = new Map<number, boolean>()
  const numFmtRe = /<numFmt\b([^>]*?)\/?>/g
  let n: RegExpExecArray | null
  while ((n = numFmtRe.exec(xml)) !== null) {
    const id = Number(attr(n[1], 'numFmtId'))
    const code = attr(n[1], 'formatCode')
    if (Number.isFinite(id) && code !== null) customDate.set(id, isDateFormatCode(code))
  }

  // Scope to <cellXfs>. <cellStyleXfs> uses the same element name, and mixing
  // the two would shift every cell's style index.
  const block = /<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/.exec(xml)
  const declaredRaw = block ? attr(block[1], 'count') : null
  const declaredCount = declaredRaw === null ? null : Number(declaredRaw)
  const body = block ? block[2] : ''

  // Fills, in declaration order — `fillId` on a cellXf indexes this array.
  const fills: (FillSpec | null)[] = []
  const fillsBlock = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml)
  if (fillsBlock) {
    const fillRe = /<fill\b[^>]*>([\s\S]*?)<\/fill>|<fill\b[^>]*\/>/g
    let f: RegExpExecArray | null
    while ((f = fillRe.exec(fillsBlock[1])) !== null) {
      const inner = f[1] ?? ''
      const pat = /<patternFill\b([^>]*)/.exec(inner)
      const patternType = pat ? attr(pat[1], 'patternType') : null
      const fg = /<fgColor\b([^>]*)/.exec(inner)
      if (!fg || patternType === 'none' || patternType === null) {
        fills.push(patternType && patternType !== 'none' ? { rgb: null, theme: null, tint: null, indexed: null, patternType } : null)
        continue
      }
      const themeRaw = attr(fg[1], 'theme')
      const tintRaw = attr(fg[1], 'tint')
      const indexedRaw = attr(fg[1], 'indexed')
      fills.push({
        rgb: attr(fg[1], 'rgb'),
        theme: themeRaw === null ? null : Number(themeRaw),
        tint: tintRaw === null ? null : Number(tintRaw),
        indexed: indexedRaw === null ? null : Number(indexedRaw),
        patternType,
      })
    }
  }

  const isDate: boolean[] = []
  const fill: (FillSpec | null)[] = []
  const xfRe = /<xf\b([^>]*?)\/?>/g
  let x: RegExpExecArray | null
  while ((x = xfRe.exec(body)) !== null) {
    const id = Number(attr(x[1], 'numFmtId') ?? '0')
    isDate.push(BUILTIN_DATE_FMT_IDS.has(id) || customDate.get(id) === true)
    const fillId = Number(attr(x[1], 'fillId') ?? '0')
    fill.push(Number.isInteger(fillId) ? (fills[fillId] ?? null) : null)
  }

  return { isDate, fill, declaredCount: Number.isFinite(declaredCount) ? declaredCount : null }
}

/**
 * Parses `xl/theme/theme1.xml`'s colour scheme into Excel's THEME INDEX order.
 *
 * The `clrScheme` element order is `dk1, lt1, dk2, lt2, accent1…`, but Excel's
 * `theme=` attribute indexes `0=lt1, 1=dk1, 2=lt2, 3=dk2, 4=accent1…` — the
 * first two pairs are SWAPPED. Getting this wrong inverts light and dark and
 * would misclassify every `Distribución` (doc 03 § 3.2). The returned array is
 * already in `theme=` order, so callers index it directly.
 */
export function parseThemeColours(xml: string): string[] {
  const scheme = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml)
  if (!scheme) return []
  const byName = new Map<string, string>()
  const slotRe = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)\b[^>]*>([\s\S]*?)<\/a:\1>/g
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(scheme[1])) !== null) {
    const body = m[2]
    const srgb = /<a:srgbClr\b[^>]*\bval\s*=\s*"([0-9A-Fa-f]{6})"/.exec(body)
    const sys = /<a:sysClr\b[^>]*\blastClr\s*=\s*"([0-9A-Fa-f]{6})"/.exec(body)
    const hex = srgb?.[1] ?? sys?.[1] ?? null
    if (hex) byName.set(m[1], `#${hex.toUpperCase()}`)
  }
  // THEME-INDEX order, not document order.
  const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
  return order.map((n) => byName.get(n) ?? '')
}

// ---------------------------------------------------------------------------
// Worksheet cells
// ---------------------------------------------------------------------------

function parseSheetXml(name: string, xml: string, shared: string[], styles: StyleTable): XlsxSheet {
  const cells = new Map<string, XlsxCell>()
  let maxRow = 0
  let maxColumn = 0

  const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let m: RegExpExecArray | null
  while ((m = cRe.exec(xml)) !== null) {
    const tag = m[1]
    const body = m[2] ?? ''
    const ref = attr(tag, 'r')
    if (!ref) continue
    const pos = parseCellRef(ref)
    if (!pos) continue

    const t = attr(tag, 't') ?? 'n'
    const sIdx = Number(attr(tag, 's') ?? '0')
    const isDateFormatted = Number.isInteger(sIdx) ? styles.isDate[sIdx] === true : false
    const cellFill = Number.isInteger(sIdx) ? (styles.fill[sIdx] ?? null) : null

    const fM = /<f\b[^>]*>([\s\S]*?)<\/f>|<f\b[^>]*\/>/.exec(body)
    const formula = fM ? (fM[1] === undefined ? '' : decodeXmlText(fM[1])) : null

    const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)
    const rawV = vM ? decodeXmlText(vM[1]) : null

    let kind: CellValueKind = 'empty'
    let num: number | null = null
    let text: string | null = null

    if (t === 'e') {
      // RULE 2: an error is a value, not an absence.
      kind = 'error'
      text = rawV ?? '#ERROR'
    } else if (t === 's') {
      kind = 'text'
      const idx = rawV === null ? Number.NaN : Number(rawV)
      text = Number.isInteger(idx) && idx >= 0 && idx < shared.length ? shared[idx] : ''
    } else if (t === 'inlineStr') {
      kind = 'text'
      const isM = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)
      let s = ''
      if (isM) {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
        let tt: RegExpExecArray | null
        while ((tt = tRe.exec(isM[1])) !== null) s += decodeXmlText(tt[1])
      }
      text = s
    } else if (t === 'str') {
      kind = 'text'
      text = rawV ?? ''
    } else if (t === 'b') {
      kind = 'boolean'
      text = rawV === '1' ? 'TRUE' : 'FALSE'
    } else if (rawV !== null && rawV !== '') {
      const parsed = Number(rawV)
      if (Number.isFinite(parsed)) { kind = 'number'; num = parsed }
      else { kind = 'text'; text = rawV }
    }

    if (kind === 'empty' && formula === null) continue

    cells.set(`${pos.row}:${pos.column}`, {
      ref, column: pos.column, row: pos.row, kind, number: num, text, formula, isDateFormatted, fill: cellFill,
    })
    if (pos.row > maxRow) maxRow = pos.row
    if (pos.column > maxColumn) maxColumn = pos.column
  }

  return { name, cells, maxRow, maxColumn }
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

function entry(entries: ZipEntry[], path: string): ZipEntry | undefined {
  const lower = path.toLowerCase()
  return entries.find((e) => e.name.toLowerCase() === lower)
}

/**
 * Reads a `.xlsx` container into the narrow model above.
 *
 * The container has already passed R13.2's validation ladder when this runs in
 * the upload path; the XXE re-check here is defence in depth for any other
 * caller, and costs one regex per XML part.
 */
export function readXlsx(bytes: Buffer): XlsxReadResult {
  const archive = unzip(bytes, { maxEntries: 512, maxZipBytes: 20 * 1024 * 1024 })
  if (!archive.ok) {
    return {
      ok: false,
      code: archive.error.code === 'not_a_zip' ? 'not_a_zip' : 'malformed_workbook',
      detail: archive.error.reason,
    }
  }
  const entries = archive.entries

  for (const e of entries) {
    const n = e.name.toLowerCase()
    if (!n.endsWith('.xml') && !n.endsWith('.rels')) continue
    if (DOCTYPE_OR_ENTITY.test(e.data.toString('utf8'))) {
      return { ok: false, code: 'unsafe_xml', detail: 'an XML part declares a DOCTYPE or ENTITY' }
    }
  }

  const wbEntry = entry(entries, 'xl/workbook.xml')
  if (!wbEntry) return { ok: false, code: 'malformed_workbook', detail: 'xl/workbook.xml is missing' }
  const wbXml = wbEntry.data.toString('utf8')

  const date1904 = /\bdate1904\s*=\s*("1"|'1'|"true"|'true')/i.test(wbXml)

  const stylesEntry = entry(entries, 'xl/styles.xml')
  const styles = stylesEntry
    ? parseStyles(stylesEntry.data.toString('utf8'))
    : { isDate: [], fill: [], declaredCount: null }

  // RULE 3 — fail loudly on the fail-silent defect.
  if (styles.declaredCount !== null && styles.declaredCount !== styles.isDate.length) {
    return {
      ok: false,
      code: 'style_count_mismatch',
      detail: `cellXfs declares ${styles.declaredCount} entries but ${styles.isDate.length} were parsed`,
    }
  }

  // Relationship map: sheet r:id → part path.
  const relEntry = entry(entries, 'xl/_rels/workbook.xml.rels')
  const relTarget = new Map<string, string>()
  if (relEntry) {
    const relRe = /<Relationship\b([^>]*?)\/?>/g
    let r: RegExpExecArray | null
    const relXml = relEntry.data.toString('utf8')
    while ((r = relRe.exec(relXml)) !== null) {
      const id = attr(r[1], 'Id')
      const target = attr(r[1], 'Target')
      const mode = attr(r[1], 'TargetMode')
      // Doc 02 § 6.2: an external target is NEVER followed. Excluding it here
      // means a sheet can never resolve to a remote part.
      if (id && target && mode !== 'External') relTarget.set(id, target)
    }
  }

  const themeEntry = entry(entries, 'xl/theme/theme1.xml')
  const themeColours = themeEntry ? parseThemeColours(themeEntry.data.toString('utf8')) : []

  const sharedEntry = entry(entries, 'xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(sharedEntry.data.toString('utf8')) : []

  const sheets: XlsxSheet[] = []
  const sheetRe = /<sheet\b([^>]*?)\/?>/g
  let s: RegExpExecArray | null
  while ((s = sheetRe.exec(wbXml)) !== null) {
    const name = attr(s[1], 'name')
    const rid = attr(s[1], 'r:id') ?? attr(s[1], 'id')
    if (!name || !rid) continue
    const target = relTarget.get(rid)
    if (!target) continue
    const path = target.startsWith('/')
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, '')}`
    const sheetEntry = entry(entries, path)
    if (!sheetEntry) continue
    sheets.push(parseSheetXml(name, sheetEntry.data.toString('utf8'), shared, styles))
  }

  if (sheets.length === 0) {
    return { ok: false, code: 'sheet_not_found', detail: 'the workbook exposes no readable worksheet' }
  }

  return {
    ok: true,
    workbook: {
      sheets,
      date1904,
      themeColours,
      styleCounts: { declared: styles.declaredCount, parsed: styles.isDate.length },
    },
  }
}

// ---------------------------------------------------------------------------
// Cell access + date conversion
// ---------------------------------------------------------------------------

export function cellAt(sheet: XlsxSheet, row: number, column: number): XlsxCell | null {
  return sheet.cells.get(`${row}:${column}`) ?? null
}

/** Trimmed text of a cell, or null when it holds no text. */
export function textAt(sheet: XlsxSheet, row: number, column: number): string | null {
  const c = cellAt(sheet, row, column)
  if (!c || c.kind !== 'text') return null
  const t = c.text?.trim() ?? ''
  return t.length > 0 ? t : null
}

/**
 * Converts an Excel serial number to an ISO date (`YYYY-MM-DD`).
 *
 * The 1900 system's epoch is 1899-12-30, not 1899-12-31, because Excel treats
 * 1900 as a leap year (it was not) — the offset absorbs that historical bug and
 * is verified by the well-known serial 25569 → 1970-01-01.
 *
 * CAVEAT, deliberately not corrected: serials ≤ 59 (before 1900-03-01) are off
 * by one day under this offset, because that is the range the leap-year bug
 * actually distorts. R13 reads contemporary weekly dates only, so the range is
 * unreachable here; special-casing it would add a branch no input can exercise.
 *
 * Returns null for values outside a sane spreadsheet range rather than
 * producing a nonsense date.
 */
export function serialToIsoDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial)) return null
  if (serial < 1 || serial > 2958465) return null // 1900-01-01 … 9999-12-31
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const ms = epoch + Math.floor(serial) * 86400000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}
