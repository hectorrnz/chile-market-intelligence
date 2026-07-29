// Phase 5F manual repair — the /macro historical-chart popup was rendered on
// the translucent Tier-5 "elevated modal" glass (`nv-glass-overlay`, a
// `var(--nv-card)` gradient at ~.72-.9 alpha + backdrop blur). That tier is
// correct for sparse label/toggle overlays (nav drawer, command palette,
// settings modals) but violates the project's own dense-content rule
// (design_principles §8: dense content — anything under 13px, including
// chart axis labels, tooltips, legend, and a source footer — must never sit
// on low-opacity glass; hard minimum .92 alpha). The underlying macro table
// was visibly readable through the popup body.
//
// The fix swaps the popup's fill to the existing Tier-6 near-opaque
// `nv-surface-dense` (`--surface-table`, .97 alpha, no blur — already the
// exact token this chart's own tooltip uses via `--chart-tooltip-bg`), while
// keeping the Tier-5 rounded modal *shape* (radius/border/shadow) via an
// inline style referencing the same tokens `nv-glass-overlay` used. No new
// global CSS class, no new token, no hardcoded color, no shared-component
// change — the defect was proven local to this one popup (every other
// `nv-glass-overlay` consumer is a sparse overlay, unaffected).
//
// This file locks down the repair itself; tests/fableMacroPage.test.ts and
// tests/fableMacroCalendarPage.test.ts continue to lock down that every
// other Phase 5F section, control, and data path is unchanged.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const MACRO = 'src/app/macro/page.tsx'
const CSS = 'src/app/globals.css'

const src = read(MACRO)
const css = read(CSS)

const popupBlock = src.slice(src.indexOf('Chart popup modal'), src.indexOf('Chart popup modal') + 3000)

describe('Manual repair — macro chart popup uses a near-opaque analytical surface', () => {
  it('1. the popup body uses the near-opaque dense surface class', () => {
    assert.match(popupBlock, /className="nv-surface-dense nv-pop /)
  })

  it('2. the popup no longer uses the overly transparent Tier-5 overlay glass', () => {
    assert.ok(!popupBlock.includes('nv-glass-overlay'), 'nv-glass-overlay (translucent gradient + blur) must be gone from the popup')
    assert.ok(!/var\(--nv-card\)/.test(popupBlock), 'must not reference the translucent --nv-card token')
  })

  it('3. the dense surface token itself is near-opaque in both themes, so the underlying page cannot show through', () => {
    const alphaOf = (decl: string) => {
      const m = decl.match(/,\s*\.(\d+)\)/)
      assert.ok(m, `could not read alpha from "${decl}"`)
      return Number(`0.${m![1]}`)
    }
    const light = css.match(/--nv-tbl:\s*rgba\([^)]+\)/)
    assert.ok(light, 'light --nv-tbl not found')
    assert.ok(alphaOf(light![0]) >= 0.92, 'light --nv-tbl alpha must be >= .92')

    const darkBlock = css.slice(css.indexOf('.dark {'))
    const dark = darkBlock.match(/--nv-tbl:\s*rgba\([^)]+\)/)
    assert.ok(dark, 'dark --nv-tbl not found')
    assert.ok(alphaOf(dark![0]) >= 0.92, 'dark --nv-tbl alpha must be >= .92')
  })

  it('4. the dense surface tier itself carries no backdrop-filter (no blur was moved onto chart internals)', () => {
    const rule = css.match(/\.nv-surface-dense \{[^}]*\}/)
    assert.ok(rule)
    assert.ok(!rule![0].includes('backdrop-filter'))
  })

  it('5. the dimmed page scrim is preserved, unchanged', () => {
    assert.match(src, /nv-scrim fixed inset-0 z-50 flex items-center justify-center p-4/)
  })

  it('6. the rounded Fable modal shape is preserved via existing radius/border/shadow tokens, not hardcoded', () => {
    assert.match(popupBlock, /borderRadius:\s*'var\(--radius-module\)'/)
    assert.match(popupBlock, /border:\s*'1px solid var\(--nv-bd\)'/)
    assert.match(popupBlock, /boxShadow:\s*'var\(--nv-sh-palette\)'/)
  })

  it('7. no hardcoded hex color was introduced by the repair', () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(popupBlock), 'popup block contains a hardcoded hex colour')
  })

  it('8. the chart, timeframe control, source badge/footer, and close action all remain inside the popup', () => {
    assert.match(popupBlock, /<LineChart data=\{liveChart \?\? historyData\}/)
    assert.match(popupBlock, /<SegmentedControl/)
    assert.match(popupBlock, /<DataSourceBadge status=\{histStatus\} provider=\{chartProvider\}/)
    assert.match(popupBlock, /aria-label=\{t\.fable\.panel\.close\}/)
  })

  it('9. the unavailable/no-history state still routes through the shared AsyncState component', () => {
    assert.match(popupBlock, /<AsyncState kind="unavailable" message=\{t\.macro\.noHistory\}\s*\/>/)
  })

  it('10. responsive containment classes (size, max-height, scroll) are unchanged', () => {
    assert.match(popupBlock, /w-full max-w-3xl p-5 max-h-\[90vh\] overflow-y-auto/)
  })

  it('11. the popup entrance animation is unchanged and stays subject to the shared reduced-motion rule', () => {
    assert.match(popupBlock, /nv-surface-dense nv-pop/)
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(reduced, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })

  it('12. no API route, provider, series-registry, or calculation file is referenced by this change', () => {
    // The popup edit touches only className/style on an existing element —
    // confirm the surrounding data-fetch/state wiring markers are untouched.
    assert.match(src, /const \[selected, setSelected\]/)
    assert.match(src, /const openRow = \(r: Row\)/)
    assert.match(src, /chartProvider/)
  })

  it('13. other Phase 5F sections are untouched — the indicators table, yield curve, and FX depth table are all still present', () => {
    assert.match(src, /<TableCard\s*\n\s*minWidth=\{660\}/)
    assert.match(src, /<GlassSurface variant="card" className="p-4">/)
    assert.match(src, /t\.macro\.fxDepth/)
  })

  it('14. unrelated modal consumers still use the sparse Tier-5 overlay glass, unchanged (defect was local to macro)', () => {
    const chartBuilder = read('src/app/chart-builder/page.tsx')
    const compare = read('src/app/compare/page.tsx')
    const commandPalette = read('src/components/ui/CommandPalette.tsx')
    const notificationBell = read('src/components/ui/NotificationBell.tsx')
    const detailPanel = read('src/components/fable/DetailPanel.tsx')
    const mobileNavDrawer = read('src/components/layout/MobileNavDrawer.tsx')
    for (const [name, contents] of [
      ['chart-builder settings modal', chartBuilder],
      ['compare settings modal', compare],
      ['CommandPalette', commandPalette],
      ['NotificationBell', notificationBell],
      ['DetailPanel', detailPanel],
      ['MobileNavDrawer', mobileNavDrawer],
    ] as const) {
      assert.match(contents, /nv-glass-overlay/, `${name} must still use the Tier-5 overlay glass`)
    }
  })
})
