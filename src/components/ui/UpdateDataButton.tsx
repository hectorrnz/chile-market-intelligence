'use client'

import { useState, useCallback } from 'react'
import { useLang } from '@/components/providers/LangProvider'

interface Props {
  onRefresh: () => Promise<void>
  className?: string
}

/**
 * Single, prominent "Update Data" button — replaces the small per-panel
 * refresh icons. One of these per page, placed at the top, refreshes every
 * live data section on that page via the page's own combined onRefresh.
 */
export function UpdateDataButton({ onRefresh, className = '' }: Props) {
  const { t } = useLang()
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
    state === 'loading' ? t.common.updating :
    state === 'done'    ? t.common.dataUpdated :
                          t.common.updateData

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      title={label}
      aria-label={label}
      className={[
        'inline-flex items-center gap-2 h-9 px-4 rounded border text-sm font-medium transition-colors duration-150 shrink-0',
        state === 'idle'    && 'border-accent text-accent bg-surface hover:bg-accent hover:text-accent-fg',
        state === 'loading' && 'border-accent text-accent bg-surface cursor-default',
        state === 'done'    && 'border-positive text-positive bg-surface',
        className,
      ].filter(Boolean).join(' ')}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className={`w-4 h-4 shrink-0${state === 'loading' ? ' animate-spin' : ''}`}
        aria-hidden
      >
        {state === 'done' ? (
          <polyline
            points="2,8.5 6,12.5 14,4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <polyline points="8,2.5 11,2.5 11,5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
      {label}
    </button>
  )
}
