'use client'

// Phase 6A — TopBar auth widget.
// Shows the signed-in user's email (truncated) + sign-out link,
// or a "Sign in" link when no session is present.
// Uses the browser Supabase client to check session client-side.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { useLang } from '@/components/providers/LangProvider'

export function AuthStatus() {
  const { t } = useLang()
  const [email, setEmail] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const db = getSupabaseBrowserClient()

    // When Supabase is not configured, onAuthStateChange is unavailable.
    // Mark ready via a resolved-promise microtask to stay off the sync-setState path.
    if (!db) {
      void Promise.resolve().then(() => setReady(true))
      return
    }

    // onAuthStateChange fires an INITIAL_SESSION event on mount so we get
    // the current session without a separate getUser() call.
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null)
      setReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Don't render anything until we know the session state (avoids hydration flash)
  if (!ready) return null

  if (!email) {
    return (
      <Link
        href="/login"
        className="text-xs text-muted-fg hover:text-foreground transition-colors"
      >
        {t.auth.signIn}
      </Link>
    )
  }

  const display = email.length > 22 ? email.slice(0, 20) + '…' : email

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-fg font-mono" title={email}>{display}</span>
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
