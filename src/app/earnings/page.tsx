'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { useLang } from '@/components/providers/LangProvider'
import { useGlobalRefresh } from '@/components/providers/useGlobalRefresh'
import { fetchEarningsCalendar, upcomingWithinDays, type EarningsCalendarResult } from '@/lib/data/earningsCalendar'
import { fetchEarningsResults, type EarningsResultsPayload } from '@/lib/data/earningsResults'
import { getAllCompanies } from '@/lib/data/companies'
import { formatDate, formatPct, changeColor } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'
import { PageHeader } from '@/components/fable/PageHeader'
import { TableCard } from '@/components/fable/TableCard'
import { ChipButton } from '@/components/fable/Chip'
import { AsyncState, type AsyncStateKind } from '@/components/fable/AsyncState'
import { Reveal } from '@/components/fable/motion'

/**
 * Upcoming window, in days. The committed CMF snapshot carries ABSOLUTE report
 * dates, so this window is recomputed live on every render and the snapshot
 * stays correct between refreshes. Home deliberately uses its own, shorter
 * (7-day) window — this constant governs THIS page only. (R8: was an inline
 * literal in the render body.)
 */
const UPCOMING_WINDOW_DAYS = 45

/**
 * The client-safe company registry, read ONCE at module scope (a pure JSON
 * import — no API request) and used for BOTH the coverage denominator and the
 * ticker→name lookup below, so the two can never disagree about which universe
 * is being measured.
 */
const COMPANY_REGISTRY = getAllCompanies()

/**
 * The authoritative tracked-company universe. Coverage is measured against this
 * and NEVER against the number of rows on screen — see CoverageNote. Derived
 * from the registry, never hardcoded and never taken from a provider-side
 * symbol map, so adding a company to the registry moves the denominator.
 */
const trackedCompanyCount = COMPANY_REGISTRY.length

/**
 * Ticker → company name, from that same registry. `name` is the field the
 * server-side results resolver uses for its own `companyName`, so one company
 * reads identically in both tables.
 */
const COMPANY_NAME = new Map(COMPANY_REGISTRY.map((c) => [c.ticker, c.name]))

/** Millions of the row's own reporting currency (Yahoo reports some issuers in USD). */
function fmtMM(v: number | null): string {
  if (v == null) return '—'
  return v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/**
 * EPS in the row's reporting currency. Issuers reporting in USD with very large
 * share counts (LATAM, Enel Américas, Colbún) have a sub-cent EPS that rounds to
 * a useless "0,00" at 2dp — those get 4dp so a real figure is shown rather than
 * an apparent zero.
 */
function fmtEps(v: number | null): string {
  if (v == null) return '—'
  const d = Math.abs(v) < 1 ? 4 : 2
  return v.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/**
 * CMF report dates are date-only (`YYYY-MM-DD`). JS parses such a string as UTC
 * midnight, which in Chile (UTC-4/-3) formats as the PREVIOUS calendar day —
 * verified: a raw `formatDate('2026-08-04')` prints "03 ago 2026". Appending an
 * explicit zero time makes it parse in LOCAL time, so the shared formatter
 * prints the real report date. The formatter itself is untouched; only its
 * input is normalized, and no date segment is rearranged by hand.
 */
function reportDateLabel(iso: string): string {
  return formatDate(`${iso}T00:00:00`)
}

/**
 * Per-table source-coverage disclosure.
 *
 * Rendered once per table and never merged into a single page-level figure:
 * the CMF calendar and the Yahoo results feed are INDEPENDENT sources whose
 * coverage genuinely differs (CMF does not publish BSANTANDER/ITAUCL at all,
 * while Yahoo can omit a different set on any given fetch).
 *
 * Coverage is derived from the tracked-company registry minus that payload's
 * own `missingTickers`, never from the number of rows on screen: Recent Results
 * prints two quarters per company and Upcoming prints only companies reporting
 * inside the window, so a row count could never express "this source has no
 * data for this issuer at all".
 *
 * Lives beside the footer, never inside `TableSourceFooter`'s source string
 * (Source Badge Rule: the source string stays a plain source name).
 */
function CoverageNote({ missing }: { missing: string[] }) {
  const { t } = useLang()
  return (
    <p className="ui-meta text-muted-fg">
      <span className="ui-number">{trackedCompanyCount - missing.length}/{trackedCompanyCount}</span>{' '}
      {t.earnings.companiesCovered}
      {missing.length > 0 && (
        <>
          {' · '}
          {t.earnings.notCovered}: <span className="font-mono">{missing.join(', ')}</span>
        </>
      )}
    </p>
  )
}

export default function EarningsPage() {
  const { t } = useLang()
  const refreshAll = useGlobalRefresh()

  const [cal, setCal] = useState<EarningsCalendarResult | null>(null)
  const [results, setResults] = useState<EarningsResultsPayload | null>(null)
  const [loading, setLoading] = useState(true)

  // Inline promise chain (not a named helper called from the effect body) so
  // every setState lands in a callback — the shape the React Compiler rules
  // require, and the same one Home uses for its mount fetches.
  useEffect(() => {
    let mounted = true
    Promise.all([
      fetchEarningsCalendar().catch(() => null),
      fetchEarningsResults(false).catch(() => null),
    ]).then(([c, r]) => {
      if (!mounted) return
      if (c) setCal(c)
      if (r) setResults(r)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  // Update Data: refresh every live domain, then force-refetch this tab's own
  // data past the resolver's 6h cache.
  const refreshEarnings = useCallback(async () => {
    setLoading(true)
    await refreshAll()
    const [c, r] = await Promise.all([
      fetchEarningsCalendar().catch(() => null),
      fetchEarningsResults(true).catch(() => null),
    ])
    if (c) setCal(c)
    if (r) setResults(r)
    setLoading(false)
  }, [refreshAll])

  // Upcoming = real CMF EEFF-sending dates, replacing the old static sample.
  // Absolute dates, so the window is always computed live.
  const calLive = cal?.status === 'live'
  const upcoming = calLive ? upcomingWithinDays(cal.events, UPCOMING_WINDOW_DAYS) : []
  const rows = results?.rows ?? []
  const live = results?.status === 'live'

  /**
   * Three genuinely different situations, deliberately never collapsed:
   *  • loading     — the fetch is still in flight
   *  • unavailable — the source explicitly reported `unavailable`, OR the fetch
   *                  failed and the payload is null. There is NO static
   *                  earnings source, so this is never "showing a sample".
   *  • empty       — a healthy live payload that legitimately has no rows (e.g.
   *                  no CMF report falls inside the window between reporting
   *                  waves). Real data, honestly zero.
   */
  const stateFor = (sourceIsLive: boolean): AsyncStateKind =>
    loading ? 'loading' : sourceIsLive ? 'empty' : 'unavailable'

  /** `undefined` for `unavailable` so AsyncState uses its own bilingual copy. */
  const messageFor = (kind: AsyncStateKind, emptyMessage: string): string | undefined =>
    kind === 'loading' ? t.common.loading : kind === 'empty' ? emptyMessage : undefined

  const calState = stateFor(calLive)
  const resultsState = stateFor(live)

  /**
   * The calendar's period enum is `Q1 | Q2 | Q3 | Annual` (no Q4 — the annual
   * filing replaces it). Q1–Q3 are locale-neutral, but "Annual" is an English
   * word that must never reach the Spanish UI. An unrecognized value falls
   * through unchanged rather than rendering blank.
   *
   * Recent Results' own `period` is a different field ("Q1 2026", produced by
   * quarterLabel() in the pure core) and is already language-neutral — there is
   * nothing in it to translate.
   */
  const periodLabel = (p: string): string =>
    ({
      Q1: t.earnings.calPeriods.q1,
      Q2: t.earnings.calPeriods.q2,
      Q3: t.earnings.calPeriods.q3,
      Annual: t.earnings.calPeriods.annual,
    } as Record<string, string>)[p] ?? p

  const handleExport = () => {
    exportCSV(
      'earnings_recent_results',
      [
        t.earnings.calCols.ticker, t.earnings.cols.company, t.earnings.cols.period, t.earnings.currency,
        t.earnings.cols.revenue, t.earnings.cols.revenueYoy, t.earnings.cols.ebitda, t.earnings.cols.ebitdaYoy,
        t.earnings.cols.netIncome, t.earnings.cols.netIncomeYoy, t.earnings.cols.eps,
      ],
      rows.map(e => [
        e.ticker, e.companyName, e.period, e.currency,
        e.revenue ?? '', e.revenueYoY ?? '', e.ebitda ?? '', e.ebitdaYoY ?? '',
        e.netIncome ?? '', e.netIncomeYoY ?? '', e.eps ?? '',
      ]),
    )
  }

  const pctCell = (v: number | null) => (
    <td className={`py-2.5 px-3 text-right ui-number ${v != null ? changeColor(v) : 'text-muted-fg'}`}>
      {v != null ? formatPct(v) : '—'}
    </td>
  )

  return (
    <div className="w-full space-y-5">
      <Reveal>
        <PageHeader
          eyebrow={t.earnings.tag}
          title={t.earnings.title}
          metadata={t.earnings.subtitle}
          actions={<UpdateDataButton onRefresh={refreshEarnings} />}
        />
      </Reveal>

      {/* Upcoming — real CMF report dates. R11: the badge names CMF, not the
          component's Yahoo default — its tooltip must agree with the footer. */}
      <Reveal delayMs={70}>
        <TableCard
          title={t.earnings.upcomingLabel}
          controls={<MarketDataSourceBadge status={calLive ? 'live' : 'live-unavailable'} provider="CMF" />}
          minWidth={360}
          footer={
            <div className="space-y-0.5">
              <TableSourceFooter source={t.home.earningsCalSource} asOf={cal?.asOf ?? null} />
              {calLive && <CoverageNote missing={cal.missingTickers} />}
            </div>
          }
        >
          <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
            <caption className="sr-only">{t.earnings.upcomingLabel}</caption>
            <thead>
              <tr>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 pl-4 pr-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.calCols.ticker}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.calCols.company}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.calCols.period}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 px-3 pr-4 border-b border-border ui-table-header text-muted-fg">{t.earnings.calCols.expected}</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map(e => (
                <tr key={`${e.ticker}-${e.reportDate}`} className="border-b border-border last:border-0 nv-row-hover nv-transition">
                  <td className="py-2.5 pl-4 pr-3">
                    <Link href={`/companies/${e.ticker}`} className="font-mono text-primary hover:underline">{e.ticker}</Link>
                  </td>
                  <td className="py-2.5 px-3 text-foreground">{COMPANY_NAME.get(e.ticker) ?? '—'}</td>
                  <td className="py-2.5 px-3 text-muted-fg">{periodLabel(e.period)}</td>
                  <td className="py-2.5 px-3 pr-4 ui-number text-muted-fg">{reportDateLabel(e.reportDate)}</td>
                </tr>
              ))}
              {upcoming.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-0">
                    <AsyncState kind={calState} message={messageFor(calState, t.earnings.noUpcoming)} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableCard>
      </Reveal>

      {/* Recent results — real reported quarterly financials, rolling last 2 quarters */}
      <Reveal delayMs={130}>
        <TableCard
          title={t.earnings.recentResults}
          minWidth={720}
          controls={<>
            <MarketDataSourceBadge status={live ? 'live' : 'live-unavailable'} />
            <ChipButton onClick={handleExport}>
              <span aria-hidden>⤓</span>{t.common.exportCsv}
            </ChipButton>
          </>}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="space-y-0.5">
                <TableSourceFooter source={t.stocks.footer} asOf={results?.asOf ?? null} />
                <p className="text-xs text-muted-fg">{t.earnings.amountsNote}</p>
                {live && <CoverageNote missing={results.missingTickers} />}
              </div>
              <span className="ui-meta ui-number text-muted-fg" aria-live="polite">{rows.length} {t.common.records}</span>
            </div>
          }
        >
          <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
            <caption className="sr-only">{t.earnings.recentResults}</caption>
            <thead>
              <tr>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 pl-4 pr-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.calCols.ticker}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.company}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.period}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-center py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.currency}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.revenue}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.revenueYoy}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.ebitda}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.ebitdaYoy}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.netIncome}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.netIncomeYoy}</th>
                <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 pr-4 border-b border-border ui-table-header text-muted-fg">{t.earnings.cols.eps}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(e => (
                <tr key={`${e.ticker}-${e.periodEnd}`} className="border-b border-border last:border-0 nv-row-hover nv-transition">
                  <td className="py-2.5 pl-4 pr-3">
                    <Link href={`/companies/${e.ticker}`} className="font-mono text-primary hover:underline">{e.ticker}</Link>
                  </td>
                  <td className="py-2.5 px-3 text-foreground">{e.companyName}</td>
                  <td className="py-2.5 px-3 text-muted-fg">{e.period}</td>
                  <td className="py-2.5 px-3 text-center text-muted-fg">{e.currency}</td>
                  <td className="py-2.5 px-3 text-right ui-number text-foreground">{fmtMM(e.revenue)}</td>
                  {pctCell(e.revenueYoY)}
                  <td className="py-2.5 px-3 text-right ui-number text-foreground" title={e.isBank ? t.earnings.bankNoEbitda : undefined}>
                    {fmtMM(e.ebitda)}
                  </td>
                  {pctCell(e.ebitdaYoY)}
                  <td className={`py-2.5 px-3 text-right ui-number ${e.netIncome != null && e.netIncome < 0 ? 'text-negative' : 'text-foreground'}`}>{fmtMM(e.netIncome)}</td>
                  {pctCell(e.netIncomeYoY)}
                  <td className={`py-2.5 px-3 pr-4 text-right ui-number ${e.eps != null && e.eps < 0 ? 'text-negative' : 'text-foreground'}`}>{fmtEps(e.eps)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-0">
                    <AsyncState kind={resultsState} message={messageFor(resultsState, t.common.noResults)} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableCard>
      </Reveal>
    </div>
  )
}
