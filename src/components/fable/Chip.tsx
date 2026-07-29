'use client'

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/**
 * The Fable chip/pill control recipe (999px capsule on the `--nv-chip` /
 * `--nv-chipbd` material), extracted so pages stop hand-rolling it inline.
 * Three variants, matching how the app genuinely uses chips today:
 *
 *  - `ChipButton` — an interactive pill (`<button type="button">`).
 *  - `ChipLabel`  — a non-interactive status/label pill (`<span>`).
 *  - `ChipSelect` — a native `<select>` in pill clothing (the pattern the
 *    Stocks sector filter established: a real select, deliberately NOT a
 *    segmented control, because 10+ options must not wrap or scroll away).
 *
 * Token-only: colors come from the chip/selection tokens, focus comes from
 * the global `:focus-visible` ring, motion from `.nv-transition`. Never nest
 * an interactive element inside `ChipButton`.
 */

const CHIP_BASE =
  'inline-flex items-center gap-1.5 h-8 rounded-full border border-[var(--nv-chipbd)] text-xs whitespace-nowrap nv-transition'

interface ChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Active/selected state — conveyed by fill AND weight, never color alone. */
  selected?: boolean
}

export function ChipButton({ selected = false, className = '', children, ...rest }: ChipButtonProps) {
  return (
    <button
      type="button"
      className={[
        CHIP_BASE,
        'px-3.5 disabled:opacity-50 disabled:cursor-not-allowed',
        selected
          ? 'bg-[var(--selected)] text-foreground font-semibold'
          : 'bg-[var(--nv-chip)] text-muted-fg hover:text-foreground',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

interface ChipLabelProps {
  selected?: boolean
  className?: string
  title?: string
  children: ReactNode
}

export function ChipLabel({ selected = false, className = '', title, children }: ChipLabelProps) {
  return (
    <span
      title={title}
      className={[
        CHIP_BASE,
        'px-3.5',
        selected ? 'bg-[var(--selected)] text-foreground font-semibold' : 'bg-[var(--nv-chip)] text-muted-fg',
        className,
      ].join(' ')}
    >
      {children}
    </span>
  )
}

type ChipSelectProps = SelectHTMLAttributes<HTMLSelectElement>

export function ChipSelect({ className = '', children, ...rest }: ChipSelectProps) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        className={`${CHIP_BASE} appearance-none pl-3.5 pr-8 bg-[var(--nv-chip)] text-foreground cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
        {...rest}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-fg"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 4.5 6 8l3.5-3.5" />
      </svg>
    </span>
  )
}
