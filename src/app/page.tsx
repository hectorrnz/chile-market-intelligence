'use client'

// R10 — the NMI institutional Home command center, in the approved Fable
// Liquid Glass language. One coherent decision surface: what needs attention,
// what changed, what is happening in the portfolio and the book, what is
// scheduled, what is moving — with honest per-module states and provenance.
//
// Substance rule: every pre-R10 Home module remains. R10.1 (user-directed
// follow-up) merged the macro pulse strip, the banded Chile/US macro card and
// the FX band into ONE Fable-styled Macro card — no indicator renders twice —
// and rebuilt the Watchlist, Chilean rates, sector heat map and Markets
// modules in the Fable idiom (News keeps its NH terminal anatomy by product
// rule). R10 ADDS the modules the platform already had real data for but Home
// never surfaced: a portfolio snapshot (existing /api/portfolios + the same
// valuation helpers /portfolio uses), a Structured Notes book snapshot
// (existing /api/structured-notes dashboard payload), a merged upcoming-events
// timeline (CMF dates + scheduled high-importance US releases + note
// observation dates — sorted purely by date, never by a fabricated score),
// and the Fable Current Actions card (real attention items from the existing
// risk-status and ingestion-health models). R10.2 (user-directed): no charts
// anywhere on Home, no workspace launcher (it duplicated the top nav rail),
// and no header subtitle. R10.3 (user-directed width/density rebalance): the
// analytical modules below the hero sit in two responsive three-column rows —
// Row A: Macro · Upcoming Events · Watchlist; Row B: Chilean Rates · Sector
// Heat Map · Markets — with News full-width below. Each card caps its dense
// content area (card-local scroll, CSS only) so the three cards in a row keep
// similar practical heights without measured-height JavaScript.
//
// Honesty rules applied throughout:
//  • No module fabricates: a failed fetch renders an error/unavailable state,
//    never an empty state and never a sample value.
//  • Zero events is rendered distinctly from a failed calendar load.
//  • There is no portfolio daily-P&L figure anywhere — the repository has no
//    portfolio value time series, so none is invented.
//  • Watchlist rows carry no sparkline: the static per-ticker history bundle
//    is stale (ends 2025-06) and covers 9 of 25 tickers — showing it as a
//    live trend would be dishonest, so it is omitted rather than faked.
//  • Every table/list keeps its own TableSourceFooter with a plain source
//    name and its OWN as-of — different sources are never merged under one
//    timestamp.
//
// Privacy (R10 supersedes the R9.6 "Home has no private values" finding by
// adding real portfolio/notes consumers — deliberately, with tests updated):
//   MASKED   — portfolio total market value, cost basis, unrealized P&L
//              amount, realized P&L, cash balance; the Structured Notes total
//              Nevada notional. All flow through the shared PrivacyValue
//              boundary (fails closed during hydration).
//   VISIBLE  — public market data (prices, indices, macro, FX, sectors,
//              news), user-derived percentages (unrealized P&L %), counts
//              (positions, notes, risk-status counts), dates, tickers, note
//              product names and public note metadata. Percentages and counts
//              disclose performance and composition, never an amount — the
//              same classification the Portfolio page documents.

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { DataSourceBadge } from '@/components/ui/DataSourceBadge'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import type { DataSourceStatus } from '@/lib/providers/types'
import { getAllCompanies } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { getAllIndicators, getByCategory } from '@/lib/data/macro'
import { getChileanRates } from '@/lib/data/chileanRates'
import { getSeriesByStaticId } from '@/config/macroSeries'
import { fetchEarningsCalendar, upcomingWithinDays, recentlyReported, type EarningsCalendarResult } from '@/lib/data/earningsCalendar'
import { fetchLiveNews, type NewsFetchResponse } from '@/lib/data/newsLive'
import { getNewsSourceCode, getNewsSourceColor } from '@/lib/news/sourceCodes'
import { getSectorPerformance } from '@/lib/data/sectorPerformance'
import { getIndexPerformance } from '@/lib/data/indexPerformance'
import { fetchFredReleaseCalendar, type FredCalendarFetchResult } from '@/lib/data/fredCalendar'
import { useMarketData } from '@/components/providers/MarketDataProvider'
import { useMacroData } from '@/components/providers/MacroDataProvider'
import { useGlobalRefresh } from '@/components/providers/useGlobalRefresh'
import { fetchStockSnapshots, fetchSectorPerformance, fetchIndexPerformance } from '@/lib/data/marketData'
import type { StockSnapshot, SectorSnapshot, IndexSnapshot } from '@/lib/providers/market/types'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { formatCLP, formatPct, formatMacroValue, formatMacroChange, changeColor, formatNewsTimestamp } from '@/lib/formatters'
import { valuePositions, calculatePortfolioTotals, type LatestPrice, type PortfolioTotals } from '@/lib/portfolio/valuation'
import type { MacroIndicator, ChileanRate } from '@/types'
import type { WatchlistItemRow } from '@/lib/db/repositories/watchlistRepository'
import type { StructuredNote } from '@/lib/structuredNotes/types'
import type { NoteDashboardMetrics, BookSummary } from '@/lib/structuredNotes/dashboard'
import { PageHeader } from '@/components/fable/PageHeader'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { TableCard } from '@/components/fable/TableCard'
import { AsyncState } from '@/components/fable/AsyncState'
import { ChangeIndicator } from '@/components/fable/ChangeIndicator'
import { CurrentActions, type CurrentAction } from '@/components/fable/CurrentActions'
import { PrivacyValue } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { Reveal } from '@/components/fable/motion'

// R10.1: one Macro surface — every indicator appears exactly once (copper in
// Chile, US 10Y leading US). R10.2 (user-directed): the rows carry NO charts —
// values and signed changes only.
const CHILE_MACRO_IDS = ['tpm', 'usdclp', 'cobre-lme', 'ipc-anual', 'imacec-anual', 'pib', 'desempleo']
const US_MACRO_IDS = ['us10y', 'fed-funds', 'us-cpi-anual', 'us-gdp', 'us-unemployment', 'dxy']

/** Merged upcoming-events window (days). Real dates only; disclosed in the card header. */
const EVENT_WINDOW_DAYS = 14

// Fable composition ratios — the HERO row keeps its deliberate asymmetry
// (Overview Row A language). The analytical rows below it are R10.3 responsive
// peer grids (see ANALYTIC_ROW), so only the hero constants remain.
const FABLE_HERO   = { flex: '1.7 1 400px',  minWidth: 'min(100%, 340px)' } as const
const FABLE_SIDE   = { flex: '1 1 280px',    minWidth: 'min(100%, 260px)' } as const
const FABLE_ACTION = { flex: '1.15 1 300px', minWidth: 'min(100%, 280px)' } as const

// R10.3 (user-directed): the two analytical rows are responsive three-column
// peer grids — 1 col below lg, 2 cols at lg (the third card spans both, so no
// isolated narrow card), 3 similar-weight cols from xl up.
const ANALYTIC_ROW = 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch'
const ANALYTIC_SPAN = 'lg:col-span-2 xl:col-span-1'
/** One shared cap for every dense in-card list on Home — cards in a row keep
 *  similar practical heights and excess content scrolls inside its card. */
const CARD_LIST_MAX_H = 420

// ── Shared local shells ──────────────────────────────────────────────────────

/** Fable card shell: glass section, h2 label header with a right slot, one footer slot. */
function HomeCard({ title, right, footer, children, className = '', style }: {
  title: React.ReactNode
  right?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <GlassSurface variant="card" as="section" className={`overflow-hidden flex flex-col ${className}`} style={style}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
        <h2 className="ui-label text-muted-fg">{title}</h2>
        {right && <div className="flex items-center gap-2 flex-wrap ml-auto">{right}</div>}
      </div>
      {children}
      {footer && (
        <div className="px-4 py-2.5 mt-auto shrink-0" style={{ borderTop: '1px solid var(--nv-line)' }}>
          {footer}
        </div>
      )}
    </GlassSurface>
  )
}

/** Divider-separated hero mini stat. Private amounts pass `masked`; public stats don't. */
function SnapshotStat({ label, value, masked, tone }: { label: string; value: string; masked?: boolean; tone?: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="ui-meta text-muted-fg">{label}</span>
      {masked === undefined ? (
        <span className="ui-number text-sm text-foreground">{value}</span>
      ) : (
        <PrivacyValue masked={masked} className="ui-number text-sm">
          <span className="ui-number text-sm" style={tone ? { color: tone } : undefined}>{value}</span>
        </PrivacyValue>
      )}
    </div>
  )
}

/** Fable macro row: label · value · signed change. No chart (R10.2, by user
 *  direction) and no truncation — the label wraps so it stays readable at
 *  every card width. */
function PulseRow({ ind }: { ind: MacroIndicator }) {
  return (
    <li className="nv-row-hover flex items-center gap-3 py-2 px-1 border-b border-border last:border-0">
      <span className="text-xs text-muted-fg min-w-0 flex-1">{ind.shortName}</span>
      <span className="ui-number text-sm text-foreground shrink-0 text-right min-w-[72px]">{formatMacroValue(ind.value, ind.unit)}</span>
      <ChangeIndicator
        value={ind.change ?? null}
        label={ind.changeLabel ? formatMacroChange(ind.changeLabel) : undefined}
        className="shrink-0 min-w-[60px] justify-end"
      />
    </li>
  )
}

/** Strong-contrast heat-map tile shading: extremes saturate, mid-range stays light. */
function sectorTileStyle(pct: number, maxAbs: number) {
  if (pct === 0 || maxAbs === 0) return {}
  const intensity = 14 + (Math.abs(pct) / maxAbs) * 40 // 14% … 54%
  const color = pct > 0 ? 'var(--positive)' : 'var(--negative)'
  return { backgroundColor: `color-mix(in oklab, ${color} ${intensity.toFixed(0)}%, var(--surface))` }
}

/** Local calendar day (YYYY-MM-DD) — never the UTC slice, which is tomorrow in Chile every evening. */
function localIsoDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Upper bound of the events window, as a local calendar day. */
function eventCutoffIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + EVENT_WINDOW_DAYS)
  return localIsoDate(d)
}

/** DD/MM from a date-only ISO string, sliced (never parsed — a bare date must not shift a day). */
function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

// ── Portfolio snapshot types (mirrors the /api/portfolios/[id] payload the
// Portfolio page reads; only the fields Home consumes are declared) ──────────

interface PfPositionLite {
  ticker: string
  quantity: number
  averageCost: number | null
  costCurrency: string
  sector: string | null
  latestPrice: number | null
}

interface PfDetailLite {
  positions: PfPositionLite[]
  totals: PortfolioTotals
  cashSummary: { netCashBalance: number } | null
  realizedPnl: { totalRealizedPnl: number } | null
}

type ModuleState = 'loading' | 'ready' | 'error' | 'unavailable'

// ── Ingestion health (same sanitized shape Settings reads from /api/health/ingestion) ──

type HealthStatus = 'healthy' | 'warning' | 'stale' | 'failed' | 'unknown'

interface IngestionHealthLite {
  overallStatus: HealthStatus
}

const HEALTH_DOT: Record<HealthStatus, string> = {
  healthy: 'var(--positive)',
  warning: 'var(--warning)',
  stale: 'var(--warning)',
  failed: 'var(--negative)',
  unknown: 'var(--muted-fg)',
}

// ── Upcoming-events model (merged, date-sorted; each source stays attributed) ──

type HomeEventKind = 'earnings' | 'usRelease' | 'noteObservation'

interface HomeEvent {
  id: string
  date: string // YYYY-MM-DD
  kind: HomeEventKind
  label: string
  sub: string | null
  href: string
}

const EVENT_DOT: Record<HomeEventKind, string> = {
  earnings: 'var(--accent)',
  usRelease: 'var(--primary)',
  noteObservation: 'var(--warning)',
}

const RISK_DOT: Record<string, string> = {
  safe: 'var(--positive)', watch: 'var(--warning)', breached: 'var(--negative)', autocallable: 'var(--accent)', unavailable: 'var(--muted-fg)',
}

// ── Pure fetchers (module scope, no setState) — every state write lands in a
// `.then` callback inside the effect/handler, per the React Compiler rules. ──

/** Same endpoints /portfolio reads: list → default portfolio → detail. Null = failed. */
async function fetchPortfolioSnapshot(signal?: AbortSignal): Promise<PfDetailLite | null> {
  try {
    const listRes = await fetch('/api/portfolios', { cache: 'no-store', signal })
    if (!listRes.ok) return null
    const listJson = await listRes.json()
    const pf = listJson.portfolios?.[0]
    if (!pf) return null
    const detailRes = await fetch(`/api/portfolios/${pf.id}`, { cache: 'no-store', signal })
    if (!detailRes.ok) return null
    const json = await detailRes.json()
    return {
      positions: json.positions ?? [],
      totals: json.totals,
      cashSummary: json.cashSummary ?? null,
      realizedPnl: json.realizedPnl ?? null,
    }
  } catch {
    return null
  }
}

type BookResult =
  | { kind: 'ready'; data: { notes: StructuredNote[]; metrics: NoteDashboardMetrics[]; summary: BookSummary } }
  | { kind: 'unavailable' }
  | { kind: 'error' }

/** The same dashboard payload /structured-notes reads. 503 = not configured. */
async function fetchBookSnapshot(signal?: AbortSignal): Promise<BookResult> {
  try {
    const res = await fetch('/api/structured-notes', { cache: 'no-store', signal })
    if (res.status === 503) return { kind: 'unavailable' }
    if (!res.ok) return { kind: 'error' }
    const json = await res.json()
    return { kind: 'ready', data: { notes: json.notes ?? [], metrics: json.metrics ?? [], summary: json.summary } }
  } catch {
    return { kind: 'error' }
  }
}

/** The same sanitized health endpoint Settings reads. Null = failed. */
async function fetchIngestionHealth(signal?: AbortSignal): Promise<IngestionHealthLite | null> {
  try {
    const res = await fetch('/api/health/ingestion', { cache: 'no-store', signal })
    if (!res.ok) return null
    return (await res.json()) as IngestionHealthLite
  } catch {
    return null
  }
}

export default function HomePage() {
  const { t, lang } = useLang()

  const companies = getAllCompanies()
  const snapshots = getAllSnapshots()
  const allIndicators = getAllIndicators()

  // Live macro overlay is shared platform-wide (see MacroDataProvider) — Update
  // on any tab refreshes it, and it survives navigating away from this page.
  // CL/US are never merged into one status (BCCh only ever covers Chile — a
  // shared status would misstate US freshness).
  const { liveIndicatorMap, clStatus: macroStatus, usStatus: usMacroStatus } = useMacroData()
  // One Update refreshes every live domain, on every tab — see useGlobalRefresh.
  const refreshAll = useGlobalRefresh()

  const byId = (id: string) => liveIndicatorMap[id] ?? allIndicators.find(i => i.id === id)
  const macroChile = CHILE_MACRO_IDS.map(byId).filter(Boolean) as MacroIndicator[]
  const macroUs = US_MACRO_IDS.map(byId).filter(Boolean) as MacroIndicator[]
  // FX rows are BCCh-only — every row here is a verified live BCCh series
  // (same 'FX' category the Macro page's live indicators use), never a
  // fabricated/unverified pair. Currently: USD/CLP, EUR/CLP. USD/CLP is
  // already a curated Chile row, so only the extras (EUR/CLP) append to the
  // Chile band — R10.1: no pair renders twice on this page.
  const fxRows = getByCategory('FX').map(fx => liveIndicatorMap[fx.id] ?? fx)
  const fxExtra = fxRows.filter(fx => !CHILE_MACRO_IDS.includes(fx.id))
  // One as-of per band, since each is backed by a different provider and they
  // refresh independently — a shared max would let the fresher half mask the
  // staler one. FX rows render inside the Chile band, so they share its as-of.
  const macroChileAsOf = [...macroChile, ...fxExtra].reduce((max, i) => (i.lastUpdated > max ? i.lastUpdated : max), '')
  const macroUsAsOf = macroUs.reduce((max, i) => (i.lastUpdated > max ? i.lastUpdated : max), '')
  const staticSectors = getSectorPerformance()
  const staticIndices = getIndexPerformance()

  // Live market snapshot is shared platform-wide (see MarketDataProvider).
  const { live } = useMarketData()
  // Supabase-persisted baseline (auto-loaded on mount, below live overlay in priority)
  const [supaStockMap, setSupaStockMap] = useState<Record<string, StockSnapshot>>({})
  const [supaSectors, setSupaSectors] = useState<SectorSnapshot[] | null>(null)
  const [supaIdxMap, setSupaIdxMap] = useState<Record<string, IndexSnapshot>>({})

  // Source-backed News module (never a static fallback — an unavailable live
  // fetch shows an honest empty state, not fabricated headlines).
  const [newsResult, setNewsResult] = useState<NewsFetchResponse | null>(null)
  // Live CMF earnings calendar (report/EEFF-sending dates). Never fabricated —
  // an unavailable fetch leaves the events honest about that source.
  const [earningsCal, setEarningsCal] = useState<EarningsCalendarResult | null>(null)
  // Scheduled US releases (FRED release calendar — dates + importance only).
  // null = still loading; 'unavailable' = the fetch failed or is unconfigured.
  const [fredCal, setFredCal] = useState<FredCalendarFetchResult | 'unavailable' | null>(null)

  useEffect(() => {
    let mounted = true
    Promise.all([
      fetchStockSnapshots().catch(() => null),
      fetchSectorPerformance().catch(() => null),
      fetchIndexPerformance().catch(() => null),
      fetchLiveNews().catch(() => null),
      fetchEarningsCalendar().catch(() => null),
      fetchFredReleaseCalendar(EVENT_WINDOW_DAYS).catch(() => null),
    ]).then(([stRes, secRes, idxRes, newsRes, calRes, fredRes]) => {
      if (!mounted) return
      if (stRes?.data.length) setSupaStockMap(Object.fromEntries(stRes.data.map(s => [s.ticker, s])))
      if (secRes?.data.length) setSupaSectors(secRes.data)
      if (idxRes?.data.length) setSupaIdxMap(Object.fromEntries(idxRes.data.map(i => [i.id, i])))
      if (newsRes) setNewsResult(newsRes)
      if (calRes) setEarningsCal(calRes)
      setFredCal(fredRes && fredRes.ok && fredRes.configured ? fredRes : 'unavailable')
    })
    return () => { mounted = false }
  }, [])

  // ── Portfolio snapshot — the SAME endpoints and valuation helpers the
  // Portfolio page uses (list → detail; live overlay via valuePositions +
  // calculatePortfolioTotals). No value is derived differently from /portfolio.
  const [pfDetail, setPfDetail] = useState<PfDetailLite | null>(null)
  const [pfState, setPfState] = useState<ModuleState>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetchPortfolioSnapshot(controller.signal).then((detail) => {
      if (controller.signal.aborted) return
      if (detail) { setPfDetail(detail); setPfState('ready') } else { setPfState('error') }
    })
    return () => controller.abort()
  }, [])

  // ── Structured Notes book snapshot — the same dashboard payload the
  // /structured-notes page reads. 503 = not configured → honest 'unavailable'.
  const [book, setBook] = useState<{ notes: StructuredNote[]; metrics: NoteDashboardMetrics[]; summary: BookSummary } | null>(null)
  const [bookState, setBookState] = useState<ModuleState>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetchBookSnapshot(controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.kind === 'ready') { setBook(result.data); setBookState('ready') } else { setBookState(result.kind) }
    })
    return () => controller.abort()
  }, [])

  // ── Ingestion health — the same sanitized endpoint Settings reads. A failed
  // request is never rendered as healthy or empty.
  const [health, setHealth] = useState<IngestionHealthLite | null>(null)
  const [healthState, setHealthState] = useState<ModuleState>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetchIngestionHealth(controller.signal).then((json) => {
      if (controller.signal.aborted) return
      if (json) { setHealth(json); setHealthState('ready') } else { setHealthState('error') }
    })
    return () => controller.abort()
  }, [])

  const doRefresh = useCallback(async () => {
    const [, newsRes, bookRes, healthRes] = await Promise.all([
      refreshAll(), fetchLiveNews(), fetchBookSnapshot(), fetchIngestionHealth(),
    ])
    if (newsRes) setNewsResult(newsRes)
    // The book carries live underlying prices and health is a live check —
    // both re-pull on Update. Portfolio totals re-value automatically from
    // the refreshed market overlay (same helpers, no second fetch).
    if (bookRes.kind === 'ready') { setBook(bookRes.data); setBookState('ready') } else { setBookState(bookRes.kind) }
    if (healthRes) { setHealth(healthRes); setHealthState('ready') } else { setHealthState('error') }
  }, [refreshAll])

  // Merge: static base → Supabase layer → live overlay (live always wins when present)
  const sectors = live?.sectors ?? supaSectors ?? staticSectors
  const sectorStatus: DataSourceStatus = live?.sectors ? 'live' : supaSectors ? 'persisted' : 'static'
  const indices = staticIndices.map(idx => {
    const lv = live?.indices.find(l => l.id === idx.id)
    if (lv) return { ...idx, value: lv.value, dayChangePct: lv.dayChangePct, ytdChangePct: lv.ytdChangePct }
    const si = supaIdxMap[idx.id]
    return si ? { ...idx, value: si.value, dayChangePct: si.dayChangePct, ytdChangePct: si.ytdChangePct } : idx
  })
  const indexStatus: DataSourceStatus = live?.indices.length ? 'live' : Object.keys(supaIdxMap).length ? 'persisted' : 'static'
  const sectorAsOf = live?.sectors ? live.lastUpdated : (supaSectors?.[0]?.lastUpdated ?? null)
  const indexAsOf = live?.indices.length ? live.lastUpdated : (Object.values(supaIdxMap)[0]?.lastUpdated ?? null)
  const maxSectorAbs = Math.max(...sectors.map(s => Math.abs(s.dayChangePct)))

  const snapshotMap = Object.fromEntries(snapshots.map(s => [s.ticker, s]))
  const companyMap = Object.fromEntries(companies.map(c => [c.ticker, c]))

  // Companies reporting inside the events window, from the live CMF calendar.
  // Empty (honest) when the calendar is unavailable — never fabricated.
  const upcomingCmf = earningsCal?.status === 'live'
    ? upcomingWithinDays(earningsCal.events, EVENT_WINDOW_DAYS)
    : []
  // Real "recently reported" = the most recent past CMF report dates.
  const recentCmf = earningsCal?.status === 'live'
    ? recentlyReported(earningsCal.events, 5)
    : []

  // Home's "Watchlist" table mirrors the user's real /watchlist selection
  // (Supabase-persisted, per Phase 6A). `/api/watchlists*` is auth-gated by
  // middleware — a 401 here means the session lapsed, never a data error.
  const [watchlistAuthed, setWatchlistAuthed] = useState<boolean | null>(null)
  const [watchlistTickers, setWatchlistTickers] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/watchlists', { cache: 'no-store' })
        if (!res.ok) { if (!cancelled) setWatchlistAuthed(false); return }
        const json = await res.json()
        const wl = json.watchlists?.[0]
        if (!wl) { if (!cancelled) { setWatchlistAuthed(true); setWatchlistTickers([]) }; return }
        const itemsRes = await fetch(`/api/watchlists/${wl.id}/items`, { cache: 'no-store' })
        if (!itemsRes.ok) { if (!cancelled) { setWatchlistAuthed(true); setWatchlistTickers([]) }; return }
        const itemsJson = await itemsRes.json()
        const items: WatchlistItemRow[] = itemsJson.items ?? []
        if (!cancelled) { setWatchlistAuthed(true); setWatchlistTickers(items.map(i => i.ticker)) }
      } catch {
        if (!cancelled) setWatchlistAuthed(false)
      }
    })()
    return () => { cancelled = true }
  }, [])
  const watchlistStatus: DataSourceStatus = live?.stocks && Object.keys(live.stocks).length ? 'live' : Object.keys(supaStockMap).length ? 'persisted' : 'static'
  const watchlistAsOf = live ? live.lastUpdated : (Object.values(supaStockMap)[0]?.lastUpdated ?? null)

  // Watchlist rows, sortable by Day Chg. or YTD % (click the column header to
  // toggle asc/desc; default is the natural watchlist order).
  const [watchlistSort, setWatchlistSort] = useState<{ key: 'dayChg' | 'ytd'; dir: 'asc' | 'desc' } | null>(null)
  const toggleWatchlistSort = (key: 'dayChg' | 'ytd') => {
    setWatchlistSort(prev => prev?.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' })
  }
  const watchlistRows = watchlistTickers
    .map(ticker => {
      const company = companyMap[ticker]
      const s = snapshotMap[ticker]
      const ls = live?.stocks[ticker]
      const ss = supaStockMap[ticker]
      const price = ls?.price ?? ss?.price ?? s?.price
      const dayPct = ls?.dayChangePct ?? ss?.dayChangePct ?? s?.dayChangePct
      const ytdPct = ss?.ytdChangePct ?? s?.ytdChangePct
      return { ticker, company, price, dayPct, ytdPct }
    })
    .filter((r): r is typeof r & { company: NonNullable<typeof r.company> } => Boolean(r.company))
  if (watchlistSort) {
    const { key, dir } = watchlistSort
    const field = key === 'dayChg' ? 'dayPct' : 'ytdPct'
    watchlistRows.sort((a, b) => {
      const av = a[field], bv = b[field]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return dir === 'desc' ? bv - av : av - bv
    })
  }
  const sortArrow = (key: 'dayChg' | 'ytd') => watchlistSort?.key === key ? (watchlistSort.dir === 'desc' ? ' ▼' : ' ▲') : ''

  // Drag-to-reorder Chilean rates (persisted to localStorage). Rows whose id
  // matches a verified live BCCh series overlay live value/change. The live
  // indicator's id is resolved via `getSeriesByStaticId(r.id)?.fallbackStaticId`
  // because a couple of rows are keyed differently in the live provider output
  // than in this static row's own id.
  const rates = getChileanRates()
  const [order, setOrder] = usePersistentState<string[]>('cmi.ratesOrder', rates.map(r => r.id))
  const orderedIds = [
    ...order.filter(id => rates.some(r => r.id === id)),
    ...rates.filter(r => !order.includes(r.id)).map(r => r.id),
  ]
  const rateOrder = orderedIds.map(id => rates.find(r => r.id === id)!) as ChileanRate[]
  const liveRateRows = rateOrder.map(r => {
    const liveId = getSeriesByStaticId(r.id)?.fallbackStaticId ?? r.id
    const liveInd = liveIndicatorMap[liveId]
    return liveInd ? { ...r, value: liveInd.value, change: liveInd.change, changeLabel: liveInd.changeLabel, _liveAsOf: liveInd.lastUpdated } : { ...r, _liveAsOf: undefined as string | undefined }
  })
  const ratesLiveCount = liveRateRows.filter(r => r._liveAsOf).length
  const ratesStatus: DataSourceStatus = ratesLiveCount > 0 ? macroStatus : 'static'
  const ratesAsOf = liveRateRows.reduce<string | null>((max, r) => (r._liveAsOf && (!max || r._liveAsOf > max) ? r._liveAsOf : max), null)
  const dragFrom = useRef<number | null>(null)
  const onDrop = (to: number) => {
    const from = dragFrom.current
    dragFrom.current = null
    if (from == null || from === to) return
    const ids = rateOrder.map(r => r.id)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    setOrder(ids)
  }

  // ── Portfolio display totals — byte-identical logic to the Portfolio page's
  // own `displayed` memo: overlay the shared live snapshot through the SAME
  // valuation helpers, so Home and /portfolio can never disagree.
  const pfTotals = useMemo<PortfolioTotals | null>(() => {
    if (!pfDetail) return null
    if (!live) return pfDetail.totals
    const pricesByTicker = new Map<string, LatestPrice>(
      pfDetail.positions.map((p) => {
        const lv = live.stocks[p.ticker]
        return [p.ticker.toUpperCase(), { price: lv?.price ?? p.latestPrice, currency: 'CLP' }]
      }),
    )
    const valued = valuePositions(
      pfDetail.positions.map((p) => ({
        ticker: p.ticker,
        quantity: p.quantity,
        averageCost: p.averageCost,
        costCurrency: p.costCurrency,
        sector: p.sector,
      })),
      pricesByTicker,
    )
    return calculatePortfolioTotals(valued)
  }, [pfDetail, live])

  const pfPriceStatus: DataSourceStatus = live ? 'live' : 'persisted'

  // ── Structured Notes derived snapshot values (same client-side derivations
  // the /structured-notes page makes over the same payload) ──────────────────
  const metricsById = useMemo(() => {
    const m: Record<string, NoteDashboardMetrics> = {}
    for (const x of book?.metrics ?? []) if (x.noteId) m[x.noteId] = x
    return m
  }, [book])

  const nextObs = useMemo(() => {
    let best: { date: string; days: number | null; name: string; id: string } | null = null
    for (const n of book?.notes ?? []) {
      if (n.status !== 'active' || !n.id) continue
      const m = metricsById[n.id]
      if (!m?.nextObservationDate) continue
      if (!best || m.nextObservationDate < best.date) {
        best = { date: m.nextObservationDate, days: m.daysToNextObservation, name: n.productName, id: n.id }
      }
    }
    return best
  }, [book, metricsById])

  // ── Attention items — real severities from the existing models only:
  // note risk status (breached > autocallable > watch), a due observation
  // (≤7 days), and a non-healthy ingestion run. No fabricated unified score;
  // one action per note, dominant reason wins.
  const actions = useMemo<CurrentAction[]>(() => {
    const list: CurrentAction[] = []
    for (const n of book?.notes ?? []) {
      if (n.status !== 'active' || !n.id) continue
      const m = metricsById[n.id]
      if (!m) continue
      const due = m.daysToNextObservation != null && m.daysToNextObservation <= 7
      let status: string | null = null
      let priority: CurrentAction['priority'] = 'medium'
      if (m.riskStatus === 'breached') { status = t.sn.riskBreached; priority = 'high' }
      // R10.2 (user-directed): an autocallable note is only ACTIONABLE when
      // its observation is close (≤7 days) — the full autocallable list
      // already lives on the Structured Notes dashboard.
      else if (m.riskStatus === 'autocallable' && due) { status = t.sn.riskAutocallable; priority = 'medium' }
      else if (m.riskStatus === 'watch') { status = t.sn.riskWatch; priority = 'medium' }
      else if (due) { status = t.home.actDueObs; priority = 'low' }
      if (!status) continue
      list.push({
        id: n.id,
        title: n.productName,
        priority,
        status,
        dueDate: due && m.nextObservationDate ? ddmm(m.nextObservationDate) : undefined,
        href: `/structured-notes/${n.id}`,
        actionLabel: t.fable.currentActions.view,
      })
    }
    if (health && health.overallStatus !== 'healthy' && health.overallStatus !== 'unknown') {
      list.push({
        id: 'ingestion-health',
        title: t.home.actHealth,
        priority: health.overallStatus === 'failed' ? 'high' : 'medium',
        status: t.settings.sources.status[health.overallStatus],
        href: '/settings',
        actionLabel: t.fable.currentActions.view,
      })
    }
    const rank = { high: 0, medium: 1, low: 2 } as const
    return list.sort((a, b) => rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title))
  }, [book, metricsById, health, t])

  // ── Merged upcoming events (next EVENT_WINDOW_DAYS days), sorted purely by
  // date. Each source keeps its own honest availability line below the list.
  const todayIso = localIsoDate()
  const events: HomeEvent[] = (() => {
    const cutoff = eventCutoffIso()
    const list: HomeEvent[] = []
    for (const e of upcomingCmf) {
      list.push({
        id: `cmf-${e.ticker}-${e.reportDate}`,
        date: e.reportDate,
        kind: 'earnings',
        label: e.ticker,
        sub: e.period,
        href: `/companies/${e.ticker}`,
      })
    }
    if (fredCal && fredCal !== 'unavailable') {
      for (const e of fredCal.events) {
        if (e.status !== 'scheduled' || e.importance !== 'High') continue
        if (e.date < todayIso || e.date > cutoff) continue
        list.push({ id: `fred-${e.id}`, date: e.date, kind: 'usRelease', label: e.name, sub: null, href: '/macro/calendar' })
      }
    }
    for (const n of book?.notes ?? []) {
      if (n.status !== 'active' || !n.id) continue
      const m = metricsById[n.id]
      if (!m?.nextObservationDate) continue
      if (m.nextObservationDate < todayIso || m.nextObservationDate > cutoff) continue
      list.push({
        id: `obs-${n.id}`,
        date: m.nextObservationDate,
        kind: 'noteObservation',
        label: n.productName,
        sub: n.isin,
        href: `/structured-notes/${n.id}`,
      })
    }
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
  })()

  const eventsLoading = earningsCal === null && fredCal === null && bookState === 'loading'
  const eventKindLabel: Record<HomeEventKind, string> = {
    earnings: t.home.evEarnings,
    usRelease: t.home.evRelease,
    noteObservation: t.home.evNoteObs,
  }

  // Privacy Mode — the ONE shared store; every private amount on this page
  // renders through PrivacyValue (fails closed during hydration).
  const [masked] = usePrivacyMode()

  const sessionDate = new Date().toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })

  return (
    <div className="w-full space-y-4">

      <Reveal>
        <PageHeader
          eyebrow={t.home.tag}
          title={t.home.title}
          actions={<UpdateDataButton onRefresh={doRefresh} />}
        />
      </Reveal>

      {/* ── Executive command strip: session date · data health · attention
          count. No workspace launcher (R10.2 — it duplicated the top nav
          rail) and deliberately NO market-freshness chip — each surface below
          carries its own as-of (one as-of per surface). */}
      <Reveal delayMs={40}>
        <GlassSurface variant="kpi" as="section" aria-label={t.home.stripLabel} className="px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-xs text-foreground font-medium capitalize">{sessionDate}</span>

          <span className="inline-flex items-center gap-1.5 text-xs text-muted-fg">
            <span
              className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
              style={{ backgroundColor: healthState === 'ready' && health ? HEALTH_DOT[health.overallStatus] : 'var(--muted-fg)' }}
              aria-hidden="true"
            />
            {t.home.stripHealth}:{' '}
            <span className="text-foreground font-medium">
              {healthState === 'loading' ? '…'
                : healthState === 'ready' && health ? t.settings.sources.status[health.overallStatus] ?? t.settings.sources.status.unknown
                : t.home.stripHealthUnavailable}
            </span>
          </span>

          <span className="inline-flex items-center gap-1.5 text-xs text-muted-fg">
            <span
              className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
              style={{ backgroundColor: actions.length > 0 ? 'var(--warning)' : 'var(--positive)' }}
              aria-hidden="true"
            />
            <span className="ui-number text-foreground font-medium">{actions.length}</span> {t.home.stripAttention}
          </span>
        </GlassSurface>
      </Reveal>

      {/* ── Hero region (Fable Overview Row A — deliberate asymmetry):
          portfolio snapshot · structured-notes snapshot · current actions. */}
      <Reveal delayMs={80}>
        <div className="flex flex-wrap items-stretch gap-4">

          {/* Portfolio snapshot — existing calculations, masked amounts. */}
          <GlassSurface variant="card" as="section" className="p-5 flex flex-col gap-2" style={FABLE_HERO}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="ui-label text-muted-fg">{t.portfolio.tag}</h2>
              <div className="flex items-center gap-2">
                {pfState === 'ready' && <MarketDataSourceBadge status={pfPriceStatus} />}
                <Link href="/portfolio" className="text-xs text-primary hover:underline whitespace-nowrap">{t.nav.portfolio} →</Link>
              </div>
            </div>
            {pfState === 'loading' && <AsyncState kind="loading" message={t.common.loading} />}
            {pfState === 'error' && <AsyncState kind="error" />}
            {pfState === 'ready' && pfTotals && pfDetail && (
              pfDetail.positions.length === 0 ? (
                <p className="text-xs text-muted-fg py-4">
                  <Link href="/portfolio" className="text-primary hover:underline">{t.home.pfEmpty}</Link>
                </p>
              ) : (
                <>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <PrivacyValue masked={masked}>
                      <span className="ui-kpi-hero text-foreground">{formatCLP(pfTotals.totalMarketValue)}</span>
                    </PrivacyValue>
                    <ChangeIndicator
                      value={pfTotals.totalUnrealizedPnLPct}
                      label={pfTotals.totalUnrealizedPnLPct != null ? `${formatPct(pfTotals.totalUnrealizedPnLPct)} ${t.portfolio.vsCostBasis}` : undefined}
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2" style={{ borderTop: '1px solid var(--nv-line)' }}>
                    <SnapshotStat
                      label={t.portfolio.unrealizedPnL}
                      value={pfTotals.totalUnrealizedPnL != null ? formatCLP(pfTotals.totalUnrealizedPnL) : '—'}
                      masked={masked}
                      tone={pfTotals.totalUnrealizedPnL == null ? undefined : pfTotals.totalUnrealizedPnL >= 0 ? 'var(--positive)' : 'var(--negative)'}
                    />
                    <SnapshotStat label={t.portfolio.totalCostBasis} value={formatCLP(pfTotals.totalCostBasis)} masked={masked} />
                    {pfDetail.cashSummary && (
                      <SnapshotStat label={t.portfolio.cashBalance} value={formatCLP(pfDetail.cashSummary.netCashBalance)} masked={masked} />
                    )}
                    {pfDetail.realizedPnl && (
                      <SnapshotStat label={t.portfolio.realizedPnL} value={formatCLP(pfDetail.realizedPnl.totalRealizedPnl)} masked={masked} />
                    )}
                    <SnapshotStat label={t.portfolio.positionCount} value={String(pfTotals.positionCount)} />
                  </div>
                  <div className="mt-auto pt-1">
                    <TableSourceFooter source={t.portfolio.source} asOf={live?.lastUpdated ?? null} />
                  </div>
                </>
              )
            )}
          </GlassSurface>

          {/* Structured Notes book snapshot — same payload as /structured-notes. */}
          <GlassSurface variant="card" as="section" className="p-5 flex flex-col gap-2" style={FABLE_SIDE}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="ui-label text-muted-fg">{t.nav.structuredNotes}</h2>
              <Link href="/structured-notes" className="text-xs text-primary hover:underline whitespace-nowrap">{t.nav.structuredNotes} →</Link>
            </div>
            {bookState === 'loading' && <AsyncState kind="loading" message={t.common.loading} />}
            {bookState === 'error' && <AsyncState kind="error" />}
            {bookState === 'unavailable' && <AsyncState kind="unavailable" />}
            {bookState === 'ready' && book && (
              book.summary.totalNotes === 0 ? (
                <p className="text-xs text-muted-fg py-4">{t.home.notesEmpty}</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="ui-kpi-hero text-foreground ui-number">{book.summary.activeNotes}</span>
                    <span className="text-xs text-muted-fg">{t.sn.dashLive}</span>
                  </div>
                  <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={t.sn.riskStatus}>
                    {([
                      ['safe', book.summary.safeNotes, t.sn.riskSafe, t.sn.legendSafe],
                      ['watch', book.summary.watchNotes, t.sn.riskWatch, t.sn.legendWatch],
                      ['autocallable', book.summary.autocallableNotes, t.sn.riskAutocallable, t.sn.legendAutocallable],
                      ['breached', book.summary.breachedNotes, t.sn.riskBreached, t.sn.legendBreached],
                    ] as const).map(([key, count, label, legend]) => (
                      <li key={key} className="inline-flex items-center gap-1 text-xs text-muted-fg" title={legend}>
                        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: RISK_DOT[key] }} aria-hidden="true" />
                        <span className="ui-number text-foreground font-medium">{count}</span> {label}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: '1px solid var(--nv-line)' }}>
                    <span className="ui-meta text-muted-fg">{t.sn.dashNotional}</span>
                    <PrivacyValue masked={masked} className="ui-number text-sm">
                      <span className="ui-number text-sm text-foreground">
                        {book.summary.currency} {book.summary.totalCurrentNotional.toLocaleString('en-US')}
                      </span>
                    </PrivacyValue>
                    {book.summary.mixedCurrency && (
                      <span className="ui-meta text-muted-fg">{t.home.notesMixedCcy}</span>
                    )}
                  </div>
                  {nextObs && (
                    <div className="flex flex-col gap-0.5">
                      <span className="ui-meta text-muted-fg">{t.sn.dashNextObs}</span>
                      <Link href={`/structured-notes/${nextObs.id}`} className="text-xs text-foreground hover:underline">
                        <span className="ui-number">{ddmm(nextObs.date)}</span>
                        {nextObs.days != null && <span className="text-muted-fg"> · {nextObs.days}d</span>}
                        <span className="text-muted-fg"> · </span>{nextObs.name}
                      </Link>
                    </div>
                  )}
                  <div className="mt-auto pt-1">
                    <TableSourceFooter source={t.sn.sourceMarket} asOf={book.summary.pricesAsOf} />
                  </div>
                </>
              )
            )}
          </GlassSurface>

          {/* Current Actions — the one solid deep-teal Fable card. Real items
              only: note risk states, due observations, ingestion health. */}
          <div style={FABLE_ACTION} className="flex flex-col">
            <CurrentActions actions={actions} viewAllHref="/structured-notes" className="flex-1" />
          </div>
        </div>
      </Reveal>

      {/* ── Row A (R10.3): Macro · Upcoming Events · Watchlist — three
          similar-weight analytical peers in one responsive grid; at lg the
          Watchlist spans both columns so no card sits isolated. */}
      <Reveal delayMs={120}>
        <div className={ANALYTIC_ROW}>

          {/* Macro — ONE surface for every indicator (R10.1 merged the pulse
              strip, the banded card and the FX band; TPM, USD/CLP and UST10
              previously rendered on two surfaces, USD/CLP on three). Chile
              and US stay separately fetched, badged and footed — BCCh vs
              FRED — since one shared badge could misstate whichever half
              didn't refresh. No charts in the rows (R10.2, user-directed). */}
          <HomeCard
            title={t.home.macroTitle.split('·')[0].trim()}
            right={<Link href="/macro" className="text-xs text-primary hover:underline">{t.nav.macro} →</Link>}
          >
            {/* Compact Home summary (R10.3): every indicator stays — the full
                per-band list scrolls inside the card; /macro is the deep view. */}
            <GlassSurface variant="dense" className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: CARD_LIST_MAX_H }}>
              <div className="bg-surface-2 px-4 py-1.5" style={{ borderLeft: '2px solid var(--accent)' }}>
                <div className="flex items-center justify-between">
                  <h3 className="ui-label text-foreground">Chile</h3>
                  <DataSourceBadge status={macroStatus} />
                </div>
              </div>
              <ul className="px-3 py-1">
                {macroChile.map(ind => <PulseRow key={ind.id} ind={ind} />)}
                {fxExtra.map(fx => <PulseRow key={fx.id} ind={fx} />)}
              </ul>
              {/* Per-band footers: this card is really two stacked lists from
                  two different providers, so each band carries the plain name
                  of the source that actually backs its rows. */}
              <div className="px-4 pt-1 pb-2">
                <TableSourceFooter source={t.home.macroSourceCl} asOf={macroChileAsOf || null} />
              </div>
              <div className="bg-surface-2 px-4 py-1.5" style={{ borderLeft: '2px solid var(--primary)' }}>
                <div className="flex items-center justify-between">
                  <h3 className="ui-label text-foreground">{t.home.macroUsTitle.split('·')[1]?.trim() ?? 'US'}</h3>
                  <DataSourceBadge status={usMacroStatus} provider="FRED" />
                </div>
              </div>
              <ul className="px-3 py-1">
                {macroUs.map(ind => <PulseRow key={ind.id} ind={ind} />)}
              </ul>
              <div className="px-4 pt-1 pb-2">
                <TableSourceFooter source={t.home.macroSourceUs} asOf={macroUsAsOf || null} />
              </div>
            </GlassSurface>
          </HomeCard>

          {/* Upcoming events — merged CMF + US releases + note observations,
              sorted purely by date; per-source availability disclosed. */}
          <HomeCard
            title={t.home.eventsTitle}
            right={<span className="ui-meta text-muted-fg">{t.home.eventsWindow}</span>}
            footer={
              <div className="space-y-0.5">
                <TableSourceFooter source={t.home.earningsCalSource} asOf={earningsCal?.status === 'live' ? (earningsCal.asOf ?? null) : null} />
                <TableSourceFooter source={t.home.macroSourceUs} />
                <TableSourceFooter source={t.home.evNotesSource} />
              </div>
            }
          >
            <GlassSurface variant="dense" className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: CARD_LIST_MAX_H }}>
              {eventsLoading ? (
                <AsyncState kind="loading" message={t.common.loading} />
              ) : (
                <div className="px-4 py-2">
                  {events.length === 0 ? (
                    <p className="text-xs text-muted-fg py-2">{t.home.eventsEmpty}</p>
                  ) : (
                    <ul>
                      {events.map(e => (
                        <li key={e.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0 nv-row-hover">
                          <span className="ui-number text-xs text-muted-fg w-11 shrink-0">{ddmm(e.date)}</span>
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-fg w-24 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: EVENT_DOT[e.kind] }} aria-hidden="true" />
                            {eventKindLabel[e.kind]}
                          </span>
                          <Link href={e.href} className={`text-xs hover:underline truncate min-w-0 ${e.kind === 'earnings' ? 'font-mono text-primary' : 'text-foreground'}`}>
                            {e.label}
                          </Link>
                          {e.sub && <span className="text-xs text-muted-fg shrink-0">{e.sub}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Per-source honesty: a failed source is disclosed, never
                      silently collapsed into "no events". */}
                  {earningsCal !== null && earningsCal.status !== 'live' && (
                    <p className="ui-meta text-muted-fg py-1">{t.home.evCmfUnavailable}</p>
                  )}
                  {fredCal === 'unavailable' && (
                    <p className="ui-meta text-muted-fg py-1">{t.home.evFredUnavailable}</p>
                  )}
                  {(bookState === 'error' || bookState === 'unavailable') && (
                    <p className="ui-meta text-muted-fg py-1">{t.home.evNotesUnavailable}</p>
                  )}
                  {recentCmf.length > 0 && (
                    <div className="mt-2 pt-1.5" style={{ borderTop: '1px solid var(--nv-line)' }}>
                      <h3 className="ui-label text-muted-fg mb-1">{t.home.recentlyReported}</h3>
                      <ul>
                        {recentCmf.map(e => (
                          <li key={`${e.ticker}-${e.reportDate}`} className="grid grid-cols-3 items-center py-1 border-b border-border last:border-0">
                            <Link href={`/companies/${e.ticker}`} className="text-xs font-mono text-primary hover:underline">{e.ticker}</Link>
                            <span className="text-xs text-muted text-center">{e.period}</span>
                            <span className="text-xs ui-number text-muted-fg text-right">{ddmm(e.reportDate)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </GlassSurface>
          </HomeCard>

          {/* Watchlist — the user's real /watchlist selection over the
              live/persisted/static price merge, in the Fable table idiom.
              (The FX band moved into the Macro card's Chile band — R10.1;
              the card was promoted into Row A as a visual peer of Macro and
              Events — R10.3.) */}
          <div className={`flex flex-col min-w-0 ${ANALYTIC_SPAN}`}>
          <TableCard
            title={t.home.watchlistTitle}
            controls={
              <>
                <MarketDataSourceBadge status={watchlistStatus} />
                <Link href="/watchlist" className="text-xs text-primary hover:underline">{t.watchlist.title} →</Link>
              </>
            }
            minWidth={430}
            maxHeight={420}
            className="flex-1"
            footer={<TableSourceFooter source={t.home.watchlistSource} asOf={watchlistAsOf} />}
          >
            <table className="w-full text-xs" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.home.watchlistTitle}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="sticky top-0 z-10 border-b border-border text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.home.ticker}</th>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="sticky top-0 z-10 border-b border-border text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.home.company}</th>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="sticky top-0 z-10 border-b border-border text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.home.price}</th>
                  {/* Sortable headers: real buttons inside the th (keyboard-
                      operable, same pattern as the Fable Stocks table). */}
                  <th scope="col" aria-sort={watchlistSort?.key === 'dayChg' ? (watchlistSort.dir === 'desc' ? 'descending' : 'ascending') : undefined} style={{ backgroundColor: 'var(--surface-table)' }} className="sticky top-0 z-10 border-b border-border text-right py-2.5 px-3 ui-table-header text-muted-fg">
                    <button
                      type="button"
                      onClick={() => toggleWatchlistSort('dayChg')}
                      title={`${t.common.sortBy} ${t.home.dayChg}`}
                      className="ui-table-header text-muted-fg hover:text-foreground nv-transition select-none whitespace-nowrap"
                    >
                      {t.home.dayChg}{sortArrow('dayChg')}
                    </button>
                  </th>
                  <th scope="col" aria-sort={watchlistSort?.key === 'ytd' ? (watchlistSort.dir === 'desc' ? 'descending' : 'ascending') : undefined} style={{ backgroundColor: 'var(--surface-table)' }} className="sticky top-0 z-10 border-b border-border text-right py-2.5 px-3 pr-4 ui-table-header text-muted-fg">
                    <button
                      type="button"
                      onClick={() => toggleWatchlistSort('ytd')}
                      title={`${t.common.sortBy} ${t.home.ytd}`}
                      className="ui-table-header text-muted-fg hover:text-foreground nv-transition select-none whitespace-nowrap"
                    >
                      {t.home.ytd}{sortArrow('ytd')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {watchlistAuthed === false ? (
                  <tr><td colSpan={5} className="px-4 py-4 text-center text-muted-fg">
                    <Link href="/login" className="text-primary hover:underline">{t.home.watchlistSignIn}</Link>
                  </td></tr>
                ) : watchlistAuthed === true && watchlistRows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-4 text-center text-muted-fg">
                    <Link href="/watchlist" className="text-primary hover:underline">{t.home.watchlistEmpty}</Link>
                  </td></tr>
                ) : watchlistRows.map(({ ticker, company: c, price, dayPct, ytdPct }) => (
                  <tr key={ticker} className="border-b border-border last:border-0 nv-row-hover nv-transition">
                    <td className="py-2 pl-4 pr-3"><Link href={`/companies/${ticker}`} className="font-mono text-primary hover:underline">{ticker}</Link></td>
                    <td className="py-2 px-3 text-foreground truncate max-w-[110px]">{c.shortName}</td>
                    <td className="py-2 px-3 text-right ui-number text-foreground">{price != null ? formatCLP(price) : '—'}</td>
                    <td className={`py-2 px-3 text-right ui-number ${dayPct != null ? changeColor(dayPct) : 'text-muted-fg'}`}>{dayPct != null ? formatPct(dayPct) : '—'}</td>
                    <td className={`py-2 px-3 pr-4 text-right ui-number ${ytdPct != null ? changeColor(ytdPct) : 'text-muted-fg'}`}>{ytdPct != null ? formatPct(ytdPct) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
          </div>
        </div>
      </Reveal>

      {/* ── Row B (R10.3): Chilean Rates · Sector Heat Map · Markets — the
          market-breadth peers; at lg the Markets list spans both columns. */}
      <Reveal delayMs={160}>
        <div className={ANALYTIC_ROW}>

          {/* Chilean rates — drag to reorder, live BCCh overlay where a
              verified series exists; Fable list rows, scrolls inside card. */}
          <HomeCard
            title={t.home.chileanRates}
            right={<DataSourceBadge status={ratesStatus} />}
            footer={<TableSourceFooter source={t.home.ratesSource} asOf={ratesAsOf} />}
          >
            <GlassSurface variant="dense" className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: CARD_LIST_MAX_H }}>
              <ul>
                {liveRateRows.map((r, i) => (
                  <li
                    key={r.id}
                    draggable
                    onDragStart={() => { dragFrom.current = i }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => onDrop(i)}
                    className="px-4 py-2 border-b border-border last:border-0 flex items-center gap-2.5 cursor-grab active:cursor-grabbing nv-row-hover"
                  >
                    <span className="text-muted-fg select-none shrink-0" title={t.common.dragToReorder} style={{ fontSize: '11px' }}>⠿</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        {r._liveAsOf && <span className="inline-block rounded-full shrink-0" style={{ width: 6, height: 6, background: 'var(--positive)' }} title={t.dataSource.live} />}
                        <span className="truncate">{r.name}</span>
                      </div>
                      <div className="ui-meta text-muted-fg truncate">{r.fullName}</div>
                    </div>
                    <span className="ui-number text-sm text-foreground shrink-0">{formatMacroValue(r.value, r.unit)}</span>
                    <ChangeIndicator
                      value={r.change ?? null}
                      label={r.changeLabel ? formatMacroChange(r.changeLabel) : undefined}
                      className="shrink-0 min-w-[56px] justify-end"
                    />
                  </li>
                ))}
              </ul>
            </GlassSurface>
          </HomeCard>

          {/* Sector heat map — magnitude-shaded tiles, best/worst constituent. */}
          <HomeCard
            title={t.home.sectorHeatMap}
            right={<MarketDataSourceBadge status={sectorStatus} />}
            footer={
              <div className="flex items-center justify-between gap-3">
                <TableSourceFooter source={t.home.sectorSource} asOf={sectorAsOf} className="truncate" />
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-negative">−</span>
                  <span className="inline-block rounded" style={{ width: 56, height: 8, background: 'linear-gradient(to right, var(--negative), var(--surface-2), var(--positive))' }} aria-hidden="true" />
                  <span className="text-xs text-positive">+</span>
                </div>
              </div>
            }
          >
            <GlassSurface variant="dense" className="flex-1 p-3 min-h-0 overflow-y-auto" style={{ maxHeight: CARD_LIST_MAX_H }}>
              {/* R10.3: the card is now one grid column wide, so the tiles sit
                  2-across at every width — larger, readable tiles instead of
                  three crushed columns. 10 sectors = a clean 5×2; an odd count
                  gives the last tile the full row rather than an orphan cell. */}
              <div className="grid grid-cols-2 gap-2">
                {sectors.map((s, i) => {
                  const isLastAlone = i === sectors.length - 1 && sectors.length % 2 === 1
                  return (
                    <div
                      key={s.sector}
                      className={`border border-border rounded-md p-2 ${isLastAlone ? 'col-span-2' : ''}`}
                      style={sectorTileStyle(s.dayChangePct, maxSectorAbs)}
                    >
                      <div className="text-foreground leading-tight font-semibold" style={{ fontSize: '11px' }}>{s.sector}</div>
                      <div className="text-foreground font-bold ui-number" style={{ fontSize: '15px' }}>
                        {s.dayChangePct >= 0 ? '+' : ''}{s.dayChangePct.toFixed(2)}%
                      </div>
                      <div className="text-foreground ui-number" style={{ fontSize: '10px', opacity: 0.85 }}>
                        YTD {s.ytdChangePct > 0 ? '+' : ''}{s.ytdChangePct.toFixed(1)}%
                      </div>
                      <div className="text-foreground ui-number mt-1" style={{ fontSize: '10px' }}>
                        ▲ <span className="font-mono">{s.topContributor}</span> {s.topContributorPct >= 0 ? '+' : ''}{s.topContributorPct.toFixed(2)}%
                      </div>
                      <div className="text-foreground ui-number" style={{ fontSize: '10px' }}>
                        ▼ <span className="font-mono">{s.worstContributor}</span> {s.worstContributorPct >= 0 ? '+' : ''}{s.worstContributorPct.toFixed(2)}%
                      </div>
                    </div>
                  )
                })}
              </div>
            </GlassSurface>
          </HomeCard>

          {/* Markets — country on top, index below; Fable list rows, scrolls
              inside the card. */}
          <HomeCard
            title={t.home.marketsTitle}
            right={<MarketDataSourceBadge status={indexStatus} />}
            className={ANALYTIC_SPAN}
            footer={<TableSourceFooter source={t.home.indexSource} asOf={indexAsOf} />}
          >
            <GlassSurface variant="dense" className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: CARD_LIST_MAX_H }}>
              <ul>
                {indices.map(idx => (
                  <li key={idx.id} className="px-4 py-2 flex items-center justify-between gap-3 border-b border-border last:border-0 nv-row-hover">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">{idx.country}</div>
                      <div className="ui-meta text-muted-fg truncate">{idx.name}</div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs ui-number text-foreground">{idx.value.toLocaleString('es-CL')}</span>
                        <ChangeIndicator value={idx.dayChangePct} label={formatPct(idx.dayChangePct, 2)} />
                      </div>
                      <span className="ui-meta ui-number text-muted-fg">{formatPct(idx.ytdChangePct, 1)} YTD</span>
                    </div>
                  </li>
                ))}
              </ul>
            </GlassSurface>
          </HomeCard>
        </div>
      </Reveal>

      {/* ── News — source-backed live feed (see docs/data_source_status.md).
          Never falls back to fabricated headlines: an unavailable fetch shows
          an honest empty state. NH-style rows preserved exactly: newest-first,
          solid --negative bar for High impact, source code + timestamp, only
          affectedTickers rendered as chips. */}
      <Reveal delayMs={200}>
        <HomeCard
          title={t.home.newsTitle}
          right={
            <span className="flex items-center gap-1 text-xs text-muted-fg whitespace-nowrap">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                style={{
                  backgroundColor:
                    newsResult?.status === 'success' ? 'var(--positive)'
                    : newsResult?.status === 'partial_success' ? 'var(--warning)'
                    : newsResult ? 'var(--negative)' : 'var(--muted-fg)',
                }}
                aria-hidden
              />
              {newsResult?.status === 'success' ? t.home.newsLive
                : newsResult?.status === 'partial_success' ? t.home.newsPartial
                : newsResult?.status === 'unavailable' ? t.home.newsUnavailable
                : t.home.newsLoading}
            </span>
          }
        >
          <GlassSurface variant="dense" className="overflow-y-auto divide-y divide-border" style={{ maxHeight: '440px' }}>
            {newsResult && newsResult.data.length === 0 && (
              <div className="px-4 py-5 text-center text-xs text-muted-fg">{t.home.newsEmpty}</div>
            )}
            {newsResult?.data.map(item => {
              const isHigh = item.impactLevel === 'High'
              const sourceTitle = `${item.source} — ${item.sourceType === 'official' ? t.home.newsOfficialSource : t.home.newsMediaSource}`
              return (
                <div key={item.id} className="py-1.5">
                  <div
                    className={`flex items-start justify-between gap-3 px-4 ${isHigh ? 'py-1' : ''}`}
                    style={isHigh ? { backgroundColor: 'var(--negative)' } : undefined}
                  >
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline min-w-0">
                      <p className="text-xs leading-snug font-medium" style={isHigh ? { color: '#fff' } : undefined}>{item.headline}</p>
                    </a>
                    <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap pt-px">
                      <span className="ui-number text-[10px] font-mono font-semibold" title={sourceTitle} style={isHigh ? { color: '#fff' } : { color: getNewsSourceColor(item.source) }}>{getNewsSourceCode(item.source)}</span>
                      <span className="ui-number text-xs" style={isHigh ? { color: '#fff' } : { color: 'var(--muted-fg)' }}>{formatNewsTimestamp(item.publishedAt)}</span>
                    </span>
                  </div>
                  {item.summary && (
                    <p className="text-xs text-muted leading-snug mt-1 truncate px-4">{item.summary}</p>
                  )}
                  {item.affectedTickers.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1 px-4">
                      {item.affectedTickers.map(ticker => (
                        <Link key={ticker} href={`/companies/${ticker}`} className="text-[11px] font-mono px-1 py-0.5 bg-surface-2 text-primary border border-accent/40 rounded hover:border-accent transition-colors">{ticker}</Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </GlassSurface>
        </HomeCard>
      </Reveal>

    </div>
  )
}
