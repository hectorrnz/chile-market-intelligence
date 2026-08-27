'use client'

// R13.R3C — the in-page contribution breakdown.
//
// PRESENTATION ONLY. Every figure comes from `buildContributionSet` over
// `contributionChildren`, the same pair the chart itself uses, so a bar and the
// popup that explains it can never disagree.
//
// ── THE INVARIANT THIS SURFACE EXISTS TO SHOW ─────────────────────────────
//
//   Σ displayed components (+ the explicit residual, when one is required)
//   = the clicked component's own value change
//
// Nothing is ever dropped to make that true. When the components do not
// account for the parent, a RESIDUAL row appears and says so; when even one
// component has no published figure, the sum is declared indeterminate rather
// than shown short. The most common honest cause of a residual is disclosed
// directly: components that were not published at the opening date, whose
// opening value R13.R1.1 § 14 reads as an economic zero.
//
// ── DEPTH STAYS IN THE MODAL ──────────────────────────────────────────────
//
// A component with a decomposition of its own expands in place, indented,
// rather than replacing the view or navigating. The reader keeps the parent —
// and the reconciliation they came to check — on screen the whole way down.
// A component with nothing beneath it gets no affordance at all: a chevron
// that opens an empty list is a promise the source cannot keep.

import { useMemo, useState } from 'react'
import type { ChangeNode } from '@/lib/familyPortfolio/weeklyChanges'
import { contributionChildren } from '@/lib/familyPortfolio/weeklyChanges'
import { buildContributionSet, type ContributionItem } from '@/lib/familyPortfolio/contributionChart'
import { useLang } from '@/components/providers/LangProvider'
import { ModalShell } from '@/components/fable/ModalShell'
import { MaskedAmount } from './MaskedAmount'
import { formatRatioPct } from '@/lib/formatters'
import { contributionSwatchStyle } from './ContributionChart'
import {
  contributionLabel,
  omittedZeroSentence,
  type ContributionLabelOverrides,
} from '@/lib/familyPortfolio/contributionLabels'

/** Depth guard: the published hierarchy is three or four deep; this can never run away. */
const MAX_EXPAND_DEPTH = 6
/** One indent step in px. Wide enough that a level reads as a level at a
 *  glance; at the depth guard's maximum it still uses barely an eighth of the
 *  `lg` modal's width. */
const INDENT_PX = 18

interface ContributionBreakdownModalProps {
  open: boolean
  onClose: () => void
  nodes: readonly ChangeNode[]
  /** The clicked component. Null closes the modal. */
  rowKey: string | null
  masked: boolean
  /** Already-formatted period and endpoints, e.g. "3M · 30-04-2026 → 31-07-2026". */
  periodLabel: string
  residualLabel: { es: string; en: string }
  /** Display names for sociedad-grain rows; see `ContributionLabelOverrides`. */
  labelOverrides?: ContributionLabelOverrides
}

export function ContributionBreakdownModal({
  open,
  onClose,
  nodes,
  rowKey,
  masked,
  periodLabel,
  residualLabel,
  labelOverrides,
}: ContributionBreakdownModalProps) {
  const { t, lang } = useLang()
  const c = t.fp.contrib
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Render-time previous-value reset — never an effect. A new subject must not
  // inherit the previous one's open branches.
  const [prevKey, setPrevKey] = useState(rowKey)
  if (rowKey !== prevKey) {
    setPrevKey(rowKey)
    setExpanded(new Set())
  }

  const parent = useMemo(
    () => (rowKey === null ? null : (nodes.find((n) => n.rowKey === rowKey) ?? null)),
    [nodes, rowKey],
  )

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <ModalShell
      open={open && parent !== null}
      onClose={onClose}
      size="lg"
      dense
      title={parent !== null ? contributionLabel(parent, lang, labelOverrides) : ''}
      description={periodLabel}
    >
      {parent !== null && (
        <div className="flex flex-col gap-3">
          {/* The figure every row below must add up to. */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="ui-label text-muted-fg">{c.parentContribution}</span>
            <MaskedAmount
              value={parent.weeklyValueChange}
              masked={masked}
              signed
              zeroDash
              className={`ui-number ui-card-value ${
                (parent.weeklyValueChange ?? 0) < 0 ? 'text-negative' : 'text-positive'
              }`}
            />
          </div>

          <BreakdownLevel
            nodes={nodes}
            parentRowKey={parent.rowKey}
            masked={masked}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            residualLabel={residualLabel}
            labelOverrides={labelOverrides}
          />
        </div>
      )}
    </ModalShell>
  )
}

interface BreakdownLevelProps {
  nodes: readonly ChangeNode[]
  parentRowKey: string
  masked: boolean
  depth: number
  expanded: Set<string>
  onToggle: (key: string) => void
  residualLabel: { es: string; en: string }
  labelOverrides?: ContributionLabelOverrides
}

function BreakdownLevel({
  nodes,
  parentRowKey,
  masked,
  depth,
  expanded,
  onToggle,
  residualLabel,
  labelOverrides,
}: BreakdownLevelProps) {
  const { t, lang } = useLang()
  const c = t.fp.contrib

  const set = useMemo(() => {
    const parent = nodes.find((n) => n.rowKey === parentRowKey) ?? null
    if (parent === null) return null
    return buildContributionSet({
      openingValue: parent.previousValue,
      closingValue: parent.currentValue,
      components: contributionChildren(nodes, parentRowKey),
      isDrillable: (key) => contributionChildren(nodes, key).length > 0,
      residualLabel,
    })
  }, [nodes, parentRowKey, residualLabel])

  if (set === null) return null

  if (set.items.length === 0 && set.unavailable.length === 0) {
    return <p className="ui-meta text-muted-fg py-2">{c.noDecomposition}</p>
  }

  const omittedNote = omittedZeroSentence(set.omittedZero, lang, {
    template: c.zeroOmittedNames,
    more: c.zeroOmittedMore,
  })

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col" role="list">
        {set.items.map((item) => (
          <BreakdownRow
            key={item.rowKey ?? 'residual'}
            item={item}
            nodes={nodes}
            masked={masked}
            depth={depth}
            expanded={expanded}
            onToggle={onToggle}
            residualLabel={residualLabel}
            labelOverrides={labelOverrides}
          />
        ))}
        {/* Withheld components are listed, never silently absent. The two
            leading spacers mirror the chevron slot and dot of a value row, so
            every label in the list shares one left origin per depth. */}
        {set.unavailable.map((u) => (
          <li
            key={u.rowKey}
            className="flex items-center justify-between gap-3 py-1.5 text-xs"
            style={{ paddingLeft: depth * INDENT_PX, borderTop: '1px solid var(--nv-line)' }}
          >
            <span className="min-w-0 flex items-center gap-1.5">
              <span className="w-3 shrink-0" aria-hidden="true" />
              <span className="w-1.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate text-muted-fg" title={contributionLabel(u, lang, labelOverrides)}>
                {contributionLabel(u, lang, labelOverrides)}
              </span>
            </span>
            <span className="shrink-0 ui-meta text-muted-fg">{c.componentUnavailable}</span>
          </li>
        ))}
      </ul>

      {/* Reconciliation, stated in words because a bar chart of changes has no
          closing column whose landing point could state it geometrically. The
          extra top space sets the verdict apart from the row rhythm above. */}
      {depth === 0 && (
        <div className="nv-notes pt-2.5 mt-3" style={{ borderTop: '1px solid var(--nv-line)' }}>
          <p className="ui-meta text-muted-fg">
            {set.unavailable.length > 0
              ? c.reconcileIndeterminate
              : set.status === 'complete'
                ? c.reconcileExact
                : c.reconcileResidual}
          </p>
          {set.newPositionCount > 0 && (
            <p className="ui-meta text-muted-fg">
              {c.newPositionsNote.replace('{n}', String(set.newPositionCount))}
            </p>
          )}
          {/* Named, never counted: an entity that did not move is a finding. */}
          {omittedNote !== null && <p className="ui-meta text-muted-fg">{omittedNote}</p>}
        </div>
      )}
    </div>
  )
}

interface BreakdownRowProps {
  item: ContributionItem
  nodes: readonly ChangeNode[]
  masked: boolean
  depth: number
  expanded: Set<string>
  onToggle: (key: string) => void
  residualLabel: { es: string; en: string }
  labelOverrides?: ContributionLabelOverrides
}

function BreakdownRow({
  item,
  nodes,
  masked,
  depth,
  expanded,
  onToggle,
  residualLabel,
  labelOverrides,
}: BreakdownRowProps) {
  const { t, lang } = useLang()
  const c = t.fp.contrib
  const label = contributionLabel(item, lang, labelOverrides)
  const canExpand = item.drillable && item.rowKey !== null && depth < MAX_EXPAND_DEPTH
  const isOpen = item.rowKey !== null && expanded.has(item.rowKey)

  return (
    <li style={{ borderTop: '1px solid var(--nv-line)' }}>
      <div
        className="flex items-center gap-3 py-1.5 text-xs"
        style={{ paddingLeft: depth * INDENT_PX }}
      >
        <span className="min-w-0 flex-1 flex items-center gap-1.5">
          {/* Tree order: disclosure chevron at the indent edge, then the
              swatch, then the label — a row that cannot expand carries a
              spacer in the chevron slot so labels align per depth. */}
          {canExpand ? (
            <button
              type="button"
              onClick={() => onToggle(item.rowKey as string)}
              aria-expanded={isOpen}
              className="min-w-0 inline-flex items-center gap-1.5 text-left text-foreground hover:text-accent nv-transition"
              title={label}
            >
              <svg
                viewBox="0 0 12 12"
                className="w-3 h-3 shrink-0 text-muted-fg nv-transition"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M4.5 2.5 8 6l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={contributionSwatchStyle(item)}
                aria-hidden="true"
              />
              <span className="truncate">{label}</span>
            </button>
          ) : (
            <>
              <span className="w-3 shrink-0" aria-hidden="true" />
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={contributionSwatchStyle(item)}
                aria-hidden="true"
              />
              <span className="truncate text-foreground" title={label}>
                {label}
              </span>
            </>
          )}
          {/* The valueless label the source files this component under. Shown
              as context, never as a row of its own with an invented subtotal.
              It may truncate, but never squeeze the component's own label out. */}
          {item.groupPath.length > 0 && (
            <span className="min-w-0 max-w-[45%] ui-meta text-muted-fg truncate">
              · {item.groupPath.join(' · ')}
            </span>
          )}
        </span>

        <span className="shrink-0 w-24 text-right">
          <MaskedAmount
            value={item.value}
            masked={masked}
            signed
            zeroDash
            className={`ui-number ${item.value < 0 ? 'text-negative' : 'text-positive'}`}
          />
        </span>
        <span className="shrink-0 w-16 text-right ui-number ui-meta text-muted-fg">
          {item.shareOfNet !== null ? formatRatioPct(item.shareOfNet) : c.shareUnavailable}
        </span>
      </div>

      {isOpen && item.rowKey !== null && (
        <BreakdownLevel
          nodes={nodes}
          parentRowKey={item.rowKey}
          masked={masked}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          residualLabel={residualLabel}
          labelOverrides={labelOverrides}
        />
      )}
    </li>
  )
}
