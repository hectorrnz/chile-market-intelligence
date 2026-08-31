'use client'

// R13.R4A — Alternatives · HOLDINGS.
//
// The full book at its true grain — one row per (investment × sociedad) — banded
// by `(category, currency)` with a per-band subtotal, exactly as doc 03 § 2.1
// requires. Category alone is ambiguous in this source (`Real Assets` appears in
// three currencies), so the band carries both.
//
// NO GRAND TOTAL EXISTS, and none can be assembled from what this page renders:
// each subtotal is a same-currency sum, and there is no row beneath them. The
// source's own USD roll-up is `#NAME?` and NMI has no approved FX basis
// (decision D4).
//
// SUBTOTALS DISCLOSE PARTIALITY. A column with no value in the whole band stays
// unavailable rather than 0; a band summing only some of its rows carries the
// `*` marker and its note. Unavailable is never zero (doc 02 § 9).
//
// BOTH IRRs ARE CACHED SOURCE VALUES (doc 03 § 4.1) — `TIR Informada` is
// externally reported and `TIR Calculada` is Excel's own iterative solve over
// the event timeline. NMI re-runs neither, and the footer says so. On the real
// workbook they are sparse (9 and 27 of 43 rows), so most cells honestly show
// an em dash.
//
// PRIVACY: every monetary value renders through `MaskedAmount`. IRRs are
// percentages and follow the app-wide percentage policy.

import { useMemo } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { TableCard } from '@/components/fable/TableCard'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { useAlternatives } from '@/components/familyPortfolio/AlternativesProvider'
import { AlternativesFilters } from '@/components/familyPortfolio/AlternativesFilters'
import {
  applyHoldingFilter,
  currencyLabel,
  filterOptions,
  groupHoldings,
  statementAge,
  type AlternativesGroup,
  type AlternativesHoldingRead,
} from '@/lib/familyPortfolio/alternativesView'
import { formatIsoDateLabel, formatWeightPct } from '@/lib/formatters'
import type { Translation } from '@/lib/i18n'

type AltT = Translation['fp']['alternatives']

// Alignment is stated once per column, so two alignment utilities never ride
// the same element (their winner would be CSS source order, not string order).
const TH = 'py-2.5 px-3 first:pl-4 last:pr-4 ui-table-header text-muted-fg sticky top-0 bg-surface z-10'
const CELL = 'py-2 px-3 first:pl-4 last:pr-4'

// R13.R4A.1 owner review ("dizzying") — one hairline opens each numeric field
// group: commitment lifecycle (Committed · Contributions · Unfunded), the
// valuation basis (Last statement → Current value), and the two cached IRRs.
// The eleven columns then read as identity + three fields rather than a wall
// of nine equal figures. Same divider token the Dashboard's card regions use.
const GROUP_EDGE = { borderLeft: '1px solid var(--nv-line)' } as const

/**
 * The statement date plus its FACTUAL age in whole months, measured against the
 * Alternatives publication's own as-of — never the viewer's clock, so a
 * published revision renders identically whenever it is opened. Deliberately no
 * "stale" verdict: the contract asks for a staleness indicator but authorizes no
 * threshold, and a normative label would be invented policy. A row carrying the
 * literal `Inversión Inicial` shows that label verbatim with no fabricated age.
 */
function StatementCell({
  holding,
  asOfDate,
  t,
}: {
  holding: AlternativesHoldingRead
  asOfDate: string | null
  t: AltT
}) {
  if (holding.lastStatementDate === null) {
    return <span className="text-muted-fg">{holding.lastStatementLabel ?? '—'}</span>
  }
  const age = statementAge(holding.lastStatementDate, asOfDate)
  return (
    <span className="whitespace-nowrap">
      <span className="ui-number">{formatIsoDateLabel(holding.lastStatementDate)}</span>
      {age !== null && (
        <span className="text-muted-fg" title={t.ageTitle}>
          {' '}
          · {age.months} {t.monthsAbbrev}
        </span>
      )}
    </span>
  )
}

function GroupRows({
  group,
  asOfDate,
  masked,
  t,
}: {
  group: AlternativesGroup
  asOfDate: string | null
  masked: boolean
  t: AltT
}) {
  const s = group.subtotal
  const partial =
    s.capitalCommitted.missing + s.contributions.missing + s.unfunded.missing + s.currentValue.missing > 0
  return (
    <>
      {/* R13.R4A.3 — THE CATEGORY IS THE TABLE'S PRIMARY STRUCTURE, so it now
          carries the primary emphasis. It opened at the same 13px as the rows
          it introduced while the subtotal that CLOSED the band sat a step
          larger and semibold — so the eye landed on each band's last line
          instead of its first, and the reader met the figures before learning
          what they were of. The band label steps up to the card-value scale;
          the subtotal steps back to row size (below). Its qualifiers — the
          currency and the holding count — stay muted and at meta scale, so
          what grew is the name, not the whole line. The opener carries a
          half-step more vertical air than CELL's data rows — the 15px label
          needs it — written as literal paddings because stacking a second
          py- utility onto CELL would resolve by CSS order, not string order. */}
      <tr className="bg-surface-2">
        <td
          colSpan={11}
          className="py-2.5 pl-4 pr-4 text-left"
          style={{ borderLeft: '3px solid var(--accent)' }}
        >
          <span className="ui-card-value text-foreground">{group.category}</span>
          <span className="ui-meta text-muted-fg">
            {' '}
            · {currencyLabel(group.currency)} · {group.holdings.length} {t.holdingsWord}
          </span>
        </td>
      </tr>
      {/* Row hierarchy (R13.R4A.1): the investment leads, the sociedad and the
          superseded last valuation fall back to the muted tone, and the row's
          conclusion — Current value — keeps its medium weight. Same figures,
          calmer scan. */}
      {group.holdings.map((h) => (
        <tr key={h.id} className="border-b border-border">
          <td className={`${CELL} text-left`}>
            <span className="block truncate max-w-[16rem]" title={h.investmentName}>
              {h.investmentName}
            </span>
          </td>
          <td className={`${CELL} text-left whitespace-nowrap text-muted-fg`}>{h.sociedad}</td>
          <td className={`${CELL} text-center ui-number whitespace-nowrap`} style={GROUP_EDGE}>
            <MaskedAmount value={h.capitalCommitted} masked={masked} />
          </td>
          <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
            <MaskedAmount value={h.contributions} masked={masked} />
          </td>
          <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
            <MaskedAmount value={h.unfunded} masked={masked} />
          </td>
          <td className={`${CELL} text-center`} style={GROUP_EDGE}>
            <StatementCell holding={h} asOfDate={asOfDate} t={t} />
          </td>
          <td className={`${CELL} text-center ui-number whitespace-nowrap text-muted-fg`}>
            <MaskedAmount value={h.lastValuation} masked={masked} />
          </td>
          <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
            <MaskedAmount value={h.flowSinceStatement} masked={masked} signed />
          </td>
          <td className={`${CELL} text-center ui-number whitespace-nowrap font-medium`}>
            <MaskedAmount value={h.currentValue} masked={masked} />
          </td>
          <td className={`${CELL} text-center ui-number whitespace-nowrap`} style={GROUP_EDGE}>
            {formatWeightPct(h.reportedIrr)}
          </td>
          <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
            {formatWeightPct(h.calculatedIrr)}
          </td>
        </tr>
      ))}
      {/* The band's own subtotal. R13.R4A.4 (owner direction): the CATEGORY
          opener is the only row type that reads as highlighted, so the
          subtotal sheds the tinted band and the 3px accent spine it used to
          share with it — two rows wearing the same dress made the band open
          and close on the same visual note, and the eye could not tell the
          headline from the conclusion. What remains is restrained STRUCTURE:
          row-scale text at medium weight, fenced by two strong rules — the
          accounting-total convention, and a treatment that survives dark mode
          because `--border-strong` is the same theme-aware token every section
          divider already relies on. Both rules are 2px because the table
          border-collapses: a 1px top rule would lose the collapse contest to
          the preceding row's own 1px hairline (equal widths resolve to the
          upper row) and silently vanish — the wider rule always wins. On the
          page's LAST band the bottom rule doubles as the table's closing rule,
          which is exactly what a final subtotal should end on. */}
      <tr className="font-medium border-t-2 border-b-2 border-border-strong">
        <td colSpan={2} className={`${CELL} text-left`}>
          {t.subtotal}
          <span className="text-muted-fg"> · {currencyLabel(group.currency)}</span>
          {partial && (
            <span className="text-warning" title={t.subtotalPartialNote}>
              {' '}
              *
            </span>
          )}
        </td>
        <td className={`${CELL} text-center ui-number whitespace-nowrap`} style={GROUP_EDGE}>
          <MaskedAmount value={s.capitalCommitted.value} masked={masked} />
        </td>
        <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
          <MaskedAmount value={s.contributions.value} masked={masked} />
        </td>
        <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
          <MaskedAmount value={s.unfunded.value} masked={masked} />
        </td>
        <td colSpan={3} className={CELL} style={GROUP_EDGE} />
        <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
          <MaskedAmount value={s.currentValue.value} masked={masked} />
        </td>
        <td colSpan={2} className={CELL} style={GROUP_EDGE} />
      </tr>
    </>
  )
}

export default function AlternativesHoldingsPage() {
  const { t } = useLang()
  const a = t.fp.alternatives
  const [masked] = usePrivacyMode()
  const { data, filter, setFilter } = useAlternatives()

  const holdings = useMemo(() => data?.holdings ?? [], [data])
  const events = useMemo(() => data?.events ?? [], [data])
  const options = useMemo(() => filterOptions(holdings, events), [holdings, events])

  // R13.R4A.5 — the three dimensions that narrow HOLDINGS, each a set whose
  // empty state means unrestricted. Event type and year are deliberately
  // absent: they narrow EVENTS, and a year with no recorded movement is not a
  // position that stopped existing.
  const filterActive =
    filter.sociedad.length > 0 || filter.category.length > 0 || filter.currency.length > 0

  // Unfiltered → the server's own groups, so parity holds by construction.
  // Filtered → the SAME pure function over the narrowed set.
  const visibleGroups = useMemo(() => {
    if (!filterActive) return data?.groups ?? []
    return groupHoldings(applyHoldingFilter(holdings, filter))
  }, [data, filterActive, holdings, filter])

  const asOfDate = data?.publication?.asOfDate ?? null
  const publishedAt = data?.publication?.publishedAt ?? null

  return (
    <div className="flex flex-col gap-5">
      <AlternativesFilters options={options} filter={filter} onChange={setFilter} />

      <TableCard
        title={a.holdingsTitle}
        minWidth={1080}
        // The full book runs ~50 rows with bands; capping the card gives it
        // the same internal vertical scroll as the weekly full-changes table
        // and makes the sticky column header actually engage.
        maxHeight={640}
        footer={
          // The widest table in the module; `.nv-notes` keeps the notes stacked
          // at one left origin at a readable measure instead of a narrow column.
          <div className="nv-notes">
            <TableSourceFooter source={a.source} asOf={publishedAt} />
            <p className="ui-meta text-muted-fg">{a.noCrossCurrencyNote}</p>
            <p className="ui-meta text-muted-fg">{a.irrSourceNote}</p>
          </div>
        }
      >
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="border-b border-border-strong">
              <th className={`${TH} text-left`} scope="col">{a.colInvestment}</th>
              <th className={`${TH} text-left`} scope="col">{a.colSociedad}</th>
              <th className={`${TH} text-center`} scope="col" style={GROUP_EDGE}>{a.colCommitted}</th>
              <th className={`${TH} text-center`} scope="col">{a.colContributions}</th>
              <th className={`${TH} text-center`} scope="col">{a.colUnfunded}</th>
              <th className={`${TH} text-center`} scope="col" style={GROUP_EDGE}>{a.colLastStatement}</th>
              <th className={`${TH} text-center`} scope="col">{a.colLastValuation}</th>
              <th className={`${TH} text-center`} scope="col">{a.colFlowSince}</th>
              <th className={`${TH} text-center`} scope="col">{a.colCurrentValue}</th>
              <th className={`${TH} text-center`} scope="col" style={GROUP_EDGE}>{a.colReportedIrr}</th>
              <th className={`${TH} text-center`} scope="col">{a.colCalculatedIrr}</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((g) => (
              <GroupRows
                key={`${g.category}·${g.currency}`}
                group={g}
                asOfDate={asOfDate}
                masked={masked}
                t={a}
              />
            ))}
          </tbody>
        </table>
        {visibleGroups.length === 0 && (
          <p className="text-xs text-muted-fg py-6 text-center">{a.timelineEmpty}</p>
        )}
      </TableCard>
    </div>
  )
}
