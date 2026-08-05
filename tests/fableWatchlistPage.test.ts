// Phase 5B — /watchlist re-skinned into the Fable institutional language.
//
// The contract: the page looks different and every piece of behaviour that
// touches the user's real data is unchanged. Same four API calls with the same
// shapes, same status-code mapping, same client-side ticker validation, same
// seven columns, same links, same source footer, same protected route.
//
// Three pre-existing defects were deliberately corrected in this phase and are
// locked in below so they cannot silently regress:
//   1. DELETE ignored its response — a failed remove still dropped the row.
//   2. 'Loading…' / 'Error' / 'Network error' were untranslated literals.
//   3. The Add button painted `text-surface` on `bg-primary` (dark-mode AA).
//
// Source-scan checks (this repo has no React render harness).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const WATCHLIST = 'src/app/watchlist/page.tsx'
const src = read(WATCHLIST)
const i18n = read('src/lib/i18n.ts')

const count = (h: string, n: string) => h.split(n).length - 1

// ─── Sections ────────────────────────────────────────────────────────────────

describe('Phase 5B — every Watchlist section survives', () => {
  it('keeps the page header with tag, title and subtitle', () => {
    assert.match(src, /<SectionHeader/)
    assert.match(src, /tag=\{t\.watchlist\.tag\}/)
    assert.match(src, /title=\{t\.watchlist\.title\}/)
    assert.match(src, /subtitle=\{t\.watchlist\.subtitle\}/)
  })

  it('keeps the add-ticker form in the header actions, gated on a resolved watchlist', () => {
    assert.match(src, /actions=\{\s*watchlist \? \(\s*<AddTickerForm watchlistId=\{watchlist\.id\} onAdded=\{handleItemAdded\} \/>/s)
  })

  it('keeps the table and exactly one source footer', () => {
    assert.match(src, /<table/)
    assert.equal(count(src, '<TableSourceFooter'), 1)
    assert.match(src, /source=\{t\.watchlist\.source\}/)
  })

  it('surfaces the selected watchlist identity from real data, not a literal', () => {
    assert.match(src, /title=\{watchlist\?\.name\}/)
    assert.ok(!/title="[A-Za-z]/.test(src), 'the card title must come from the API row, never a hardcoded name')
  })

  it('adds no invented exposure, gain, or performance metric', () => {
    for (const forbidden of ['KpiCapsule', 'KpiHero', 'LineChart', 'Sparkline', 'BarrierGauge', 'totalValue', 'exposure']) {
      assert.ok(!src.includes(forbidden), `${forbidden} must not appear — no watchlist data backs it`)
    }
  })
})

// ─── Columns ─────────────────────────────────────────────────────────────────

describe('Phase 5B — all seven columns preserved, in order', () => {
  const COLUMNS = [
    't.stocks.cols.ticker',
    't.stocks.cols.company',
    't.stocks.cols.sector',
    't.stocks.cols.price',
    't.stocks.cols.dayChg',
    't.stocks.cols.ytd',
    't.watchlist.removeTicker',
  ]

  for (const col of COLUMNS) {
    it(`renders the ${col} column`, () => assert.ok(src.includes(col)))
  }

  it('declares them in the original order', () => {
    const positions = COLUMNS.map(c => src.indexOf(`label: ${c}`))
    for (const p of positions) assert.ok(p > 0, 'every column must appear in the header list')
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'column order changed')
  })

  it('keeps the action column visually blank but no longer nameless', () => {
    assert.match(src, /hidden: true/, 'the remove column header stays visually hidden')
    assert.match(src, /hidden \? 'sr-only'/, '…but is exposed to assistive tech')
  })

  it('adds no column for data the page has never shown (notes, added_at)', () => {
    assert.ok(!src.includes('added_at'))
    assert.ok(!/item\.notes/.test(src))
  })

  it('keeps every cell value and formatter', () => {
    assert.match(src, /c\?\.shortName \?\? item\.ticker/)
    assert.match(src, /c\?\.sector \?\? '—'/)
    assert.match(src, /s \? formatCLP\(s\.price\) : '—'/)
    assert.match(src, /s \? formatPct\(s\.dayChangePct\) : '—'/)
    assert.match(src, /s \? formatPct\(s\.ytdChangePct\) : '—'/)
    assert.equal(count(src, 'changeColor('), 2)
    assert.ok(!src.includes('toLocaleString'), 'formatting stays in src/lib/formatters.ts')
  })

  it('never renders a missing value as zero', () => {
    assert.ok(!/\?\?\s*0\b/.test(src))
    assert.ok(src.includes("'—'"))
  })
})

// ─── Selection / filtering / sorting ─────────────────────────────────────────

describe('Phase 5B — selection, filtering and sorting are unchanged (none existed)', () => {
  it('still resolves the single default watchlist from the API list', () => {
    assert.match(src, /json\.watchlists\?\.\[0\]/)
  })

  it('introduces no watchlist create/rename/delete UI (that would be a new feature)', () => {
    assert.ok(!/method: 'POST'\s*,[\s\S]{0,200}\/api\/watchlists'/.test(src), 'no create-watchlist call')
    assert.ok(!src.includes('createWatchlist'))
    assert.ok(!/renameWatchlist|deleteWatchlist/.test(src))
  })

  it('introduces no sorting the page never had', () => {
    assert.ok(!src.includes('sortKey'))
    assert.ok(!src.includes('aria-sort'))
    assert.ok(!src.includes('toggleSort'))
  })

  it('introduces no hidden default filtering — the list renders the API order verbatim', () => {
    assert.match(src, /items\.map\(item =>/)
    assert.ok(!/items\s*\.filter\(/.test(src), 'no filter may sit between the API list and the rows')
    assert.ok(!/\.sort\(/.test(src), 'no reordering of the API list')
  })
})

// ─── Add workflow ────────────────────────────────────────────────────────────

describe('Phase 5B — add-item workflow preserved', () => {
  it('keeps the client-side ticker validation against the covered universe', () => {
    assert.match(src, /const VALID_TICKERS = new Set\(ALL_COMPANIES\.map\(c => c\.ticker\.toUpperCase\(\)\)\)/)
    assert.match(src, /if \(!VALID_TICKERS\.has\(upper\)\) \{/)
    assert.match(src, /msg: t\.watchlist\.invalidTicker/)
  })

  it('keeps the exact POST request shape', () => {
    assert.match(src, /fetch\(`\/api\/watchlists\/\$\{watchlistId\}\/items`, \{/)
    assert.match(src, /method: 'POST'/)
    assert.match(src, /'Content-Type': 'application\/json'/)
    assert.match(src, /body: JSON\.stringify\(\{ ticker: upper \}\)/)
  })

  it('keeps duplicate (409) and invalid (422) handling exactly', () => {
    assert.match(src, /if \(res\.status === 409\) \{\s*setFeedback\(\{ type: 'err', msg: t\.watchlist\.duplicate \}\)/)
    assert.match(src, /res\.status === 422[\s\S]{0,80}t\.watchlist\.invalidTicker/)
  })

  it('keeps success behaviour: clear input, confirm, append, auto-dismiss', () => {
    assert.match(src, /setTicker\(''\)/)
    assert.match(src, /msg: t\.watchlist\.added/)
    assert.match(src, /onAdded\(json\.item as WatchlistItemRow\)/)
    assert.match(src, /setTimeout\(\(\) => setFeedback\(null\), 2500\)/)
  })

  it('keeps the datalist autocomplete over the full company list', () => {
    assert.match(src, /list="ticker-suggestions"/)
    assert.match(src, /<datalist id="ticker-suggestions">/)
    assert.match(src, /ALL_COMPANIES\.map\(c => \(/)
  })

  it('reports add failures in both languages instead of a raw English literal', () => {
    assert.match(src, /msg: t\.watchlist\.addError/)
    assert.match(src, /msg: t\.watchlist\.networkError/)
    assert.ok(!src.includes("msg: 'Network error'"), 'the untranslated literal is gone')
    assert.ok(!/msg: json\.error/.test(src), 'a raw server error code no longer leaks into the UI')
  })

  it('adds no optimistic insert — the row only appears after a successful response', () => {
    const okBranch = src.indexOf('setTicker(\'\')')
    const onAdded = src.indexOf('onAdded(json.item')
    assert.ok(okBranch > 0 && onAdded > okBranch, 'onAdded runs only inside the success branch')
  })
})

// ─── Remove workflow ─────────────────────────────────────────────────────────

describe('Phase 5B — remove-item workflow preserved, failure no longer silent', () => {
  it('keeps the exact DELETE request shape', () => {
    assert.match(src, /fetch\(`\/api\/watchlists\/\$\{watchlistId\}\/items\/\$\{encodeURIComponent\(ticker\)\}`, \{\s*method: 'DELETE',/)
  })

  it('now checks the response before dropping the row (the corrected defect)', () => {
    assert.match(src, /if \(!res\.ok\) \{[\s\S]{0,140}t\.watchlist\.removeError[\s\S]{0,40}return/)
    const okCheck = src.indexOf('if (!res.ok)')
    const removed = src.indexOf('onRemoved(ticker)')
    assert.ok(okCheck > 0 && removed > okCheck, 'onRemoved must run only after a successful response')
  })

  it('keeps the item on the list when the remove fails, and says so', () => {
    assert.match(i18n, /removeError:\s*'Could not remove ticker — it is still on your watchlist'/)
    assert.match(i18n, /removeError:\s*'No se pudo eliminar el ticker — sigue en tu watchlist'/)
  })

  it('reports remove success and failure through a live region', () => {
    assert.match(src, /msg: t\.watchlist\.removed/)
    assert.match(src, /setRemoveMsg/)
    assert.equal(count(src, 'aria-live="polite"'), 3, 'add feedback + remove feedback + item count')
  })

  it('keeps the per-row busy state', () => {
    assert.match(src, /disabled=\{removing === item\.ticker\}/)
    assert.match(src, /removing === item\.ticker \? '…' : '×'/)
  })

  it('keeps the remove control keyboard-operable and labelled, not a bare red glyph', () => {
    assert.match(src, /type="button"/)
    assert.match(src, /aria-label=\{`\$\{t\.watchlist\.removeTicker\} \$\{item\.ticker\}`\}/)
    assert.match(src, /title=\{`\$\{t\.watchlist\.removeTicker\} \$\{item\.ticker\}`\}/)
    assert.match(src, /aria-hidden="true">\{removing === item\.ticker \? '…' : '×'\}/)
  })

  it('adds no confirmation dialog where none existed', () => {
    assert.ok(!src.includes('window.confirm'))
  })
})

// ─── Async states ────────────────────────────────────────────────────────────

describe('Phase 5B — async states are distinct, not one generic panel', () => {
  it('distinguishes loading, blocked, error, no-watchlist and empty', () => {
    assert.match(src, /loading\s*\? 'loading'/)
    assert.match(src, /outcome === 'blocked' \? 'blocked'/)
    assert.match(src, /outcome === 'error'\s*\? 'error'/)
    assert.match(src, /outcome === 'none'\s*\? 'unavailable'/)
    assert.match(src, /items\.length === 0\s*\? 'empty'/)
  })

  it('gives each state its own message, and keeps the original empty wording', () => {
    assert.match(src, /t\.watchlist\.sessionExpired/)
    assert.match(src, /t\.watchlist\.loadError/)
    assert.match(src, /t\.watchlist\.noWatchlist/)
    assert.match(src, /t\.watchlist\.emptyWatchlist/)
  })

  it('maps a mid-session 401 to blocked rather than to "empty watchlist"', () => {
    assert.equal(count(src, "=== 401 ? 'blocked'"), 2, 'both fetches classify 401 as blocked')
  })

  it('drops the untranslated "Loading…" literal', () => {
    assert.ok(!src.includes("'Loading…'"))
    assert.ok(!src.includes('>Loading'))
  })

  it('keeps the source footer visible in every state', () => {
    // Previously the empty state replaced the whole card, taking the source
    // line with it. TableCard renders `state` instead of the table body while
    // the footer slot still renders.
    const footerIdx = src.indexOf('footer={')
    const stateIdx = src.indexOf('state={state}')
    assert.ok(stateIdx > 0 && footerIdx > stateIdx, 'the footer is a sibling of the state, not inside the table')
    assert.match(read('src/components/fable/TableCard.tsx'), /\{footer && </)
  })

  it('never prints a count of 0 next to an error or an expired session', () => {
    assert.match(src, /const countKnown = state === undefined \|\| state === 'empty'/)
    assert.match(src, /\{countKnown && \(/)
  })

  it('AsyncState still distinguishes all seven kinds', () => {
    const a = read('src/components/fable/AsyncState.tsx')
    for (const k of ['loading', 'empty', 'error', 'unavailable', 'blocked', 'partial', 'stale']) {
      assert.ok(a.includes(`'${k}'`), `AsyncState lost the ${k} state`)
    }
  })
})

// ─── Links, source, protection ───────────────────────────────────────────────

describe('Phase 5B — links, source disclosure and route protection', () => {
  it('keeps the company link on every row', () => {
    assert.match(src, /<Link href=\{`\/companies\/\$\{item\.ticker\}`\}/)
    assert.match(src, /font-mono text-primary hover:underline/)
  })

  it('keeps the honest static-sample source label (prices here are not live)', () => {
    assert.match(i18n, /source:\s+'Static sample'/)
    assert.match(i18n, /source:\s+'Muestra estática'/)
  })

  it('claims no as-of it does not have', () => {
    assert.ok(!/asOf=/.test(src), 'static sample prices carry no meaningful timestamp')
  })

  it('invents no source badge that would contradict the footer', () => {
    assert.ok(!src.includes('MarketDataSourceBadge'))
    assert.ok(!src.includes('SourceStateBadge'))
    assert.ok(!src.includes('DataSourceBadge'))
  })

  it('leaves the route protected', async () => {
    // R1.5: protection moved from middleware's literal lists to the default-deny
    // access policy. Same property, asserted against the real decision function.
    const { requiresApprovedSession } = await import('../src/lib/auth/accessPolicy.ts')
    assert.ok(requiresApprovedSession('/watchlist'))
    assert.ok(requiresApprovedSession('/api/watchlists'))
  })

  it('creates no second authentication path and no sample fallback', () => {
    assert.ok(!src.includes('signIn'))
    assert.ok(!src.includes('supabase'))
    assert.ok(!/SAMPLE|MOCK|DEMO|placeholderItems/i.test(src))
  })
})

// ─── API contracts ───────────────────────────────────────────────────────────

describe('Phase 5B — no API contract changed', () => {
  it('calls exactly the four pre-existing endpoints, unchanged', () => {
    assert.match(src, /fetch\('\/api\/watchlists', \{ cache: 'no-store' \}\)/)
    assert.match(src, /fetch\(`\/api\/watchlists\/\$\{wl\.id\}\/items`, \{ cache: 'no-store' \}\)/)
    assert.equal(count(src, 'fetch('), 4)
  })

  it('leaves every watchlist route file untouched in shape', () => {
    const listRoute = read('src/app/api/watchlists/route.ts')
    const itemsRoute = read('src/app/api/watchlists/[id]/items/route.ts')
    const tickerRoute = read('src/app/api/watchlists/[id]/items/[ticker]/route.ts')
    assert.match(listRoute, /export async function GET/)
    assert.match(listRoute, /export async function POST/)
    assert.match(itemsRoute, /status: 409/)
    assert.match(itemsRoute, /status: 422/)
    assert.match(itemsRoute, /status: 201/)
    assert.match(tickerRoute, /export async function DELETE/)
    assert.match(tickerRoute, /status: 204/)
  })

  it('imports no server-only module into the client page', () => {
    assert.ok(!src.includes('@/lib/supabase/'))
    assert.ok(!/@\/lib\/db\/repositories\/watchlistRepository'/.test(src.replace(/import type[\s\S]*?from '@\/lib\/db\/repositories\/watchlistRepository'/, '')),
      'only the type-only repository import is allowed')
    assert.match(src, /import type \{ WatchlistRow, WatchlistItemRow \}/)
  })

  it('adds no runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })
})

// ─── Fable visual language ───────────────────────────────────────────────────

describe('Phase 5B — Fable visual language', () => {
  it('uses the shared analytical TableCard', () => {
    assert.match(src, /<TableCard/)
    assert.match(src, /from '@\/components\/fable\/TableCard'/)
  })

  it('puts dense content on the near-opaque surface, never blurred glass', () => {
    assert.match(src, /backgroundColor: 'var\(--surface-table\)'/)
    assert.ok(!/backdrop-filter/.test(src))
    assert.ok(!src.includes('nv-glass-card'))
    assert.match(read('src/components/fable/TableCard.tsx'), /variant="dense"/)
  })

  it('uses tokenised row hover and no shadow on rows or controls', () => {
    assert.match(src, /nv-row-hover nv-transition/)
    assert.ok(!src.includes('hover:bg-surface-2'))
    assert.ok(!/shadow-/.test(src))
  })

  it('uses Fable pill controls for the add workflow', () => {
    assert.equal(count(src, 'rounded-full'), 3, 'ticker input + add button + remove control')
    assert.match(src, /bg-\[var\(--nv-chip\)\]/)
    assert.match(src, /border-\[var\(--nv-chipbd\)\]/)
  })

  it('fixes the Add button foreground token (dark-mode contrast)', () => {
    assert.match(src, /bg-primary text-primary-fg/)
    assert.ok(!src.includes('bg-primary text-surface'), 'text-surface on bg-primary fails AA in dark mode')
  })

  it('uses the tokenised table-cell type scale', () => {
    assert.match(src, /fontSize: 'var\(--fs-table-cell\)'/)
  })

  it('hardcodes no hex colour and no raw Tailwind colour scale', () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src))
    assert.ok(
      !/\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(src),
    )
  })

  it('uses no purple (reserved for the Review token)', () => {
    assert.ok(!/--review\b|--chart-review/.test(src))
  })
})

describe('Phase 5B — motion', () => {
  it('uses only the shared reveal primitive with the Fable stagger', () => {
    assert.match(src, /<Reveal>/)
    assert.match(src, /<Reveal delayMs=\{70\}>/)
    assert.match(src, /from '@\/components\/fable\/motion'/)
  })

  it('animates no market value and adds no row-insert animation', () => {
    assert.ok(!src.includes('countUp'))
    assert.ok(!src.includes('ContentPulse'))
    assert.ok(!src.includes('@keyframes'))
    assert.ok(!/animation:/.test(src))
  })

  it('the reveal primitive renders its final state under reduced motion', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })
})

// ─── Accessibility ───────────────────────────────────────────────────────────

describe('Phase 5B — accessibility', () => {
  it('uses semantic table markup with scoped headers and a caption', () => {
    assert.match(src, /scope="col"/)
    assert.match(src, /<caption className="sr-only">/)
  })

  it('labels the add form and its input, and links validation feedback to it', () => {
    assert.match(src, /aria-label=\{t\.watchlist\.addTicker\}/)
    assert.match(src, /aria-label=\{t\.watchlist\.tickerLabel\}/)
    assert.match(src, /aria-describedby=\{feedbackId\}/)
    assert.match(src, /aria-invalid=\{feedback\?\.type === 'err' \|\| undefined\}/)
  })

  it('never conveys add/remove result by colour alone', () => {
    assert.equal(count(src, "'✓ ' : '⚠ '"), 2, 'both feedback regions pair a glyph with the colour')
  })

  it('announces async add and remove results', () => {
    assert.equal(count(src, 'role="status"'), 2)
  })
})

// ─── Responsive ──────────────────────────────────────────────────────────────

describe('Phase 5B — responsive', () => {
  it('keeps the full-width container and the 620px in-card scroll floor', () => {
    assert.match(src, /<div className="w-full space-y-5">/)
    assert.match(src, /minWidth=\{620\}/)
    assert.match(read('src/components/fable/TableCard.tsx'), /overflow-x-auto/)
  })

  it('lets the add form wrap so it stays usable at 390px', () => {
    assert.match(src, /<form onSubmit=\{handleAdd\} className="flex flex-wrap items-center gap-2"/)
  })

  it('lets the footer row wrap', () => {
    assert.match(src, /flex flex-wrap items-center justify-between/)
  })

  it('reintroduces no root min-width', () => {
    assert.doesNotMatch(read('src/app/globals.css'), /html\s*\{[^}]*min-width/s)
  })
})

// ─── Localisation ────────────────────────────────────────────────────────────

describe('Phase 5B — English and Spanish complete', () => {
  const NEW_KEYS = ['addError:', 'removeError:', 'networkError:', 'loadError:', 'noWatchlist:', 'sessionExpired:']

  for (const key of NEW_KEYS) {
    it(`watchlist.${key.replace(':', '')} exists in both dictionaries`, () => {
      assert.ok(count(i18n, key) >= 2, `${key} must be in dict.en and dict.es`)
    })
  }

  it('the Spanish strings are real translations, not copies', () => {
    assert.match(i18n, /addError:\s+'No se pudo agregar el ticker'/)
    assert.match(i18n, /networkError:\s+'Error de red — intenta nuevamente'/)
    assert.match(i18n, /noWatchlist:\s+'Aún no hay watchlist disponible\.'/)
    assert.match(i18n, /sessionExpired:'Tu sesión expiró — ingresa nuevamente\.'/)
  })

  it('adds no hardcoded visible English string to the page', () => {
    const literals = src.match(/>[A-Za-z][A-Za-z .,'()/-]{3,}</g) ?? []
    assert.deepEqual(literals, [], `unlocalised literal(s): ${literals.join(' | ')}`)
  })
})

// ─── Scope ───────────────────────────────────────────────────────────────────

describe('Phase 5B — scope held', () => {
  it('redesigns no other page', () => {
    // `/compare` was removed from this list in Phase 5D, `/macro` in
    // Phase 5F, `/earnings` in Phase 5G, `/portfolio` in Phase 5H, and
    // `/structured-notes` in Phase R3, each migrated to `TableCard` under its
    // own brief — real phase boundaries moving, not a relaxed assertion. They
    // are guarded by `tests/fableComparePage.test.ts` /
    // `tests/fableMacroPage.test.ts` / `tests/fableEarningsPage.test.ts` /
    // `tests/fablePortfolioPage.test.ts` /
    // `tests/fableStructuredNotesPage.test.ts`.
    // `/` (Home) was removed from this list in Phase R10 — migrated to
    // `TableCard` under its own brief; a real phase boundary moving, not a
    // relaxed assertion. It is guarded by `tests/fableHomePage.test.ts`.
    assert.ok(read('src/app/page.tsx').length > 0, 'src/app/page.tsx must still exist')
  })

  it('leaves the Phase 5A Stocks page untouched by this phase', () => {
    const stocks = read('src/app/stocks/page.tsx')
    assert.match(stocks, /minWidth=\{760\}/)
    assert.match(stocks, /<MarketDataSourceBadge status=\{priceStatus\}/)
    assert.match(stocks, /aria-sort=\{ariaSort\(key\)\}/)
  })
})
