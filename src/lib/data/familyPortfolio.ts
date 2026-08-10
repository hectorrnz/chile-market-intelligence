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

export interface FamilyPortfolioOverviewResponse {
  scope: string
  /** Null when no portfolio week has ever been published. */
  publication: {
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
  evolution?: { exChilean: OverviewEvolutionPoint[]; withChilean: OverviewEvolutionPoint[] }
  inretailImpact?: { rowKey: string | null; value: number | null }
  marketContext?: {
    globalEquity: OverviewMarketMetric
    globalFixedIncome: OverviewMarketMetric
    inretailPrice: OverviewMarketMetric
    inretailVariation: OverviewMarketMetric
  }
  commentary?: OverviewCommentary | null
  freshness?: {
    portfolio: { asOfDate: string; publishedAt: string }
    alternatives: { asOfDate: string; publishedAt: string } | null
  }
}

export function fetchFamilyPortfolioOverview(
  scope: string,
): Promise<FetchResult<FamilyPortfolioOverviewResponse>> {
  return get(`/api/family-portfolio/overview/${encodeURIComponent(scope)}`)
}
