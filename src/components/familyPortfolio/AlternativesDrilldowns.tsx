'use client'

// R13.R4A.1 — the two Alternatives drill-downs: what a period's flow was made
// of, and which commitments are not yet drawn.
//
// BOTH ANSWER THE SAME QUESTION ABOUT A DIFFERENT FIGURE — "where does this
// number come from?" — so they share one interaction language: a real dialog
// on the shared `ModalShell` (labelled, focus-trapped, Escape- and
// scrim-dismissable, focus restored), never a hover-only tooltip. A hover
// cannot be reached on a touch device and cannot hold a scrollable list, and
// both of these carry a table.
//
// EVERY ROW IS A SOURCE ROW. The period breakdown lists the workbook's own
// events, resolved to their holding by `periodBreakdown`; the undrawn list is
// the workbook's own `Unfunded` column, read verbatim by `undrawnCommitments`.
// Neither component sums, classifies, derives or orders anything — the pure
// module does all of it, which is what keeps a drill-down from ever disagreeing
// with the card it was opened from.
//
// FULL AMOUNTS HERE, DELIBERATELY. The chart tooltip is compact (`-2M`) because
// it is read for magnitude at a glance; a drill-down is read for the figure, so
// every amount renders at full grouped length. Both still go through
// `MaskedAmount`, so the privacy mask governs the dialog exactly as it governs
// the page behind it.
//
// PER-CURRENCY, LIKE EVERYTHING ELSE. Each dialog is opened from one currency's
// card and shows only that currency; no total in either one crosses a
// denomination.
//
// R13.R4A.3 — THE UNDRAWN DIALOG LEADS WITH WHAT IT COULD NOT ASSESS. The
// holdings the source reports no unfunded figure for come first — before the
// partition's other two categories in the summary strip, and before the list of
// undrawn commitments in the body — because they bound how complete that list
// is. Read afterwards they were a footnote to a finding; read first they are a
// condition on it. The dialog also now states both bases with their own figures
// in the sentence ("calculated from 34 of 38 … 6 do not report"), which is the
// arithmetic a reader was otherwise left to reconstruct.

import { useLang } from '@/components/providers/LangProvider'
import { ModalShell } from '@/components/fable/ModalShell'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { EventTypeTag } from '@/components/familyPortfolio/AlternativesEventChrome'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import {
  currencyLabel,
  type CommitmentDrawn,
  type PeriodBreakdown,
  type UndrawnCommitment,
} from '@/lib/familyPortfolio/alternativesView'
import { formatCount, formatIsoDateLabel } from '@/lib/formatters'

const TH = 'py-2 px-2 first:pl-0 last:pr-0 ui-table-header text-muted-fg'
const CELL = 'py-1.5 px-2 first:pl-0 last:pr-0'

/** `YYYY-MM` → `MM-YYYY`; a bare `YYYY` stays itself. Never `new Date()`. */
function periodTitle(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  return m ? `${m[2]}-${m[1]}` : period
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// ---------------------------------------------------------------------------
// A period's movements — opened by clicking a column of the cash-flow chart
// ---------------------------------------------------------------------------

export function PeriodBreakdownModal({
  open,
  onClose,
  breakdown,
  masked,
  asOf,
}: {
  open: boolean
  onClose: () => void
  breakdown: PeriodBreakdown | null
  masked: boolean
  asOf: string | null
}) {
  const { t } = useLang()
  const a = t.fp.alternatives
  if (breakdown === null) return null
  const code = currencyLabel(breakdown.currency)

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="lg"
      dense
      title={`${a.breakdownTitle} · ${periodTitle(breakdown.period)} · ${code}`}
      description={fill(a.breakdownCount, { n: breakdown.events.length })}
    >
      {breakdown.events.length === 0 ? (
        <p className="text-xs text-muted-fg py-6 text-center">{a.breakdownEmpty}</p>
      ) : (
        <>
          {/* The period's own subtotals — the very figures the clicked column
              drew, from the same pure function the card and ledger use. */}
          <dl className="flex flex-wrap gap-x-6 gap-y-1.5 pb-3 mb-3 border-b border-border">
            <div className="flex items-baseline gap-2">
              <dt className="ui-meta text-muted-fg">{a.kpiCalls}</dt>
              <dd className="ui-number text-sm text-foreground">
                {/* R13.R5C.1 § 2.2 — cash FLOWS. A period with no call (or no
                    distribution) reads as the module's `-` for "nothing here",
                    not as a `0` competing with the figures beside it. The
                    commitment BALANCES further down keep their real zeros:
                    committed / contributed / unfunded are a visible identity. */}
                <MaskedAmount value={breakdown.calls.amount} masked={masked} signed />
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="ui-meta text-muted-fg">{a.kpiDistributions}</dt>
              <dd className="ui-number text-sm text-foreground">
                <MaskedAmount value={breakdown.distributions.amount} masked={masked} signed />
              </dd>
            </div>
            {breakdown.unclassified.count > 0 && (
              <div className="flex items-baseline gap-2">
                <dt className="ui-meta text-warning">{a.kpiUnclassifiedAmount}</dt>
                <dd className="ui-number text-sm text-foreground">
                  <MaskedAmount value={breakdown.unclassified.amount} masked={masked} signed />
                </dd>
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <dt className="ui-meta text-foreground">{a.kpiNetFlow}</dt>
              <dd className="ui-number text-sm font-semibold text-foreground">
                <MaskedAmount value={breakdown.net} masked={masked} signed />
              </dd>
            </div>
          </dl>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="border-b border-border-strong">
                  <th className={`${TH} text-left`} scope="col">{a.colDate}</th>
                  <th className={`${TH} text-left`} scope="col">{a.colEvent}</th>
                  <th className={`${TH} text-left`} scope="col">{a.colInvestment}</th>
                  <th className={`${TH} text-left`} scope="col">{a.colSociedad}</th>
                  <th className={`${TH} text-right`} scope="col">{a.colAmount}</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.events.map((e, i) => (
                  <tr
                    key={`${e.eventDate}-${e.investmentName ?? 'unknown'}-${i}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className={`${CELL} text-left ui-number whitespace-nowrap text-muted-fg`}>
                      {formatIsoDateLabel(e.eventDate)}
                    </td>
                    <td className={`${CELL} text-left whitespace-nowrap`}>
                      <EventTypeTag eventType={e.eventType} t={a} />
                    </td>
                    <td className={`${CELL} text-left`}>
                      <span className="block truncate max-w-[20rem]" title={e.investmentName ?? undefined}>
                        {e.investmentName ?? a.unknownInvestment}
                      </span>
                    </td>
                    <td className={`${CELL} text-left whitespace-nowrap text-muted-fg`}>
                      {e.sociedad ?? '—'}
                    </td>
                    <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                      <MaskedAmount value={e.amount} masked={masked} signed />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="nv-notes mt-3">
            <TableSourceFooter source={a.source} asOf={asOf} />
            <p className="ui-meta text-muted-fg">{a.signNote}</p>
          </div>
        </>
      )}
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Undrawn commitments — opened from the commitment-drawn figure
// ---------------------------------------------------------------------------

export function UndrawnCommitmentsModal({
  open,
  onClose,
  undrawn,
  drawn,
  masked,
  asOf,
}: {
  open: boolean
  onClose: () => void
  undrawn: UndrawnCommitment | null
  /**
   * The ratio the card this dialog was opened from is showing. Present so the
   * dialog can state BOTH bases with their own figures in them (R13.R4A.3) —
   * it is read, never recomputed, and the dialog renders that sentence only
   * when the ratio exists.
   */
  drawn: CommitmentDrawn | null
  masked: boolean
  asOf: string | null
}) {
  const { t } = useLang()
  const a = t.fp.alternatives
  if (undrawn === null) return null
  const code = currencyLabel(undrawn.currency)

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="lg"
      dense
      title={`${a.undrawnTitle} · ${code}`}
      description={fill(a.undrawnCount, { n: undrawn.holdings.length, total: undrawn.ofHoldings })}
    >
      {/* ── The partition, stated so it can be CHECKED ────────────────────
          R13.R4A.2. Three categories keyed on the source's own Unfunded
          column, each labelled for what it counts, adding to the currency's
          holdings on the line beneath. Printed rather than implied because the
          figure this dialog is opened from was itself read as a category count
          when it is a calculation-basis count — the fix for that is to make
          every count on the surface say what it is a count OF. Counts come
          from the pure module; nothing here is hardcoded.

          R13.R4A.3 — UNREPORTED LEADS. It is the category a reader cannot
          infer and the one that bounds how complete the list below is, so it
          is stated before the two categories that ARE a finding rather than
          after them, where it read as a footnote to a list it actually
          qualifies. */}
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 pb-3 mb-3 border-b border-border">
        {/* R13.R5C.2 — these four CARDINALITIES stand alone in a value
            position, so they take the module's zero mark like the amounts
            above them: "nothing unreported" reads `-`, not `0`. A cardinality
            inside a sentence keeps its digits (see `formatCount`). */}
        <div className="flex items-baseline gap-2">
          <dt className="ui-meta text-muted-fg">{a.undrawnUnreportedLabel}</dt>
          <dd className="ui-number text-sm font-medium text-foreground">{formatCount(undrawn.unavailable)}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="ui-meta text-muted-fg">{a.undrawnWithLabel}</dt>
          <dd className="ui-number text-sm text-foreground">{formatCount(undrawn.holdings.length)}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="ui-meta text-muted-fg">{a.undrawnFullyDrawnLabel}</dt>
          <dd className="ui-number text-sm text-foreground">{formatCount(undrawn.fullyDrawn)}</dd>
        </div>
        <div className="flex items-baseline gap-2 ml-auto">
          <dt className="ui-meta text-muted-fg">{a.undrawnPopulationLabel}</dt>
          <dd className="ui-number text-sm font-semibold text-foreground">{formatCount(undrawn.ofHoldings)}</dd>
        </div>
      </dl>

      {/* Why the two counts on this surface do not add up — with both of them
          IN the sentence, beside the column each one reads. Rendered only when
          the ratio exists; there is no version of this note that invents a
          basis the card was not showing. Body-copy scale (text-xs), not the
          footnotes' meta scale: this is the sentence that reconciles the
          dialog's two counts, not a caveat under a table, and at meta size it
          read as one. */}
      {drawn !== null && (
        <p className="text-xs leading-relaxed text-muted-fg mb-4">
          {fill(a.drawnBasisNote, {
            drawn: drawn.holdings,
            total: drawn.ofHoldings,
            unreported: undrawn.unavailable,
          })}
        </p>
      )}

      {/* ── The rows the source reports no unfunded figure for ─────────────
          NAMED, not merely counted, and FIRST (R13.R4A.3) — they belong to
          neither category below, and a reader who meets the list of undrawn
          commitments before learning that six holdings could not be assessed
          has already formed a view of a population they have not seen all of.
          The unfunded cell is an em dash: there is no figure to show, and NMI
          does not manufacture one.

          The section wears the module's needs-attention dress — tinted panel,
          warning spine, the unclassified callout's own recipe — so this caveat
          population can never be read as the first page of the main list
          below it. The heading still names it; the colour never carries the
          meaning alone. */}
      {undrawn.unreported.length > 0 && (
        <section
          className="mb-5 rounded-[13px] border border-border bg-surface-2 px-4 py-3"
          style={{ borderLeft: '3px solid var(--warning)' }}
        >
          <h3 className="ui-label text-muted-fg mb-2">
            {a.undrawnUnreportedLabel}
            <span className="text-muted-fg"> · {formatCount(undrawn.unreported.length)}</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="border-b border-border-strong">
                  <th className={`${TH} text-left`} scope="col">{a.colInvestment}</th>
                  <th className={`${TH} text-left`} scope="col">{a.colSociedad}</th>
                  <th className={`${TH} text-right`} scope="col">{a.colCommitted}</th>
                  <th className={`${TH} text-right`} scope="col">{a.colContributions}</th>
                  <th className={`${TH} text-right`} scope="col">{a.colUnfunded}</th>
                </tr>
              </thead>
              <tbody>
                {undrawn.unreported.map((h) => (
                  <tr key={h.id} className="border-b border-border last:border-b-0">
                    <td className={`${CELL} text-left`}>
                      <span className="block truncate max-w-[20rem]" title={h.investmentName}>
                        {h.investmentName}
                      </span>
                    </td>
                    <td className={`${CELL} text-left whitespace-nowrap text-muted-fg`}>{h.sociedad}</td>
                    <td className={`${CELL} text-right ui-number whitespace-nowrap text-muted-fg`}>
                      <MaskedAmount value={h.capitalCommitted} masked={masked} />
                    </td>
                    <td className={`${CELL} text-right ui-number whitespace-nowrap text-muted-fg`}>
                      <MaskedAmount value={h.contributions} masked={masked} />
                    </td>
                    {/* Always unavailable — the row is in this section BECAUSE
                        the source carries no figure here. `MaskedAmount`
                        renders the em dash from a real null, so the cell can
                        never be mistaken for a rendered zero. */}
                    <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                      <MaskedAmount value={null} masked={masked} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ui-meta text-muted-fg mt-2">{a.undrawnUnreportedNote}</p>
        </section>
      )}

      {/* ── The holdings that DO report an undrawn commitment ──────────────
          Second, and under its own heading now that it is no longer the only
          table in the dialog. The unreported rows above sit inside their own
          fenced caveat panel, which is what keeps the two populations from
          reading as one continuing list — so no rule rides this heading, and
          when the panel is absent (nothing unreported) the heading follows
          the basis sentence cleanly instead of dragging a full-width rule
          directly under a paragraph. */}
      <h3 className="ui-label text-muted-fg mb-2">
        {a.undrawnWithLabel}
        <span className="text-muted-fg"> · {formatCount(undrawn.holdings.length)}</span>
      </h3>

      {undrawn.holdings.length === 0 ? (
        <p className="text-xs text-muted-fg py-6 text-center">{a.undrawnEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[520px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="border-b border-border-strong">
                <th className={`${TH} text-left`} scope="col">{a.colInvestment}</th>
                <th className={`${TH} text-left`} scope="col">{a.colSociedad}</th>
                {/* All three amount columns share one alignment (R13.R4A.1) —
                    a centred pair beside a right-aligned total made the three
                    figures read as two different kinds of number. */}
                <th className={`${TH} text-right`} scope="col">{a.colCommitted}</th>
                <th className={`${TH} text-right`} scope="col">{a.colContributions}</th>
                <th className={`${TH} text-right`} scope="col">{a.colUnfunded}</th>
              </tr>
            </thead>
            <tbody>
              {undrawn.holdings.map((h) => (
                <tr key={h.id} className="border-b border-border">
                  <td className={`${CELL} text-left`}>
                    <span className="block truncate max-w-[20rem]" title={h.investmentName}>
                      {h.investmentName}
                    </span>
                  </td>
                  <td className={`${CELL} text-left whitespace-nowrap text-muted-fg`}>{h.sociedad}</td>
                  <td className={`${CELL} text-right ui-number whitespace-nowrap text-muted-fg`}>
                    <MaskedAmount value={h.capitalCommitted} masked={masked} />
                  </td>
                  <td className={`${CELL} text-right ui-number whitespace-nowrap text-muted-fg`}>
                    <MaskedAmount value={h.contributions} masked={masked} />
                  </td>
                  <td className={`${CELL} text-right ui-number whitespace-nowrap font-medium`}>
                    <MaskedAmount value={h.unfunded} masked={masked} />
                  </td>
                </tr>
              ))}
              {/* The listed rows' own total — deliberately labelled as such,
                  because it is NOT the position card's unfunded subtotal (that
                  one also counts the zero and negative rows). The tinted band
                  echoes the Holdings table's closing-line treatment. */}
              <tr className="border-t border-border-strong font-medium bg-surface-2">
                <td colSpan={4} className={`${CELL} text-left`}>
                  {a.undrawnListedTotal}
                  <span className="text-muted-fg"> · {code}</span>
                </td>
                <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                  <MaskedAmount value={undrawn.listedTotal} masked={masked} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="nv-notes mt-4">
        <TableSourceFooter source={a.source} asOf={asOf} />
        <p className="ui-meta text-muted-fg">{a.undrawnSourceNote}</p>
      </div>
    </ModalShell>
  )
}
