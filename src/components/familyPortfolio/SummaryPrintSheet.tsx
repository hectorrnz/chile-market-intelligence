'use client'

// R13.R2C §§ 21-26 · R13.R2F §§ 22-23 — the A4 portfolio one-pager.
//
// A DELIBERATE PRINT REPRESENTATION, NOT THE SCREEN WITH ITS CHROME HIDDEN.
// The Summary's own composition carries navigation, a scope rail, a privacy
// toggle, settings gears, a note editor, chart range/series rails and a
// crosshair — none of which mean anything on paper. Printing the page and
// hiding those would still leave their spacing behind. So the page renders THIS
// instead: one block, sized for A4 portrait, holding only what an investment
// summary should carry.
//
// WHY A PRINT-ONLY COMPONENT AND NOT A PRINT ROUTE (§ 25). A second route would
// be a second surface to authorize, and the whole class of defect it invites is
// the one § 26 forbids — a print path that renders data the Summary itself
// would refuse. This component receives EXACTLY the payload the Summary already
// fetched for THIS caller and THIS scope; there is no second fetch, no second
// entitlement decision, and nothing here can widen either.
//
// PRIVACY IS NOT RELAXED FOR PAPER (§ 26). Every amount renders through
// `MaskedAmount` with the SAME `masked` flag the screen is using. Printing while
// privacy mode is on prints masked figures — the alternative would be a control
// that silently unmasks a portfolio the reader had deliberately hidden.
//
// EVERY FIGURE IS LIVE SEMANTIC TEXT OR VECTOR. No screenshot, no raster: the
// evolution line is a plain SVG polyline through the real observations, drawn
// at a FIXED viewBox so the printed result is deterministic — unlike the
// interactive chart, whose geometry depends on the width it happened to be
// measured at on screen.
//
// ── R13.R2F §§ 22-23 · THE COMPOSITION ──────────────────────────────────────
// Read order, top to bottom, is the order an institutional tearsheet is read:
// masthead (who, when, how much) → performance → weekly close + allocation →
// commentary → the long-run line → provenance. Each tier is separated by a
// rule and set at its own weight, so the eye lands on the focal figure first
// and the disclosures last.
//
// TWO COLUMNS, NOT FOUR, IN THE PERFORMANCE BAND. Every row there is a
// label/value pair, and Main's labels carry their basis in full ("Portfolio
// incl. Chilean equities · P&L"). Four columns gave each pair ~40mm and every
// label wrapped to three lines; two columns give it ~89mm and it sits on one.
// Nothing was dropped in the change — the same fourteen figures print.
//
// THE PERSONAL SHEET IS COMPOSED FOR ITSELF, NOT TRUNCATED FROM MAIN (§ 24).
// It carries no Weekly Notes region at all (not an empty heading, not a
// reserved gap), its single supporting group spans the full measure instead of
// leaving a quarter of the band empty, and the evolution chart — the one
// elastic element on the sheet — takes the slack the notes and the second
// basis would have occupied. So both sheets fill one page without either being
// shrunk to fit.

import { MaskedAmount } from './MaskedAmount'
import { AllocationDonut, type DonutEntry } from './AllocationDonut'
import type { AllocationPresentationSettings } from '@/lib/familyPortfolio/allocationSettings'

/**
 * R13.R2 PASS 4 § 3 — `tone` is the NUMBER whose sign colours the printed
 * figure: positive prints green, negative prints red, in the approved palette's
 * own two tokens.
 *
 * It is supplied per metric rather than inferred, because not every signed
 * figure is a gain or a loss. A NET FLOW carries a sign and is neither — a
 * contribution printed in green would read as a profit — so flows pass no
 * `tone` and print in the body colour, as do levels. Meaning is never colour
 * alone: every toned figure also carries its own +/− sign and its label, which
 * is what keeps the sheet readable on a black-and-white printer.
 */
export interface PrintMetric {
  key: string
  label: string
  /**
   * A PORTFOLIO AMOUNT, passed as a number so it renders through
   * `MaskedAmount`. Never pre-formatted by the page: formatting it to text is
   * exactly how an amount escapes the page mask onto paper.
   */
  amount?: number | null
  /** A pre-formatted ratio or listed price; used when `amount` is absent. */
  text?: string
  tone?: number | null
}

/** Historical alias — the two metric shapes converged in pass 4. */
export type PrintAmountMetric = PrintMetric

export interface PrintGroup {
  title: string
  metrics: PrintMetric[]
}

/** One metric cell — a masked amount, or the page's own pre-formatted text. */
function MetricValue({ metric, masked }: { metric: PrintMetric; masked: boolean }) {
  return (
    <dd className={`ui-number ${toneClass(metric.tone, masked)}`}>
      {metric.text !== undefined ? (
        metric.text
      ) : (
        <MaskedAmount value={metric.amount ?? null} masked={masked} signed />
      )}
    </dd>
  )
}

/** One labelled column of figures — a group head (when it has one) and its rows. */
function MetricColumn({
  title,
  metrics,
  masked,
}: {
  title: string | null
  metrics: PrintMetric[]
  masked: boolean
}) {
  return (
    <div>
      {/* A personal group has no title — naming it would require a basis word
          a personal portfolio does not have (§ 28). It gets no placeholder
          heading either: it is the only block on its row, so there is nothing
          to align to and an empty uppercase line would read as a dropped
          label. */}
      {title ? <p className="nv-print-h3">{title}</p> : null}
      <dl className="nv-print-dl">
        {metrics.map((m) => (
          <div key={m.key}>
            <dt>{m.label}</dt>
            <MetricValue metric={m} masked={masked} />
          </div>
        ))}
      </dl>
    </div>
  )
}

export interface PrintSnapshotRow {
  key: string
  label: string
  dateLabel: string | null
  value: number | null
  isDifference?: boolean
}

/**
 * The printed sign colour. Masked figures are NEVER toned: the mask exists to
 * withhold the amount, and a green or red block would leak its direction.
 */
function toneClass(value: number | null | undefined, masked: boolean): string {
  if (masked || value === null || value === undefined || !Number.isFinite(value)) return ''
  if (value > 0) return 'nv-print-pos'
  if (value < 0) return 'nv-print-neg'
  return ''
}

export interface PrintEvolutionPoint {
  date: string
  value: number
}

export interface SummaryPrintSheetProps {
  /** Page identity — the portfolio being reported, never a scope id. */
  scopeHeading: string
  documentTitle: string
  asOfLabel: string
  asOfDate: string
  revisionLabel: string

  /** The one focal figure. */
  valueLabel: string
  /** Null for a personal scope, which has no Chilean-equities split. */
  valueBasis: string | null
  totalValue: number | null

  /** § 2 — the section title states the horizon of everything under it. */
  performanceTitle: string
  portfolioGroupLabel: string
  marketsGroupLabel: string
  portfolioMetrics: PrintMetric[]
  marketMetrics: PrintMetric[]

  /** Main: two basis groups. Personal: one group. */
  detailGroups: PrintGroup[]

  snapshotTitle: string
  snapshotBasis: string | null
  snapshotRows: PrintSnapshotRow[]
  snapshotNote: string | null

  allocationTitle: string
  allocationBasisLabel: string | null
  allocationEntries: DonutEntry[]
  allocationSettings: AllocationPresentationSettings
  allocationDenominator: string | null

  /** MAIN ONLY (§ 24). A personal scope passes an empty array and no region renders. */
  notesTitle: string
  notes: Array<{ id: string; body: string }>

  evolutionTitle: string
  /**
   * R13.R2 PASS 4 § 2 — the flow-adjustment disclosure. The printed line is the
   * same flow-adjusted path the screen draws, so paper has to say so too: a
   * reader handed a sheet has no tooltip to consult.
   */
  evolutionNote: string | null
  evolutionPoints: PrintEvolutionPoint[]
  evolutionChangeLabel: string
  evolutionChangeText: string | null
  evolutionChangeAmount: number | null
  hwmLabel: string
  hwmValue: number | null
  hwmDateLabel: string | null

  sourceLine: string
  disclaimer: string

  masked: boolean
  formatDate: (iso: string) => string
}

/**
 * The width reserved to the left of the plot for the y-axis value labels. The
 * x-axis rule and its dates are indented by the same amount, so the baseline
 * spans exactly the plot and nothing under it drifts out of register.
 *
 * R13.R2F3 § 23 — MEASURED, NOT ESTIMATED, and R13.R2F4 § 2 shortens what has
 * to be measured. The labels used to print the full grouped amount
 * (`145.470.441`, 11 characters ≈ 16.1mm with padding), which is why 20mm was
 * reserved out of a 186mm measure. They now print at axis length
 * (`145,5M`, 6 characters ≈ 8.7mm) through `MaskedAmount compact`, so 12mm
 * clears the widest real label with ~2mm to spare AND still clears a portfolio
 * ten times larger (`1.145,5M`, 8 characters ≈ 11.6mm — the compact form grows
 * by ONE character per order of magnitude, not four). That returns a further
 * 8mm of width to the plot.
 */
const Y_AXIS_GUTTER = '12mm'

/**
 * Fixed print geometry — deterministic output, independent of screen width.
 *
 * R13.R2F5.1 — THE X AXIS AND ITS LABELS NOW SHARE ONE COORDINATE SYSTEM.
 *
 * Every earlier attempt (R13.R2F1 → R13.R2F5) drew the baseline inside the svg
 * and set the dates in an HTML row BELOW it, then tried to make the two meet by
 * controlling the svg's height. That is the defect the owner has now rejected
 * three times, and the reason is structural: the two live in different layout
 * systems, so nothing MECHANICALLY ties them together — every fix was an
 * argument about how one box would be sized, and the box kept being sized some
 * other way.
 *
 * The last attempt failed for a specific, checkable reason. It pinned the svg
 * with `position: absolute; left/right/top/bottom`, expecting the offsets to
 * size it. But an `<svg>` is a REPLACED element, and for an absolutely
 * positioned replaced element with `width: auto` / `height: auto`, CSS 2.1
 * §§ 10.3.8 / 10.6.5 take the used width and height from the element's
 * INTRINSIC size and then ignore the over-constrained `right` / `bottom`. The
 * same change had also just removed `width: 100%` from the stylesheet, so
 * nothing was left specifying a size at all: the svg fell back to its viewBox
 * aspect ratio (720 : 150 = 4.8 : 1), rendered short, and sat at `top: 0` —
 * baseline high, the rest of the wrapper blank, the dates below all of it.
 * Precisely the owner's screenshot.
 *
 * So the architecture changes rather than the arithmetic:
 *
 *   · The baseline, the x ticks AND the date labels are all drawn INSIDE the
 *     viewBox. Their relationship is arithmetic, not layout — no CSS box can
 *     put them apart, at any page size, in any print engine.
 *   · The viewBox is no longer stretched (`preserveAspectRatio` is now the
 *     uniform default, not `none`), so glyphs inside it set at a predictable
 *     size and the svg has a real intrinsic aspect ratio.
 *   · That aspect ratio is now the SIZING MECHANISM instead of an accident:
 *     the svg is in normal flow at `width: 100%; height: auto`, and its wrapper
 *     has no flex basis, no min/max height and no padding of its own beyond the
 *     y-axis gutter. The wrapper's height IS the svg's height, exactly, so the
 *     y-axis value labels — which stay HTML, because they are monetary and must
 *     keep the one guarded `MaskedAmount` render path — are locked to their
 *     ticks by construction.
 *
 * The cost is the elastic 42-88mm plot band, which is deliberately gone: it was
 * the "unrelated flex expansion" the geometry kept depending on. `PH` is chosen
 * so the printed chart INCLUDING its date labels occupies ≈48mm, which is what
 * the old 42mm floor plus its ~5mm date row already occupied on the fullest
 * sheet — so no sheet gains height and none can spill onto a second page.
 */
const PW = 720
const PH = 200
const PL = 10
const PR = 10
/** Length of a y-axis tick, in viewBox units, drawn outward towards its label. */
const TICK_LEN = 6
const PT = 8
/** Descent of an x tick below the baseline. */
const X_TICK = 5
/** Gap between the end of an x tick and the top of its date label. */
const X_LABEL_GAP = 3
/** Date label type size, in viewBox units (≈2.9mm ≈ 8.2pt at the printed scale). */
const X_LABEL_SIZE = 12
/**
 * The band reserved below the baseline for the x axis. Because it is part of
 * the same viewBox, the distance between the baseline and the labels is a
 * CONSTANT of this file (X_TICK + X_LABEL_GAP ≈ 1.9mm printed) rather than
 * whatever two CSS boxes happen to negotiate.
 */
const PB = X_TICK + X_LABEL_GAP + X_LABEL_SIZE + 2

/**
 * The printed evolution line.
 *
 * ONE COORDINATE SYSTEM FOR THE X AXIS (R13.R2F5.1 — see the geometry block
 * above for why). The baseline, the ticks and the date labels are all viewBox
 * geometry, so the distance between the rule and the labels is a constant of
 * this file. The svg is uniformly scaled and sized by its own aspect ratio in
 * normal flow, so its box and its wrapper's box are the same box — which is
 * what keeps the HTML y-axis labels (kept in HTML because they are monetary and
 * must go through `MaskedAmount`) locked to the ticks they name.
 *
 * Every date is a REAL observation read off `points`; no interpolated tick, and
 * neither edge label is clipped.
 */
function PrintEvolutionChart({
  points,
  hwmValue,
  masked,
  formatDate,
}: {
  points: PrintEvolutionPoint[]
  hwmValue: number | null
  masked: boolean
  formatDate: (iso: string) => string
}) {
  if (points.length < 2) return null
  const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
  const t0 = t(points[0].date)
  const t1 = t(points[points.length - 1].date)
  const span = Math.max(t1 - t0, 1)
  const values = points.map((p) => p.value).filter(Number.isFinite)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || Math.abs(max) || 1
  const yMin = min - range * 0.07
  const yMax = max + range * 0.07
  const w = PW - PL - PR
  const h = PH - PT - PB
  const x = (iso: string) => PL + ((t(iso) - t0) / span) * w
  const y = (v: number) => PT + h - ((v - yMin) / (yMax - yMin)) * h
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  // The reference is drawn only where it genuinely falls inside the plotted
  // range — a line ruled outside the plot would assert a level the chart does
  // not show. Its value and date are stated in the head either way.
  const hwmY =
    hwmValue !== null && Number.isFinite(hwmValue) && hwmValue >= yMin && hwmValue <= yMax
      ? y(hwmValue)
      : null

  /**
   * Y-AXIS CONTEXT. The series' own high, midpoint and low — real figures off
   * the plotted path, never an invented round number. A flat series
   * (`max === min`) yields exactly one, not three identical ones.
   *
   * R13.R2F3 §§ 17-19 — THESE ARE TICK MARKS ON AN AXIS, NOT GRIDLINES. They
   * used to be ruled the full width of the plot, which on a sheet whose chart
   * carries a single line printed as three unexplained horizontal rules
   * dominating the chart region (owner review, from real print-preview
   * evidence). An axis reads as `labels │ plot ┼──── dates`; full-width rules
   * read as chart chrome. So the frame is now a vertical y-axis rule at the
   * plot's left edge with a short tick at each labelled value, and the value
   * labels sit beside those ticks in the gutter.
   */
  const tickValues = max > min ? [max, (max + min) / 2, min] : [max]
  const yTicks = tickValues.map((v) => ({ value: v, pct: (y(v) / PH) * 100 }))

  /**
   * X-AXIS TICKS AT THEIR TRUE POSITIONS, in viewBox units (R13.R2F5.1 — they
   * were HTML positioned by percentage before; they are geometry now, so a
   * label, its tick and its data point are one vertical line by construction).
   * The endpoints anchor inward — the first label starts on the axis, the last
   * ends on the plot's right edge — so neither can hang off the measure.
   *
   * Every date is read off `points`: the first, the last, and the series' own
   * MEDIAN observation on a series long enough to carry one. Never a calendar
   * midpoint, so no label can name a Friday the book did not publish.
   */
  const dateIndices =
    points.length >= 5 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0, points.length - 1]
  const dateTicks = dateIndices.map((i, n) => ({
    date: points[i].date,
    x: x(points[i].date),
    anchor: n === 0 ? ('start' as const) : n === dateIndices.length - 1 ? ('end' as const) : ('middle' as const),
  }))
  /** The one number that separates the baseline from its labels. */
  const baselineY = PT + h
  const xLabelY = baselineY + X_TICK + X_LABEL_GAP

  /**
   * R13.R2F3 § 22 — THE HIGH WATER MARK IS THE TOP TICK. Not by coincidence:
   * the marker is the running peak of the very series being plotted, and the
   * top tick is that series' maximum, so `hwmValue === max` is an identity —
   * verified against the live book on all five scopes (Main Incl./Excl.,
   * Jaime, Andrés, Pablo), gap 0.00mm every time. Drawing both put a 1.1pt
   * dashed rule exactly on top of a 0.5pt solid one, and the print stylesheet
   * then forces BOTH to the same slate grey, so they printed as a single
   * thickened broken line with nothing to say what it was.
   *
   * So: when the reference falls on a tick, the tick IS the reference and no
   * second line is drawn — the head block already names the High Water Market
   * with its value and its date, and the top axis label prints that same
   * value. A separate rule is only drawn in the defensive case where the
   * reference genuinely sits away from every tick, and there it gets its own
   * tick and label, so a dashed rule is never unexplained.
   */
  const TICK_EPSILON = 0.5
  const hwmOnTick = hwmY !== null && yTicks.some((t) => Math.abs(y(t.value) - hwmY) < TICK_EPSILON)
  const hwmStandalone = hwmY !== null && !hwmOnTick

  return (
    <>
      {/* THE PLOT WRAPPER. Its only jobs are to reserve the y-axis gutter and to
          be the positioning context for the HTML value labels.

          R13.R2F5.1 — IT NO LONGER HAS A HEIGHT OF ITS OWN. The flex basis and
          the 42-88mm min/max are gone: they were the "unrelated flex expansion"
          the baseline kept depending on, and every attempt to make the svg
          track them failed in a different way. The svg is now an ordinary
          in-flow block sized by its own aspect ratio, so this wrapper's height
          IS the svg's height — there is nothing left to negotiate, and the
          value labels' `top: N%` therefore resolves against exactly the box
          their ticks are drawn in. */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          // A RESERVED Y-AXIS GUTTER. The value labels are absolutely
          // positioned against this wrapper's PADDING box, so `left: 0` puts
          // them in the gutter while the plot begins after it — without the
          // reserve they sat on top of the opening months of the line.
          paddingLeft: Y_AXIS_GUTTER,
          // The gap below the chart belongs to the WRAPPER, never to the svg.
          // Measured: a `margin-bottom` on the svg made this box 1.5mm taller
          // than the plot it contains, which put the HTML value labels 0.14mm
          // off their own ticks — the same class of drift, at a smaller size.
          // A margin here is outside the border box, so the two stay identical.
          marginBottom: '1.5mm',
        }}
      >
        {/* The class scopes the print stroke-colour rule to THIS chart. Without it
            a blanket `svg path` rule would also repaint the allocation donut's
            slice separators, which draw with their own `stroke="var(--surface)"`.

            R13.R2F5.1 — IN NORMAL FLOW, UNIFORMLY SCALED, SIZED BY ITS OWN
            ASPECT RATIO. `width: 100%; height: auto` (globals.css) plus a
            viewBox is the ordinary responsive-svg sizing rule: the height
            follows from 720 : 200. That is deliberate now — it was the
            ACCIDENT behind the owner's screenshot, when an absolutely
            positioned replaced element with `width: auto` fell back to its
            intrinsic ratio and ignored the `right`/`bottom` offsets meant to
            size it. Nothing here reads a percentage height, a flex basis, or a
            containing block, so there is no longer a sizing question to get
            wrong.

            Dropping `preserveAspectRatio="none"` is what makes SVG TEXT usable
            inside the box, which is what lets the date labels join the baseline
            in one coordinate system. */}
        <svg
          className="nv-print-evo"
          viewBox={`0 0 ${PW} ${PH}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {/* THE AXIS FRAME — the two rules that make this read as a chart.
              R13.R2F4 § 2: the x-axis baseline now lives HERE, inside the same
              coordinate system as the y-axis and the line, instead of being a
              CSS `border-top` on the date row below the svg. That is the whole
              of the "misplaced axes" defect: a border on a sibling element
              cannot know where the plot's bottom edge is, so the vertical rule
              stopped several millimetres short of the horizontal one and the
              origin corner never closed.

              Two `<line>`s rather than one `<path>` deliberately: the print
              stylesheet paints `.nv-print-evo path` in the series ink and
              `.nv-print-evo line` in the axis grey, so a frame drawn as a path
              would print BLUE. They share the origin exactly and both strokes
              straddle it, so the corner closes with no notch. */}
          <line
            x1={PL}
            y1={PT}
            x2={PL}
            y2={PT + h}
            stroke="#5b6770"
            strokeWidth="0.6"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={PL}
            y1={PT + h}
            x2={PL + w}
            y2={PT + h}
            stroke="#5b6770"
            strokeWidth="0.6"
            vectorEffect="non-scaling-stroke"
          />
          {/* One short tick per labelled value, drawn OUTWARD from the axis
              towards its label — the conventional printed-chart direction, and
              it keeps the plot area itself clear of chrome. With the box now
              uniformly scaled (R13.R2F5.1) a tick specified in viewBox units
              prints at the same length in both axes, so the x ticks below are
              plain geometry too rather than the millimetre HTML they had to be
              while the box was stretched. */}
          {yTicks.map((tick) => (
            <line
              key={`tick-${tick.value}`}
              x1={PL - TICK_LEN}
              y1={y(tick.value)}
              x2={PL}
              y2={y(tick.value)}
              stroke="#5b6770"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* THE X AXIS: a tick and a date at each labelled observation, both
              in the same coordinate system as the baseline they hang from. The
              gap between the rule and the type is `X_TICK + X_LABEL_GAP` — a
              constant of this file, not an outcome of CSS layout. */}
          {dateTicks.map((dt) => (
            <line
              key={`xtick-${dt.date}`}
              x1={dt.x}
              y1={baselineY}
              x2={dt.x}
              y2={baselineY + X_TICK}
              stroke="#5b6770"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {dateTicks.map((dt) => (
            <text
              key={`xlabel-${dt.date}`}
              x={dt.x}
              y={xLabelY}
              textAnchor={dt.anchor}
              dominantBaseline="hanging"
              fontSize={X_LABEL_SIZE}
              fill="#555555"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatDate(dt.date)}
            </text>
          ))}
          {/* The reference rule, ONLY when it does not already coincide with a
              tick (see the note above — with the current book it always does,
              so this branch is the defensive one). Dashed, and it carries its
              own tick and its own gutter label below, so it is never an
              unexplained horizontal line. */}
          {hwmY !== null && hwmStandalone && (
            <line
              x1={PL}
              y1={hwmY}
              x2={PL + w}
              y2={hwmY}
              stroke="var(--fp-hwm)"
              strokeWidth="1"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={d}
            fill="none"
            stroke="var(--fp-series-incl)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* The value labels themselves — masked exactly like every other
            amount on the sheet (`MaskedAmount`): an axis is not a loophole
            around the page mask. A LEVEL, not a result, so it is never toned
            green or red the way the change figure in the head is.

            R13.R2F4 § 2 — `compact` renders them at axis length (`145,5M`),
            and EVERY label is now centred on its own tick. They previously
            anchored inward at the extremes (top label's top edge on the tick,
            bottom label's bottom edge on it) to avoid being clipped by the
            rows above and below — which read as misalignment, because a label
            and the tick it names did not share a centre line. Raising `PT` to
            8 buys the headroom that made the inward anchoring necessary: the
            highest tick now sits ~11% down the box, comfortably more than half
            a line of type from the top edge. */}
        {yTicks.map((tick) => (
          <span
            key={`tick-${tick.value}`}
            aria-hidden="true"
            className="nv-print-meta ui-number"
            style={{
              position: 'absolute',
              left: 0,
              // Right-aligned inside the reserved gutter, so the figures sit
              // tight against the plot edge and read as one column.
              width: Y_AXIS_GUTTER,
              paddingRight: '0.8mm',
              textAlign: 'right',
              top: `${tick.pct}%`,
              transform: 'translateY(-50%)',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {/* R13.R5C.2 — a y-axis TICK: a scale annotation, not a value, so
                it opts out of the zero mark like the contributors axis. In
                practice this axis plots a portfolio value and never reaches
                zero; the opt-out states the rule rather than relying on that. */}
            <MaskedAmount value={tick.value} masked={masked} compact zeroDash={false} />
          </span>
        ))}
        {/* The defensive standalone-reference case gets its own label, so the
            dashed rule above is always identified. */}
        {hwmY !== null && hwmStandalone && (
          <span
            aria-hidden="true"
            className="nv-print-meta ui-number"
            style={{
              position: 'absolute',
              left: 0,
              width: Y_AXIS_GUTTER,
              paddingRight: '0.8mm',
              textAlign: 'right',
              top: `${(hwmY / PH) * 100}%`,
              transform: 'translateY(-50%)',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              fontStyle: 'italic',
            }}
          >
            <MaskedAmount value={hwmValue} masked={masked} compact />
          </span>
        )}
      </div>
      {/* R13.R2F5.1 — THE HTML DATE ROW IS GONE. It was the second half of the
          defect: a separate box, in a separate layout system, that could only
          ever be brought near the baseline by argument about how the chart box
          would be sized. Its ticks and its dates are now drawn inside the
          viewBox above, so nothing remains that can drift. */}
    </>
  )
}

export function SummaryPrintSheet(props: SummaryPrintSheetProps) {
  const {
    scopeHeading, documentTitle, asOfLabel, asOfDate, revisionLabel,
    valueLabel, valueBasis, totalValue,
    performanceTitle, portfolioGroupLabel, marketsGroupLabel, portfolioMetrics, marketMetrics,
    detailGroups,
    snapshotTitle, snapshotBasis, snapshotRows, snapshotNote,
    allocationTitle, allocationBasisLabel, allocationEntries, allocationSettings, allocationDenominator,
    notesTitle, notes,
    evolutionTitle, evolutionNote, evolutionPoints,
    evolutionChangeLabel, evolutionChangeText, evolutionChangeAmount,
    hwmLabel, hwmValue, hwmDateLabel,
    sourceLine, disclaimer, masked, formatDate,
  } = props

  return (
    <div className="nv-print-sheet print-only">
      {/* MASTHEAD — identity and the one focal figure share a single band, the
          way a tearsheet opens: who this is, as of when, and what it is worth.
          Stacking them cost ~12mm of a 273mm page for no gain in clarity. */}
      <header className="nv-print-masthead">
        <div className="nv-print-ident">
          <p className="nv-print-eyebrow">{documentTitle}</p>
          <h1 className="nv-print-title">{scopeHeading}</h1>
          <p className="nv-print-meta">
            {asOfLabel} {formatDate(asOfDate)} · {revisionLabel}
          </p>
        </div>
        <div className="nv-print-heroblock">
          {/* R13.R5C.1 § 2 — the same `US$` mark the on-screen hero carries.
              A printed sheet leaves the app entirely, so the headline figure
              stating its own unit matters more here, not less. */}
          <MaskedAmount value={totalValue} masked={masked} currency className="ui-number nv-print-hero-value" />
          <p className="nv-print-meta">
            {valueLabel}
            {valueBasis ? ` · ${valueBasis}` : ''}
          </p>
        </div>
      </header>

      {/* § 23/§ 24 — the horizon is stated ONCE, by the section title, so no
          metric under it repeats it. Portfolio and Markets take the first row;
          the per-basis supporting figures take the second. */}
      <section className="nv-print-block">
        <h2 className="nv-print-h2">{performanceTitle}</h2>
        <div className="nv-print-cols-perf">
          <MetricColumn title={portfolioGroupLabel} metrics={portfolioMetrics} masked={masked} />
          <MetricColumn title={marketsGroupLabel} metrics={marketMetrics} masked={masked} />
          {detailGroups.map((g, i) => (
            <MetricColumn
              key={g.title || `detail-${i}`}
              title={g.title ? g.title : null}
              metrics={g.metrics}
              masked={masked}
            />
          ))}
        </div>
      </section>

      {/* Snapshot + allocation, side by side on the sheet */}
      <section className="nv-print-block nv-print-cols-2">
        <div>
          <h2 className="nv-print-h2">
            {snapshotTitle}
            {snapshotBasis ? ` · ${snapshotBasis}` : ''}
          </h2>
          <dl className="nv-print-ledger">
            {snapshotRows.map((r) => (
              // The change row is the ledger's conclusion, so it is ruled off
              // and set heavier than the three balances it follows.
              <div key={r.key} className={r.isDifference === true ? 'nv-print-total' : ''}>
                <dt>
                  {r.label}
                  {r.dateLabel ? <span className="nv-print-meta"> {r.dateLabel}</span> : null}
                </dt>
                {/* Only the CHANGE row is toned — the three levels above it are
                    balances, not gains. */}
                <dd
                  className={`ui-number ${
                    r.isDifference === true ? toneClass(r.value, masked) : ''
                  }`}
                >
                  <MaskedAmount
                    value={r.value}
                    masked={masked}
                    signed={r.isDifference === true}
                  />
                </dd>
              </div>
            ))}
          </dl>
          {snapshotNote && <p className="nv-print-meta">{snapshotNote}</p>}
        </div>
        <div>
          <h2 className="nv-print-h2">
            {allocationTitle}
            {allocationBasisLabel ? ` · ${allocationBasisLabel}` : ''}
          </h2>
          {/* The wrapper is what the print stylesheet hangs the donut's paper
              treatment on: ink for a legend that reads theme tokens, a white
              ground for the slice separators and label haloes, and colour
              retention for the legend chips (browsers drop backgrounds from a
              print job by default, which would have left the key blank). */}
          <div className="nv-print-alloc">
            <AllocationDonut
              entries={allocationEntries}
              summary={allocationTitle}
              settings={allocationSettings}
              masked={masked}
              size={150}
            />
          </div>
          {allocationDenominator && <p className="nv-print-meta">{allocationDenominator}</p>}
        </div>
      </section>

      {/* MAIN ONLY — a personal sheet renders no notes region at all (§ 24),
          and never an editor or an Add/Edit/Delete control (§ 23). Two columns:
          at the full 186mm measure a line of commentary runs past 100
          characters, which is a paragraph nobody tracks to the end of. */}
      {notes.length > 0 && (
        <section className="nv-print-block nv-print-notes">
          <h2 className="nv-print-h2">{notesTitle}</h2>
          <div className="nv-print-notelist">
            {notes.map((n) => (
              <p key={n.id} className="nv-print-note">
                {n.body}
              </p>
            ))}
          </div>
        </section>
      )}

      {evolutionPoints.length > 1 && (
        <section className="nv-print-block nv-print-evo-block">
          <div className="nv-print-head">
            <h2 className="nv-print-h2">{evolutionTitle}</h2>
            <p className="nv-print-meta">
              {evolutionChangeLabel}{' '}
              <span className={toneClass(evolutionChangeAmount, masked)}>
                <MaskedAmount value={evolutionChangeAmount} masked={masked} signed className="ui-number" />
                {evolutionChangeText ? ` ${evolutionChangeText}` : ''}
              </span>
              {hwmValue !== null && (
                <>
                  {' · '}
                  {hwmLabel}{' '}
                  <MaskedAmount value={hwmValue} masked={masked} className="ui-number" />
                  {hwmDateLabel ? ` · ${hwmDateLabel}` : ''}
                </>
              )}
            </p>
          </div>
          <PrintEvolutionChart
            points={evolutionPoints}
            hwmValue={masked ? null : hwmValue}
            masked={masked}
            formatDate={formatDate}
          />
          {evolutionNote && <p className="nv-print-meta">{evolutionNote}</p>}
        </section>
      )}

      <footer className="nv-print-foot">
        <p className="nv-print-meta">{sourceLine}</p>
        <p className="nv-print-meta">{disclaimer}</p>
      </footer>
    </div>
  )
}
