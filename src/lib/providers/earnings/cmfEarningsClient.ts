// CMF earnings-calendar client — SERVER-ONLY.
//
// Fetches CMF's public "Fechas de envío de EEFF" page and parses its single
// table of every issuer's financial-statement sending dates. No CAPTCHA, no
// login, no API key. Dependency-free (no HTML/date library) so it can run
// under Node's native test runner directly — the pure parser
// (`parseCmfEarningsTable`) takes a raw HTML string and is fully unit-testable
// with no network.
//
// The page renders the selected year's table server-side in response to a POST
// with `aaaa=<year>` (the year <select name="aaaa">), submitting to itself.

const CMF_EARNINGS_URL =
  'https://www.cmfchile.cl/institucional/mercados/novedades_envio_fechas_eeff.php'

/** One issuer's row from the CMF calendar. Dates are YYYY-MM-DD or null ('-'). */
export interface CmfEarningsRow {
  razonSocial: string
  /** RUT exactly as CMF prints it, with check digit (e.g. "97004000-5"). */
  rut: string
  /** RUT without the check digit — the join key against CMF_EARNINGS_CALENDAR_MAP. */
  rutPrefix: string
  q1Mar: string | null
  q2Jun: string | null
  q3Sep: string | null
  annualDec: string | null
}

/** Converts CMF's DD/MM/YYYY (or '-') to YYYY-MM-DD (or null). */
export function parseCmfDate(cell: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cell.trim())
  if (!m) return null
  const [, dd, mm, yyyy] = m
  // Reject an impossible date rather than emit a malformed ISO string.
  const month = Number(mm)
  const day = Number(dd)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Parses the CMF EEFF-dates table out of the page HTML into issuer rows.
 * Pure — no network. Returns [] if the table shape isn't found (treated by the
 * caller as an unavailable fetch, never as fabricated data).
 */
export function parseCmfEarningsTable(html: string): CmfEarningsRow[] {
  const tbodyStart = html.indexOf('<tbody>')
  const tbodyEnd = html.indexOf('</tbody>')
  if (tbodyStart === -1 || tbodyEnd === -1 || tbodyEnd < tbodyStart) return []
  const tbody = html.slice(tbodyStart, tbodyEnd)

  const rows: CmfEarningsRow[] = []
  for (const trMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)(?=<tr|$)/g)) {
    const cells = [...trMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      c[1].replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    )
    if (cells.length < 6) continue
    const rut = cells[1].trim()
    if (!/^\d{4,9}-[0-9kK]$/.test(rut)) continue // skip header/garbage rows
    rows.push({
      razonSocial: cells[0].trim(),
      rut,
      rutPrefix: rut.split('-')[0].replace(/\./g, ''),
      q1Mar: parseCmfDate(cells[2]),
      q2Jun: parseCmfDate(cells[3]),
      q3Sep: parseCmfDate(cells[4]),
      annualDec: parseCmfDate(cells[5]),
    })
  }
  return rows
}

export type CmfFetcher = (year: number) => Promise<string>

// A full, realistic desktop-browser UA + headers. CMF's edge (like FRED's and
// the Atlanta Fed's Akamai WAF) rejects/stalls requests with a bare or
// "compatible; bot" UA — verified live: Yahoo and the Atlanta Fed workbook both
// succeed from Vercel with a real browser UA, while a "compatible" UA failed
// against CMF specifically. Match the pattern that works.
const BROWSER_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
  Referer: CMF_EARNINGS_URL,
} as const

/** Default network fetcher — POSTs aaaa=<year> and returns the response HTML. Retries once. */
export async function defaultCmfFetch(year: number): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(CMF_EARNINGS_URL, {
        method: 'POST',
        headers: BROWSER_HEADERS,
        body: `aaaa=${encodeURIComponent(String(year))}`,
        // CMF's full-table response is large (~230 KB) and genuinely slow
        // (~15 s observed live), so allow real time; the two years are fetched
        // in parallel and the route's maxDuration is raised to match, and the
        // 6h server cache means only the rare cache-miss ever waits this long.
        signal: AbortSignal.timeout(22_000),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`CMF earnings calendar HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('CMF earnings calendar fetch failed')
}

/** Fetches and parses one year's CMF earnings calendar. */
export async function fetchCmfEarningsYear(
  year: number,
  fetcher: CmfFetcher = defaultCmfFetch,
): Promise<CmfEarningsRow[]> {
  const html = await fetcher(year)
  return parseCmfEarningsTable(html)
}
