// R13.7 § 9 — resolving the OFFICIAL CLOSE FOR A CONTRACTUAL VALUATION DATE.
//
// PURE MODULE. Sources are injected as plain data; nothing here performs I/O,
// so the resolution policy is directly testable and cannot silently acquire a
// network dependency.
//
// THE DEFECT THIS REPLACES
// ────────────────────────
// `evaluateObservation` consumed `latestPrices` — the price map the monitoring
// run had just fetched for TODAY — regardless of which valuation date the
// observation belonged to. On a day the cron ran on time the two coincided, so
// the bug was invisible; the moment a run was missed (holiday, outage, a
// weekend-adjacent date) a past contractual observation would be decided by a
// LATER day's price. A contractual test must be evaluated against the level
// the contract names, on the date the contract names.
//
// The structural fix is in this module's SHAPE: it accepts a valuation date
// and date-keyed sources, and there is no parameter through which a caller
// could pass "today's price" for a past date. The old failure mode is not
// merely fixed, it is unrepresentable.
//
// SOURCE TIERING (evidence quality, best first)
// ─────────────────────────────────────────────
//  1. `persisted_snapshot` — this platform's own price snapshot recorded WITH
//     `price_date` equal to the valuation date. For the current book these were
//     captured by the monitoring cron ~21:30–22:00 UTC, i.e. after the 16:00
//     America/New_York close, so they are settled closing levels.
//  2. `provider_history`  — the provider's historical daily close for that date.
//  3. neither             → `unavailable`. NEVER a substitute from another date,
//     never an interpolation, never today's spot (§ 9).
//
// When both tiers answer, they are CROSS-CHECKED. Measured live on 2026-09-02,
// Yahoo's historical closes reproduced the persisted snapshots exactly for
// 2026-08-12/17/20 and 2026-09-01 — which is what makes tier 1 trustworthy.
// Yahoo has a genuine HOLE at 2026-08-28 (a real trading Friday absent from
// its daily series for both ^GSPC and ^RUT), which is precisely why tier 1
// leads and a single-sourced close is reported as such rather than discarded.

import type { StructuredNoteUnderlying } from './types.ts'
import { isIsoDate } from './marketDate.ts'

export type CloseSourceKind = 'persisted_snapshot' | 'provider_history' | 'unavailable'

export type CloseUnavailableReason =
  | 'no_close_for_valuation_date'
  | 'unsupported_symbol'
  | 'invalid_valuation_date'

/** A price snapshot already recorded for a specific market date. */
export interface DatedSnapshot {
  underlyingOrder: number
  /** The MARKET date this close belongs to (YYYY-MM-DD), not the instant it was fetched. */
  priceDate: string
  close: number | null
  source: string | null
}

/** A provider's historical daily close series for one underlying. */
export interface DatedHistory {
  underlyingOrder: number
  closesByDate: ReadonlyMap<string, number>
}

export interface ResolvedValuationClose {
  underlyingOrder: number
  underlyingName: string
  valuationDate: string
  close: number | null
  source: CloseSourceKind
  /** True when BOTH tiers produced a close and they agree within tolerance. */
  corroborated: boolean
  /** Relative gap between the two tiers when both answered, else null. */
  disagreementPct: number | null
  unavailableReason: CloseUnavailableReason | null
}

/**
 * Cross-source agreement tolerance.
 *
 * 0.1% is far wider than the float/rounding differences actually observed
 * (~1e-6 relative between the persisted snapshot and Yahoo's history) and far
 * tighter than any genuine wrong-instrument or wrong-date mismatch, which
 * would differ by whole percent.
 */
export const CLOSE_DISAGREEMENT_TOLERANCE = 0.001

function finite(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Resolves each underlying's official close for ONE contractual valuation date.
 *
 * Deliberately takes no "current price" argument of any kind.
 */
export function resolveValuationCloses(
  underlyings: StructuredNoteUnderlying[],
  valuationDate: string,
  snapshots: readonly DatedSnapshot[],
  history: readonly DatedHistory[] = [],
): ResolvedValuationClose[] {
  const validDate = isIsoDate(valuationDate)

  return underlyings.map((u): ResolvedValuationClose => {
    const base = {
      underlyingOrder: u.underlyingOrder,
      underlyingName: u.underlyingName,
      valuationDate,
    }
    if (!validDate) {
      return { ...base, close: null, source: 'unavailable', corroborated: false, disagreementPct: null, unavailableReason: 'invalid_valuation_date' }
    }

    // Tier 1 — this platform's own snapshot recorded FOR that market date.
    const snap = snapshots.find((s) => s.underlyingOrder === u.underlyingOrder && s.priceDate === valuationDate)
    const snapClose = finite(snap?.close ?? null)

    // Tier 2 — provider historical close for that market date.
    const hist = history.find((h) => h.underlyingOrder === u.underlyingOrder)
    const histClose = finite(hist?.closesByDate.get(valuationDate) ?? null)

    if (snapClose !== null && histClose !== null) {
      const gap = histClose === 0 ? null : Math.abs(snapClose / histClose - 1)
      const agree = gap !== null && gap <= CLOSE_DISAGREEMENT_TOLERANCE
      return {
        ...base,
        close: snapClose,
        source: 'persisted_snapshot',
        corroborated: agree,
        disagreementPct: gap,
        unavailableReason: null,
      }
    }
    if (snapClose !== null) {
      return { ...base, close: snapClose, source: 'persisted_snapshot', corroborated: false, disagreementPct: null, unavailableReason: null }
    }
    if (histClose !== null) {
      return { ...base, close: histClose, source: 'provider_history', corroborated: false, disagreementPct: null, unavailableReason: null }
    }

    return {
      ...base,
      close: null,
      source: 'unavailable',
      corroborated: false,
      disagreementPct: null,
      unavailableReason: u.yahooSymbol ? 'no_close_for_valuation_date' : 'unsupported_symbol',
    }
  })
}

/** The `underlyingOrder → close` map the contractual event engine consumes. Unresolved underlyings map to null so the engine reports `unknown` rather than silently omitting a leg. */
export function toCloseMap(resolved: readonly ResolvedValuationClose[]): Map<number, number | null> {
  const m = new Map<number, number | null>()
  for (const r of resolved) m.set(r.underlyingOrder, r.close)
  return m
}

/** True when every underlying resolved to a usable close. */
export function isFullyResolved(resolved: readonly ResolvedValuationClose[]): boolean {
  return resolved.length > 0 && resolved.every((r) => r.close !== null)
}

/** Cross-source disagreements beyond tolerance — a data-quality signal that must force human review, never a silent pick-one. */
export function disagreements(resolved: readonly ResolvedValuationClose[]): ResolvedValuationClose[] {
  return resolved.filter((r) => r.disagreementPct !== null && r.disagreementPct > CLOSE_DISAGREEMENT_TOLERANCE)
}
