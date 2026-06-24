// Phase 4A — Live-data provider abstraction (types only, no runtime code).
//
// These types are shared between SERVER provider code (route handlers) and
// CLIENT data-fetch helpers. Because the file contains ONLY type declarations,
// every import of it is erased at compile time — so importing it from a client
// component never pulls server-only provider code (or BCCh credentials) into
// the browser bundle.

import type { MacroIndicator, MacroHistoryPoint } from '@/types'

/** How the app sources data. Set via the DATA_MODE env var. */
export type DataMode = 'static' | 'live' | 'hybrid'

/** Resolved status surfaced to the UI badge. */
export type DataSourceStatus = 'static' | 'live' | 'hybrid-fallback' | 'live-unavailable'

/** Discriminated result returned by every provider call. */
export type ProviderResult<T> =
  | { ok: true; data: T; source: string; lastUpdated: string }
  | { ok: false; reason: string }

/** Metadata attached to every macro API response. Never contains secrets. */
export interface MacroDataMeta {
  dataModeRequested: DataMode
  dataModeUsed: DataMode
  liveAvailable: boolean
  status: DataSourceStatus
  source: string
  lastUpdated: string
  fallbackReason?: string
  /** Logical provider name, e.g. "BCCh BDE" when live, "static" on fallback. */
  provider?: string
  /** Official series code — only set for a single live history series (safe to surface). */
  seriesId?: string
}

export interface MacroIndicatorsResponse {
  data: MacroIndicator[]
  metadata: MacroDataMeta
}

/** Normalized chart point used by the macro popup chart. */
export interface MacroChartPoint {
  date: string
  value: number
}

export interface MacroHistoryResponse {
  data: MacroChartPoint[]
  metadata: MacroDataMeta
}

/** Contract every macro provider (static, BCCh, …) implements. */
export interface MacroProvider {
  name: string
  getIndicators(region?: 'CL' | 'US'): Promise<ProviderResult<MacroIndicator[]>>
  getHistory(indicatorId: string, years: 1 | 3 | 5 | 10): Promise<ProviderResult<MacroHistoryPoint[]>>
}
