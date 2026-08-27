'use client'

// R13.R3C — CONTRIBUTORS AND DETRACTORS, drawn.
//
// PRESENTATION ONLY. Every figure arrives PRECOMPUTED from
// `buildContributionSet` / `contributionAxis` (`src/lib/familyPortfolio/
// contributionChart.ts`). This file sums nothing, ranks nothing, omits
// nothing and decides no reconciliation — it turns numbers into rectangles.
// ONE HOME: both the Summary card and the Weekly Changes hierarchy card render
// THIS component, so the two surfaces can never draw the same measure
// differently.
//
// ── THE GEOMETRY IS THE CLAIM ─────────────────────────────────────────────
//
// Zero is a real, drawn gridline, not a baseline of convenience: contributors
// grow up from it, detractors grow down from it, and the two directions share
// one scale, so a bar twice as tall really is twice the money. The axis bounds
// come from `contributionAxis`, which only ever rounds OUTWARD, so no bar can
// be clipped by its own scale.
//
// ── A SUB-PIXEL BAR IS STILL A BAR ────────────────────────────────────────
//
// `max(1px, …%)` gives every plotted component a one-CSS-pixel floor that does
// not scale with the plot height, and the hit area is the FULL COLUMN, so a
// one-pixel bar is not a one-pixel target. A component that moved a little
// beside one that moved a great deal must still be visible: vanishing would
// read as "did not move", which is exactly the state the zero-omission rule
// reports separately and explicitly.
//
// ── PRIVACY: RELATIVE MAGNITUDES STAY, ABSOLUTE AMOUNTS GO ────────────────
//
// This follows `DivergingBarChart`'s established policy rather than the
// retired bridge's. The bridge blanked its whole plot because its bars floated
// at absolute cumulative LEVELS, so their vertical position leaked the
// portfolio's value. These bars all start at zero and encode a magnitude
// relative to the axis maximum — the same class of information as the
// allocation donut's weights, which the standing privacy policy leaves
// visible. Every absolute amount (axis labels, tooltip, the accessibility
// table) goes through `MaskedAmount` or is withheld outright.
//
// ── COMPOSITION (R13.R3C visual pass) ─────────────────────────────────────
//
// A real book plots anywhere from 2 to 16 bars, with labels as long as
// "Fondo de Inversión HMC Inmobiliario Perú II", so the drawing adapts on the
// MEASURED column width, not the bar count:
//  · Bar width is a fraction of the column but capped in px (`MAX_BAR_PX`),
//    so a three-bar chart reads as bars over a shared zero line, never slabs,
//    while a sixteen-bar chart keeps a real gap between columns.
//  · Wide columns keep horizontal two-line labels; below
//    `ROTATE_LABELS_BELOW_PX` the labels rotate 45°, end-anchored at the
//    column centre — the classic dense-axis treatment — with the full label
//    preserved on `title` in both modes.
//  · Hover adds a full-height column wash (`--chart-hover-column`) under the
//    bar in addition to dimming siblings; keyboard focus takes the global
//    ring. Reduced motion is honoured globally (all transitions → .01ms).
//  · The RESIDUAL is an unattributed remainder, not a holding that moved: it
//    draws HOLLOW — a dashed neutral outline over a translucent neutral fill
//    — so it is tellable from a real component at a glance without any new
//    colour. `contributionSwatchStyle` gives dots (breakdown rows) the same
//    hollow treatment, so every surface says "residual" identically.
//
// ── R13.R3C.2 · READING THE CHART, NOT THE NUMBERS ────────────────────────
//
// Three changes from owner review, all presentation:
//  · ORDER is descending by signed value (`rankContributions`), so the set
//    reads as one falling profile with the biggest gain and the biggest loss
//    at the two ends rather than at the two edges of a V.
//  · AMOUNTS on the axis and in the tooltip render at
//    `MaskedAmount compact="unit"` — a whole number and a unit (`5M`, `-98K`).
//    Eleven grouped digits in an axis gutter are read for magnitude, and a
//    decimal on a `2M` gridline is noise. The AXIS forces ONE unit for every
//    tick (`compactUnitForStep`); the tooltip, being a lone figure, picks its
//    own. Without that split a 500.000 step printed `1M` beside `2M` for two
//    ticks 500.000 apart — the scale appearing to change mid-axis.
//  · The TOOLTIP dropped its name line: the x-axis label sits directly under
//    the hovered column, so restating it spent the card's width on nothing.
//    What it shows is what the geometry cannot — the amount and its share.

import { useLayoutEffect, useState, type CSSProperties } from 'react'
import type { ContributionAxis, ContributionItem, ContributionSet } from '@/lib/familyPortfolio/contributionChart'
import { useLang } from '@/components/providers/LangProvider'
import { ChartTooltip } from '@/components/fable/chart/ChartTooltip'
import { MaskedAmount } from './MaskedAmount'
import { compactUnitForStep, formatRatioPct } from '@/lib/formatters'
import {
  contributionLabel,
  type ContributionLabelOverrides,
} from '@/lib/familyPortfolio/contributionLabels'

/** Share of a column occupied by its bar; the rest is the gap that separates them. */
const BAR_FRACTION = 0.62
/** A bar never grows past this, however wide its column — few bars on a wide
 *  card must still read as bars over a zero line, not slabs. */
const MAX_BAR_PX = 72
/** Visibility floor in CSS px, NOT a percentage — see the header note. */
const MIN_BAR_PX = 1
/** Below this a column's label is unreadable, so the plot scrolls inside its card. */
const MIN_COLUMN_PX = 56
/** Keeps the tooltip inside the plot at either edge, as every other chart does. */
const TOOLTIP_INSET = 72
/** Columns narrower than this rotate their x labels 45° — two-line clamping
 *  stops being readable well before the columns stop being drawable. */
const ROTATE_LABELS_BELOW_PX = 88
/** Diagonal length cap for one rotated label (ellipsized past it). */
const X_LABEL_MAX_PX = 112
/** Rotated-band height: sin 45° × (label cap + line height) + anchor offset. */
const ROTATED_BAND_PX = 94
/**
 * R13.R3C.4 — below this VISIBLE card width the x labels stand fully upright
 * (90°) instead of leaning at 45°.
 *
 * The signal is the width of the SCROLL CONTAINER, not the plot: on a phone the
 * plot itself is as wide as its bars demand and simply scrolls, so plot width
 * says nothing about how much room the reader actually has. The container is
 * the honest measure of "narrow", and it is why a desktop chart with sixteen
 * bars keeps its 45° labels — it is crowded, not narrow.
 */
const VERTICAL_LABELS_BELOW_PX = 460
/** Upright length cap for one label (ellipsized past it), and its band. */
const X_LABEL_VERTICAL_MAX_PX = 96
const VERTICAL_BAND_PX = 104
/**
 * Half the line box of an upright label, in px. A label rotated about its
 * top-right corner lands entirely to the RIGHT of that corner, so it is pulled
 * back by half its own thickness to sit centred over its column.
 */
const VERTICAL_LABEL_LINE_PX = 12

/** The fill for one bar. A residual is neutral: a remainder, not a holding that moved. */
export function contributionFill(item: ContributionItem): string {
  if (item.kind === 'residual') return 'var(--chart-neutral)'
  return item.direction === 'contributor' ? 'var(--positive)' : 'var(--negative)'
}

/**
 * The swatch treatment for a dot that stands for one item (tooltip, breakdown
 * rows). A component is a solid dot in its own fill; the residual is HOLLOW —
 * a neutral outline over a translucent neutral fill — matching the bar's own
 * hollow treatment, so "unattributed remainder" looks the same everywhere.
 */
export function contributionSwatchStyle(item: ContributionItem): CSSProperties {
  if (item.kind === 'residual') {
    return {
      backgroundColor: 'color-mix(in oklab, var(--chart-neutral) 24%, transparent)',
      border: '1px solid var(--chart-neutral)',
    }
  }
  return { backgroundColor: contributionFill(item) }
}

interface ContributionChartProps {
  set: ContributionSet
  axis: ContributionAxis
  masked: boolean
  /** Called with the row key of a component the source can decompose further. */
  onSelect: (rowKey: string) => void
  emptyText: string
  ariaLabel: string
  /** Display names for sociedad-grain rows; see `ContributionLabelOverrides`. */
  labelOverrides?: ContributionLabelOverrides
  /** Plot height in px. The x-axis label band sits below it. */
  height?: number
  /**
   * R13.R3C.4 — grow the PLOT to whatever height the parent gives the chart,
   * instead of drawing at a fixed `height`.
   *
   * Weekly Changes sets its hierarchy card beside a column of two ranked
   * tables and asks the two to end level; the slack has to land somewhere, and
   * the honest place is the plot, not padding under it. `height` stays the
   * FLOOR in this mode, so a stacked one-column layout — where the parent
   * hands down no definite height at all — still draws at its normal size.
   *
   * Nothing about the drawing changes: every gridline and bar is positioned as
   * a percentage of the plot's own height, so a taller plot is the same chart
   * at a larger scale, never a different one.
   */
  fill?: boolean
}

export function ContributionChart({
  set,
  axis,
  masked,
  onSelect,
  emptyText,
  ariaLabel,
  labelOverrides,
  height = 240,
  fill = false,
}: ContributionChartProps) {
  const { t, lang } = useLang()
  const c = t.fp.contrib
  const [hover, setHover] = useState<number | null>(null)
  // A CALLBACK REF, not `useRef`, and deliberately: the plot is not rendered at
  // all when the set is empty (every component moved by exactly nothing, which
  // is a real state on a quiet week), so a `useRef` + `[]`-dependency effect
  // would run once against a null node and never attach. The chart would then
  // keep drawing at the seed width after a period switch brought bars back —
  // and since bar width and the label mode are both decided from the MEASURED
  // column width, it would pick the wrong ones. Keying the effect on the node
  // itself makes it attach exactly when the plot appears.
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null)
  const [plotW, setPlotW] = useState(560)
  // R13.R3C.4 — the SCROLL CONTAINER, measured separately from the plot. The
  // plot grows to whatever its bars need and scrolls; only this element knows
  // how much width the reader actually has, which is what decides whether the
  // x labels lean or stand upright.
  const [viewEl, setViewEl] = useState<HTMLDivElement | null>(null)
  const [viewW, setViewW] = useState(560)

  useLayoutEffect(() => {
    if (plotEl === null) return
    // The measurement is taken ONLY from the observer callback. `observe()`
    // fires it once immediately with the element's current size, so a
    // synchronous `setPlotW` here would be redundant — and it is the one shape
    // the project's React-Compiler rule forbids (`set-state-in-effect`).
    const ro = new ResizeObserver(() => setPlotW(plotEl.clientWidth))
    ro.observe(plotEl)
    return () => ro.disconnect()
  }, [plotEl])

  useLayoutEffect(() => {
    if (viewEl === null) return
    const ro = new ResizeObserver(() => setViewW(viewEl.clientWidth))
    ro.observe(viewEl)
    return () => ro.disconnect()
  }, [viewEl])

  const bars = set.items

  if (bars.length === 0) {
    return (
      <div
        className={`w-full flex items-center justify-center${fill ? ' flex-1 min-h-0' : ''}`}
        style={{ minHeight: height }}
      >
        <p className="ui-meta text-muted-fg text-center px-4">{emptyText}</p>
      </div>
    )
  }

  // ONE unit for the whole axis, chosen from its own gridline interval — a
  // per-value unit would print two ticks 500.000 apart as `1M` and `2M`.
  const axisUnit = compactUnitForStep(axis.step)

  const span = axis.max - axis.min
  /** Distance from the TOP of the plot, as a percentage of its height. */
  const topPct = (v: number) => (span > 0 ? ((axis.max - v) / span) * 100 : 100)
  const zeroTop = topPct(0)

  const n = bars.length
  const colW = 100 / n
  /** Measured pixel width of one column — bar width and label mode are decided
   *  in px, because a percentage alone cannot tell a slab from a comb. */
  const colPx = plotW > 0 ? plotW / n : MIN_COLUMN_PX
  const barPx = Math.min(colPx * BAR_FRACTION, MAX_BAR_PX)
  const barWPct = plotW > 0 ? (barPx / plotW) * 100 : colW * BAR_FRACTION
  /**
   * Three label modes, narrowest first. Upright wins outright on a narrow card:
   * at 45° a long fund name is ellipsized to well under half its length and its
   * tail runs off the card's left edge, while upright it is confined to its own
   * column and cannot collide with a neighbour at any bar count.
   */
  const verticalLabels = viewW < VERTICAL_LABELS_BELOW_PX
  const rotateLabels = !verticalLabels && colPx < ROTATE_LABELS_BELOW_PX

  const active = hover !== null ? (bars[hover] ?? null) : null
  const tipLeft =
    hover === null
      ? 0
      : Math.max(
          Math.min(TOOLTIP_INSET, plotW / 2),
          Math.min(plotW - Math.min(TOOLTIP_INSET, plotW / 2), ((colW * hover + colW / 2) / 100) * plotW),
        )

  return (
    <div
      ref={setViewEl}
      className={`w-full overflow-x-auto -mx-1 px-1${fill ? ' flex-1 min-h-0 flex flex-col' : ''}`}
    >
      {/* pt-2 is headroom: the topmost tick label centres on the plot's top
          edge, and the focus ring sits 2px proud of the column button — both
          need room inside the scroll container rather than a clipped edge. */}
      <div
        className={`pt-2${fill ? ' flex-1 min-h-0 flex flex-col' : ''}`}
        style={{ minWidth: Math.max(1, n) * MIN_COLUMN_PX }}
      >
        {/* ── plot ────────────────────────────────────────────────────── */}
        <div
          className={`relative w-full${fill ? ' flex-1 min-h-0' : ''}`}
          style={fill ? { minHeight: height } : { height }}
        >
          {/* Gridlines. Zero is drawn stronger — every bar is anchored to it.
              The value gutter is sized for the compact one-unit tick form
              (`-2.500K` at the widest), not the grouped amounts it once
              carried — w-12/sm:w-14 clears that worst case with room, and
              the reclaimed width goes to the plot. Kept in sync in THREE
              places: this tick span, the bars container's `left-*`, and the
              x-axis spacer below. */}
          {axis.ticks.map((tick) => (
            <div
              key={tick}
              className="absolute left-0 right-0 flex items-center pointer-events-none"
              style={{ top: `${topPct(tick)}%`, transform: 'translateY(-50%)' }}
              aria-hidden="true"
            >
              <span className="w-12 sm:w-14 shrink-0 pr-2 text-right ui-meta text-muted-fg ui-number leading-none">
                {/* Withheld rather than masked: five stacked bullet strings in a
                    narrow gutter is noise, and hiding is stronger than masking. */}
                {/* R13.R5C.2 — `zeroDash={false}`: THE ONE opt-out from the
                  Portfolio zero contract. This is the axis, not a value. Every
                  bar on this chart is anchored to the zero gridline, and a
                  baseline labelled `-` between `-2M` and `2M` reads as a stray
                  minus sign rather than as zero. The bar amounts in the tooltip
                  and the hidden table below take the mark like everything
                  else. */}
              {masked ? null : (
                <MaskedAmount value={tick} masked={false} compact="unit" compactUnit={axisUnit} zeroDash={false} />
              )}
              </span>
              <span
                className="flex-1 border-t"
                style={{
                  borderColor: tick === 0 ? 'var(--border-strong)' : 'var(--chart-grid)',
                  opacity: tick === 0 ? 1 : 0.5,
                }}
              />
            </div>
          ))}

          {/* bars */}
          <div ref={setPlotEl} className="absolute inset-y-0 right-0 left-12 sm:left-14">
            {/* Hover column wash — under the bars, the same device
                FundamentalsChart uses, so the hovered column reads as a
                column even when its bar is one pixel tall. */}
            {hover !== null && (
              <span
                className="absolute inset-y-0 pointer-events-none"
                style={{
                  left: `${colW * hover}%`,
                  width: `${colW}%`,
                  backgroundColor: 'var(--chart-hover-column)',
                }}
                aria-hidden="true"
              />
            )}

            {bars.map((bar, i) => {
              const positive = bar.value > 0
              const top = positive ? topPct(bar.value) : zeroTop
              const bottom = positive ? zeroTop : topPct(bar.value)
              const left = colW * i + (colW - barWPct) / 2
              const label = contributionLabel(bar, lang, labelOverrides)
              const interactive = bar.drillable && bar.rowKey !== null
              const key = bar.rowKey ?? `residual-${i}`

              return (
                <span key={key}>
                  <span
                    className="absolute block rounded-[2px] nv-transition"
                    style={{
                      left: `${left}%`,
                      width: `${barWPct}%`,
                      top: `${top}%`,
                      height: `max(${MIN_BAR_PX}px, ${bottom - top}%)`,
                      opacity: hover === null || hover === i ? 1 : 0.55,
                      // The residual draws hollow — dashed neutral outline,
                      // translucent neutral fill — a remainder, not a holding.
                      ...(bar.kind === 'residual'
                        ? {
                            backgroundColor: 'color-mix(in oklab, var(--chart-neutral) 24%, transparent)',
                            border: '1px dashed var(--chart-neutral)',
                          }
                        : { backgroundColor: contributionFill(bar) }),
                    }}
                    aria-hidden="true"
                  />
                  {interactive ? (
                    <button
                      type="button"
                      className="absolute top-0 bottom-0 rounded-[var(--radius-cell)]"
                      style={{ left: `${colW * i}%`, width: `${colW}%` }}
                      onPointerEnter={() => setHover(i)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                      onClick={() => onSelect(bar.rowKey as string)}
                      aria-label={`${c.drillInto} ${label}`}
                    />
                  ) : (
                    <span
                      className="absolute top-0 bottom-0"
                      style={{ left: `${colW * i}%`, width: `${colW}%` }}
                      onPointerEnter={() => setHover(i)}
                      onPointerLeave={() => setHover(null)}
                    />
                  )}
                </span>
              )
            })}

            {active !== null && (
              /* R13.R3C.2 — TWO LINES, and deliberately no third. The tooltip
                 used to repeat the component's name, which the x-axis label
                 directly under the hovered column already carries; a hover
                 card whose first line restates what the reader is pointing at
                 spends its width saying nothing. What is left is the pair the
                 chart cannot show geometrically: the amount, and its share of
                 the period's net change. On the share line only the LABEL is
                 muted; the figure takes the tooltip's own foreground and
                 tabular alignment, so the two lines read as one column of
                 figures rather than a number over a grey sentence. */
              <ChartTooltip left={tipLeft}>
                <div className="flex flex-col gap-0.5">
                  <MaskedAmount
                    value={active.value}
                    masked={masked}
                    signed
                    compact="unit"
                    className={`ui-number text-sm ${
                      active.value < 0 ? 'text-negative font-semibold' : 'text-positive font-semibold'
                    }`}
                  />
                  <span className="ui-meta whitespace-nowrap">
                    <span className="text-muted-fg">{c.shareOfChange}:</span>{' '}
                    <span className="ui-number">
                      {active.shareOfNet !== null ? formatRatioPct(active.shareOfNet) : c.shareUnavailable}
                    </span>
                  </span>
                </div>
              </ChartTooltip>
            )}
          </div>
        </div>

        {/* ── x axis: component labels only ───────────────────────────── */}
        <div className="flex pt-1.5">
          <span className="w-12 sm:w-14 shrink-0" aria-hidden="true" />
          {verticalLabels ? (
            /* R13.R3C.4 — narrow card: each label stands fully upright, its END
               anchored at the column centre, reading bottom-to-top (the same
               direction the 45° mode reads, just steeper). Upright labels are
               confined to their own column's width, so unlike the leaning mode
               they cannot cascade into a neighbour or off the card edge, at any
               bar count. Ellipsized past `X_LABEL_VERTICAL_MAX_PX`; the full
               label survives on `title`, exactly as in the other two modes. */
            <div className="relative flex-1" style={{ height: VERTICAL_BAND_PX }}>
              {bars.map((bar, i) => {
                const label = contributionLabel(bar, lang, labelOverrides)
                return (
                  <span
                    key={bar.rowKey ?? `residual-label-${i}`}
                    className="absolute top-0 w-0"
                    style={{ left: `${colW * i + colW / 2}%` }}
                  >
                    <span
                      className="absolute right-0 block ui-meta text-muted-fg whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{
                        top: 2,
                        maxWidth: X_LABEL_VERTICAL_MAX_PX,
                        lineHeight: `${VERTICAL_LABEL_LINE_PX}px`,
                        // Rotate about the top-right corner, then pull back half
                        // a line box so the upright label sits centred over its
                        // column rather than hanging off its right edge.
                        transform: `translateX(-${VERTICAL_LABEL_LINE_PX / 2}px) rotate(-90deg)`,
                        transformOrigin: '100% 0',
                      }}
                      title={label}
                    >
                      {label}
                    </span>
                  </span>
                )
              })}
            </div>
          ) : rotateLabels ? (
            /* Narrow columns: each label rotates 45°, its END anchored at the
               column centre (the matplotlib `ha='right'` treatment), so many
               long fund names stay legible side by side. Ellipsized past
               `X_LABEL_MAX_PX`; the full label survives on `title`. */
            <div className="relative flex-1" style={{ height: ROTATED_BAND_PX }}>
              {bars.map((bar, i) => {
                const label = contributionLabel(bar, lang, labelOverrides)
                return (
                  <span
                    key={bar.rowKey ?? `residual-label-${i}`}
                    className="absolute top-0 w-0"
                    style={{ left: `${colW * i + colW / 2}%` }}
                  >
                    <span
                      className="absolute right-0 block ui-meta text-muted-fg leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{
                        top: 2,
                        maxWidth: X_LABEL_MAX_PX,
                        transform: 'rotate(-45deg)',
                        transformOrigin: '100% 0',
                      }}
                      title={label}
                    >
                      {label}
                    </span>
                  </span>
                )
              })}
            </div>
          ) : (
            <div className="flex-1 flex items-start">
              {bars.map((bar, i) => {
                const label = contributionLabel(bar, lang, labelOverrides)
                return (
                  <span
                    key={bar.rowKey ?? `residual-label-${i}`}
                    className="min-w-0 px-1 text-center ui-meta text-muted-fg leading-tight"
                    style={{ width: `${colW}%` }}
                    title={label}
                  >
                    <span className="line-clamp-2 break-words">{label}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {/* Screen-reader route: the same figures as a table, never bar geometry.
            THE WRAPPER IS LOAD-BEARING, not decoration. `sr-only` is
            `position:absolute; width:1px; overflow:hidden; clip:rect(0,0,0,0)`
            — and a TABLE refuses to lay out narrower than its own min-content
            width, so `sr-only` applied to the <table> left a ~600px absolutely
            positioned box in the layout. Its containing block is the nearest
            POSITIONED ancestor, which is outside this chart's
            `overflow-x-auto` scroller, so the scroller's clip did not apply to
            it and it widened the whole page: measured 271px of horizontal
            scroll at 390 and 14px at 1280, invisible (the `clip` still hid the
            paint) and therefore easy to ship. A block-level wrapper DOES honour
            `width:1px`, and its `overflow:hidden` contains the table. */}
        <div className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">{c.componentLabel}</th>
              <th scope="col">{c.contributionLabel}</th>
              <th scope="col">{c.shareOfChange}</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar, i) => (
              <tr key={bar.rowKey ?? `residual-row-${i}`}>
                <td>{contributionLabel(bar, lang, labelOverrides)}</td>
                <td>
                  <MaskedAmount value={bar.value} masked={masked} signed />
                </td>
                <td>{bar.shareOfNet !== null ? formatRatioPct(bar.shareOfNet) : c.shareUnavailable}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
