'use client'

// R13.7 → R13.R2 — inline-SVG allocation donut (doc 07 §§ 7.1, 9), extended
// to honour the administrator's global presentation settings (§§ 14-15).
//
// No chart library (the Structured Notes entity donut is the precedent).
// Slices are the AVAILABLE weights of ONE basis; a null-weight entry draws no
// slice (it is not zero) and the caller shows the partial state. Colours come
// from the chosen palette's identity tokens via `paletteTokenAt` — never the
// signal tokens, never a hex — and meaning is NEVER carried by colour alone:
// the legend (when visible) names every entry beside its chip; when the
// administrator hides the legend, the SVG's aria-label enumerates every slice
// with its weight and each slice keeps its own <title>/aria-label, so a
// keyboard or screen-reader user loses nothing.
//
// PRIVACY. Weights are percentages (not masked, per the standing policy).
// Monetary amounts appear only when the settings ask for them: in the legend
// they go through `MaskedAmount` (the one guarded render path); inside the
// SVG — where `MaskedAmount` cannot render — a value-bearing slice label
// falls back to PERCENTAGE-ONLY whenever the page is masked OR while the
// stored privacy preference is still unresolved (the same fail-closed
// hydration gate `PrivacyValue` applies, mirrored here with the identical
// `useSyncExternalStore` signal). An amount is therefore never painted while
// the page is masked, in any label position. Slice <title>s and aria-labels
// carry label + weight only — never an amount — so nothing monetary can leak
// through the hover or accessibility tree regardless of settings.
//
// INSIDE LABELS use a fill/halo pair (`--foreground` over a `--surface`
// stroke, paint-order stroke): the palettes invert lightness across themes,
// so no single text colour contrasts with every slice — the halo does, in
// both themes, on all three palettes. A label is drawn only where the slice
// is wide enough to hold it (arc-length check); it is skipped otherwise —
// labels never overlap, and the legend/summary still carry the entry.
//
// INTERACTION. Hover, keyboard focus, and tap all highlight a slice and
// notify the parent (`onActiveKeyChange`) so the panel can coordinate a
// highlight. Slices are real focusable SVG elements — never mouse-only.

import { useState, useSyncExternalStore } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { formatUsd, formatWeightPct } from '@/lib/formatters'
import {
  paletteTokenAt,
  THICKNESS_INNER_RATIO,
  type AllocationPresentationSettings,
} from '@/lib/familyPortfolio/allocationSettings'
import { MaskedAmount } from './MaskedAmount'

export interface DonutEntry {
  key: string
  label: string
  /** Weight ratio (0.42 = 42%); null draws no slice. */
  weight: number | null
  /** Monetary; only rendered when labelContent includes value, and always masked. */
  value: number | null
}

export interface AllocationDonutProps {
  entries: DonutEntry[]
  /** Accessible summary, e.g. "Asset allocation — Total basis". */
  summary: string
  settings: AllocationPresentationSettings
  masked: boolean
  size?: number
  /** Notifies the parent which slice is hovered/focused, for coordinated highlight. */
  onActiveKeyChange?: (key: string | null) => void
  /**
   * R13.R2F2 — 'compact' (default) is the original, UNCHANGED centred
   * donut-and-legend pair (Main's 5fr allocation column). 'wide' anchors the
   * donut left at its full protected size and lets the legend claim the rest
   * of the column's width, instead of the pair floating centred with dead
   * space on both sides.
   *
   * R13.R2F3 briefly went unused: a personal scope's row was narrowed to the
   * same 5fr share Main already gives Allocation, so 'compact' seemed to fit
   * both equally. That pass also tried a dotted leader between each 'wide'
   * legend row's name and its weight, to visibly fill the released width —
   * the owner reviewed and rejected it as an "empty-field effect."
   *
   * R13.R2F4 (owner report) — a personal scope's Allocation column is the
   * ROW'S LAST column, with nothing after it, so a centred pair there reads
   * as dead space rather than sitting beside Main's Notes ledger the way
   * Main's centred pair does. 'wide' is back in use
   * (`app/portfolio/page.tsx`, gated on the same `showNotes` flag that
   * already splits the two rows) — now WITHOUT the leader: the legend is a
   * plain name-left/weight-right ledger row, the same convention the rest of
   * NMI uses, simply released to the column's own right edge instead of a
   * fixed `max-w`.
   */
  layout?: 'compact' | 'wide'
}

const TAU = Math.PI * 2

// PrivacyValue's fail-closed hydration signal, mirrored verbatim (see its
// header): `false` on the server and during hydration, `true` from the first
// client render on. Not a second privacy store — it stores and reads nothing.
const subscribeNever = () => () => {}
const resolvedOnClient = () => true
const unresolvedDuringHydration = () => false

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  // Donut segment between angles a0→a1 (radians from 12 o'clock, clockwise).
  const sweep = a1 - a0
  const large = sweep > Math.PI ? 1 : 0
  const p = (r: number, a: number) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`
  return [
    `M ${p(r1, a0)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}`,
    `L ${p(r0, a1)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}`,
    'Z',
  ].join(' ')
}

export function AllocationDonut({
  entries,
  summary,
  settings,
  masked,
  size = 168,
  onActiveKeyChange,
  layout = 'compact',
}: AllocationDonutProps) {
  const { t } = useLang()
  const resolved = useSyncExternalStore(subscribeNever, resolvedOnClient, unresolvedDuringHydration)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // Only meaningful with a legend to stretch — with the legend hidden there
  // is nothing to anchor right, so a lone ring stays exactly as it was
  // (centred; see `AllocationPanel`'s wrapper, unchanged either way).
  const spread = layout === 'wide' && settings.legendVisible

  const available = entries.filter(
    (e): e is DonutEntry & { weight: number } => e.weight !== null && e.weight > 0,
  )
  const total = available.reduce((a, e) => a + e.weight, 0)
  if (available.length === 0 || total <= 0) return null

  // Fail closed exactly like PrivacyValue: masked, or preference unresolved.
  const maskedEffective = masked || !resolved
  const wantsValue = settings.labelContent !== 'percentage'

  // Outside labels need room beyond the ring for the leader line + text; the
  // ring itself stays `size` across, so the panel's layout doesn't jump when
  // an administrator switches label positions on and off the ring.
  const pad = settings.labelPosition === 'outside' ? 64 : 0
  const box = size + pad * 2
  const cx = box / 2
  const cy = box / 2
  const r1 = size / 2 - 2
  const r0 = r1 * THICKNESS_INNER_RATIO[settings.donutThickness]

  // Slices are normalized over the AVAILABLE weights so the ring closes; the
  // legend shows each entry's true weight against its stated denominator, so
  // a partial basis cannot misread as a complete one. Prefix sums instead of
  // a running accumulator — render code stays mutation-free.
  const fractions = available.map((e) => e.weight / total)
  const slices = available.map((e, i) => {
    const a0 = fractions.slice(0, i).reduce((a, b) => a + b, 0) * TAU
    const a1 = a0 + fractions[i] * TAU
    return { ...e, a0, a1: Math.min(a1, TAU - 1e-9), colorVar: paletteTokenAt(settings.palette, i) }
  })

  // What a slice label states (never the entry name — that is the legend's
  // and the summary's job). Under the mask, the value line is dropped rather
  // than bulleted: a per-slice masking glyph reads as noise, and the settings
  // dialog already tells the administrator value labels follow privacy mode.
  function labelLines(weight: number, value: number | null): string[] {
    const pct = formatWeightPct(weight)
    if (!wantsValue || maskedEffective) return [pct]
    const amount = value !== null && Number.isFinite(value) ? formatUsd(value) : '—'
    return settings.labelContent === 'value' ? [amount] : [pct, amount]
  }

  function setActive(key: string | null) {
    setActiveKey(key)
    onActiveKeyChange?.(key)
  }

  // Colour alone never carries meaning: with the legend hidden, the SVG's own
  // accessible name enumerates every slice with its weight.
  const svgLabel = settings.legendVisible
    ? summary
    : `${summary} — ${slices.map((s) => `${s.label} ${formatWeightPct(s.weight)}`).join(', ')}`

  const labelFont = {
    fontSize: 'var(--fs-meta)',
    fontFamily: 'var(--font-sans)',
    fontVariantNumeric: 'tabular-nums' as const,
  }

  return (
    // `relative` contains the absolutely-positioned `sr-only` span below —
    // the app previously shipped a bug where an sr-only descendant escaped
    // its container and created page-level scroll. Below `sm` (a stacked
    // mobile column) the pair still wraps and centres, ring first with the
    // legend below it — the correct, intended mobile presentation.
    //
    // R13.R2F4 (owner report) — AT `sm` AND UP THE PAIR CAN NO LONGER WRAP
    // (`sm:flex-nowrap`, both branches below). It previously stayed side by
    // side only by a width-arithmetic coincidence — the ring plus the
    // legend's minimum flex-basis plus the gap happened to clear the
    // column — and a single administrator setting (outside slice labels,
    // which pads the ring an extra 128px) was enough to push the pair past
    // that threshold and drop the legend below the ring on a real personal
    // Summary. The guarantee now holds structurally instead: the legend is
    // the one flex item that gives way (it already truncates its own labels,
    // and in `spread` carries no upper `max-w` at all), the ring stays
    // `shrink-0` at its full protected size, and `flex-nowrap` makes
    // wrapping impossible rather than merely unlikely, for either `layout`.
    //
    // R13.R2F2 — `spread` (wide layout + a visible legend) additionally
    // stretches this row to `w-full` and anchors it `justify-start` AT `sm`
    // AND UP: the ring stays first (left) and the legend claims the rest of
    // the column's width instead of leaving it as dead space either side of
    // a centred pair. Compact/Main keeps every other class identical to
    // before this pass — `spread` is false there, so only the shared
    // `sm:flex-nowrap` guard above is new to it.
    //
    // R13.R2F5 (owner report) — `justify-start` was UNCONDITIONAL, so below
    // `sm` (where the row wraps per the note above) it also pinned the ring
    // to the left edge of a full-width mobile card, leaving all the freed
    // space on its right instead of centring the wrapped first line. The
    // start-anchoring is now breakpoint-scoped (`justify-center sm:justify-start`):
    // the wrapped mobile line centres like every other stacked pair, and the
    // desktop no-wrap row still anchors left so the legend can claim the
    // column's width exactly as before.
    <div
      className={
        spread
          ? 'relative flex flex-wrap sm:flex-nowrap items-center justify-center sm:justify-start gap-x-6 gap-y-3 min-w-0 w-full max-w-full'
          : 'relative flex flex-wrap sm:flex-nowrap items-center justify-center gap-x-6 gap-y-3 min-w-0 max-w-full'
      }
    >
      <svg
        viewBox={`0 0 ${box} ${box}`}
        width={box}
        height={box}
        role="img"
        aria-label={svgLabel}
        // R13.R2F § 8 — `max-w-full h-auto` over the intrinsic width/height:
        // the ring keeps its nominal size wherever it fits, and scales down
        // (never clips, never overflows) in the one case where it cannot — the
        // administrator's "outside labels" setting, whose leader-line padding
        // pushes the box past a 390px card. A chart that widens the page is a
        // page-level overflow, which this module does not ship.
        className="shrink-0 max-w-full h-auto"
      >
        {slices.map((s) => {
          const active = activeKey === s.key
          const dimmed = activeKey !== null && !active
          return (
            <path
              key={s.key}
              d={arcPath(cx, cy, r0, r1, s.a0, s.a1)}
              fill={`var(${s.colorVar})`}
              // R13.R2F § 8 — the separator between neighbouring slices is the
              // page surface itself, drawn a touch heavier so two adjacent
              // categories read as two BEFORE any hover. Colour is never the
              // only thing dividing them.
              stroke="var(--surface)"
              strokeWidth={active ? 3 : 1.5}
              opacity={dimmed ? 0.45 : 1}
              className="nv-transition"
              // Reachable without a mouse: focus highlights; Enter/Space and
              // tap toggle. Label + weight only — never an amount.
              tabIndex={0}
              aria-label={`${s.label} ${formatWeightPct(s.weight)}`}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(activeKey === s.key ? null : s.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setActive(activeKey === s.key ? null : s.key)
                }
              }}
            >
              <title>{`${s.label} — ${formatWeightPct(s.weight)}`}</title>
            </path>
          )
        })}

        {/* Slice labels (content only), per the administrator's settings. */}
        {settings.labelPosition === 'inside' &&
          slices.map((s) => {
            const lines = labelLines(s.weight, s.value)
            const mid = (s.a0 + s.a1) / 2
            const rMid = (r0 + r1) / 2
            const arcLen = (s.a1 - s.a0) * rMid
            const ringDepth = r1 - r0
            // Legibility gate: one line needs ~46px of arc and 14px of ring
            // depth; two lines need more of both. Too-small slices draw no
            // label at all — never an overlapping or clipped one.
            const fitsTwo = arcLen >= 64 && ringDepth >= 26
            const fitsOne = arcLen >= 46 && ringDepth >= 14
            const drawn = fitsTwo ? lines : fitsOne ? lines.slice(0, 1) : []
            if (drawn.length === 0) return null
            const x = cx + rMid * Math.sin(mid)
            const y = cy - rMid * Math.cos(mid)
            return (
              <text
                key={`label-${s.key}`}
                x={x}
                y={drawn.length === 2 ? y - 6 : y}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
                aria-hidden="true"
                fill="var(--foreground)"
                style={{
                  ...labelFont,
                  // Cartographic halo: theme-inverse stroke under the text so
                  // it stays AA-legible on every slice of every palette.
                  paintOrder: 'stroke',
                  stroke: 'var(--surface)',
                  strokeWidth: 2.5,
                  strokeLinejoin: 'round',
                }}
              >
                {drawn.map((line, li) => (
                  <tspan key={li} x={x} dy={li === 0 ? 0 : 12}>
                    {line}
                  </tspan>
                ))}
              </text>
            )
          })}

        {settings.labelPosition === 'outside' &&
          slices.map((s) => {
            // A minimal angular gate so adjacent leader labels cannot collide;
            // slices below it stay named in the legend/summary/title.
            if (s.a1 - s.a0 < 0.14) return null
            const lines = labelLines(s.weight, s.value)
            const mid = (s.a0 + s.a1) / 2
            const rightSide = mid < Math.PI
            const x1 = cx + (r1 + 3) * Math.sin(mid)
            const y1 = cy - (r1 + 3) * Math.cos(mid)
            const x2 = cx + (r1 + 12) * Math.sin(mid)
            const y2 = cy - (r1 + 12) * Math.cos(mid)
            const tx = x2 + (rightSide ? 6 : -6)
            return (
              <g key={`leader-${s.key}`} pointerEvents="none" aria-hidden="true">
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--chart-axis)"
                  strokeWidth={1}
                  opacity={0.6}
                />
                <text
                  x={tx}
                  y={lines.length === 2 ? y2 - 5 : y2}
                  textAnchor={rightSide ? 'start' : 'end'}
                  dominantBaseline="middle"
                  fill="var(--foreground)"
                  style={labelFont}
                >
                  {lines.map((line, li) => (
                    <tspan key={li} x={tx} dy={li === 0 ? 0 : 12}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            )
          })}
      </svg>

      {settings.legendVisible && (
        // R13.R2F § 8 — THE LEGEND IS A SMALL LEDGER, NOT A LIST OF CHIPS.
        // Names grow, weights are pinned to a common right edge (`ml-auto`,
        // every row, both layouts), so the reader compares a column of
        // percentages rather than scanning a ragged line. Compact (Main): the
        // measure is bounded at both ends — it never collapses below a
        // readable width, and never grows so wide that the ring stops being
        // the centrepiece of the panel (`max-w-[18rem]`, unchanged).
        // R13.R2F2 `spread`: the upper bound is deliberately released so the
        // ledger can claim the column's freed width instead of leaving it
        // blank. R13.R2F3 tried filling that slack with a dotted leader
        // between each name and its weight; the owner reviewed and rejected
        // it as an "empty-field effect" (R13.R2F4) — the slack is now simply
        // absorbed by the row's own left/right justification, the same
        // label-left/number-right convention the rest of NMI's ledgers use.
        <ul
          className={
            spread
              ? 'flex flex-col gap-1.5 min-w-0 basis-[11rem] grow'
              : 'flex flex-col gap-1.5 min-w-0 basis-[11rem] grow max-w-[18rem]'
          }
        >
          {slices.map((s) => {
            const dimmed = activeKey !== null && activeKey !== s.key
            return (
              <li
                key={s.key}
                className="flex items-center gap-x-2.5 text-xs min-w-0 nv-transition"
                style={{ opacity: dimmed ? 0.55 : 1 }}
                onMouseEnter={() => setActive(s.key)}
                onMouseLeave={() => setActive(null)}
              >
                <span
                  aria-hidden
                  className="shrink-0 w-2.5 h-2.5 rounded-[3px]"
                  style={{ backgroundColor: `var(${s.colorVar})` }}
                />
                <span className="truncate min-w-0 text-foreground">{s.label}</span>
                <span className="ui-number text-muted-fg shrink-0 ml-auto">
                  {formatWeightPct(s.weight)}
                </span>
                {wantsValue && (
                  <MaskedAmount
                    value={s.value}
                    masked={masked}
                    className="ui-number text-muted-fg shrink-0"
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      {/* The masked state itself stays announced even when every visible
          amount fell back to percentages — one honest phrase, not silence. */}
      {maskedEffective && wantsValue && <span className="sr-only">{t.fable.privacy.masked}</span>}
    </div>
  )
}
