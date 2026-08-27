'use client'

// R13.R2 §§ 16-22 — the Portfolio Evolution chart: weekly portfolio VALUE
// LEVELS (never returns — § 18) as an interactive inline-SVG line chart with
// brokerage-grade interaction translated into this app's own visual language.
//
// DATA HONESTY IS THE DESIGN. The line is a straight polyline through the
// real weekly observations and nothing else: no smoothing, no synthetic
// intermediate points, no gap-filling, no area fill, no gradient. The
// crosshair SNAPS to the nearest real observation — it never reports an
// interpolated x — and when the series is short enough for individual weeks
// to read (≤ 40 observations) each observation is marked with a small dot so
// the discreteness of the data stays visible.
//
// Compare mode receives two series with their OWN date sets, so x is scaled
// by calendar date (via `calendarTime`, timezone-immune), not by array index
// — index spacing would silently misalign two series whose histories start
// on different weeks. Each series keeps its own identity token
// (`--fp-series-incl` / `--fp-series-excl` — different hues, both themed);
// a falling line is a normal movement and NEVER takes the alert red.
//
// INTERACTION (LineChart is the measured-width precedent; this chart adds
// the keyboard/touch layer):
//  · Pointer move / touch drag — crosshair at the nearest observation, a
//    marker on each series that holds that date, and a tooltip with the
//    exact date, series name, and exact value. `onHoverDateChange` mirrors
//    the snapped date to the page (null on leave) so the headline can follow.
//  · Keyboard — the plot is focusable; ←/→ step between observations,
//    Home/End jump to the ends, Escape clears. A polite live region reads the
//    focused observation aloud, so the crosshair readout is not mouse-only.
//  · A visually-hidden data table (kept inside this `relative` container —
//    the app once shipped a bug where an absolutely-positioned sr-only
//    descendant escaped its container and created page-level scroll) carries
//    every date/value pair for non-visual access.
//
// Axes are minimal: a faint horizontal grid (levels are read against
// horizontal references, so it genuinely helps), compact y labels, no
// vertical grid, no boxed plot frame. Exact values live in the tooltip and
// the hidden table via the page's own `formatValue`.

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ChartTooltip } from '@/components/fable/chart/ChartTooltip'
import { calendarTime } from '@/lib/charts/dateAxis'

export interface EvolutionSeriesInput {
  key: 'incl' | 'excl'
  label: string
  /** A CSS custom property name, e.g. '--fp-series-incl'. Never a hex. */
  colorVar: string
  /** Real weekly observations, ascending. Never interpolate or resample these. */
  points: { date: string; value: number }[]
}

/**
 * The High Water Market reference (owner review §§ 15-20), already RESOLVED by
 * the page: this component draws what it is handed and decides nothing.
 *
 * It never derives the maximum itself — the semantic lives in
 * `highWaterMarket.ts`, so the line, the headline and the tests cannot disagree
 * about what "maximum observed value" means. Passing `null` (which the page
 * does whenever amounts are masked, and whenever the § 18 rules say the
 * reference is not shown) draws nothing at all.
 */
export interface HighWaterMarketMarker {
  /** The maximum OBSERVED value — always one of the plotted observations. */
  value: number
  /** That observation's own date. Never interpolated. */
  date: string
  /** The owner's visible term, from the dictionary. Never hardcoded here. */
  label: string
  /** The § 17 explanation: what the figure is, and what it is not. */
  tooltip: string
  /** Localised "set" connector for the date detail. */
  setAtLabel: string
}

export interface PortfolioEvolutionChartProps {
  series: EvolutionSeriesInput[]
  height?: number
  formatValue: (v: number) => string
  formatDate: (iso: string) => string
  /** Crosshair position, so the page headline can follow the hover. Null on leave. */
  onHoverDateChange?: (date: string | null) => void
  /** Accessible summary + the visually-hidden data-table caption. */
  labels: { summary: string; tableAlternative: string; valueLabel: string }
  /** Resolved by the page; null draws no reference line. */
  highWaterMarket?: HighWaterMarketMarker | null
}

const ML = 64
// Owner review pass 2 § 22 — the right margin also has to clear the latest
// observation's end marker; the date label itself is kept inside the bounds by
// anchoring the edge ticks inward (see the x-axis block below).
const MR = 22
const MT = 12
const MB = 26

/** Compact axis label (K/M) — the scale reference only; exact values go
 *  through the caller's `formatValue` in the tooltip and hidden table. */
function formatAxisValue(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(0)
}

export function PortfolioEvolutionChart({
  series,
  height = 280,
  formatValue,
  formatDate,
  onHoverDateChange,
  labels,
  highWaterMarket = null,
}: PortfolioEvolutionChartProps) {
  const uid = useId().replace(/:/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  /** Index into the union date axis — the snapped crosshair position. */
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  /** Keyboard readout for the polite live region (keyboard-set only). */
  const [announce, setAnnounce] = useState('')

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setW(el.clientWidth || 800)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const drawn = series
    .filter((s) => s.points.length > 0)
    .map((s) => ({ ...s, byDate: new Map(s.points.map((p) => [p.date, p.value])) }))

  // The union of every series' real observation dates, ascending — the snap
  // axis. In compare mode a date one series lacks still snaps (the tooltip
  // then lists only the series that hold it); nothing is ever interpolated.
  const unionDates = Array.from(new Set(drawn.flatMap((s) => s.points.map((p) => p.date)))).sort(
    (a, b) => calendarTime(a) - calendarTime(b),
  )

  if (unionDates.length === 0) return null

  const chartW = Math.max(w - ML - MR, 10)
  const chartH = height - MT - MB
  const baseline = MT + chartH

  const t0 = calendarTime(unionDates[0])
  const t1 = calendarTime(unionDates[unionDates.length - 1])
  const tSpan = Math.max(t1 - t0, 1)
  const toX = (date: string) => ML + ((calendarTime(date) - t0) / tSpan) * chartW

  const allValues = drawn.flatMap((s) => s.points.map((p) => p.value)).filter(Number.isFinite)
  const minV = Math.min(...allValues)
  const maxV = Math.max(...allValues)
  const range = maxV - minV || Math.abs(maxV) || 1
  const yMin = minV - range * 0.08
  const yMax = maxV + range * 0.08
  const toY = (v: number) => MT + chartH - ((v - yMin) / (yMax - yMin)) * chartH

  const paths = drawn.map((s) => ({
    ...s,
    d: s.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.date).toFixed(1)},${toY(p.value).toFixed(1)}`)
      .join(' '),
  }))

  // In single mode the series is THE portfolio value — name it as such; in
  // compare mode each basis keeps its own label.
  const nameOf = (s: (typeof drawn)[number]) => (drawn.length === 1 ? labels.valueLabel : s.label)

  const yTicks = 4
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (i * (yMax - yMin)) / yTicks)

  const xTickCount = Math.max(2, Math.min(unionDates.length, Math.floor(chartW / 110) || 2))
  const xTickIndices =
    unionDates.length === 1
      ? [0]
      : Array.from(new Set(Array.from({ length: xTickCount }, (_, i) =>
          Math.round((i / (xTickCount - 1)) * (unionDates.length - 1)),
        )))

  // Individual observations stay visible while they are few enough to read.
  const showDots = unionDates.length <= 40

  const readoutFor = (i: number): string => {
    const date = unionDates[i]
    const parts = drawn
      .filter((s) => s.byDate.has(date))
      .map((s) => `${nameOf(s)}: ${formatValue(s.byDate.get(date)!)}`)
    return `${formatDate(date)} — ${parts.join('; ')}`
  }

  function setActive(i: number | null, fromKeyboard = false) {
    setActiveIdx(i)
    onHoverDateChange?.(i === null ? null : unionDates[i])
    if (fromKeyboard) setAnnounce(i === null ? '' : readoutFor(i))
  }

  function idxFromClientX(clientX: number): number {
    const rect = wrapRef.current?.getBoundingClientRect()
    const x = rect ? clientX - rect.left : 0
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < unionDates.length; i++) {
      const d = Math.abs(toX(unionDates[i]) - x)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const last = unionDates.length - 1
    // Clamp a held index into the current axis (see the bounds guard below).
    const cur = activeIdx === null ? null : Math.min(activeIdx, last)
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setActive(cur === null ? 0 : Math.min(cur + 1, last), true)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setActive(cur === null ? last : Math.max(cur - 1, 0), true)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0, true)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(last, true)
    } else if (e.key === 'Escape' && activeIdx !== null) {
      // Only consume Escape while a crosshair exists — otherwise it belongs
      // to whatever overlay might be open above.
      e.preventDefault()
      e.stopPropagation()
      setActive(null, true)
    }
  }

  // Bounds guard: a period/series switch can shrink the date axis while a
  // crosshair index from the previous axis is still held — render nothing
  // rather than index past the end.
  // The reference's y position. Guarded on a finite value so a malformed
  // marker draws nothing rather than a line at NaN.
  const hwmY =
    highWaterMarket !== null && Number.isFinite(highWaterMarket.value)
      ? toY(highWaterMarket.value)
      : null

  const activeDate = activeIdx !== null && activeIdx < unionDates.length ? unionDates[activeIdx] : null
  const activeX = activeDate !== null ? toX(activeDate) : 0
  const tipLeft = Math.max(70, Math.min(w - 70, activeX))
  const descId = `${uid}-evo-desc`

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={labels.summary}
      aria-describedby={descId}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
    >
      <svg
        viewBox={`0 0 ${w} ${height}`}
        width="100%"
        height={height}
        aria-hidden="true"
        // pan-y keeps vertical page scrolling alive on touch; a horizontal
        // drag scrubs the crosshair.
        style={{ display: 'block', touchAction: 'pan-y' }}
        onPointerMove={(e) => setActive(idxFromClientX(e.clientX))}
        onPointerDown={(e) => setActive(idxFromClientX(e.clientX))}
        onPointerLeave={() => setActive(null)}
      >
        {/* Faint horizontal references only — no vertical grid, no frame. */}
        {yTickVals.map((v, i) => {
          const y = toY(v)
          return (
            <g key={i}>
              <line x1={ML} y1={y} x2={ML + chartW} y2={y} stroke="var(--chart-grid)" strokeWidth="1" opacity="0.5" />
              <text
                x={ML - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="var(--fs-meta)"
                fill="var(--chart-axis)"
                fontFamily="var(--font-sans)"
              >
                {formatAxisValue(v)}
              </text>
            </g>
          )
        })}

        {/* X axis. OWNER REVIEW PASS 2 § 22 — the first and last dates used to
            be cut off: every label was centred on its tick, and the outermost
            ticks sit AT the plot edges, so half of each edge label fell outside
            the SVG's own width (worst at narrow viewports, where only two ticks
            are drawn and both are edge ticks).

            The fix is alignment, not data. The tick MARK stays at the
            observation's true x; only the TEXT anchors inward at the two ends,
            so the first label runs rightward from the left plot edge and the
            last runs leftward from the right one. Both are then fully inside
            the viewBox at every width, and the leftmost label also clears the
            y-axis label column instead of reaching under it. No date is
            invented, moved, re-spaced or dropped to make room. */}
        {xTickIndices.map((idx, i) => {
          const x = toX(unionDates[idx])
          const anchor = i === 0 ? 'start' : i === xTickIndices.length - 1 ? 'end' : 'middle'
          return (
            <g key={idx}>
              <line x1={x} y1={baseline} x2={x} y2={baseline + 4} stroke="var(--chart-grid)" strokeWidth="1" />
              <text
                x={x}
                y={baseline + 16}
                textAnchor={anchor}
                fontSize="var(--fs-meta)"
                fill="var(--chart-axis)"
                fontFamily="var(--font-sans)"
              >
                {formatDate(unionDates[idx])}
              </text>
            </g>
          )
        })}

        {/* High Water Market — a SUBORDINATE dashed reference at the maximum
            observed value (§ 19). Drawn BEFORE the series so a line that runs
            along the peak is never hidden underneath it, in a quiet neutral
            rather than any series colour, and never in the alert red: a
            portfolio below its own high is a normal state, not an error.

            NO TEXT IS DRAWN IN THE PLOT (owner review pass 2 §§ 18-19). The
            maximum by definition plots near the top of the range, which is
            precisely where `ChartTooltip` renders (`top: 2`), so ANY in-plot
            label there was covered the moment the reader hovered. The
            reference's name, amount and peak date now live in a reserved band
            ABOVE this container, which the tooltip structurally cannot reach.
            What remains here is the line itself plus both accessible routes to
            the explanation. */}
        {hwmY !== null && (
          <g>
            {/* Pointer hover on the reference itself. The same wording is
                repeated in the accessible description below and offered as a
                keyboard-reachable help control in the summary band, so no
                route to the explanation is mouse-only (§ 20). */}
            <title>{`${highWaterMarket!.label} — ${highWaterMarket!.setAtLabel} ${formatDate(highWaterMarket!.date)}. ${highWaterMarket!.tooltip}`}</title>
            <line
              x1={ML}
              y1={hwmY}
              x2={ML + chartW}
              y2={hwmY}
              stroke="var(--fp-hwm)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.7"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}

        {/* The real observations, connected — nothing else. */}
        {paths.map((s) => (
          <path
            key={s.key}
            d={s.d}
            fill="none"
            stroke={`var(${s.colorVar})`}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {showDots &&
          drawn.map((s) =>
            s.points.map((p) => (
              <circle
                key={`${s.key}-${p.date}`}
                cx={toX(p.date)}
                cy={toY(p.value)}
                r="2"
                fill={`var(${s.colorVar})`}
              />
            )),
          )}

        {/* The latest REAL observation of each series gets a slightly larger
            marker — the brokerage "where we are now" anchor. Presentation
            only: it marks an existing point, never adds one. */}
        {drawn.map((s) => {
          const last = s.points[s.points.length - 1]
          return (
            <circle
              key={`end-${s.key}`}
              cx={toX(last.date)}
              cy={toY(last.value)}
              r="3"
              fill={`var(${s.colorVar})`}
              stroke="var(--surface)"
              strokeWidth="1"
            />
          )
        })}

        {activeDate !== null && (
          <g>
            <line
              x1={activeX}
              y1={MT}
              x2={activeX}
              y2={baseline}
              stroke="var(--chart-crosshair)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.7"
            />
            {drawn
              .filter((s) => s.byDate.has(activeDate))
              .map((s) => (
                <circle
                  key={s.key}
                  cx={activeX}
                  cy={toY(s.byDate.get(activeDate)!)}
                  r="3.5"
                  fill={`var(${s.colorVar})`}
                  stroke="var(--chart-selected-point)"
                  strokeWidth="1.5"
                />
              ))}
          </g>
        )}
      </svg>

      {/* Compare legend — always visible, never hover-gated, and never carried
          by colour alone: each entry names its own basis beside its swatch.

          R13.R2F § 11 — IT SITS ON ITS OWN CHIP. The legend floats over the
          plot, so a rising line used to run straight under the text and take
          its legibility with it. One capsule in the app's own chip tokens
          (never a second card, never a shadow) restores an opaque backdrop for
          both entries at once, and `max-w` keeps it inside the plot at every
          width so it can never push the page sideways. */}
      {drawn.length > 1 && (
        <div
          className="pointer-events-none absolute top-1 right-2 max-w-[calc(100%-1.5rem)] flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs px-2.5 py-1 rounded-full"
          style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
        >
          {drawn.map((s) => (
            // `text-foreground`, not muted: this sits on a chip over the plot,
            // and muted ink on that composited backdrop lands under AA in dark
            // mode. Contrast is checked against what renders, not the token.
            <span key={s.key} className="flex items-center gap-1.5 text-foreground whitespace-nowrap">
              <span
                className="inline-block w-3.5 h-0.5 rounded-full shrink-0"
                style={{ backgroundColor: `var(${s.colorVar})` }}
                aria-hidden="true"
              />
              {s.label}
            </span>
          ))}
        </div>
      )}

      {activeDate !== null && (
        <ChartTooltip left={tipLeft}>
          <div className="text-xs text-muted-fg">{formatDate(activeDate)}</div>
          {drawn
            .filter((s) => s.byDate.has(activeDate))
            .map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-xs">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: `var(${s.colorVar})` }}
                  aria-hidden="true"
                />
                <span className="text-muted-fg">{nameOf(s)}</span>
                <span className="ui-number font-semibold text-foreground">
                  {formatValue(s.byDate.get(activeDate)!)}
                </span>
              </div>
            ))}
        </ChartTooltip>
      )}

      {/* Keyboard crosshair readout — polite, keyboard-set only, so pointer
          scrubbing never floods a screen reader. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      {/* The chart's data, without sight or pointer: every real observation. */}
      <div id={descId} className="sr-only">
        {/* The reference and its meaning, stated before the table — a
            screen-reader user must not have to infer either. */}
        {highWaterMarket !== null && (
          <p>
            {`${highWaterMarket.label}: ${formatValue(highWaterMarket.value)}, ${highWaterMarket.setAtLabel} ${formatDate(highWaterMarket.date)}. ${highWaterMarket.tooltip}`}
          </p>
        )}
        <table>
          <caption>{labels.tableAlternative}</caption>
          <thead>
            <tr>
              <th scope="col" />
              {drawn.map((s) => (
                <th key={s.key} scope="col">
                  {nameOf(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {unionDates.map((d) => (
              <tr key={d}>
                <th scope="row">{formatDate(d)}</th>
                {drawn.map((s) => (
                  <td key={s.key}>{s.byDate.has(d) ? formatValue(s.byDate.get(d)!) : '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
