'use client'

// R13.R2 §§ 11-12 — the Weekly Snapshot (Beginning of Year · Previous Week ·
// This Week · Difference).
//
// FRAMELESS by design (second pass): the Summary composes this INSIDE a
// shared analytical row — Main's Snapshot | Allocation | Notes (the narrow
// first column of that 3 : 5 : 4 row) or, since R13.R2F3, a personal scope's
// Performance | Snapshot | Allocation (the narrow MIDDLE column of that
// 4 : 3 : 5 row) — because four ledger lines need little width regardless of
// which side of it the row puts its neighbours, split from its neighbours by
// a hairline rule on each side. This component renders a plain `<section>`
// with its own internal padding and no card chrome of its own. It is used
// nowhere else.
//
// Deliberately NOT an Excel-looking grid: no bordered cells, no column
// chrome — a compact definition list with hairline rules between rows, a
// muted label + the publication's own column date on the left, and the
// amount right-aligned in tabular numerals. Hierarchy is typographic:
// context rows (BoY, Previous Week) are quiet; the last non-difference row —
// This Week, the anchor figure — is the largest value on the card (the Fable
// capsule-value scale — the page's AUM hero alone sits above it); the
// Difference row carries the signed emphasis and a slightly stronger rule
// above it — the ledger's totals rule — closing the list as the arithmetic
// it is: This Week − Previous Week = Difference. Row spacing is deliberately
// tight (owner review § 4): four short ledger lines, not a tall card.
//
// The anchor is derived structurally (the last row that is not a
// difference), not from a hardcoded key, so the card never guesses at the
// caller's row vocabulary.
//
// Every amount renders through `MaskedAmount` — the one guarded render path
// for portfolio amounts (privacy, unavailable-as-em-dash, signed prefix).
// This card formats nothing itself.

import { MaskedAmount } from './MaskedAmount'

export interface SnapshotRow {
  key: string
  label: string
  /** The publication's own column date, already formatted, or null. */
  dateLabel: string | null
  value: number | null
  /** The Difference row — signed, and the visual emphasis of the card. */
  isDifference?: boolean
  /**
   * A reconciliation anomaly on this row, already worded by the caller. Present
   * ONLY when the derived arithmetic disagrees with the publication's persisted
   * figure — a reconciled row carries nothing, so the card never accumulates
   * warning clutter. The figure shown is always the arithmetic either way.
   */
  warning?: string
}

export interface WeeklySnapshotCardProps {
  title: string
  /**
   * OWNER REVIEW PASS 2 § 5 — WHICH PORTFOLIO these four figures describe,
   * stated rather than left to be inferred. Resolved by the page from the row
   * the parser numerically bound to the scope's performance basis; this card
   * never guesses it.
   */
  basisLabel?: string | null
  /** The subordinate clarifier, e.g. "Includes Chilean equities". Main only. */
  basisDetail?: string | null
  rows: SnapshotRow[]
  masked: boolean
  /**
   * § 6 — the MANDATORY flow disclosure, worded by the page (which alone knows
   * whether the identity's two terms are published for the basis on screen).
   * Rendered under the ledger, visible without hover, subordinate to the
   * figures.
   */
  footnote?: React.ReactNode
}

export function WeeklySnapshotCard({
  title,
  basisLabel = null,
  basisDetail = null,
  rows,
  masked,
  footnote,
}: WeeklySnapshotCardProps) {
  // The anchor figure: the most recent snapshot line = the last row that is
  // not the derived Difference.
  const anchorIdx = rows.reduce((acc, r, i) => (r.isDifference ? acc : i), -1)

  return (
    // R13.R2F1 § B — `flex-1` so this section GROWS to fill the shared row's
    // full measured height (the analytical row stretches its columns by
    // default; a personal scope's short four-line ledger otherwise left a
    // trailing block of dead space under the taller Allocation column, with
    // nowhere for the footnote below to anchor). Paired with `mt-auto` on the
    // footnote — the SAME technique `AllocationPanel`'s own footer already
    // uses to pin its provenance to the shared card's bottom edge — so both
    // columns close on the same rhythm: figures at the top, a footer note at
    // the bottom, whichever column is taller. The ledger's own row rhythm is
    // untouched (deliberately tight, per owner review).
    <section className="flex-1 flex flex-col min-w-0 px-5 sm:px-6 pt-4">
      <h2 className="ui-label text-muted-fg">
        {title}
        {basisLabel && (
          <>
            <span aria-hidden="true"> · </span>
            <span className="text-foreground">{basisLabel}</span>
          </>
        )}
      </h2>
      {basisDetail && <p className="ui-meta text-muted-fg mt-0.5">{basisDetail}</p>}
      {/* R13.R2F § 6 — THE LEDGER KEEPS ITS MEASURE. Below xl the analytical
          row stacks and this column becomes as wide as the page; without a cap
          the label and its amount drift to opposite edges and stop reading as
          one line. The cap is released at xl, where the column is already the
          narrow one of the three. */}
      <dl className="flex flex-col mt-1.5 max-w-[32rem] xl:max-w-none">
        {rows.map((row, i) => {
          const anchor = i === anchorIdx
          const diff = row.isDifference === true
          // Sign colour on a signed change figure in text — the standing app
          // convention (see DivergingBarChart), applied to Difference only.
          const diffColor =
            row.value !== null && Number.isFinite(row.value)
              ? row.value > 0
                ? 'text-positive'
                : row.value < 0
                  ? 'text-negative'
                  : 'text-muted-fg'
              : ''
          return (
            <div
              key={row.key}
              className="flex items-baseline justify-between gap-3 py-2"
              // Hairline rules, not a bordered grid; the Difference row gets
              // the one slightly stronger rule so the derived figure reads as
              // the list's closing line.
              style={
                i > 0
                  ? { borderTop: `1px solid ${diff ? 'var(--border-strong)' : 'var(--nv-line)'}` }
                  : undefined
              }
            >
              <dt className="flex flex-col min-w-0">
                <span className={`text-xs ${anchor || diff ? 'font-medium text-foreground' : 'text-muted-fg'}`}>
                  {row.label}
                </span>
                {row.dateLabel && <span className="ui-meta ui-number text-muted-fg">{row.dateLabel}</span>}
                {/* A reconciliation anomaly, in the module's established
                    warning language: dot + WORDS, so the state never rests on
                    colour. Absent on a reconciled row — the anomaly is the
                    only thing that warrants a marker, not the sign of an
                    ordinary weekly movement. */}
                {row.warning !== undefined && (
                  <span className="ui-meta flex items-start gap-1.5 mt-0.5" style={{ color: 'var(--warning)' }}>
                    <span
                      aria-hidden
                      className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
                      style={{ backgroundColor: 'var(--warning)' }}
                    />
                    <span>{row.warning}</span>
                  </span>
                )}
              </dt>
              <dd className="text-right whitespace-nowrap">
                <MaskedAmount
                  value={row.value}
                  masked={masked}
                  signed={diff}
                  className={
                    anchor
                      ? 'ui-number ui-capsule-value text-foreground'
                      : diff
                        ? `ui-number text-base font-semibold ${diffColor}`
                        : 'ui-number text-sm text-foreground'
                  }
                />
              </dd>
            </div>
          )
        })}
      </dl>
      {footnote !== undefined && footnote !== null && (
        // R13.R2F5 — the fixed `max-w-[52ch]` is replaced by the shared
        // `.nv-notes` band (globals.css): this column is already bounded by
        // the analytical row's own width, so a hand-picked character cap was
        // redundant with it and, when the footnote carries more than one
        // note, prevented them packing side by side the way every other
        // note group in the tab now does.
        <div className="nv-notes mt-auto pt-2.5 pb-1">{footnote}</div>
      )}
    </section>
  )
}
