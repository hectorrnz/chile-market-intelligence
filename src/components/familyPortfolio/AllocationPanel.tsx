'use client'

// R13.R2 §§ 13-15 — the Asset Allocation panel: the donut as centrepiece,
// the basis selector in the header, and (for an administrator only) the small
// ⚙ trigger for the global presentation settings.
//
// FRAMELESS by design (second pass): the Summary composes this INSIDE a
// shared analytical row — Main's Snapshot | Allocation | Notes (3 : 5 : 4,
// Allocation the widest of the three) or, since R13.R2F3, a personal scope's
// Performance | Snapshot | Allocation (4 : 3 : 5, Allocation still the
// widest) — so this renders a plain `<section>` whose internal rhythm
// (px-5 padding, ui-label header, inset hairline above the disclosure footer)
// mirrors its neighbours line for line, making the row's columns read as one
// coordinated surface. It is used nowhere else. `mt-auto` on the footer pins
// the provenance to the shared card's bottom edge, so the columns close
// together whichever is tallest.
//
// The gear exists only when the caller passes `onOpenSettings` — a
// non-administrator gets NO disabled ghost control (an affordance that can
// never work is a lie); instead the caller passes `readOnlyNote`, one quiet
// line explaining who configures the presentation. Both never render at
// once: the note only appears when the trigger is absent. The trigger itself
// is the SHARED SettingsGearButton (owner review § 7) — the same conventional
// cog the Portfolio Evolution header uses, so the affordance reads
// identically across both modules.

import type { ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import type { AllocationPresentationSettings } from '@/lib/familyPortfolio/allocationSettings'
import { AllocationDonut, type DonutEntry } from './AllocationDonut'
import { SettingsGearButton } from './SettingsGearButton'

export interface AllocationPanelProps {
  title: string
  entries: DonutEntry[]
  settings: AllocationPresentationSettings
  masked: boolean
  summary: string
  /** The basis selector, already built by the page. Rendered in the header. */
  basisControl?: ReactNode
  /** The ⚙ trigger. Absent for a non-administrator — do not render a disabled one. */
  onOpenSettings?: () => void
  /** Shown to a non-administrator so the absence of the control is explained. */
  readOnlyNote?: string
  footer?: ReactNode
  /**
   * R13.R2F2 — 'compact' (default) is the original centred donut-and-legend
   * pair, used by Main's 3:5:4 row. 'wide' forwards straight to
   * `AllocationDonut`, which anchors the ring left and lets the legend fill
   * the column's freed width instead of sitting centred within it.
   *
   * R13.R2F3 briefly dropped 'wide' from every caller: a personal scope's new
   * 4:3:5 row gave Allocation the same 5fr share Main already uses, and
   * 'compact' seemed to fit both equally well centred.
   *
   * R13.R2F4 (owner report) — a personal scope's Allocation column is the
   * ROW'S LAST column, with nothing after it, so a centred pair there read as
   * dead space on both sides rather than sitting beside a neighbour the way
   * Main's centred pair does beside its Notes column. `family-portfolio/page.tsx`
   * now passes 'wide' for a personal scope and 'compact' for Main, gated on
   * the same `showNotes` flag that already splits the two rows.
   */
  layout?: 'compact' | 'wide'
}

export function AllocationPanel({
  title,
  entries,
  settings,
  masked,
  summary,
  basisControl,
  onOpenSettings,
  readOnlyNote,
  footer,
  layout = 'compact',
}: AllocationPanelProps) {
  const { t } = useLang()
  const o = t.fp.overview

  return (
    <section className="flex flex-col h-full min-w-0">
      {/* Title left, controls right, on ONE baseline — the same header row the
          snapshot and the notes carry, so the three columns of the analytical
          surface start on the same line rather than each finding its own. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 sm:px-6 pt-4 pb-1">
        <h2 className="ui-label text-muted-fg">{title}</h2>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap min-w-0 max-w-full">
          {/* The basis rail's labels are long; it scrolls inside its own
              wrapper on narrow viewports (the FamilyPortfolioNav precedent)
              rather than ever widening the page. */}
          {basisControl && (
            <div className="max-w-full overflow-x-auto nv-scrollbar-hidden">{basisControl}</div>
          )}
          {onOpenSettings && <SettingsGearButton onClick={onOpenSettings} label={o.settingsOpen} />}
        </div>
      </div>

      {/* The donut is the centrepiece at a MEANINGFUL size (owner review
          pass 2B § 1 — the pass-2 shrink is explicitly reversed; R13.R2F § 8
          enlarges it again): the ring is larger than the R13.R2 original and
          the legend stays held close beside it, so the pair reads as one
          figure that actually uses the widest column of the analytical row
          rather than floating in it. */}
      <div className="flex-1 flex items-center justify-center px-5 sm:px-6 py-4">
        <AllocationDonut
          entries={entries}
          summary={summary}
          settings={settings}
          masked={masked}
          size={208}
          layout={layout}
        />
      </div>

      {(footer || (!onOpenSettings && readOnlyNote)) && (
        <div
          className="mt-auto mx-5 sm:mx-6 mb-4 flex flex-col gap-y-1 pt-2.5"
          // Inset hairline — the same ledger rhythm as the snapshot rows
          // across the divider, so the two columns close in step.
          style={{ borderTop: '1px solid var(--nv-line)' }}
        >
          {!onOpenSettings && readOnlyNote && <p className="ui-meta text-muted-fg">{readOnlyNote}</p>}
          {footer}
        </div>
      )}
    </section>
  )
}
