'use client'

import { useId, useRef } from 'react'
import { useNavIndicator } from '@/components/layout/useNavIndicator'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  /** Extra value to remeasure the indicator on (e.g. language) besides `value` itself. */
  remeasureToken?: string
  className?: string
}

/**
 * Generic Fable segmented pill control — a measured sliding indicator using
 * the same technique as the Phase 2 primary/secondary nav rails
 * (`useNavIndicator`), so no second visual system is introduced for
 * timeframe/period/frequency/currency toggles. Fully keyboard-operable as a
 * `role="radiogroup"` of `role="radio"` buttons with a roving tabindex.
 */
export function SegmentedControl<T extends string>({
  options, value, onChange, ariaLabel, remeasureToken, className = '',
}: SegmentedControlProps<T>) {
  const uid = useId()
  const { railRef, setItemRef, rect } = useNavIndicator(value, remeasureToken ? `${value}|${remeasureToken}` : value)
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const enabledValues = options.filter((o) => !o.disabled).map((o) => o.value)

  function select(next: T) {
    onChange(next)
    requestAnimationFrame(() => buttonRefs.current[next]?.focus())
  }

  function move(delta: number) {
    const idx = enabledValues.indexOf(value)
    if (idx === -1 || enabledValues.length === 0) return
    select(enabledValues[(idx + delta + enabledValues.length) % enabledValues.length])
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Home' && enabledValues.length) { e.preventDefault(); select(enabledValues[0]) }
    else if (e.key === 'End' && enabledValues.length) { e.preventDefault(); select(enabledValues[enabledValues.length - 1]) }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      ref={railRef as React.RefObject<HTMLDivElement>}
      onKeyDown={onKeyDown}
      className={`relative inline-flex items-center gap-0.5 rounded-full p-0.5 ${className}`}
      style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
    >
      {rect && (
        <span
          aria-hidden="true"
          className="absolute top-0.5 left-0 bottom-0.5 rounded-full nv-indicator"
          style={{ transform: `translateX(${rect.left}px)`, width: rect.width, backgroundColor: 'var(--surface)' }}
        />
      )}
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            id={`${uid}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            tabIndex={active ? 0 : -1}
            ref={(el) => {
              buttonRefs.current[option.value] = el
              setItemRef(option.value)(el)
            }}
            onClick={() => !option.disabled && select(option.value)}
            className="relative z-10 shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-xs nv-transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: active ? 'var(--foreground)' : 'var(--muted-fg)', fontWeight: active ? 600 : 500 }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
