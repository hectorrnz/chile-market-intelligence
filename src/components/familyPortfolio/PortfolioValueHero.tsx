'use client'

// Owner design review § 1 — the page's single focal figure: the latest TOTAL
// portfolio value, rendered at the Fable KPI-hero scale (`ui-kpi-hero`,
// clamp 30-40px / 650) so no other figure on the Summary competes with it.
// What the number IS is stated in words — the figure's name as a section label
// above it, the basis and the as-of date beneath it — never left to inference.
//
// Purely presentational: the caller supplies the value, the mask state, and
// every visible string from the dictionary (aumLabel / aumBasis) plus the
// publication's own already-formatted column date. This component decides and
// formats nothing — the amount renders through MaskedAmount, the one guarded
// render path for portfolio amounts (privacy, unavailable-as-em-dash),
// exactly like every other figure on the page.
//
// The basis line is OPTIONAL because it is only ever a true statement for the
// scope that has a Chilean-equities split; a personal scope passes null and
// shows the value and its date without borrowing a Main basis name.

import { MaskedAmount } from './MaskedAmount'

export interface PortfolioValueHeroProps {
  value: number | null
  masked: boolean
  /** e.g. o.aumLabel — "Portfolio Value". */
  label: string
  /** e.g. o.aumBasis — "Including Chilean equities" — or null when untrue for the scope. */
  basis: string | null
  /** The publication's own as-of date, already formatted by the page. */
  dateLabel: string | null
}

export function PortfolioValueHero({ value, masked, label, basis, dateLabel }: PortfolioValueHeroProps) {
  return (
    // R13.R2F § 1 — READ AS A REPORT MASTHEAD, NOT A FLOATING NUMBER.
    // The name of the figure sits ABOVE it as a section label, in the same
    // `ui-label` idiom every other region on this page uses for its own
    // heading, and the qualifiers (basis, as-of date) sit below. The reader
    // therefore meets the figure already knowing what it is, and the page's
    // three hierarchy levels — section label · value · qualifier — are the
    // SAME three everywhere, which is what makes the page read as one document
    // rather than a stack of unrelated cards.
    <section className="flex flex-col min-w-0">
      <h2 className="ui-label text-muted-fg">{label}</h2>
      <MaskedAmount
        value={value}
        masked={masked}
        className="ui-number ui-kpi-hero text-foreground mt-1.5"
      />
      {(basis || dateLabel) && (
        <p className="ui-meta text-muted-fg flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mt-1.5">
          {basis && <span>{basis}</span>}
          {basis && dateLabel && <span aria-hidden="true">·</span>}
          {dateLabel && <span className="ui-number">{dateLabel}</span>}
        </p>
      )}
    </section>
  )
}
