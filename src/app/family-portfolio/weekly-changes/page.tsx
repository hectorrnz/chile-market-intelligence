'use client'

// R13.6 — `/family-portfolio/weekly-changes`.
//
// STAGE BOUNDARY, DELIBERATE. The route exists so the Stage-6 module
// navigation resolves, but the Weekly Changes experience itself is Stage 8
// (doc 08; full binding contract in doc 07 Parts A2/A3). Until that stage
// lands, this renders the documented honest "not yet available" state —
// never an early partial implementation of the Stage-8 visualizations and
// never a sample figure.

import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'

export default function FamilyPortfolioWeeklyChangesPage() {
  const { t } = useLang()
  return (
    <div className="w-full">
      <PageHeader eyebrow={t.fp.tag} title={t.fp.weeklyChangesPendingTitle} />
      <MemberGate>
        <AsyncState kind="unavailable" message={t.fp.weeklyChangesPending} />
      </MemberGate>
    </div>
  )
}
