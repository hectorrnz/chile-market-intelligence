// Phase 4B — BCCh catalog discovery (official SearchSeries, no scraping).
//
// Run: npm run bcch:search   (requires BCCH_API_USER / BCCH_API_PASSWORD)
//
// Queries the official BCCh SieteRestWS SearchSeries catalog per frequency and
// filters the returned titles with Spanish keyword patterns to propose candidate
// seriesIds for each macro indicator. WRITES tmp/bcch-series-candidates.json and
// prints a concise confidence report. It NEVER auto-enables anything — a human
// confirms each official seriesId in src/config/bcchSeriesManualMap.ts.
//
// Safety: fails gracefully with no credentials, never prints credentials, never
// runs during build, never makes the app depend on BCCh availability.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BASE = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx'
const FREQUENCIES = ['DAILY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const
const TIMEOUT_MS = 15000

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', '..', 'tmp')
const OUT_FILE = join(OUT_DIR, 'bcch-series-candidates.json')

function strip(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Keyword tiers per indicator. `qualifier` (when present) must also appear to
// reach high confidence — used to separate m/m from 12m variants.
interface KeywordSet { strong: string[]; medium: string[]; weak?: string[]; qualifier?: string[] }
const KEYWORDS: Record<string, KeywordSet> = {
  tpm: { strong: ['tasa de politica monetaria'], medium: ['tpm'] },
  uf: { strong: ['unidad de fomento'], medium: ['uf'] },
  usdclp: { strong: ['dolar observado'], medium: ['tipo de cambio nominal', 'peso dolar'], weak: ['dolar'] },
  'ipc-mom': { strong: ['indice de precios al consumidor'], medium: ['ipc'], qualifier: ['variacion mensual', 'mensual'] },
  'ipc-yoy': { strong: ['indice de precios al consumidor'], medium: ['ipc'], qualifier: ['variacion anual', '12 meses', 'doce meses', 'interanual'] },
  'imacec-yoy': { strong: ['imacec', 'indicador mensual de actividad economica'], medium: ['actividad economica'], qualifier: ['variacion anual', '12 meses', 'interanual'] },
  unemployment: { strong: ['tasa de desocupacion'], medium: ['desempleo', 'desocupacion', 'ocupacion'] },
  copper: { strong: ['libra de cobre'], medium: ['cobre'] },
  'chilean-rates': { strong: [], medium: ['btu', 'btp', 'bcu', 'pdbc', 'camara', 'swap', 'tna'] },
}

interface Candidate {
  indicatorId: string
  seriesId: string
  spanishName: string
  frequency: string
  unit?: string
  firstObservation?: string
  lastObservation?: string
  confidence: 'high' | 'medium' | 'low'
}

function classify(title: string, k: KeywordSet): 'high' | 'medium' | 'low' | null {
  const t = strip(title)
  const hasStrong = k.strong.some(p => t.includes(strip(p)))
  const hasMedium = k.medium.some(p => t.includes(strip(p)))
  const hasWeak = (k.weak ?? []).some(p => t.includes(strip(p)))
  const qualMet = !k.qualifier || k.qualifier.some(p => t.includes(strip(p)))
  if (!hasStrong && !hasMedium && !hasWeak) return null
  if (k.qualifier && !qualMet) return 'low' // matched the metric but not the m/m vs 12m qualifier
  if (hasStrong) return 'high'
  if (hasMedium) return 'medium'
  return 'low'
}

/** Extract series records from a SearchSeries payload, tolerating field-name variants. */
function extractSeries(json: unknown): { id: string; title: string; freq?: string; first?: string; last?: string }[] {
  const root = json as Record<string, unknown>
  const arr =
    (root?.SeriesInfos as unknown[]) ??
    (root?.Series as unknown[]) ??
    (root?.series as unknown[]) ??
    []
  if (!Array.isArray(arr)) return []
  return arr.map((raw) => {
    const o = raw as Record<string, unknown>
    const id = String(o.seriesId ?? o.SeriesId ?? o.id ?? '')
    const title = String(o.spanishTitle ?? o.spanishtitle ?? o.SpanishTitle ?? o.title ?? o.descripEsp ?? o.descripcionEsp ?? '')
    const freq = (o.frequencyCode ?? o.frequency ?? o.Frequency) as string | undefined
    const first = (o.firstObservation ?? o.FirstObservation) as string | undefined
    const last = (o.lastObservation ?? o.LastObservation) as string | undefined
    return { id, title, freq: freq ? String(freq) : undefined, first: first ? String(first) : undefined, last: last ? String(last) : undefined }
  }).filter(s => s.id && s.title)
}

async function searchFrequency(base: string, user: string, pass: string, frequency: string) {
  const params = new URLSearchParams({ user, pass, function: 'SearchSeries', frequency })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}?${params.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) { console.warn(`  SearchSeries(${frequency}) HTTP ${res.status}`); return [] }
    return extractSeries(await res.json())
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    console.warn(`  SearchSeries(${frequency}) ${aborted ? 'timed out' : 'failed'}`)
    return []
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const user = process.env.BCCH_API_USER
  const pass = process.env.BCCH_API_PASSWORD
  const base = process.env.BCCH_API_BASE_URL || DEFAULT_BASE

  if (!user || !pass) {
    console.log('BCCh credentials not set (BCCH_API_USER / BCCH_API_PASSWORD).')
    console.log('Add them to .env.local (server-only) and re-run `npm run bcch:search`.')
    console.log('Skipping live catalog discovery — this is expected without credentials.')
    return
  }

  console.log('Querying BCCh SearchSeries catalog (official API, no scraping)…')
  const candidates: Candidate[] = []
  const seen = new Set<string>()

  for (const frequency of FREQUENCIES) {
    const series = await searchFrequency(base, user, pass, frequency)
    console.log(`  ${frequency}: ${series.length} series returned`)
    for (const s of series) {
      for (const [indicatorId, kw] of Object.entries(KEYWORDS)) {
        const conf = classify(s.title, kw)
        if (!conf) continue
        const key = `${indicatorId}:${s.id}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({
          indicatorId, seriesId: s.id, spanishName: s.title,
          frequency: s.freq ?? frequency, firstObservation: s.first, lastObservation: s.last, confidence: conf,
        })
      }
    }
  }

  candidates.sort((a, b) =>
    a.indicatorId.localeCompare(b.indicatorId) ||
    ({ high: 0, medium: 1, low: 2 }[a.confidence] - { high: 0, medium: 1, low: 2 }[b.confidence]))

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(candidates, null, 2))

  console.log(`\nFound ${candidates.length} candidate(s). Written to tmp/bcch-series-candidates.json\n`)
  console.log('indicatorId        seriesId             confidence  frequency  name')
  console.log('-----------        --------             ----------  ---------  ----')
  for (const c of candidates) {
    console.log(
      `${c.indicatorId.padEnd(18)} ${c.seriesId.padEnd(20)} ${c.confidence.padEnd(11)} ${(c.frequency ?? '').padEnd(10)} ${c.spanishName.slice(0, 60)}`
    )
  }
  console.log('\n⚠️  Review candidates and confirm official seriesIds in')
  console.log('    src/config/bcchSeriesManualMap.ts (set verified=true). Never guess.')
}

main().catch(err => {
  // Never leak credentials; print only a generic message.
  console.error('bcch:search failed:', err instanceof Error ? err.message : 'unknown error')
  process.exitCode = 1
})
