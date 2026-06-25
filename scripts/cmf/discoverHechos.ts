// Phase 5A — CMF Hechos Esenciales conservative discovery script.
//
// Run: npm run cmf:discover-hechos
//
// Fetches ONLY the public CMF "últimos hechos esenciales" listing page and
// parses a limited sample using hechosListParser.ts. Saves output to
// tmp/cmf-hechos-discovery.json for human review.
//
// Safety rules:
//   - Tries a short list of candidate paths; stops at first 200 response
//   - Hard 10-second timeout per request
//   - Explicit User-Agent (ASCII only — no non-ASCII characters in headers)
//   - Never runs automatically during build
//   - Never exposes credentials
//   - Fails cleanly with a clear error if portal is unavailable or CAPTCHA-gated
//   - All output goes to tmp/ (gitignored)
//
// Phase 5A.1 findings (2026-06-25):
//   - Old /sitio/aplic/serdoc/ paths are dead (HTTP 404)
//   - Current HE page: /institucional/hechos/hechos.php
//   - That page is a CAPTCHA-gated search form → results not automatable
//   - parserConfidence = 0 expected until a CAPTCHA-free path is confirmed
//   - See docs/cmf_provider_discovery.md for full findings

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
const TMP_DIR = join(PROJECT_ROOT, 'tmp')
const OUTPUT_PATH = join(TMP_DIR, 'cmf-hechos-discovery.json')

// Candidate HE listing paths, in priority order.
// Phase 5A.1: current live URL is /institucional/hechos/hechos.php — but it is
// CAPTCHA-gated (search form), not a passive listing. Listed first as the known URL.
// Legacy /sitio/aplic/serdoc/ paths all return 404 as of 2026-06-25.
const CMF_HECHOS_CANDIDATES: string[] = [
  '/institucional/hechos/hechos.php',       // current portal (CAPTCHA-gated search form)
  '/institucional/hechos/hechos2.php',       // search results page (requires CAPTCHA params)
  '/sitio/aplic/serdoc/ultimos_he_7.php',   // legacy — 404 as of 2026-06-25
  '/sitio/aplic/serdoc/ultimos_he.php',     // legacy — 404 as of 2026-06-25
  '/sitio/aplic/serdoc/ultimos_he_5.php',   // legacy — 404 as of 2026-06-25
]

const TIMEOUT_MS = 10000

const HEADERS: Record<string, string> = {
  // User-Agent must be ASCII only — non-ASCII chars (e.g. em dash) cause ByteString errors
  'User-Agent': 'CMI-FinancialResearch/1.0 (internal buyside terminal - Phase 5A discovery)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-CL,es;q=0.9',
  'Cache-Control': 'no-cache',
}

interface FetchResult {
  ok: boolean
  body?: string
  status: number
  error?: string
}

async function tryFetch(url: string): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS, cache: 'no-store' })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, status: res.status }
    const body = await res.text()
    return { ok: true, body, status: res.status }
  } catch (err) {
    clearTimeout(timer)
    const msg = (err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message
    return { ok: false, status: 0, error: msg }
  }
}

function detectCaptcha(html: string): boolean {
  return html.includes('captcha') || html.includes('Captcha') || html.includes('CAPTCHA')
}

function detectSearchForm(html: string): boolean {
  // Check if this is just a search form with no result rows
  return html.includes('<form') && html.includes('action=') && !html.includes('<tr')
}

async function probeHEListingPage(
  baseUrl: string,
): Promise<{ html: string; resolvedPath: string; hasCaptcha: boolean } | null> {
  for (const path of CMF_HECHOS_CANDIDATES) {
    const url = `${baseUrl}${path}`
    console.log(`[cmf:discover-hechos] Trying: ${url}`)
    const result = await tryFetch(url)
    if (result.ok && result.body) {
      const hasCaptcha = detectCaptcha(result.body)
      const isSearchForm = detectSearchForm(result.body)
      console.log(
        `[cmf:discover-hechos] HTTP ${result.status} — ${result.body.length} bytes` +
        (hasCaptcha ? ' [CAPTCHA DETECTED]' : '') +
        (isSearchForm ? ' [search form, no rows]' : ''),
      )
      return { html: result.body, resolvedPath: path, hasCaptcha }
    }
    const reason = result.status === 0 ? (result.error ?? 'error') : `HTTP ${result.status}`
    console.log(`[cmf:discover-hechos] ${reason} — trying next`)
  }
  return null
}

async function main() {
  const baseUrl = (process.env.CMF_BASE_URL ?? 'https://www.cmfchile.cl').replace(/\/$/, '')
  mkdirSync(TMP_DIR, { recursive: true })

  // Probe HE listing page candidates
  const found = await probeHEListingPage(baseUrl)

  if (!found) {
    console.error('[cmf:discover-hechos] All candidates failed. Fetching homepage for structure clues...')
    const home = await tryFetch(baseUrl)
    if (home.ok && home.body) {
      writeFileSync(join(TMP_DIR, 'cmf-homepage.html'), home.body, 'utf-8')
      // Extract links mentioning hechos
      const heLinks = [...home.body.matchAll(/href=["']([^"']*(?:hechos|hecho|HE|he_)[^"']*)["']/gi)].map(m => m[1])
      if (heLinks.length > 0) {
        console.error('[cmf:discover-hechos] HE-related links found on homepage:')
        heLinks.forEach(l => console.error(`  ${l}`))
        console.error('[cmf:discover-hechos] Add these to CMF_HECHOS_CANDIDATES and retry.')
      } else {
        console.error('[cmf:discover-hechos] No HE links on homepage — portal may require JavaScript.')
      }
      console.error('[cmf:discover-hechos] Homepage saved to tmp/cmf-homepage.html')
    }
    const failReport = {
      discoveredAt: new Date().toISOString(),
      result: 'all_candidates_failed',
      candidatesTried: CMF_HECHOS_CANDIDATES,
      note: 'Update CMF_HECHOS_CANDIDATES based on tmp/cmf-homepage.html. See docs/cmf_provider_discovery.md.',
    }
    writeFileSync(OUTPUT_PATH, JSON.stringify(failReport, null, 2), 'utf-8')
    process.exit(1)
  }

  // Parse the discovered page
  const { html, resolvedPath, hasCaptcha } = found

  if (hasCaptcha) {
    console.warn('[cmf:discover-hechos] WARNING: CAPTCHA detected on this page.')
    console.warn('[cmf:discover-hechos] Automated result retrieval is blocked.')
    console.warn('[cmf:discover-hechos] See docs/cmf_provider_discovery.md §Phase 5A.2-alt for alternatives.')
    writeFileSync(join(TMP_DIR, 'cmf-raw-response.html'), html, 'utf-8')
    console.warn('[cmf:discover-hechos] Raw HTML saved to tmp/cmf-raw-response.html for inspection.')
  }

  const rows = parseHechosList(html)
  const highConfidence = rows.filter(r => r.parserConfidence >= 0.75).length
  const avgConfidence = rows.length > 0
    ? rows.reduce((s, r) => s + r.parserConfidence, 0) / rows.length
    : 0

  let result: string
  if (rows.length > 0) {
    result = 'success'
  } else if (hasCaptcha) {
    result = 'blocked_captcha'
  } else {
    result = 'parsed_zero_rows'
  }

  const output = {
    discoveredAt: new Date().toISOString(),
    result,
    resolvedPath,
    sourceUrl: `${baseUrl}${resolvedPath}`,
    captchaDetected: hasCaptcha,
    rowCount: rows.length,
    highConfidenceRows: highConfidence,
    avgParserConfidence: Math.round(avgConfidence * 100) / 100,
    rows,
    note: hasCaptcha
      ? 'CAPTCHA gates all results. See docs/cmf_provider_discovery.md §Phase 5A.2-alt.'
      : rows.length === 0
        ? 'Page found but 0 rows parsed. Inspect tmp/cmf-raw-response.html and update parser.'
        : undefined,
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`[cmf:discover-hechos] Working URL: ${resolvedPath}`)
  console.log(`[cmf:discover-hechos] Result: ${result}`)
  console.log(`[cmf:discover-hechos] Rows: ${rows.length} | Avg confidence: ${output.avgParserConfidence}`)
  console.log(`[cmf:discover-hechos] Output: tmp/cmf-hechos-discovery.json`)

  if (result === 'blocked_captcha') {
    // Exit non-zero so the caller knows live ingestion is blocked
    process.exitCode = 2
  }
}

main().catch(err => {
  console.error('[cmf:discover-hechos] Unexpected error:', (err as Error).message)
  process.exit(1)
})
