'use client'

// R13.8C — the import plan as the administrator SEES it.
//
// PRESENTATION ONLY. Everything rendered here was decided on the server by
// `weeklyImportPlan.ts` and shipped as the plan; this file chooses how each
// decided group is composed, in what order, and with what weight. It fetches
// nothing, posts nothing and decides nothing financial. The one gate it
// expresses — that an overwrite needs authorization and a reason — is read
// from `requiresHistoricalCorrection` and enforced by the route and the
// database independently of anything this file does.
//
// HIERARCHY (R13.8C § 3). Not every category gets equal weight:
//   primary   — what confirming DOES (the verdict), the publication date, the
//               NEW weeks and the GAP FILLS;
//   attention — HISTORICAL CHANGES, the only overwrite, in a visibly stronger
//               card that also holds the reason field and the correction
//               confirmation, so the reason is never buried below metadata;
//   secondary — the unchanged count, cadence gaps and workbook metadata, folded
//               into a details block.
//
// The live `=TODAY()` column is a DIAGNOSTIC LINE, never a control: it is
// reported as detected and marked not used, with nothing to select.
//
// AMOUNTS appear in exactly one place, the before/after of an overwrite — the
// same rule the R13.8B preview established (an administrator cannot honestly
// authorize a correction blind). Dates are chips; unchanged is a count.
//
// ADMINISTRATOR-ONLY BY PLACEMENT. The only page that renders this component is
// the administrator console, which mounts it only for a review the
// administrator-guarded draft route returned. It imports no repository.

import { useState, type ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { ChipLabel } from '@/components/fable/Chip'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { formatUsd } from '@/lib/formatters'
import {
  WORKFLOW_STEPS,
  TONE,
  correctionDelta,
  describeImportPlan,
  fill,
  nonCorrectionBlockCodes,
  restatedFieldCount,
  type ImportPlan,
  type WorkflowStep,
} from '@/lib/familyPortfolio/importPlanPresentation'

export type { ImportPlan, PreviewCorrection, WorkflowStep } from '@/lib/familyPortfolio/importPlanPresentation'

// ── Client-side view of the draft review (R13.5) ─────────────────────────────

export interface ReviewFinding {
  severity: 'blocking' | 'warning' | 'info'
  code: string
  detail: string
  scope?: string
  sourceSheet?: string
  sourceCell?: string
  rowLabel?: string
}

export interface DraftReview {
  uploadKind: 'portfolio' | 'alternatives'
  detectedAsOfDate: string | null
  previousWeekDate: string | null
  beginningOfYearDate: string | null
  scopes: Array<{ scope: string; rowCount: number; unavailableCount: number }>
  performance: Array<{ scope: string; basis: string; metric: string; agrees: boolean; indeterminate: boolean }>
  groups: Array<{ category: string; currency: string; holdings: number }>
  legend: Array<{ event: string; hex: string }>
  unclassifiedEventCells: string[]
  findings: ReviewFinding[]
  recordCount: number
  publishable: boolean
  refusals: string[]
  warningCount: number
}

const CARD = 'rounded-[18px] border bg-surface p-3 sm:p-4'

function severityColor(severity: ReviewFinding['severity']): string {
  if (severity === 'blocking') return TONE.blocked
  if (severity === 'warning') return TONE.changed
  return TONE.neutral
}

// ── The five-step indicator ──────────────────────────────────────────────────

export function WorkflowSteps({ current }: { current: WorkflowStep }) {
  const { t } = useLang()
  const a = t.fpAdmin
  const at = WORKFLOW_STEPS.indexOf(current)
  return (
    <ol aria-label={a.steps.label} className="flex flex-wrap items-center gap-1.5">
      {WORKFLOW_STEPS.map((step, i) => {
        const state = i < at ? 'done' : i === at ? 'current' : 'todo'
        return (
          <li key={step} className="flex items-center gap-1.5" aria-current={state === 'current' ? 'step' : undefined}>
            <ChipLabel selected={state === 'current'} className={state === 'todo' ? 'opacity-60' : ''}>
              <span className="ui-number" aria-hidden>
                {state === 'done' ? '✓' : i + 1}
              </span>
              {a.steps[step]}
            </ChipLabel>
            {i < WORKFLOW_STEPS.length - 1 && (
              <span aria-hidden className="text-[11px] text-muted-fg">
                →
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ── Small shared pieces ──────────────────────────────────────────────────────

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-[18px] border border-border bg-surface-2 px-3 py-2 min-w-0">
      <p className="ui-label text-muted-fg">{label}</p>
      <p className="ui-number text-sm text-foreground truncate" style={tone ? { color: tone } : undefined} title={value}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-fg truncate">{sub}</p>}
    </div>
  )
}

/**
 * Reporting dates as chips — every date, always. The one that becomes current
 * is emphasised and says so in words, never by colour alone.
 */
function DateChips({
  dates,
  tone,
  currentDate,
  currentLabel,
}: {
  dates: string[]
  tone: string
  currentDate?: string | null
  currentLabel?: string
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {dates.map((d) => {
        const isCurrent = currentDate != null && d === currentDate
        return (
          <li
            key={d}
            className={`rounded-full border px-2.5 py-0.5 ui-number text-[11px] text-foreground ${isCurrent ? 'font-semibold' : 'border-border'}`}
            style={isCurrent ? { borderColor: tone } : undefined}
          >
            {d}
            {isCurrent && currentLabel && <span className="ml-1 font-normal text-muted-fg">· {currentLabel}</span>}
          </li>
        )
      })}
    </ul>
  )
}

// ── Primary: the verdict ─────────────────────────────────────────────────────

function ImportVerdictBanner({ plan }: { plan: ImportPlan }) {
  const { t } = useLang()
  const verdict = describeImportPlan(plan, t.fpAdmin)
  const strong = verdict.kind === 'correction' || verdict.kind === 'blocked'
  return (
    <section
      className={`${CARD} flex items-start gap-3`}
      role="status"
      aria-live="polite"
      data-verdict={verdict.kind}
      style={{
        borderColor: strong ? verdict.tone : 'var(--border)',
        borderLeft: `3px solid ${verdict.tone}`,
        background: strong ? `color-mix(in oklab, ${verdict.tone} 7%, var(--surface))` : undefined,
      }}
    >
      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: verdict.tone }} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{verdict.title}</p>
        <p className="text-xs text-muted-fg">{verdict.body}</p>
      </div>
    </section>
  )
}

// ── Primary: publication facts + the live-column diagnostic ─────────────────

function PublicationFacts({ plan }: { plan: ImportPlan }) {
  const { t } = useLang()
  const a = t.fpAdmin
  const frozen = plan.frozen
  const endpointMoves = plan.publicationDate !== null && plan.publicationDate !== plan.productionEndpoint

  return (
    <section className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <Fact label={a.planEndpoint} value={plan.productionEndpoint ?? '—'} />
        <Fact
          label={a.planPublication}
          value={plan.publicationDate ?? '—'}
          sub={plan.publicationDate ? (endpointMoves ? a.planBecomesCurrent : a.planAlreadyCurrent) : undefined}
          tone={endpointMoves ? TONE.new : undefined}
        />
        <Fact label={a.planNewestFrozen} value={plan.workbookLatest ?? '—'} />
        <Fact
          label={a.planSource}
          value={a.planSourceFrozen}
          sub={
            frozen.publicationColumnLetter
              ? `${a.planFrozenColumn} ${frozen.publicationColumnLetter} · ${frozen.publicationDate ?? '—'}`
              : undefined
          }
        />
      </div>

      {/* The live column: REPORTED, never selectable. A plain line with a
          non-interactive tag — there is nothing here to click. */}
      {frozen.liveColumnLetter && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-fg" data-diagnostic="live-column">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TONE.neutral }} aria-hidden />
          <span>{a.planLiveDetected}</span>
          <span className="ui-number text-foreground">
            {frozen.liveColumnLetter} · {frozen.liveColumnDate ?? '—'}
          </span>
          <span className="ui-label rounded-full border border-border px-2 py-0.5 text-muted-fg">{a.planLiveNotUsed}</span>
        </p>
      )}
    </section>
  )
}

// ── Primary: NEW weeks ───────────────────────────────────────────────────────

function NewWeeksCard({ plan, className = '' }: { plan: ImportPlan; className?: string }) {
  const { t } = useLang()
  const a = t.fpAdmin
  if (plan.newDates.length === 0) return null
  return (
    <section className={`${CARD} border-border space-y-2 ${className}`} style={{ borderLeft: `3px solid ${TONE.new}` }} data-group="new">
      <p className="ui-label" style={{ color: TONE.new }}>
        {a.planNew} · <span className="ui-number">{plan.newDates.length}</span>
      </p>
      <DateChips dates={plan.newDates} tone={TONE.new} currentDate={plan.publicationDate} currentLabel={a.planBecomesCurrent} />
      <p className="text-[11px] text-muted-fg">{a.planNewHint}</p>
    </section>
  )
}

// ── Primary: GAP FILLS — insertions, deliberately NOT the correction tone ────

function GapFillsCard({ plan, className = '' }: { plan: ImportPlan; className?: string }) {
  const { t } = useLang()
  const a = t.fpAdmin
  if (plan.gapFillDates.length === 0) return null
  return (
    <section className={`${CARD} border-border space-y-2 ${className}`} style={{ borderLeft: `3px solid ${TONE.gapFill}` }} data-group="gap-fill">
      <p className="ui-label" style={{ color: TONE.gapFill }}>
        {a.planGapFill} · <span className="ui-number">{plan.gapFillDates.length}</span>
      </p>
      <DateChips dates={plan.gapFillDates} tone={TONE.gapFill} />
      <p className="text-[11px] text-muted-fg">{a.planGapFillHint}</p>
    </section>
  )
}

// ── Attention: THE STANDING SNAPSHOT (R13.8C.2) ───────────────────────
//
// History unchanged does not mean nothing changed. When the workbook restates a
// figure inside THIS WEEK'S published snapshot, the pre-R13.8C.2 console said
// "nothing to apply" and disabled Apply — a false sentence that left the stale
// figure standing. This card is what it says instead.
//
// IT LISTS ONLY WHAT DIFFERS. A publication carries ~500 rows; the ones that did
// not move are represented by their absence, never by a row apiece. The server
// caps the sample and reports the true count, so a long tail reads as a count
// rather than a scroll.
//
// It is presentation, not a gate: this card authorizes nothing and blocks
// nothing. A same-date republication has never required a written reason
// (`nmi_publish_portfolio` mints a new revision and supersedes the old one), and
// R13.8C.2 deliberately did not invent one — only an overwrite of settled
// HISTORY does, which is the card below.
function PublicationChangesCard({ plan }: { plan: ImportPlan }) {
  const { t } = useLang()
  const a = t.fpAdmin
  if (plan.publicationChanged !== true) return null
  const shown = plan.publicationDifferences ?? []
  const total = plan.publicationDifferenceCount ?? shown.length
  const more = Math.max(0, total - shown.length)

  return (
    <section
      className={`${CARD} space-y-2`}
      data-group="publication-change"
      style={{
        borderColor: TONE.changed,
        borderLeft: `3px solid ${TONE.changed}`,
        background: `color-mix(in oklab, ${TONE.changed} 6%, var(--surface))`,
      }}
    >
      <p className="ui-label" style={{ color: TONE.changed }}>
        {a.publicationDiffTitle} · <span className="ui-number">{total}</span>
      </p>
      {shown.length > 0 && (
        <ul className="space-y-1">
          {shown.map((d) => (
            <li
              key={`${d.area}|${d.identity}|${d.field ?? d.kind}`}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
            >
              <span className="text-foreground">{d.label ?? d.identity}</span>
              {d.kind !== 'changed' && (
                <ChipLabel>
                  {d.kind === 'added' ? a.publicationDiffAdded : a.publicationDiffRemoved}
                </ChipLabel>
              )}
              {d.kind === 'changed' && d.field !== 'value' && (
                <span className="text-[11px] text-muted-fg">
                  {a.publicationDiffField}: {d.field}
                </span>
              )}
              {d.kind === 'changed' && d.field === 'value' && (
                <span className="ui-number text-[11px] text-muted-fg">
                  {d.beforeValue === null || d.beforeValue === undefined ? '—' : formatUsd(d.beforeValue, 0)}
                  {' → '}
                  <span className="text-foreground">
                    {d.afterValue === null || d.afterValue === undefined ? '—' : formatUsd(d.afterValue, 0)}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="text-[11px] text-muted-fg">
          {fill(a.publicationDiffMore, { n: more })}
        </p>
      )}
      <p className="text-[11px] text-muted-fg">{a.publicationDiffNote}</p>
    </section>
  )
}

// ── Attention: HISTORICAL PUBLICATION RESTATEMENTS (R13.8D.1) ────────────────
//
// Already-published weeks the workbook now states differently.
//
// WHY THIS IS ITS OWN CARD. The evolution card below shows overwritten PORTFOLIO
// LEVELS. These weeks' levels may not have moved at all — a workbook can shift an
// amount from net flows into weekly profit and leave every level identical while
// the published figures change. Folding the two together would tell an
// administrator a level was overwritten when none was, and the authorization they
// give is only as good as the sentence they were shown.
//
// Bounded by construction: a week carries ~220 rows, so only the fields that
// DIFFER are listed and the tail is a count.
function RestatementCard({ plan }: { plan: ImportPlan }) {
  const { t } = useLang()
  const a = t.fpAdmin
  const weeks = plan.historicalRestatements ?? []
  if (weeks.length === 0) return null

  const total = restatedFieldCount(plan)

  return (
    <section
      className={`${CARD} space-y-3`}
      data-group="historical-restatement"
      style={{
        borderColor: TONE.changed,
        borderLeft: `3px solid ${TONE.changed}`,
        background: `color-mix(in oklab, ${TONE.changed} 7%, var(--surface))`,
      }}
    >
      <div>
        <p className="ui-label" style={{ color: TONE.changed }}>
          {a.restatementTitle} · <span className="ui-number">{weeks.length}</span>
        </p>
        <p className="mt-1 text-[11px] text-muted-fg">{a.restatementNote}</p>
        {plan.corrections.length === 0 && (
          <p className="mt-1 text-[11px] text-muted-fg">{a.restatementLevelUnchanged}</p>
        )}
      </div>

      <div className="space-y-3">
        {weeks.map((w) => {
          const more = Math.max(0, w.differenceCount - w.fields.length)
          return (
            <div key={w.asOfDate} className="space-y-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="ui-number font-medium text-foreground">{w.asOfDate}</span>
                <ChipLabel>{fill(a.restatementRevision, { n: w.revision })}</ChipLabel>
                <span className="text-[11px] text-muted-fg">
                  {fill(a.restatementFieldCount, { n: w.differenceCount })}
                </span>
              </p>
              <ul className="space-y-0.5">
                {w.fields.map((f) => (
                  <li
                    key={`${f.area}|${f.identity}|${f.field ?? f.kind}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                  >
                    <span className="font-mono text-[11px] text-muted-fg">{f.scope}</span>
                    <span className="text-foreground">
                      {f.metric ?? f.label ?? f.rowKey ?? f.identity}
                    </span>
                    {f.basis !== null && (
                      <span className="text-[11px] text-muted-fg">{basisLabel(t, f.basis)}</span>
                    )}
                    {f.kind !== 'changed' && (
                      <ChipLabel>
                        {f.kind === 'added' ? a.publicationDiffAdded : a.publicationDiffRemoved}
                      </ChipLabel>
                    )}
                    {f.kind === 'changed' && f.field !== 'value' && (
                      <span className="text-[11px] text-muted-fg">
                        {a.publicationDiffField}: {f.field}
                      </span>
                    )}
                    {f.kind === 'changed' && f.field === 'value' && (
                      <span className="ui-number text-[11px] text-muted-fg">
                        {f.productionValue === null ? '—' : formatUsd(f.productionValue, 0)}
                        {' → '}
                        <span className="text-foreground">
                          {f.workbookValue === null ? '—' : formatUsd(f.workbookValue, 0)}
                        </span>
                        {f.delta !== null && <span className="ml-1">({signed(f.delta)})</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {more > 0 && (
                <p className="text-[11px] text-muted-fg">{fill(a.restatementMore, { n: more })}</p>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-fg">
        {a.restatementProduction} → {a.restatementWorkbook} · {a.restatementDelta} ·{' '}
        <span className="ui-number">{total}</span>
      </p>
    </section>
  )
}

// ── Attention: HISTORICAL CHANGES — the only overwrite ───────────────────────

export interface CorrectionControls {
  authorized: boolean
  reason: string
  onAuthorizedChange: (v: boolean) => void
  onReasonChange: (v: string) => void
  disabled: boolean
  /** The stronger confirmation control, rendered INSIDE this card by the owner of the submit. */
  action: ReactNode
}

function basisLabel(t: ReturnType<typeof useLang>['t'], basis: string): string {
  if (basis === 'ex_chilean_equities') return t.fp.overview.basisExChilean
  if (basis === 'with_chilean_equities' || basis === 'total') return t.fp.overview.basisTotal
  return basis
}

function signed(delta: number): string {
  return `${delta > 0 ? '+' : ''}${formatUsd(delta, 0)}`
}

// ── R13.8E — ROW-LEVEL HISTORY ───────────────────────────────────────────────
//
// WHY ITS OWN CARD, AGAIN. The evolution card shows overwritten PORTFOLIO
// LEVELS; the restatement card shows re-published WEEKS. This shows neither: it
// shows source-backed row values recorded at frozen reporting dates that mostly
// have no publication at all. Folding it into either would tell an
// administrator something was republished when nothing was.
//
// INSERTIONS AND OVERWRITES ARE VISUALLY DIFFERENT, because only one of them is
// a correction. Appending 19,757 rows for weeks the book never held at row level
// is an ordinary insertion and needs no authorization; moving a value it already
// recorded is a rewrite of settled history and needs both.
function RowHistoryCard({ plan }: { plan: ImportPlan }) {
  const { t } = useLang()
  const a = t.fpAdmin
  const rh = plan.rowHistory
  if (!rh || (rh.insertedCount === 0 && rh.changedCount === 0)) return null

  const changed = rh.changedCount > 0
  const tone = changed ? TONE.changed : TONE.gapFill

  return (
    <section
      className={`${CARD} space-y-2`}
      data-group="row-history"
      style={{
        borderColor: tone,
        borderLeft: `3px solid ${tone}`,
        background: `color-mix(in oklab, ${tone} 7%, var(--surface))`,
      }}
    >
      <p className="ui-label" style={{ color: tone }}>
        {a.rowHistoryTitle}
      </p>
      <p className="text-[11px] text-muted-fg">{a.rowHistoryNote}</p>

      {rh.insertedCount > 0 && (
        <p className="text-xs text-foreground">
          {fill(a.rowHistoryInserted, { r: rh.insertedCount, n: rh.datesInserted.length })}
        </p>
      )}
      {changed && (
        <>
          <p className="text-xs text-foreground">
            {fill(a.rowHistoryChanged, { r: rh.changedCount, n: rh.datesChanged.length })}
          </p>
          <p className="text-[11px]" style={{ color: TONE.changed }}>
            {a.rowHistoryChangedNote}
          </p>
          <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-fg">
            <span>{a.rowHistoryDatesLabel}:</span>
            {rh.datesChanged.map((d) => (
              <span key={d} className="ui-number text-foreground">
                {d}
              </span>
            ))}
          </p>
        </>
      )}
    </section>
  )
}

function HistoricalChangesCard({ plan, controls }: { plan: ImportPlan; controls: CorrectionControls }) {
  const { t } = useLang()
  const a = t.fpAdmin
  if (!plan.requiresHistoricalCorrection) return null
  const reasonId = 'fp-admin-correction-reason'

  return (
    <section
      className={`${CARD} space-y-3`}
      data-group="changed"
      style={{
        borderColor: TONE.changed,
        borderLeft: `3px solid ${TONE.changed}`,
        background: `color-mix(in oklab, ${TONE.changed} 7%, var(--surface))`,
      }}
    >
      <div>
        <p className="ui-label" style={{ color: TONE.changed }}>
          {a.verdictCorrectionTitle} · <span className="ui-number">{plan.corrections.length}</span>
        </p>
        <p className="mt-1 text-[11px] text-muted-fg">{a.correctionHint}</p>
      </div>

      {/* R13.8D.1 — the gate now has two causes, and only one of them fills this
          table. An import that restates published WEEKS but overwrites no
          evolution point reaches this card with zero corrections; rendering an
          empty table under the heading "published history values" would state
          something false about what is being authorized. The restatement card
          above carries that half. */}
      {plan.corrections.length > 0 && (
      /* The ONE place this console shows amounts. Fit table: stacks into one
          block per identity when the card is narrower than 520px, so the
          before/after stays readable on a phone without sideways scroll. */
      <div className="nv-tbl-fit-host rounded-[6px] border border-border" style={{ background: 'var(--surface-table)' }}>
        <table className="nv-tbl-fit nv-tbl-fit--stack text-xs">
          <caption className="sr-only">{a.planChanged}</caption>
          {/* Budget (sums to 100): scope 14 · date 16 · metric 22 · current 16 · workbook 16 · change 16 */}
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="ui-table-header text-muted-fg nv-tbl-fit-name">{a.colScope}</th>
              <th className="ui-table-header text-muted-fg">{a.colObservationDate}</th>
              <th className="ui-table-header text-muted-fg">{a.colMetric}</th>
              <th className="ui-table-header text-muted-fg">{a.colCurrentValue}</th>
              <th className="ui-table-header text-muted-fg">{a.colWorkbookValue}</th>
              <th className="ui-table-header text-muted-fg">{a.colDelta}</th>
            </tr>
          </thead>
          <tbody>
            {plan.corrections.map((c) => {
              const delta = correctionDelta(c)
              return (
                <tr key={`${c.scope}-${c.basis}-${c.seriesIdentity ?? ''}-${c.observationDate}`} className="border-b border-border/60 last:border-b-0">
                  <td className="nv-tbl-fit-name font-mono text-foreground" data-label={a.colScope}>
                    {c.scope}
                  </td>
                  <td className="ui-number text-foreground" data-label={a.colObservationDate}>
                    {c.observationDate}
                  </td>
                  <td className="text-foreground" data-label={a.colMetric}>
                    {basisLabel(t, c.basis)}
                  </td>
                  <td className="ui-number text-muted-fg" data-label={a.colCurrentValue}>
                    {formatUsd(c.beforeValue, 0)}
                  </td>
                  <td className="ui-number font-medium text-foreground" data-label={a.colWorkbookValue}>
                    {formatUsd(c.afterValue, 0)}
                  </td>
                  <td className="ui-number text-foreground" data-label={a.colDelta}>
                    {delta === null ? '—' : signed(delta)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-3 py-2">
          <TableSourceFooter source={a.source} />
        </div>
      </div>
      )}

      {/* Authorization and reason sit DIRECTLY under what they authorize. */}
      <label className="flex items-start gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={controls.authorized}
          disabled={controls.disabled}
          onChange={(e) => controls.onAuthorizedChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>{a.correctionAuthorize}</span>
      </label>

      <label className="block" htmlFor={reasonId}>
        <span className="ui-label text-muted-fg">{a.correctionReason}</span>
        <input
          id={reasonId}
          type="text"
          value={controls.reason}
          onChange={(e) => controls.onReasonChange(e.target.value)}
          disabled={!controls.authorized || controls.disabled}
          required
          aria-required
          className="mt-1 w-full rounded-[13px] border border-border bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50"
        />
        <span className="mt-1 block text-[11px] text-muted-fg">{a.correctionReasonHint}</span>
      </label>

      <div className="flex flex-wrap items-center gap-3">{controls.action}</div>
    </section>
  )
}

// ── Warnings ─────────────────────────────────────────────────────────────────

function PlanWarnings({ plan, review }: { plan: ImportPlan | null; review: DraftReview | null }) {
  const { t } = useLang()
  const a = t.fpAdmin
  const refusalText = (code: string) =>
    (a.refusalImport as Record<string, string>)[code] ?? (a.refusal as Record<string, string>)[code] ?? code

  const hardBlocks = plan ? nonCorrectionBlockCodes(plan) : []
  const invalid = plan?.invalidDates ?? []
  const refusals = review && !review.publishable ? review.refusals : []
  const findings = (review?.findings ?? []).filter((f) => f.severity !== 'info')
  const unclassified = review?.unclassifiedEventCells ?? []
  const planMissing = plan === null && review !== null && review.uploadKind === 'portfolio'

  if (hardBlocks.length + invalid.length + refusals.length + findings.length + unclassified.length === 0 && !planMissing) {
    return null
  }

  return (
    <section className={`${CARD} border-border space-y-2`} style={{ borderLeft: `3px solid ${TONE.changed}` }} data-group="warnings">
      <p className="ui-label" style={{ color: TONE.changed }}>
        {a.warningsTitle}
      </p>

      {planMissing && (
        <p className="text-xs" style={{ color: TONE.blocked }}>
          {a.planUnavailable}
        </p>
      )}

      {refusals.length > 0 && (
        <ul className="space-y-1">
          {refusals.map((r) => (
            <li key={r} className="text-xs" style={{ color: TONE.blocked }}>
              {refusalText(r)}
            </li>
          ))}
        </ul>
      )}

      {hardBlocks.length > 0 && (
        <ul className="space-y-1">
          {hardBlocks.map((code) => (
            <li key={code} className="text-xs" style={{ color: TONE.blocked }}>
              {refusalText(code)}
            </li>
          ))}
        </ul>
      )}

      {invalid.length > 0 && (
        <div className="space-y-1">
          <p className="ui-label" style={{ color: TONE.blocked }}>
            {a.planInvalid} · <span className="ui-number">{invalid.length}</span>
          </p>
          <DateChips dates={invalid} tone={TONE.blocked} />
        </div>
      )}

      {unclassified.length > 0 && (
        <div>
          <p className="ui-label mb-1" style={{ color: TONE.changed }}>
            {a.unclassified}
          </p>
          <p className="text-[11px] text-muted-fg mb-1">{a.unclassifiedHint}</p>
          <p className="font-mono text-[11px] text-foreground break-all">{unclassified.join(', ')}</p>
        </div>
      )}

      {findings.length > 0 && (
        <ul className="space-y-1">
          {findings.map((f, i) => (
            <li key={`${f.code}-${i}`} className="text-xs text-foreground">
              <span style={{ color: severityColor(f.severity) }}>
                {f.severity === 'blocking' ? a.blocking : f.severity === 'warning' ? a.warning : a.info}
              </span>
              {' · '}
              <span className="font-mono">{f.code}</span>
              {f.sourceCell && <span className="font-mono text-muted-fg"> {f.sourceCell}</span>}
              <span className="text-muted-fg"> — {f.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Secondary: everything else the R13.5 review carries ──────────────────────

function ReviewDetails({ plan, review }: { plan: ImportPlan | null; review: DraftReview }) {
  const { t } = useLang()
  const a = t.fpAdmin
  // Open by default when there is no plan to lead with (an alternatives
  // workbook, or a portfolio one that did not parse): then this IS the review.
  const [open, setOpen] = useState(plan === null)

  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="group">
      <summary className="ui-label text-muted-fg cursor-pointer select-none list-none flex items-center gap-2">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        {a.detailsTitle}
      </summary>

      <div className="mt-3 space-y-4">
        {plan && (
          <>
            <p className="text-xs text-muted-fg">
              {a.planUnchanged}: <span className="ui-number text-foreground">{plan.unchangedCount}</span> {a.planCount}
            </p>

            {/* Informational only. The workbook not freezing a week is a fact
                about the workbook, never permission to manufacture one. */}
            {plan.cadenceGaps.length > 0 && (
              <section>
                <p className="ui-label text-muted-fg mb-1">{a.planCadence}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {plan.cadenceGaps.map((g) => (
                    <li key={`${g.from}-${g.to}`} className="rounded-full border border-border px-2.5 py-0.5 ui-number text-[11px] text-muted-fg">
                      {g.from} → {g.to} ({g.days}d)
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-muted-fg">{a.planNoInvent}</p>
              </section>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <Fact label={a.planSchema} value={`${plan.contractVersion} · ${plan.contractVerdict}`} />
              <Fact label={a.planWorkbook} value={plan.sheetNames.join(' · ') || '—'} />
              <Fact
                label={a.planFrozenColumn}
                value={plan.frozen.publicationColumnLetter ? `${plan.frozen.publicationColumnLetter} · ${plan.frozen.publicationDate ?? '—'}` : '—'}
                sub={`${plan.frozen.historicalColumnCount} ${a.planCount}`}
              />
              <Fact
                label={a.planLiveColumn}
                value={plan.frozen.liveColumnLetter ? `${plan.frozen.liveColumnLetter} · ${plan.frozen.liveColumnDate ?? '—'}` : '—'}
              />
            </div>
            <p className="text-[11px] text-muted-fg">{a.planLiveHint}</p>
          </>
        )}

        {/* Dates — proposed, never asserted. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Fact label={a.detectedDate} value={review.detectedAsOfDate ?? '—'} />
          <Fact label={a.previousWeek} value={review.previousWeekDate ?? '—'} />
          <Fact label={a.beginningOfYear} value={review.beginningOfYearDate ?? '—'} />
        </div>

        {review.scopes.length > 0 && (
          <section>
            <p className="ui-label text-muted-fg mb-2">{a.scopeSummary}</p>
            <ul className="flex flex-wrap gap-2">
              {review.scopes.map((s) => (
                <li key={s.scope} className="rounded-full border border-border px-3 py-1 text-xs text-foreground">
                  <span className="font-mono">{s.scope}</span> <span className="ui-number">{s.rowCount}</span> {a.rows}
                  {s.unavailableCount > 0 && (
                    <span className="text-muted-fg">
                      {' · '}
                      <span className="ui-number">{s.unavailableCount}</span> {a.unavailable}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {review.groups.length > 0 && (
          <section>
            <p className="ui-label text-muted-fg mb-2">{a.groups}</p>
            <ul className="flex flex-wrap gap-2">
              {review.groups.map((g) => (
                <li key={`${g.category}-${g.currency}`} className="rounded-full border border-border px-3 py-1 text-xs text-foreground">
                  {g.category} · {g.currency} · <span className="ui-number">{g.holdings}</span> {a.holdings}
                </li>
              ))}
            </ul>
          </section>
        )}

        {review.performance.length > 0 && (
          <section>
            <p className="ui-label text-muted-fg mb-2">{a.performanceChecks}</p>
            <ul className="flex flex-wrap gap-2">
              {review.performance.map((p, i) => (
                <li
                  key={`${p.scope}-${p.basis}-${p.metric}-${i}`}
                  className="rounded-full border border-border px-3 py-1 text-xs"
                  style={{ color: p.indeterminate ? TONE.neutral : p.agrees ? TONE.new : TONE.changed }}
                >
                  <span className="font-mono">{p.scope}</span> {p.metric} — {p.indeterminate ? a.indeterminate : p.agrees ? a.agrees : a.mismatch}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <p className="ui-label text-muted-fg mb-2">{a.findings}</p>
          {review.findings.length === 0 ? (
            <p className="text-xs text-muted-fg">{a.noFindings}</p>
          ) : (
            <ul className="space-y-1">
              {review.findings.map((f, i) => (
                <li key={`${f.code}-${i}`} className="text-xs text-foreground">
                  <span style={{ color: severityColor(f.severity) }}>
                    {f.severity === 'blocking' ? a.blocking : f.severity === 'warning' ? a.warning : a.info}
                  </span>
                  {' · '}
                  <span className="font-mono">{f.code}</span>
                  {f.sourceCell && <span className="font-mono text-muted-fg"> {f.sourceCell}</span>}
                  <span className="text-muted-fg"> — {f.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[11px] text-muted-fg">{a.noAmountsNote}</p>
      </div>
    </details>
  )
}

// ── Composition ──────────────────────────────────────────────────────────────

export function ImportPlanPreview({
  plan,
  review,
  correction,
}: {
  plan: ImportPlan | null
  review: DraftReview | null
  correction: CorrectionControls
}) {
  const hasNew = (plan?.newDates.length ?? 0) > 0
  const hasGap = (plan?.gapFillDates.length ?? 0) > 0

  return (
    <div className="space-y-4">
      {plan && (
        <>
          <ImportVerdictBanner plan={plan} />
          <PublicationFacts plan={plan} />

          {(hasNew || hasGap) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NewWeeksCard plan={plan} className={hasGap ? '' : 'sm:col-span-2'} />
              <GapFillsCard plan={plan} className={hasNew ? '' : 'sm:col-span-2'} />
            </div>
          )}

          <PublicationChangesCard plan={plan} />
          {/* R13.8D.1 — the restated published weeks sit ABOVE the authorization
              card, so what is being authorized is on screen before the checkbox
              that authorizes it. */}
          <RestatementCard plan={plan} />
          {/* R13.8E — row-level history sits above the authorization card for
              the same reason: an overwrite here is a correction to settled
              history, and it must be visible before the checkbox that
              authorizes it. */}
          <RowHistoryCard plan={plan} />
          <HistoricalChangesCard plan={plan} controls={correction} />
        </>
      )}

      <PlanWarnings plan={plan} review={review} />

      {review && <ReviewDetails plan={plan} review={review} />}
    </div>
  )
}
