// R13.6 — client-safe fetch helpers for the Family Portfolio member surface.
//
// Same convention as every other `src/lib/data/*` helper: components never call
// providers, repositories or Supabase directly — they call these, which hit the
// `/api/family-portfolio/*` routes. Every route re-derives the caller's
// entitlement server-side; nothing here is an authorization decision.

/** One entitled scope, with its SERVER-SUPPLIED display labels (doc 07 § 7 —
 * unentitled principals' names never reach the browser, so no client-side
 * label map exists). */
export interface FamilyPortfolioScopeInfo {
  id: string
  labelEn: string
  labelEs: string
}

export interface FamilyPortfolioScopesResponse {
  scopes: FamilyPortfolioScopeInfo[]
  isAdministrator: boolean
}

export interface FamilyPortfolioWeek {
  asOfDate: string
  revision: number
  publishedAt: string
}

export interface FamilyPortfolioSnapshotRow {
  rowKey: string
  parentRowKey: string | null
  depth: number
  displayOrder: number
  rowType: string
  labelEs: string
  labelEn: string | null
  currency: string
  value: number | null
  valueClass: string
  previousValue: number | null
  beginningOfYearValue: number | null
  difference: number | null
  differenceClass: string | null
}

export interface FamilyPortfolioSnapshot {
  asOfDate: string
  revision: number
  publishedAt: string
  parserVersion: string
  dates: {
    beginningOfYear: string | null
    previousWeek: string | null
    thisWeek: string
  }
  rows: FamilyPortfolioSnapshotRow[]
}

export interface FamilyPortfolioSnapshotResponse {
  scope: string
  weeks: FamilyPortfolioWeek[]
  /** Null when no week has ever been published — an honest empty state. */
  snapshot: FamilyPortfolioSnapshot | null
}

export type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string }

async function get<T>(path: string): Promise<FetchResult<T>> {
  try {
    const res = await fetch(path, { cache: 'no-store' })
    if (!res.ok) {
      let code = 'request_failed'
      try {
        const body: unknown = await res.json()
        if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
          code = (body as { error: string }).error
        }
      } catch {
        // A non-JSON error body keeps the generic code.
      }
      return { ok: false, status: res.status, code }
    }
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false, status: 0, code: 'network_error' }
  }
}

export function fetchFamilyPortfolioScopes(): Promise<FetchResult<FamilyPortfolioScopesResponse>> {
  return get('/api/family-portfolio/scopes')
}

export function fetchFamilyPortfolioSnapshot(
  scope: string,
  asOf?: string | null,
): Promise<FetchResult<FamilyPortfolioSnapshotResponse>> {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : ''
  return get(`/api/family-portfolio/${encodeURIComponent(scope)}/snapshot${qs}`)
}

// ---------------------------------------------------------------------------
// R13.7 — Overview (One Pager)
// ---------------------------------------------------------------------------

export interface OverviewHeroData {
  totalValue: number | null
  weeklyDifference: number | null
  weeklyReturn: number | null
  ytdReturn: number | null
}

export interface OverviewAllocationEntry {
  rowKey: string
  labelEs: string
  labelEn: string | null
  value: number | null
  weight: number | null
}

export interface OverviewAllocationBasis {
  id: 'total' | 'ex_chilean' | 'ex_chilean_ex_inretail'
  denominatorRowKey: string | null
  denominatorLabelEs: string | null
  denominatorLabelEn: string | null
  denominatorValue: number | null
  entries: OverviewAllocationEntry[]
  status: 'ok' | 'partial' | 'unavailable'
  residual: number | null
}

export interface OverviewPerformanceBlock {
  basis: string
  flow: number | null
  weeklyReturn: number | null
  weeklyProfit: number | null
  ytdReturn: number | null
  ytdProfit: number | null
}

export interface OverviewEvolutionPoint {
  date: string
  value: number
  /**
   * R13.R2 pass 4 § 2 — the SOURCE-PUBLISHED net flow for the week ending on
   * `date`, or null when that basis published none. The client subtracts the
   * running total of these from the level to plot a path that does not jump on
   * a contribution or a withdrawal; a null makes its step unadjustable, which
   * the surface discloses rather than assuming the flow was zero.
   */
  flow?: number | null
}

export interface OverviewMarketMetric {
  status: 'unverified' | 'unavailable' | 'ok'
  value: number | null
  observationDate: string | null
  previousObservationDate: string | null
}

export interface OverviewCommentary {
  body: string
  revision: number
  updatedAt: string
}

/** One Weekly Note. Its `id` is what makes edit and delete independent. */
export interface OverviewWeeklyNote {
  id: string
  body: string
  displayOrder: number
  createdAt: string
  updatedAt: string
}

export interface FamilyPortfolioOverviewResponse {
  scope: string
  /**
   * R13.R2B § 10 — PRESENTATION CONVENIENCE ONLY: whether to render the Weekly
   * Notes editor at all. The write route re-derives administrator capability
   * server-side, so flipping this client-side changes only what this browser
   * draws.
   */
  canEditNotes?: boolean
  /** Null when no portfolio week has ever been published. */
  publication: {
    /** The note's week key — the publication the commentary route writes against. */
    id: string
    asOfDate: string
    revision: number
    publishedAt: string
    parserVersion: string
    dates: { beginningOfYear: string | null; previousWeek: string | null; thisWeek: string }
  } | null
  hero?: OverviewHeroData
  comparison?: FamilyPortfolioSnapshotRow[] | null
  allocation?: OverviewAllocationBasis[]
  performanceBlocks?: OverviewPerformanceBlock[]
  /**
   * R13.R2 §§ 11-12 — the four Weekly Snapshot figures, from the row the parser
   * bound to this scope's performance basis. The three levels are source
   * cells; `difference` is DERIVED as `thisWeek − previousWeek` through the
   * shared invariant, so the displayed arithmetic is internally consistent.
   * `differenceStatus` reports how it compares with the publication's own
   * persisted figure — that figure is a cross-check, never an override.
   */
  weeklySnapshot?: {
    beginningOfYear: number | null
    previousWeek: number | null
    thisWeek: number | null
    difference: number | null
    differenceStatus?: 'reconciled' | 'mismatch' | 'not_comparable'
  }
  /**
   * R13.R2C § 18 — Main carries the two-basis pair; a PERSONAL scope carries
   * `total` and the other two are empty. A personal portfolio has no
   * Chilean-equities split, so the client must never offer one (§ 28).
   */
  evolution?: {
    exChilean: OverviewEvolutionPoint[]
    withChilean: OverviewEvolutionPoint[]
    total: OverviewEvolutionPoint[]
  }
  /**
   * R13.R1 § 9 — which provenance the evolution series carries.
   * `persisted_history` = the weekly series ingested from the workbook's own
   * historical columns; `publications` = one point per published week, derived
   * from that week's performance binding. Never a blend of the two.
   */
  evolutionSource?: 'persisted_history' | 'publications' | 'unavailable'
  inretailImpact?: { rowKey: string | null; value: number | null }
  marketContext?: {
    globalEquity: OverviewMarketMetric
    globalFixedIncome: OverviewMarketMetric
    inretailPrice: OverviewMarketMetric
    inretailVariation: OverviewMarketMetric
  }
  commentary?: OverviewCommentary | null
  /**
   * R13.R2C §§ 7-8 — the week's Weekly Notes, already in the module's one
   * deterministic order. MAIN ONLY: a personal scope always receives `[]`, and
   * the surface renders no notes region rather than an empty column.
   */
  weeklyNotes?: OverviewWeeklyNote[]
  /**
   * R13.R2 pass 4 § 1 — whether the notes could be READ at all. `ok` means the
   * list is authoritative (an empty list is genuinely an empty week);
   * `schema_missing` means `20260813000000_family_portfolio_weekly_notes.sql`
   * has not been applied, so notes cannot be read OR written yet; `unavailable`
   * is any other read failure. Absent on a response from before this field
   * existed, which the client treats as `ok`.
   */
  weeklyNotesState?: 'ok' | 'schema_missing' | 'unavailable'
  freshness?: {
    portfolio: { asOfDate: string; publishedAt: string }
    alternatives: { asOfDate: string; publishedAt: string } | null
  }
}

/**
 * The Summary composition for ONE entitled scope. `main` returns the full One
 * Pager; a personal scope returns its own smaller supported set (R13.R2 § 10).
 * The route re-derives entitlement server-side and RLS re-derives it again.
 */
export function fetchFamilyPortfolioOverview(
  scope: string,
): Promise<FetchResult<FamilyPortfolioOverviewResponse>> {
  return get(`/api/family-portfolio/overview/${encodeURIComponent(scope)}`)
}

// ---------------------------------------------------------------------------
// R13.R2 §§ 14-15 — global Asset Allocation presentation settings
// ---------------------------------------------------------------------------

// Type-only import of the LOCKED enum vocabulary, so the client cannot invent a
// palette name or a label mode the database would reject.
import type { AllocationPresentationSettings } from '@/lib/familyPortfolio/allocationSettings'

export interface PresentationSettingsResponse {
  settings: AllocationPresentationSettings
  updatedAt: string | null
  /** False when no stored row was readable and the documented defaults apply. */
  persisted: boolean
  /**
   * PRESENTATION CONVENIENCE ONLY — whether to render the settings control.
   * The PUT route re-derives administrator capability server-side and the RLS
   * write policy re-derives it again; flipping this client-side changes only
   * what the caller's own browser draws.
   */
  canEdit: boolean
}

export function fetchPresentationSettings(): Promise<FetchResult<PresentationSettingsResponse>> {
  return get('/api/family-portfolio/presentation-settings')
}

/** Administrator-only in effect: a member's PUT is refused 403 by the route. */
export async function savePresentationSettings(
  settings: AllocationPresentationSettings,
): Promise<FetchResult<PresentationSettingsResponse>> {
  try {
    const res = await fetch('/api/family-portfolio/presentation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(settings),
    })
    if (!res.ok) {
      let code = 'request_failed'
      try {
        const body: unknown = await res.json()
        if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
          code = (body as { error: string }).error
        }
      } catch {
        // A non-JSON error body keeps the generic code.
      }
      return { ok: false, status: res.status, code }
    }
    return { ok: true, data: (await res.json()) as PresentationSettingsResponse }
  } catch {
    return { ok: false, status: 0, code: 'network_error' }
  }
}

// ---------------------------------------------------------------------------
// R13.R2B §§ 10-11 — Weekly Notes (the existing administrator commentary)
// ---------------------------------------------------------------------------

/**
 * Writes the week's note through the EXISTING administrator commentary route —
 * no second persistence model was introduced (§ 11). That route is inside the
 * `/admin/` namespace, re-derives `entitlement.isAdministrator` server-side,
 * normalises and length-checks the body, and appends a new revision rather than
 * overwriting the previous one, so the audit trail survives every edit.
 *
 * A member calling this receives 403 from the server; the client control is
 * simply not rendered for them.
 */
export async function saveWeeklyNote(
  publicationId: string,
  scope: string,
  body: string,
): Promise<FetchResult<{ commentaryId: string; publicationId: string; scope: string }>> {
  try {
    const res = await fetch(
      `/api/family-portfolio/admin/publications/${encodeURIComponent(publicationId)}/commentary`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ scope, body }),
      },
    )
    if (!res.ok) {
      let code = 'request_failed'
      try {
        const parsed: unknown = await res.json()
        if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
          code = (parsed as { error: string }).error
        }
      } catch {
        // A non-JSON error body keeps the generic code.
      }
      return { ok: false, status: res.status, code }
    }
    return {
      ok: true,
      data: (await res.json()) as { commentaryId: string; publicationId: string; scope: string },
    }
  } catch {
    return { ok: false, status: 0, code: 'network_error' }
  }
}

/**
 * R13.R2C §§ 8-12 — the three Weekly Note mutations, each addressing ONE note
 * (create excepted, which has none yet). Every one is refused 403 by the server
 * for a non-administrator; the controls are simply not rendered for them.
 */
async function noteRequest(
  url: string,
  init: RequestInit,
): Promise<FetchResult<{ note?: OverviewWeeklyNote; deleted?: string }>> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init })
    if (!res.ok) {
      let code = 'request_failed'
      try {
        const parsed: unknown = await res.json()
        if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
          code = (parsed as { error: string }).error
        }
      } catch {
        // A non-JSON error body keeps the generic code.
      }
      return { ok: false, status: res.status, code }
    }
    return { ok: true, data: (await res.json()) as { note?: OverviewWeeklyNote; deleted?: string } }
  } catch {
    return { ok: false, status: 0, code: 'network_error' }
  }
}

const notesBase = (publicationId: string) =>
  `/api/family-portfolio/admin/publications/${encodeURIComponent(publicationId)}/notes`

export function createWeeklyNote(publicationId: string, scope: string, body: string) {
  return noteRequest(notesBase(publicationId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, body }),
  })
}

export function updateWeeklyNote(publicationId: string, noteId: string, body: string) {
  return noteRequest(`${notesBase(publicationId)}/${encodeURIComponent(noteId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
}

export function deleteWeeklyNote(publicationId: string, noteId: string) {
  return noteRequest(`${notesBase(publicationId)}/${encodeURIComponent(noteId)}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// R13.8 — Weekly Changes
// ---------------------------------------------------------------------------

// The response's financial types come from the LOCKED pure Stage-8 module —
// the same shapes the route computes with, so the client cannot drift into a
// parallel financial vocabulary. Type-only imports: no calculation moves here.
import type {
  ChangeNode,
  ComparisonMode,
  DriverGrouping,
  FlowReconciliation,
  ReclassificationCandidate,
  TotalMetrics,
  TrendPoint,
  Waterfall,
} from '@/lib/familyPortfolio/weeklyChanges'

export type WeeklyChangesState =
  | 'ok'
  | 'empty'
  | 'no_publications'
  | 'week_not_found'
  | 'no_previous_week'
  /** R13.R1.1 § 13 — a custom range whose endpoints are not both published,
   *  or whose `from` is not strictly before its `to`. Never snapped to a
   *  nearest week; the caller is told the range is unusable. */
  | 'from_not_found'
  | 'from_not_before_to'

export interface WeeklyChangesResponse {
  scope: string
  state: WeeklyChangesState
  weeks: FamilyPortfolioWeek[]
  publication: {
    id: string
    asOfDate: string
    revision: number
    publishedAt: string
    parserVersion: string
  } | null
  /** The opening endpoint — the preceding week in `weekly` mode, the chosen
   *  `from` week in `custom`. Null on the earliest published week. */
  previousPublication: { asOfDate: string; publishedAt: string } | null
  /** `weekly` (default) or `custom` — R13.R1.1 § 13. Drives the surface title:
   *  a multi-week range is never presented as a Weekly Change. */
  mode?: ComparisonMode
  /** Assets that left one parent and arrived under another (§ 7). Reported for
   *  an administrator to judge; the engine never merges them. */
  reclassifications?: ReclassificationCandidate[]
  basis?: string
  grouping?: DriverGrouping
  availableGroupings?: DriverGrouping[]
  total?: TotalMetrics
  flowReconciliation?: FlowReconciliation
  waterfall?: Waterfall
  driverRowKeys?: string[]
  nodes?: ChangeNode[]
  trend?: TrendPoint[]
}

/**
 * Weekly Changes for ONE entitled scope. `asOf` selects an exact published
 * week; omitted → the latest current publication. There is deliberately no
 * nearest-week fallback — an unknown week is the server's 404, surfaced as-is.
 *
 * `from` opts into CUSTOM COMPARE (R13.R1.1 § 13): the comparison then runs
 * from that published week to `asOf`, however many weeks apart they are.
 */
export function fetchFamilyPortfolioWeeklyChanges(
  scope: string,
  asOf?: string | null,
  from?: string | null,
): Promise<FetchResult<WeeklyChangesResponse>> {
  const params = new URLSearchParams()
  if (asOf) params.set('asOf', asOf)
  if (from) params.set('from', from)
  const qs = params.toString()
  return get(`/api/family-portfolio/weekly-changes/${encodeURIComponent(scope)}${qs ? `?${qs}` : ''}`)
}

// ---------------------------------------------------------------------------
// R13.9 — Alternatives
// ---------------------------------------------------------------------------

// Type-only imports from the pure Stage-9 module — the route computes with
// these exact shapes and the page re-derives filtered views through the same
// functions, so no parallel financial vocabulary can appear client-side.
import type {
  AlternativesEventRead,
  AlternativesGroup,
  AlternativesHoldingRead,
} from '@/lib/familyPortfolio/alternativesView'

export type AlternativesViewState = 'ok' | 'empty' | 'no_publication'

export interface FamilyPortfolioAlternativesResponse {
  state: AlternativesViewState
  /** The CURRENT alternatives publication — its OWN as-of, never the portfolio's. */
  publication: {
    id: string
    asOfDate: string
    revision: number
    publishedAt: string
    parserVersion: string
  } | null
  holdings?: AlternativesHoldingRead[]
  events?: AlternativesEventRead[]
  /** Per-(category, currency) groups — NEVER a cross-currency total. */
  groups?: AlternativesGroup[]
  eventSummary?: { total: number; byType: Record<string, number>; unclassified: number }
}

export function fetchFamilyPortfolioAlternatives(): Promise<
  FetchResult<FamilyPortfolioAlternativesResponse>
> {
  return get('/api/family-portfolio/alternatives')
}
