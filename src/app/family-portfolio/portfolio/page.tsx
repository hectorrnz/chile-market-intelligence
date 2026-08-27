'use client'

// R13.6 — `/family-portfolio/portfolio` (doc 08 Stage 6; doc 07 § 7.2).
//
// The detailed authorized portfolio: an entitled-scope selector, the
// hierarchical four-dated-column table, and a historical week selector over
// every published week (the full history — selecting any week re-assembles
// that week's view).
//
// THE CLIENT IS PRESENTATION, NEVER PROTECTION (doc 05 § 2.1). The scope
// options come from the server-filtered scopes response — an unentitled
// principal's name never reaches this page. A hand-edited `?scope=` falls
// back to the caller's own first scope without fetching, and even a forged
// direct request is refused by the API's `canReadScope` check and, behind it,
// by PostgreSQL RLS. Reads are CURRENT publications only; drafts and
// superseded revisions are unreachable from this surface.

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { TableCard } from '@/components/fable/TableCard'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { PrivacyToggle } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { EmptyState } from '@/components/ui/EmptyState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'
import { useFamilyPortfolio } from '@/components/familyPortfolio/FamilyPortfolioProvider'
import { WeekSelector } from '@/components/familyPortfolio/WeekSelector'
import { HierarchicalTable } from '@/components/familyPortfolio/HierarchicalTable'
import { formatTemplate } from '@/components/fable/chart/chartA11y'
import { formatIsoDateLabel } from '@/lib/formatters'
import {
  fetchFamilyPortfolioSnapshot,
  type FamilyPortfolioSnapshotResponse,
} from '@/lib/data/familyPortfolio'

type FetchOutcome = 'ready' | 'denied' | 'error'

interface FetchSlot {
  /** Which (scope, week) request this result answers — stale results are ignored at render. */
  key: string
  outcome: FetchOutcome
  data: FamilyPortfolioSnapshotResponse | null
}

function PortfolioPageInner() {
  const { t, lang } = useLang()
  const { scopes } = useFamilyPortfolio()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [masked, setMasked] = usePrivacyMode()

  // Scope is DERIVED from the URL against the server-granted list — no local
  // copy to fall out of sync, and an unentitled/unknown ?scope= silently
  // resolves to the caller's own first scope (nothing is fetched for it).
  const portfolioScopes = scopes.filter((s) => s.id !== 'alternatives')
  const requested = searchParams.get('scope')
  const activeScope = portfolioScopes.some((s) => s.id === requested)
    ? (requested as string)
    : (portfolioScopes[0]?.id ?? null)

  /** null = the latest published week. */
  const [asOf, setAsOf] = useState<string | null>(null)
  const requestKey = `${activeScope ?? ''}|${asOf ?? 'latest'}`

  const [slot, setSlot] = useState<FetchSlot | null>(null)

  useEffect(() => {
    if (!activeScope) return
    let cancelled = false
    ;(async () => {
      const res = await fetchFamilyPortfolioSnapshot(activeScope, asOf)
      if (cancelled) return
      if (!res.ok) {
        // A selected week that stopped existing (e.g. rolled back while this
        // page was open) resets to the latest instead of dead-ending.
        if (res.status === 404 && res.code === 'week_not_found' && asOf !== null) {
          setAsOf(null)
          return
        }
        setSlot({
          key: `${activeScope}|${asOf ?? 'latest'}`,
          outcome: res.status === 403 ? 'denied' : 'error',
          data: null,
        })
        return
      }
      setSlot({ key: `${activeScope}|${asOf ?? 'latest'}`, outcome: 'ready', data: res.data })
    })()
    return () => {
      cancelled = true
    }
  }, [activeScope, asOf])

  const current = slot && slot.key === requestKey ? slot : null
  const loading = activeScope !== null && current === null
  const snapshot = current?.outcome === 'ready' ? (current.data?.snapshot ?? null) : null
  const weeks = current?.outcome === 'ready' ? (current.data?.weeks ?? []) : []
  const activeLabel = portfolioScopes.find((s) => s.id === activeScope)
  const scopeLabel = activeLabel ? (lang === 'es' ? activeLabel.labelEs : activeLabel.labelEn) : ''
  // R13.R1 § 3 — the visible heading names the specific portfolio being read
  // (`MAIN PORTFOLIO`, `JAIME PORTFOLIO`, …). The scope word itself stays
  // server-supplied, so an unentitled principal's name never reaches the
  // bundle; only the surrounding template is translated.
  const scopeHeading = scopeLabel
    ? formatTemplate(t.fp.scopeHeading, { scope: scopeLabel.toLocaleUpperCase(lang) })
    : ''

  function selectScope(next: string) {
    router.replace(`/family-portfolio/portfolio?scope=${encodeURIComponent(next)}`, {
      scroll: false,
    })
  }

  const cardState = loading
    ? ('loading' as const)
    : current?.outcome === 'error'
      ? ('error' as const)
      : current?.outcome === 'ready' && snapshot === null
        ? ('empty' as const)
        : current?.outcome === 'ready' && snapshot !== null && snapshot.rows.length === 0
          ? ('empty' as const)
          : undefined

  const cardStateMessage =
    cardState === 'error'
      ? t.fp.portfolio.loadError
      : cardState === 'empty'
        ? snapshot === null
          ? t.fp.portfolio.noPublication
          : t.fp.portfolio.emptyScope
        : undefined

  return (
    <div className="w-full">
      <PageHeader
        eyebrow={t.fp.tag}
        title={t.fp.portfolio.title}
        metadata={
          snapshot ? (
            <>
              <span>{scopeHeading}</span>
              <span>
                {t.fp.portfolio.week} {formatIsoDateLabel(snapshot.asOfDate)}
              </span>
            </>
          ) : undefined
        }
        actions={
          portfolioScopes.length > 1 ? (
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
          ) : undefined
        }
      />

      <MemberGate>
        {portfolioScopes.length === 0 ? (
          <EmptyState message={t.fp.noAccess} />
        ) : current?.outcome === 'denied' ? (
          <AsyncState kind="unavailable" message={t.fp.portfolio.notAuthorized} />
        ) : (
          <TableCard
            title={scopeHeading}
            controls={
              <>
                {weeks.length > 0 && snapshot && (
                  <WeekSelector
                    weeks={weeks}
                    value={asOf ?? snapshot.asOfDate}
                    onChange={(next) => setAsOf(next)}
                    disabled={loading}
                  />
                )}
                <PrivacyToggle masked={masked} onToggle={() => setMasked((prev) => !prev)} />
              </>
            }
            state={cardState}
            stateMessage={cardStateMessage}
            minWidth={760}
            maxHeight={640}
            footer={
              // R13.R2F5.1 § A — `.nv-notes` (globals.css) stacks this footnote
              // run at ONE left origin and gives each line a 110ch measure, so
              // it uses this full-width table's freed space by line length
              // rather than by starting the revision line mid-table. The inner
              // `flex flex-wrap` row that did exactly that is removed.
              <div className="nv-notes">
                <TableSourceFooter
                  source={t.fp.portfolio.source}
                  asOf={snapshot?.publishedAt ?? null}
                />
                {snapshot && (
                  <p className="ui-meta text-muted-fg">
                    {t.fp.portfolio.revisionShort} {snapshot.revision} ·{' '}
                    {t.fp.portfolio.parserLabel} {snapshot.parserVersion}
                  </p>
                )}
                {/* The one column NMI derives rather than ingests is disclosed
                    as such — a genuine caveat on its own line beside the
                    footer, per the standing footer convention. */}
                {snapshot && <p className="ui-meta text-muted-fg">{t.fp.portfolio.diffNote}</p>}
                {/* R13.R5C.1 § 2.2 — this table now carries both marks, so it
                    carries the legend that explains them. The string is shared
                    with Weekly Changes rather than copied: one convention, one
                    sentence, no drift. */}
                {snapshot && <p className="ui-meta text-muted-fg">{t.fp.weeklyChanges.zeroDashNote}</p>}
              </div>
            }
          >
            {snapshot && snapshot.rows.length > 0 && (
              <HierarchicalTable rows={snapshot.rows} dates={snapshot.dates} masked={masked} />
            )}
          </TableCard>
        )}
      </MemberGate>
    </div>
  )
}

export default function FamilyPortfolioPortfolioPage() {
  return (
    <Suspense fallback={<AsyncState kind="loading" />}>
      <PortfolioPageInner />
    </Suspense>
  )
}
