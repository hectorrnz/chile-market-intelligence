// Phase 4B — Plausibility bands for live macro values.
//
// PURE module (no imports) — used by the validation script AND unit tests to
// reject a mapped BCCh series whose latest value falls outside a broad sanity
// band. These are deliberately wide guardrails, not precise expectations: they
// catch a wrong series mapping (e.g. an index level where a % is expected), not
// normal market moves. Keyed by the manual-map key (see bcchSeriesManualMap).

export interface Band { min: number; max: number }

export const PLAUSIBILITY: Record<string, Band> = {
  tpm: { min: 0, max: 20 },
  'ipc-mom': { min: -5, max: 10 },
  'ipc-yoy': { min: -5, max: 30 },
  uf: { min: 10000, max: 100000 },
  usdclp: { min: 300, max: 2000 },
  'imacec-yoy': { min: -30, max: 30 },
  unemployment: { min: 0, max: 30 },
  copper: { min: 0.5, max: 15 },
  'btu-10': { min: -5, max: 30 },
  'btp-10': { min: -5, max: 30 },
  'btu-5': { min: -5, max: 30 },
  'bcu-5': { min: -5, max: 30 },
  'camara-swap-2y': { min: -5, max: 30 },
  'camara-swap-1y': { min: -5, max: 30 },
  'pdbc-90d': { min: -5, max: 30 },
  'tpm-tna': { min: 0, max: 20 },
  // ── US (FRED, Phase 8D) ───────────────────────────────────────────────────
  'fed-funds': { min: 0, max: 20 },
  us3m: { min: -1, max: 20 },
  us2y: { min: -1, max: 20 },
  us10y: { min: -1, max: 20 },
  us20y: { min: -1, max: 20 },
  us30y: { min: -1, max: 20 },
  'us-unemployment': { min: 0, max: 30 },
  'us-cpi-mensual': { min: -5, max: 10 },
  'us-cpi-anual': { min: -5, max: 30 },
}

/** True when `value` is finite and within the band for `key` (or no band defined). */
export function isPlausible(key: string, value: number): boolean {
  const b = PLAUSIBILITY[key]
  if (!b) return true
  return Number.isFinite(value) && value >= b.min && value <= b.max
}

/** Short human-readable reason when a value is implausible (else null). */
export function plausibilityReason(key: string, value: number): string | null {
  const b = PLAUSIBILITY[key]
  if (!b) return null
  if (!Number.isFinite(value)) return `value is not finite`
  if (value < b.min || value > b.max) return `value ${value} outside plausible band [${b.min}, ${b.max}]`
  return null
}
