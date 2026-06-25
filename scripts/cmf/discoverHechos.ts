// Phase 5A — CMF Hechos Esenciales conservative discovery script.
//
// Run: npm run cmf:discover-hechos
//
// Fetches ONLY the public CMF "últimos hechos esenciales" listing page and
// parses a limited sample using hechosListParser.ts. Saves output to
// tmp/cmf-hechos-discovery.json for human review.
//
// Safety rules:
//   - One HTTP request per run — never hammers CMF
//   - Hard 10-second timeout
//   - Explicit User-Agent
//   - Never runs automatically during build
//   - Never exposes credentials
//   - Fails cleanly with a clear error if the page is unavailable
//   - Does NOT write production data — tmp/ is gitignored
//
// Interpret the output:
//   parserConfidence = 1.0 → all 5 fields parsed cleanly
//   parserConfidence < 0.5 → CMF page structure may have changed
//   rawRowText     → for debugging malformed rows (never shown to users)

// @next/env is CJS — import via default, then destructure after all imports.
import pkg from '@next/env'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHechosList } from '../../src/lib/providers/cmf/parsers/hechosListParser.ts'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..', '..')
const OUTPUT_PATH = join(PROJECT_ROOT, 'tmp', 'cmf-hechos-discovery.json')

// CMF public Hechos Esenciales listing page — últimos 7 días.
// This URL is a known public CMF portal page; confirm it is still valid
// before Phase 5A.1 ingestion is enabled. Do not hard-code private endpoints.
const CMF_HECHOS_PATH = '/sitio/aplic/serdoc/ultimos_he_5.php'
const TIMEOUT_MS = 10000

async function fetchPage(baseUrl: string, path: string): Promise<string> {
  const url = `${baseUrl}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CMI-FinancialResearch/1.0 (internal buyside terminal — Phase 5A discovery)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-CL,es;q=0.9',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return await res.text()
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === 'AbortError') throw new Error(`Request timed out after ${TIMEOUT_MS}ms`)
    throw err
  }
}

async function main() {
  const baseUrl = (process.env.CMF_BASE_URL ?? 'https://www.cmfchile.cl').replace(/\/$/, '')
  console.log(`[cmf:discover-hechos] Fetching: ${baseUrl}${CMF_HECHOS_PATH}`)

  let html: string
  try {
    html = await fetchPage(baseUrl, CMF_HECHOS_PATH)
    console.log(`[cmf:discover-hechos] Received ${html.length} bytes`)
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    console.error(`[cmf:discover-hechos] Fetch failed: ${msg}`)
    console.error('[cmf:discover-hechos] This is a discovery script — check URL and connectivity, then retry.')
    process.exit(1)
  }

  const rows = parseHechosList(html)
  const highConfidence = rows.filter(r => r.parserConfidence >= 0.75).length
  const avgConfidence = rows.length > 0
    ? rows.reduce((s, r) => s + r.parserConfidence, 0) / rows.length
    : 0

  const output = {
    discoveredAt: new Date().toISOString(),
    sourceUrl: `${baseUrl}${CMF_HECHOS_PATH}`,
    rowCount: rows.length,
    highConfidenceRows: highConfidence,
    avgParserConfidence: Math.round(avgConfidence * 100) / 100,
    rows,
  }

  mkdirSync(join(PROJECT_ROOT, 'tmp'), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8')

  console.log(`[cmf:discover-hechos] Parsed ${rows.length} rows — avg confidence: ${output.avgParserConfidence}`)
  console.log(`[cmf:discover-hechos] High-confidence rows: ${highConfidence}/${rows.length}`)
  console.log(`[cmf:discover-hechos] Output written to tmp/cmf-hechos-discovery.json`)

  if (avgConfidence < 0.5 && rows.length > 0) {
    console.warn('[cmf:discover-hechos] WARNING: avg confidence < 0.5 — CMF page structure may have changed')
    console.warn('[cmf:discover-hechos] Check rawRowText in the output and update the parser before Phase 5A.1')
  }
  if (rows.length === 0) {
    console.warn('[cmf:discover-hechos] WARNING: no rows parsed — check selector strategy in hechosListParser.ts')
  }
}

main().catch(err => {
  console.error('[cmf:discover-hechos] Unexpected error:', (err as Error).message)
  process.exit(1)
})
