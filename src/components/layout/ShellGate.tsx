'use client'

import { usePathname } from 'next/navigation'
import { AppShell } from './AppShell'

/**
 * Shell suppression (Stage 5R phase R1; anticipated by doc 04 Phase 6).
 *
 * The cinematic auth gateway renders WITHOUT the app chrome, but a route
 * group's layout alone cannot remove chrome mounted by the root layout — the
 * root layout wraps every segment. So the root layout mounts this gate in
 * place of a bare `<AppShell>`: for the routes the `(auth)` group owns, the
 * gate steps aside and the group's own layout supplies the full-bleed auth
 * shell; every other route keeps the exact same AppShell chrome as before.
 *
 * R2 completed the set: all three public authentication routes now live in the
 * `(auth)` group and render the gateway instead of the app chrome. Membership
 * here and membership of the group must always match — a path listed here but
 * outside the group would render bare with neither shell, and a path in the
 * group but missing here would render the gateway inside the app chrome.
 *
 * `/auth/callback` is absent on purpose: it is a route handler, not a page, so
 * no layout or shell applies to it.
 */
const BARE_ROUTES = new Set(['/login', '/forgot-password', '/auth/reset-password'])

export function ShellGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (BARE_ROUTES.has(pathname)) return <>{children}</>
  return <AppShell>{children}</AppShell>
}
