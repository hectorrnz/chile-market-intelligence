// News orchestrator — SERVER-ONLY. Queries every registered provider in
// parallel, isolates per-provider failures (one source failing never blocks
// the others), maps affected tickers/assets/tags, classifies category +
// impact, deduplicates, and sorts. Never returns a raw provider payload or
// error string to the client — only sanitized NewsSourceStatus entries.

import type { NewsItem } from '@/types'
import type { NewsProvider, NewsSourceStatus, RawNewsArticle } from './types'
import { dfNewsProvider } from './dfNewsProvider.ts'
// Relative imports with explicit .ts extension (not the '@/lib' alias) — this
// module is imported directly by unit tests running under Node's native test
// runner, which resolves neither tsconfig path aliases nor extensionless
// relative specifiers.
import { mapAffectedEntities } from '../../news/tickerMapping.ts'
import { classifyCategory, classifyImpact } from '../../news/newsClassification.ts'

const PROVIDERS: NewsProvider[] = [dfNewsProvider]

const IMPACT_RANK: Record<NewsItem['impactLevel'], number> = { High: 2, Medium: 1, Low: 0 }

// News rolls off after 1 week rather than accumulating indefinitely — the
// window is recomputed against Date.now() on every uncached fetch, so as
// time passes the list keeps rolling forward instead of growing forever.
export const NEWS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Keeps only items published within NEWS_MAX_AGE_MS of now; drops anything with an unparseable date. */
function filterRecent(items: NewsItem[], now: number): NewsItem[] {
  return items.filter(item => {
    const publishedMs = new Date(item.publishedAt).getTime()
    return Number.isFinite(publishedMs) && now - publishedMs <= NEWS_MAX_AGE_MS
  })
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

function normalizeHeadline(headline: string): string {
  return headline.trim().toLowerCase().replace(/\s+/g, ' ')
}

function toNewsItem(article: RawNewsArticle, provider: NewsProvider, index: number, fetchedAt: string): NewsItem {
  const text = `${article.headline} ${article.summary ?? ''}`
  const mapping = mapAffectedEntities(text)
  const category = classifyCategory(text, mapping.tickers.length > 0)
  const { impactLevel, impactReason } = classifyImpact({ text, category, sourceType: provider.sourceType, mapping })
  return {
    id: `${provider.name}-${index}-${normalizeUrl(article.sourceUrl)}`.slice(0, 200),
    headline: article.headline,
    summary: article.summary,
    source: provider.name,
    sourceType: provider.sourceType,
    sourceUrl: article.sourceUrl,
    publishedAt: article.publishedAt ?? fetchedAt,
    fetchedAt,
    category,
    impactLevel,
    impactReason,
    affectedTickers: mapping.tickers,
    affectedAssets: mapping.assets,
    affectedTags: mapping.tags,
    language: article.language,
  }
}

/** Dedupes by normalized URL first, then by (normalized headline + publish date) across sources. */
function dedupe(items: NewsItem[]): NewsItem[] {
  const seenUrls = new Set<string>()
  const seenHeadlineDay = new Set<string>()
  const out: NewsItem[] = []
  for (const item of items) {
    const urlKey = normalizeUrl(item.sourceUrl)
    const dayKey = `${normalizeHeadline(item.headline)}|${item.publishedAt.slice(0, 10)}`
    if (seenUrls.has(urlKey) || seenHeadlineDay.has(dayKey)) continue
    seenUrls.add(urlKey)
    seenHeadlineDay.add(dayKey)
    out.push(item)
  }
  return out
}

export interface NewsFetchResult {
  status: 'success' | 'partial_success' | 'unavailable'
  data: NewsItem[]
  sourceStatuses: NewsSourceStatus[]
  fetchedAt: string
}

// Conservative in-memory cache (module scope, per server instance) — avoids
// re-fetching every source RSS feed on every page load. News moves faster
// than macro/FX, so the TTL is shorter than the 6h used elsewhere, but still
// bounded so a burst of requests never hammers df.cl.
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
let cached: { at: number; result: NewsFetchResult } | null = null

export async function fetchAllNews(): Promise<NewsFetchResult> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result
  const result = await fetchAllNewsUncached()
  cached = { at: Date.now(), result }
  return result
}

/** Test-only: clears the module-scope cache between test cases. */
export function __resetNewsCacheForTests(): void {
  cached = null
}

async function fetchAllNewsUncached(): Promise<NewsFetchResult> {
  const fetchedAt = new Date().toISOString()
  const results = await Promise.all(
    PROVIDERS.map(async provider => {
      try {
        const result = await provider.fetchLatest()
        return { provider, result }
      } catch (err) {
        return { provider, result: { ok: false as const, data: [], reason: err instanceof Error ? err.message : 'Unknown error' } }
      }
    })
  )

  const sourceStatuses: NewsSourceStatus[] = []
  let allItems: NewsItem[] = []
  let successCount = 0

  results.forEach(({ provider, result }, providerIdx) => {
    if (result.ok) {
      successCount += 1
      const items = result.data.map((a, i) => toNewsItem(a, provider, providerIdx * 1000 + i, fetchedAt))
      allItems = allItems.concat(items)
      sourceStatuses.push({ source: provider.name, sourceType: provider.sourceType, status: 'success', articleCount: items.length })
    } else {
      sourceStatuses.push({ source: provider.name, sourceType: provider.sourceType, status: 'unavailable', articleCount: 0, reason: result.reason })
    }
  })

  const deduped = filterRecent(dedupe(allItems), Date.now())
  deduped.sort((a, b) => {
    const rankDiff = IMPACT_RANK[b.impactLevel] - IMPACT_RANK[a.impactLevel]
    if (rankDiff !== 0) return rankDiff
    return b.publishedAt.localeCompare(a.publishedAt)
  })

  const status: NewsFetchResult['status'] =
    successCount === 0 ? 'unavailable' : successCount < PROVIDERS.length ? 'partial_success' : 'success'

  return { status, data: deduped, sourceStatuses, fetchedAt }
}
