'use client'

import { useState, useCallback } from 'react'

interface Props {
  onRefresh: () => Promise<void>
  className?: string
}

/**
 * Subtle ↻ icon button for refreshing live market data.
 * Idle → muted icon. Loading → spinning accent. Done → green checkmark (2 s).
 */
export function MarketRefreshButton({ onRefresh, className = '' }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')

  const handleClick = useCallback(async () => {
    if (state === 'loading') return
    setState('loading')
    try {
      await onRefresh()
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('idle')
    }
  }, [onRefresh, state])

  const label =
    state === 'loading' ? 'Refreshing…' :
    state === 'done'    ? 'Data refreshed' :
                          'Refresh market data'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      title={label}
      aria-label={label}
      className={[
        'inline-flex items-center justify-center w-5 h-5 rounded transition-colors duration-150',
        state === 'idle'    && 'text-muted-fg hover:text-foreground hover:bg-surface-2',
        state === 'loading' && 'text-accent cursor-default',
        state === 'done'    && 'text-positive',
        className,
      ].filter(Boolean).join(' ')}
    >
      {state === 'done' ? (
        // Checkmark
        <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3" aria-hidden>
          <polyline
            points="2,8.5 6,12.5 14,4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // Rotating arrow — spins when loading
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className={`w-3 h-3${state === 'loading' ? ' animate-spin' : ''}`}
          aria-hidden
        >
          <path
            d="M13.5 8A5.5 5.5 0 1 1 8 2.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <polyline
            points="8,2.5 11,2.5 11,5.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}
