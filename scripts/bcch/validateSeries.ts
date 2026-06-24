// Phase 4B — Validate verified BCCh series (official GetSeries, no scraping).
//
// Run: npm run bcch:validate   (requires BCCH_API_USER / BCCH_API_PASSWORD)
//
// Validates ONLY series in src/config/bcchSeriesManualMap.ts that have
// verified=true AND a non-null seriesId. For each it calls GetSeries for a
// recent window, parses via normalizeBcchSeries, and checks: non-empty values,
// parseable dates, latest value within the plausibility band, and coherent
// frequency. Series that fail are reported and NOT to be enabled.
//
// Safety: fails gracefully with no credentials, never prints credentials, never
// runs during build.

// @next/env is CJS — import via default, then destructure after all imports.
import pkg from '@next/env'
import { fetchBcchSeries } from '../../src/lib/providers/bcchClient.ts'
import { isPlausible, plausibilityReason } from '../../src/lib/providers/plausibility.ts'
import { bcchSeriesManualMap, isManualSeriesLive } from '../../src/config/bcchSeriesManualMap.ts'
import { deriveValueChange } from '../../src/lib/providers/transforms.ts'

// Load .env.local (and .env) exactly as Next.js does, so credentials are
// available in process.env before the credential check below.
const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

function firstDateFor(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

/** Median gap (days) between consecutive dates → rough frequency check. */
function medianGapDays(dates: string[]): number {
  if (dates.length < 2) return 0
  const gaps: number[] = []
  for (let i = 1; i < dates.length; i++) {
    gaps.push((new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000)
  }
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

function freqCoherent(expected: string, gapDays: number): boolean {
  switch (expected) {
    case 'DAILY': return gapDays >= 0.5 && gapDays <= 5      // business days
    case 'MONTHLY': return gapDays >= 20 && gapDays <= 45
    case 'QUARTERLY': return gapDays >= 80 && gapDays <= 100
    case 'ANNUAL': return gapDays >= 330 && gapDays <= 400
    default: return true
  }
}

async function main() {
  const user = process.env.BCCH_API_USER
  const pass = process.env.BCCH_API_PASSWORD
  if (!user || !pass) {
    console.log('BCCh credentials not set (BCCH_API_USER / BCCH_API_PASSWORD).')
    console.log('Add them to .env.local and re-run `npm run bcch:validate`. Skipping — expected without credentials.')
    return
  }

  const entries = Object.entries(bcchSeriesManualMap).filter(([, e]) => isManualSeriesLive(e))
  if (entries.length === 0) {
    console.log('No verified series to validate.')
    console.log('Map official codes in src/config/bcchSeriesManualMap.ts (verified=true, seriesId set) first.')
    return
  }

  console.log(`Validating ${entries.length} verified series…\n`)
  let pass_ = 0
  let fail = 0

  for (const [key, e] of entries) {
    const code = e.seriesId as string
    const res = await fetchBcchSeries(code, { firstDate: firstDateFor(2) })
    if (!res.ok) {
      console.log(`✗ ${key} (${code}): ${res.reason}`)
      fail++
      continue
    }
    const valued = res.data.filter(p => p.value != null)
    if (valued.length < 2) {
      console.log(`✗ ${key} (${code}): too few observations (${valued.length})`)
      fail++
      continue
    }
    const derived = deriveValueChange(res.data, e.transformation)
    if (!derived) {
      console.log(`✗ ${key} (${code}): could not derive a value`)
      fail++
      continue
    }
    const reason = plausibilityReason(key, derived.value)
    const gap = medianGapDays(valued.map(p => p.date))
    const freqOk = freqCoherent(e.frequency, gap)
    const ok = isPlausible(key, derived.value) && freqOk

    if (ok) {
      console.log(`✓ ${key} (${code}): value=${derived.value} asOf=${derived.asOf} obs=${valued.length} ~freq=${gap.toFixed(1)}d`)
      pass_++
    } else {
      console.log(`✗ ${key} (${code}): ${reason ?? ''}${!freqOk ? ` frequency mismatch (median gap ${gap.toFixed(1)}d for ${e.frequency})` : ''}`)
      fail++
    }
  }

  console.log(`\nValidation complete: ${pass_} passed, ${fail} failed.`)
  if (fail > 0) console.log('Do NOT enable failed series — keep them disabled so static fallback is used.')
}

main().catch(err => {
  console.error('bcch:validate failed:', err instanceof Error ? err.message : 'unknown error')
  process.exitCode = 1
})
