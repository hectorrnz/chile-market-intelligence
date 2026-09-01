'use client'

import { useLang } from '@/components/providers/LangProvider'

export type AsyncStateKind =
  | 'loading'
  | 'empty'
  | 'error'
  | 'unavailable'
  | 'blocked'
  | 'partial'
  | 'stale'
  /**
   * POST-R13.6CDE — the caller is signed in and approved, but does not hold the
   * module. An ANSWER, not a failure.
   *
   * Distinct from `error` because the reported Structured Notes bug was exactly
   * this conflation: a deliberate authorization denial rendered as "Something
   * went wrong", which invites the user to retry something that will never
   * succeed and hides the real cause from whoever debugs it. Distinct from
   * `blocked` too — that means a DATA SOURCE is unavailable to everyone (CMF's
   * CAPTCHA gate), not that this particular account may not look.
   */
  | 'not_authorized'

interface AsyncStateProps {
  kind: AsyncStateKind
  /** Overrides the default title copy for this specific situation (e.g. naming the blocked provider). The default body copy still renders unless `message` is given. */
  message?: string
  /** Shown for partial/stale — the data that IS present still needs attribution. */
  source?: string
  asOf?: string
  className?: string
}

const DOT_COLOR: Partial<Record<AsyncStateKind, string>> = {
  error: 'var(--negative)',
  // Warning, not negative: being outside a module is a normal configuration,
  // not a fault, and colouring it like a crash would misrepresent it.
  not_authorized: 'var(--warning)',
  unavailable: 'var(--warning)',
  blocked: 'var(--negative)',
  partial: 'var(--warning)',
  stale: 'var(--warning)',
}

/**
 * Shared visual language for the eight async states this app distinguishes.
 * Deliberately NOT a generic skeleton for every state — "loading" has a
 * spinner, but "empty"/"error"/"unavailable"/"blocked"/"not_authorized"/"partial"/"stale" each
 * render their own honest copy, so a viewer can never mistake "still
 * loading" for "nothing here" or "this failed" for "this is blocked". Source
 * and as-of are preserved for the two states where real data still backs the
 * module (partial, stale).
 */
export function AsyncState({ kind, message, source, asOf, className = '' }: AsyncStateProps) {
  const { t } = useLang()
  const copy = t.fable.async[kind]
  const dot = DOT_COLOR[kind]

  return (
    <div
      className={`flex flex-col items-center gap-1.5 py-10 px-4 text-center ${className}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {kind === 'loading' ? (
        <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 nv-spin text-muted-fg" aria-hidden="true">
          <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      ) : dot ? (
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />
      ) : null}
      <p className="text-xs text-muted-fg">{message ?? copy.title}</p>
      {!message && <p className="ui-meta text-muted-fg max-w-sm">{copy.body}</p>}
      {(kind === 'partial' || kind === 'stale') && source && (
        <p className="ui-meta text-muted-fg">
          {t.common.source}: {source}
          {asOf ? ` ${t.common.asOf} ${asOf}` : ''}
        </p>
      )}
    </div>
  )
}
