'use client'

// Phase 6B — Client hook exposing the signed-in user's display name.
// Reads the session from the browser Supabase client (cookies set by the
// server on sign-in) via onAuthStateChange. No network call.

import { useState, useEffect } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

export function useAuthDisplay(): { name: string | null; email: string | null; ready: boolean } {
  const [name, setName]   = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const db = getSupabaseBrowserClient()
    if (!db) {
      void Promise.resolve().then(() => setReady(true))
      return
    }
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      const u = session?.user
      const meta = (u?.user_metadata ?? {}) as { display_name?: string; username?: string }
      setName(meta.display_name ?? meta.username ?? null)
      setEmail(u?.email ?? null)
      setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  return { name, email, ready }
}
