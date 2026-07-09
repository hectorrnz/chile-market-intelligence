// Phase 8A — Canonical data-source truth layer.
// Single source of truth for what a module's data-source badge says, so the
// same underlying situation (e.g. "BCCh live") is never worded two different
// ways on two different pages. Add new entries here rather than inventing a
// new label string in a component.
//
// SourceState drives badge color/shape (7 states); SOURCE_REGISTRY maps a
// specific provider+situation to one of those states plus EN/ES copy.

export type SourceState =
  | 'live'
  | 'persisted'
  | 'hybrid'
  | 'static_fallback'
  | 'static_mvp'
  | 'blocked'
  | 'unavailable'

export interface SourceEntry {
  /** Stable id — also used as the React key when rendering a list of badges. */
  id: string
  state: SourceState
  labelEn: string
  labelEs: string
}

/**
 * Canonical registry. Keys are referenced from page components via
 * `getSourceLabel(key, lang)` — never hardcode a source string inline.
 *
 * Naming rule: never call Yahoo Finance "official" (it's an unofficial free
 * data source); never call the COLCAP/BVL Peru entries an "official exchange
 * index" (they are ETF/proxy substitutes — see liveOverlay.ts); never imply
 * CMF ingestion is live when it is blocked.
 */
export const SOURCE_REGISTRY = {
  bcchLive: {
    id: 'bcch-live',
    state: 'live',
    labelEn: 'Live BCCh',
    labelEs: 'BCCh en vivo',
  },
  bcchPersisted: {
    id: 'bcch-persisted',
    state: 'persisted',
    labelEn: 'Persisted BCCh via Supabase',
    labelEs: 'BCCh persistido vía Supabase',
  },
  yahooPersisted: {
    id: 'yahoo-persisted',
    state: 'persisted',
    labelEn: 'Persisted Yahoo Finance via Supabase',
    labelEs: 'Yahoo Finance persistido vía Supabase',
  },
  yahooLiveOverlay: {
    id: 'yahoo-live-overlay',
    state: 'live',
    labelEn: 'Yahoo Finance live overlay',
    labelEs: 'Superposición en vivo de Yahoo Finance',
  },
  staticFallback: {
    id: 'static-fallback',
    state: 'static_fallback',
    labelEn: 'Static fallback',
    labelEs: 'Respaldo estático',
  },
  staticMvp: {
    id: 'static-mvp',
    state: 'static_mvp',
    labelEn: 'Static MVP sample',
    labelEs: 'Muestra MVP estática',
  },
  providerBlocked: {
    id: 'provider-blocked',
    state: 'blocked',
    labelEn: 'Provider blocked',
    labelEs: 'Proveedor bloqueado',
  },
  dataUnavailable: {
    id: 'data-unavailable',
    state: 'unavailable',
    labelEn: 'Data unavailable',
    labelEs: 'Datos no disponibles',
  },

  // ── Situation-specific entries (compose a base label with detail) ────────
  cmfBlocked: {
    id: 'cmf-blocked',
    state: 'blocked',
    labelEn: 'CMF live ingestion not active · static MVP sample',
    labelEs: 'Ingesta CMF en vivo no activa · muestra MVP estática',
  },
  fundamentalsStatic: {
    id: 'fundamentals-static',
    state: 'static_fallback',
    labelEn: 'Static fallback · pending automated financials ingestion',
    labelEs: 'Respaldo estático · pendiente de ingesta automatizada de financials',
  },
  financialsPersisted: {
    id: 'financials-persisted',
    state: 'persisted',
    labelEn: 'Persisted financials via manual CSV (interim bridge)',
    labelEs: 'Financials persistidos vía CSV manual (puente provisorio)',
  },
  financialsPersistedCmfFecu: {
    id: 'financials-persisted-cmf-fecu',
    state: 'persisted',
    labelEn: 'Persisted financials via CMF/FECU',
    labelEs: 'Financials persistidos vía CMF/FECU',
  },
  financialsPersistedXbrl: {
    id: 'financials-persisted-xbrl',
    state: 'persisted',
    labelEn: 'Persisted financials via CMF XBRL',
    labelEs: 'Financials persistidos vía XBRL de la CMF',
  },
  financialsPersistedYahoo: {
    id: 'financials-persisted-yahoo',
    state: 'persisted',
    labelEn: 'Fundamentals via Yahoo Finance (unofficial)',
    labelEs: 'Fundamentales vía Yahoo Finance (no oficial)',
  },
  automatedFinancialsBlocked: {
    id: 'automated-financials-blocked',
    state: 'blocked',
    labelEn: 'Automated financials provider blocked — see docs/cmf_xbrl_provider_discovery.md',
    labelEs: 'Proveedor automatizado de financials bloqueado — ver docs/cmf_xbrl_provider_discovery.md',
  },
  financialsDerived: {
    id: 'financials-derived',
    state: 'persisted',
    labelEn: 'Derived from persisted financials',
    labelEs: 'Derivado de financials persistidos',
  },
  earningsPersisted: {
    id: 'earnings-persisted',
    state: 'persisted',
    labelEn: 'Persisted earnings events via manual CSV',
    labelEs: 'Eventos de resultados persistidos vía CSV manual',
  },
  automatedFinancialsPending: {
    id: 'automated-financials-pending',
    state: 'static_fallback',
    labelEn: 'Automated financials source pending — manual CSV is an interim bridge',
    labelEs: 'Fuente automatizada de financials pendiente — el CSV manual es un puente provisorio',
  },
  sourceAgnosticFinancialsLayer: {
    id: 'source-agnostic-financials-layer',
    state: 'persisted',
    labelEn: 'Source-agnostic financials layer',
    labelEs: 'Capa de financials agnóstica de fuente',
  },
} as const satisfies Record<string, SourceEntry>

export type SourceKey = keyof typeof SOURCE_REGISTRY

export function getSourceEntry(key: SourceKey): SourceEntry {
  return SOURCE_REGISTRY[key]
}

export function getSourceLabel(key: SourceKey, lang: 'en' | 'es'): string {
  const entry = SOURCE_REGISTRY[key]
  return lang === 'es' ? entry.labelEs : entry.labelEn
}

export function getSourceState(key: SourceKey): SourceState {
  return SOURCE_REGISTRY[key].state
}
