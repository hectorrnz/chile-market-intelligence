'use client'

// R13.8 — reusable reconciliation-state presentation (doc 07 §§ 6d, 6e, 6g;
// component mandated by doc 07 § 9).
//
// PRESENTATION ONLY: the state and the residual arrive precomputed from the
// locked Stage-8 calculation module — nothing here compares, sums, or applies
// a tolerance. The three documented states stay distinct: `partial` is never
// collapsed into success, and a residual is always shown explicitly beside
// its state, never absorbed or hidden.
//
// State is never colour alone: every state carries its own text label, and
// the residual amount is written out (privacy-masked like every monetary
// figure in this module).

import { useLang } from '@/components/providers/LangProvider'
import { MaskedAmount } from './MaskedAmount'

export type ReconciliationDisplayState = 'reconciled' | 'partial' | 'unavailable'

interface ReconciliationStatusProps {
  state: ReconciliationDisplayState
  /** The explicit residual, when one exists. Null = none to report. */
  residual?: number | null
  /** Count of inputs whose change is unknown (drives the partial/unavailable copy). */
  unavailableCount?: number
  /** Names what the count refers to, e.g. "driver(s) unavailable". */
  unavailableNoun?: string
  masked: boolean
  className?: string
}

const DOT: Record<ReconciliationDisplayState, string> = {
  reconciled: 'var(--positive)',
  partial: 'var(--warning)',
  unavailable: 'var(--warning)',
}

export function ReconciliationStatus({
  state,
  residual = null,
  unavailableCount = 0,
  unavailableNoun,
  masked,
  className = '',
}: ReconciliationStatusProps) {
  const { t } = useLang()
  const w = t.fp.weeklyChanges
  const label =
    state === 'reconciled' ? w.reconciled : state === 'partial' ? w.partiallyReconciled : w.reconciliationUnavailable

  const showResidual = residual !== null && Number.isFinite(residual) && state !== 'reconciled'

  return (
    <p className={`ui-meta flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-fg ${className}`}>
      <span aria-hidden className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: DOT[state] }} />
      <span className={state === 'reconciled' ? '' : 'text-foreground'}>{label}</span>
      {showResidual && (
        <span className="flex items-center gap-1">
          {/* R13.R5C.1 § 2.2 — a residual is a difference, and takes the same
              mark as every other difference in the module. */}
          · {w.residual}: <MaskedAmount value={residual} masked={masked} signed />
        </span>
      )}
      {unavailableCount > 0 && unavailableNoun && (
        <span>
          · {unavailableCount} {unavailableNoun}
        </span>
      )}
    </p>
  )
}
