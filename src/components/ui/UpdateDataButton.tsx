'use client'

import { useState, useCallback } from 'react'
import { useLang } from '@/components/providers/LangProvider'

interface Props {
  /**
   * The refresh action. **Required, and it must be the authoritative
   * platform-wide callback** — every caller passes `useGlobalRefresh()` (or
   * its own thin wrapper around it), obtained in the page. A route-local
   * refresh handler must never be passed here: this control always means
   * "update the whole platform", not "update this page's data".
   */
  onRefresh: () => Promise<void>
  className?: string
}

/**
 * Single, prominent "Update Data" button — replaces the small per-panel
 * refresh icons. One per page, placed in the page-header action cluster.
 *
 * It **represents** the platform-wide update action but deliberately does not
 * own it: the button holds no provider dependency and performs no fetching or
 * orchestration of its own. It renders three states around whatever promise
 * the caller supplies, and the caller is responsible for supplying the
 * authoritative `useGlobalRefresh` callback (MarketDataProvider +
 * MacroDataProvider fan-out).
 */
export function UpdateDataButton({ onRefresh, className = '' }: Props) {
  const { t } = useLang()
  // R12: a FAILED refresh now has its own visible state — previously it
  // snapped back to 'idle', indistinguishable from never having clicked, so
  // an offline Update silently read as success. The transient failed label
  // also feeds the sr-only status region below, so the outcome (updated /
  // failed) is announced to assistive technology either way.
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle')

  const handleClick = useCallback(async () => {
    if (state === 'loading') return
    setState('loading')
    try {
      await onRefresh()
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('failed')
      setTimeout(() => setState('idle'), 4000)
    }
  }, [onRefresh, state])

  const label =
    state === 'loading' ? t.common.updating :
    state === 'done'    ? t.common.dataUpdated :
    state === 'failed'  ? t.common.updateFailed :
                          t.common.updateData

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      title={label}
      aria-label={label}
      className={[
        'inline-flex items-center gap-2 h-9 px-4 rounded-full border text-sm font-medium nv-transition shrink-0',
        state === 'idle'    && 'border-accent text-accent bg-surface hover:bg-accent hover:text-accent-fg',
        state === 'loading' && 'border-accent text-accent bg-surface cursor-default',
        state === 'done'    && 'border-positive text-positive bg-surface',
        state === 'failed'  && 'border-negative text-negative bg-surface',
        className,
      ].filter(Boolean).join(' ')}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className={`w-4 h-4 shrink-0${state === 'loading' ? ' nv-spin' : ''}`}
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
        ) : state === 'failed' ? (
          // ✕ — the outcome is also stated in the visible label ("Update
          // failed"), never by color alone.
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ) : (
          <>
            <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <polyline points="8,2.5 11,2.5 11,5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
      {label}
      {/* R12: outcome announced to AT — label changes alone are not. */}
      <span role="status" className="sr-only">
        {state === 'done' ? t.common.dataUpdated : state === 'failed' ? t.common.updateFailed : ''}
      </span>
    </button>
  )
}
