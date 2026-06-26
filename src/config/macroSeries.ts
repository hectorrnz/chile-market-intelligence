// Phase 4A/4B — Macro series registry.
//
// The registry's live fields (providerSeriesCode, enabled, transformation,
// confidence, verified, notes) are DERIVED from the controlled manual mapping
// (src/config/bcchSeriesManualMap.ts). That file is the single human-verified
// source of truth; this file adds display/region metadata and the fallback id.
//
// Because every manual entry is currently unverified, getEnabledSeries() returns
// an empty list and the app serves static MVP data. Phase 4B fills in verified
// seriesIds in the manual map — no codes are ever set or guessed here.

import {
  bcchSeriesManualMap,
  isManualSeriesLive,
  type BcchManualEntry,
  type BcchTransform,
} from './bcchSeriesManualMap.ts'

export type SeriesProvider = 'BCCh' | 'INE' | 'LME' | 'FRED' | 'external'
export type SeriesFrequency = 'daily' | 'monthly' | 'quarterly'

export interface MacroSeriesDef {
  /** Static indicator/history id this live series maps back to. */
  id: string
  displayName: string
  region: 'CL' | 'US'
  source: string
  sourceProvider: SeriesProvider
  /** Key into bcchSeriesManualMap. */
  manualKey: string
  /** Official BDE series code — derived from the manual map (null until verified). */
  providerSeriesCode: string | null
  unit: string
  frequency: SeriesFrequency
  /** How the provider derives value/change (from the manual map). */
  transformation: BcchTransform
  /** id in macroIndicators.json / macroHistory.json used as fallback. */
  fallbackStaticId: string
  /** Derived: true only when the manual mapping is verified with a seriesId. */
  enabled: boolean
  confidence: 'high' | 'medium' | 'low'
  verified: boolean
  verificationDate: string | null
  notes: string
}

interface BaseDef {
  id: string
  displayName: string
  region: 'CL'
  source: string
  sourceProvider: SeriesProvider
  manualKey: string
  unit: string
  frequency: SeriesFrequency
  fallbackStaticId: string
}

// Display/region metadata + the manual-map key. Live fields are merged below.
const BASE: BaseDef[] = [
  { id: 'tpm', displayName: 'Tasa de Política Monetaria (TPM)', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'tpm', unit: '%', frequency: 'daily', fallbackStaticId: 'tpm' },
  { id: 'ipc-mensual', displayName: 'IPC variación mensual', region: 'CL', source: 'INE (via BCCh BDE)', sourceProvider: 'BCCh', manualKey: 'ipc-mom', unit: '%', frequency: 'monthly', fallbackStaticId: 'ipc-mensual' },
  { id: 'ipc-anual', displayName: 'IPC variación 12 meses', region: 'CL', source: 'INE (via BCCh BDE)', sourceProvider: 'BCCh', manualKey: 'ipc-yoy', unit: '%', frequency: 'monthly', fallbackStaticId: 'ipc-anual' },
  { id: 'uf-diaria', displayName: 'Unidad de Fomento (UF)', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'uf', unit: 'CLP', frequency: 'daily', fallbackStaticId: 'uf-diaria' },
  { id: 'usdclp', displayName: 'Tipo de cambio observado USD/CLP', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'usdclp', unit: 'CLP', frequency: 'daily', fallbackStaticId: 'usdclp' },
  { id: 'imacec-anual', displayName: 'IMACEC variación 12 meses', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'imacec-yoy', unit: '%', frequency: 'monthly', fallbackStaticId: 'imacec-anual' },
  { id: 'desempleo', displayName: 'Tasa de desempleo', region: 'CL', source: 'INE (via BCCh BDE)', sourceProvider: 'BCCh', manualKey: 'unemployment', unit: '%', frequency: 'monthly', fallbackStaticId: 'desempleo' },
  { id: 'cobre-lme', displayName: 'Precio del cobre (LME)', region: 'CL', source: 'London Metal Exchange', sourceProvider: 'LME', manualKey: 'copper', unit: 'USD/lb', frequency: 'daily', fallbackStaticId: 'cobre-lme' },
  // Chilean fixed-income rates
  { id: 'btu10', displayName: 'BTU 10 (UF, real)', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'btu-10', unit: '%', frequency: 'daily', fallbackStaticId: 'btu10-ref' },
  { id: 'btp10', displayName: 'BTP 10 (nominal)', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'btp-10', unit: '%', frequency: 'daily', fallbackStaticId: 'btp10' },
  { id: 'btu5', displayName: 'BTU 5 (UF, real)', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'btu-5', unit: '%', frequency: 'daily', fallbackStaticId: 'btu5' },
  { id: 'bcu5', displayName: 'BCU 5 (UF, real)', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'bcu-5', unit: '%', frequency: 'daily', fallbackStaticId: 'bcu5' },
  { id: 'swap2y', displayName: 'Cámara Swap 2Y', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'camara-swap-2y', unit: '%', frequency: 'daily', fallbackStaticId: 'swap2y' },
  { id: 'swap1y', displayName: 'Cámara Swap 1Y', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'camara-swap-1y', unit: '%', frequency: 'daily', fallbackStaticId: 'swap1y' },
  { id: 'pdbc90', displayName: 'PDBC 90 días', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'pdbc-90d', unit: '%', frequency: 'daily', fallbackStaticId: 'pdbc90' },
  { id: 'tpm-tna', displayName: 'TPM (tasa nominal anual)', region: 'CL', source: 'Banco Central de Chile', sourceProvider: 'BCCh', manualKey: 'tpm-tna', unit: '%', frequency: 'daily', fallbackStaticId: 'tpm' },
]

function merge(base: BaseDef): MacroSeriesDef {
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

/** Series that are enabled AND have a verified provider code. Empty until 4B. */
export function getEnabledSeries(region?: 'CL' | 'US'): MacroSeriesDef[] {
  return getSeriesForRegion(region).filter(s => s.enabled && !!s.providerSeriesCode)
}

/** Look up a series definition by the static id used in the JSON data. */
export function getSeriesByStaticId(staticId: string): MacroSeriesDef | undefined {
  return MACRO_SERIES.find(s => s.fallbackStaticId === staticId || s.id === staticId)
}
