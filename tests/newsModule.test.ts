// News Module Source Integrity + Live Ingestion — unit tests. No live network
// calls: the RSS client is exercised against small in-memory fixtures, and the
// df.cl provider/orchestrator are exercised against a mocked global.fetch.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRssItems } from '../src/lib/providers/news/rssClient.ts'
import { mapAffectedEntities } from '../src/lib/news/tickerMapping.ts'
import { classifyCategory, classifyImpact } from '../src/lib/news/newsClassification.ts'
import { dfNewsProvider } from '../src/lib/providers/news/dfNewsProvider.ts'
import { fetchAllNews, __resetNewsCacheForTests } from '../src/lib/providers/news/newsProvider.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// ── Static/sample removal ────────────────────────────────────────────────

describe('Static/sample news removed from production', () => {
  it('news.json and news_mock.ts no longer exist', () => {
    assert.ok(!existsSync(join(ROOT, 'src/data/news.json')))
    assert.ok(!existsSync(join(ROOT, 'src/data/news_mock.ts')))
  })

  it('the old static news data module no longer exists', () => {
    assert.ok(!existsSync(join(ROOT, 'src/lib/data/news.ts')))
  })

  it('Home page no longer imports the static news module', () => {
    const src = readFileSync(join(ROOT, 'src/app/page.tsx'), 'utf8')
    assert.ok(!src.includes("from '@/lib/data/news'"))
    assert.ok(src.includes("from '@/lib/data/newsLive'"))
  })

  it('Company page no longer imports the static news module', () => {
    const src = readFileSync(join(ROOT, 'src/app/companies/[ticker]/page.tsx'), 'utf8')
    assert.ok(!src.includes("from '@/lib/data/news'"))
    assert.ok(src.includes("from '@/lib/data/newsLive'"))
  })

  it('the old vague "future ingestion" footer copy is gone from i18n', () => {
    const i18n = readFileSync(join(ROOT, 'src/lib/i18n.ts'), 'utf8')
    assert.ok(!i18n.includes('newsFutureNote'))
    assert.ok(!/Live ingestion available in a future phase/.test(i18n))
  })
})

// ── RSS parsing ───────────────────────────────────────────────────────────

describe('parseRssItems — dependency-free RSS 2.0 parser', () => {
  it('parses a well-formed feed with CDATA and entities', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title><![CDATA[Dólar sube tras datos de EEUU]]></title>
        <link>https://www.df.cl/mercados/dolar-sube</link>
        <pubDate>Wed, 15 Jul 2026 14:00:00 GMT</pubDate>
        <description><![CDATA[El dólar avanzó luego de conocerse cifras de inflación en Estados Unidos.]]></description>
      </item>
      <item>
        <title>CMF sanciona a banco por infracción</title>
        <link>https://www.df.cl/empresas/cmf-sanciona</link>
        <pubDate>Wed, 15 Jul 2026 13:00:00 GMT</pubDate>
        <description>La CMF aplicó una multa.</description>
      </item>
    </channel></rss>`
    const items = parseRssItems(xml)
    assert.equal(items.length, 2)
    assert.equal(items[0].title, 'Dólar sube tras datos de EEUU')
    assert.equal(items[0].link, 'https://www.df.cl/mercados/dolar-sube')
    assert.equal(items[0].description, 'El dólar avanzó luego de conocerse cifras de inflación en Estados Unidos.')
  })

  it('returns [] for a non-feed (HTML error page) rather than throwing', () => {
    const html = '<html><body><h1>404 Not Found</h1></body></html>'
    assert.deepEqual(parseRssItems(html), [])
  })

  it('returns [] for empty/garbage input', () => {
    assert.deepEqual(parseRssItems(''), [])
    assert.deepEqual(parseRssItems('not xml at all'), [])
  })

  it('skips an item missing a title or link', () => {
    const xml = `<rss><channel><item><title>Only a title, no link</title></item></channel></rss>`
    assert.deepEqual(parseRssItems(xml), [])
  })

  it('decodes numeric character references (regression — real df.cl feeds use &#38; for "&")', () => {
    const xml = `<rss><channel><item><title>S&#38;P 500 sube</title><link>https://www.df.cl/x</link>
      <description>El S&#38;P 500 avanz&#243; hoy</description></item></channel></rss>`
    const items = parseRssItems(xml)
    assert.equal(items[0].title, 'S&P 500 sube')
    assert.equal(items[0].description, 'El S&P 500 avanzó hoy')
  })

  it('never double-decodes a literal &amp; into a corrupted character', () => {
    const xml = `<rss><channel><item><title>Empresas &amp; Negocios</title><link>https://www.df.cl/y</link></item></channel></rss>`
    assert.equal(parseRssItems(xml)[0].title, 'Empresas & Negocios')
  })
})

// ── Ticker/asset/tag mapping ──────────────────────────────────────────────

describe('mapAffectedEntities — cautious ticker/asset/tag mapping', () => {
  it('maps a full company name to its ticker', () => {
    const { tickers } = mapAffectedEntities('Empresas Copec anunció una adquisición en Brasil')
    assert.ok(tickers.includes('COPEC'))
  })

  it('maps an isolated all-caps ticker token', () => {
    const { tickers } = mapAffectedEntities('SONDA firma contrato con banco brasileño')
    assert.ok(tickers.includes('SONDA'))
  })

  it('does NOT map the bare word "Chile" or "CAP" (denylisted — too generic/ambiguous)', () => {
    const { tickers } = mapAffectedEntities('Chile y Argentina firman acuerdo; el cap de gasto sube')
    assert.ok(!tickers.includes('CHILE'))
    assert.ok(!tickers.includes('CAP'))
  })

  it('"Banco de Chile" (full phrase) still maps to CHILE', () => {
    const { tickers } = mapAffectedEntities('Banco de Chile reporta utilidades trimestrales')
    assert.ok(tickers.includes('CHILE'))
  })

  it('an unrelated headline maps to no tickers (never guesses)', () => {
    const { tickers } = mapAffectedEntities('Selección chilena de fútbol pierde amistoso')
    assert.equal(tickers.length, 0)
  })

  it('maps commodity/macro asset tags from keywords', () => {
    const { assets } = mapAffectedEntities('El cobre cae por debilidad de la demanda china; el IPC subió 0,3%')
    assert.ok(assets.includes('Copper'))
    assert.ok(assets.includes('CPI'))
  })

  it('maps sector tags from keywords', () => {
    const { tags } = mapAffectedEntities('La banca enfrenta nuevas exigencias de capital')
    assert.ok(tags.includes('Banking'))
  })
})

// ── Category + impact classification ─────────────────────────────────────

describe('classifyCategory', () => {
  it('classifies macro keywords as Macro', () => {
    assert.equal(classifyCategory('El Banco Central recorta la TPM en 25pb', false), 'Macro')
  })
  it('classifies CMF/sanction keywords as Regulation', () => {
    assert.equal(classifyCategory('CMF sanciona a una administradora de fondos', false), 'Regulation')
  })
  it('classifies earnings keywords as Earnings', () => {
    assert.equal(classifyCategory('Empresa reporta resultados del segundo trimestre', true), 'Earnings')
  })
  it('falls back to Company when a ticker matched but no other keyword did', () => {
    assert.equal(classifyCategory('Copec firma acuerdo comercial', true), 'Company')
  })
  it('falls back to Market when nothing matched', () => {
    assert.equal(classifyCategory('Selección chilena de fútbol gana partido', false), 'Market')
  })
})

describe('classifyImpact — deterministic, explainable, never everything High', () => {
  it('official + Regulation => High with an explicit reason', () => {
    const result = classifyImpact({
      text: 'CMF sanciona a un banco', category: 'Regulation', sourceType: 'official',
      mapping: { tickers: [], assets: [], tags: [] },
    })
    assert.equal(result.impactLevel, 'High')
    assert.ok(result.impactReason.length > 0)
  })

  it('official + Macro => High', () => {
    const result = classifyImpact({
      text: 'Banco Central anuncia decisión de tasa', category: 'Macro', sourceType: 'official',
      mapping: { tickers: [], assets: [], tags: [] },
    })
    assert.equal(result.impactLevel, 'High')
  })

  it('commodity shock (Copper + shock verb) => High', () => {
    const result = classifyImpact({
      text: 'El cobre se dispara tras recorte de oferta', category: 'Market', sourceType: 'media',
      mapping: { tickers: [], assets: ['Copper'], tags: [] },
    })
    assert.equal(result.impactLevel, 'High')
  })

  it('a ticker mention alone (no special keyword) is Medium, not High', () => {
    const result = classifyImpact({
      text: 'Copec inaugura nueva estación de servicio', category: 'Company', sourceType: 'media',
      mapping: { tickers: ['COPEC'], assets: [], tags: [] },
    })
    assert.equal(result.impactLevel, 'Medium')
  })

  it('no ticker, no sector, no macro keyword => Low (never defaults to High)', () => {
    const result = classifyImpact({
      text: 'Selección chilena de fútbol gana amistoso', category: 'Market', sourceType: 'media',
      mapping: { tickers: [], assets: [], tags: [] },
    })
    assert.equal(result.impactLevel, 'Low')
  })

  it('a corporate action (dividend/acquisition) on a tracked ticker is High', () => {
    const result = classifyImpact({
      text: 'Copec anuncia aumento de capital', category: 'Company', sourceType: 'media',
      mapping: { tickers: ['COPEC'], assets: [], tags: [] },
    })
    assert.equal(result.impactLevel, 'High')
  })
})

// ── Diario Financiero provider (mocked fetch) ─────────────────────────────

const ORIGINAL_FETCH = globalThis.fetch

describe('dfNewsProvider — mocked network', () => {
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH })

  it('is never labeled Bloomberg or any unlicensed vendor', () => {
    assert.equal(dfNewsProvider.name, 'Diario Financiero')
    assert.doesNotMatch(dfNewsProvider.name, /bloomberg/i)
  })

  it('is a media source, never labeled official', () => {
    assert.equal(dfNewsProvider.sourceType, 'media')
  })

  it('parses a mocked valid feed into RawNewsArticle rows preserving the direct link', async () => {
    const xml = `<rss><channel>
      <item><title>Cobre cae en la bolsa de Londres</title><link>https://www.df.cl/mercados/cobre-cae</link>
      <pubDate>Wed, 15 Jul 2026 12:00:00 GMT</pubDate><description>El metal rojo retrocedió.</description></item>
    </channel></rss>`
    globalThis.fetch = (async () => ({ ok: true, text: async () => xml })) as unknown as typeof fetch
    const result = await dfNewsProvider.fetchLatest()
    assert.equal(result.ok, true)
    assert.equal(result.data.length, 1)
    assert.equal(result.data[0].sourceUrl, 'https://www.df.cl/mercados/cobre-cae')
    assert.equal(result.data[0].summary, 'El metal rojo retrocedió.')
  })

  it('degrades to unavailable (never throws) on a non-200 response', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch
    const result = await dfNewsProvider.fetchLatest()
    assert.equal(result.ok, false)
    assert.ok(result.reason)
    assert.equal(result.data.length, 0)
  })

  it('degrades to unavailable on a network error (never throws)', async () => {
    globalThis.fetch = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    const result = await dfNewsProvider.fetchLatest()
    assert.equal(result.ok, false)
    assert.equal(result.data.length, 0)
  })

  it('degrades to unavailable when the feed has no parseable items', async () => {
    globalThis.fetch = (async () => ({ ok: true, text: async () => '<html>not a feed</html>' })) as unknown as typeof fetch
    const result = await dfNewsProvider.fetchLatest()
    assert.equal(result.ok, false)
  })
})

// ── Orchestrator (fetchAllNews) ────────────────────────────────────────────

describe('fetchAllNews — orchestration, dedup, sort, status', () => {
  beforeEach(() => __resetNewsCacheForTests())
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; __resetNewsCacheForTests() })

  it('status success + real fields present when the mocked provider succeeds', async () => {
    const xml = `<rss><channel>
      <item><title>Copec anuncia aumento de capital</title><link>https://www.df.cl/a</link>
      <pubDate>Wed, 15 Jul 2026 12:00:00 GMT</pubDate><description>Detalle.</description></item>
    </channel></rss>`
    globalThis.fetch = (async () => ({ ok: true, text: async () => xml })) as unknown as typeof fetch
    const result = await fetchAllNews()
    assert.equal(result.status, 'success')
    assert.equal(result.data.length, 1)
    const item = result.data[0]
    assert.equal(item.sourceUrl, 'https://www.df.cl/a')
    assert.equal(item.source, 'Diario Financiero')
    assert.equal(item.sourceType, 'media')
    assert.ok(item.affectedTickers.includes('COPEC'))
    assert.equal(item.impactLevel, 'High')
    assert.ok(item.impactReason.length > 0)
    assert.ok(item.fetchedAt)
    assert.ok(item.publishedAt)
  })

  it('status unavailable when every provider fails — never a fabricated fallback row', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    const result = await fetchAllNews()
    assert.equal(result.status, 'unavailable')
    assert.equal(result.data.length, 0)
    assert.ok(result.sourceStatuses.every(s => s.status === 'unavailable'))
  })

  it('sourceStatuses never leak a raw HTML/XML payload — only a short reason string', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch
    const result = await fetchAllNews()
    for (const s of result.sourceStatuses) {
      if (s.reason) {
        assert.ok(s.reason.length < 200)
        assert.ok(!s.reason.includes('<html'))
        assert.ok(!s.reason.includes('<rss'))
      }
    }
  })

  it('dedupes two items with the same URL', async () => {
    const xml = `<rss><channel>
      <item><title>Misma noticia</title><link>https://www.df.cl/dup</link><pubDate>Wed, 15 Jul 2026 12:00:00 GMT</pubDate></item>
      <item><title>Misma noticia (otra fuente)</title><link>https://www.df.cl/dup</link><pubDate>Wed, 15 Jul 2026 12:05:00 GMT</pubDate></item>
    </channel></rss>`
    globalThis.fetch = (async () => ({ ok: true, text: async () => xml })) as unknown as typeof fetch
    const result = await fetchAllNews()
    assert.equal(result.data.length, 1)
  })

  it('sorts High-impact items above Medium/Low even if published earlier', async () => {
    const xml = `<rss><channel>
      <item><title>Selección chilena gana amistoso</title><link>https://www.df.cl/deporte</link><pubDate>Wed, 15 Jul 2026 14:00:00 GMT</pubDate></item>
      <item><title>CMF sanciona a un banco por infracción</title><link>https://www.df.cl/cmf</link><pubDate>Wed, 15 Jul 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`
    globalThis.fetch = (async () => ({ ok: true, text: async () => xml })) as unknown as typeof fetch
    const result = await fetchAllNews()
    assert.equal(result.data[0].sourceUrl, 'https://www.df.cl/cmf')
    assert.equal(result.data[0].impactLevel, 'High')
  })

  it('caches results — a second call within the TTL makes no new fetch call', async () => {
    let calls = 0
    globalThis.fetch = (async () => { calls++; return { ok: true, text: async () => '<rss><channel></channel></rss>' } }) as unknown as typeof fetch
    await fetchAllNews()
    await fetchAllNews()
    assert.equal(calls, 1)
  })
})

// ── NewsItem type shape (no fake fields) ──────────────────────────────────

describe('NewsItem type — source honesty', () => {
  it('src/types/index.ts defines sourceType and impactReason (never a bare "materiality" claim)', () => {
    const src = readFileSync(join(ROOT, 'src/types/index.ts'), 'utf8')
    const match = src.match(/export interface NewsItem \{[\s\S]*?\n\}/)
    assert.ok(match, 'NewsItem interface not found')
    const block = match![0]
    assert.ok(block.includes('sourceType'))
    assert.ok(block.includes('impactReason'))
    assert.ok(block.includes('sourceUrl'))
  })
})
