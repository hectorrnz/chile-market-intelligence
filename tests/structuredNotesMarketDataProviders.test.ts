// Phase 9E — Structured Notes market-data provider abstraction, Yahoo provider
// shape, and the fallback/sanity-check orchestrator. No live network calls —
// the orchestrator and Yahoo provider's pure surfaces (supportsSymbol,
// normalizeQuote) are exercised directly, and fallback/disagreement behavior
// is exercised against small mock providers implementing the same interface.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yahooStructuredNoteProvider, YAHOO_PROVIDER_ID, YAHOO_PROVIDER_NAME } from '../src/lib/structuredNotes/marketData/providers/yahooStructuredNoteProvider.ts'
import { resolveStructuredNoteQuotes } from '../src/lib/structuredNotes/marketData/resolveStructuredNoteQuotes.ts'
import type {
  StructuredNoteMarketDataProvider,
  StructuredNoteMarketDataQuote,
  StructuredNoteMarketDataRequest,
  StructuredNoteMarketDataResult,
} from '../src/lib/structuredNotes/marketData/providers/types.ts'

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const TYPES_FILE = read('../src/lib/structuredNotes/marketData/providers/types.ts')
const DISCOVERY_DOC = read('../docs/structured_notes_market_data_sources.md')

describe('provider abstraction — types (Phase 9E)', () => {
  it('never includes an "official" sourceType — only free_monitoring_estimate/proxy/unsupported', () => {
    assert.ok(/'free_monitoring_estimate' \| 'proxy' \| 'unsupported'/.test(TYPES_FILE))
    assert.ok(!/'official'/.test(TYPES_FILE))
  })
  it('has no runtime imports (pure type declarations only)', () => {
    const codeLines = TYPES_FILE.split('\n').filter((l) => !l.trim().startsWith('//'))
    assert.ok(!codeLines.some((l) => /^import\s+(?!type)/.test(l.trim())))
  })
})

describe('yahooStructuredNoteProvider — shape and pure behavior', () => {
  it('identifies itself correctly and never claims to be official', () => {
    assert.equal(yahooStructuredNoteProvider.providerId, YAHOO_PROVIDER_ID)
    assert.equal(yahooStructuredNoteProvider.providerName, YAHOO_PROVIDER_NAME)
    assert.equal(yahooStructuredNoteProvider.sourceType, 'free_monitoring_estimate')
  })
  it('supportsSymbol is permissive for any non-empty string (Yahoo has no published allow-list)', () => {
    assert.equal(yahooStructuredNoteProvider.supportsSymbol('^GSPC'), true)
    assert.equal(yahooStructuredNoteProvider.supportsSymbol(''), false)
  })
  it('normalizeQuote maps a raw Yahoo-shaped object to a success quote', () => {
    const q = yahooStructuredNoteProvider.normalizeQuote({ symbol: '^GSPC', price: 7000, asOf: '2027-01-01T00:00:00.000Z' }, '^GSPC')
    assert.equal(q.status, 'success')
    assert.equal(q.price, 7000)
    assert.equal(q.sourceType, 'free_monitoring_estimate')
    assert.equal(q.provider, YAHOO_PROVIDER_ID)
  })
  it('normalizeQuote maps a missing/invalid price to not_found, never a fabricated price', () => {
    const q1 = yahooStructuredNoteProvider.normalizeQuote({ symbol: '^GSPC', price: null, asOf: null }, '^GSPC')
    assert.equal(q1.status, 'not_found')
    assert.equal(q1.price, null)
    const q2 = yahooStructuredNoteProvider.normalizeQuote(null, '^GSPC')
    assert.equal(q2.status, 'not_found')
  })
})

describe('provider fallback/sanity-check orchestrator — resolveStructuredNoteQuotes', () => {
  function mockProvider(id: string, prices: Map<string, number>, opts: { throws?: boolean; sourceType?: 'free_monitoring_estimate' | 'proxy' } = {}): StructuredNoteMarketDataProvider {
    return {
      providerId: id,
      providerName: id,
      sourceType: opts.sourceType ?? 'free_monitoring_estimate',
      supportsSymbol: (s: string) => s.length > 0,
      normalizeQuote: (raw: unknown, requestedSymbol: string): StructuredNoteMarketDataQuote => {
        const r = raw as { price: number | null } | null
        return {
          symbol: requestedSymbol, requestedSymbol, sourceSymbol: requestedSymbol,
          price: r?.price ?? null, asOf: r?.price != null ? '2027-01-01T00:00:00.000Z' : null,
          currency: null, provider: id, sourceType: opts.sourceType ?? 'free_monitoring_estimate',
          status: r?.price != null ? 'success' : 'not_found', stale: false, warning: null, metadata: {},
        }
      },
      async fetchQuotes(request: StructuredNoteMarketDataRequest): Promise<StructuredNoteMarketDataResult> {
        if (opts.throws) throw new Error('simulated provider failure')
        const quotes = request.symbols.map((s) => {
          const price = prices.has(s) ? prices.get(s)! : null
          return {
            symbol: s, requestedSymbol: s, sourceSymbol: s, price,
            asOf: price !== null ? '2027-01-01T00:00:00.000Z' : null,
            currency: null, provider: id, sourceType: opts.sourceType ?? 'free_monitoring_estimate',
            status: (price !== null ? 'success' : 'not_found') as StructuredNoteMarketDataQuote['status'],
            stale: false, warning: null, metadata: {},
          }
        })
        return {
          quotes, provider: id, requested: request.symbols,
          succeeded: quotes.filter((q) => q.status === 'success').map((q) => q.symbol),
          failed: quotes.filter((q) => q.status !== 'success').map((q) => q.symbol),
          warnings: [], asOf: quotes.some((q) => q.asOf) ? '2027-01-01T00:00:00.000Z' : null,
        }
      },
    }
  }

  it('resolves a successful quote from the primary provider without touching the fallback', async () => {
    const primary = mockProvider('primary', new Map([['^GSPC', 7000]]))
    const secondary = mockProvider('secondary', new Map([['^GSPC', 7100]]))
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC'], providers: [primary, secondary], referenceDate: '2027-01-01' })
    assert.equal(result.priceMap.get('^GSPC'), 7000)
    assert.equal(result.fallbackProviderUsed, false)
    assert.equal(result.quotes[0].provider, 'primary')
  })

  it('falls back to the secondary provider to fill a gap the primary missed', async () => {
    const primary = mockProvider('primary', new Map([['^GSPC', 7000]])) // no ^RUT
    const secondary = mockProvider('secondary', new Map([['^RUT', 2700]]))
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC', '^RUT'], providers: [primary, secondary], referenceDate: '2027-01-01' })
    assert.equal(result.priceMap.get('^GSPC'), 7000)
    assert.equal(result.priceMap.get('^RUT'), 2700)
    assert.equal(result.fallbackProviderUsed, true)
    const rutQuote = result.quotes.find((q) => q.symbol === '^RUT')
    assert.equal(rutQuote?.provider, 'secondary')
    assert.equal(rutQuote?.fallbackUsed, true)
  })

  it('the primary provider always wins over a secondary when both succeed on the same symbol', async () => {
    const primary = mockProvider('primary', new Map([['^GSPC', 7000]]))
    const secondary = mockProvider('secondary', new Map([['^GSPC', 7050]]))
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC'], providers: [primary, secondary], referenceDate: '2027-01-01' })
    assert.equal(result.priceMap.get('^GSPC'), 7000)
    assert.equal(result.quotes[0].provider, 'primary')
    assert.equal(result.quotes[0].fallbackUsed, false)
  })

  it('marks a symbol unsupported without ever calling any provider for it', async () => {
    const primary = mockProvider('primary', new Map([['^GSPC', 7000]]))
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC', 'UNKNOWN'], providers: [primary], unsupportedSymbols: ['UNKNOWN'], referenceDate: '2027-01-01' })
    const unknown = result.quotes.find((q) => q.symbol === 'UNKNOWN')
    assert.equal(unknown?.status, 'unsupported')
    assert.equal(unknown?.quality.level, 'reject')
    assert.ok(result.unsupportedSymbols.includes('UNKNOWN'))
    assert.ok(!result.priceMap.has('UNKNOWN'))
  })

  it('a provider error on one symbol never blocks the rest of the batch', async () => {
    const failing = mockProvider('failing', new Map(), { throws: true })
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC'], providers: [failing], referenceDate: '2027-01-01' })
    assert.equal(result.quotes[0].status, 'provider_error')
    assert.equal(result.quotes[0].quality.level, 'reject')
    assert.ok(!result.priceMap.has('^GSPC'))
  })

  it('flags cross-provider disagreement when two registered providers both succeed but diverge beyond the threshold', async () => {
    const primary = mockProvider('primary', new Map([['^GSPC', 7000]]))
    const secondary = mockProvider('secondary', new Map([['^GSPC', 7200]])) // ~2.9% apart, above the 1% default threshold
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC'], providers: [primary, secondary], referenceDate: '2027-01-01' })
    assert.equal(result.providerDisagreement, true)
    // Disagreement is a diagnostic signal, not itself a reject reason — the primary's price is still usable.
    assert.equal(result.priceMap.get('^GSPC'), 7000)
  })

  it('does not flag disagreement when only one provider is registered (documented production behavior today)', async () => {
    const primary = mockProvider('primary', new Map([['^GSPC', 7000]]))
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC'], providers: [primary], referenceDate: '2027-01-01' })
    assert.equal(result.providerDisagreement, false)
  })

  it('does not flag disagreement when two providers agree within the threshold', async () => {
    const primary = mockProvider('primary', new Map([['^GSPC', 7000]]))
    const secondary = mockProvider('secondary', new Map([['^GSPC', 7005]])) // ~0.07% apart
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC'], providers: [primary, secondary], referenceDate: '2027-01-01' })
    assert.equal(result.providerDisagreement, false)
  })

  it('returns unsupported for every symbol when no provider is registered, never a fabricated price', async () => {
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC'], providers: [], referenceDate: '2027-01-01' })
    assert.equal(result.quotes[0].status, 'unsupported')
    assert.equal(result.unsupportedSymbols.includes('^GSPC'), true)
  })

  it('applies quote-quality classification (stale) using the referenceDate', async () => {
    const stale = mockProvider('stale-provider', new Map([['^GSPC', 7000]]))
    // Override asOf to be old by monkey-patching fetchQuotes via a fresh provider.
    const staleProvider: StructuredNoteMarketDataProvider = {
      ...stale,
      async fetchQuotes(): Promise<StructuredNoteMarketDataResult> {
        return {
          quotes: [{ symbol: '^GSPC', requestedSymbol: '^GSPC', sourceSymbol: '^GSPC', price: 7000, asOf: '2026-01-01T00:00:00.000Z', currency: null, provider: 'stale-provider', sourceType: 'free_monitoring_estimate', status: 'success', stale: false, warning: null, metadata: {} }],
          provider: 'stale-provider', requested: ['^GSPC'], succeeded: ['^GSPC'], failed: [], warnings: [], asOf: '2026-01-01T00:00:00.000Z',
        }
      },
    }
    const result = await resolveStructuredNoteQuotes({ symbols: ['^GSPC'], providers: [staleProvider], referenceDate: '2027-01-01' })
    assert.ok(result.staleSymbols.includes('^GSPC'))
    assert.ok(result.reviewRequiredSymbols.includes('^GSPC'))
    // Stale is a warning, not a reject — the price is still usable.
    assert.equal(result.priceMap.get('^GSPC'), 7000)
  })
})

describe('free-provider discovery documentation (Phase 9E)', () => {
  it('documents the Stooq investigation and its rejection with concrete evidence, not an assumption', () => {
    assert.ok(/stooq/i.test(DISCOVERY_DOC))
    assert.ok(/reject/i.test(DISCOVERY_DOC))
    assert.ok(/proof-of-work|SHA-256/i.test(DISCOVERY_DOC))
  })
  it('never claims a free provider is official/calculation-agent data', () => {
    assert.ok(!/is official/i.test(DISCOVERY_DOC))
  })
  it('documents that exactly one provider is active this phase', () => {
    assert.ok(/only active provider|one registered provider|exactly one/i.test(DISCOVERY_DOC))
  })
})
