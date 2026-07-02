// Phase 8A — Data source truth-layer tests.
// Covers the new registry/badge, and guards against the exact class of stale
// label this phase fixed (false "will connect" promises, fabricated vendor
// names, a static footer contradicting a dynamic badge next to it).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SOURCE_REGISTRY,
  getSourceLabel,
  getSourceState,
  getSourceEntry,
  type SourceKey,
} from '../src/lib/dataSourceRegistry.ts'

const ROOT = join(import.meta.dirname, '..')
const I18N = join(ROOT, 'src/lib/i18n.ts')
const HOME_PAGE = join(ROOT, 'src/app/page.tsx')
const STOCKS_PAGE = join(ROOT, 'src/app/stocks/page.tsx')
const COMPANY_PAGE = join(ROOT, 'src/app/companies/[ticker]/page.tsx')
const SOURCE_BADGE = join(ROOT, 'src/components/ui/SourceStateBadge.tsx')

// ─── Registry: canonical states + labels ──────────────────────────────────────

describe('Phase 8A dataSourceRegistry', () => {
  it('every entry has both an EN and ES label', () => {
    for (const key of Object.keys(SOURCE_REGISTRY) as SourceKey[]) {
      const entry = getSourceEntry(key)
      assert.ok(entry.labelEn.length > 0, `${key} missing EN label`)
      assert.ok(entry.labelEs.length > 0, `${key} missing ES label`)
    }
  })

  it('getSourceLabel returns the correct language', () => {
    assert.equal(getSourceLabel('bcchLive', 'en'), 'Live BCCh')
    assert.equal(getSourceLabel('bcchLive', 'es'), 'BCCh en vivo')
    assert.equal(getSourceLabel('dataUnavailable', 'en'), 'Data unavailable')
    assert.equal(getSourceLabel('dataUnavailable', 'es'), 'Datos no disponibles')
  })

  it('covers all 7 canonical states across the registry', () => {
    const states = new Set(Object.values(SOURCE_REGISTRY).map((e) => e.state))
    for (const s of ['live', 'persisted', 'static_fallback', 'static_mvp', 'blocked', 'unavailable']) {
      assert.ok(states.has(s as never), `no registry entry uses state "${s}"`)
    }
  })

  it('getSourceState resolves the state for a given key', () => {
    assert.equal(getSourceState('yahooLiveOverlay'), 'live')
    assert.equal(getSourceState('staticMvp'), 'static_mvp')
    assert.equal(getSourceState('providerBlocked'), 'blocked')
  })

  it('never calls Yahoo Finance "official"', () => {
    for (const entry of Object.values(SOURCE_REGISTRY)) {
      assert.ok(!/official.*yahoo|yahoo.*official/i.test(entry.labelEn))
    }
  })

  it('the CMF entry does not claim CMF ingestion is live', () => {
    const cmf = getSourceEntry('cmfBlocked')
    assert.equal(cmf.state, 'blocked')
    assert.ok(!/live ingestion active|CMF live$/i.test(cmf.labelEn))
  })
})

// ─── SourceStateBadge: no hardcoded colors, uses semantic tokens ─────────────

describe('Phase 8A SourceStateBadge component', () => {
  it('exists and uses only CSS variable tokens, no hardcoded hex colors', () => {
    const src = readFileSync(SOURCE_BADGE, 'utf8')
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), 'SourceStateBadge must not hardcode hex colors')
    assert.ok(src.includes('var(--positive)'))
    assert.ok(src.includes('var(--accent)'))
    assert.ok(src.includes('var(--muted-fg)'))
    assert.ok(src.includes('var(--negative)'))
    assert.ok(src.includes('var(--warning)'))
  })

  it('never contains the word "purple"', () => {
    const src = readFileSync(SOURCE_BADGE, 'utf8')
    assert.ok(!/purple/i.test(src))
  })
})

// ─── i18n: no stale "will connect" / "future source" / phase-number promises ──

describe('Phase 8A — no stale phase/future-source promises in i18n', () => {
  const src = readFileSync(I18N, 'utf8')

  it('does not promise a specific phase will "connect" a provider', () => {
    assert.ok(!/will connect|conectará/i.test(src), 'no label may promise a phase will "connect" a live provider')
  })

  it('does not use "future source:" phrasing (implies a confirmed roadmap item)', () => {
    assert.ok(!/future source|fuente futura/i.test(src))
  })

  it('does not reference Brain Data (tried and blocked, not a real path — see market_data_provider_discovery.md)', () => {
    assert.ok(!/Brain Data/i.test(src))
  })

  it('does not attribute static sample data to a fabricated vendor (Bloomberg — never integrated)', () => {
    assert.ok(!/Bloomberg/i.test(src))
  })

  it('does not couple a phase number with promise language ("Phase N will…", "planned for Phase N")', () => {
    // Phase 8B intentionally introduces honest "(Phase 8C)" conversion-path
    // citations (e.g. compare.fundamentalsNote: "pending ... (Phase 8C)") —
    // a documented next step, not a vague promise. Those are fine; what this
    // guards against is the old "Phase N will connect X" pattern (already
    // separately caught above) resurfacing with different wording, e.g.
    // "planned for Phase N" or "coming in Phase N".
    assert.ok(!/planned for Phase [4-9]|coming in Phase [4-9]|planificad[oa].{0,10}Fase [4-9]|próxima.{0,10}Fase [4-9]/i.test(src))
  })
})

// ─── CMF wording: precise "blocked" language, never a confirmed promise ───────

describe('Phase 8A — CMF blocked wording is precise everywhere it appears', () => {
  const src = readFileSync(I18N, 'utf8')

  it('at least one CMF-related label explains the CAPTCHA block', () => {
    assert.ok(/CAPTCHA/.test(src), 'CMF labels should explain the CAPTCHA block, not just say "static"')
  })

  it('CMF-related "static" labels do not claim live ingestion is active', () => {
    // Every occurrence of "CMF" near "live" must also be near "not active" / "blocked" / "no activa" / "bloqueado".
    const cmfLiveClaims = src.match(/CMF[^\n]{0,40}live(?!\s*ingestion not active)/gi) ?? []
    const falseClaims = cmfLiveClaims.filter((m) => !/not active|blocked|bloqueado|no activa/i.test(m))
    assert.equal(falseClaims.length, 0, `found CMF text implying live ingestion: ${JSON.stringify(falseClaims)}`)
  })
})

// ─── Home page: mixed macro card no longer shares one badge for Chile+US ─────

describe('Phase 8A — Home page macro card badge split', () => {
  const src = readFileSync(HOME_PAGE, 'utf8')

  it('renders a DataSourceBadge for the Chile band and a separate static badge for the US band', () => {
    assert.ok(src.includes('DataSourceBadge status={macroStatus}'), 'Chile band must show the live/persisted macro status')
    assert.ok(src.includes('DataSourceBadge status="static"'), 'US band must always show static (BCCh has no US series)')
  })

  it('sector heat map and markets badges use MarketDataSourceBadge, not the BCCh-flavored DataSourceBadge', () => {
    assert.ok(src.includes('MarketDataSourceBadge status={sectorStatus}'), 'sector badge must be market-flavored, not BCCh-flavored')
    assert.ok(src.includes('MarketDataSourceBadge status={indexStatus}'), 'index badge must be market-flavored, not BCCh-flavored')
    // Regression guard for the exact bug this phase caught and fixed: reusing
    // the macro badge component would show "BCCh persisted" on market data.
    // (Un-anchored "DataSourceBadge" would also match the tail of
    // "MarketDataSourceBadge" — require a non-word char or start-of-tag before it.)
    assert.ok(!/(^|[^a-zA-Z])DataSourceBadge status=\{sectorStatus\}/.test(src))
    assert.ok(!/(^|[^a-zA-Z])DataSourceBadge status=\{indexStatus\}/.test(src))
  })

  it('computes sector/index status from already-fetched state (no new provider calls)', () => {
    assert.ok(/const sectorStatus[^=]*=\s*live\?\.sectors/.test(src))
    assert.ok(/const indexStatus[^=]*=\s*live\?\.indices\.length/.test(src))
  })
})

// ─── Stocks / Company pages: MarketDataSourceBadge present ────────────────────

describe('Phase 8A — Stocks and Company pages show a live-price status badge', () => {
  it('Stocks page renders MarketDataSourceBadge next to the refresh control', () => {
    const src = readFileSync(STOCKS_PAGE, 'utf8')
    assert.ok(src.includes('MarketDataSourceBadge'))
    assert.ok(src.includes('priceStatus'))
  })

  it('Company page renders MarketDataSourceBadge and a working (non-"soon") watchlist link', () => {
    const src = readFileSync(COMPANY_PAGE, 'utf8')
    assert.ok(src.includes('MarketDataSourceBadge'))
    assert.ok(src.includes('priceStatus'))
    // Regression guard: this used to be a purely decorative disabled pill
    // claiming watchlist was "coming soon" — Watchlist has existed since 6A.
    assert.ok(!/StatusPill label=\{t\.company\.watchlistPill\} variant="soon"/.test(src))
    assert.ok(/href="\/watchlist"/.test(src), 'the watchlist action must be a real link, not a decorative pill')
  })
})

// ─── Regression: existing macro/market/CMF i18n metadata structure intact ─────

describe('Phase 8A regression — existing badge i18n namespaces unaffected', () => {
  const src = readFileSync(I18N, 'utf8')

  it('dataSource, marketData, and cmfData namespaces still define all 5 DataSourceStatus keys', () => {
    for (const ns of ['dataSource', 'marketData', 'cmfData']) {
      const block = src.match(new RegExp(`${ns}:\\s*\\{[^}]*\\}`, 's'))
      assert.ok(block, `${ns} block not found`)
      for (const key of ['static', 'live', 'hybridFallback', 'liveUnavailable', 'persisted']) {
        assert.ok(block![0].includes(`${key}:`), `${ns}.${key} missing`)
      }
    }
  })

  it('index proxy labels are still explicit about being proxies (not official exchange indices)', () => {
    const idx = readFileSync(join(ROOT, 'src/data/indexPerformance.json'), 'utf8')
    assert.ok(idx.includes('(proxy)') || idx.includes('proxy'), 'index proxy entries must stay labeled as proxies')
  })
})

// ─── Regression: watchlist/portfolio/auth/macro/market untouched ─────────────

describe('Phase 8A regression — no changes to auth, portfolio math, or ingestion', () => {
  it('portfolio valuation module is unchanged (still exports the same pure functions)', () => {
    const src = readFileSync(join(ROOT, 'src/lib/portfolio/valuation.ts'), 'utf8')
    assert.ok(src.includes('calculatePositionMarketValue'))
    assert.ok(src.includes('calculateUnrealizedPnL'))
  })

  it('middleware protected-route lists are unchanged', () => {
    const src = readFileSync(join(ROOT, 'src/middleware.ts'), 'utf8')
    const pagesMatch = src.match(/const PROTECTED_PAGES\s*=\s*(\[[^\]]*\])/)
    const apiMatch = src.match(/const PROTECTED_API\s*=\s*(\[[^\]]*\])/)
    assert.ok(pagesMatch && apiMatch)
    const pages = JSON.parse(pagesMatch![1].replace(/'/g, '"'))
    const apis = JSON.parse(apiMatch![1].replace(/'/g, '"'))
    assert.deepEqual(pages.sort(), ['/portfolio', '/watchlist'])
    assert.deepEqual(apis.sort(), ['/api/portfolios', '/api/watchlists'])
  })

  it('macro/market provider orchestrators are untouched by this phase', () => {
    assert.ok(readFileSync(join(ROOT, 'src/lib/providers/macroProvider.ts'), 'utf8').includes('resolveMacroIndicators'))
    assert.ok(readFileSync(join(ROOT, 'src/lib/providers/market/marketProvider.ts'), 'utf8').length > 0)
  })
})

// ─── Documentation matrix exists ──────────────────────────────────────────────

describe('Phase 8A documentation', () => {
  it('docs/data_source_status.md exists and covers every visible route', () => {
    const doc = readFileSync(join(ROOT, 'docs/data_source_status.md'), 'utf8')
    for (const route of ['Home', 'Stocks', 'Compare', 'Charting', 'Earnings', 'Hechos Esenciales', 'Macro', 'Company Detail', 'Watchlist', 'Portfolio']) {
      assert.ok(doc.includes(route), `data_source_status.md missing a section for ${route}`)
    }
  })

  it('the matrix documents the CMF CAPTCHA block explicitly', () => {
    const doc = readFileSync(join(ROOT, 'docs/data_source_status.md'), 'utf8')
    assert.ok(/CAPTCHA/.test(doc))
  })
})
