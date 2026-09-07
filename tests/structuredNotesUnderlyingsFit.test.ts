// R13.7B2.2.4 — the Structured Notes detail "Underlyings" table FITS its card:
// no internal horizontal scrollbar at 1440 or 1024, every column and value
// preserved, Current levels LEFT / Underlyings RIGHT unchanged.
//
// Two layers of proof:
//   1. Source-scan (always runs): the table is a `.nv-tbl-fit` inside a
//      `.nv-tbl-fit-host`, has no `minWidth`, declares an 8-column budget that
//      sums to 100, keeps all eight headers and all eight values, and the fit
//      layer's stacked mode is a CONTAINER query that hides only the header
//      row and the column template.
//   2. Rendered geometry (runs when a Chrome/Chromium binary is available,
//      otherwise skipped with a message): the fit-table CSS layer is lifted
//      verbatim from globals.css into a self-contained harness with the real
//      typographic tokens, the Underlyings DOM is rendered in a 548px box (the
//      measured 2fr card width at a 1440 viewport) and a 381px box (at 1024),
//      and headless Chrome reports `scrollWidth === clientWidth` on the card's
//      scroll wrapper for both — plus, at 548, no header word and no numeral
//      leaves its own cell (the cell's padding gutter is the tolerance), and
//      at 381 the stacked mode is active with every `<td>` still rendered.
//
// Pure: no Supabase, no network, no Next.js runtime. The browser step only
// touches a temp file and a local Chrome binary.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DETAIL = read('../src/app/structured-notes/[id]/page.tsx')
const CSS = read('../src/app/globals.css')

const ROW2 = DETAIL.slice(DETAIL.indexOf('{/* ROW 2'), DETAIL.indexOf('{/* Observation schedule'))
/** The Underlyings TableCard only — from its title to the end of row 2. */
const UNDER = ROW2.slice(ROW2.indexOf('title={t.sn.underlyings}'))
const FIT_LAYER = CSS.slice(CSS.indexOf('/* Fit table (R13.7B2.2.3'), CSS.indexOf('/* Ken-Burns drift.'))
const STACK = FIT_LAYER.slice(FIT_LAYER.indexOf('@container (max-width: 519px)'))

/** The eight columns, in order: header key → value expression. */
const COLUMNS: Array<[string, string]> = [
  ['#', 'u.underlyingOrder'],
  ['t.sn.colUnderlyings', 'u.underlyingName'],
  ['t.sn.symbolLabel', "u.yahooSymbol ?? '—'"],
  ['t.sn.initialLevel', 'fmtNum(u.initialLevel)'],
  ['t.sn.strikeLevel', 'fmtNum(u.strikeLevel)'],
  ['t.sn.colKnockIn', 'fmtNum(u.knockInBarrierLevel)'],
  ['t.sn.monitoring.coupon', 'fmtNum(u.couponBarrierLevel)'],
  ['t.sn.monitoring.autocall', 'fmtNum(u.autocallBarrierLevel)'],
]
/** The measured budget (see the colgroup comment in page.tsx). */
const BUDGET = [4, 19, 12, 12, 12, 13, 12, 16]

// ═════════════════════════════════════════════════════════════════════════
// 1 · SOURCE CONTRACT
// ═════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.4 — Underlyings is a fit table: no minWidth, no in-card horizontal scroll', () => {
  it('A · the TableCard declares no minWidth and the table is a hosted fit table', () => {
    assert.ok(UNDER.length > 0, 'the underlyings card exists')
    assert.match(ROW2, /<TableCard\s+title=\{t\.sn\.underlyings\}\s+className="h-full"\s+footer=/, 'title → className → footer: no minWidth prop')
    assert.doesNotMatch(code(UNDER), /minWidth|overflow-x|w-full/)
    assert.match(UNDER, /<div className="nv-tbl-fit-host">\s*<table className="nv-tbl-fit nv-tbl-fit--stack" style=\{\{ fontSize: 'var\(--fs-table-cell\)' \}\}>/)
    // The only remaining in-card scroll on the page is the schedule's.
    assert.equal((DETAIL.match(/minWidth=\{\d+\}/g) ?? []).length, 1, 'exactly one minWidth left on the page (the schedule)')
    assert.match(DETAIL, /minWidth=\{680\}/)
  })

  it('B · the column budget sums to 100 and is the measured one', () => {
    const colgroup = UNDER.slice(UNDER.indexOf('<colgroup>'), UNDER.indexOf('</colgroup>'))
    const widths = [...colgroup.matchAll(/<col style=\{\{ width: '(\d+)%' \}\} \/>/g)].map((m) => Number(m[1]))
    assert.equal(widths.length, 8)
    assert.equal(widths.reduce((a, b) => a + b, 0), 100)
    assert.deepEqual(widths, BUDGET)
  })

  it('C · every column is preserved, in order, with its value and a data-label', () => {
    const thead = UNDER.slice(UNDER.indexOf('<thead>'), UNDER.indexOf('</thead>'))
    const headers = [...thead.matchAll(/<th scope="col" className=\{[^}]*\}[^>]*>\{?([^<{}]+)\}?<\/th>/g)].map((m) => m[1].trim())
    assert.deepEqual(headers, COLUMNS.map(([h]) => h))
    const tbody = UNDER.slice(UNDER.indexOf('<tbody>'), UNDER.indexOf('</tbody>'))
    const cells = [...tbody.matchAll(/<td className="([^"]*)" data-label=(\{[^}]+\}|"#")>\{([^<]+)\}<\/td>/g)]
    assert.equal(cells.length, 8, 'eight <td> per underlying, each with a data-label')
    assert.deepEqual(cells.map((m) => m[3].trim()), COLUMNS.map(([, v]) => v))
    // The stacked label of every cell is its own header.
    assert.deepEqual(cells.map((m) => m[2].replace(/^\{|\}$|^"|"$/g, '')), COLUMNS.map(([h]) => h))
    // Numerals keep `ui-number`; the identity cell keeps its wrap allowance.
    for (const [i, m] of cells.entries()) {
      if (COLUMNS[i][1].startsWith('fmtNum') || i === 0) assert.match(m[1], /\bui-number\b/, `column ${i} is numeric`)
    }
    assert.match(cells[1][1], /\bnv-tbl-fit-name\b/)
    assert.match(cells[2][1], /\bfont-mono\b/, 'the symbol is an identifier — mono is correct here')
  })

  it('D · Current levels stays LEFT and Underlyings RIGHT on the unchanged 3fr/2fr row', () => {
    const levels = ROW2.indexOf('title={t.sn.currentPrices}')
    const under = ROW2.indexOf('title={t.sn.underlyings}')
    assert.ok(levels > -1 && under > levels)
    assert.match(ROW2, /grid-cols-1 lg:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/)
    assert.equal((DETAIL.match(/nv-tbl-fit nv-tbl-fit--stack/g) ?? []).length, 2, 'two fit tables: current levels and underlyings')
    assert.equal((DETAIL.match(/<div className="nv-tbl-fit-host">/g) ?? []).length, 2, 'each inside its own host')
  })

  it('E · the fit layer stacks on the HOST width and hides only the header row and column template', () => {
    assert.match(FIT_LAYER, /\.nv-tbl-fit-host \{ container-type: inline-size; \}/)
    assert.match(FIT_LAYER, /\.nv-tbl-fit \{ table-layout: fixed; width: 100%; border-collapse: collapse; \}/)
    assert.ok(STACK.length > 0, 'a container-query stacked mode exists')
    assert.doesNotMatch(FIT_LAYER, /@media/)
    const hidden = [...STACK.matchAll(/([^{}]+)\{[^}]*display: none;[^}]*\}/g)].map((m) => m[1].trim())
    assert.deepEqual(hidden, ['.nv-tbl-fit--stack colgroup,\n    .nv-tbl-fit--stack thead'])
    assert.match(STACK, /\.nv-tbl-fit--stack td::before \{\s*content: attr\(data-label\);/)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 2 · RENDERED GEOMETRY (headless Chrome, when available)
// ═════════════════════════════════════════════════════════════════════════

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((p): p is string => Boolean(p))
  return candidates.find((p) => existsSync(p)) ?? null
}

/** Card widths measured in the R13.7B2.2.3/4 headless sweeps: the 2fr column at each viewport. */
const CARD_WIDTH = { 1440: 548, 1024: 381 } as const

function buildHarness(): string {
  const th = (label: string, extra = '') => `<th class="ui-table-header${extra}">${label}</th>`
  const td = (cls: string, label: string, v: string) => `<td class="${cls}" data-label="${label}">${v}</td>`
  const row = (n: string, name: string, sym: string, a: string, b: string) => `<tr>${td('ui-number', '#', n)}${td('nv-tbl-fit-name', 'Underlyings', name)}${td('font-mono', 'Symbol', sym)}${td('ui-number', 'Initial', a)}${td('ui-number', 'Strike', a)}${td('ui-number', 'Knock-in', b)}${td('ui-number', 'Coupon', b)}${td('ui-number', 'Autocall', a)}</tr>`
  const table = (headers: string[]) => `<div class="wrap" data-wrap><div class="nv-tbl-fit-host"><table class="nv-tbl-fit nv-tbl-fit--stack">
    <colgroup>${BUDGET.map((w) => `<col style="width:${w}%">`).join('')}</colgroup>
    <thead><tr>${th(headers[0])}${th(headers[1], ' nv-tbl-fit-name')}${headers.slice(2).map((h) => th(h)).join('')}</tr></thead>
    <tbody>${row('1', 'Russell 2000 Index', '^RUT', '2.313,32', '1.503,66')}${row('2', 'S&amp;P 500 Index', '^GSPC', '15.904,35', '10.337,83')}</tbody>
  </table></div></div>`
  const EN = ['#', 'Underlyings', 'Symbol', 'Initial', 'Strike', 'Knock-in', 'Coupon', 'Autocall']
  const ES = ['#', 'Subyacentes', 'Símbolo', 'Inicial', 'Strike', 'Knock-in', 'Cupón', 'Autocall']
  const boxes = Object.entries(CARD_WIDTH).flatMap(([vp, w]) => [
    `<div data-box="en-${vp}" style="width:${w}px">${table(EN)}</div>`,
    `<div data-box="es-${vp}" style="width:${w}px">${table(ES)}</div>`,
  ])
  // The real tokens the fit layer consumes, lifted from globals.css by value so
  // the harness needs no build; the fit layer itself is the SOURCE text.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html { font-size: 17px; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; font-variant-numeric: tabular-nums lining-nums; }
    :root { --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; --fs-table-cell: 12.2px; --fs-section-label: 10.5px; --tracking-section-label: .14em; --fw-bold: 700; --muted-fg: #6E7276; }
    .ui-table-header { font-family: var(--font-sans); font-size: var(--fs-section-label); font-weight: var(--fw-bold); text-transform: uppercase; letter-spacing: var(--tracking-section-label); color: var(--muted-fg); }
    .ui-number { font-family: var(--font-sans); font-variant-numeric: tabular-nums; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    table { font-size: var(--fs-table-cell); }
    .wrap { overflow-x: auto; }
    [data-box] { margin-bottom: 12px; }
    ${FIT_LAYER}
  </style></head><body>${boxes.join('')}<pre id="m"></pre>
  <script>
    const out = []
    const word = (th, w) => { const s = document.createElement('span'); s.className = 'ui-table-header'; s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'; s.textContent = w; th.appendChild(s); const px = s.getBoundingClientRect().width; s.remove(); return px }
    for (const box of document.querySelectorAll('[data-box]')) {
      const wrap = box.querySelector('[data-wrap]'), table = box.querySelector('table')
      const stacked = getComputedStyle(table.querySelector('thead')).display === 'none'
      const tds = [...table.querySelectorAll('td')]
      const visible = tds.filter((td) => td.getClientRects().length > 0).length
      let hdrSpill = 0, cellSpill = 0
      if (!stacked) {
        for (const th of table.querySelectorAll('th')) { const cs = getComputedStyle(th); const content = th.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); const gutter = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); for (const w of th.textContent.trim().split(/\\s+/)) hdrSpill = Math.max(hdrSpill, (word(th, w) - content) / gutter) }
        for (const td of tds) { const cs = getComputedStyle(td); const content = td.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); const gutter = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); const r = document.createRange(); r.selectNodeContents(td); const wide = Math.max(0, ...[...r.getClientRects()].map((x) => x.width)); cellSpill = Math.max(cellSpill, (wide - content) / gutter) }
      }
      out.push([box.dataset.box, wrap.clientWidth, wrap.scrollWidth, stacked ? 1 : 0, tds.length, visible, hdrSpill.toFixed(3), cellSpill.toFixed(3)].join('|'))
    }
    document.getElementById('m').textContent = out.join('\\n')
  </script></body></html>`
}

describe('R13.7B2.2.4 — rendered proof: scrollWidth === clientWidth at the 1440 and 1024 card widths', () => {
  const chrome = findChrome()
  it('F · headless Chrome: no horizontal overflow, a table at 548px, a labelled stack at 381px', { skip: chrome ? false : 'no Chrome/Chromium binary found (set CHROME_PATH to run the rendered proof)' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'nmi-underlyings-fit-'))
    try {
      const file = join(dir, 'harness.html')
      writeFileSync(file, buildHarness())
      const dom = execFileSync(chrome!, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-sandbox', `--user-data-dir=${join(dir, 'profile')}`, '--window-size=1462,1200', '--virtual-time-budget=2000', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] })
      const m = /<pre id="m">([\s\S]*?)<\/pre>/.exec(dom)
      assert.ok(m, 'the harness wrote its measurements')
      const rows = m![1].trim().split('\n').map((l) => l.split('|'))
      assert.equal(rows.length, 4, 'EN and ES at both widths')
      for (const [box, client, scroll, stacked, tds, visible, hdrSpill, cellSpill] of rows) {
        assert.equal(Number(client) > 0, true, `${box}: measured`)
        assert.equal(scroll, client, `${box}: scrollWidth === clientWidth (no horizontal scroll)`)
        assert.equal(tds, '16', `${box}: two underlyings × eight cells in the DOM`)
        assert.equal(visible, '16', `${box}: every cell is rendered — nothing hidden`)
        if (box.endsWith('-1440')) {
          assert.equal(stacked, '0', `${box}: a real table at the 2fr width of a 1440 viewport`)
          assert.ok(Number(hdrSpill) < 1, `${box}: every header word stays inside its own cell (spill/gutter ${hdrSpill})`)
          assert.ok(Number(cellSpill) < 1, `${box}: every value stays inside its own cell (spill/gutter ${cellSpill})`)
        } else {
          assert.equal(stacked, '1', `${box}: stacked one block per underlying at the 2fr width of a 1024 viewport`)
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
