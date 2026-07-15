// Client-safe fetch helper for the source-backed News module (GET /api/news).
// Only TYPE imports from the provider layer, so no server code reaches the browser bundle.

import type { NewsItem } from '@/types'
import type { NewsSourceStatus } from '@/lib/providers/news/types'

export interface NewsFetchResponse {
  status: 'success' | 'partial_success' | 'unavailable'
  data: NewsItem[]
  sourceStatuses: NewsSourceStatus[]
  fetchedAt: string
}

export async function fetchLiveNews(signal?: AbortSignal): Promise<NewsFetchResponse | null> {
  try {
    const res = await fetch('/api/news', { signal, cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as NewsFetchResponse
  } catch {
    return null
  }
}
