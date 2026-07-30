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
 * R1 scope: `/login` only. `/forgot-password` and `/auth/reset-password`
 * join this set in R2, when they migrate into the `(auth)` group — do not
 * add them earlier, or they would render bare with neither chrome.
 */
const BARE_ROUTES = new Set(['/login'])

export function ShellGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (BARE_ROUTES.has(pathname)) return <>{children}</>
  return <AppShell>{children}</AppShell>
}
