'use client'

// R13.6 — the Family Portfolio hierarchical snapshot table (doc 07 §§ 7.2, 9).
//
// Renders the published rows of ONE scope for ONE week: expand/collapse over
// the ingested parent/child tree, four dated value columns (Beginning of
// Year · Previous Week · This Week · Difference), and each scope's own
// terminal structure VERBATIM — rows arrive in the publication's display
// order with the source's own labels, and nothing here reshapes, reorders,
// regroups or renames them into a uniform layout.
//
// HONESTY RULES, ENFORCED HERE:
//   * a null value renders as `—`, never 0 (doc 02 § 9), and a value that IS
//     zero renders `-` (R13.R5C.2) — `MaskedAmount` owns both marks and this
//     component never coalesces, formats or dashes anything itself;
//   * `Difference` is DERIVED FROM THE TWO FIGURES DISPLAYED BESIDE IT —
//     `This Week − Previous Week`, through the shared `difference.ts`
//     invariant, so the arithmetic on screen is internally consistent by
//     construction. The publication's persisted figure is a cross-check only
//     and can never override it; a genuine disagreement is FLAGGED on the cell
//     rather than silently resolved. A row where either side was unavailable
//     shows `—`, never 0 and never the persisted figure standing in;
//   * a column whose source date is unknown is headed without a date — never
//     with one inferred from a neighbouring publication.
//
// PRIVACY: every monetary value is wrapped in `PrivacyValue` (doc 07 § 8 —
// this module is the most sensitive in the app). The mask state is owned by
// the page via `usePrivacyMode`.

import { Fragment, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { MaskedAmount } from './MaskedAmount'
import { resolveDisplayedDifference } from '@/lib/familyPortfolio/difference'
import { formatIsoDateLabel } from '@/lib/formatters'
import type { FamilyPortfolioSnapshotRow } from '@/lib/data/familyPortfolio'

interface HierarchicalTableProps {
  rows: FamilyPortfolioSnapshotRow[]
  dates: { beginningOfYear: string | null; previousWeek: string | null; thisWeek: string }
  masked: boolean
}

// `sticky` lives on each th — `position: sticky` on a <tr> does not stick.
// The solid `bg-surface` keeps scrolled rows from showing through the header.
const TH = 'py-2.5 px-3 first:pl-4 last:pr-4 ui-table-header text-muted-fg sticky top-0 bg-surface z-10'
const CELL = 'py-2 px-3 first:pl-4 last:pr-4'

/** Structural emphasis per ingested row type — tokens only, no hardcoded color. */
function rowClasses(rowType: string): string {
  switch (rowType) {
    case 'group_header':
    case 'sociedad_header':
      return 'bg-surface-2 font-medium'
    case 'portfolio_total':
      return 'font-semibold border-t-2 border-border-strong'
    case 'portfolio_subtotal':
    case 'sociedad_subtotal':
    case 'sociedad_total':
    case 'named_holding':
      return 'font-medium border-t border-border'
    default:
      return ''
  }
}

/**
 * One dated value cell.
 *
 * R13.R5C.2 — IT NOW RENDERS THROUGH `MaskedAmount`, the module's one guarded
 * renderer, instead of re-embedding the same chain in a `<td>`.
 *
 * This table was the last surface in the module formatting an amount for
 * itself, and being second meant it could disagree with the first — which is
 * exactly what happened: a row that did not move showed `-` on Weekly Changes
 * and `0` in the very same conceptual column here. R13.R5C.1 patched that with
 * a per-row "is this slot unoccupied" test; the owner's rule needs no test at
 * all, because every zero takes the mark. Deleting the duplicate is what makes
 * the rule true here by construction rather than by a second implementation
 * agreeing with the first.
 *
 * Byte-identical output for every non-zero value: `MaskedAmount`'s defaults are
 * this cell's former arguments (`decimals = 0`, unsigned), it wraps the same
 * `PrivacyValue`, and it returns the same `—` for an unavailable figure.
 */
function amountCell(value: number | null, masked: boolean, extra = '', warning?: string) {
  return (
    <td className={`${CELL} text-right ui-number whitespace-nowrap ${extra}`}>
      {/* A reconciliation anomaly is marked NEXT TO the figure, never by
          recolouring it: the Difference's own +/- colour carries a different
          meaning, and an ordinary negative week is not a warning state. The
          marker is a glyph plus screen-reader text plus a `title`, so the
          signal never rests on colour alone. */}
      {warning !== undefined && (
        <>
          <span aria-hidden className="mr-1" style={{ color: 'var(--warning)' }} title={warning}>
            ⚑
          </span>
          <span className="sr-only">{warning}</span>
        </>
      )}
      <MaskedAmount value={value} masked={masked} />
    </td>
  )
}

export function HierarchicalTable({ rows, dates, masked }: HierarchicalTableProps) {
  const { t, lang } = useLang()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  // The tree the parser ingested. A parent key that does not resolve (it
  // should not happen — the parser derives keys from the label path) degrades
  // to a root row rather than dropping the row.
  const present = new Set(rows.map((r) => r.rowKey))
  const childrenOf = new Map<string, FamilyPortfolioSnapshotRow[]>()
  const roots: FamilyPortfolioSnapshotRow[] = []
  for (const row of rows) {
    if (row.parentRowKey !== null && present.has(row.parentRowKey)) {
      const list = childrenOf.get(row.parentRowKey) ?? []
      list.push(row)
      childrenOf.set(row.parentRowKey, list)
    } else {
      roots.push(row)
    }
  }

  function toggle(rowKey: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }

  function renderRow(row: FamilyPortfolioSnapshotRow): React.ReactNode {
    const children = childrenOf.get(row.rowKey) ?? []
    const isCollapsed = collapsed.has(row.rowKey)
    const label = lang === 'es' ? row.labelEs : (row.labelEn ?? row.labelEs)
    // THE shared invariant: the Difference shown is the subtraction of the two
    // figures shown beside it, never the persisted cross-check figure. Today
    // the two always agree (every row of all 102 published weeks); when they
    // ever do not, the arithmetic is displayed and the row is flagged.
    const diff = resolveDisplayedDifference(row.value, row.previousValue, row.difference)
    const diffColor =
      diff.displayed === null ? '' : diff.displayed >= 0 ? 'text-positive' : 'text-negative'
    return (
      <Fragment key={row.rowKey}>
        <tr className={`border-b border-border ${rowClasses(row.rowType)}`}>
          <td className={`${CELL} text-left`}>
            <span
              className="flex items-center gap-1.5 min-w-0"
              style={{ paddingLeft: row.depth * 14 }}
            >
              {children.length > 0 ? (
                <button
                  type="button"
                  onClick={() => toggle(row.rowKey)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? t.fp.portfolio.expandRow : t.fp.portfolio.collapseRow} ${label}`}
                  className="shrink-0 w-4 h-4 inline-flex items-center justify-center rounded text-muted-fg hover:text-foreground nv-transition"
                >
                  <svg
                    viewBox="0 0 12 12"
                    className="w-2.5 h-2.5 nv-transition"
                    style={{ transform: isCollapsed ? 'rotate(-90deg)' : undefined }}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    aria-hidden="true"
                  >
                    <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <span className="shrink-0 w-4" aria-hidden="true" />
              )}
              <span className="truncate">{label}</span>
            </span>
          </td>
          {amountCell(row.beginningOfYearValue, masked)}
          {amountCell(row.previousValue, masked)}
          {amountCell(row.value, masked)}
          {amountCell(
            diff.displayed,
            masked,
            diffColor,
            diff.status === 'mismatch' ? t.fp.portfolio.differenceMismatch : undefined,
          )}
        </tr>
        {!isCollapsed && children.map((child) => renderRow(child))}
      </Fragment>
    )
  }

  const datedHeader = (title: string, date: string | null) => (
    <th className={`${TH} text-right`} scope="col">
      <span className="block">{title}</span>
      {/* No date recorded → no date shown. Never inferred. */}
      {date && (
        <span className="block ui-number font-normal normal-case tracking-normal">
          {formatIsoDateLabel(date)}
        </span>
      )}
    </th>
  )

  return (
    <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="border-b border-border-strong">
          <th className={`${TH} text-left`} scope="col">
            <span className="block">{t.fp.portfolio.colHierarchy}</span>
            <span className="block ui-meta font-normal normal-case tracking-normal">
              {t.fp.portfolio.valuesInUsd}
            </span>
          </th>
          {datedHeader(t.fp.portfolio.colBoY, dates.beginningOfYear)}
          {datedHeader(t.fp.portfolio.colPrev, dates.previousWeek)}
          {datedHeader(t.fp.portfolio.colThis, dates.thisWeek)}
          <th className={`${TH} text-right`} scope="col">
            {t.fp.portfolio.colDiff}
          </th>
        </tr>
      </thead>
      <tbody>{roots.map((row) => renderRow(row))}</tbody>
    </table>
  )
}
