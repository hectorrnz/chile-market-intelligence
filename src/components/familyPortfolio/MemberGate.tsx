'use client'

// R13.6 — shared gate for the Family Portfolio MEMBER pages.
//
// Renders the honest pre-content states once, so the four member surfaces
// cannot drift apart on them: resolving (loading), unverifiable (error),
// zero-scope (an approved account with no Family Portfolio entitlement —
// fails closed with a plain explanation, doc 05 § 2.3), then the page.
//
// Presentation only. The middleware already required an approved session to
// reach any of these routes, and every data endpoint behind the page
// re-authorizes server-side.

import type { ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { AsyncState } from '@/components/fable/AsyncState'
import { EmptyState } from '@/components/ui/EmptyState'
import { useFamilyPortfolio } from './FamilyPortfolioProvider'

export function MemberGate({ children }: { children: ReactNode }) {
  const { t } = useLang()
  const { status, scopes } = useFamilyPortfolio()

  if (status === 'loading') return <AsyncState kind="loading" />
  if (status === 'error') return <AsyncState kind="error" message={t.fp.accessError} />
  if (status === 'denied' || scopes.length === 0) {
    return <EmptyState message={t.fp.noAccess} />
  }
  return <>{children}</>
}
