import { LangProvider } from '@/components/providers/LangProvider'
import { AuthShell } from '@/components/fable/AuthShell'

/**
 * R1 — the (auth) route group. Routes in this group render OUTSIDE the app
 * chrome (ShellGate steps aside for them), so this layout supplies what they
 * still need: the language context and the full-bleed Fable auth shell.
 * No market/macro providers, no TopBar, no CommandPalette — an auth gateway
 * fetches nothing.
 *
 * Members (R2 complete): /login, /forgot-password, /auth/reset-password. Each
 * is also listed in ShellGate's BARE_ROUTES — the two sets must stay identical.
 *
 * /auth/reset-password sits at `(auth)/auth/reset-password` so its public URL
 * is unchanged while it gains this layout. That is a different URL from
 * `/auth/callback` (a route handler under `app/auth/`, unaffected by layouts),
 * so the two coexist without a route conflict.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <AuthShell>{children}</AuthShell>
    </LangProvider>
  )
}
