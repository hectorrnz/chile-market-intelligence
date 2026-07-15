// La Tercera — official native RSS feed (Arc Publishing "outboundfeeds"),
// no API key, no CAPTCHA, no paywall on the feed itself. Verified live:
// real, current (dated within hours) articles with title / direct
// latercera.com link / pubDate / description.
//
// Feed: the Pulso vertical (La Tercera's business/finance section) —
// https://www.latercera.com/arc/outboundfeeds/rss/category/pulso/?outputType=xml
// This is already finance-focused server-side (57 real items in testing:
// markets, fiscal policy, company results), so it's a better fit for this
// terminal than the general newswire; the orchestrator's classifier still
// runs on it exactly as it does for Diario Financiero.

import type { NewsProvider, NewsProviderResult, RawNewsArticle } from './types'
import { parseRssItems } from './rssClient.ts'

const FEED_URL = 'https://www.latercera.com/arc/outboundfeeds/rss/category/pulso/?outputType=xml'
const TIMEOUT_MS = 8000

function parsePubDate(pubDate: string | null): string | null {
  if (!pubDate) return null
  const d = new Date(pubDate)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const laTerceraNewsProvider: NewsProvider = {
  name: 'La Tercera',
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
