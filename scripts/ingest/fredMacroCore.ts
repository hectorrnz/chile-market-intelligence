// Phase 8D — Pure/testable logic for FRED (US macro) ingestion.
// Mirrors bcchMacroCore.ts's shape exactly. No I/O, no env reads, no Supabase.

import { transformSeries, monthEndSample, type SeriesPoint } from '../../src/lib/providers/transforms.ts'
import type { MacroSeriesDef } from '../../src/config/macroSeries.ts'

export const INGESTION_VERSION = '8D.0'
export const SOURCE_PROVIDER = 'FRED (St. Louis Fed)'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ObservationUpsertRow {
  indicator_id: string       // matches macro_indicators.id (fallbackStaticId)
  observation_date: string   // YYYY-MM-DD
  value: number
  source_provider: string    // 'FRED (St. Louis Fed)'
  source_series_code: string
  fetched_at: string         // ISO timestamp
  metadata: {
    transformation: string
    provider: 'fred'
    sourceName: string | null
    ingestionVersion: string
    isDerived: boolean
    rowSource: 'live_fred'
  }
}

export interface IngestArgs {
  write: boolean
  all: boolean
  indicator: string | null   // manualKey or fallbackStaticId
  years: number
  from: string | null        // YYYY-MM-DD override
  to: string | null          // YYYY-MM-DD override
  limit: number | null
}

export interface IndicatorResult {
  manualKey: string
  fallbackStaticId: string
  seriesCode: string
  rawCount: number
  storedCount: number
  skipped: boolean
  reason?: string
  rows: ObservationUpsertRow[]
}

// ─── Argument parsing ─────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): IngestArgs {
  const args = argv.slice(2)
  const get = (flag: string): string | null => {
    const idx = args.indexOf(flag)
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null
  }
  const yearsRaw = parseInt(get('--years') ?? '10', 10)
  return {
    write:     args.includes('--write'),
    all:       args.includes('--all'),
    indicator: get('--indicator'),
    years:     Number.isFinite(yearsRaw) && yearsRaw > 0 ? yearsRaw : 10,
    from:      get('--from'),
    to:        get('--to'),
    limit:     get('--limit') ? parseInt(get('--limit')!, 10) : null,
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function firstDateFor(years: number, extraYears = 0): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years - extraYears)
  return d.toISOString().slice(0, 10)
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Error sanitisation ───────────────────────────────────────────────────────

export function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg
    .replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***')
    .replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***')
    .slice(0, 500)
}

// ─── Observation row builder ───────────────────────────────────────────────────

/**
 * Build upsert rows for one indicator from raw FRED points.
 * Applies the series transformation and filters to the requested date window.
 */
export function buildObservationRows(
  def: MacroSeriesDef,
  sourceName: string | null,
  rawPoints: SeriesPoint[],
  dateRange: { from: string; to: string },
  fetchedAt: string,
  limit: number | null = null,
): ObservationUpsertRow[] {
  if (!def.providerSeriesCode) return []

  // Downsample before transform for series whose raw FRED publication cadence
  // is finer than their declared frequency (e.g. DFEDTARU is daily but a step
  // function) — mirrors src/lib/ingestion/fredMacroIngestion.ts.
  const sourcePoints = def.resample === 'month-end' ? monthEndSample(rawPoints) : rawPoints
  const transformed = transformSeries(sourcePoints, def.transformation)
  const isDerived = def.transformation !== 'none'

  let filtered = transformed.filter(
    p => p.value != null && p.date >= dateRange.from && p.date <= dateRange.to
  )
  if (limit != null && limit > 0) filtered = filtered.slice(-limit)

  return filtered.map(p => ({
    indicator_id:       def.fallbackStaticId,
    observation_date:   p.date,
    value:              p.value,
    source_provider:    SOURCE_PROVIDER,
    source_series_code: def.providerSeriesCode as string,
    fetched_at:         fetchedAt,
    metadata: {
      transformation:   def.transformation,
      provider:         'fred' as const,
      sourceName,
      ingestionVersion: INGESTION_VERSION,
      isDerived,
      rowSource:        'live_fred' as const,
    },
  }))
}

// ─── Batch helper ──────────────────────────────────────────────────────────────

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
