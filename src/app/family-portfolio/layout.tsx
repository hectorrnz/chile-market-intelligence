'use client'

// R13.6 — Family Portfolio module shell (doc 08 Stage 6).
//
// One provider (a single scopes fetch per module entry) and the module
// navigation, wrapped around every `/family-portfolio/*` page — including the
// Stage-5 administrator console, which doc 05 § 7.2 places behind the `Admin`
// item of this same rail. Pages own their own headers, states and content;
// this shell owns only who-sees-which-navigation, and even that is a
// presentation convenience over the server-filtered scopes response — every
// route and endpoint behind an item re-authorizes server-side.

import type { ReactNode } from 'react'
import { FamilyPortfolioProvider } from '@/components/familyPortfolio/FamilyPortfolioProvider'
import { FamilyPortfolioNav } from '@/components/familyPortfolio/FamilyPortfolioNav'

export default function FamilyPortfolioLayout({ children }: { children: ReactNode }) {
  return (
    <FamilyPortfolioProvider>
      <div className="w-full">
        <FamilyPortfolioNav />
        {children}
      </div>
    </FamilyPortfolioProvider>
  )
}
