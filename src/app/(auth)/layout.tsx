import { LangProvider } from '@/components/providers/LangProvider'
import { AuthShell } from '@/components/fable/AuthShell'

/**
 * R1 — the (auth) route group. Routes in this group render OUTSIDE the app
 * chrome (ShellGate steps aside for them), so this layout supplies what they
 * still need: the language context and the full-bleed Fable auth shell.
 * No market/macro providers, no TopBar, no CommandPalette — an auth gateway
 * fetches nothing.
 *
 * R1 members: /login. R2 adds /forgot-password and /auth/reset-password
 * (each must be added to ShellGate's BARE_ROUTES in the same change).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <AuthShell>{children}</AuthShell>
    </LangProvider>
  )
}
