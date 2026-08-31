'use client'

// R13.R4A — the Alternatives sub-module shell.
//
// Alternatives is now THREE routes over ONE publication — `Dashboard`,
// `Holdings`, `Cash Flows` — so everything the three share lives here exactly
// once: the single fetch (`AlternativesProvider`), the page header with the
// module's OWN as-of stamp and the privacy toggle, the sub-navigation rail, and
// every honest pre-content state.
//
// RESOLVING THE STATES ONCE IS THE POINT. Loading, unverifiable, denied,
// no-publication and empty are answered here, and `children` render only when
// there is a published book to show. Three pages each re-implementing five
// states is three chances for them to drift; this way a sub-page's body can
// assume `state === 'ok'` and hold nothing but its own view.
//
// The as-of is the ALTERNATIVES publication's own (doc 03 § 1) — never the
// portfolio's. The two datasets publish on independent lifecycles and being out
// of step is normal, so this surface states its own date and no other.

import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { PrivacyToggle } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { EmptyState } from '@/components/ui/EmptyState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'
import {
  AlternativesProvider,
  useAlternatives,
} from '@/components/familyPortfolio/AlternativesProvider'
import { AlternativesSubnav } from '@/components/familyPortfolio/AlternativesSubnav'
import { formatIsoDateLabel } from '@/lib/formatters'
import type { ReactNode } from 'react'

function AlternativesShell({ children }: { children: ReactNode }) {
  const { t } = useLang()
  const a = t.fp.alternatives
  const [masked, setMasked] = usePrivacyMode()
  const { outcome, data } = useAlternatives()

  const asOfDate = data?.publication?.asOfDate ?? null
  const ready = outcome === 'ready' && data?.state === 'ok'

  return (
    <div className="w-full">
      {/* R13.R4A.3 — THE HEADER SAYS THE MODULE'S NAME ONCE.
          It used to say it three times on one entry: the module rail's active
          pill reads `Alternatives`, the eyebrow read `Portfolio` directly under
          that same rail, and the as-of label read `Alternatives as of` beside a
          title already reading `Alternatives`. What a reader needs from this
          row is which book this is and how current it is, so that is all it
          carries now — the title, and the publication's own as-of date at full
          contrast because the date is the fact, not the label in front of it.
          The date itself is unchanged: still this module's own `asOfDate`
          (doc 03 § 1), never the portfolio's, and every card below still
          carries its own `TableSourceFooter` with the publication timestamp —
          a different field answering a different question. */}
      <PageHeader
        title={a.title}
        metadata={
          asOfDate !== null ? (
            <span className="whitespace-nowrap">
              {a.asOfLabel}{' '}
              <span className="ui-number font-semibold text-foreground">
                {formatIsoDateLabel(asOfDate)}
              </span>
            </span>
          ) : undefined
        }
        actions={<PrivacyToggle masked={masked} onToggle={() => setMasked((prev) => !prev)} />}
      />

      <MemberGate>
        {/* The rail stays mounted through every sub-page, so its measured
            indicator never re-animates from zero on a tab change. mb-5 matches
            the header's own bottom margin and the pages' gap-5 section rhythm,
            so the rail sits in the same vertical beat as everything below it. */}
        <div className="mb-5 flex">
          <AlternativesSubnav />
        </div>

        {outcome === 'loading' && <AsyncState kind="loading" />}
        {outcome === 'error' && <AsyncState kind="error" message={t.fp.accessError} />}
        {outcome === 'denied' && <EmptyState message={t.fp.noAccess} />}
        {outcome === 'ready' && data?.state === 'no_publication' && (
          <AsyncState kind="empty" message={a.noPublication} />
        )}
        {outcome === 'ready' && data?.state === 'empty' && (
          <AsyncState kind="empty" message={a.empty} />
        )}

        {ready && children}
      </MemberGate>
    </div>
  )
}

export default function AlternativesLayout({ children }: { children: ReactNode }) {
  return (
    <AlternativesProvider>
      <AlternativesShell>{children}</AlternativesShell>
    </AlternativesProvider>
  )
}
