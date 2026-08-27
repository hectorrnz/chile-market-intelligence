'use client'

// R13.R2 — `/family-portfolio` — the Summary.
//
// Recomposed after the owner design review into this information architecture:
//
//   1. page identity + AUM HERO       — the latest total value, dominant
//   2. PERFORMANCE & MARKETS          — how did we do, versus the world?
//   3. ANALYTICAL ROW                 — Weekly Snapshot | Asset Allocation |
//                                       Weekly Notes, one shared surface
//   4. PORTFOLIO EVOLUTION            — how has that value moved?
//   5. provenance / freshness / disclosure
//
// Nothing was dropped in the reorder. The One Pager's per-line weekly close is
// still here (below the snapshot, where it reads as the snapshot's detail); the
// three allocation bases, both performance blocks, the InRetail portfolio
// impact, the dual freshness badge and the provisional-price disclaimer all
// remain.
//
// VISUAL COMPOSITION (owner design review, pass 2B). The page is a hierarchy,
// not a collection of cards: the latest total portfolio value leads at the
// KPI-hero scale directly under the page identity (PortfolioValueHero); the
// Performance & Markets band and the per-basis weekly results share ONE card
// (the results are the band's detail row, not a third stack of boxes); the
// Weekly Snapshot, Asset Allocation AND the Weekly Notes memo share ONE card
// split by hairline rules — a 3 : 5 : 4 row at xl, stacked in the same order
// below it — so the horizontal space the pass-1 pair wasted now carries the
// notes, the donut regains its size in the widest column, and the notes are
// still read BEFORE the evolution chart; the closing provenance block stays a
// frameless, rule-separated region rather than a further box.
//
// SCOPE (§ 10). The Summary now serves the caller's own personal portfolio as
// well as Main, chosen from the entitled list exactly as Holdings does. A
// personal scope shows only what it genuinely supports: its own single
// performance basis, its own single allocation denominator, its own weekly
// snapshot, plus the PUBLIC market context. It never shows Main's monetary
// values, Main's Ex/Incl-Chilean split, or another member's anything — and it
// does not receive them either, because the route filters every query to the
// requested scope and RLS re-derives that filter.
//
// THE CLIENT IS PRESENTATION, NEVER PROTECTION. Everything here is what
// /api/family-portfolio/overview/<scope> returned for THIS caller. A
// hand-edited `?scope=` resolves to the caller's own first scope without
// fetching, and a forged direct request is refused by the route and again by
// PostgreSQL RLS.
//
// PRIVACY. Every PORTFOLIO amount renders through MaskedAmount or a masked
// component; returns, weights and public benchmark prices follow the app's
// existing policy for non-wealth figures and stay visible. The evolution chart
// is REPLACED WHOLESALE when masked — unchanged from R13.7, and deliberately
// so: its axis, tooltip and crosshair readout all carry raw amounts, and § 23
// forbids weakening privacy to accommodate a new component.
//
// § 18 IS A TERMINOLOGY CONTRACT. The evolution series are portfolio VALUE
// LEVELS. Nothing derived from them is called a return anywhere on this page —
// the delta is "Value Change", and the note says outright that it is not an
// investment return.
//
// ── OWNER REVIEW PASS 4 ────────────────────────────────────────────────────
//
// § 2 · THE PLOTTED EVOLUTION EXCLUDES CAPITAL MOVEMENTS. A contribution moves a
// value level exactly as far as a gain of the same size, so the raw line jumped
// on weeks when the family moved money and read as performance that never
// happened. The chart now plots `value − Σ published net flows since the
// window's anchor`, which makes each step exactly the SOURCE'S OWN stated weekly
// P&L. The headline is therefore "Flow-adjusted portfolio value", the ACTUAL
// portfolio value stays the page's hero at the top, and the High Water Market is
// the peak of the line drawn rather than of a raw path nobody can see. Where a
// basis published no flow for a week, that step is not plotted at all — the raw
// level is never spliced in beside adjusted ones.
//
// § 4 · THE PERFORMANCE BAND IS A 2 × 2. Row 1 is the week (each basis' return
// beside its P&L, with the two market comparators immediately to their right);
// row 2 is what supports it (year-to-date and net flows per basis, and the
// InRetail market pair on Main). Nothing was dropped in the recomposition.
//
// § 1 · WEEKLY NOTES SAY WHY THEY CANNOT BE SAVED. The weekly-notes migration is
// deliberately unapplied during owner review, so the store is unreachable. The
// page carries that condition through as itself instead of flattening it into
// "the note could not be saved" or, worse, an empty list the panel would present
// as "no note has been written for this week".
//
// ── R13.R2F · FINAL VISUAL REFINEMENT ──────────────────────────────────────
//
// Presentation only — no figure changed, no derivation moved, no source claim
// was weakened. Four things did change, and each is documented where it lives:
//
//   § 1  ONE TYPOGRAPHIC SYSTEM, TOP TO BOTTOM. Every region — the hero, the
//        performance band, all three analytical columns, the evolution surface
//        — now opens with the same `ui-label` section heading on the same
//        `px-5` / `sm:px-6` gutter, and divides internally with hairlines only.
//        The page has the surfaces it had; what it no longer has is four
//        different internal rhythms inside them.
//
//   § 3  THE FLOW ADJUSTMENT IS UNMISSABLE. The chip reads as a qualifier of
//        the heading rather than a status badge, and the selected basis and
//        window are named in the KPI's own column.
//
//   § 4  THE EVOLUTION SURFACE LEADS WITH ITS VALUE CHANGE. The change takes
//        the KPI scale; the ACTUAL portfolio value stays beside it as a small
//        labelled cross-reference (§ 3 of the review requires the two to be
//        visibly separated, which needs both of them present); Compare carries
//        both bases' change under one caption, each with its series swatch.
//
//   § 9  THE HIGH WATER MARKET EXPLANATION IS A DISCLOSURE, NOT A HOVER
//        TOOLTIP — a `<details>` that opens on click, tap and keyboard alike,
//        in flow, so it can never cover the plot and the summary row stays
//        readable while the reader hovers anywhere on the chart.
//
// ── R13.R2F3 · PERSONAL UPPER PAGE COMPACTED ───────────────────────────────
//
// MAIN IS UNTOUCHED. Every region below still composes exactly as pass 4 /
// R13.R2F left it: the full-width Performance & Markets card, then the
// 3 : 5 : 4 Snapshot | Allocation | Notes row. Both are gated on `showNotes`
// (≡ `isMain` — the Weekly Notes product rule, `scopeHasWeeklyNotes`) so the
// two scopes can never disagree about which composition they are in.
//
// A PERSONAL SCOPE (one basis, no Notes) had the opposite problem from Main:
// its Performance card had far fewer figures than Main's but the same
// full-page-wide card, and its Snapshot | Allocation row — a four-line
// ledger beside a donut whose legend had just been released to stretch
// across the freed 9fr width — read as two mostly-empty surfaces stacked on
// top of each other, pushing Weekly Close by Line and Portfolio Evolution
// far down the page. It is now ONE row, ONE shared card, three columns —
// Performance | Weekly Snapshot | Asset Allocation, 4 : 3 : 5 — built from
// the exact same hairline-divided-column technique Main's own row already
// uses. `PerformanceMarketsStrip` renders `frameless` (no card chrome of its
// own) as that row's first column; Allocation drops back to its original
// `layout="compact"` centred donut-and-legend pair now that its column is a
// modest 5fr rather than 9fr. Nothing was dropped: the same performance
// groups, the same four snapshot rows, the same allocation entries and
// footnotes render exactly as before — see each component's own header
// comment for the detail.

import { Suspense, useEffect, useId, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { TableCard } from '@/components/fable/TableCard'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { PrivacyToggle, PrivacyValue } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'
import { useFamilyPortfolio } from '@/components/familyPortfolio/FamilyPortfolioProvider'
import { HierarchicalTable } from '@/components/familyPortfolio/HierarchicalTable'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { DualFreshnessBadge } from '@/components/familyPortfolio/DualFreshnessBadge'
import {
  PerformanceMarketsStrip,
  type StripGroup,
  type StripMetric,
} from '@/components/familyPortfolio/PerformanceMarketsStrip'
import { WeeklySnapshotCard, type SnapshotRow } from '@/components/familyPortfolio/WeeklySnapshotCard'
import { AllocationPanel } from '@/components/familyPortfolio/AllocationPanel'
import { AllocationSettingsDialog } from '@/components/familyPortfolio/AllocationSettingsDialog'
import { PortfolioValueHero } from '@/components/familyPortfolio/PortfolioValueHero'
// R13.R3B — the Summary value-change waterfall that stands beside Portfolio
// Evolution. It owns its own period rail and its own fetch; the page passes
// only the resolved scope, the privacy flag and the shared source string.
import { PeriodValueChangeCard } from '@/components/familyPortfolio/PeriodValueChangeCard'
import { SettingsGearButton } from '@/components/familyPortfolio/SettingsGearButton'
import {
  WeeklyNotesPanel,
  type WeeklyNoteSaveOutcome,
} from '@/components/familyPortfolio/WeeklyNotesPanel'
import { SummaryPrintSheet } from '@/components/familyPortfolio/SummaryPrintSheet'
import {
  PortfolioEvolutionChart,
  type EvolutionSeriesInput,
} from '@/components/familyPortfolio/PortfolioEvolutionChart'
import { formatTemplate } from '@/components/fable/chart/chartA11y'
// `changeColor` left with the pass-3 detail row: the band now owns its own
// signed-change tone, applied once inside `PerformanceMarketsStrip`.
import { formatUsd, formatRatioPct, formatIsoDateLabel } from '@/lib/formatters'
import { usePersistentState } from '@/lib/usePersistentState'
import {
  EVOLUTION_PERIODS,
  isEvolutionPeriod,
  selectEvolutionRange,
  sharedEndpoint,
  valueChange,
  type EvolutionPeriod,
} from '@/lib/familyPortfolio/evolutionRange'
import {
  DEFAULT_ALLOCATION_SETTINGS,
  type AllocationPresentationSettings,
} from '@/lib/familyPortfolio/allocationSettings'
import {
  highWaterMarket,
  shouldShowHighWaterMarket,
} from '@/lib/familyPortfolio/highWaterMarket'
import { buildFlowAdjustedSeries } from '@/lib/familyPortfolio/flowAdjustedEvolution'
import {
  MAX_WEEKLY_NOTE_LENGTH,
  scopeHasWeeklyNotes,
} from '@/lib/familyPortfolio/weeklyNotes'
import {
  fetchFamilyPortfolioOverview,
  fetchPresentationSettings,
  savePresentationSettings,
  createWeeklyNote,
  updateWeeklyNote,
  deleteWeeklyNote,
  type FamilyPortfolioOverviewResponse,
  type OverviewAllocationBasis,
  type OverviewMarketMetric,
} from '@/lib/data/familyPortfolio'

type FetchOutcome = 'ready' | 'denied' | 'error'
type SeriesMode = 'compare' | 'incl' | 'excl'
type BasisId = OverviewAllocationBasis['id']

interface FetchSlot {
  /** Which scope this result answers — a stale result is ignored at render. */
  key: string
  outcome: FetchOutcome
  data: FamilyPortfolioOverviewResponse | null
}

const EMPTY_POINTS: ReadonlyArray<{ date: string; value: number; flow?: number | null }> = []

/**
 * One band metric as the print sheet takes it.
 *
 * PRIVACY IS THE REASON THIS IS NOT A `string`. Returns and listed prices are
 * pre-formatted here, exactly as the band formats them, so the two surfaces
 * cannot drift. An AMOUNT is never formatted here: it travels as a NUMBER and
 * the sheet renders it through `MaskedAmount`, so a P&L figure obeys the page
 * mask on paper as it does on screen. Formatting it to text would print the
 * family's money straight through a mask the reader had deliberately switched on.
 *
 * A withheld figure prints the same em dash the band shows — never zero, never
 * silently dropped.
 */
function printMetric(m: StripMetric, groupTitle?: string) {
  const withheld = m.state !== 'ok' || m.value === null || !Number.isFinite(m.value)
  const label = groupTitle ? `${groupTitle} · ${m.label}` : m.label
  if (m.kind === 'amount') {
    return { key: m.key, label, amount: withheld ? null : m.value }
  }
  return {
    key: m.key,
    label,
    text: withheld ? '—' : m.kind === 'price' ? formatUsd(m.value!, 2) : formatRatioPct(m.value),
  }
}

function SummaryPageInner() {
  const { t, lang } = useLang()
  const o = t.fp.overview
  const { scopes } = useFamilyPortfolio()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [masked, setMasked] = usePrivacyMode()

  // --- Scope: DERIVED from the URL against the server-granted list, so there
  // is no local copy to fall out of sync. An unentitled or unknown `?scope=`
  // silently resolves to the caller's own first scope (nothing is fetched for
  // the requested one).
  const portfolioScopes = scopes.filter((s) => s.id !== 'alternatives')
  const requested = searchParams.get('scope')
  const activeScope = portfolioScopes.some((s) => s.id === requested)
    ? (requested as string)
    : (portfolioScopes[0]?.id ?? null)
  const isMain = activeScope === 'main'

  const [slot, setSlot] = useState<FetchSlot | null>(null)
  // A monotonic reload counter — the app's established refresh idiom
  // (`macroRefreshSeq`, `compareRefreshSeq`). Bumped after a Weekly Note is
  // saved so the note's revision and timestamp come back FROM THE SERVER
  // rather than being guessed at client-side.
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    if (!activeScope) return
    let cancelled = false
    ;(async () => {
      const result = await fetchFamilyPortfolioOverview(activeScope)
      if (cancelled) return
      if (!result.ok) {
        setSlot({ key: activeScope, outcome: result.status === 403 ? 'denied' : 'error', data: null })
        return
      }
      setSlot({ key: activeScope, outcome: 'ready', data: result.data })
    })()
    return () => {
      cancelled = true
    }
  }, [activeScope, reloadSeq])

  // --- Global presentation settings (§§ 14-15). Read once: they are product
  // configuration, not per-scope data. A failed read leaves the documented
  // defaults in place — a cosmetic preference must never break the page.
  const [settings, setSettings] = useState<AllocationPresentationSettings>(DEFAULT_ALLOCATION_SETTINGS)
  const [canEditSettings, setCanEditSettings] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchPresentationSettings()
      if (cancelled || !result.ok) return
      setSettings(result.data.settings)
      // Presentation convenience only — the PUT route re-derives administrator
      // capability server-side and the RLS write policy re-derives it again.
      setCanEditSettings(result.data.canEdit === true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSaveSettings(next: AllocationPresentationSettings): Promise<'saved' | 'error'> {
    const result = await savePresentationSettings(next)
    if (!result.ok) return 'error'
    setSettings(result.data.settings)
    return 'saved'
  }

  /**
   * R13.R2C §§ 8-12 — the three Weekly Note mutations. Each addresses ONE note,
   * then RELOADS, so the list, its order and every timestamp shown afterwards
   * are the server's own and never a client-side guess.
   *
   * A member never reaches any of these: the controls are not rendered for
   * them, and each route re-derives `entitlement.isAdministrator` regardless.
   */
  function noteOutcome(code: string): WeeklyNoteSaveOutcome {
    // The routes' own validation codes, surfaced as themselves rather than
    // flattened into a generic failure.
    if (code === 'note_empty') return 'empty'
    if (code === 'note_too_long') return 'too_long'
    // R13.R2 PASS 4 § 1 — the store itself is not reachable. Reported as its own
    // outcome so the panel names the real blocker (the unapplied weekly-notes
    // migration) instead of "the note could not be saved".
    if (code === 'schema_missing' || code === 'not_configured') return 'unavailable'
    return 'error'
  }

  async function handleCreateNote(body: string): Promise<WeeklyNoteSaveOutcome> {
    const publicationId = slot?.data?.publication?.id
    if (!publicationId || !activeScope) return 'error'
    const result = await createWeeklyNote(publicationId, activeScope, body)
    if (result.ok) {
      setReloadSeq((n) => n + 1)
      return 'saved'
    }
    return noteOutcome(result.code)
  }

  async function handleUpdateNote(noteId: string, body: string): Promise<WeeklyNoteSaveOutcome> {
    const publicationId = slot?.data?.publication?.id
    if (!publicationId) return 'error'
    const result = await updateWeeklyNote(publicationId, noteId, body)
    if (result.ok) {
      setReloadSeq((n) => n + 1)
      return 'saved'
    }
    return noteOutcome(result.code)
  }

  async function handleDeleteNote(noteId: string): Promise<'deleted' | 'error'> {
    const publicationId = slot?.data?.publication?.id
    if (!publicationId) return 'error'
    const result = await deleteWeeklyNote(publicationId, noteId)
    if (!result.ok) return 'error'
    setReloadSeq((n) => n + 1)
    return 'deleted'
  }

  const current = slot && slot.key === activeScope ? slot : null
  const loading = activeScope !== null && current === null
  const data = current?.outcome === 'ready' ? current.data : null
  const pub = data?.publication ?? null

  const activeLabel = portfolioScopes.find((s) => s.id === activeScope)
  const scopeLabel = activeLabel ? (lang === 'es' ? activeLabel.labelEs : activeLabel.labelEn) : ''
  const scopeHeading = scopeLabel
    ? formatTemplate(t.fp.scopeHeading, { scope: scopeLabel.toLocaleUpperCase(lang) })
    : ''

  function selectScope(next: string) {
    router.replace(`/family-portfolio?scope=${encodeURIComponent(next)}`, { scroll: false })
  }

  // ---------------------------------------------------------------------
  // Region 2 · Performance & Markets
  // ---------------------------------------------------------------------

  const blocks = data?.performanceBlocks ?? []
  const blockLabel = (basis: string) =>
    basis === 'ex_chilean_equities'
      ? o.blockExChilean
      : basis === 'with_chilean_equities'
        ? o.blockWithChilean
        : o.personalWeekly

  // OWNER REVIEW PASS 4 § 4A — INCLUDING CHILEAN EQUITIES LEADS. The owner reads
  // the total portfolio first, so the band orders the bases explicitly rather
  // than inheriting whatever order the parser emitted. A basis the week did not
  // publish simply does not appear; nothing is substituted for it.
  const orderedBlocks = isMain
    ? (['with_chilean_equities', 'ex_chilean_equities']
        .map((basis) => blocks.find((b) => b.basis === basis))
        .filter((b): b is (typeof blocks)[number] => b !== undefined))
    : blocks

  // R13.R2C §§ 2, 5, 27 — THE BAND'S TITLE STATES ITS HORIZON.
  //
  // Main's band compares two bases' WEEKLY returns against two weekly market
  // benchmarks — everything under it is weekly, so it is titled "Weekly
  // Performance" and no metric repeats "(weekly)".
  //
  // A personal scope's band carries BOTH horizons — weekly on row 1 beside the
  // market comparators, year-to-date and net flows on row 2 (R13.R2F § 11) —
  // because a personal portfolio has one basis and no second basis to compare
  // against. It is therefore titled plainly "Performance" and every metric
  // names its own horizon; a "Weekly" heading is never placed over the row
  // holding the YTD figures, which was simply untrue in an earlier pass.
  const performanceSectionTitle = isMain ? o.weeklyPerformanceTitle : o.performanceTitle

  // A personal scope publishes ONE basis, and it is never named with a Main
  // basis word (§ 28): no Incl./Excl. Chilean-equities label appears anywhere
  // on a personal Summary.
  const personalBlock = isMain ? null : (blocks[0] ?? null)

  const amountState = (v: number | null | undefined): StripMetric['state'] =>
    v === null || v === undefined || !Number.isFinite(v) ? 'unavailable' : 'ok'

  // ── § 4A/§ 4B · ROW 1 — THE WEEKLY FIGURES ────────────────────────────────
  //
  // Main pairs each basis' weekly return with its weekly P&L, so the two bases
  // can be compared line for line and against the market comparators beside
  // them. The metric labels are bare ("Return", "P&L") because the band's title
  // already says Weekly and the group already says which basis — § 2 forbids
  // repeating the horizon on every figure.
  //
  // A personal scope has ONE basis and its band mixes horizons, so it carries no
  // group title and each metric names its own horizon instead (§ 5).
  const portfolioPrimary: StripGroup[] = isMain
    ? orderedBlocks.map((b) => ({
        key: b.basis,
        title: blockLabel(b.basis),
        metrics: [
          {
            key: `${b.basis}-return`,
            label: o.metricReturn,
            value: b.weeklyReturn,
            kind: 'return' as const,
            state: b.weeklyReturn === null ? ('unavailable' as const) : ('ok' as const),
          },
          {
            key: `${b.basis}-pl`,
            label: o.metricProfit,
            value: b.weeklyProfit,
            kind: 'amount' as const,
            state: amountState(b.weeklyProfit),
          },
        ],
      }))
    : personalBlock === null
      ? []
      : [
          {
            key: 'personal-weekly',
            metrics: [
              {
                key: 'personal-weekly-return',
                label: o.personalWeekly,
                value: personalBlock.weeklyReturn,
                kind: 'return' as const,
                state: personalBlock.weeklyReturn === null ? ('unavailable' as const) : ('ok' as const),
              },
              {
                key: 'personal-weekly-pl',
                label: o.weeklyProfit,
                value: personalBlock.weeklyProfit,
                kind: 'amount' as const,
                state: amountState(personalBlock.weeklyProfit),
              },
            ],
          },
        ]

  // ── ROW 2 — THE SUPPORTING FIGURES ────────────────────────────────────────
  // Year-to-date and net flows, per basis. Nothing was dropped in the move: the
  // same four (Main) / three (personal) figures the pass-3 detail row carried
  // are here, now under the column they belong to.
  const portfolioSecondary: StripGroup[] = orderedBlocks.map((b) => ({
    key: `${b.basis}-secondary`,
    title: isMain ? blockLabel(b.basis) : undefined,
    metrics: [
      {
        key: `${b.basis}-ytd-return`,
        label: o.ytdReturn,
        value: b.ytdReturn,
        kind: 'return' as const,
        state: b.ytdReturn === null ? ('unavailable' as const) : ('ok' as const),
      },
      {
        key: `${b.basis}-ytd-pl`,
        label: o.ytdProfit,
        value: b.ytdProfit,
        kind: 'amount' as const,
        state: amountState(b.ytdProfit),
      },
      {
        key: `${b.basis}-flow`,
        label: o.flow,
        value: b.flow,
        kind: 'amount' as const,
        state: amountState(b.flow),
        title: o.flowHelp,
      },
    ],
  }))

  const metricState = (m: OverviewMarketMetric | undefined): StripMetric['state'] =>
    m === undefined ? 'unavailable' : m.status === 'ok' ? 'ok' : m.status
  const metricTitle = (m: OverviewMarketMetric | undefined, detail?: string): string | undefined => {
    if (m === undefined) return undefined
    if (m.status === 'unverified') return o.benchmarksPending
    if (m.status === 'unavailable') return o.marketUnavailable
    const observed = m.observationDate
      ? `${o.observedOn} ${formatIsoDateLabel(m.observationDate)}`
      : undefined
    return [detail, observed].filter(Boolean).join(' · ') || undefined
  }

  const mc = data?.marketContext
  // § 4A — the two weekly market comparators, and ONLY those two, beside the
  // weekly portfolio figures. Their labels lost "(weekly)" because the band's
  // title carries the horizon for everything in row 1.
  const marketsPrimary: StripGroup[] = [
    {
      key: 'comparators',
      metrics: [
        {
          key: 'globalEquity',
          label: o.globalEquity,
          value: mc?.globalEquity.value ?? null,
          kind: 'return' as const,
          state: metricState(mc?.globalEquity),
          title: metricTitle(mc?.globalEquity, o.globalEquityDetail),
        },
        {
          key: 'globalFixedIncome',
          label: o.globalFixedIncome,
          value: mc?.globalFixedIncome.value ?? null,
          kind: 'return' as const,
          state: metricState(mc?.globalFixedIncome),
          // The composition moves to the tooltip rather than being lost with the
          // "avg." the owner asked to drop from the visible label.
          title: metricTitle(mc?.globalFixedIncome, o.globalFixedIncomeDetail),
        },
      ],
    },
  ]

  // § 4A — InRetail is MARKET CONTEXT (a listed closing price and its variation),
  // and it moves OUT of the weekly comparison row into the supporting row. The
  // InRetail *portfolio-value impact* is a different figure and appears nowhere
  // in this band at all — it is a line of the Weekly close by line table below,
  // and the owner does not want it featured twice.
  //
  // Its BVL symbol is deliberately unverified, so both metrics render an honest
  // `—` while keeping their slot. Never a fabricated zero, a stale hidden
  // fallback, a Yahoo substitution, or a delayed ticker dressed as an official
  // close.
  const marketsSecondary: StripGroup[] = isMain
    ? [
        {
          // A React list key for the GROUP — deliberately not a bare `inretail`,
          // which reads like a market symbol; the page never names one.
          key: 'inretailGroup',
          title: o.inretailTitle,
          metrics: [
            {
              key: 'inretailPrice',
              label: o.inretailPrice,
              value: mc?.inretailPrice.value ?? null,
              kind: 'price' as const,
              state: metricState(mc?.inretailPrice),
              title: metricTitle(mc?.inretailPrice),
            },
            {
              key: 'inretailVariation',
              label: o.inretailVariation,
              value: mc?.inretailVariation.value ?? null,
              kind: 'return' as const,
              state: metricState(mc?.inretailVariation),
              title: metricTitle(mc?.inretailVariation),
            },
          ],
        },
      ]
    : []

  const anyUnverified =
    mc !== undefined && Object.values(mc).some((m) => m.status === 'unverified')

  // ---------------------------------------------------------------------
  // Region 3 · Weekly snapshot + allocation
  // ---------------------------------------------------------------------

  const snap = data?.weeklySnapshot
  const snapshotRows: SnapshotRow[] = [
    {
      key: 'boy',
      label: o.snapBeginningOfYear,
      dateLabel: pub?.dates.beginningOfYear ? formatIsoDateLabel(pub.dates.beginningOfYear) : null,
      value: snap?.beginningOfYear ?? null,
    },
    {
      key: 'prev',
      label: o.snapPreviousWeek,
      dateLabel: pub?.dates.previousWeek ? formatIsoDateLabel(pub.dates.previousWeek) : null,
      value: snap?.previousWeek ?? null,
    },
    {
      key: 'this',
      label: o.snapThisWeek,
      dateLabel: pub ? formatIsoDateLabel(pub.dates.thisWeek) : null,
      value: snap?.thisWeek ?? null,
    },
    {
      key: 'diff',
      label: o.snapDifference,
      dateLabel: null,
      // DERIVED server-side as `thisWeek − previousWeek` through the shared
      // invariant; the publication's persisted figure is a cross-check only.
      value: snap?.difference ?? null,
      isDifference: true,
      // Shown ONLY on a genuine disagreement — reconciled weeks stay quiet.
      warning:
        snap?.differenceStatus === 'mismatch' ? t.fp.portfolio.differenceMismatch : undefined,
    },
  ]

  // ── OWNER REVIEW PASS 2 §§ 3-6 · the snapshot's basis and its flow note ──
  //
  // WHICH BASIS. Not inferred: the route builds the snapshot from the row the
  // PARSER NUMERICALLY BOUND to the scope's performance basis at publish time —
  // `with_chilean_equities` for Main (row `main.total`, label TOTAL, type
  // portfolio_total) and `total` for a personal scope. So the four figures are
  // the TOTAL portfolio, Chilean equities included, and the page says so.
  //
  // THE FLOW IDENTITY, PROVEN NOT ASSUMED. `weekly_profit` and `flow` are
  // SOURCE-PROVIDED figures (`source_provided_return` / `source_provided_flow`)
  // — never NMI derivations — and across the whole live book they satisfy
  //
  //     This Week − Previous Week  =  Weekly Profit / Loss + Net Flows
  //
  // exactly: 427 basis-weeks (main ex-CL 101, main with-CL 31, jaime 101,
  // andres 101, pablo 93), 0 failures, 0 indeterminate, worst relative
  // deviation 5.2e-15 — floating point. It is also structurally guaranteed
  // rather than lucky: a performance block is published only if it binds to a
  // total row whose own value change reproduces the block's stated weekly
  // profit given its stated flow, and an unbindable block is refused
  // (`ambiguous_performance_basis`, blocking). One availability fact, stated
  // rather than smoothed over: Main's `with_chilean_equities` block exists from
  // 2026-01-02 onward (31 of the 102 published weeks); before that Main
  // published the ex-Chilean block alone. That bounds where the identity CAN be
  // shown, and never makes it wrong where it is.
  //
  // The equation is therefore rendered only when BOTH of its terms are actually
  // published for the basis on screen; otherwise the unconditional sentence
  // stands alone and claims nothing it cannot support.
  const snapshotBasisId = isMain ? 'with_chilean_equities' : 'total'
  const snapshotBlock = blocks.find((b) => b.basis === snapshotBasisId) ?? null
  const flowIdentitySupported =
    snapshotBlock !== null && snapshotBlock.flow !== null && snapshotBlock.weeklyProfit !== null

  // R13.R2C § 7 — Weekly Notes are a MAIN concept. A personal scope renders no
  // notes region at all, so the analytical row below becomes a two-column split
  // rather than a three-column one with a void in it (§ 14). The server applies
  // the same rule to the payload, so this is a layout consequence, not the gate.
  const showNotes = activeScope !== null && scopeHasWeeklyNotes(activeScope)

  const [basisId, setBasisId] = useState<BasisId>('total')
  const bases = data?.allocation ?? []
  const selectableBases = bases.filter((b) => b.status !== 'unavailable')
  const selectedBasis =
    bases.find((b) => b.id === basisId && b.status !== 'unavailable') ?? selectableBases[0] ?? null
  const basisLabel = (id: BasisId) =>
    id === 'total' ? o.basisTotal : id === 'ex_chilean' ? o.basisExChilean : o.basisExChileanExInretail

  const donutEntries = (selectedBasis?.entries ?? []).map((e) => ({
    key: e.rowKey,
    label: lang === 'es' ? e.labelEs : (e.labelEn ?? e.labelEs),
    weight: e.weight,
    value: e.value,
  }))

  // ---------------------------------------------------------------------
  // Region 4 · Portfolio evolution (§§ 16-22)
  // ---------------------------------------------------------------------

  const [period, setPeriod] = usePersistentState<EvolutionPeriod>('cmi.fpEvoPeriod', 'ALL')
  // R13.R2F § 2 — MAIN DEFAULTS TO INCL. CHILEAN EQUITIES, and now does so
  // without a coverage compromise: that basis carries the full 102-week
  // flow-adjusted history (R13.R2E.1), and it is the basis the page's own AUM
  // hero reports, so the chart and the headline describe the same portfolio.
  const [seriesMode, setSeriesMode] = usePersistentState<SeriesMode>('cmi.fpEvoMode', 'incl')
  // R13.R2E § 14 — the headline no longer tracks the cursor: it carries the
  // ACTUAL portfolio value, a different quantity from the plotted path, so
  // linking it to a hover on that path would put two unlike figures under one
  // date. The per-date readout of the plotted path lives in the chart tooltip.
  // The keyboard-reachable High Water Market help beside the chart heading
  // (owner review § 8) — its tooltip needs a stable id for aria-describedby.
  const hwmTipId = useId()

  // R13.R2C §§ 18, 28 — A PERSONAL SCOPE HAS ONE SERIES AND ONE BASIS.
  //
  // The route returns Main's two-basis pair OR a personal scope's `total`, never
  // both. So a personal Summary offers no Compare, no Incl., no Excl.: those
  // words name a split a personal portfolio does not have, and a control that
  // implies otherwise is a claim about the data. The period rail (1M | 3M | YTD
  // | 1Y | ALL) is shared unchanged, and the existing truncated-history
  // behaviour handles a period that predates the portfolio's own record.
  const totalPoints = data?.evolution?.total ?? EMPTY_POINTS
  const inclPoints = isMain ? (data?.evolution?.withChilean ?? EMPTY_POINTS) : totalPoints
  const exclPoints = isMain ? (data?.evolution?.exChilean ?? EMPTY_POINTS) : EMPTY_POINTS
  const hasEvolution = inclPoints.length > 0 || exclPoints.length > 0

  const safePeriod = isEvolutionPeriod(period) ? period : 'ALL'
  const storedMode: SeriesMode =
    seriesMode === 'compare' || seriesMode === 'incl' || seriesMode === 'excl' ? seriesMode : 'incl'
  // A persisted Main mode must never leak onto a personal scope — the single
  // series is always the one that is drawn there.
  const safeMode: SeriesMode = isMain ? storedMode : 'incl'

  // ══ R13.R2E §§ 9-13 · THE STABLE FLOW-ADJUSTED SERIES ═══════════════════
  //
  // WHAT THIS LINE IS. Not observed AUM. It is a DERIVED ANALYTICAL SERIES —
  // the portfolio-value path with source-supported external contributions and
  // withdrawals removed, so a week in which the family moved money does not
  // read as performance. Its week-over-week step is exactly the source's own
  // published weekly P&L, because the publication contract guarantees
  // `Δvalue = weekly_profit + flow` (verified across 427 basis-weeks, worst
  // relative deviation 5.2e-15). It is not a time-weighted return index and is
  // never called one.
  //
  // ADJUSTED ONCE, FROM THE RECORD — THEN SLICED. Pass 4 adjusted AFTER the
  // window was chosen, which anchored the path at the window's own opening
  // level and made the SAME calendar date carry a DIFFERENT adjusted value
  // depending on the range selected. Measured on the live book, that spread
  // reached 13.80% of Jaime's actual portfolio value between the 1M and ALL
  // views for one and the same date — a level that moves when you touch a
  // control is not a level. So the adjustment now runs once over the whole
  // record, from a deterministic anchor, and the period rail SLICES the result:
  // stable geometry, a stable crosshair, a stable High Water Market, and ranges
  // that can be compared with one another.
  //
  // Period Value Change is then the change between the slice's own first and
  // last adjusted observations — still, by the identity above, the published
  // P&L across exactly that window.
  //
  // FULL HISTORY ON EVERY SERIES (R13.R2E.1 §§ 2-4). The flow field is a SPARSE
  // EVENT field: a blank contribution/withdrawal cell means no money moved, not
  // that the figure is unknown. R13.R2E read a blank as unknown and so cut
  // Main's Incl. Chilean Equities line to its last 32 weeks merely because that
  // basis' performance block was unmaintained before 2026 — an unmaintained
  // block means nobody computed the RETURN that week, and says nothing about
  // whether capital moved. All five series now run their whole record: Main
  // Incl. 102, Main Excl. 102, Jaime 102, Andrés 102, Pablo 94. Nothing else
  // changed — the net flow removed from Main Incl. is identical either way,
  // because every flow it states falls inside those last 32 weeks.
  const inclAdjusted = useMemo(() => buildFlowAdjustedSeries(inclPoints), [inclPoints])
  const exclAdjusted = useMemo(() => buildFlowAdjustedSeries(exclPoints), [exclPoints])

  // Compare pins BOTH series to one endpoint so neither line is drawn past its
  // own record; a single series uses its own latest observation. Computed on the
  // ADJUSTED series (§ 18): the shared endpoint must be a date both plotted
  // lines actually reach.
  const compareEnd = useMemo(
    () => sharedEndpoint(inclAdjusted.points, exclAdjusted.points),
    [inclAdjusted, exclAdjusted],
  )
  const endpointOverride = safeMode === 'compare' ? compareEnd : null

  // The range controls SLICE the stable series. They never rebuild it.
  const inclRange = useMemo(
    () => selectEvolutionRange(inclAdjusted.points, safePeriod, endpointOverride),
    [inclAdjusted, safePeriod, endpointOverride],
  )
  const exclRange = useMemo(
    () => selectEvolutionRange(exclAdjusted.points, safePeriod, endpointOverride),
    [exclAdjusted, safePeriod, endpointOverride],
  )

  const activeRanges =
    safeMode === 'compare' ? [inclRange, exclRange] : safeMode === 'incl' ? [inclRange] : [exclRange]

  // A personal series is labelled with the neutral value label, never a Main
  // basis name.
  const singleSeriesLabel = isMain ? o.evoModeIncl : o.evoAdjustedValueLabel

  const chartSeries: EvolutionSeriesInput[] = (
    safeMode === 'compare'
      ? ([
          { key: 'incl' as const, label: o.evoModeIncl, colorVar: '--fp-series-incl', points: inclRange.points },
          { key: 'excl' as const, label: o.evoModeExcl, colorVar: '--fp-series-excl', points: exclRange.points },
        ])
      : safeMode === 'incl'
        ? [{ key: 'incl' as const, label: singleSeriesLabel, colorVar: '--fp-series-incl', points: inclRange.points }]
        : [{ key: 'excl' as const, label: o.evoModeExcl, colorVar: '--fp-series-excl', points: exclRange.points }]
  ).filter((s) => s.points.length > 0)

  const headlineRange = safeMode === 'excl' ? exclRange : inclRange
  const headlineAdjusted = safeMode === 'excl' ? exclAdjusted : inclAdjusted
  const headlinePoints = headlineRange.points

  // ── § 10 · ACTUAL PORTFOLIO VALUE, kept apart from the plotted path ──────
  // The real published level at the basis' own latest source date, read from
  // the RAW observations — never from the adjusted line, whose endpoint differs
  // from it by exactly the net flows removed (21.47% of Jaime's book over the
  // full record). This is the figure the page hero carries too, and § 14
  // forbids letting a derived level stand in for it under a generic label.
  const headlineRawPoints = safeMode === 'excl' ? exclPoints : inclPoints
  const actualLatest =
    headlineRawPoints.length > 0 ? headlineRawPoints[headlineRawPoints.length - 1] : null

  // True when the record holds observations but not one step of it carries a
  // READABLE net flow — an honest empty state, never the raw line quietly
  // restored. A blank flow is readable (it is zero); only a figure published in
  // an unreadable form reaches here, and none currently is.
  const flowAdjustmentImpossible =
    headlineRawPoints.length > 0 && headlineAdjusted.points.length === 0
  const activeAdjusted = safeMode === 'compare' ? [inclAdjusted, exclAdjusted] : [headlineAdjusted]

  // The earliest date from which the series could be adjusted at all, disclosed
  // ONLY when the selected window actually reaches back past it — on a short
  // period there is nothing being withheld and the note would be noise.
  const seriesAdjustableFrom = activeAdjusted
    .map((a) => a.adjustableFrom)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1) ?? null
  const rawRange = useMemo(
    () => selectEvolutionRange(headlineRawPoints, safePeriod, endpointOverride),
    [headlineRawPoints, safePeriod, endpointOverride],
  )
  const adjustableFrom =
    seriesAdjustableFrom !== null &&
    rawRange.startDate !== null &&
    rawRange.startDate < seriesAdjustableFrom
      ? seriesAdjustableFrom
      : null

  const headlineChange = valueChange(headlinePoints)

  // R13.R2F § 4 — THE VALUE CHANGE IS THE EVOLUTION SURFACE'S KPI, AND COMPARE
  // IS NOT AN EXCEPTION. Until this pass Compare rendered no change figure at
  // all: the block was gated on `safeMode !== 'compare'` because there are TWO
  // paths on screen and picking one of them to headline would have been
  // arbitrary. Showing neither was the worse answer — the owner reads Compare
  // precisely to see how the two bases diverged. So Compare now carries BOTH
  // changes, each named by its own basis and each read off ITS OWN plotted
  // slice over the shared endpoint window, so the two are directly comparable
  // and neither is presented as "the" figure.
  //
  // Same construction as the single-series KPI (`valueChange` over the sliced
  // stable adjusted series) — not a second derivation that could drift from it.
  const compareChanges = [
    { key: 'incl', label: o.evoModeIncl, change: valueChange(inclRange.points) },
    { key: 'excl', label: o.evoModeExcl, change: valueChange(exclRange.points) },
  ].filter((c) => c.change.absolute !== null)

  /** Sign → tone. Presentation only; the figure always carries its own sign. */
  const toneOf = (absolute: number | null) =>
    absolute !== null && absolute > 0
      ? 'text-positive'
      : absolute !== null && absolute < 0
        ? 'text-negative'
        : 'text-muted-fg'
  // PASS 2B § 4 — the Value Change KPI's signed-change tone. Presentation
  // only (sign → colour, the WeeklySnapshotCard difference precedent), derived
  // from the absolute change so a ratio the range module withholds (a
  // non-positive opening level) still tones the amount correctly. Meaning is
  // never colour-alone: the figure carries its own +/− sign and its label.
  const changeTone = toneOf(headlineChange.absolute)

  // Counted over the PLOTTED points: a week dropped for want of a published
  // flow is not on screen and must not be claimed as one.
  const rangeTotalPoints = activeRanges.reduce((n, r) => n + r.points.length, 0)
  const anyTruncated = activeRanges.some((r) => r.truncatedByHistory)

  // ── High Water Market (owner review §§ 15-20, pass 4 § 2) ───────────────
  // Derived from the observations ACTUALLY ON SCREEN — which are now the
  // FLOW-ADJUSTED ones — so the reference means "the peak of the line drawn",
  // never a peak of a raw contributed-value path the reader cannot see. The
  // tooltip says exactly that, and the AUM hero above keeps the actual portfolio
  // value distinct from it. § 18's visibility rules live in the shared helper,
  // not in this file, so the chart, the settings and the tests cannot disagree.
  //
  // PRIVACY (§ 20): the marker is withheld outright while amounts are masked.
  // The masked branch already replaces the whole chart, so this is redundant by
  // construction — and deliberately so, because the marker carries a raw amount
  // and must not become the one path that survives a future refactor of that
  // branch.
  const hwmVisible = shouldShowHighWaterMarket({
    period: safePeriod,
    seriesCount: chartSeries.length,
    mode: settings.referenceLine,
  })
  const hwmPoint = hwmVisible && !masked ? highWaterMarket(chartSeries[0]?.points ?? []) : null
  const hwmMarker = hwmPoint
    ? {
        value: hwmPoint.value,
        date: hwmPoint.date,
        label: o.hwmLabel,
        tooltip: o.hwmTooltip,
        setAtLabel: o.hwmSetAt,
      }
    : null

  const periodLabel = (p: EvolutionPeriod) =>
    p === '1M'
      ? o.evoPeriod1M
      : p === '3M'
        ? o.evoPeriod3M
        : p === 'YTD'
          ? o.evoPeriodYTD
          : p === '1Y'
            ? o.evoPeriod1Y
            : o.evoPeriodALL

  const evolutionProvenance =
    data?.evolutionSource === 'persisted_history'
      ? o.evolutionSourceHistory
      : o.evolutionSourcePublications

  // ---------------------------------------------------------------------

  return (
    <div className="w-full">
      {/* R13.R2C §§ 21-25 — the whole interactive composition is EXCLUDED from
          print. Paper gets the deliberate one-pager below instead: no
          navigation, no scope rail, no privacy toggle, no settings gear, no
          note editor, no chart range or series controls. Hiding chrome inside
          the live page would still leave its spacing behind. */}
      <div className="no-print">
      {/* One hierarchy level, not three: the module rail above already says
          where we are and the scope heading names the portfolio, so the
          near-equivalent "Portfolio" eyebrow is deliberately not stacked on
          top of it. Scope selector + privacy toggle wrap below the title on
          narrow widths via PageHeader's own min-w-0 flex-wrap contract. */}
      <PageHeader
        // § 7 — ONE coherent hierarchy, and one that matches its three sibling
        // pages so the header does not jump when switching module tabs. The
        // R13.7 header stacked three near-equivalent labels (eyebrow
        // "Portfolio" → title "Summary" → metadata "MAIN PORTFOLIO"); the
        // eyebrow now names the module tab and the title names the portfolio
        // being read, so nothing is repeated and the slot rhythm is preserved.
        eyebrow={t.fp.navOverview}
        title={scopeHeading || t.fp.navOverview}
        metadata={
          pub ? (
            <>
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
          <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
            {portfolioScopes.length > 1 && activeScope && (
              // Server-supplied scope labels can be long — the rail scrolls
              // inside its own wrapper rather than ever widening the page.
              <div className="max-w-full overflow-x-auto nv-scrollbar-hidden">
                <SegmentedControl
                  options={portfolioScopes.map((s) => ({
                    value: s.id,
                    label: lang === 'es' ? s.labelEs : s.labelEn,
                  }))}
                  value={activeScope}
                  onChange={selectScope}
                  ariaLabel={t.fp.portfolio.scopeSelector}
                  remeasureToken={lang}
                />
              </div>
            )}
            <PrivacyToggle masked={masked} onToggle={() => setMasked((prev) => !prev)} />
            {/* R13.R2C §§ 21, 30 — a PRINTER action, distinct from the gear.
                It prints the scope currently on screen, which is by
                construction a scope this caller is entitled to: the sheet
                renders the payload already fetched for them, so there is no
                second surface that could widen access (§ 26). */}
            <button
              type="button"
              onClick={() => window.print()}
              aria-label={o.printAction}
              title={o.printAction}
              className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-full text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M6 8V3.5h8V8" />
                <path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5v-4A1.5 1.5 0 0 1 4.5 8h11A1.5 1.5 0 0 1 17 9.5v4a1.5 1.5 0 0 1-1.5 1.5H14" />
                <rect x="6" y="12.5" width="8" height="4" rx="0.75" />
              </svg>
            </button>
          </div>
        }
      />

      <MemberGate>
        {loading && <AsyncState kind="loading" />}
        {current?.outcome === 'error' && <AsyncState kind="error" message={t.fp.portfolio.loadError} />}
        {current?.outcome === 'denied' && (
          <AsyncState kind="unavailable" message={t.fp.portfolio.notAuthorized} />
        )}
        {current?.outcome === 'ready' && !pub && (
          <AsyncState kind="empty" message={t.fp.portfolio.noPublication} />
        )}

        {current?.outcome === 'ready' && data && pub && (
          <div className="flex flex-col gap-5">
            {/* ── 1 · The AUM hero (owner review § 1) ───────────────────────
                The latest TOTAL portfolio value — the page's one focal
                figure, composed directly under the PageHeader's identity so
                eyebrow → portfolio name → figure name → headline value read as
                one block on one left edge. The value is the total INCLUDING
                Chilean equities; the basis is stated beneath it for Main and
                omitted for a personal scope, which has no Chilean-equities
                split to claim.

                R13.R2F § 1 — deliberately FRAMELESS. It is not a card, so it
                adds nothing to the page's card count; it is the last line of
                the page identity, and the surfaces below it are the report. */}
            <PortfolioValueHero
              value={data.hero?.totalValue ?? null}
              masked={masked}
              label={o.aumLabel}
              basis={isMain ? o.aumBasis : null}
              dateLabel={formatIsoDateLabel(pub.dates.thisWeek)}
            />

            {/* ── 2 · Performance & Markets — MAIN ONLY, here ──────────────
                OWNER REVIEW PASS 4 § 4 — ONE surface, TWO ROWS, TWO COLUMNS.
                Row 1 is the week: each basis' return beside its P&L, with the
                two market comparators immediately to their right. Row 2 is
                everything that supports it — year-to-date and net flows per
                basis, and the InRetail market pair on Main.

                Nothing was dropped in the recomposition: every figure the
                pass-3 band carried is still here, and the InRetail
                PORTFOLIO-VALUE impact stays exactly where it already was, as a
                line of the Weekly close by line table below, never featured a
                second time up here.

                R13.R2F3 — A PERSONAL SCOPE NO LONGER GETS THIS STANDALONE
                CARD. Spanning the full page width for a title, one weekly
                pair and two market comparators produced the mostly-empty band
                the owner flagged in review — Main's two bases and InRetail
                pair genuinely fill it; a personal scope's seven figures do
                not. Its performance content instead renders `frameless`
                inside the shared row immediately below (§ 3), as that row's
                first column — same data, same primitives, no second card. */}
            {showNotes && (
              <PerformanceMarketsStrip
                sectionTitle={performanceSectionTitle}
                portfolioLabel={o.portfolioGroup}
                marketsLabel={o.marketsGroup}
                portfolioPrimary={portfolioPrimary}
                marketsPrimary={marketsPrimary}
                portfolioSecondary={portfolioSecondary}
                marketsSecondary={marketsSecondary}
                masked={masked}
              />
            )}

            {/* ── 3 · [Performance |] Weekly snapshot | Asset allocation [| Weekly notes] ─
                OWNER REVIEW PASS 2B § 2 — one analytical row on ONE shared
                surface, split by hairline rules (vertical at xl, horizontal
                when stacked). Below xl the regions stack in the same reading
                order. The line-by-line weekly close stays grouped tightly
                beneath the row as the snapshot's own detail.

                MAIN keeps its R13.R2F § 7 proportions untouched — a
                deliberate 3 : 5 : 4 (Snapshot : Allocation : Notes), never
                three equal columns: the snapshot is a narrow four-line ledger
                and needs little width; the allocation takes the widest share
                so the donut keeps its size with the legend tight beside it;
                the notes memo fills the useful remaining right-hand width.

                R13.R2F3 — A PERSONAL SCOPE IS A 4 : 3 : 5 ROW OF ITS OWN:
                Performance : Snapshot : Allocation, no Notes column (§ 14).
                This is the composition the owner asked for directly —
                Performance, Snapshot and Allocation sharing one surface
                instead of Performance spanning the page alone above a
                second, separately-framed Snapshot | Allocation row below it.
                Performance carries the most content (up to seven figures
                across two rows) so it leads at 4; the ledger stays the same
                narrow 3 it has always been (four short lines need little
                width, regardless of how many siblings it has); Allocation
                keeps 5 — the same share Main gives it.

                R13.R2F4 (owner report) — that 5fr column is still the ROW'S
                LAST column here, with nothing after it, so a centred pair
                inside it reads as dead space on both sides rather than
                sitting beside a neighbour the way Main's centred Allocation
                sits beside its Notes column. Allocation therefore passes
                `layout="wide"` below (Main keeps `layout="compact"`, gated on
                the same `showNotes` flag that already splits these two rows):
                the ring anchors left at its full protected size and the
                legend — a plain name-left/weight-right ledger, no dotted
                leader (that was tried in R13.R2F3 and the owner rejected it
                as an "empty-field effect") — claims the rest of the column.
                `AllocationDonut` also now guarantees the pair can never wrap
                onto separate lines at `sm` and up, for either layout,
                regardless of the administrator's label-position setting (see
                its own header comment) — the reported bug was exactly that
                guarantee's absence, not merely a missing 'wide' call. */}
            <div className="flex flex-col gap-3">
              <GlassSurface
                variant="card"
                as="section"
                className={
                  showNotes
                    ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,5fr)_minmax(0,4fr)]'
                    : 'grid grid-cols-1 xl:grid-cols-[minmax(0,4fr)_minmax(0,3fr)_minmax(0,5fr)]'
                }
              >
                {!showNotes && (
                  <div
                    className="flex flex-col min-w-0 pb-4 border-b xl:border-b-0 xl:border-r"
                    style={{ borderColor: 'var(--nv-line)' }}
                  >
                    <PerformanceMarketsStrip
                      frameless
                      sectionTitle={performanceSectionTitle}
                      portfolioLabel={o.portfolioGroup}
                      marketsLabel={o.marketsGroup}
                      portfolioPrimary={portfolioPrimary}
                      marketsPrimary={marketsPrimary}
                      portfolioSecondary={portfolioSecondary}
                      marketsSecondary={marketsSecondary}
                      masked={masked}
                    />
                  </div>
                )}

                <div
                  className="flex flex-col min-w-0 pb-4 border-b xl:border-b-0 xl:border-r"
                  style={{ borderColor: 'var(--nv-line)' }}
                >
                  <WeeklySnapshotCard
                    title={o.weeklySnapshotTitle}
                    basisLabel={o.snapBasisTotal}
                    basisDetail={isMain ? o.snapBasisInclChile : null}
                    rows={snapshotRows}
                    masked={masked}
                    footnote={
                      snap?.difference !== null && snap?.difference !== undefined ? (
                        // R13.R2F5 § C (Opus correction) — these two stay
                        // STACKED: they sit in the narrowest column of the
                        // analytical row, where packing them side by side
                        // would crowd, not rebalance. But the 52ch cap is
                        // dropped — at the 11px meta size it binds tighter
                        // than the column itself does, so it was holding the
                        // note narrower than the space it already had.
                        <div className="flex flex-col gap-0.5">
                          <p className="ui-meta text-muted-fg">{o.snapFlowNote}</p>
                          {flowIdentitySupported && (
                            <p className="ui-meta text-muted-fg">{o.snapFlowIdentity}</p>
                          )}
                        </div>
                      ) : undefined
                    }
                  />
                </div>

                <AllocationPanel
                  title={o.allocationTitle}
                  entries={donutEntries}
                  settings={settings}
                  masked={masked}
                  summary={`${o.allocationTitle} — ${selectedBasis ? basisLabel(selectedBasis.id) : ''}`}
                  // R13.R2F4 — Main stays 'compact' (unchanged); a personal
                  // scope now passes 'wide' so its legend claims the
                  // column's freed width instead of centring with dead space
                  // either side of it (see the region-3 comment above).
                  layout={showNotes ? 'compact' : 'wide'}
                  basisControl={
                    selectableBases.length > 1 && selectedBasis ? (
                      <SegmentedControl
                        options={selectableBases.map((b) => ({ value: b.id, label: basisLabel(b.id) }))}
                        value={selectedBasis.id}
                        onChange={(v) => setBasisId(v)}
                        ariaLabel={o.allocationTitle}
                        remeasureToken={lang}
                      />
                    ) : undefined
                  }
                  onOpenSettings={canEditSettings ? () => setSettingsOpen(true) : undefined}
                  readOnlyNote={canEditSettings ? undefined : o.settingsReadOnly}
                  footer={
                    // R13.R2F5.1 § A — this column is the row's widest (5fr).
                    // `.nv-notes` keeps the source line, the note, the optional
                    // denominator line and any residual warnings STACKED at one
                    // left origin, and widens each to a 110ch measure so the
                    // freed width is used by line length rather than by a
                    // second starting column.
                    <div className="nv-notes">
                      <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
                      <p className="ui-meta text-muted-fg">{o.allocationNote}</p>
                      {selectedBasis && (
                        <p className="ui-meta text-muted-fg">
                          {o.denominator}:{' '}
                          {lang === 'es'
                            ? (selectedBasis.denominatorLabelEs ?? '—')
                            : (selectedBasis.denominatorLabelEn ?? selectedBasis.denominatorLabelEs ?? '—')}
                        </p>
                      )}
                      {bases
                        .filter((b) => b.residual !== null)
                        .map((b) => (
                          <p
                            key={b.id}
                            className="ui-meta flex items-center gap-1.5"
                            style={{ color: 'var(--warning)' }}
                          >
                            <span
                              aria-hidden
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: 'var(--warning)' }}
                            />
                            {basisLabel(b.id)}: {o.residualWarning}{' '}
                            <MaskedAmount value={b.residual} masked={masked} />
                          </p>
                        ))}
                    </div>
                  }
                />

                {/* Weekly notes — AUTHORED IN NMI, MAIN ONLY (R13.R2C §§ 7-12).
                    The row's third region on Main: several independent notes
                    beside the figures they annotate, each editable and
                    withdrawable on its own. A PERSONAL scope renders no third
                    column at all — not an empty one, and not invented filler
                    to make the geometry match (§ 14); the row above simply
                    becomes a two-column split. A member sees the notes with no
                    write affordance whatsoever. */}
                {showNotes && (
                  <div
                    className="flex flex-col min-w-0 border-t xl:border-t-0 xl:border-l"
                    style={{ borderColor: 'var(--nv-line)' }}
                  >
                    <WeeklyNotesPanel
                      notes={data.weeklyNotes ?? []}
                      canEdit={data.canEditNotes === true}
                      // A payload from before this field existed is treated as
                      // readable — the field narrows a claim, it never invents one.
                      availability={data.weeklyNotesState ?? 'ok'}
                      maxLength={MAX_WEEKLY_NOTE_LENGTH}
                      formatDate={formatIsoDateLabel}
                      onCreate={handleCreateNote}
                      onUpdate={handleUpdateNote}
                      onDelete={handleDeleteNote}
                      labels={{
                        title: o.notesTitle,
                        empty: o.notesEmpty,
                        add: o.notesAdd,
                        edit: o.notesEdit,
                        delete: o.notesDelete,
                        editorLabel: o.notesEditorLabel,
                        placeholder: o.notesPlaceholder,
                        save: o.notesSave,
                        saving: o.notesSaving,
                        saved: o.notesSaved,
                        cancel: o.notesCancel,
                        emptyError: o.notesEmptyError,
                        tooLongError: o.notesTooLong,
                        saveError: o.notesSaveError,
                        deleteError: o.notesDeleteError,
                        remaining: o.notesRemaining,
                        deleteTitle: o.notesDeleteTitle,
                        deleteBody: o.notesDeleteBody,
                        deleteConfirm: o.notesDeleteConfirm,
                        schemaMissing: o.notesSchemaMissing,
                        unavailable: o.notesUnavailable,
                        attribution: o.commentaryAttribution,
                      }}
                    />
                  </div>
                )}
              </GlassSurface>

              {/* Weekly close, line by line — the snapshot's own detail. */}
              <TableCard
                title={o.snapDetailTitle}
                state={data.comparison && data.comparison.length > 0 ? undefined : 'unavailable'}
                minWidth={760}
                footer={
                  // R13.R2F5.1 § A — was a hand-rolled horizontal wrap
                  // (`flex-wrap items-baseline gap-x-4`), which is exactly the
                  // pattern the owner rejected: the revision line began
                  // mid-table, to the right of the source. `.nv-notes` stacks
                  // all three at one left origin at a 110ch measure.
                  <div className="nv-notes">
                    <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
                    <p className="ui-meta text-muted-fg">
                      {t.fp.portfolio.revisionShort} {pub.revision} · {t.fp.portfolio.parserLabel}{' '}
                      {pub.parserVersion}
                    </p>
                    <p className="ui-meta text-muted-fg">{t.fp.portfolio.diffNote}</p>
                    {/* R13.R5C.1 § 2.2 — same legend, same shared string, for
                        the same table. */}
                    <p className="ui-meta text-muted-fg">{t.fp.weeklyChanges.zeroDashNote}</p>
                  </div>
                }
              >
                {data.comparison && data.comparison.length > 0 && (
                  <HierarchicalTable rows={data.comparison} dates={pub.dates} masked={masked} />
                )}
              </TableCard>
            </div>

            {/* ── 4 · Portfolio evolution | Portfolio value change ────────
                R13.R3B — TWO CHART CARDS, SIDE BY SIDE, ONE ROW.

                They are deliberately a PAIR, and the pairing is the point:
                the left card plots the flow-adjusted VALUE PATH over a period
                and the right card decomposes the ACTUAL VALUE CHANGE over one
                — the same portfolio, the same kind of window, the shape of the
                move beside the reasons for it. Each names its own basis in its
                own chip, because over the same window the two report different
                numbers by construction (the left has external capital removed,
                the right has not) and a reader must never take one for the
                other.

                Side by side from xl (the breakpoint the rest of this page
                already splits on); stacked, full width, in the same reading
                order below it. The grid stretches both cards to the row height
                so neither reads as the subordinate of the other — the owner
                asked for similar height and visual weight, and equal-height
                cells are how that is guaranteed rather than approximated.

                The evolution card below is UNCHANGED — it is only wrapped, so
                the diff stays reviewable; its inner indentation is deliberately
                left as it was rather than re-flowing four hundred lines. */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <GlassSurface
              variant="card"
              as="section"
              className="px-5 sm:px-6 py-5 flex flex-col gap-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
                <div className="flex flex-col min-w-0">
                  {/* PASS 4 § 2 — THE DISCLOSURE SITS ON THE TITLE LINE, not in
                      a footnote a reader has to go looking for: the line they
                      are about to read is not the raw account value, and that
                      has to be legible before they interpret it. The chip is the
                      short form; the sentence below the chart is the full one.
                      Both are present for the Main portfolio AND for every
                      personal scope.

                      R13.R2F § 3 — IT READS AS A QUALIFIER OF THE HEADING, not
                      as a status badge. The status DOT is gone (a dot in this
                      module means a live/warning state, which this is not) and
                      the chip now sits on the heading's own baseline in accent
                      ink on an accent tint, sized to be read at a glance rather
                      than discovered. */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
                    <h2 className="ui-label text-foreground">{o.evoTitle}</h2>
                    <span
                      className="ui-meta font-medium leading-snug inline-flex items-center px-2.5 py-1 rounded-full max-w-full"
                      style={{
                        color: 'var(--accent)',
                        backgroundColor: 'color-mix(in oklab, var(--accent) 14%, transparent)',
                      }}
                    >
                      {o.evoFlowAdjustedChip}
                    </span>
                  </div>

                  {/* ── R13.R2F § 4.1 · WHAT THE FIGURES BELOW DESCRIBE ───────
                      The KPI is read before the pill rails on the right of this
                      header are, so the selected basis and the selected window
                      are named in the KPI's OWN column rather than left to be
                      inferred from a control. These are label strings only —
                      each is the very same dictionary string its control
                      carries, so the two can never describe different things. */}
                  <p className="ui-meta text-muted-fg flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mt-1.5">
                    {isMain && (
                      <>
                        <span>
                          {safeMode === 'compare'
                            ? o.evoModeCompare
                            : safeMode === 'incl'
                              ? o.evoModeIncl
                              : o.evoModeExcl}
                        </span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span>{periodLabel(safePeriod)}</span>
                  </p>

                  {/* ── R13.R2E §§ 10, 14 · TWO FIGURES, NAMED APART ──────────
                      The plotted level is DERIVED, and showing it under a
                      generic "Portfolio Value" invited exactly the reading § 14
                      forbids — it sits below the real balance by precisely the
                      flows removed. So the two are named apart and never share
                      a slot.

                      R13.R2F1 § 2 — THE ACTUAL VALUE LEADS, and the change
                      supports it. R13.R2F had the change lead on the reasoning
                      that this surface answers "how did it move"; the owner
                      reversed it, and the reversal is sound on its own terms:
                      the reader's first question at a chart is WHAT IS IT WORTH
                      NOW, and the answer to that is a REAL published balance,
                      not a derived one. Promoting the real figure therefore
                      carries no § 14 risk — that rule forbids a DERIVED level
                      wearing a generic AUM-ish name, which is the opposite
                      arrangement. The change keeps its own name, its own tone
                      and a hairline of its own, so § 3's visible separation of
                      the two quantities survives the swap intact.

                      NOT A DUPLICATE OF THE PAGE HERO. The hero is always the
                      publication's TOTAL; this figure follows the SELECTED
                      BASIS, so on Excl. Chilean Equities it is a different
                      number about a different portfolio.

                      Ranking, in declared type sizes: page hero (30-40px) >
                      this actual value (23px) > the change and its ratio (14px)
                      > metadata (11px). */}
                  {hasEvolution && safeMode !== 'compare' && (
                    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 mt-3.5">
                      {actualLatest && (
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <span className="ui-micro-label text-muted-fg">
                            {o.evoActualValueLabel}
                          </span>
                          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <MaskedAmount
                              value={actualLatest.value}
                              masked={masked}
                              className="ui-number ui-chart-headline text-foreground"
                            />
                            <span className="ui-meta ui-number text-muted-fg">
                              {formatIsoDateLabel(actualLatest.date)}
                            </span>
                          </span>
                        </div>
                      )}
                      <div
                        className={`flex flex-col gap-1.5 min-w-0 ${
                          actualLatest ? 'sm:pl-6 sm:border-l' : ''
                        }`}
                        style={actualLatest ? { borderColor: 'var(--nv-line)' } : undefined}
                      >
                        <span className="ui-micro-label text-muted-fg">
                          {o.evoAdjustedValueChange}
                        </span>
                        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                          <MaskedAmount
                            value={headlineChange.absolute}
                            masked={masked}
                            signed
                            zeroDash
                            className={`ui-number text-sm font-semibold ${changeTone}`}
                          />
                          <span className={`ui-number text-sm font-semibold ${changeTone}`}>
                            {formatRatioPct(headlineChange.ratio)}
                          </span>
                        </span>
                      </div>
                    </div>
                  )}
                  {/* COMPARE — BOTH bases' change, each named and each carrying
                      its own series swatch so the figure and the line it came
                      from are unmistakably the same thing. Neither is "the"
                      figure, so neither takes the single-series headline scale,
                      and one shared caption names the metric once instead of
                      repeating it twice. */}
                  {hasEvolution && safeMode === 'compare' && compareChanges.length > 0 && (
                    <div className="flex flex-col gap-2 mt-3.5 min-w-0">
                      <span className="ui-micro-label text-muted-fg">
                        {o.evoAdjustedValueChange}
                      </span>
                      <div className="flex flex-wrap gap-x-8 gap-y-3 min-w-0">
                        {compareChanges.map((c) => (
                          <div key={c.key} className="flex flex-col gap-1 min-w-0">
                            <span className="ui-meta text-muted-fg flex items-center gap-1.5 min-w-0">
                              <span
                                aria-hidden
                                className="inline-block w-3.5 h-0.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    c.key === 'incl'
                                      ? 'var(--fp-series-incl)'
                                      : 'var(--fp-series-excl)',
                                }}
                              />
                              <span className="truncate min-w-0">{c.label}</span>
                            </span>
                            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                              <MaskedAmount
                                value={c.change.absolute}
                                masked={masked}
                                signed
                                zeroDash
                                className={`ui-number ui-capsule-value ${toneOf(c.change.absolute)}`}
                              />
                              <span
                                className={`ui-number text-sm font-semibold ${toneOf(c.change.absolute)}`}
                              >
                                {formatRatioPct(c.change.ratio)}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Period before series mode — the § 22 / R13.R2F § 4 reading
                    order: chart context → value change → ratio → period →
                    series → chart. The rails sit AFTER the KPI in the document
                    and to its right on a wide viewport, wrapping beneath it
                    when the header can no longer hold both. Each pill rail
                    scrolls inside its own wrapper on narrow viewports (the
                    FamilyPortfolioNav precedent) — the long series labels must
                    never widen the page. */}
                <div className="sm:ml-auto flex flex-wrap items-center justify-start sm:justify-end gap-2 min-w-0 max-w-full">
                  <div className="max-w-full overflow-x-auto nv-scrollbar-hidden">
                    <SegmentedControl
                      options={EVOLUTION_PERIODS.map((p) => ({ value: p, label: periodLabel(p) }))}
                      value={safePeriod}
                      onChange={(v) => setPeriod(v)}
                      ariaLabel={o.evoPeriodLabel}
                      remeasureToken={lang}
                    />
                  </div>
                  {/* R13.R2C §§ 18, 28 — the series rail is MAIN ONLY. Compare,
                      Incl. and Excl. name the Chilean-equities split, which a
                      personal portfolio does not have; offering the control
                      there would assert a basis distinction that does not
                      exist. Personal keeps the period rail and nothing else. */}
                  {isMain && (
                    <div className="max-w-full overflow-x-auto nv-scrollbar-hidden">
                      <SegmentedControl
                        options={[
                          { value: 'compare' as SeriesMode, label: o.evoModeCompare },
                          { value: 'incl' as SeriesMode, label: o.evoModeIncl },
                          { value: 'excl' as SeriesMode, label: o.evoModeExcl },
                        ]}
                        value={safeMode}
                        onChange={(v) => setSeriesMode(v)}
                        ariaLabel={o.evoSeriesLabel}
                        remeasureToken={lang}
                      />
                    </div>
                  )}
                  {/* The SAME settings dialog as the allocation gear (owner
                      review § 7) — one shared trigger component, present only
                      for an administrator; the period/series rails stay on
                      the chart and never move into settings. */}
                  {canEditSettings && (
                    <SettingsGearButton
                      onClick={() => setSettingsOpen(true)}
                      label={o.settingsEvolution}
                    />
                  )}
                </div>
              </div>

              {/* ── High Water Market summary (pass 2 §§ 18-20) ─────────────
                  A RESERVED BAND OUTSIDE THE PLOT. The chart's own tooltip is
                  absolutely positioned at `top: 2` INSIDE the chart's
                  container, which was exactly why it covered an in-plot label
                  drawn at the peak — the maximum always plots near the top.
                  A sibling ABOVE that container cannot be reached by it at
                  any hover position, so the name, the amount and the peak date
                  are permanently legible. The dashed swatch ties the row to
                  the reference line drawn below, in the same neutral token.

                  R13.R2F § 9 — THE EXPLANATION IS A DISCLOSURE, NOT A HOVER
                  TOOLTIP. The pass-2 treatment revealed the text on
                  `group-hover` / `group-focus-within` opacity, which a TOUCH
                  device cannot trigger at all — there is no hover, and a tap on
                  a non-focusing control leaves the reader with a term that can
                  be mistaken for the fee-calculation "high-water mark" and no
                  way to check. A native `<details>` fixes that in every input
                  mode at once: click, tap, and Enter/Space on the focused row
                  all open it, the open/closed state is announced, and
                  `aria-describedby` gives a screen reader the sentence whether
                  it is open or not.

                  It also opens IN FLOW rather than over the plot, so the
                  explanation can never cover chart data — the chart simply
                  moves down while it is open — and it has no absolutely
                  positioned panel that could reach past the page's width.

                  PRIVACY (§ 21): `hwmMarker` is null whenever amounts are
                  masked, so the whole band — label, amount, date, explanation
                  and all — is simply not rendered. The amount also goes through
                  MaskedAmount, so no future refactor of that branch can turn
                  this into the one leak. */}
              {hwmMarker !== null && (
                <details className="min-w-0">
                  <summary
                    aria-describedby={hwmTipId}
                    className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0 -mx-2 px-2 py-1 rounded-[var(--radius-cell)] hover:bg-surface-2 nv-transition"
                  >
                    <span
                      aria-hidden
                      className="inline-block w-4 shrink-0 self-center"
                      style={{ borderTop: '1px dashed var(--fp-hwm)' }}
                    />
                    <span className="ui-meta text-muted-fg">{o.hwmLabel}</span>
                    <MaskedAmount
                      value={hwmMarker.value}
                      masked={masked}
                      className="ui-number text-sm font-semibold text-foreground"
                    />
                    <span className="ui-meta text-muted-fg ui-number">
                      {o.hwmSetAt} {formatIsoDateLabel(hwmMarker.date)}
                    </span>
                    {/* The affordance: the ROW is the control, and this marks
                        it as one. It carries the help label as its accessible
                        name so the row's name says what expanding it gives —
                        the reference's own label would only repeat the figure
                        beside it — while the full explanation stays on
                        `aria-describedby`. */}
                    <span
                      role="img"
                      aria-label={o.hwmHelpLabel}
                      className="inline-flex items-center justify-center w-5 h-5 shrink-0 self-center rounded-full text-muted-fg"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        className="w-3.5 h-3.5"
                        aria-hidden="true"
                      >
                        <circle cx="10" cy="10" r="7.25" />
                        <path strokeLinecap="round" d="M10 9.2v4" />
                        <circle cx="10" cy="6.4" r="0.4" fill="currentColor" stroke="none" />
                      </svg>
                    </span>
                  </summary>
                  {/* In FLOW, on the card's own surface — never an overlay, so
                      it cannot cover the plot, and never wider than its own
                      column, so it cannot widen the page. */}
                  <p
                    id={hwmTipId}
                    className="ui-meta text-muted-fg leading-relaxed max-w-[78ch] mt-2 pl-2"
                  >
                    {o.hwmTooltip}
                  </p>
                </details>
              )}

              {!hasEvolution ? (
                <AsyncState
                  kind="empty"
                  message={isMain ? o.evolutionEmpty : o.evoUnavailablePersonal}
                />
              ) : masked ? (
                // § 23 — the chart is replaced WHOLESALE, exactly as in R13.7.
                // Its axis, tooltip and crosshair readout all carry raw
                // amounts, so hiding only the line would mask nothing. The
                // quiet panel holds the chart's footprint so toggling privacy
                // never reflows the page — and exposes no amount, axis or
                // tooltip.
                <div
                  className="flex items-center justify-center rounded-[var(--radius-cell)] bg-surface-2"
                  style={{ minHeight: 280 }}
                >
                  <PrivacyValue masked className="block text-center text-lg">
                    {null}
                  </PrivacyValue>
                </div>
              ) : chartSeries.length === 0 ? (
                <AsyncState
                  kind="empty"
                  message={flowAdjustmentImpossible ? o.evoFlowAdjustedUnavailable : o.evoNoRange}
                />
              ) : (
                <PortfolioEvolutionChart
                  series={chartSeries}
                  height={280}
                  formatValue={(v) => formatUsd(v)}
                  formatDate={(iso) => formatIsoDateLabel(iso)}
                  labels={{
                    summary: `${o.evoTitle} — ${o.evoAdjustedValueLabel}`,
                    tableAlternative: o.evoTableAlternative,
                    valueLabel: o.evoAdjustedValueLabel,
                  }}
                  highWaterMarket={hwmMarker}
                />
              )}

              {/* THE DISCLOSURE READS FROM ONE LEFT EDGE (R13.R2F5.1 § A).
                  `.nv-notes` stacks these blocks at a common origin and gives
                  each a 110ch measure, so the run fills the card's width by
                  LINE LENGTH rather than by columns.

                  The source line and the provenance line used to share one
                  `flex flex-wrap items-baseline` row, which put "Weekly source
                  history…" mid-card, to the right of "Source: RESUMEN
                  workbook" — the exact second starting column the owner
                  rejected. They are siblings of the band now, so each begins
                  where the other does. */}
              <div className="nv-notes pt-2.5" style={{ borderTop: '1px solid var(--nv-line)' }}>
                <TableSourceFooter source={t.fp.portfolio.source} />
                {hasEvolution && rangeTotalPoints > 0 && (
                  <p className="ui-meta text-muted-fg">
                    {/* PASS 4 § 2 — the span reported is the span PLOTTED. It
                        used to come from the raw window, which after the flow
                        adjustment could begin before the first point actually
                        on screen. */}
                    {evolutionProvenance} · {rangeTotalPoints} {o.evolutionPoints}
                    {headlinePoints.length > 0
                      ? ` · ${formatIsoDateLabel(headlinePoints[0].date)} — ${formatIsoDateLabel(headlinePoints[headlinePoints.length - 1].date)}`
                      : ''}
                  </p>
                )}
                {/* § 18 — stated in words, not left to the label alone. */}
                <p className="ui-meta text-muted-fg">{o.evoValueChangeNote}</p>
                {anyTruncated && <p className="ui-meta text-muted-fg">{o.evoTruncated}</p>}
                {/* PASS 4 § 2 — the flow-adjustment boundary, stated where the
                    reader is, not buried in a general note. Shown ONLY when
                    leading weeks were actually dropped, so it never appears as
                    boilerplate on the fully-adjustable series.

                    R13.R2E.1 § 2 — WHICH IS NOW EVERY SERIES IN THE BOOK. Under
                    the sparse-event rule a blank contribution/withdrawal cell
                    means no money moved, so an unmaintained performance block no
                    longer shortens anything: Main's Incl. Chilean Equities basis
                    runs the full 102 weeks from 2024-08-23 like every other. A
                    step is dropped only for a net-flow figure the source
                    published in a form that cannot be read, which no week
                    currently is — so this note is dormant, not dead: it is what
                    keeps an unreadable figure from being silently read as
                    "no money moved". */}
                {adjustableFrom !== null && (
                  <p className="ui-meta text-muted-fg">
                    {o.evoFlowAdjustedFrom} {formatIsoDateLabel(adjustableFrom)}
                  </p>
                )}
              </div>
            </GlassSurface>
              <PeriodValueChangeCard
                scope={activeScope}
                masked={masked}
                source={t.fp.portfolio.source}
              />
            </div>

            {/* ── 5 · Provenance / freshness / disclosure ──────────────────
                Complete but quiet: a rule-separated page footer, not a card. */}
            <div
              className="flex flex-col gap-2 pt-4"
              style={{ borderTop: '1px solid var(--nv-line)' }}
            >
              <DualFreshnessBadge
                entries={[
                  { label: o.freshnessPortfolio, asOfDate: data.freshness?.portfolio.asOfDate ?? null },
                  {
                    label: o.freshnessAlternatives,
                    asOfDate: data.freshness?.alternatives?.asOfDate ?? null,
                  },
                ]}
              />
              {/* R13.R2F5.1 § A — the badge above stays outside the band (it is
                  a control-like chip, not footnote text); the two disclosure
                  notes below it sit in `.nv-notes`, stacked at the same left
                  origin as the badge and each widened to a 110ch measure. */}
              <div className="nv-notes">
                {anyUnverified && <p className="ui-meta text-muted-fg">{o.benchmarksPending}</p>}
                <p className="ui-meta text-muted-fg">*** {o.provisionalDisclaimer}</p>
              </div>
            </div>
          </div>
        )}
      </MemberGate>
      </div>

      {/* ── The A4 one-pager (§§ 21-26) ──────────────────────────────────────
          Rendered from the payload ALREADY FETCHED for this caller and this
          scope — no second fetch, no second entitlement decision, so it cannot
          show anything the Summary itself would refuse. `masked` is passed
          through unchanged: printing while privacy mode is on prints masked
          figures rather than silently unmasking a portfolio the reader hid. */}
      {current?.outcome === 'ready' && data && pub && (
        <SummaryPrintSheet
          scopeHeading={scopeLabel || t.fp.navOverview}
          documentTitle={o.printTitle}
          asOfLabel={o.printAsOf}
          asOfDate={pub.asOfDate}
          revisionLabel={`${t.fp.portfolio.revisionShort} ${pub.revision}`}
          valueLabel={o.aumLabel}
          valueBasis={isMain ? o.aumBasis : null}
          totalValue={data.hero?.totalValue ?? null}
          performanceTitle={performanceSectionTitle}
          portfolioGroupLabel={o.portfolioGroup}
          marketsGroupLabel={o.marketsGroup}
          // PASS 4 §§ 3-4 — the SHEET IS DRIVEN BY THE SAME GROUPS AS THE BAND,
          // so paper cannot drift out of step with the screen. `tone` colours a
          // gain green and a loss red; a NET FLOW deliberately carries none — it
          // is capital moving, not a result, and green would read as profit.
          portfolioMetrics={portfolioPrimary.flatMap((g) =>
            g.metrics.map((m) => ({
              ...printMetric(m, g.title),
              tone: m.state === 'ok' ? m.value : null,
            })),
          )}
          marketMetrics={marketsPrimary.concat(marketsSecondary).flatMap((g) =>
            g.metrics.map((m) => ({
              ...printMetric(m, g.title),
              // A listed PRICE is a level, not a result — never toned.
              tone: m.state === 'ok' && m.kind !== 'price' ? m.value : null,
            })),
          )}
          detailGroups={portfolioSecondary.map((g) => ({
            // Main keeps its two basis groups; a personal group is unlabelled,
            // because naming it would require a basis word it does not have.
            title: g.title ?? '',
            metrics: g.metrics.map((m) => ({
              ...printMetric(m),
              // A NET FLOW is capital moving, not a gain or a loss — printing it
              // green would read as profit, so it is deliberately untoned.
              tone: m.state === 'ok' && !m.key.endsWith('-flow') ? m.value : null,
            })),
          }))}
          snapshotTitle={o.weeklySnapshotTitle}
          snapshotBasis={o.snapBasisTotal}
          snapshotRows={snapshotRows.map((r) => ({
            key: r.key,
            label: r.label,
            dateLabel: r.dateLabel,
            value: r.value,
            isDifference: r.isDifference,
          }))}
          snapshotNote={flowIdentitySupported ? o.snapFlowIdentity : o.snapFlowNote}
          allocationTitle={o.allocationTitle}
          allocationBasisLabel={selectedBasis ? basisLabel(selectedBasis.id) : null}
          allocationEntries={donutEntries}
          allocationSettings={settings}
          allocationDenominator={
            selectedBasis
              ? `${o.denominator}: ${
                  lang === 'es'
                    ? (selectedBasis.denominatorLabelEs ?? '—')
                    : (selectedBasis.denominatorLabelEn ?? selectedBasis.denominatorLabelEs ?? '—')
                }`
              : null
          }
          notesTitle={o.notesTitle}
          // MAIN ONLY (§ 24): a personal sheet carries no notes region, and no
          // sheet ever carries an Add/Edit/Delete control (§ 23).
          notes={showNotes ? (data.weeklyNotes ?? []).map((n) => ({ id: n.id, body: n.body })) : []}
          evolutionTitle={o.evoTitle}
          // PASS 4 § 2 — paper carries the SAME flow-adjusted line and therefore
          // the same disclosure; a printed sheet has no tooltip to fall back on.
          evolutionNote={o.evoValueChangeNote}
          evolutionPoints={headlinePoints}
          evolutionChangeLabel={o.evoAdjustedValueChange}
          evolutionChangeText={formatRatioPct(headlineChange.ratio)}
          evolutionChangeAmount={headlineChange.absolute}
          hwmLabel={o.hwmLabel}
          hwmValue={hwmMarker?.value ?? null}
          hwmDateLabel={hwmMarker ? `${o.hwmSetAt} ${formatIsoDateLabel(hwmMarker.date)}` : null}
          sourceLine={`${t.common.source}: ${t.fp.portfolio.source}`}
          disclaimer={o.provisionalDisclaimer}
          masked={masked}
          formatDate={formatIsoDateLabel}
        />
      )}

      <AllocationSettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  )
}

export default function FamilyPortfolioSummaryPage() {
  // `useSearchParams` requires a Suspense boundary in the App Router — the same
  // wrapper the Holdings page uses.
  return (
    <Suspense fallback={<AsyncState kind="loading" />}>
      <SummaryPageInner />
    </Suspense>
  )
}
