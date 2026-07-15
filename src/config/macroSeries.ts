// Phase 4A/4B/8D — Macro series registry.
//
// The registry's live fields (providerSeriesCode, enabled, transformation,
// confidence, verified, notes) are DERIVED from controlled manual mappings —
// src/config/bcchSeriesManualMap.ts for CL (BCCh) series, and
// src/config/usFredSeriesManualMap.ts for US (FRED) series. Those files are
// the single human-verified sources of truth; this file adds display/region
// metadata and the fallback id, and dispatches each BASE entry to the correct
// map by its `sourceProvider`.
//
// Because every manual entry was originally unverified, getEnabledSeries()
// returned an empty list and the app served static MVP data. Phase 4B filled
// in verified BCCh seriesIds; Phase 8D adds FRED-backed US series + a verified
// BCCh copper series. No codes are ever set or guessed here — only in the
// manual maps, after live confirmation.

import {
  bcchSeriesManualMap,
  isManualSeriesLive,
  type BcchManualEntry,
  type BcchTransform,
} from './bcchSeriesManualMap.ts'
import {
  usFredSeriesManualMap,
  isFredSeriesLive,
  type FredManualEntry,
} from './usFredSeriesManualMap.ts'

export type SeriesProvider = 'BCCh' | 'INE' | 'LME' | 'FRED' | 'external'
export type SeriesFrequency = 'daily' | 'monthly' | 'quarterly'
/** Union of both providers' transform vocabularies — transforms.ts implements all of these. */
export type SeriesTransform = BcchTransform

/**
 * Canonical macro category groups (Phase 8D.1). This is the SINGLE source of
 * truth for an indicator's category — it must match the corresponding entry
 * in `src/data/macroIndicators.json` exactly. Provider modules (bcchMacroProvider,
 * fredMacroProvider) must read `def.category` and never hardcode a category —
 * that hardcoding (`category: 'Rates'` / `'US Rates'` for every live series
 * regardless of its true category) was a real bug: copper, IPC, UF, IMACEC,
 * unemployment, US CPI, and US unemployment all rendered under the wrong
 * Rates/US Rates band once live data replaced the static fallback.
 */
export type MacroCategory =
  | 'Rates' | 'Inflation' | 'FX' | 'Activity' | 'Commodities' | 'Labor'
  | 'US Rates' | 'US Inflation' | 'US FX' | 'US Activity' | 'US Labor' | 'Crypto'

export interface MacroSeriesDef {
  /** Static indicator/history id this live series maps back to. */
  id: string
  displayName: string
  region: 'CL' | 'US'
  /** Canonical category — must match macroIndicators.json's category for the same id. */
  category: MacroCategory
  source: string
  sourceProvider: SeriesProvider
  /** Key into bcchSeriesManualMap (BCCh) or usFredSeriesManualMap (FRED), depending on sourceProvider. */
  manualKey: string
  /** Official provider series code — derived from the relevant manual map (null until verified). */
  providerSeriesCode: string | null
  unit: string
  frequency: SeriesFrequency
  /** How the provider derives value/change (from the manual map) — shared transforms.ts math for both providers. */
  transformation: SeriesTransform
  /** id in macroIndicators.json / macroHistory.json used as fallback. */
  fallbackStaticId: string
  /** Derived: true only when the manual mapping is verified with a seriesId. */
  enabled: boolean
  /** 'month-end' when the raw provider series must be downsampled before use — see monthEndSample() in transforms.ts. */
  resample?: 'month-end'
  confidence: 'high' | 'medium' | 'low'
  verified: boolean
  verificationDate: string | null
  notes: string
}

interface BaseDef {
  id: string
  displayName: string
  region: 'CL' | 'US'
  category: MacroCategory
  source: string
  sourceProvider: SeriesProvider
  manualKey: string
  unit: string
  frequency: SeriesFrequency
  fallbackStaticId: string
}

// Display/region/category metadata + the manual-map key. Live fields are
// merged below. `category` must match the corresponding id's category in
// src/data/macroIndicators.json exactly (see the module doc comment above).
const BASE: BaseDef[] = [
  // ── Chile (BCCh) ──────────────────────────────────────────────────────────
  { id: 'tpm', displayName: 'Tasa de Política Monetaria (TPM)', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'tpm', unit: '%', frequency: 'daily', fallbackStaticId: 'tpm' },
  { id: 'ipc-mensual', displayName: 'IPC variación mensual', region: 'CL', category: 'Inflation', source: 'INE (via BCCh BDE)', sourceProvider: 'BCCh', manualKey: 'ipc-mom', unit: '%', frequency: 'monthly', fallbackStaticId: 'ipc-mensual' },
  { id: 'ipc-anual', displayName: 'IPC variación 12 meses', region: 'CL', category: 'Inflation', source: 'INE (via BCCh BDE)', sourceProvider: 'BCCh', manualKey: 'ipc-yoy', unit: '%', frequency: 'monthly', fallbackStaticId: 'ipc-anual' },
  { id: 'uf-diaria', displayName: 'Unidad de Fomento (UF)', region: 'CL', category: 'Inflation', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'uf', unit: 'CLP', frequency: 'daily', fallbackStaticId: 'uf-diaria' },
  { id: 'usdclp', displayName: 'Tipo de cambio observado USD/CLP', region: 'CL', category: 'FX', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'usdclp', unit: 'CLP', frequency: 'daily', fallbackStaticId: 'usdclp' },
  { id: 'eurclp', displayName: 'Tipo de cambio nominal EUR/CLP', region: 'CL', category: 'FX', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'eurclp', unit: 'CLP', frequency: 'daily', fallbackStaticId: 'eurclp' },
  { id: 'imacec-anual', displayName: 'IMACEC variación 12 meses', region: 'CL', category: 'Activity', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'imacec-yoy', unit: '%', frequency: 'monthly', fallbackStaticId: 'imacec-anual' },
  { id: 'desempleo', displayName: 'Tasa de desempleo', region: 'CL', category: 'Labor', source: 'INE (via BCCh BDE)', sourceProvider: 'BCCh', manualKey: 'unemployment', unit: '%', frequency: 'monthly', fallbackStaticId: 'desempleo' },
  { id: 'cobre-lme', displayName: 'Precio del cobre (referencial)', region: 'CL', category: 'Commodities', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'copper', unit: 'USD/lb', frequency: 'monthly', fallbackStaticId: 'cobre-lme' },
  // Chilean fixed-income rates
  { id: 'btu10', displayName: 'BTU 10 (UF, real)', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'btu-10', unit: '%', frequency: 'daily', fallbackStaticId: 'btu10-ref' },
  { id: 'btp10', displayName: 'BTP 2 (nominal)', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'btp-10', unit: '%', frequency: 'daily', fallbackStaticId: 'btp10' },
  { id: 'btu5', displayName: 'BTU 5 (UF, real)', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'btu-5', unit: '%', frequency: 'daily', fallbackStaticId: 'btu5' },
  { id: 'bcu5', displayName: 'BCU 5 (UF, real)', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'bcu-5', unit: '%', frequency: 'daily', fallbackStaticId: 'bcu5' },
  { id: 'swap2y', displayName: 'Cámara Swap 2Y', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'camara-swap-2y', unit: '%', frequency: 'daily', fallbackStaticId: 'swap2y' },
  { id: 'swap1y', displayName: 'Cámara Swap 1Y', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'camara-swap-1y', unit: '%', frequency: 'daily', fallbackStaticId: 'swap1y' },
  { id: 'pdbc90', displayName: 'PDBC 14 días', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'pdbc-90d', unit: '%', frequency: 'daily', fallbackStaticId: 'pdbc90' },
  { id: 'tpm-tna', displayName: 'TPM (tasa nominal anual)', region: 'CL', category: 'Rates', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'tpm-tna', unit: '%', frequency: 'daily', fallbackStaticId: 'tpm' },
  // ── United States (FRED, Phase 8D) ────────────────────────────────────────
  { id: 'fed-funds', displayName: 'Federal Funds Rate (Target Upper Limit)', region: 'US', category: 'US Rates', source: 'Federal Reserve (via FRED)', sourceProvider: 'FRED', manualKey: 'fed-funds', unit: '%', frequency: 'monthly', fallbackStaticId: 'fed-funds' },
  { id: 'us3m', displayName: 'US 3-Month Treasury Yield', region: 'US', category: 'US Rates', source: 'US Treasury (via FRED)', sourceProvider: 'FRED', manualKey: 'us3m', unit: '%', frequency: 'daily', fallbackStaticId: 'us3m' },
  { id: 'us2y', displayName: 'US 2-Year Treasury Yield', region: 'US', category: 'US Rates', source: 'US Treasury (via FRED)', sourceProvider: 'FRED', manualKey: 'us2y', unit: '%', frequency: 'daily', fallbackStaticId: 'us2y' },
  { id: 'us10y', displayName: 'US 10-Year Treasury Yield', region: 'US', category: 'US Rates', source: 'US Treasury (via FRED)', sourceProvider: 'FRED', manualKey: 'us10y', unit: '%', frequency: 'daily', fallbackStaticId: 'us10y' },
  { id: 'us20y', displayName: 'US 20-Year Treasury Yield', region: 'US', category: 'US Rates', source: 'US Treasury (via FRED)', sourceProvider: 'FRED', manualKey: 'us20y', unit: '%', frequency: 'daily', fallbackStaticId: 'us20y' },
  { id: 'us30y', displayName: 'US 30-Year Treasury Yield', region: 'US', category: 'US Rates', source: 'US Treasury (via FRED)', sourceProvider: 'FRED', manualKey: 'us30y', unit: '%', frequency: 'daily', fallbackStaticId: 'us30y' },
  { id: 'us-unemployment', displayName: 'US Unemployment Rate', region: 'US', category: 'US Labor', source: 'BLS (via FRED)', sourceProvider: 'FRED', manualKey: 'us-unemployment', unit: '%', frequency: 'monthly', fallbackStaticId: 'us-unemployment' },
  { id: 'us-cpi-mensual', displayName: 'US CPI Month-over-Month', region: 'US', category: 'US Inflation', source: 'BLS (via FRED)', sourceProvider: 'FRED', manualKey: 'us-cpi-mensual', unit: '%', frequency: 'monthly', fallbackStaticId: 'us-cpi-mensual' },
  { id: 'us-cpi-anual', displayName: 'US CPI Year-over-Year', region: 'US', category: 'US Inflation', source: 'BLS (via FRED)', sourceProvider: 'FRED', manualKey: 'us-cpi-anual', unit: '%', frequency: 'monthly', fallbackStaticId: 'us-cpi-anual' },
]

function merge(base: BaseDef): MacroSeriesDef {
  if (base.sourceProvider === 'FRED') {
    const m: FredManualEntry | undefined = usFredSeriesManualMap[base.manualKey]
    const live = isFredSeriesLive(m)
    return {
      ...base,
      providerSeriesCode: live ? (m!.seriesId as string) : null,
      enabled: live,
      resample: m?.resample,
      transformation: m?.transformation ?? 'none',
      confidence: m?.confidence ?? 'low',
      verified: Boolean(m?.verified),
      verificationDate: m?.verificationDate ?? null,
      notes: m?.notes ?? '',
    }
  }
  const m: BcchManualEntry | undefined = bcchSeriesManualMap[base.manualKey]
  const live = isManualSeriesLive(m)
  return {
    ...base,
    providerSeriesCode: live ? (m!.seriesId as string) : null,
    enabled: live,
    transformation: m?.transformation ?? 'none',
    confidence: m?.confidence ?? 'low',
    verified: Boolean(m?.verified),
    verificationDate: m?.verificationDate ?? null,
    notes: m?.notes ?? '',
  }
}

export const MACRO_SERIES: MacroSeriesDef[] = BASE.map(merge)

/** Series available for a region (or all). Does not check `enabled`. */
export function getSeriesForRegion(region?: 'CL' | 'US'): MacroSeriesDef[] {
  return region ? MACRO_SERIES.filter(s => s.region === region) : MACRO_SERIES
}

/** Series that are enabled AND have a verified provider code. */
export function getEnabledSeries(region?: 'CL' | 'US'): MacroSeriesDef[] {
  return getSeriesForRegion(region).filter(s => s.enabled && !!s.providerSeriesCode)
}

/** Enabled BCCh-backed series only (for the BCCh provider). */
export function getEnabledBcchSeries(region?: 'CL' | 'US'): MacroSeriesDef[] {
  return getEnabledSeries(region).filter(s => s.sourceProvider === 'BCCh')
}

/** Enabled FRED-backed series only (for the FRED provider). */
export function getEnabledFredSeries(region?: 'CL' | 'US'): MacroSeriesDef[] {
  return getEnabledSeries(region).filter(s => s.sourceProvider === 'FRED')
}

/** Look up a series definition by the static id used in the JSON data. */
export function getSeriesByStaticId(staticId: string): MacroSeriesDef | undefined {
  return MACRO_SERIES.find(s => s.fallbackStaticId === staticId || s.id === staticId)
}
