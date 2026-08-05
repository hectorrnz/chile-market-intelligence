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
// Phase R5 — the popup moved onto the shared ModalShell (the R4.1 dialog
// system), whose `dense` prop IS the repair, now enforced structurally: dense
// mode renders `nv-surface-dense` (near-opaque, no blur) with the Tier-5
// rounded modal shape from the same tokens, and can never silently fall back
// to the translucent overlay glass for this popup. This file keeps locking
// the repair — the assertions target the shared shell plus the page's use of
// its dense mode instead of the old hand-rolled markup.
//
// tests/fableMacroPage.test.ts and tests/fableMacroCalendarPage.test.ts
// continue to lock down that every other Phase 5F section, control, and data
// path is unchanged.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const MACRO = 'src/app/macro/page.tsx'
const SHELL = 'src/components/fable/ModalShell.tsx'
const CSS = 'src/app/globals.css'

const src = read(MACRO)
const shell = read(SHELL)
const css = read(CSS)

const popupBlock = src.slice(src.indexOf('Chart popup'), src.indexOf('Chart popup') + 3000)

describe('Manual repair — macro chart popup uses a near-opaque analytical surface', () => {
  it('1. the popup renders through the shared ModalShell in dense mode (R5)', () => {
    assert.match(popupBlock, /<ModalShell/)
    assert.match(popupBlock, /dense/)
    assert.match(shell, /dense \? 'nv-surface-dense' : 'nv-glass-overlay'/)
  })

  it('2. the popup does not opt into the overly transparent Tier-5 overlay glass', () => {
    assert.ok(!popupBlock.includes('nv-glass-overlay'), 'the popup must stay on the dense analytical surface')
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

  it('5. the dimmed page scrim is preserved (rendered by ModalShell)', () => {
    assert.match(shell, /nv-scrim absolute inset-0/)
  })

  it('6. the rounded Fable modal shape comes from existing radius/border/shadow tokens, not hardcoded values', () => {
    const denseStyle = shell.slice(shell.indexOf('dense'))
    assert.match(denseStyle, /borderRadius: 'var\(--radius-module\)'/)
    assert.match(denseStyle, /border: '1px solid var\(--nv-bd\)'/)
    assert.match(denseStyle, /boxShadow: 'var\(--shadow-palette\)'/)
  })

  it('7. no hardcoded hex color in the popup block', () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(popupBlock), 'popup block contains a hardcoded hex colour')
  })

  it('8. the chart, timeframe control, source badge, and localized close action all remain inside the popup', () => {
    assert.match(popupBlock, /<LineChart data=\{liveChart \?\? historyData\}/)
    assert.match(popupBlock, /<SegmentedControl/)
    assert.match(popupBlock, /<DataSourceBadge status=\{histStatus\} provider=\{chartProvider\}/)
    assert.match(shell, /aria-label=\{t\.fable\.panel\.close\}/)
  })

  it('9. the unavailable/no-history state still routes through the shared AsyncState component', () => {
    assert.match(popupBlock, /<AsyncState kind="unavailable" message=\{t\.macro\.noHistory\}\s*\/>/)
  })

  it('10. responsive containment (size cap, max-height, internal scroll) comes from the shared shell', () => {
    assert.match(popupBlock, /size="lg"/)
    assert.match(shell, /lg: 'max-w-3xl'/)
    assert.match(shell, /max-h-\[85vh\]/)
    assert.match(shell, /overflow-y-auto/)
  })

  it('11. the popup entrance animation stays subject to the shared reduced-motion rule', () => {
    assert.match(shell, /nv-pop/)
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(reduced, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })

  it('12. no API route, provider, series-registry, or calculation file is referenced by this change', () => {
    // The popup edit touches only presentation — confirm the surrounding
    // data-fetch/state wiring markers are untouched.
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
    // Phase R6 migrated the Compare settings modal to the shared ModalShell
    // (which itself carries nv-glass-overlay), so the compare page no longer
    // holds raw overlay markup — a real phase boundary moving, not a relaxed
    // assertion. The shell delegation is guarded in tests/fableComparePage.test.ts.
    // R12 migrated the chart-builder settings modal to the shared ModalShell
    // too (the last hand-rolled dialog), so — exactly like compare above — it
    // no longer holds raw overlay markup; the shell it delegates to carries
    // the Tier-5 glass. Same phase-boundary move, not a relaxed assertion.
    const chartBuilder = read('src/app/chart-builder/page.tsx')
    const compare = read('src/app/compare/page.tsx')
    const commandPalette = read('src/components/ui/CommandPalette.tsx')
    const notificationBell = read('src/components/ui/NotificationBell.tsx')
    const detailPanel = read('src/components/fable/DetailPanel.tsx')
    const mobileNavDrawer = read('src/components/layout/MobileNavDrawer.tsx')
    assert.match(chartBuilder, /<ModalShell/, 'chart-builder settings modal delegates to the shared shell')
    assert.match(read('src/components/fable/ModalShell.tsx'), /nv-glass-overlay/, 'the shared shell carries the Tier-5 overlay glass')
    for (const [name, contents] of [
      ['CommandPalette', commandPalette],
      ['NotificationBell', notificationBell],
      ['DetailPanel', detailPanel],
      ['MobileNavDrawer', mobileNavDrawer],
    ] as const) {
      assert.match(contents, /nv-glass-overlay/, `${name} must still use the Tier-5 overlay glass`)
    }
    assert.match(compare, /<ModalShell/, 'compare settings modal now rides the shared ModalShell')
  })
})
