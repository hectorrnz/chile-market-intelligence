// Diario Financiero (df.cl) — official public RSS feed, no API key, no
// CAPTCHA, no paywall on the feed itself. Verified live: real, current
// (dated within hours) articles with title/link/pubDate/description.
//
// Feed: https://www.df.cl/noticias/site/list/port/rss.xml
// This is df.cl's own general newswire (economía, mercados, empresas,
// política) — not filtered server-side to finance topics, so the orchestrator's
// category classifier does the topic split, same as any other raw source.

import type { NewsProvider, NewsProviderResult, RawNewsArticle } from './types'
import { parseRssItems } from './rssClient.ts'

const FEED_URL = 'https://www.df.cl/noticias/site/list/port/rss.xml'
const TIMEOUT_MS = 8000

function parsePubDate(pubDate: string | null): string | null {
  if (!pubDate) return null
  const d = new Date(pubDate)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const dfNewsProvider: NewsProvider = {
  name: 'Diario Financiero',
  sourceType: 'media',

  async fetchLatest(): Promise<NewsProviderResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(FEED_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ChileMarketIntelligence/1.0 (+news-ingestion)' },
      })
      if (!res.ok) return { ok: false, data: [], reason: `HTTP ${res.status}` }
      const xml = await res.text()
      const rawItems = parseRssItems(xml)
      if (rawItems.length === 0) return { ok: false, data: [], reason: 'Feed returned no parseable items' }

      const data: RawNewsArticle[] = rawItems.map(item => ({
        headline: item.title,
        summary: item.description,
        sourceUrl: item.link,
        publishedAt: parsePubDate(item.pubDate),
        language: 'es',
      }))
      return { ok: true, data }
    } catch (err) {
      return { ok: false, data: [], reason: err instanceof Error ? err.message : 'Unknown fetch error' }
    } finally {
      clearTimeout(timer)
    }
  },
}
