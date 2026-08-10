'use client'

// R13.8 — *Drivers of Weekly Portfolio Value Change* (doc 07 § 6e; component
// mandated by doc 07 § 9).
//
// PRESENTATION ONLY. The steps arrive PRECOMPUTED from the locked Stage-8
// calculation module — opening, structurally-derived drivers, an explicit
// residual step when the set does not tie, and closing. Nothing here sums,
// reconciles, or derives a financial value; the only arithmetic below is the
// pixel mapping from each step's precomputed running total to a bar position.
//
// PRESENTATION CHOICES (Fable's domain, doc 07 § 8):
//   * Horizontal cumulative bars — one row per step, a shared value axis —
//     following the AllocationDonut precedent of graphics beside REAL HTML
//     text, so labels truncate responsively and the chart is its own
//     accessible textual equivalent (each row reads label + signed value).
//     No chart library (the actual rule behind doc 07 § 9's "inline SVG").
//   * Direction is never colour alone: every driver carries its signed
//     dollar value, and the residual step is dash-outlined AND labelled.
//   * A residual step is visually distinct from a genuine economic driver
//     (dashed outline, warning tint) — a partial waterfall can never read
//     as fully reconciled; the caller renders `ReconciliationStatus` beside
//     this chart.
//
// PRIVACY: bar POSITIONS encode absolute portfolio levels, so when masked the
// ENTIRE chart is replaced by the established privacy treatment (the Stage-7
// evolution-chart precedent) — no bar, label, axis, tooltip, aria text, or
// hidden DOM node carries an amount while masked.
//
// HONESTY: an unavailable driver makes every later running total unknowable
// (the module already nulls them) — cumulative bars are then impossible, so
// this component degrades to an explicit step LIST with the unavailable steps
// marked, never a chart that silently pretends the gap is zero.

import { useLang } from '@/components/providers/LangProvider'
import { PrivacyValue } from '@/components/fable/PrivacyValue'
import { MaskedAmount } from './MaskedAmount'
import type { Waterfall, WaterfallStep } from '@/lib/familyPortfolio/weeklyChanges'

interface ValueChangeWaterfallProps {
  waterfall: Waterfall
  masked: boolean
  lang: 'en' | 'es'
}

function stepLabel(step: WaterfallStep, lang: 'en' | 'es'): string {
  return lang === 'es' ? step.labelEs : (step.labelEn ?? step.labelEs)
}

/** Fill per step kind — semantic tokens only. */
function barStyle(step: WaterfallStep): React.CSSProperties {
  if (step.kind === 'opening' || step.kind === 'closing') {
    return { backgroundColor: 'color-mix(in oklab, var(--accent) 55%, var(--surface))' }
  }
  if (step.kind === 'residual') {
    return {
      backgroundColor: 'color-mix(in oklab, var(--warning) 30%, var(--surface))',
      border: '1px dashed var(--warning)',
    }
  }
  const v = step.value ?? 0
  return { backgroundColor: v < 0 ? 'var(--negative)' : 'var(--positive)' }
}

export function ValueChangeWaterfall({ waterfall, masked, lang }: ValueChangeWaterfallProps) {
  const { t } = useLang()
  const w = t.fp.weeklyChanges

  if (masked) {
    // Whole-chart replacement — the Stage-7 evolution-chart precedent.
    return (
      <PrivacyValue masked className="block py-10 text-center">
        {null}
      </PrivacyValue>
    )
  }

  const steps = waterfall.steps
  // Cumulative bars need every running total; an unavailable driver nulls the
  // later ones, so the chart honestly degrades to a listed sequence.
  const listMode = steps.some((s) => s.kind === 'driver' && s.runningTotal === null)

  // Pixel domain over the precomputed running totals (presentation scaling
  // only — no financial value is derived here).
  const levels = steps.map((s) => s.runningTotal).filter((v): v is number => v !== null && Number.isFinite(v))
  const lo = levels.length > 0 ? Math.min(...levels) : 0
  const hi = levels.length > 0 ? Math.max(...levels) : 1
  const span = hi - lo
  const pad = span > 0 ? span * 0.06 : Math.max(1, Math.abs(hi) * 0.02)
  const floor = lo - pad
  const range = hi + pad - floor
  const pct = (v: number) => ((v - floor) / range) * 100

  // Each step's bar start, precomputed (React Compiler: no reassignment during
  // render): a level bar rises from the domain floor; a delta bar starts at
  // the PREVIOUS step's precomputed running total.
  const barStarts: Array<number | null> = steps.map((step, i) => {
    if (step.kind === 'opening' || step.kind === 'closing') return floor
    return i > 0 ? steps[i - 1].runningTotal : null
  })

  return (
    <div className="flex flex-col gap-1.5">
      {listMode && <p className="ui-meta text-muted-fg">{w.waterfallListFallback}</p>}
      <ul className="flex flex-col gap-1" role="list">
        {steps.map((step, i) => {
          const label = stepLabel(step, lang)
          const isLevel = step.kind === 'opening' || step.kind === 'closing'
          const from = barStarts[i]
          const to = isLevel ? step.value : step.runningTotal
          const drawable = !listMode && from !== null && to !== null && step.status === 'ok'
          const left = drawable ? Math.min(pct(from as number), pct(to as number)) : 0
          const width = drawable ? Math.max(Math.abs(pct(to as number) - pct(from as number)), 0.5) : 0

          return (
            <li
              key={`${step.kind}-${step.rowKey ?? i}`}
              className="grid grid-cols-[minmax(0,9rem)_1fr_auto] sm:grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-x-3 text-xs"
            >
              <span
                className={`min-w-0 truncate ${isLevel ? 'font-medium text-foreground' : step.kind === 'residual' ? 'text-foreground' : 'text-muted-fg'}`}
                title={label}
              >
                {label}
              </span>
              <span className="relative h-3.5 rounded-[3px] bg-surface-2 overflow-hidden" aria-hidden="true">
                {drawable && (
                  <span
                    className="absolute top-0 bottom-0 rounded-[3px]"
                    style={{ left: `${left}%`, width: `${width}%`, ...barStyle(step) }}
                  />
                )}
              </span>
              <span className="ui-number text-right whitespace-nowrap">
                {step.status !== 'ok' || step.value === null ? (
                  <span className="text-muted-fg">{w.statusUnavailable}</span>
                ) : (
                  <MaskedAmount
                    value={step.value}
                    masked={masked}
                    signed={!isLevel}
                    className={
                      step.kind === 'driver' ? (step.value < 0 ? 'text-negative' : 'text-positive') : undefined
                    }
                  />
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
