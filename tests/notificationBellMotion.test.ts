// R13.7 UI follow-up — notification bell motion (Rare UI reference, NMI tokens).
//
// Presentation only. These assertions pin three things: the swing is a
// ONE-SHOT state driven by a rise in the unread count (never a loop); the
// unread badge and its count survive unchanged; and every piece of the motion
// has a reduced-motion path. Nothing here touches notification logic.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const BELL = read('src/components/ui/NotificationBell.tsx')
const CSS = read('src/app/globals.css')
const reducedMotionBlock = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))

describe('NotificationBell — swing state', () => {
  it('rings once, only when the unread count RISES between polls, never on first load', () => {
    assert.match(BELL, /const prev = prevCountRef\.current/)
    assert.match(BELL, /if \(prev !== null && next > prev && !prefersReducedMotion\(\)\) setRing\(true\)/)
  })
  it('the ring is cleared on animationend, so data-ring is never a standing state', () => {
    assert.match(BELL, /data-ring=\{ring \? 'true' : undefined\}/)
    assert.match(BELL, /onAnimationEnd=\{\(\) => setRing\(false\)\}/)
  })
  it('the swing keyframe runs exactly once — no infinite loop anywhere in the bell CSS', () => {
    assert.match(CSS, /\.nv-bell\[data-ring='true'\] \.nv-bell-icon \{\s*animation: nvBellSwing var\(--dur-nav\) var\(--ease-out-cubic\) 1;/)
    const bellCss = CSS.slice(CSS.indexOf('.nv-bell-icon {'), CSS.indexOf('/* Sliding pill indicator'))
    assert.doesNotMatch(bellCss, /infinite/)
    assert.match(CSS, /@keyframes nvBellSwing/)
  })
  it('the bell is hinged at its crown and uses only transform/opacity', () => {
    assert.match(CSS, /\.nv-bell-icon \{\s*transform-box: fill-box;\s*transform-origin: 50% 8%;/)
    const kf = CSS.slice(CSS.indexOf('@keyframes nvBellSwing'), CSS.indexOf('@keyframes nvBellCountIn'))
    assert.doesNotMatch(kf, /width|height|margin|padding|left|top|filter|box-shadow/)
  })
  it('uses NMI motion tokens, no hardcoded durations or easings', () => {
    const bellCss = CSS.slice(CSS.indexOf('.nv-bell-icon {'), CSS.indexOf('/* Sliding pill indicator'))
    assert.doesNotMatch(bellCss, /\d+ms|cubic-bezier|#[0-9a-fA-F]{3,6}/)
  })
})

describe('NotificationBell — unread badge preserved', () => {
  it('still shows the critical-fill badge with the real count, capped at 99+', () => {
    assert.match(BELL, /backgroundColor: 'var\(--critical-fill\)', color: 'var\(--critical-fill-fg\)'/)
    assert.match(BELL, /return n > 99 \? '99\+' : String\(n\)/)
    assert.match(BELL, /const badgeShown = unreadCount > 0 \|\| badgeLeaving/)
  })
  it('the count rolls by remounting on value change, and the leaving badge keeps its last value', () => {
    assert.match(BELL, /<span key=\{shownCount\} className="nv-bell-count">\{badgeLabel\(shownCount\)\}<\/span>/)
    assert.match(BELL, /if \(unreadCount > 0 && shownCount !== unreadCount\) setShownCount\(unreadCount\)/)
  })
  it('the badge cannot get stuck mounted at zero: animationend AND a timeout fallback both unmount it', () => {
    assert.match(BELL, /if \(e\.animationName === 'nvBellBadgeOut'\) setBadgeLeaving\(false\)/)
    assert.match(BELL, /setTimeout\(\(\) => setBadgeLeaving\(false\), BADGE_LEAVE_FALLBACK_MS\)/)
  })
  it('no notification semantics changed: polling, auth gate, mark-read APIs untouched', () => {
    assert.match(BELL, /POLL_MS = 60_000/)
    assert.match(BELL, /if \(!signedIn\) return null/)
    assert.match(BELL, /fetch\('\/api\/notifications', \{ cache: 'no-store' \}\)/)
    assert.match(BELL, /\/api\/notifications\/\$\{id\}\/read/)
    assert.match(BELL, /\/api\/notifications\/read-all/)
    assert.doesNotMatch(BELL, /framer-motion|from 'motion/)
  })
  it('keyboard/focus contract intact: aria-label, aria-expanded, focus restore', () => {
    assert.match(BELL, /aria-label=\{t\.notifications\.bellLabel\}/)
    assert.match(BELL, /aria-expanded=\{open\}/)
    assert.match(BELL, /triggerRef\.current\?\.focus\(\)/)
    assert.match(BELL, /className="nv-bell-icon w-5 h-5"[\s\S]*?aria-hidden="true"/)
  })
})

describe('NotificationBell — reduced motion', () => {
  it('the CSS removes swing, badge pop/shrink and count roll outright and renders the final state', () => {
    assert.match(reducedMotionBlock, /\.nv-bell-icon, \.nv-bell-badge, \.nv-bell-count \{\s*animation: none !important;\s*transform: none !important;\s*opacity: 1 !important;/)
  })
  it('the component reads the preference too, so it never waits on an animation that will not run', () => {
    assert.match(BELL, /window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches/)
    assert.match(BELL, /if \(lastPositiveRef\.current > 0 && !prefersReducedMotion\(\)\)/)
  })
})
