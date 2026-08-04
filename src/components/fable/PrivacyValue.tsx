'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'

interface PrivacyValueProps {
  /** Controlled — the caller owns the toggle state (e.g. via `usePrivacyMode`). When true, a masked placeholder renders instead of `children`. */
  masked: boolean
  children: ReactNode
  className?: string
}

/**
 * R9.6 — "has the client-side preference store resolved yet?"
 *
 * `usePrivacyMode` is built on `usePersistentState`, which (correctly, for
 * hydration safety) renders its DEFAULT on the server and during the hydration
 * render, then reconciles to the stored value. For every other preference in
 * this app that is harmless. For privacy it is the one case where the default
 * is the UNSAFE answer: a user whose stored preference is ON would be told
 * "not masked" for exactly as long as hydration takes.
 *
 * This is the canonical `useSyncExternalStore` hydration signal — `false` on the
 * server and during hydration, `true` from the first client render onwards. It
 * is not a second privacy hook, a second key, or a second persistence path: it
 * stores nothing and reads nothing.
 */
const subscribeNever = () => () => {}
const resolvedOnClient = () => true
const unresolvedDuringHydration = () => false

/**
 * Visually masks a sensitive financial value. The underlying value is never
 * altered, logged, or transmitted — only the rendered text changes, and the
 * masked state is announced to assistive technology rather than silently
 * swapped.
 *
 * ── R9.6: THE BOUNDARY FAILS CLOSED ────────────────────────────────────────
 * It masks when `masked` is true OR while the preference is still unresolved.
 * Putting that decision HERE rather than in each caller means no consumer can
 * forget it, and a value can never be painted raw in the window before the
 * stored preference is known. A brief mask is acceptable; a brief disclosure is
 * not. On the two routes wired in R9.6 that window is invisible anyway — both
 * fetch their values on the client, so nothing protected exists to render yet.
 *
 * When masked, `children` is NOT rendered at all: the raw value never reaches
 * the DOM, so it cannot leak through text, `title`, a data attribute, hidden
 * markup, the clipboard, or the accessibility tree. This is deliberately not a
 * blur, an opacity change, a filter, or a recolour — all of which keep the real
 * text one screenshot or one DOM inspection away.
 */
export function PrivacyValue({ masked, children, className = '' }: PrivacyValueProps) {
  const { t } = useLang()
  const resolved = useSyncExternalStore(subscribeNever, resolvedOnClient, unresolvedDuringHydration)
  if (!masked && resolved) return <span className={className}>{children}</span>
  return (
    // `role="img"` + `aria-label`: the bullets are a glyph standing in for the
    // value, so assistive technology reads one truthful phrase ("Value hidden")
    // instead of five bullet characters. (`role="text"` was used before R9.6 —
    // it is not in the ARIA specification and only Safari honours it, so in
    // every other browser the label was silently dropped.)
    <span className={`ui-number tracking-wide ${className}`} role="img" aria-label={t.fable.privacy.masked}>
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
