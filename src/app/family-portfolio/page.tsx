'use client'

// R13.6 — `/family-portfolio` (Overview).
//
// STAGE BOUNDARY, DELIBERATE. The module shell and navigation are Stage 6;
// the generated Overview COMPOSITION is Stage 7 (doc 08). This page therefore
// renders the documented honest "not yet available" state — never a sample
// hero, a placeholder figure, or an early partial implementation of the
// Stage-7 contract.

import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'

export default function FamilyPortfolioOverviewPage() {
  const { t } = useLang()
  return (
    <div className="w-full">
      <PageHeader eyebrow={t.fp.tag} title={t.fp.overviewPendingTitle} />
      <MemberGate>
        <AsyncState kind="unavailable" message={t.fp.overviewPending} />
      </MemberGate>
    </div>
  )
}
