// R13.7B2.2.2 § 4-10, § 13 L-Y — the platform's shared DeleteButton.
//
// Two layers of proof:
//   1. BEHAVIOUR — the control is driven by a PURE reducer
//      (src/components/fable/deleteButtonState.ts), so confirm-once, cancel,
//      Escape, disabled, pending-lock and failure-recovery are proven here as
//      real state transitions, not as regexes over JSX.
//   2. INTEGRATION — source-scan (this repo's convention, no DOM harness): the
//      component's semantics/tokens/reduced-motion path, that every deletion
//      site uses it, that each site's PRE-EXISTING handler is what it invokes,
//      and that no backend delete route or its guard was touched.
//
// Pure: no Supabase, no network, no Next.js runtime.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

import {
  transition,
  invokesHandler,
  replay,
  INITIAL_DELETE_STATE,
  type DeleteButtonEvent,
  type DeleteButtonState,
} from '../src/components/fable/deleteButtonState.ts'
import { dict } from '../src/lib/i18n.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const exists = (p: string) => existsSync(new URL(p, import.meta.url))
/** Comment-stripped (block, line and JSX comments), so prose can neither satisfy nor trip a scan. */
const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const COMPONENT = read('../src/components/fable/DeleteButton.tsx')
const COMPONENT_CODE = code(COMPONENT)
const REDUCER = read('../src/components/fable/deleteButtonState.ts')
const CSS = read('../src/app/globals.css')
const DESIGN = read('../docs/design_principles.md')

/** The five deletion surfaces that must use the shared control. */
const SITES = {
  'structured-notes detail': read('../src/app/structured-notes/[id]/page.tsx'),
  'structured-notes list': read('../src/app/structured-notes/page.tsx'),
  watchlist: read('../src/app/watchlist/page.tsx'),
  'notification recipients': read('../src/app/settings/NotificationRecipientsCard.tsx'),
  'weekly notes': read('../src/components/familyPortfolio/WeeklyNotesPanel.tsx'),
} as const

/** The DELETE routes behind them, with the authorization each has always had. */
const ROUTES: Record<string, { file: string; guard: RegExp }> = {
  'structured note': { file: '../src/app/api/structured-notes/[id]/route.ts', guard: /guardAdministrator\(\)/ },
  'structured-note allocation': { file: '../src/app/api/structured-notes/[id]/allocations/[allocationId]/route.ts', guard: /guardAdministrator\(\)/ },
  'watchlist item': { file: '../src/app/api/watchlists/[id]/items/[ticker]/route.ts', guard: /getSupabaseUserClient|requireCurrentUser|getUserIdOrNull|getCurrentUser|guardPrivateApi/ },
  'notification recipient': { file: '../src/app/api/notification-recipients/[id]/route.ts', guard: /guardAdministrator\(\)/ },
  'weekly note': { file: '../src/app/api/family-portfolio/admin/publications/[id]/notes/[noteId]/route.ts', guard: /requireAdministrator\(\)/ },
}

const ALL_STATES: DeleteButtonState[] = ['idle', 'armed', 'pending', 'success']
const ALL_EVENTS: DeleteButtonEvent[] = [
  { type: 'ARM' }, { type: 'CANCEL' }, { type: 'ESCAPE' }, { type: 'CONFIRM' },
  { type: 'RESOLVE', ok: true }, { type: 'RESOLVE', ok: false }, { type: 'RESET' },
]
const on = { disabled: false }
const off = { disabled: true }

// ═════════════════════════════════════════════════════════════════════════════
// L · ONE SHARED COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 5 — one shared DeleteButton exists', () => {
  it('L · the component and its pure state module exist in the shared Fable layer', () => {
    assert.ok(exists('../src/components/fable/DeleteButton.tsx'))
    assert.ok(exists('../src/components/fable/deleteButtonState.ts'))
    assert.match(COMPONENT, /export function DeleteButton\(/)
    assert.match(COMPONENT, /from '\.\/deleteButtonState'/, 'the component renders what the reducer says')
  })

  it('L · no page draws its own trash icon or hand-rolls a delete trigger any more', () => {
    for (const [name, src] of Object.entries(SITES)) {
      assert.ok(!code(src).includes('M4 6h12M8.5 6V4.5h3V6'), `${name} still draws the old inline trash path`)
      assert.ok(!code(src).includes("'…' : '×'"), `${name} still renders the old bare × remover`)
    }
  })

  it('L · the reference dependency was NOT added — no animation library', () => {
    const pkg = JSON.parse(read('../package.json')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> }
    for (const dep of ['motion', 'framer-motion', '@motionone/dom']) {
      assert.ok(!(dep in pkg.dependencies), `${dep} must not be a dependency`)
      assert.ok(!(dep in (pkg.devDependencies ?? {})), `${dep} must not be a dev dependency`)
    }
    assert.ok(!/from ['"](motion|framer-motion)/.test(COMPONENT))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// M · EVERY DELETION SURFACE USES IT — AND THE NON-DELETIONS DO NOT
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 7 — every true deletion control is the shared component', () => {
  for (const [name, src] of Object.entries(SITES)) {
    it(`M · ${name} imports and renders DeleteButton and no longer renders a confirmation dialog for deletion`, () => {
      assert.match(src, /import \{ DeleteButton \} from '@\/components\/fable\/DeleteButton'/)
      assert.match(code(src), /<DeleteButton\b/)
      assert.ok(!/<DestructiveConfirm\b/.test(code(src)), `${name} still opens the old dialog`)
      assert.ok(!/window\.confirm/.test(code(src)), `${name} uses the browser confirm`)
    })
  }

  it('M · the documented exceptions are untouched — they are not deletions', () => {
    // Removing the last module on save and disabling an account are reversible
    // lifecycle/authorization changes, not record deletions: they keep the
    // shared alert dialog and its fuller explanatory copy.
    const manage = read('../src/app/settings/users/ManageUserDialog.tsx')
    assert.match(code(manage), /<DestructiveConfirm\b/)
    assert.ok(!/DeleteButton/.test(manage))
    // Clearing a Compare slot and deselecting a Charting metric are UI
    // selection changes over persisted PREFERENCES, not record deletions.
    for (const p of ['../src/app/compare/page.tsx', '../src/app/chart-builder/page.tsx']) {
      assert.ok(!/DeleteButton|DestructiveConfirm/.test(read(p)), `${p} must stay a plain selection control`)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// N–T · BEHAVIOUR (pure reducer)
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 8 — the confirmation gate as state transitions', () => {
  it('N · idle → armed on ARM; nothing else leaves idle', () => {
    assert.equal(INITIAL_DELETE_STATE, 'idle')
    assert.equal(transition('idle', { type: 'ARM' }, on), 'armed')
    for (const e of ALL_EVENTS.filter((x) => x.type !== 'ARM')) assert.equal(transition('idle', e, on), 'idle', e.type)
  })

  it('O · confirm invokes the handler EXACTLY once — repeated confirms while pending are no-ops', () => {
    const r = replay([{ type: 'ARM' }, { type: 'CONFIRM' }, { type: 'CONFIRM' }, { type: 'CONFIRM' }], on)
    assert.equal(r.invocations, 1)
    assert.equal(r.state, 'pending')
    assert.deepEqual(r.trace, ['idle', 'armed', 'pending', 'pending', 'pending'])
  })

  it('P · cancel invokes no handler, and a CONFIRM after cancel is a no-op (not armed)', () => {
    const r = replay([{ type: 'ARM' }, { type: 'CANCEL' }, { type: 'CONFIRM' }], on)
    assert.equal(r.invocations, 0)
    assert.equal(r.state, 'idle')
    assert.equal(invokesHandler('idle', { type: 'CONFIRM' }, on), false)
    assert.equal(invokesHandler('armed', { type: 'CANCEL' }, on), false)
  })

  it('Q · Escape cancels an armed control and invokes nothing', () => {
    const r = replay([{ type: 'ARM' }, { type: 'ESCAPE' }], on)
    assert.equal(r.state, 'idle')
    assert.equal(r.invocations, 0)
    assert.equal(invokesHandler('armed', { type: 'ESCAPE' }, on), false)
  })

  it('R · a disabled control cannot arm and cannot confirm', () => {
    assert.equal(transition('idle', { type: 'ARM' }, off), 'idle')
    assert.equal(replay([{ type: 'ARM' }, { type: 'CONFIRM' }], off).invocations, 0)
    // Even if it were somehow armed, disabled blocks the handler.
    assert.equal(invokesHandler('armed', { type: 'CONFIRM' }, off), false)
    assert.equal(transition('armed', { type: 'CONFIRM' }, off), 'armed')
  })

  it('S · pending locks everything: no second confirm, no cancel, no Escape, no re-arm — until it resolves', () => {
    for (const e of ALL_EVENTS.filter((x) => x.type !== 'RESOLVE')) assert.equal(transition('pending', e, on), 'pending', e.type)
    assert.equal(transition('pending', { type: 'RESOLVE', ok: true }, on), 'success')
    // A lock that lands mid-flight (disabled) must not strand the request.
    assert.equal(transition('pending', { type: 'RESOLVE', ok: true }, off), 'success')
    assert.equal(transition('pending', { type: 'RESOLVE', ok: false }, off), 'idle')
  })

  it('S · success is reachable ONLY through a successful resolve — never before the backend confirmed', () => {
    for (const s of ALL_STATES) {
      for (const e of ALL_EVENTS) {
        const next = transition(s, e, on)
        if (next === 'success' && s !== 'success') {
          assert.equal(s, 'pending')
          assert.deepEqual(e, { type: 'RESOLVE', ok: true })
        }
      }
    }
    // and success returns to idle only via RESET
    for (const e of ALL_EVENTS.filter((x) => x.type !== 'RESET')) assert.equal(transition('success', e, on), 'success', e.type)
    assert.equal(transition('success', { type: 'RESET' }, on), 'idle')
  })

  it('T · a failed deletion restores a usable idle state, and the control can be used again', () => {
    const r = replay([
      { type: 'ARM' }, { type: 'CONFIRM' }, { type: 'RESOLVE', ok: false }, // first attempt fails
      { type: 'ARM' }, { type: 'CONFIRM' }, { type: 'RESOLVE', ok: true },  // retry succeeds
    ], on)
    assert.deepEqual(r.trace, ['idle', 'armed', 'pending', 'idle', 'armed', 'pending', 'success'])
    assert.equal(r.invocations, 2, 'one invocation per arming')
  })

  it('the reducer is total and pure: every (state, event) pair yields a valid state, inputs untouched', () => {
    for (const s of ALL_STATES) for (const e of ALL_EVENTS) for (const c of [on, off]) {
      assert.ok(ALL_STATES.includes(transition(s, e, c)))
    }
    assert.ok(!/fetch\(|document\.|window\.|useState|import .* from 'react'/.test(REDUCER), 'no DOM, no React, no network in the state module')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// COMPONENT — the reducer is what renders; success is never optimistic
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 8 — the component renders the reducer and nothing else', () => {
  it('every user action goes through the reducer; the handler fires only where invokesHandler says so', () => {
    assert.match(COMPONENT_CODE, /const fire = invokesHandler\(prev, event, ctx\)/)
    assert.match(COMPONENT_CODE, /const next = transition\(prev, event, ctx\)/)
    assert.match(COMPONENT_CODE, /if \(!fire\) return/)
    assert.equal((COMPONENT_CODE.match(/await onConfirm\(\)/g) ?? []).length, 1, 'exactly one place invokes the handler')
    assert.match(COMPONENT_CODE, /dispatch\(\{ type: 'ARM' \}\)/)
    assert.match(COMPONENT_CODE, /dispatch\(\{ type: 'CONFIRM' \}\)/)
    assert.match(COMPONENT_CODE, /if \(e\.key === 'Escape'\) cancel\('ESCAPE'\)/)
  })

  it('success is shown only after the handler resolved; false or a throw returns to idle', () => {
    const resolve = COMPONENT_CODE.slice(COMPONENT_CODE.indexOf('await onConfirm()'), COMPONENT_CODE.indexOf('setState(resolved)'))
    assert.match(resolve, /ok = result !== false/)
    assert.match(resolve, /catch \{\s*ok = false/)
    assert.match(resolve, /\{ type: 'RESOLVE', ok \}/)
    assert.match(COMPONENT_CODE, /const success = state === 'success'/)
    // The pending lock is the reducer's, and it is also rendered as disabled/busy.
    assert.match(COMPONENT_CODE, /const locked = disabled \|\| pending/)
    assert.equal((COMPONENT_CODE.match(/disabled=\{locked\}/g) ?? []).length, 3, 'bin, check and cross all lock')
  })

  it('owns no deletion semantics: no fetch, no endpoint, no navigation, no capability check', () => {
    assert.ok(!/fetch\(|\/api\/|useRouter|router\.|canManage|isAdministrator|supabase/i.test(COMPONENT_CODE))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// U · REDUCED MOTION · V · ACCESSIBILITY
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 9-10 — motion on tokens, removed under reduced motion; accessible by construction', () => {
  const layer = CSS.slice(CSS.indexOf('Shared DeleteButton (R13.7B2.2.2'), CSS.indexOf('/* OVERLAY: anchored beside the bin') + 1200)
  const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))

  it('U · the lid, the panel and the check animate on existing tokens only — no new duration, easing or colour', () => {
    assert.match(layer, /\.nv-del-lid \{[^}]*transition: transform var\(--dur-state\) var\(--ease-primary\)/)
    assert.match(layer, /clip-path var\(--dur-pop\) var\(--ease-primary\)/)
    // R13.7B2.2.3 § 1-2 (INVERTED from "the question always wraps"): the question
    // may wrap only while the panel is OPEN and has a real width to wrap in. A
    // closed zero-width wrapper with a wrapping question wrapped one character
    // per line — a hidden panel hundreds of pixels tall that sized the header of
    // the card holding the idle control (the B2.2.2 Allocation defect).
    assert.match(layer, /\.nv-del--inline \.nv-del-question \{ flex: 1 1 auto; min-width: 0; white-space: nowrap;/)
    assert.match(layer, /\.nv-del--inline\[data-state='armed'\] \.nv-del-question,\s*\.nv-del--inline\[data-state='pending'\] \.nv-del-question \{ white-space: normal; overflow-wrap: break-word; \}/)
    // Closed, the wrapper is a ZERO-BY-ZERO box; open, it takes its natural size.
    assert.match(layer, /\.nv-del--inline \.nv-del-panelwrap \{\s*display: inline-flex;\s*min-width: 0;\s*width: 0;\s*height: 0;\s*overflow: hidden;\s*\}/)
    assert.match(layer, /\.nv-del--inline\[data-state='armed'\] \.nv-del-panelwrap,\s*\.nv-del--inline\[data-state='pending'\] \.nv-del-panelwrap \{\s*width: auto;\s*height: auto;/)
    assert.match(layer, /\.nv-del--md \{ flex-shrink: 0; \}/)
    assert.match(layer, /animation: nvDelCheck var\(--dur-state\) var\(--ease-primary\) forwards/)
    // A `0s` visibility toggle is not a duration; every real duration is a token.
    assert.doesNotMatch(layer.replace(/\b0s\b/g, ''), /\b\d+(\.\d+)?m?s\b/, 'no literal duration — tokens only')
    assert.doesNotMatch(layer, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour')
    assert.match(layer, /\.nv-del-confirm \{ background: var\(--critical-fill\); color: var\(--critical-fill-fg\); \}/)
    assert.match(layer, /color: var\(--negative\)/)
  })

  it('U · reduced motion preserves the state change and removes lid, panel and check motion', () => {
    assert.match(reduced, /\.nv-del-lid,\s*\.nv-del-panel,\s*\.nv-del-panelwrap \{\s*transition: none !important;\s*\}/)
    assert.match(reduced, /\.nv-del\[data-state='armed'\] \.nv-del-lid,\s*\.nv-del\[data-state='pending'\] \.nv-del-lid \{\s*transform: none !important;/)
    assert.match(reduced, /\.nv-del-check path \{\s*animation: none !important;\s*stroke-dashoffset: 0 !important;/)
    assert.match(reduced, /\.nv-del--inline \.nv-del-panel \{ transform: none !important; clip-path: none !important; \}/)
    // The panel's open/closed state is still driven by data-state — the rules
    // that SHOW it are in the layer, not gated on motion.
    assert.match(layer, /\.nv-del--inline\[data-state='armed'\] \.nv-del-panelwrap/)
    assert.match(layer, /\.nv-del--overlay\[data-state='armed'\] \.nv-del-panel/)
    assert.match(COMPONENT_CODE, /data-state=\{state\}/)
  })

  it('U · the design authority records the interaction as approved state motion', () => {
    assert.match(DESIGN, /Delete control arm \/ disarm/)
    assert.match(DESIGN, /R13\.7B2\.2\.2/)
  })

  it('V · three real buttons, a required record-naming label, a required visible question', () => {
    assert.equal((COMPONENT_CODE.match(/type="button"/g) ?? []).length, 3)
    assert.match(COMPONENT, /^\s+label: string$/m, 'the trigger name is required, not optional')
    assert.match(COMPONENT, /^\s+confirmLabel: string$/m, 'the visible question is required')
    assert.match(COMPONENT_CODE, /aria-label=\{label\}/)
    assert.match(COMPONENT_CODE, /<span className="nv-del-question">\{confirmLabel\}<\/span>/)
    assert.match(COMPONENT_CODE, /aria-expanded=\{armed\}/)
    assert.match(COMPONENT_CODE, /aria-controls=\{panelId\}/)
    assert.match(COMPONENT_CODE, /role="group"\s*\n?\s*aria-label=\{confirmLabel\}/)
    assert.match(COMPONENT_CODE, /aria-busy=\{pending \|\| undefined\}/)
    assert.match(COMPONENT_CODE, /role="status" aria-live="polite"/)
  })

  it('V · keyboard: Escape cancels, focus returns to the bin, the closed panel is inert (never a hidden tab stop)', () => {
    assert.match(COMPONENT_CODE, /window\.addEventListener\('keydown', handler\)/)
    assert.match(COMPONENT_CODE, /binRef\.current\?\.focus\(\)/)
    assert.match(COMPONENT_CODE, /inert=\{!armed && !pending\}/)
    // Leaving the control while armed disarms it.
    assert.match(COMPONENT_CODE, /if \(stateRef\.current === 'armed' && \(!next \|\| !rootRef\.current\?\.contains\(next\)\)\) dispatch\(\{ type: 'CANCEL' \}\)/)
    // Meaning never by colour alone: the two actions are named and iconed, the question is text.
    assert.match(COMPONENT_CODE, /aria-label=\{confirmName\}/)
    assert.match(COMPONENT_CODE, /aria-label=\{cancelName\}/)
  })

  it('V · both languages carry the control chrome and every site question', () => {
    for (const d of [dict.en, dict.es]) {
      for (const k of ['confirm', 'cancel', 'pending', 'done'] as const) assert.ok(d.fable.deleteButton[k].length > 0, k)
      assert.ok(d.sn.confirmDeleteInline.length > 0)
      assert.ok(d.sn.removeEntityConfirm.length > 0)
      assert.ok(d.watchlist.confirmRemove.length > 0)
      assert.ok(d.notifications.settings.confirmRemoveInline.length > 0)
      // The note question states permanence, as the former dialog did.
      assert.match(d.sn.confirmDeleteInline, /permanent|definitiv/i)
    }
    assert.notEqual(dict.en.sn.confirmDeleteInline, dict.es.sn.confirmDeleteInline)
    assert.match(COMPONENT_CODE, /t\.fable\.deleteButton\.confirm/)
    assert.match(COMPONENT_CODE, /t\.fable\.deleteButton\.cancel/)
  })

  it('V · token-only styling in the component (no hex, no raw scale, no inline colour)', () => {
    assert.doesNotMatch(COMPONENT_CODE, /#[0-9a-fA-F]{3,8}\b/)
    assert.doesNotMatch(COMPONENT_CODE, /\b(bg|text|border)-(gray|slate|zinc|red|blue|emerald)-\d{2,3}\b/)
    assert.doesNotMatch(COMPONENT_CODE, /style=\{\{/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// W–Y · DELETION SEMANTICS PRESERVED
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.2 § 6 — existing deletion semantics, authorization and routes are unchanged', () => {
  it('W · every DELETE route still carries the authorization it always had', () => {
    for (const [name, r] of Object.entries(ROUTES)) {
      const src = read(r.file)
      assert.match(src, /export async function DELETE/, `${name} route still exposes DELETE`)
      assert.match(src, r.guard, `${name} route still authorizes`)
    }
  })

  it('X · no site gained a new delete endpoint or a broader one — the same single request per site', () => {
    const detail = code(SITES['structured-notes detail'])
    const list = code(SITES['structured-notes list'])
    const watch = code(SITES.watchlist)
    const recip = code(SITES['notification recipients'])
    assert.match(detail, /fetch\(`\/api\/structured-notes\/\$\{id\}`, \{ method: 'DELETE' \}\)/)
    assert.equal((detail.match(/method: 'DELETE'/g) ?? []).length, 1)
    assert.match(list, /fetch\(`\/api\/structured-notes\/\$\{note\.id\}`, \{ method: 'DELETE' \}\)/)
    assert.equal((list.match(/method: 'DELETE'/g) ?? []).length, 1)
    assert.match(watch, /fetch\(`\/api\/watchlists\/\$\{watchlistId\}\/items\/\$\{encodeURIComponent\(ticker\)\}`, \{\s*method: 'DELETE',/)
    assert.equal((watch.match(/method: 'DELETE'/g) ?? []).length, 1)
    assert.match(recip, /fetch\(`\$\{ENDPOINT\}\/\$\{target\.id\}`, \{ method: 'DELETE' \}\)/)
    assert.equal((recip.match(/method: 'DELETE'/g) ?? []).length, 1)
    // Weekly notes: the panel owns no request at all — the caller's DELETE helper is unchanged.
    assert.ok(!/fetch\(/.test(code(SITES['weekly notes'])))
    assert.match(read('../src/lib/data/familyPortfolio.ts'), /\{ method: 'DELETE' \}/)
  })

  it('X · who may see a delete control is still the same capability flag', () => {
    const detail = code(SITES['structured-notes detail'])
    const list = code(SITES['structured-notes list'])
    // note-level delete: administrator capability from the API, on both surfaces
    assert.match(detail, /\{canManage && \(\s*<DeleteButton/)
    assert.match(list, /\{canManage && \(\s*<DeleteButton/)
    // custom-entity remove: only when the caller may manage
    assert.match(detail, /removable=\{extras\.includes\(name\) && !readOnly\}/)
    assert.match(code(SITES['weekly notes']), /\{canEdit && \(/)
    // recipients: the whole card already fails closed on 403 (forbidden state)
    assert.match(code(SITES['notification recipients']), /if \(res\.status === 403\)/)
  })

  it('Y · each control invokes the PRE-EXISTING handler, which still hits the network and removes nothing before the response', () => {
    const detail = code(SITES['structured-notes detail'])
    assert.match(detail, /onConfirm=\{deleteNote\}/)
    assert.match(detail, /if \(!res\.ok\) \{ setDeleteFailed\(true\); return false \}\s*router\.push\('\/structured-notes'\)\s*return true/)
    assert.match(detail, /onConfirm=\{onRemove\}/)
    assert.match(detail, /onRemove=\{\(\) => onSet\(name, 0\)\}/)

    const list = code(SITES['structured-notes list'])
    assert.match(list, /onConfirm=\{\(\) => confirmDeleteNote\(n\)\}/)
    const fn = list.slice(list.indexOf('async function confirmDeleteNote'), list.indexOf('async function handleFile'))
    assert.match(fn, /if \(!res\.ok\) \{ setDeleteFailed\(true\); return false \}\s*await load\(\)\s*return true/)

    const watch = code(SITES.watchlist)
    assert.match(watch, /onConfirm=\{\(\) => handleRemove\(item\.ticker\)\}/)
    assert.ok(watch.indexOf('if (!res.ok)') < watch.indexOf('onRemoved(ticker)'), 'the row leaves only after a confirmed response')

    const recip = code(SITES['notification recipients'])
    assert.match(recip, /onConfirm=\{\(\) => confirmRemove\(r\)\}/)
    const rm = recip.slice(recip.indexOf('async function confirmRemove'))
    assert.ok(rm.indexOf("throw new Error('delete_failed')") < rm.indexOf('prev.filter((x) => x.id !== target.id)'))
    assert.match(rm, /if \(pendingIds\.includes\(target\.id\)\) return false/)

    const weekly = code(SITES['weekly notes'])
    assert.match(weekly, /onConfirm=\{\(\) => confirmDelete\(note\.id\)\}/)
    assert.match(weekly, /const outcome = await onDelete\(id\)\s*if \(outcome === 'deleted'\) return true/)
  })

  it('Y · no handler was replaced by a client-only state mutation — every site still awaits the server', () => {
    for (const [name, src] of Object.entries(SITES)) {
      const c = code(src)
      const hasAwait = /await (fetch\(|onDelete\(|load\(\))/.test(c)
      assert.ok(hasAwait, `${name} must await a server round-trip in its delete path`)
    }
  })

  it('the confirmation dialog primitive itself is untouched for the surfaces that still need it', () => {
    const modal = read('../src/components/fable/ModalShell.tsx')
    assert.match(modal, /export function DestructiveConfirm\(/)
    assert.match(modal, /if \(pending \|\| firedRef\.current\) return/)
  })
})
