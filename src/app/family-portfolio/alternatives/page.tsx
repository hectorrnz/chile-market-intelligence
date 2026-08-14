'use client'

// R13.9 — `/family-portfolio/alternatives` — the shared Alternatives
// experience (doc 07 § 7.4, doc 08 Stage 9).
//
// PAGE ORDER, PER THE CONTRACT: investment summary grouped by
// `(category, currency)` — never a blended cross-currency total — with
// commitment/contributions/unfunded, valuation with `Fecha último statement`
// and a staleness indicator, and both IRRs labelled source-provided; then the
// event-history timeline with the semantic legend; filters by sociedad,
// category, currency and event type; unclassified events surfaced as an
// explicit, actionable state; and the module's OWN as-of stamp, independent of
// the portfolio's (doc 03 § 1).
//
// EVERY FINANCIAL DERIVATION IS THE PURE MODULE'S. The server computed the
// unfiltered groups with `alternativesView.ts`; this page re-runs the SAME
// functions only to narrow by filter, so the two views cannot disagree.
// Nothing here classifies an event, sums across currencies, or converts FX.
//
// PRIVACY: every monetary value renders through `MaskedAmount` (this module is
// the most sensitive in the app). IRRs are percentages, not amounts, and
// follow the app's established percentage policy (visible, like every other
// return figure). Masked amounts leave no raw value in the DOM.

import { useEffect, useId, useMemo, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { TableCard } from '@/components/fable/TableCard'
import { PrivacyToggle } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { EmptyState } from '@/components/ui/EmptyState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { EventTimeline, eventTypeLabel } from '@/components/familyPortfolio/EventTimeline'
import {
  altEventChipStyle,
  altEventColorVar,
  ALT_EVENT_TYPES,
} from '@/lib/familyPortfolio/alternatives/eventPresentation'
import {
  applyEventFilter,
  applyHoldingFilter,
  buildTimeline,
  currencyLabel,
  filterOptions,
  groupHoldings,
  statementAge,
  summarizeEvents,
  EMPTY_FILTER,
  type AlternativesFilter,
  type AlternativesGroup,
  type AlternativesHoldingRead,
} from '@/lib/familyPortfolio/alternativesView'
import { formatIsoDateLabel, formatWeightPct } from '@/lib/formatters'
import type { Translation } from '@/lib/i18n'
import {
  fetchFamilyPortfolioAlternatives,
  type FamilyPortfolioAlternativesResponse,
} from '@/lib/data/familyPortfolio'

type FetchOutcome = 'loading' | 'ready' | 'denied' | 'error'

// No default alignment on TH — left/right is stated explicitly per column, so
// two alignment utilities never ride the same element (their winner would be
// CSS source order, not string order).
const TH = 'py-2.5 px-3 first:pl-4 last:pr-4 ui-table-header text-muted-fg sticky top-0 bg-surface z-10'
const CELL = 'py-2 px-3 first:pl-4 last:pr-4'

// ---------------------------------------------------------------------------
// Filter select — the WeekSelector's native-select pattern (doc 07 § 9's
// reasoning: the platform control already has the keyboard and screen-reader
// behaviour a custom dropdown would have to re-implement).
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  allLabel,
  options,
  value,
  onChange,
  renderOption,
}: {
  label: string
  allLabel: string
  options: string[]
  value: string | null
  onChange: (next: string | null) => void
  renderOption?: (raw: string) => string
}) {
  const id = useId()
  if (options.length === 0) return null
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted-fg">
      <span className="ui-label">{label}</span>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="bg-surface border border-border rounded-[13px] px-2.5 py-1.5 text-xs text-foreground max-w-[14rem]"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {renderOption ? renderOption(o) : o}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Legend — the three source event types plus the explicit unclassified state.
// Colour chips are decorative; the text label carries the meaning.
// ---------------------------------------------------------------------------

function EventLegend({ t }: { t: Translation['fp']['alternatives'] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label={t.legendTitle}>
      <span className="ui-label text-muted-fg">{t.legendTitle}</span>
      {ALT_EVENT_TYPES.map((type) => {
        const color = altEventColorVar(type)
        const hollow = altEventChipStyle(type) === 'hollow'
        return (
          <span key={type} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={
                hollow
                  ? { border: `2px solid ${color}`, backgroundColor: 'transparent' }
                  : { backgroundColor: color }
              }
            />
            {eventTypeLabel(type, t)}
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Statement cell — the date plus its FACTUAL age in months, computed against
// the Alternatives publication's own as-of date (never the viewer's clock).
// The contract requires a staleness indicator but commits no threshold, so
// the indicator is the observation itself — deliberately no "Stale" verdict
// and no fresh/aging buckets (R13.9 audit). A row carrying the literal
// `Inversión Inicial` shows that label verbatim, with no fabricated age
// (doc 03 § 2).
// ---------------------------------------------------------------------------

function StatementCell({
  holding,
  asOfDate,
  t,
}: {
  holding: AlternativesHoldingRead
  asOfDate: string | null
  t: Translation['fp']['alternatives']
}) {
  if (holding.lastStatementDate === null) {
    return (
      <span className="text-muted-fg">
        {holding.lastStatementLabel ?? '—'}
      </span>
    )
  }
  const age = statementAge(holding.lastStatementDate, asOfDate)
  return (
    <span className="whitespace-nowrap">
      <span className="ui-number">{formatIsoDateLabel(holding.lastStatementDate)}</span>
      {age !== null && (
        <span className="text-muted-fg" title={t.ageTitle}>
          {' '}· {age.months} {t.monthsAbbrev}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// One (category, currency) group band + its holdings + its subtotal row.
// ---------------------------------------------------------------------------

function GroupRows({
  group,
  asOfDate,
  masked,
  t,
}: {
  group: AlternativesGroup
  asOfDate: string | null
  masked: boolean
  t: Translation['fp']['alternatives']
}) {
  const s = group.subtotal
  const partial =
    s.capitalCommitted.missing + s.contributions.missing + s.unfunded.missing + s.currentValue.missing > 0
  return (
    <>
      <tr className="bg-surface-2">
        <td colSpan={11} className={`${CELL} text-left font-medium`} style={{ borderLeft: '3px solid var(--accent)' }}>
          {group.category}
          <span className="text-muted-fg"> · {currencyLabel(group.currency)} · {group.holdings.length} {t.holdingsWord}</span>
        </td>
      </tr>
      {group.holdings.map((h) => (
        <tr key={h.id} className="border-b border-border">
          <td className={`${CELL} text-left`}>
            <span className="block truncate max-w-[16rem]" title={h.investmentName}>{h.investmentName}</span>
          </td>
          <td className={`${CELL} text-left whitespace-nowrap`}>{h.sociedad}</td>
          <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
            <MaskedAmount value={h.capitalCommitted} masked={masked} />
          </td>
          <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
            <MaskedAmount value={h.contributions} masked={masked} />
          </td>
          <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
            <MaskedAmount value={h.unfunded} masked={masked} />
          </td>
          <td className={`${CELL} text-right`}>
            <StatementCell holding={h} asOfDate={asOfDate} t={t} />
          </td>
          <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
            <MaskedAmount value={h.lastValuation} masked={masked} />
          </td>
          <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
            <MaskedAmount value={h.flowSinceStatement} masked={masked} signed />
          </td>
          <td className={`${CELL} text-right ui-number whitespace-nowrap font-medium`}>
            <MaskedAmount value={h.currentValue} masked={masked} />
          </td>
          <td className={`${CELL} text-right ui-number whitespace-nowrap`}>{formatWeightPct(h.reportedIrr)}</td>
          <td className={`${CELL} text-right ui-number whitespace-nowrap`}>{formatWeightPct(h.calculatedIrr)}</td>
        </tr>
      ))}
      <tr className="border-b border-border font-medium border-t border-border">
        <td colSpan={2} className={`${CELL} text-left`}>
          {t.subtotal}
          <span className="text-muted-fg"> · {currencyLabel(group.currency)}</span>
          {partial && (
            <span className="text-warning" title={t.subtotalPartialNote}> *</span>
          )}
        </td>
        <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
          <MaskedAmount value={s.capitalCommitted.value} masked={masked} />
        </td>
        <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
          <MaskedAmount value={s.contributions.value} masked={masked} />
        </td>
        <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
          <MaskedAmount value={s.unfunded.value} masked={masked} />
        </td>
        <td colSpan={3} className={CELL} />
        <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
          <MaskedAmount value={s.currentValue.value} masked={masked} />
        </td>
        <td colSpan={2} className={CELL} />
      </tr>
    </>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FamilyPortfolioAlternativesPage() {
  const { t } = useLang()
  const w = t.fp.alternatives
  const [masked, setMasked] = usePrivacyMode()

  const [outcome, setOutcome] = useState<FetchOutcome>('loading')
  const [data, setData] = useState<FamilyPortfolioAlternativesResponse | null>(null)
  const [filter, setFilter] = useState<AlternativesFilter>(EMPTY_FILTER)

  useEffect(() => {
    let cancelled = false
    fetchFamilyPortfolioAlternatives().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setData(result.data)
        setOutcome('ready')
      } else {
        setOutcome(result.status === 403 ? 'denied' : 'error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const holdings = useMemo(() => data?.holdings ?? [], [data])
  const events = useMemo(() => data?.events ?? [], [data])
  const options = useMemo(() => filterOptions(holdings, events), [holdings, events])

  const filterActive =
    filter.sociedad !== null || filter.category !== null || filter.currency !== null || filter.eventType !== null

  // Unfiltered → the server's own groups (parity by construction). Filtered →
  // the SAME pure function over the narrowed set.
  const visibleGroups = useMemo(() => {
    if (!filterActive) return data?.groups ?? []
    return groupHoldings(applyHoldingFilter(holdings, filter))
  }, [data, filterActive, holdings, filter])

  const visibleEvents = useMemo(
    () => applyEventFilter(events, holdings, filter),
    [events, holdings, filter],
  )
  const timeline = useMemo(() => buildTimeline(visibleEvents, holdings), [visibleEvents, holdings])

  // The unclassified callout reports the WHOLE publication, not the filtered
  // view — an actionable state must not disappear behind a filter.
  const unclassified = data?.eventSummary?.unclassified ?? summarizeEvents(events).unclassified

  const asOfDate = data?.publication?.asOfDate ?? null
  const publishedAt = data?.publication?.publishedAt ?? null

  return (
    <div className="w-full">
      <PageHeader
        eyebrow={t.fp.tag}
        title={w.title}
        metadata={
          asOfDate !== null ? (
            <span className="text-xs text-muted-fg whitespace-nowrap">
              {w.asOfLabel} <span className="ui-number">{formatIsoDateLabel(asOfDate)}</span>
            </span>
          ) : undefined
        }
        actions={<PrivacyToggle masked={masked} onToggle={() => setMasked((prev) => !prev)} />}
      />

      <MemberGate>
        {outcome === 'loading' && <AsyncState kind="loading" />}
        {outcome === 'error' && <AsyncState kind="error" message={t.fp.accessError} />}
        {outcome === 'denied' && <EmptyState message={t.fp.noAccess} />}

        {outcome === 'ready' && data?.state === 'no_publication' && (
          <AsyncState kind="empty" message={w.noPublication} />
        )}
        {outcome === 'ready' && data?.state === 'empty' && (
          <AsyncState kind="empty" message={w.empty} />
        )}

        {outcome === 'ready' && data?.state === 'ok' && (
          <div className="flex flex-col gap-5">
            {/* ── Filters (doc 07 § 7.4: sociedad, category, currency, event type) ── */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <FilterSelect
                label={w.filterSociedad}
                allLabel={w.allSociedades}
                options={options.sociedades}
                value={filter.sociedad}
                onChange={(sociedad) => setFilter((f) => ({ ...f, sociedad }))}
              />
              <FilterSelect
                label={w.filterCategory}
                allLabel={w.allCategories}
                options={options.categories}
                value={filter.category}
                onChange={(category) => setFilter((f) => ({ ...f, category }))}
              />
              <FilterSelect
                label={w.filterCurrency}
                allLabel={w.allCurrencies}
                options={options.currencies}
                value={filter.currency}
                onChange={(currency) => setFilter((f) => ({ ...f, currency }))}
                renderOption={currencyLabel}
              />
              <FilterSelect
                label={w.filterEventType}
                allLabel={w.allEventTypes}
                options={options.eventTypes}
                value={filter.eventType}
                onChange={(eventType) => setFilter((f) => ({ ...f, eventType }))}
                renderOption={(type) => eventTypeLabel(type, w)}
              />
            </div>

            {/* ── Unclassified events — explicit, actionable, never hidden ── */}
            {unclassified > 0 && (
              <div
                role="status"
                className="rounded-[13px] border border-border px-4 py-3 text-xs"
                style={{ borderLeft: '3px solid var(--warning)' }}
              >
                <p className="font-medium text-warning">
                  {w.unclassifiedTitle} · {unclassified}
                </p>
                <p className="text-muted-fg mt-0.5">{w.unclassifiedBody}</p>
              </div>
            )}

            {/* ── Investment summary by (category, currency) ── */}
            <TableCard
              title={w.summaryTitle}
              minWidth={1080}
              footer={
                // R13.R2F5.1 § A — this is the widest table on the page
                // (1080px min); `.nv-notes` (globals.css) keeps the three
                // notes stacked at ONE left origin and widens each to a 110ch
                // measure, instead of a narrow column of its own.
                <div className="nv-notes">
                  <TableSourceFooter source={w.source} asOf={publishedAt} />
                  <p className="text-[11px] text-muted-fg">{w.noCrossCurrencyNote}</p>
                  <p className="text-[11px] text-muted-fg">{w.irrSourceNote}</p>
                </div>
              }
            >
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="border-b border-border-strong">
                    <th className={`${TH} text-left`} scope="col">{w.colInvestment}</th>
                    <th className={`${TH} text-left`} scope="col">{w.colSociedad}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colCommitted}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colContributions}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colUnfunded}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colLastStatement}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colLastValuation}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colFlowSince}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colCurrentValue}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colReportedIrr}</th>
                    <th className={`${TH} text-right`} scope="col">{w.colCalculatedIrr}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGroups.map((g) => (
                    <GroupRows
                      key={`${g.category}·${g.currency}`}
                      group={g}
                      asOfDate={asOfDate}
                      masked={masked}
                      t={w}
                    />
                  ))}
                </tbody>
              </table>
              {visibleGroups.length === 0 && (
                <p className="text-xs text-muted-fg py-6 text-center">{w.timelineEmpty}</p>
              )}
            </TableCard>

            {/* ── Event history timeline with the semantic legend ── */}
            <TableCard
              title={w.timelineTitle}
              controls={<EventLegend t={w} />}
              footer={
                // R13.R2F5 — the same shared band as the summary table above,
                // for consistency across the tab.
                <div className="nv-notes">
                  <TableSourceFooter source={w.source} asOf={publishedAt} />
                  <span className="text-[11px] text-muted-fg">
                    {visibleEvents.length} {w.eventsWord}
                  </span>
                </div>
              }
            >
              <EventTimeline months={timeline} masked={masked} t={w} />
            </TableCard>
          </div>
        )}
      </MemberGate>
    </div>
  )
}
