// Phase 4B — Controlled BCCh series mapping layer.
//
// This is the SINGLE source of truth for which BCCh BDE series back each macro
// indicator. It is filled in by HUMAN verification only:
//   1. Run `npm run bcch:search` (needs credentials) to discover candidates.
//   2. Review tmp/bcch-series-candidates.json + the terminal confidence report.
//   3. Paste the confirmed official seriesId here and set verified=true.
//   4. Run `npm run bcch:validate` to sanity-check live values.
//
// ⚠️ POLICY: never set a seriesId you have not confirmed against the official
// BCCh SearchSeries/GetSeries catalog. No guessed codes. Until verified=true AND
// seriesId!=null, the indicator stays disabled and the app serves static data.
//
// `staticId` links each entry to the id used in the static JSON
// (macroIndicators.json / macroHistory.json / chileanRates RATE_HIST) for the
// fallback path.

export type BcchFrequency = 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
export type BcchTransform = 'none' | 'yoy' | 'mom' | 'level-to-yoy' | 'bp-to-pct'

export interface BcchManualEntry {
  /** Official BDE series code — null until verified. NEVER guess. */
  seriesId: string | null
  /** Only true once a human confirms the seriesId against the catalog. */
  verified: boolean
  frequency: BcchFrequency
  /** How the provider derives the displayed value/change from the raw series. */
  transformation: BcchTransform
  /** Static id this maps to for the fallback path. */
  staticId: string
  sourceName: string | null
  confidence: 'high' | 'medium' | 'low'
  verificationDate: string | null
  verificationMethod: string | null
  notes: string
}

const pending = (
  staticId: string,
  frequency: BcchFrequency,
  transformation: BcchTransform,
  notes = 'Pending official BDE verification'
): BcchManualEntry => ({
  seriesId: null,
  verified: false,
  frequency,
  transformation,
  staticId,
  sourceName: null,
  confidence: 'low',
  verificationDate: null,
  verificationMethod: null,
  notes,
})

export const bcchSeriesManualMap: Record<string, BcchManualEntry> = {
  // Core Chile macro
  tpm: pending('tpm', 'DAILY', 'none'),
  'ipc-mom': pending('ipc-mensual', 'MONTHLY', 'none',
    'Use the published m/m variation series directly if available; else map the IPC index level and set transformation=mom.'),
  'ipc-yoy': pending('ipc-anual', 'MONTHLY', 'none',
    'Use the published 12-month variation series directly if available; else map the IPC index level and set transformation=yoy.'),
  uf: pending('uf-diaria', 'DAILY', 'none'),
  usdclp: pending('usdclp', 'DAILY', 'none', 'Map the "dólar observado" series.'),
  'imacec-yoy': pending('imacec-anual', 'MONTHLY', 'none',
    'Use the published IMACEC 12-month variation series; else map the IMACEC index and set transformation=yoy.'),
  unemployment: pending('desempleo', 'MONTHLY', 'none', 'Tasa de desocupación (INE via BDE).'),

  // Copper is NOT a core BCCh BDE series — likely external (LME) in a later
  // phase. Kept here for completeness but should remain disabled for BCCh.
  copper: pending('cobre-lme', 'DAILY', 'none',
    'Not a BCCh series — source from LME/external in a later phase. Keep disabled for BCCh.'),

  // Chilean fixed-income rates (verify which are available in BDE; some may
  // require an external rates provider).
  'btu-10': pending('btu10-ref', 'DAILY', 'none'),
  'btp-10': pending('btp10', 'DAILY', 'none'),
  'btu-5': pending('btu5', 'DAILY', 'none'),
  'bcu-5': pending('bcu5', 'DAILY', 'none'),
  'camara-swap-2y': pending('swap2y', 'DAILY', 'none'),
  'camara-swap-1y': pending('swap1y', 'DAILY', 'none'),
  'pdbc-90d': pending('pdbc90', 'DAILY', 'none'),
  'tpm-tna': pending('tpm', 'DAILY', 'none', 'TPM tasa nominal anual — verify whether BDE exposes a distinct TNA series.'),
}

/** A mapping is live-eligible only when verified AND it has a seriesId. */
export function isManualSeriesLive(entry: BcchManualEntry | undefined): boolean {
  return Boolean(entry && entry.verified && entry.seriesId)
}

/** Count of verified entries — used by scripts/tests/docs. */
export function verifiedCount(): number {
  return Object.values(bcchSeriesManualMap).filter(isManualSeriesLive).length
}
