'use client'

// R13.8 — `/portfolio/weekly-changes` (doc 08 Stage 8; doc 07 Parts A2/A3,
// page order § 6h).
//
// ── POST-R13.8 FOLLOW-UP E · THIS PAGE IS ONE WEEK, AND ONLY ONE WEEK ───────
//
// It used to be two surfaces wearing one route: a weekly view, and — behind a
// Compare switch — an arbitrary FROM/TO range that reused the weekly page's
// controls, title and half its vocabulary. The owner's decision is that those
// are different questions and belong on different tabs, so the range moved to
// `/portfolio/compare` and this page kept the week.
//
// WHAT WENT WITH IT: the Compare switch, the FROM endpoint control, the
// arbitrary TO control, the custom-range state, the mode-dependent title and
// every period calculation. What is left is the selection this page always
// really had — ONE published week — expressed by ONE control.
//
// WHAT DID NOT CHANGE: the measurement. The comparison is still the source's
// OWN previous week, read from the selected publication's own record — for
// 2026-09-04 that is 2026-08-28, not the previous PUBLICATION at 2026-07-31
// five weeks back. Removing the range controls removed a choice, not a basis.
//
// ── THE BODY IS SHARED, DELIBERATELY ────────────────────────────────────────
//
// Everything below the header renders from `ChangesSurface`, the one component
// `/portfolio/compare` also renders. The two surfaces must stay visually
// synchronised as either is restyled, and two files holding the same markup
// drift on the first change made to only one of them. This page owns what
// genuinely differs — the week control and the fetch — and nothing else.
//
// ONE WEEK SELECTION DRIVES EVERYTHING (doc 07 § 6b): a single (scope, asOf)
// fetch feeds every section; no component holds its own week.
//
// NO FINANCIAL SEMANTICS LIVE IN THIS FILE. Every figure comes from the API
// response or from a pure module; the client is presentation, never protection
// and never a second calculator.

import { Suspense, useEffect, useState } from 'react'
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
  PORTFOLIO_WEEKLY_CHANGES,
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

function WeeklyChangesPageInner() {
  const { t, lang } = useLang()
  const w = t.fp.weeklyChanges
  const { scopes } = useFamilyPortfolio()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [masked, setMasked] = usePrivacyMode()

  // R13.R5C.4 — the derivation is shared with the module rail and the other
  // scope-aware views, so a link can never resolve a scope differently from the
  // page it opens.
  const portfolioScopes = portfolioScopesOf(scopes)
  const activeScope = resolveActiveScope(searchParams.get(SCOPE_PARAM), scopes)

  /** null = the latest published week. THE ONLY selection this page holds. */
  const [asOf, setAsOf] = useState<string | null>(null)
  const requestKey = `${activeScope ?? ''}|${asOf ?? 'latest'}`
  const [slot, setSlot] = useState<FetchSlot | null>(null)

  // Render-time previous-value pattern (the codebase's standing rule — never an
  // effect): a scope switch returns to that scope's own latest week, because a
  // week one scope published may be a week another never did.
  const [prevScope, setPrevScope] = useState(activeScope)
  if (prevScope !== activeScope) {
    setPrevScope(activeScope)
    setAsOf(null)
  }

  useEffect(() => {
    if (!activeScope) return
    let cancelled = false
    ;(async () => {
      const key = `${activeScope}|${asOf ?? 'latest'}`
      // No `from` argument, ever: this route is the weekly one, and passing an
      // opening endpoint is what would turn it back into a range.
      const res = await fetchFamilyPortfolioWeeklyChanges(activeScope, asOf)
      if (cancelled) return
      if (!res.ok) {
        // A selected week that stopped existing (rolled back while open) resets
        // to the latest — never a nearest-week guess.
        if (res.status === 404 && asOf !== null) {
          setAsOf(null)
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
  }, [activeScope, asOf])

  const current = slot && slot.key === requestKey ? slot : null
  const loading = activeScope !== null && current === null
  const data = current?.outcome === 'ready' ? current.data : null
  const pub = data?.publication ?? null
  const prevPub = data?.previousPublication ?? null

  const activeLabel = portfolioScopes.find((s) => s.id === activeScope)
  const scopeLabel = activeLabel ? (lang === 'es' ? activeLabel.labelEs : activeLabel.labelEn) : ''

  function selectScope(next: string) {
    router.replace(scopeHref(PORTFOLIO_WEEKLY_CHANGES, next), { scroll: false })
  }

  const ready = data !== null
  const state = data?.state ?? null
  const showSections = ready && state === 'ok' && pub !== null && prevPub !== null && data.total != null

  return (
    <div className="w-full">
      {/* ── § 6h item 1 · header, portfolio selector, week selector ───────── */}
      <PageHeader
        eyebrow={t.fp.tag}
        title={w.title}
        metadata={
          pub ? (
            <>
              <span>{scopeLabel}</span>
              <span>
                {t.fp.portfolio.week} {formatIsoDateLabel(pub.asOfDate)}
              </span>
              <span>
                {t.fp.portfolio.revisionShort} {pub.revision}
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
            {/* ONE control, and it is a choice rather than a label: the reader
                picks a published week and the whole page describes it. The
                comparison week is not offered because it is not choosable —
                it is whatever the source itself closed before the week
                selected, stated in the page's own endpoint line. */}
            {ready && data.weeks.length > 0 && pub && (
              <WeekSelector
                weeks={data.weeks}
                value={asOf ?? pub.asOfDate}
                onChange={(next) => setAsOf(next)}
                disabled={loading}
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
        ) : state === 'no_previous_week' ? (
          <div className="flex flex-col gap-3">
            {pub && (
              <p className="ui-meta text-muted-fg">
                {w.thisWeekLabel}: {formatIsoDateLabel(pub.asOfDate)} · {w.previousWeekLabel}: — · {w.pairNote}
              </p>
            )}
            {/* The earliest published week: a prior published observation does
                not exist, so weekly-change analytics are genuinely unavailable
                — an honest explanation, never a zero-change page. */}
            <AsyncState kind="empty" message={w.noPreviousWeek} />
          </div>
        ) : showSections && activeScope ? (
          <ChangesSurface mode="weekly" data={data} scope={activeScope} masked={masked} />
        ) : (
          <AsyncState kind="unavailable" />
        )}
      </MemberGate>
    </div>
  )
}

export default function FamilyPortfolioWeeklyChangesPage() {
  return (
    <Suspense fallback={<AsyncState kind="loading" />}>
      <WeeklyChangesPageInner />
    </Suspense>
  )
}
