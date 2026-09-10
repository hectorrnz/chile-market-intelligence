'use client'

// POST-R13.8 FOLLOW-UP E — `/portfolio/compare`.
//
// ── WHY THIS ROUTE EXISTS ───────────────────────────────────────────────────
//
// Comparing two arbitrary dates lived on `/portfolio/weekly-changes`, behind a
// switch. It was never comfortable there: the page's title, its week control,
// its column headers and half its vocabulary describe ONE week, and a five-month
// range borrowed all of them. The owner's decision is that a week and a period
// are different questions, so they are now different tabs.
//
// Being on this route IS the mode. There is no toggle to find, no default to
// leave, and nothing on this page describes a week.
//
// ── IT IS THE SAME PAGE, DELIBERATELY ───────────────────────────────────────
//
// Everything below the header renders from `ChangesSurface`, the very component
// Weekly Changes renders — the same composition, hero, ledger, ranked panels,
// hierarchy chart, listing, cash toggle and status block, in the same order at
// the same sizes. A reader arriving here should recognise the page they just
// left and see only that the interval changed.
//
// That is a structural guarantee rather than a styling intention: there is no
// second copy of the markup to drift, and every word that differs is resolved
// once by `changesLabels('period', t)`.
//
// ── WHAT THIS PAGE OWNS ─────────────────────────────────────────────────────
//
// The two endpoint controls and the fetch. FROM sits physically left of TO,
// FROM is constrained to be strictly earlier, and the server refuses a reversed
// range independently (`from_not_before_to`) — the control cannot build one and
// the API would not honour it if it could.
//
// ── THE ENDPOINT UNIVERSE ───────────────────────────────────────────────────
//
// `compareDates` from the API: every reporting date this scope holds a complete
// source-backed row set at — a current publication, or a frozen reporting date
// in `portfolio_row_history`. It is NOT the publication list: after a catch-up
// import the source's own recent weeks are genuine reporting dates that no
// publication names, and limiting Compare to publications would hide exactly
// the weeks a reader is most likely to want.
//
// NO NEAREST-DATE SUBSTITUTION anywhere: a date the book does not hold is never
// offered here and is refused by the server if asked for directly.
//
// AUTHORIZATION is the Portfolio module's own, unchanged. `/portfolio/compare`
// falls under the `/portfolio` module binding, the API re-checks `canReadScope`
// and PostgreSQL RLS re-derives entitlement below that. This page grants
// nothing; it only decides what a control says.

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { PrivacyToggle } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { EmptyState } from '@/components/ui/EmptyState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'
import { useFamilyPortfolio } from '@/components/familyPortfolio/FamilyPortfolioProvider'
import { WeekSelector } from '@/components/familyPortfolio/WeekSelector'
import { ChangesSurface } from '@/components/familyPortfolio/ChangesSurface'
import { formatIsoDateLabel } from '@/lib/formatters'
import {
  PORTFOLIO_COMPARE,
  SCOPE_PARAM,
  activeScope as resolveActiveScope,
  portfolioScopesOf,
  scopeHref,
} from '@/lib/familyPortfolio/portfolioScopeRoutes'
import {
  fetchFamilyPortfolioWeeklyChanges,
  type WeeklyChangesResponse,
} from '@/lib/data/familyPortfolio'

type FetchOutcome = 'ready' | 'denied' | 'error'

interface FetchSlot {
  key: string
  outcome: FetchOutcome
  data: WeeklyChangesResponse | null
}

/**
 * The eligible endpoints in the shape `WeekSelector` renders — dates only.
 *
 * `revision` is a required field of that shape and is deliberately given a
 * fixed 0 here rather than a real number: a row-history date HAS no revision,
 * and the control has printed dates alone since R13.8 in any case. Nothing on
 * this page reads it.
 */
function endpointOptions(dates: readonly string[]) {
  return [...dates]
    .sort()
    .reverse()
    .map((asOfDate) => ({ asOfDate, revision: 0, publishedAt: '' }))
}

function ComparePageInner() {
  const { t, lang } = useLang()
  const w = t.fp.weeklyChanges
  const { scopes } = useFamilyPortfolio()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [masked, setMasked] = usePrivacyMode()

  const portfolioScopes = portfolioScopesOf(scopes)
  const activeScope = resolveActiveScope(searchParams.get(SCOPE_PARAM), scopes)

  /**
   * The two endpoints. Null means "not chosen yet": the page opens on the
   * server's own default pair — the latest reporting date against the one
   * before it — so a reader who lands here sees a real comparison rather than
   * an empty form. Deliberately NOT persisted: a comparison is a question asked
   * once, not a standing preference, and a reader returning next month should
   * not find last month's endpoints.
   */
  const [fromDate, setFromDate] = useState<string | null>(null)
  const [toDate, setToDate] = useState<string | null>(null)

  const requestKey = `${activeScope ?? ''}|${fromDate ?? 'auto'}|${toDate ?? 'latest'}`
  const [slot, setSlot] = useState<FetchSlot | null>(null)

  // Render-time previous-value pattern (never an effect): a range belongs to
  // the scope it was chosen in, and carrying it across could name a date the
  // new scope has no rows for. Both endpoints reset together.
  const [prevScope, setPrevScope] = useState(activeScope)
  if (prevScope !== activeScope) {
    setPrevScope(activeScope)
    setFromDate(null)
    setToDate(null)
  }

  useEffect(() => {
    if (!activeScope) return
    let cancelled = false
    ;(async () => {
      const key = `${activeScope}|${fromDate ?? 'auto'}|${toDate ?? 'latest'}`
      // `period` is always on: this route IS the period mode, and with no
      // FROM chosen yet it is what makes the server open on a real comparison
      // rather than fall back to the weekly basis.
      const res = await fetchFamilyPortfolioWeeklyChanges(activeScope, toDate, fromDate, true)
      if (cancelled) return
      if (!res.ok) {
        // An endpoint that stopped existing (rolled back while open) drops back
        // to the default pair — never a nearest-date guess.
        if (res.status === 404 && fromDate !== null) {
          setFromDate(null)
          return
        }
        if (res.status === 404 && toDate !== null) {
          setToDate(null)
          return
        }
        setSlot({ key, outcome: res.status === 403 ? 'denied' : 'error', data: null })
        return
      }
      setSlot({ key, outcome: 'ready', data: res.data })
    })()
    return () => {
      cancelled = true
    }
  }, [activeScope, fromDate, toDate])

  const current = slot && slot.key === requestKey ? slot : null
  const loading = activeScope !== null && current === null
  const data = current?.outcome === 'ready' ? current.data : null

  const activeLabel = portfolioScopes.find((s) => s.id === activeScope)
  const scopeLabel = activeLabel ? (lang === 'es' ? activeLabel.labelEs : activeLabel.labelEn) : ''

  // The resolved pair, as the SERVER answered it — never re-derived from the
  // two pieces of local state, which are null until the reader chooses.
  const resolvedTo = data?.closingEndpoint?.asOfDate ?? data?.publication?.asOfDate ?? null
  const resolvedFrom = data?.previousPublication?.asOfDate ?? null

  const allDates = useMemo(() => data?.compareDates ?? [], [data])
  // TO offers every eligible date except the earliest, which has nothing before
  // it to open a range; FROM offers every eligible date strictly earlier than
  // the TO on screen, so a reversed or zero-length range cannot be built here
  // at all.
  const toOptions = useMemo(
    () => endpointOptions(allDates.filter((d) => d > (allDates[0] ?? ''))),
    [allDates],
  )
  const fromOptions = useMemo(
    () => endpointOptions(resolvedTo === null ? [] : allDates.filter((d) => d < resolvedTo)),
    [allDates, resolvedTo],
  )

  function selectScope(next: string) {
    router.replace(scopeHref(PORTFOLIO_COMPARE, next), { scroll: false })
  }

  const ready = data !== null
  const state = data?.state ?? null
  const showSections =
    ready && state === 'ok' && resolvedFrom !== null && resolvedTo !== null && data.total != null

  return (
    <div className="w-full">
      {/* ── header, portfolio selector, FROM and TO ───────────────────────── */}
      <PageHeader
        eyebrow={t.fp.tag}
        // PERIOD vocabulary from the first line of the page: this is a portfolio
        // value change between two dates, and calling it a weekly change would
        // misstate the interval every figure below it describes.
        title={w.customTitle}
        metadata={
          resolvedFrom && resolvedTo ? (
            <>
              <span>{scopeLabel}</span>
              <span>
                {w.compareFrom} {formatIsoDateLabel(resolvedFrom)}
              </span>
              <span>
                {w.compareTo} {formatIsoDateLabel(resolvedTo)}
              </span>
            </>
          ) : undefined
        }
        actions={
          <>
            {portfolioScopes.length > 1 && (
              <SegmentedControl
                options={portfolioScopes.map((s) => ({
                  value: s.id,
                  label: lang === 'es' ? s.labelEs : s.labelEn,
                }))}
                value={activeScope ?? portfolioScopes[0].id}
                onChange={selectScope}
                ariaLabel={t.fp.portfolio.scopeSelector}
                remeasureToken={lang}
              />
            )}
            {/* FROM, then TO — reading order, and the order the range is
                written in. Both are plain dated selects; there is no mode
                switch beside them, because the route already is the mode. */}
            {ready && fromOptions.length > 0 && resolvedFrom && (
              <WeekSelector
                weeks={fromOptions}
                value={resolvedFrom}
                onChange={(next) => setFromDate(next)}
                disabled={loading}
                label={w.compareFrom}
              />
            )}
            {ready && toOptions.length > 0 && resolvedTo && (
              <WeekSelector
                weeks={toOptions}
                value={resolvedTo}
                onChange={(next) => {
                  // A TO that moves at or before the chosen FROM would invert
                  // every sign. The opening endpoint is dropped rather than
                  // carried into an impossible pair — the page then falls back
                  // to this date's own predecessor, which is always valid.
                  if (fromDate !== null && fromDate >= next) setFromDate(null)
                  setToDate(next)
                }}
                disabled={loading}
                label={w.compareTo}
              />
            )}
            <PrivacyToggle masked={masked} onToggle={() => setMasked((prev) => !prev)} />
          </>
        }
      />

      <MemberGate>
        {portfolioScopes.length === 0 ? (
          <EmptyState message={t.fp.noAccess} />
        ) : current?.outcome === 'denied' ? (
          <AsyncState kind="unavailable" message={t.fp.portfolio.notAuthorized} />
        ) : loading ? (
          <AsyncState kind="loading" />
        ) : current?.outcome === 'error' ? (
          <AsyncState kind="error" message={t.fp.portfolio.loadError} />
        ) : state === 'no_publications' ? (
          <AsyncState kind="empty" message={t.fp.portfolio.noPublication} />
        ) : state === 'empty' ? (
          <AsyncState kind="empty" message={t.fp.portfolio.emptyScope} />
        ) : state === 'from_not_before_to' ? (
          <AsyncState kind="unavailable" message={w.compareFromAfterTo} />
        ) : state === 'no_previous_week' ? (
          // Exactly one eligible reporting date: there is nothing to compare it
          // with, and the page says so rather than showing a range of zero.
          <AsyncState kind="empty" message={w.compareNeedsTwo} />
        ) : showSections && activeScope ? (
          <div className="flex flex-col gap-4">
            <ChangesSurface mode="period" data={data} scope={activeScope} masked={masked} />
            <p className="ui-meta text-muted-fg">{w.compareEndpointsNote}</p>
          </div>
        ) : (
          <AsyncState kind="unavailable" />
        )}
      </MemberGate>
    </div>
  )
}

export default function FamilyPortfolioComparePage() {
  return (
    <Suspense fallback={<AsyncState kind="loading" />}>
      <ComparePageInner />
    </Suspense>
  )
}
