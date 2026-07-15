// News provider architecture — shared contracts. A "raw" article is exactly
// what a source gave us (headline, direct link, optional description,
// published date) before ticker/tag mapping and impact classification are
// applied by the orchestrator. Providers never fabricate a field: a missing
// description stays null, never an invented summary.

import type { NewsSourceType } from '@/types'

export interface RawNewsArticle {
  headline: string
  /** Source-provided description/excerpt, or null if the source gave none. */
  summary: string | null
  sourceUrl: string
  /** ISO timestamp, or null if the source did not provide one. */
  publishedAt: string | null
  language: 'es' | 'en'
}

export interface NewsProviderResult {
  ok: boolean
  data: RawNewsArticle[]
  /** Present when ok is false — never exposed as a raw error/stack trace to clients. */
  reason?: string
}

export interface NewsProvider {
  /** Display name shown in the UI, e.g. "Diario Financiero". */
  name: string
  sourceType: NewsSourceType
  fetchLatest(): Promise<NewsProviderResult>
}

/** Per-source outcome surfaced in the API response (never raw payloads/errors). */
export interface NewsSourceStatus {
  source: string
  sourceType: NewsSourceType
  status: 'success' | 'unavailable'
  articleCount: number
  reason?: string
}
