// Phase 5A — CMF Hechos Esenciales listing page parser.
//
// Parses HTML from the CMF public portal listing page (últimos 7 días or similar).
// Designed to be robust:
//   - Handles whitespace variations, missing links, malformed rows
//   - Never throws on a bad row — logs confidence and skips
//   - Returns a ParsedHechoRow[] with parserConfidence per row
//   - Stateless, pure functions — safe to test with static fixture HTML
//
// Expected table column order: Fecha | Hora | Nro. Documento | Entidad | Materia

export interface ParsedHechoRow {
  date: string | null          // YYYY-MM-DD
  time: string | null          // HH:MM
  documentNumber: string | null
  entityName: string | null
  subject: string | null
  sourceUrl: string | null     // URL to the CMF filing page (from Nro. Documento link)
  documentUrl: string | null   // Direct PDF URL if extractable
  /** 1.0 = all 5 fields present, 0.8 = 4 fields, etc. */
  parserConfidence: number
  /** Raw text of the row for local debugging. Never shown to end users. */
  rawRowText: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Extract href from the first <a> tag in an HTML fragment. */
function extractHref(html: string): string | null {
  const m = html.match(/<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/i)
  return m ? m[1].trim() : null
}

/** Parse a Spanish DD-MM-YYYY date string to YYYY-MM-DD. */
export function parseCmfDate(raw: string): string | null {
  const trimmed = raw.trim()
  // DD-MM-YYYY
  const m = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return null
}

/** Parse HH:MM time string. */
export function parseCmfTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/** Extract cells from a <tr> HTML fragment. Returns array of cell HTML strings. */
function extractCells(trHtml: string): string[] {
  const cells: string[] = []
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(trHtml)) !== null) {
    cells.push(match[1])
  }
  return cells
}

/** Extract all <tr> HTML strings from a <tbody> fragment. */
function extractRows(html: string): string[] {
  const rows: string[] = []
  // Try to isolate tbody first, fall back to full HTML
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)
  const body = tbodyMatch ? tbodyMatch[1] : html
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    // Skip header rows (contain <th>)
    if (/<th/i.test(match[1])) continue
    rows.push(match[0])
  }
  return rows
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse the full HTML of a CMF Hechos Esenciales listing page.
 * Returns one ParsedHechoRow per data row; bad rows have low confidence.
 * Never throws — malformed rows are returned with confidence 0.
 */
export function parseHechosList(html: string): ParsedHechoRow[] {
  const rows = extractRows(html)
  return rows.map(rowHtml => parseHechosRow(rowHtml))
}

/**
 * Parse a single table row HTML fragment.
 * Column order expected: Fecha | Hora | Nro. Documento | Entidad | Materia
 */
export function parseHechosRow(rowHtml: string): ParsedHechoRow {
  const rawRowText = stripHtml(rowHtml).slice(0, 300)
  try {
    const cells = extractCells(rowHtml)
    if (cells.length < 4) {
      return { date: null, time: null, documentNumber: null, entityName: null, subject: null, sourceUrl: null, documentUrl: null, parserConfidence: 0, rawRowText }
    }

    const [dateCell, timeCell, docCell, entityCell, subjectCell] = cells

    const date = parseCmfDate(stripHtml(dateCell ?? ''))
    const time = parseCmfTime(stripHtml(timeCell ?? ''))

    // Nro. Documento — may be wrapped in <a href="...">
    const href = docCell ? extractHref(docCell) : null
    const docNumRaw = stripHtml(docCell ?? '').replace(/\D/g, '').trim()
    const documentNumber = docNumRaw.length > 0 ? docNumRaw : null
    const sourceUrl = href ? resolveUrl(href) : null

    // Entidad
    const entityName = stripHtml(entityCell ?? '').trim() || null

    // Materia / subject
    const subject = subjectCell !== undefined ? stripHtml(subjectCell).trim() || null : null

    // documentUrl: look for a PDF link anywhere in the row
    const pdfMatch = rowHtml.match(/href\s*=\s*["']([^"']+\.pdf[^"']*?)["']/i)
    const documentUrl = pdfMatch ? resolveUrl(pdfMatch[1]) : null

    const presentCount = [date, documentNumber, entityName, subject].filter(Boolean).length
    const parserConfidence = presentCount / 4

    return { date, time, documentNumber, entityName, subject, sourceUrl, documentUrl, parserConfidence, rawRowText }
  } catch {
    return { date: null, time: null, documentNumber: null, entityName: null, subject: null, sourceUrl: null, documentUrl: null, parserConfidence: 0, rawRowText }
  }
}

/** Resolve a CMF relative URL to an absolute URL. */
function resolveUrl(href: string): string {
  if (href.startsWith('http')) return href
  const base = 'https://www.cmfchile.cl'
  return href.startsWith('/') ? `${base}${href}` : `${base}/${href}`
}
