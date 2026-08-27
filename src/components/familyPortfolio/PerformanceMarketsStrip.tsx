'use client'

// R13.R2 — the performance band at the top of the Family Portfolio Summary.
//
// OWNER REVIEW PASS 4 § 4 — RECOMPOSED AS A 2 × 2 BAND, so a week can be read
// at a glance and its supporting figures sit underneath rather than beside it:
//
//                    │ PORTFOLIO                    │ MARKETS
//   ─────────────────┼──────────────────────────────┼──────────────────────────
//   row 1  WEEKLY    │ weekly return / weekly P&L   │ weekly comparators
//   row 2  SUPPORTING│ year-to-date and net flows   │ market detail
//
// TWO THINGS THAT LOOK COSMETIC AND ARE NOT.
//
//   1. The MARKETS column is content-width and sits IMMEDIATELY beside the
//      portfolio column, with any leftover width trailing to its right (the
//      third, empty grid track). The previous 2 : 3 proportional split pushed
//      the comparators to the far edge of the card — furthest from the figures
//      they exist to be compared against, and worst on a personal scope, whose
//      portfolio column carries only two metrics. One shared grid keeps the
//      divider straight across BOTH rows, so the columns read as columns.
//
//      R13.R2F § 5 — WHAT CHANGED IS THE MEASURE, NOT THE GRID. Keeping the
//      comparators adjacent necessarily leaves width trailing at the right of a
//      wide card, and STRETCHING two figures across 1500px would put a label
//      and its number at opposite ends of the row — the defect this grid exists
//      to avoid, reintroduced in a different place. So each figure now claims a
//      readable column of its own and the gutters open up at 2xl: the row
//      occupies its width deliberately instead of huddling at the left edge,
//      and the trailing space reads as margin rather than as an unfinished row.
//
//   2. The band's TITLE states the horizon once (§ 2). Main's row 1 is entirely
//      weekly, so no metric under it repeats "(weekly)" — including the market
//      comparators, which are now plainly "Global Equity" and "Global Fixed
//      Income" (§§ 3-4).
//
// A metric whose `state` is not `'ok'` keeps its slot and renders an em dash at
// the same scale — the band must not reflow when one figure is withheld, so the
// reader's eye always finds the same metric in the same place. The optional
// `title` carries supplemental detail only (an observation date, a
// withheld-symbol reason, a benchmark's composition); nothing critical is
// hover-only.
//
// PRIVACY. Returns and PUBLIC market prices are never masked — masking hides the
// family's wealth, not a return ratio or a listed price (see `MaskedAmount`'s
// header for the policy). AMOUNTS are a different matter and arrived here in
// this pass: a weekly or year-to-date P&L and a net flow are portfolio money, so
// `kind: 'amount'` renders through `MaskedAmount` and obeys the page mask like
// every other amount on the page. This component formats no amount itself.
//
// ── R13.R2F3 · `frameless` — EMBEDDED IN THE SHARED PERSONAL ROW ────────────
//
// Main keeps this component exactly as it has always rendered: its own
// full-width GlassSurface card, portfolio and markets side by side under one
// title, sitting above the Snapshot | Allocation | Notes row. NOTHING about
// that path changed in this pass — `frameless` defaults to `false`, and every
// prior render decision (the 2×2 grid, the trailing spacer track, the
// `reserveTitleRow` baseline alignment between titled/untitled sibling
// columns) is untouched code, reachable only when `frameless` is absent.
//
// A personal scope has no second basis and no InRetail row — its content is a
// title, one weekly pair beside two market comparators, and one supporting
// row of YTD + Net Flows. Spanning that across the full page width (the
// standalone card's `lg:` two-column-plus-spacer grid) is what produced the
// mostly-empty band the owner flagged. `frameless` renders the SAME data
// through the SAME `GroupStack`/`MetricSlot` primitives, but as a plain
// `<section>` — no card chrome, no title hairline, the exact
// `px-5 sm:px-6 pt-4` / `flex-1` idiom `WeeklySnapshotCard` and
// `AllocationPanel` already use — so the page can seat it as the first column
// of the shared Performance | Snapshot | Allocation row (§ R13.R2F3 in
// `family-portfolio/page.tsx`) instead of as its own wide card.
//
// Portfolio and Markets stack VERTICALLY here rather than sitting in grid
// columns. A columnar layout is what `reserveTitleRow` exists to keep
// baseline-aligned, and that mechanism assumes real container width to
// negotiate — exactly what this narrower embedded column does not reliably
// have (Tailwind's `lg:`/`xl:` prefixes read the viewport, not this
// component's own grid track, so a side-by-side attempt here could not
// reliably tell whether it actually fits). A vertical stack has no such
// dependency: Markets sits immediately below Portfolio, one hairline and one
// `ui-meta` sub-heading apart — still visually grouped, still close to the
// weekly portfolio figures — and reads correctly at every width without a
// breakpoint guess. `reserveTitleRow` is therefore not invoked here at all;
// nothing about the mechanism itself is touched, so Main's use of it is
// exactly as it was.

import { useId, type ReactNode } from 'react'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { changeColor, formatRatioPct, formatUsd } from '@/lib/formatters'

export interface StripMetric {
  key: string
  /** A return RATIO (0.0123 = +1.23%), a price, or a portfolio AMOUNT. */
  value: number | null
  label: string
  kind: 'return' | 'price' | 'amount'
  state: 'ok' | 'unavailable' | 'unverified'
  /** Optional hover detail, e.g. an observation date or why it is unavailable. */
  title?: string
}

export interface StripGroup {
  key: string
  /** Optional sub-heading — a basis name on Main; omitted where there is one basis. */
  title?: string
  metrics: StripMetric[]
}

export interface PerformanceMarketsStripProps {
  /**
   * The band's own title, stating the HORIZON of the figures under it (§ 2).
   * Main's is "Weekly Performance"; a personal scope's is "Performance".
   */
  sectionTitle: string
  portfolioLabel: string
  marketsLabel: string
  /** Row 1 — the WEEKLY figures, the ones the owner compares at a glance. */
  portfolioPrimary: StripGroup[]
  marketsPrimary: StripGroup[]
  /** Row 2 — year-to-date, net flows, and any market detail. */
  portfolioSecondary?: StripGroup[]
  marketsSecondary?: StripGroup[]
  /** Applies to `kind: 'amount'` only, through `MaskedAmount`. */
  masked?: boolean
  /** Anything the page wants below the whole band, inside the same surface. */
  footer?: ReactNode
  /**
   * R13.R2F3 — renders as a plain, chrome-free `<section>` instead of its own
   * `GlassSurface` card, for use as one column of a shared row the CALLER
   * frames (a personal scope's compact Performance | Snapshot | Allocation
   * row). Default `false` — Main's standalone card is entirely unaffected.
   */
  frameless?: boolean
}

function MetricSlot({
  metric,
  lead,
  masked,
}: {
  metric: StripMetric
  lead: boolean
  masked: boolean
}) {
  const withheld = metric.state !== 'ok' || metric.value === null || !Number.isFinite(metric.value)
  // Row-1 (weekly) figures at the capsule scale; supporting figures a clear
  // step down — the lead row is the band's voice, row 2 its footnote. The
  // withheld dash holds the same scale so the band's baseline rhythm never
  // shifts around a missing figure.
  const scale = lead ? 'ui-capsule-value' : 'text-sm font-semibold'
  // R13.R2F § 5 — THE SLOT HAS A MEASURE, so the columns of a two-metric
  // personal row do not collapse into a huddle at the left edge of a 1500px
  // card. Each figure claims a readable column that widens with the viewport;
  // the withheld dash claims the same one, so nothing reflows when a figure is
  // missing. The widest step is held back to 2xl — that is the only breakpoint
  // at which the shell is wide enough (1560px, less the 208px rail) for six
  // lead figures at that measure to sit on one line; below it the slots stay
  // narrow enough that the flex row wraps gracefully instead of crowding.
  const measure = lead
    ? 'min-w-[6rem] sm:min-w-[6.5rem] xl:min-w-[7.25rem] 2xl:min-w-[8rem]'
    : 'min-w-[5.5rem] sm:min-w-[6rem] xl:min-w-[6.5rem] 2xl:min-w-[7rem]'
  return (
    <div className={`flex flex-col gap-0.5 ${measure} max-w-full`} title={metric.title}>
      {/* Micro-label caption — the app's KPI-capsule idiom. One rung BELOW the
          h4 basis titles (11px sentence-case semibold), so a basis name and the
          metric captions under it can no longer be mistaken for one another. */}
      <span className="ui-micro-label text-muted-fg leading-snug">{metric.label}</span>
      {withheld ? (
        <span className={`ui-number ${scale} text-muted-fg`}>—</span>
      ) : metric.kind === 'amount' ? (
        // Portfolio money — masked exactly like every other amount on the page.
        // R13.R5C.1 § 2.2 — every `amount` in this band is a CHANGE or a FLOW
        // (weekly P&L, YTD P&L, Net Flows); none is a level. A zero therefore
        // means "nothing moved", which is what the module's `-` mark says, and
        // it stays distinct from the `—` above for "not established". Net
        // Flows is the one that actually occurs: three of the five scopes
        // published no external capital movement this week.
        <MaskedAmount
          value={metric.value}
          masked={masked}
          signed
          zeroDash
          className={`ui-number ${scale} text-foreground`}
        />
      ) : metric.kind === 'price' ? (
        <span className={`ui-number ${scale} text-foreground`}>{formatUsd(metric.value!, 2)}</span>
      ) : (
        // A signed change FIGURE in text takes the positive/negative classes —
        // the standing app convention (this is not a falling chart line).
        <span className={`ui-number ${scale} ${changeColor(metric.value!)}`}>
          {formatRatioPct(metric.value)}
        </span>
      )}
    </div>
  )
}

/**
 * R13.R5B § 1 — THE PER-BASIS COLUMN TRACKS, shared by the weekly row and the
 * supporting row beneath it.
 *
 * Whole literal class strings, because Tailwind scans source text and a
 * template-built name would not survive the build (the same reason
 * `TILE_COLUMNS` on the Cash Flows view is written out).
 *
 * One column per basis, and STACKED below `lg`: a two-basis grid held at every
 * width would put two groups of figures side by side on a phone, which is the
 * crowding the flex row previously avoided by wrapping. Above `lg` the card is
 * already in its multi-column composition, and that is exactly where the
 * misalignment this fixes was visible.
 */
const BASIS_COLUMNS: Record<number, string> = {
  2: 'grid-cols-1 lg:grid-cols-2',
  3: 'grid-cols-1 lg:grid-cols-3',
}

/**
 * The column gutter for that grid — ONE value for BOTH rows, deliberately.
 *
 * With `1fr` tracks the second basis begins at `(width + gap) / 2`, so the two
 * rows align only if they share a gap as well as a track template. The lead
 * row's more generous gutter is the one kept, since it sets the band's rhythm.
 */
const BASIS_COLUMN_GAP = 'gap-x-10 2xl:gap-x-14'

function GroupStack({
  groups,
  lead,
  masked,
  reserveTitleRow = false,
  columns = 0,
}: {
  groups: StripGroup[]
  lead: boolean
  masked: boolean
  /**
   * R13.R5B § 1 — when set, the groups lay out on a shared column grid instead
   * of flowing. See `BASIS_COLUMNS`. `0` keeps the original flex-wrap flow, so
   * every column that is not the Main portfolio pair renders exactly as before.
   */
  columns?: number
  /**
   * R13.R2F1 § A — WEEKLY PERFORMANCE VERTICAL ALIGNMENT. When the sibling
   * column's groups carry a basis title (`<h4>`) and this column's groups do
   * not, the metric rows here would float one title-row + its gap ABOVE the
   * sibling's metrics — exactly the figures they exist to be compared
   * against. Reserving the title row's own height (an invisible spacer,
   * never a magic pixel offset) lands both columns' metric rows on the same
   * baseline. The caller computes this per-row from the groups it is
   * actually passing, so a column whose sibling is ALSO untitled (a personal
   * scope's row 1) never receives a spacer — that pair is already aligned,
   * and reserving one there would misalign it the other way.
   */
  reserveTitleRow?: boolean
}) {
  // The supporting row packs a touch tighter than the lead row — same grid,
  // one clear step down in rhythm, so the two rows read as one band with a
  // lead voice rather than four equal boxes. The gutters OPEN UP with the
  // viewport (R13.R2F § 5): the band is content-width by design, and on a wide
  // desktop a generous, deliberate rhythm is what turns leftover width into
  // composition rather than dead space.
  // R13.R5B § 1 — ALIGNED MODE vs THE ORIGINAL FLOW.
  //
  // The defect: row 1 carries TWO metrics per basis and row 2 carries THREE, at
  // different slot measures and different gutters. Both rows sit in the same
  // outer grid column with the same padding, so the FIRST group's left edge
  // always coincided — which is why "incl. Chilean equities" looked correct —
  // but a flowed second group begins after however wide its own row's first
  // group happens to be, so "excl. Chilean equities" started in a different
  // place in each row. No amount of tuning the measures fixes that while the
  // two rows are laid out independently: 2 slots are never 3 slots wide.
  //
  // So the basis groups get an explicit shared track template instead. Each
  // basis owns the same column in both rows, and the two rows therefore agree
  // by construction rather than by coincidence of content width.
  const aligned = columns > 1 && BASIS_COLUMNS[columns] !== undefined
  return (
    <div
      className={
        aligned
          ? `grid ${BASIS_COLUMNS[columns]} ${BASIS_COLUMN_GAP} ${lead ? 'gap-y-4' : 'gap-y-3'}`
          : `flex flex-wrap ${
              lead ? 'gap-x-10 2xl:gap-x-14 gap-y-4' : 'gap-x-8 2xl:gap-x-11 gap-y-3'
            }`
      }
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1.5 min-w-0">
          {group.title ? (
            <h4 className="ui-meta text-muted-fg font-semibold">{group.title}</h4>
          ) : reserveTitleRow ? (
            // Same font metrics as the real `<h4>` above, so the reserved
            // box is pixel-true to what it stands in for — invisible to the
            // eye and to assistive tech, present only for its height.
            <div aria-hidden="true" className="ui-meta font-semibold invisible">
              {' '}
            </div>
          ) : null}
          <div
            className={`flex flex-wrap ${
              lead ? 'gap-x-7 2xl:gap-x-9 gap-y-3' : 'gap-x-6 2xl:gap-x-8 gap-y-2.5'
            }`}
          >
            {group.metrics.map((m) => (
              <MetricSlot key={m.key} metric={m} lead={lead} masked={masked} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Shared horizontal gutter; the vertical padding differs by row — the weekly
// row breathes a little more than the supporting row beneath it. The gutter
// matches the analytical row's own `px-5` / `sm:px-6` rhythm exactly, so the
// two surfaces line up down the page instead of each finding its own edge.
const CELL = 'min-w-0 px-5 sm:px-6 2xl:px-7'
const CELL_LEAD = `${CELL} pt-4 pb-5`
const CELL_SUB = `${CELL} pt-3.5 pb-4`

export function PerformanceMarketsStrip({
  sectionTitle,
  portfolioLabel,
  marketsLabel,
  portfolioPrimary,
  marketsPrimary,
  portfolioSecondary = [],
  marketsSecondary = [],
  masked = false,
  footer,
  frameless = false,
}: PerformanceMarketsStripProps) {
  const uid = useId()
  const hasSecondary =
    portfolioSecondary.some((g) => g.metrics.length > 0) ||
    marketsSecondary.some((g) => g.metrics.length > 0)
  const hasPortfolioSecondary = portfolioSecondary.some((g) => g.metrics.length > 0)
  const hasMarketsSecondary = marketsSecondary.some((g) => g.metrics.length > 0)
  const line = { borderColor: 'var(--nv-line)' }

  // R13.R2F1 § A — data-driven, not scope-driven: reads the groups actually
  // passed in for THIS row, so it holds for row 2 as well, where (on Main)
  // both sides already carry titles and neither reserves (§ 9-10 comments).
  const portfolioPrimaryTitled = portfolioPrimary.some((g) => g.title)
  const marketsPrimaryTitled = marketsPrimary.some((g) => g.title)
  const portfolioSecondaryTitled = portfolioSecondary.some((g) => g.title)
  const marketsSecondaryTitled = marketsSecondary.some((g) => g.title)

  // R13.R5B § 1 — the portfolio column's per-basis tracks, shared by both rows.
  //
  // DATA-DRIVEN, like `reserveTitleRow` beside it: the two rows share a grid
  // only when they are actually describing the SAME set of bases, one group
  // each. A personal scope (one group, untitled) and any future shape where the
  // rows disagree fall through to the original flow untouched — aligning rows
  // that do not correspond would move figures under the wrong heading, which is
  // worse than the misalignment it set out to fix.
  const basisColumns =
    portfolioPrimary.length > 1 && portfolioPrimary.length === portfolioSecondary.length
      ? portfolioPrimary.length
      : 0

  if (frameless) {
    // R13.R2F3 — see the header comment. Same data, same GroupStack/MetricSlot
    // primitives, no card chrome, Portfolio stacked above Markets.
    return (
      <section className="flex-1 flex flex-col min-w-0 px-5 sm:px-6 pt-4">
        <h2 className="ui-label text-muted-fg mb-2.5">{sectionTitle}</h2>

        <div className="flex flex-col gap-1.5 min-w-0">
          <h3 className="ui-meta text-muted-fg font-semibold">{portfolioLabel}</h3>
          <GroupStack groups={portfolioPrimary} lead masked={masked} />
        </div>

        <div
          className="flex flex-col gap-1.5 min-w-0 mt-3 pt-3 border-t"
          style={line}
        >
          <h3 className="ui-meta text-muted-fg font-semibold">{marketsLabel}</h3>
          <GroupStack groups={marketsPrimary} lead masked={masked} />
        </div>

        {hasSecondary && (
          <div className="mt-3 pt-3 border-t" style={line}>
            {hasPortfolioSecondary && (
              <GroupStack groups={portfolioSecondary} lead={false} masked={masked} />
            )}
            {hasMarketsSecondary && (
              <div className={hasPortfolioSecondary ? 'mt-2.5 pt-2.5 border-t' : undefined} style={line}>
                <GroupStack groups={marketsSecondary} lead={false} masked={masked} />
              </div>
            )}
          </div>
        )}

        {footer && <div className="mt-auto pt-2.5">{footer}</div>}
      </section>
    )
  }

  return (
    <GlassSurface variant="card" className="flex flex-col">
      {/* The horizon, stated ONCE for the whole band — closed off by a hairline
          so the title reads as the band's header row, and the ruled grid below
          it as one system under that header. */}
      <div className="border-b" style={line}>
        <h2 className="ui-label text-foreground px-5 sm:px-6 2xl:px-7 pt-4 pb-2.5">{sectionTitle}</h2>
      </div>

      {/* Third track absorbs leftover width so the two content columns stay
          adjacent — the whole point of § 4's "move the markets block left". */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,auto)_minmax(0,auto)_minmax(0,1fr)]">
        <section aria-labelledby={`${uid}-portfolio`} className={CELL_LEAD}>
          <h3 id={`${uid}-portfolio`} className="ui-label text-muted-fg mb-2.5">
            {portfolioLabel}
          </h3>
          <GroupStack
            groups={portfolioPrimary}
            lead
            masked={masked}
            reserveTitleRow={!portfolioPrimaryTitled && marketsPrimaryTitled}
            columns={basisColumns}
          />
        </section>

        <section
          aria-labelledby={`${uid}-markets`}
          className={`${CELL_LEAD} border-t lg:border-t-0 lg:border-l`}
          style={line}
        >
          <h3 id={`${uid}-markets`} className="ui-label text-muted-fg mb-2.5">
            {marketsLabel}
          </h3>
          <GroupStack
            groups={marketsPrimary}
            lead
            masked={masked}
            reserveTitleRow={!marketsPrimaryTitled && portfolioPrimaryTitled}
          />
        </section>

        <div aria-hidden className="hidden lg:block" />

        {hasSecondary && (
          <>
            <div className={`${CELL_SUB} border-t`} style={line}>
              <GroupStack groups={portfolioSecondary} lead={false} masked={masked}
                reserveTitleRow={!portfolioSecondaryTitled && marketsSecondaryTitled}
                columns={basisColumns} />
            </div>
            <div className={`${CELL_SUB} border-t lg:border-l`} style={line}>
              <GroupStack groups={marketsSecondary} lead={false} masked={masked}
                reserveTitleRow={!marketsSecondaryTitled && portfolioSecondaryTitled} />
            </div>
            <div aria-hidden className="hidden lg:block border-t" style={line} />
          </>
        )}
      </div>

      {footer && (
        <div
          className="px-5 sm:px-6 2xl:px-7 pt-3 pb-4"
          style={{ borderTop: '1px solid var(--nv-line)' }}
        >
          {footer}
        </div>
      )}
    </GlassSurface>
  )
}
