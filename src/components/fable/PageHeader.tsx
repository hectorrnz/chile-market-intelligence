'use client'

import type { ReactNode } from 'react'

interface PageHeaderProps {
  /** Uppercase section eyebrow above the title (`ui-label`). */
  eyebrow?: ReactNode
  /** The page title — rendered at the Fable `ui-page-title` scale (19px/650). */
  title: ReactNode
  /**
   * Dot-separated metadata on the title baseline (counts, as-of context, a
   * source badge). The caller composes the content — this component only
   * provides the baseline-aligned, wrapping container.
   */
  metadata?: ReactNode
  /**
   * Trailing action cluster. Reserved for route-wide actions (the
   * platform-wide UpdateDataButton, Print). Export/import/upload, table
   * search, filters, and other card-specific controls belong in the toolbar
   * of the card they control — never here.
   */
  actions?: ReactNode
  className?: string
}

/**
 * Fable page header — the universal baseline row every prototype screen opens
 * with: h1 at 19px/650 beside dot-separated muted metadata, wrapping as one
 * flex row. Replaces the pre-Fable `SectionHeader` as routes migrate.
 *
 * Purely presentational: no data fetching, no auth, no route strings — every
 * visible string is supplied by the caller from `i18n.ts`.
 */
export function PageHeader({ eyebrow, title, metadata, actions, className = '' }: PageHeaderProps) {
  return (
    <header className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-5 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <div className="ui-label text-muted-fg mb-1">{eyebrow}</div>}
        <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 min-w-0">
          <h1 className="ui-page-title text-foreground">{title}</h1>
          {metadata && (
            <div className="ui-meta text-muted-fg flex items-baseline flex-wrap gap-x-3 gap-y-1 min-w-0">
              {metadata}
            </div>
          )}
        </div>
      </div>
      {actions && (
        // min-w-0 — never a no-shrink cluster — so the actions wrap below the
        // title on narrow viewports instead of pushing the row past the edge.
        <div className="flex flex-wrap items-center gap-2 ml-auto min-w-0">{actions}</div>
      )}
    </header>
  )
}
