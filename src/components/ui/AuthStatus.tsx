'use client'

// Phase 6A/6B — TopBar auth widget.
// Shows the signed-in user's display name + sign-out link, or a "Sign in"
// link when no session is present.

import Link from 'next/link'
import { useAuthDisplay } from '@/lib/auth/useAuthDisplay'
import { useLang } from '@/components/providers/LangProvider'

export function AuthStatus() {
  const { t } = useLang()
  const { name, email, ready } = useAuthDisplay()

  // Don't render until we know the session state (avoids hydration flash).
  if (!ready) return null

  const label = name ?? email
  if (!label) {
    return (
      <Link
        href="/login"
        className="text-xs text-muted-fg hover:text-foreground transition-colors"
      >
        {t.auth.signIn}
      </Link>
    )
  }

  const display = label.length > 22 ? label.slice(0, 20) + '…' : label

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-fg" title={email ?? label}>{display}</span>
      <Link
        href="/logout"
        className="text-muted-fg hover:text-negative transition-colors"
        title={t.auth.signOut}
      >
        ↱
      </Link>
    </div>
  )
}
