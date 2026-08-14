'use client'

// R13.8 — the drill-down diverging horizontal bar rows behind *Weekly Value
// Change by Portfolio Hierarchy* (doc 07 § 6g; component mandated by § 9).
//
// PRESENTATION ONLY. Bars, drill targets, and reconciliation all arrive
// precomputed from the locked Stage-8 module (`buildHierarchyLevel` /
// `childrenOf` / `reconcileChildren`); the only arithmetic here is scaling a
// precomputed dollar change to a bar width. Parentage is NEVER reconstructed
// from labels, indentation, or row order — the caller passes the module's own
// hierarchy level.
//
// § 6g behaviour implemented here: positive changes extend RIGHT from a drawn
// common zero axis, negative changes extend LEFT; a bar with children is a
// real <button> (keyboard-operable) that drills in; direction is additionally
// carried by the SIGNED dollar value beside each bar, never by colour alone.
// Unavailable children render an explicit textual state — never a zero-length
// bar. Deliberately NOT a treemap (§ 6g: area cannot encode sign).
//
// PRIVACY: dollar values render through `MaskedAmount`. Bar extents are
// RELATIVE magnitudes (normalized to the level's largest change) — the same
// class of information as the allocation donut's weights, which the standing
// privacy policy leaves visible; no absolute amount survives masking in text,
// title, or the accessibility tree. Supporting text shows the module's
// `Impact on Portfolio Value` percentage, which follows the app's existing
// percentage policy.

import { useLang } from '@/components/providers/LangProvider'
import { formatRatioPct } from '@/lib/formatters'
import { MaskedAmount } from './MaskedAmount'

export interface DivergingBarDatum {
  key: string
  label: string
  /** Precomputed weekly value change — null when the node is unavailable. */
  value: number | null
  /** Precomputed Impact on Portfolio Value ratio (supporting text). */
  impact: number | null
  available: boolean
  /** Localized reason text, shown when unavailable (visible, not hover-only). */
  reasonText: string | null
  drillable: boolean
}

interface DivergingBarChartProps {
  bars: DivergingBarDatum[]
  masked: boolean
  onDrill: (key: string) => void
  emptyText: string
}

export function DivergingBarChart({ bars, masked, onDrill, emptyText }: DivergingBarChartProps) {
  const { t } = useLang()
  const w = t.fp.weeklyChanges

  if (bars.length === 0) {
    return <p className="ui-meta text-muted-fg py-6 text-center">{emptyText}</p>
  }

  // Presentation scaling only: the level's largest absolute change spans the
  // half-track. Values themselves are never derived here.
  const maxAbs = Math.max(
    1e-9,
    ...bars.map((b) => (b.value !== null && Number.isFinite(b.value) ? Math.abs(b.value) : 0)),
  )

  return (
    <ul className="flex flex-col gap-1.5" role="list">
      {bars.map((bar) => {
        const half = bar.value !== null ? (Math.abs(bar.value) / maxAbs) * 50 : 0
        const negative = bar.value !== null && bar.value < 0
        return (
          <li
            key={bar.key}
            className="grid grid-cols-[minmax(0,9rem)_1fr_auto] sm:grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-x-3 text-xs"
          >
            <span className="min-w-0 flex flex-col">
              {bar.drillable ? (
                <button
                  type="button"
                  onClick={() => onDrill(bar.key)}
                  aria-label={`${w.drillInto} ${bar.label}`}
                  className="min-w-0 inline-flex items-center gap-1 text-left text-foreground hover:text-accent nv-transition"
                >
                  <span className="truncate" title={bar.label}>
                    {bar.label}
                  </span>
                  <svg
                    viewBox="0 0 12 12"
                    className="w-2.5 h-2.5 shrink-0 text-muted-fg"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    aria-hidden="true"
                  >
                    <path d="M4.5 2.5 8 6l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <span className="truncate text-muted-fg" title={bar.label}>
                  {bar.label}
                </span>
              )}
              {!bar.available && (
                <span className="ui-meta text-muted-fg truncate">
                  {w.statusUnavailable}
                  {bar.reasonText ? ` — ${bar.reasonText}` : ''}
                </span>
              )}
            </span>

            {/* Common zero axis: positives extend right, negatives left (§ 6g). */}
            <span className="relative h-3.5 rounded-[3px] bg-surface-2 overflow-hidden" aria-hidden="true">
              <span
                className="absolute top-0 bottom-0 w-px"
                style={{ left: '50%', backgroundColor: 'var(--border-strong)' }}
              />
              {bar.available && bar.value !== null && bar.value !== 0 && (
                <span
                  className="absolute top-0 bottom-0 rounded-[2px]"
                  style={{
                    left: negative ? `${50 - half}%` : '50%',
                    width: `${Math.max(half, 0.5)}%`,
                    backgroundColor: negative ? 'var(--negative)' : 'var(--positive)',
                  }}
                />
              )}
            </span>

            <span className="text-right whitespace-nowrap flex flex-col items-end">
              <span className="ui-number">
                {bar.available ? (
                  <MaskedAmount
                    value={bar.value}
                    masked={masked}
                    signed
                    className={bar.value !== null && bar.value < 0 ? 'text-negative' : bar.value !== null && bar.value > 0 ? 'text-positive' : undefined}
                  />
                ) : (
                  <span className="text-muted-fg">—</span>
                )}
              </span>
              {bar.available && bar.impact !== null && (
                <span className="ui-meta text-muted-fg">
                  {w.impactOnPortfolio}: {formatRatioPct(bar.impact)}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
