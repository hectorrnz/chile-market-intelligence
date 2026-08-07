'use client'

// R13.6 — `/family-portfolio/alternatives`.
//
// STAGE BOUNDARY, DELIBERATE. The route exists so the Stage-6 module
// navigation resolves, but the shared Alternatives experience is Stage 9
// (doc 08; product contract in doc 07 § 7.4). Until that stage lands, this
// renders the documented honest "not yet available" state — never an early
// partial summary, timeline, or sample figure.

import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'

export default function FamilyPortfolioAlternativesPage() {
  const { t } = useLang()
  return (
    <div className="w-full">
      <PageHeader eyebrow={t.fp.tag} title={t.fp.alternativesPendingTitle} />
      <MemberGate>
        <AsyncState kind="unavailable" message={t.fp.alternativesPending} />
      </MemberGate>
    </div>
  )
}
