// Phase 8D — Controlled FRED (Federal Reserve Economic Data, St. Louis Fed)
// series mapping for US macro indicators. Mirrors the exact human-verification
// discipline of src/config/bcchSeriesManualMap.ts: every entry below was
// confirmed live against FRED's public CSV graph endpoint
// (https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES_ID>) — a
// genuinely free, official, no-API-key-required endpoint (verified live,
// Phase 8D: real July-2026 data returned for every series below, HTTP 200,
// Content-Type: application/csv).
//
// ⚠️ POLICY: never set a seriesId that has not been confirmed to return real,
// current, plausible data from this exact endpoint. No guessed codes.
//
// `staticId` links each entry to the id already used in macroIndicators.json
// (region: 'US') and macro_indicators (Supabase) — every id below already
// exists as a row in both, so no new indicator/table row is required to
// persist observations.

export type FredFrequency = 'DAILY' | 'MONTHLY'
export type FredTransform = 'none' | 'yoy' | 'mom'

export interface FredManualEntry {
  /** Official FRED series id — verified live, never guessed. */
  seriesId: string
  verified: boolean
  frequency: FredFrequency
  /** How the provider derives the displayed value/change (reuses transforms.ts, shared with BCCh). */
  transformation: FredTransform
  /** Static id this maps to — already present in macroIndicators.json + macro_indicators. */
  staticId: string
  sourceName: string
  confidence: 'high' | 'medium' | 'low'
  verificationDate: string
  verificationMethod: string
  notes: string
}

export const usFredSeriesManualMap: Record<string, FredManualEntry> = {
  'fed-funds': {
    seriesId: 'FEDFUNDS',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'none',
    staticId: 'fed-funds',
    sourceName: 'Federal Funds Effective Rate',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'Effective (not target) federal funds rate, monthly average. Latest verified: Jun-2026 = 3.63%.',
  },
  us3m: {
    seriesId: 'DGS3MO',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'us3m',
    sourceName: '3-Month Treasury Constant Maturity Rate',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'Daily, business days only (weekends/holidays have no observation).',
  },
  us2y: {
    seriesId: 'DGS2',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'us2y',
    sourceName: '2-Year Treasury Constant Maturity Rate',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'Daily, business days only.',
  },
  us10y: {
    seriesId: 'DGS10',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'us10y',
    sourceName: '10-Year Treasury Constant Maturity Rate',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'Daily, business days only. Latest verified: 2026-07-08 = 4.56%.',
  },
  us20y: {
    seriesId: 'DGS20',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'us20y',
    sourceName: '20-Year Treasury Constant Maturity Rate',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'Daily, business days only.',
  },
  us30y: {
    seriesId: 'DGS30',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'us30y',
    sourceName: '30-Year Treasury Constant Maturity Rate',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'Daily, business days only.',
  },
  'us-unemployment': {
    seriesId: 'UNRATE',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'none',
    staticId: 'us-unemployment',
    sourceName: 'Civilian Unemployment Rate (BLS, via FRED)',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'Seasonally adjusted, national. Latest verified: Jun-2026 = 4.2%.',
  },
  'us-cpi-mensual': {
    seriesId: 'CPIAUCSL',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'mom',
    staticId: 'us-cpi-mensual',
    sourceName: 'CPI for All Urban Consumers: All Items (BLS, via FRED)',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'CPIAUCSL is an INDEX LEVEL (seasonally adjusted), not a % change — the month-over-month % change is derived via the shared transforms.ts "mom" transform (same math already used for BCCh IMACEC yoy). Same underlying series as us-cpi-anual below, different transform.',
  },
  'us-cpi-anual': {
    seriesId: 'CPIAUCSL',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'yoy',
    staticId: 'us-cpi-anual',
    sourceName: 'CPI for All Urban Consumers: All Items (BLS, via FRED)',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'FRED public CSV graph endpoint (no API key), verified live',
    notes: 'Same CPIAUCSL index level series as us-cpi-mensual; the 12-month % change is derived via the shared transforms.ts "yoy" transform.',
  },
}

/** A mapping is live-eligible only when verified AND it has a seriesId (mirrors isManualSeriesLive in bcchSeriesManualMap.ts). */
export function isFredSeriesLive(entry: FredManualEntry | undefined): boolean {
  return Boolean(entry && entry.verified && entry.seriesId)
}
