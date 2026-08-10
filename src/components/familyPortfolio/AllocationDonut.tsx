'use client'

// R13.7 — inline-SVG allocation donut (doc 07 §§ 7.1, 9).
//
// No chart library (the Structured Notes entity donut is the precedent).
// Slices are the AVAILABLE weights of ONE basis; a null-weight entry draws no
// slice (it is not zero) and the caller shows the partial state. Colors come
// from the `--fp-slice-*` identity tokens — never the signal tokens — and
// meaning is NEVER carried by color alone: the legend names every entry
// beside its chip, and the SVG is `role="img"` with a text summary.
//
// Weights are percentages, which follow the app's privacy policy for
// non-monetary figures (not masked); the absolute amounts stay in the tables,
// behind the mask.

import { formatWeightPct } from '@/lib/formatters'

interface DonutEntry {
  key: string
  label: string
  /** Weight ratio (0.42 = 42%); null draws no slice. */
  weight: number | null
}

interface AllocationDonutProps {
  entries: DonutEntry[]
  /** Accessible summary, e.g. "Asset allocation — Total basis". */
  summary: string
  size?: number
}

const TAU = Math.PI * 2

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

export function AllocationDonut({ entries, summary, size = 168 }: AllocationDonutProps) {
  const available = entries.filter(
    (e): e is DonutEntry & { weight: number } => e.weight !== null && e.weight > 0,
  )
  const total = available.reduce((a, e) => a + e.weight, 0)
  if (available.length === 0 || total <= 0) return null

  const cx = size / 2
  const cy = size / 2
  const r1 = size / 2 - 2
  const r0 = r1 * 0.62

  // Slices are normalized over the AVAILABLE weights so the ring closes; the
  // legend shows each entry's true weight against its stated denominator, so
  // a partial basis cannot misread as a complete one. Prefix sums instead of
  // a running accumulator — render code stays mutation-free.
  const fractions = available.map((e) => e.weight / total)
  const slices = available.map((e, i) => {
    const a0 = fractions.slice(0, i).reduce((a, b) => a + b, 0) * TAU
    const a1 = a0 + fractions[i] * TAU
    return { ...e, a0, a1: Math.min(a1, TAU - 1e-9), colorVar: `--fp-slice-${(i % 8) + 1}` }
  })

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={summary}
        className="shrink-0"
      >
        {slices.map((s) => (
          <path
            key={s.key}
            d={arcPath(cx, cy, r0, r1, s.a0, s.a1)}
            fill={`var(${s.colorVar})`}
            stroke="var(--surface)"
            strokeWidth={1}
          />
        ))}
      </svg>
      <ul className="flex flex-col gap-1 min-w-0">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-xs min-w-0">
            <span
              aria-hidden
              className="shrink-0 w-2.5 h-2.5 rounded-[3px]"
              style={{ backgroundColor: `var(${s.colorVar})` }}
            />
            <span className="truncate text-foreground">{s.label}</span>
            <span className="ui-number text-muted-fg shrink-0">{formatWeightPct(s.weight)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
