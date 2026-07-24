'use client'

import type { ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'

interface PrivacyValueProps {
  /** Controlled — the caller owns the toggle state (e.g. via `usePrivacyMode`). When true, a masked placeholder renders instead of `children`. */
  masked: boolean
  children: ReactNode
  className?: string
}

/**
 * Visually masks a sensitive financial value. The underlying value is never
 * altered, logged, or transmitted — only the rendered text changes, and the
 * masked state is announced to assistive technology rather than silently
 * swapped.
 */
export function PrivacyValue({ masked, children, className = '' }: PrivacyValueProps) {
  const { t } = useLang()
  if (!masked) return <span className={className}>{children}</span>
  return (
    <span className={`ui-number tracking-wide ${className}`} aria-label={t.fable.privacy.masked} role="text">
      •••••
    </span>
  )
}

interface PrivacyToggleProps {
  masked: boolean
  onToggle: () => void
  className?: string
}

/** Small icon button pairing with `PrivacyValue` — not required to use it, but a common companion control. */
export function PrivacyToggle({ masked, onToggle, className = '' }: PrivacyToggleProps) {
  const { t } = useLang()
  const label = masked ? t.fable.privacy.show : t.fable.privacy.hide
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={masked}
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition ${className}`}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4" aria-hidden="true">
        {masked ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2 2l16 16M9.9 9.9a2 2 0 0 0 2.2 2.2M5.6 5.9C3.8 7.1 2.5 8.8 2 10c1.3 3 4.8 6 8 6 1.4 0 2.7-.4 3.9-1.1M8.3 4.2A8.7 8.7 0 0 1 10 4c3.2 0 6.7 3 8 6-.4.9-1 1.9-1.8 2.7"
          />
        ) : (
          <>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" />
            <circle cx="10" cy="10" r="2.2" />
          </>
        )}
      </svg>
    </button>
  )
}
