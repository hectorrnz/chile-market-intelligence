'use client'

import type { ReactNode } from 'react'
import { GlassSurface } from './GlassSurface'
import { AsyncState, type AsyncStateKind } from './AsyncState'

interface TableCardProps {
  title?: string
  /** Toolbar-style controls (search, filters, a source badge, Export CSV, Update). */
  controls?: ReactNode
  /** When set, renders the matching async state INSTEAD of `children` — never both at once. */
  state?: AsyncStateKind
  stateMessage?: string
  stateSource?: string
  stateAsOf?: string
  /** Minimum width for the inner scrollable table (matches this app's existing `min-w-[…px]` convention) so the scroll stays card-level, never page-level. */
  minWidth?: number
  /**
   * Optional vertical-scroll mode: caps the table region at this height and
   * scrolls it internally. `sticky top-0` headers inside the table stick to
   * THIS container — without a height cap the scroll container never scrolls
   * vertically and sticky headers are inert. Omitted → behavior unchanged.
   */
  maxHeight?: number | string
  /** Exactly one `<TableSourceFooter>` (or equivalent) belongs here — this component never supplies its own source text. */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Analytical table container: a near-opaque surface (design_principles §8 —
 * dense financial data never sits on low-opacity glass) wrapping an optional
 * title/controls header, card-level horizontal scroll, and one designated
 * footer slot. Purely a layout shell — it never touches the table's own
 * data, columns, or rows, and never embeds a sample table.
 */
export function TableCard({ title, controls, state, stateMessage, stateSource, stateAsOf, minWidth, maxHeight, footer, children, className = '' }: TableCardProps) {
  return (
    <GlassSurface variant="card" className={`overflow-hidden flex flex-col ${className}`}>
      {(title || controls) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
          {title && <h2 className="ui-label text-muted-fg">{title}</h2>}
          {controls && <div className="flex items-center gap-2 flex-wrap ml-auto">{controls}</div>}
        </div>
      )}

      <GlassSurface variant="dense">
        {state ? (
          <AsyncState kind={state} message={stateMessage} source={stateSource} asOf={stateAsOf} />
        ) : (
          <div
            className="overflow-x-auto"
            // Both scroll axes must live on ONE container: sticky headers
            // stick relative to their nearest scroll ancestor, so splitting
            // vertical scroll onto a different element would detach them.
            style={maxHeight != null ? { maxHeight, overflowY: 'auto' } : undefined}
          >
            <div style={minWidth ? { minWidth } : undefined}>{children}</div>
          </div>
        )}
      </GlassSurface>

      {footer && <div className="px-4 py-2.5">{footer}</div>}
    </GlassSurface>
  )
}
