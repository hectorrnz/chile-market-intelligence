// Phase 8C.4 — CMF/XBRL coverage discovery sweep (read-only, no writes).
//
// Classifies every app stock into the CMF/XBRL coverage funnel and, with
// --live, cross-checks each stock's legal name against CMF's own official
// securities-issuer directory (sa_eeff_ifrs_index.php sociedad[] dropdown) to
// surface directory-verified RUTs for names not yet in the issuer map.
//
// Usage:
//   npm run discover:cmf-coverage            # pure classification funnel (no network)
//   npm run discover:cmf-coverage -- --live  # + live CMF directory cross-check
//
// Never writes to Supabase. Never downloads XBRL. Sanitized output only — no
// secrets. This is a research aid: it reports candidates; a human still
// verifies the full entidad.php → XBRL chain (npm run ingest:cmf-financials:dry
// -- --ticker <T>) before any ticker is enabled in cmfIssuerMap.ts.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildCmfCoverageReport } from '../../src/lib/financials/cmfCoverage.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const companiesPath = join(__dirname, '..', '..', 'src', 'data', 'companies.json')

interface Company { ticker: string; sector?: string; legalName?: string; name?: string }

function loadCompanies(): Company[] {
  return JSON.parse(readFileSync(companiesPath, 'utf8'))
}

const CMF_DIR_URL = 'https://www.cmfchile.cl/institucional/estadisticas/merc_valores/sa_eeff_ifrs/sa_eeff_ifrs_index.php?lang=es&rg_rf=RVEMI'

function decodeEntities(s: string): string {
  return s
    .replace(/&ntilde;/g, 'ñ').replace(/&Ntilde;/g, 'Ñ').replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
}

function normName(s: string): string {
  return s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\bS\.?A\.?C\.?I\.?\b/g, 'SACI').replace(/\bS\.?A\.?\b/g, 'SA')
    .replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()
}

async function fetchDirectory(): Promise<Map<string, { rutDv: string; name: string }>> {
  const html = await fetch(CMF_DIR_URL).then((r) => r.text())
  const block = html.match(/name="sociedad\[\]"([\s\S]*?)<\/select>/)?.[1] ?? ''
  const opts = [...block.matchAll(/<option[^>]*value=["']?(\d+)["']?[^>]*>([^<]*)<\/option>/g)]
  const byNorm = new Map<string, { rutDv: string; name: string }>()
  for (const o of opts) {
    const text = decodeEntities(o[2])
    const m = text.match(/^([\d.]+-[\dkK])\s+(.*)$/)
    if (!m) continue
    const name = m[2].replace(/\s*\(No vigente\)\s*/i, '').trim()
    const key = normName(name)
    if (!byNorm.has(key)) byNorm.set(key, { rutDv: m[1], name })
  }
  return byNorm
}

async function main() {
  const live = process.argv.includes('--live')
  const companies = loadCompanies()
  const report = buildCmfCoverageReport(companies.map((c) => ({ ticker: c.ticker, sector: c.sector })))

  console.log(`[cmf-coverage] scanned ${report.totalScanned} app stocks`)
  console.log('[cmf-coverage] coverage funnel:')
  for (const [status, tickers] of Object.entries(report.byStatus).sort()) {
    console.log(`  ${status.padEnd(24)} ${tickers.length.toString().padStart(2)}  ${tickers.join(', ')}`)
  }

  if (!live) {
    console.log('[cmf-coverage] (run with --live to cross-check names against CMF\'s official directory)')
    return
  }

  console.log('\n[cmf-coverage] LIVE directory cross-check (research aid — verify the full XBRL chain before enabling):')
  const dir = await fetchDirectory()
  for (const c of companies) {
    const cls = report.classifications.find((x) => x.ticker === c.ticker.toUpperCase())!
    const hit = dir.get(normName(c.legalName ?? c.name ?? c.ticker))
    const dirNote = hit ? `RVEMI ${hit.rutDv} "${hit.name}"` : 'not an exact directory match'
    console.log(`  ${c.ticker.padEnd(12)} [${cls.status}] ${dirNote}`)
  }
}

main().catch((e) => {
  console.error(`[cmf-coverage] error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`)
  process.exitCode = 1
})
