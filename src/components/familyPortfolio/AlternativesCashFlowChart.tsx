'use client'

// R13.R4A · R13.R4A.1 — observed cash flow for ONE currency, over one period
// granularity.
//
// PRESENTATION ONLY. The columns, their per-type sums and their ordering all
// arrive from `periodColumns` in the pure module. This component never sums,
// never classifies, and never fabricates a period: it draws exactly the columns
// it is given, in the order it is given them.
//
// ONE CURRENCY PER CHART, ALWAYS. The scale is derived from this currency's own
// values, so no bar is ever measured against an amount in another
// denomination. A shared axis across currencies would be a cross-currency
// comparison in visual form, which is exactly what doc 03 § 4.2 forbids.
//
// TWO GRANULARITIES, ONE COMPONENT (R13.R4A.1). A column is a YEAR or a MONTH
// — the pure module decides which from the caller's period selection — and both
// arrive as the same `PeriodColumn`. That is what lets one click contract
// (`onSelectPeriod(period)`) serve a drill-down into either.
//
// A ZERO-VALUED MONTH IS NOT AN EMPTY ONE. `periodColumns` emits month columns
// only inside the currency's own recorded window, so a column with
// `hasEvents === false` means the source recorded that month and nothing moved.
// It draws no bar, is NOT clickable — there is nothing to open — and its
// tooltip says so in words rather than printing a 0 that might be mistaken for
// a measured figure.
//
// SEGMENTS ARE THE SOURCE'S OWN CLASSES. `dividendo` and `distribucion` are two
// distinct legend types, so they render as two stacked segments in their own
// `--alt-event-*` colours rather than merging into one invented
// "distributions" colour that belongs to neither. `unclassified` keeps the
// hollow needs-attention treatment it has everywhere else in this module.
//
// NEVER MEANING BY COLOUR ALONE: direction is carried by the baseline (calls
// below it, inflows above), every column is labelled, the hover tooltip names
// each figure in text, and the whole series is repeated as an accessible text
// summary. Columns are real `<button>`s when they open something, so the chart
// is keyboard-operable and the tooltip appears on focus as well as on hover.
//
// PRIVACY: every amount — tooltip included — renders through `MaskedAmount`. A
// chart label is not a loophole around the mask.
//
// THE TOOLTIP IS CLAMPED, NOT ESTIMATED (R13.R4A.4). It used to sit INSIDE the
// horizontally-scrolling plot, centred on its column with no bound at all, so
// the first and last columns pushed half of it past the plot's edge — where
// two separate boxes cut it off: the plot's own `overflow-x-auto` (a scroll
// container clips both axes, not just the one it scrolls), and, on Cash Flows,
// the `TableCard`'s `overflow-hidden`. It now renders OUTSIDE the scroll
// container, in a wrapper nothing clips, and its position is clamped to the
// wrapper's own visible box using the tooltip's MEASURED width — so it stays
// whole at every column, at every width, in either placement, and can never
// widen the page because it is bounded by a box that is already inside it.
// Where the box is genuinely narrower than the text, the text wraps inside the
// tooltip instead of being cut off by it.

import { useRef, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { ChartTooltip } from '@/components/fable/chart/ChartTooltip'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { altEventColorVar } from '@/lib/familyPortfolio/alternatives/eventPresentation'
import {
  clampTooltipLeft,
  tooltipMaxWidth,
} from '@/lib/familyPortfolio/alternatives/chartTooltipPosition'
import { currencyLabel, type PeriodColumn } from '@/lib/familyPortfolio/alternativesView'

/** Plot height above and below the zero baseline, in px. R13.R4A.1 raised it
 *  72 → 88 so a small period keeps visible proportion to the peak in the wide
 *  card regions, and the labels/tooltip sit with more air. */
const HALF_PX = 88
/** Minimum drawn height for a non-zero amount, so a small period stays visible. */
const MIN_BAR_PX = 2

/** Inflow types, drawn above the baseline in legend order. */
const INFLOW_TYPES = ['dividendo', 'distribucion', 'unclassified'] as const

/** `YYYY` stays itself; `YYYY-MM` shows its month — the year labels the chart. */
function columnLabel(column: PeriodColumn): string {
  return column.unit === 'month' ? column.period.slice(5, 7) : column.period
}

/** `YYYY-MM` → `MM-YYYY` for the tooltip, read off the string — never `new Date()`. */
function periodTitle(column: PeriodColumn): string {
  if (column.unit !== 'month') return column.period
  return `${column.period.slice(5, 7)}-${column.period.slice(0, 4)}`
}

interface Props {
  currency: string
  columns: readonly PeriodColumn[]
  masked: boolean
  /** Opens the drill-down for a column that has something to open. */
  onSelectPeriod?: (period: string) => void
}

export function AlternativesCashFlowChart({ currency, columns, masked, onSelectPeriod }: Props) {
  const { t } = useLang()
  const a = t.fp.alternatives
  // The hovered column's centre AND the box it must stay inside, both captured
  // at pointer/focus time from real geometry. Measuring here rather than reading
  // a ref during render keeps the clamp out of the render path entirely — and
  // `getBoundingClientRect` already accounts for however far the plot happens
  // to be scrolled, so no scroll offset is tracked separately.
  const [hovered, setHovered] = useState<{ period: string; center: number; boxWidth: number } | null>(
    null,
  )
  // The tooltip's own rendered width, so the clamp below is measured rather
  // than guessed. The inline callback re-runs on every render (its identity
  // changes) and only sets state when the width actually moves, so a tooltip
  // whose content differs column to column stays correctly bounded without
  // looping.
  const [tipWidth, setTipWidth] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  if (columns.length === 0) return null

  // Scale from this currency's own extremes only. Both halves share one scale
  // so a call and a distribution of equal size draw equal bars.
  const magnitudes = columns.map((c) => {
    const above = INFLOW_TYPES.reduce((s, k) => s + Math.max(0, c.byType[k] ?? 0), 0)
    return Math.max(Math.abs(c.calls), above)
  })
  const peak = Math.max(...magnitudes, 0)
  const px = (v: number) => {
    if (peak <= 0 || v === 0) return 0
    return Math.max(MIN_BAR_PX, (Math.abs(v) / peak) * HALF_PX)
  }

  const active = hovered !== null ? columns.find((c) => c.period === hovered.period) ?? null : null

  // Where the tooltip is allowed to sit, from `chartTooltipPosition` — the
  // arithmetic lives in a pure module because it is what decides whether the
  // reader sees a whole tooltip or a cut-off one, and that is worth testing
  // directly rather than inferring from a rendered page.
  const tipMax = hovered === null ? 0 : tooltipMaxWidth(hovered.boxWidth)
  const tipLeft =
    hovered === null
      ? 0
      : clampTooltipLeft({ center: hovered.center, boxWidth: hovered.boxWidth, tipWidth })

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* THE CLAMP BOX. Positioned, and NOT a scroll container — so it is the
          tooltip's containing block and nothing about the plot's horizontal
          scroll (or the card's own overflow) can cut the tooltip off. Its
          width is the room the tooltip actually has, and it is measured, not
          assumed. */}
      <div ref={boxRef} className="relative min-w-0">
        {active !== null && hovered !== null && (
          <ChartTooltip
            left={tipLeft}
            maxWidth={tipMax}
            innerRef={(el) => {
              if (el === null) return
              const w = el.offsetWidth
              setTipWidth((prev) => (prev === w ? prev : w))
            }}
          >
            {/* The module-wide tooltip grammar (FundamentalsChart, YieldCurve,
                PortfolioEvolutionChart): a heavier period header, then one
                label · figure row per series — muted label left, tabular
                amount right, `justify-between` so the widest row squares the
                block into one aligned column of figures. The amount is
                `whitespace-nowrap` and the label is not, so when `maxWidth`
                forces a wrap it is the WORDS that fold, never a figure split
                mid-number. No colour dots here: the distributions line sums
                two legend colours (dividendo + distribución), and a single
                dot would claim a mapping the chart does not have. */}
            <div className="flex flex-col gap-1 text-[11px] leading-tight min-w-0">
              <span className="ui-number font-semibold">
                {periodTitle(active)} · {currencyLabel(currency)}
              </span>
              {active.hasEvents ? (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-fg">{a.periodCallsLabel}</span>
                    <MaskedAmount
                      value={active.calls}
                      masked={masked}
                      signed
                      zeroDash
                      compact="unit"
                      className="ui-number whitespace-nowrap"
                    />
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-fg">{a.periodDistLabel}</span>
                    <MaskedAmount
                      value={active.distributions}
                      masked={masked}
                      signed
                      zeroDash
                      compact="unit"
                      className="ui-number whitespace-nowrap"
                    />
                  </div>
                  {active.unclassified !== 0 && (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-fg">{a.kpiUnclassifiedAmount}</span>
                      <MaskedAmount
                        value={active.unclassified}
                        masked={masked}
                        signed
                        zeroDash
                        compact="unit"
                        className="ui-number whitespace-nowrap"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-muted-fg">{a.noMovementRecorded}</span>
              )}
            </div>
          </ChartTooltip>
        )}
        <div
          className="overflow-x-auto nv-scrollbar-hidden"
          role="group"
          aria-label={`${a.monthlyTitle} · ${currencyLabel(currency)}`}
        >
          {/* The inner wrapper sizes to CONTENT (w-max) but never below the
              card's width (min-w-full), so the absolutely-positioned baseline
              below spans every column even when the plot scrolls, and the
              columns still flex out to fill a wide card. */}
          <div className="relative flex items-end gap-2 w-max min-w-full">
            {/* ONE continuous zero baseline — the only thing that states
                direction. Drawn once across the whole plot rather than as a
                per-column dash, so the reader's eye gets a single unbroken
                reference line; the columns are positioned (relative) and later
                in the DOM, so bars paint over it where they meet it. */}
            <span
              aria-hidden
              className="absolute left-0 right-0 h-px bg-border-strong"
              style={{ top: HALF_PX }}
            />

            {columns.map((c) => {
              const above = INFLOW_TYPES.map((k) => ({ k, v: Math.max(0, c.byType[k] ?? 0) })).filter(
                (s) => s.v > 0,
              )
              // Only a column the source has something in can be opened; an
              // empty month has no movements to show.
              const clickable = c.hasEvents && onSelectPeriod !== undefined
              const track = (el: HTMLElement) => {
                const box = boxRef.current
                if (box === null) return
                const b = box.getBoundingClientRect()
                const r = el.getBoundingClientRect()
                // Viewport rects, differenced — so however far the plot is
                // scrolled, the centre is where the column actually IS.
                setHovered({ period: c.period, center: r.left - b.left + r.width / 2, boxWidth: b.width })
              }
              return (
                <button
                  key={c.period}
                  type="button"
                  disabled={!clickable}
                  onClick={clickable ? () => onSelectPeriod?.(c.period) : undefined}
                  onMouseEnter={(e) => track(e.currentTarget)}
                  onFocus={(e) => track(e.currentTarget)}
                  onMouseLeave={() => setHovered(null)}
                  onBlur={() => setHovered(null)}
                  title={clickable ? a.chartClickHint : undefined}
                  className={`relative flex flex-col items-center shrink-0 min-w-[2.25rem] flex-1 rounded-[6px] nv-transition ${
                    clickable ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'
                  }`}
                >
                  {/* Inflows, stacked above the baseline, in legend order. The
                      bar cap (3rem) keeps a wide region's columns from turning
                      into thin, widely-spaced sticks while the hit area still
                      spans the whole column. */}
                  <div className="flex flex-col justify-end w-full items-center" style={{ height: HALF_PX }}>
                    {above.map((s) => (
                      <span
                        key={s.k}
                        className="block w-full max-w-[3rem] rounded-t-[2px]"
                        style={
                          s.k === 'unclassified'
                            ? {
                                height: px(s.v),
                                border: `1px solid ${altEventColorVar(s.k)}`,
                                backgroundColor: 'transparent',
                              }
                            : { height: px(s.v), backgroundColor: altEventColorVar(s.k) }
                        }
                      />
                    ))}
                  </div>
                  {/* Capital calls, below the baseline. */}
                  <div className="flex flex-col justify-start w-full items-center" style={{ height: HALF_PX }}>
                    {c.calls < 0 && (
                      <span
                        className="block w-full max-w-[3rem] rounded-b-[2px]"
                        style={{ height: px(c.calls), backgroundColor: altEventColorVar('aporte') }}
                      />
                    )}
                  </div>
                  <span className="ui-meta ui-number text-muted-fg mt-2 whitespace-nowrap">
                    {columnLabel(c)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* The same figures as text — the chart is never the only carrier. */}
      <ul className="sr-only">
        {columns.map((c) => (
          <li key={c.period}>
            {periodTitle(c)} ·{' '}
            {c.hasEvents ? (
              <>
                {a.periodCallsLabel} <MaskedAmount value={c.calls} masked={masked} signed zeroDash /> ·{' '}
                {a.periodDistLabel} <MaskedAmount value={c.distributions} masked={masked} signed zeroDash /> ·{' '}
                {currencyLabel(currency)}
              </>
            ) : (
              a.noMovementRecorded
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
