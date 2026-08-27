// R13.R3C — WHOSE value change is being decomposed.
//
// PURE MODULE. No Next.js, Supabase, environment, filesystem or clock import.
//
// A personal portfolio is a handful of legal entities plus, for two of the
// three members, one or more directly-held positions. Until now the
// contributors chart could only ever describe the whole of one — this module
// adds the subject selector the owner asked for, and does it STRUCTURALLY:
// the list of sociedades is read out of the published hierarchy every time,
// never hardcoded. A sociedad added, renamed or wound up in the source
// therefore appears or disappears on its own, and a label typed into this file
// could never drift from the book.
//
// ── THE SUBJECT DECIDES THE THREE FIGURES, NOT JUST THE BARS ──────────────
//
// Choosing "Los Sauzales" does not filter the portfolio's bars; it changes the
// subject of the whole card. Opening value, closing value, value change and
// every bar are then that sociedad's own, drawn from its own published rows.
// A card that swapped the bars but kept the portfolio's headline figures would
// be stating two different subjects at once.
//
// ── FAIL CLOSED ON A STRUCTURAL ZERO ──────────────────────────────────────
//
// A subject whose row is absent from the OPENING publication is read by
// R13.R1.1 § 14 as economically zero that week — correct for a position that
// genuinely did not exist, and badly wrong as an "Opening Portfolio Value",
// because the reader would see a book worth nothing growing into its entire
// present value. Any subject that is not `ongoing` across the two endpoints is
// withheld with a stated reason rather than drawn on a zero the source never
// published. Pablo's combined total over the full record is exactly this case.

import type { ChangeNode, ContributionChild, NodeLifecycle, TotalMetrics } from './weeklyChanges.ts'
import { contributionChildren } from './weeklyChanges.ts'

/** The sentinel for "the whole portfolio", which has no hierarchy row of its own. */
export const COMBINED_SUBJECT = '__combined__'

export interface PortfolioSubject {
  /** `COMBINED_SUBJECT`, or the hierarchy row this subject is. */
  key: string
  /** The source label, verbatim. Null for the combined portfolio, which the UI names. */
  labelEs: string | null
  labelEn: string | null
  /** True when the source publishes components beneath this subject. */
  decomposable: boolean
  lifecycle: NodeLifecycle | null
}

/**
 * The subjects a scope offers: the combined portfolio first, then one per
 * sociedad-grain driver in the book's own order.
 *
 * `drivers` is whatever tiling the caller already derived — for a personal
 * scope that is `deriveDrivers(nodes, 'sociedad')`, which yields each
 * sociedad's terminal total plus any root named holding (Proporcional Otras
 * Sociedades, Staten Capital) as an explicit driver of its own. Those named
 * holdings are subjects too: they are real components of the member's book,
 * and the owner listed them. They simply have nothing beneath them, which
 * `decomposable` reports rather than hides behind an empty chart.
 */
export function derivePortfolioSubjects(
  nodes: readonly ChangeNode[],
  drivers: readonly ChangeNode[],
): PortfolioSubject[] {
  const combined: PortfolioSubject = {
    key: COMBINED_SUBJECT,
    labelEs: null,
    labelEn: null,
    decomposable: drivers.length > 0,
    lifecycle: null,
  }
  return [
    combined,
    ...drivers.map((d) => ({
      key: d.rowKey,
      labelEs: d.labelEs,
      labelEn: d.labelEn,
      decomposable: contributionChildren(nodes, d.rowKey).length > 0,
      lifecycle: d.lifecycle,
    })),
  ]
}

/**
 * The selector form of a sociedad's label — R13.R3C.1, the owner-approved
 * DISPLAY names.
 *
 * ── DISPLAY ONLY. IDENTITY IS NEVER DERIVED FROM THIS STRING ───────────────
 *
 * Nothing downstream matches on what this returns. A subject is selected,
 * resolved and decomposed by `rowKey` alone (`resolveSubject`), so this
 * function could return anything at all without moving a single figure. It is
 * called at render time, at the last possible moment, for the pill's text.
 *
 * ── THE NAMES ARE STILL READ OUT OF THE BOOK ───────────────────────────────
 *
 * The owner approved `La Esperanza`, `Naidelt`, `Los Sauzales`, `Retboy`,
 * `Los Laureles`, `Vanglor`, `Proporcional Otras Sociedades` and
 * `Staten Capital`. Every one of them is the SOURCE's own name for the entity
 * with three presentation rules applied — no table of literals, so a sociedad
 * renamed, added or wound up in the book still names itself, and a label typed
 * into this file could never drift from the record:
 *
 *   1 · the row's ROLE word goes. The source writes a sociedad's terminal
 *       total as `TOTAL LA ESPERANZA`; `TOTAL` is the row's grade, not the
 *       entity, and repeating it in every pill of a selector whose options are
 *       all totals says nothing.
 *   2 · a TRAILING PARENTHETICAL QUALIFIER goes: `Staten Capital (1/3)` is
 *       offered as `Staten Capital`. The qualifier describes the share the
 *       book carries, not the entity's name — and it is only the NAME that is
 *       shortened. The figures under the pill remain the source's own rows
 *       verbatim, so the third that is held is still exactly what is reported.
 *   3 · a name the source SHOUTS is set in title case (`LA ESPERANZA` →
 *       `La Esperanza`). Applied only when the label carries no lowercase of
 *       its own, so a name the source already cased — `Los Sauzales`,
 *       `Proporcional Otras Sociedades` — is passed through untouched rather
 *       than re-cased to a house style it never asked for.
 *
 * Each rule is skipped rather than allowed to empty the label: a subject the
 * selector cannot name is worse than one named a little too fully.
 */
export function subjectDisplayLabel(label: string): string {
  const trimmed = label.trim()

  const withoutRole = trimmed.replace(/^\s*total\s+/i, '').trim()
  const named = withoutRole.length > 0 ? withoutRole : trimmed

  const withoutQualifier = named.replace(/\s*\([^()]*\)\s*$/u, '').trim()
  const bare = withoutQualifier.length > 0 ? withoutQualifier : named

  // No lowercase anywhere = the source is shouting, not casing a proper noun.
  return /\p{Ll}/u.test(bare) ? bare : titleCase(bare)
}

/** First letter of every word up, the rest down; punctuation and digits stay. */
function titleCase(value: string): string {
  return value.replace(
    /\p{L}[\p{L}\p{M}'’-]*/gu,
    (word) => word.slice(0, 1).toLocaleUpperCase('es') + word.slice(1).toLocaleLowerCase('es'),
  )
}

/**
 * R13.R3C.2 — the display names for a personal book's sociedad-grain rows,
 * keyed by SOURCE row key, for every surface that shows one of those rows:
 * the subject pills, the chart's bars and x-axis, its tooltip, its
 * accessibility table, the omitted-components footnote and the breakdown
 * popup's heading. One map so a pill and the bar beneath it can never read
 * differently.
 *
 * ── WHY A MAP AND NOT A RULE APPLIED AT THE LEAF ──────────────────────────
 *
 * `subjectDisplayLabel` title-cases a label the source shouts, which is right
 * for `TOTAL LOS LAURELES` and wrong for a shouted brand or acronym deeper in
 * the book (`INRETAIL PERU CORP` → `Inretail Peru Corp`, `HMC` → `Hmc`).
 * Restricting it to the keys in this map confines the rule to exactly the
 * roster the owner named — the sociedades and root named holdings a personal
 * book tiles by — and leaves every other label in the hierarchy the source's
 * own. Main is given no map at all by its callers, so its labels are untouched.
 *
 * The caller resolves the language; the map holds finished strings, so a
 * consumer never re-derives one. Identity is unaffected: these are values in a
 * presentation lookup, and nothing is ever matched BY them.
 */
export function subjectLabelOverrides(
  subjects: readonly PortfolioSubject[],
  lang: string,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of subjects) {
    if (s.key === COMBINED_SUBJECT) continue
    const raw = (lang === 'en' && s.labelEn !== null && s.labelEn.length > 0 ? s.labelEn : s.labelEs) ?? s.key
    out.set(s.key, subjectDisplayLabel(raw))
  }
  return out
}

export type SubjectState =
  /** Two real endpoints and at least one component — the chart can be drawn. */
  | 'ok'
  /** The subject key does not name a row in this publication pair. */
  | 'not_found'
  /** The subject is absent from one endpoint, so an opening value would be a fabricated zero. */
  | 'lifecycle_gap'
  /** Real endpoints, but the source publishes nothing beneath this subject. */
  | 'no_decomposition'
  /** An endpoint value is missing or the two are in different currencies. */
  | 'unavailable'

export interface ResolvedSubject {
  key: string
  /** The source label, verbatim. Null for the combined portfolio. */
  labelEs: string | null
  labelEn: string | null
  openingValue: number | null
  closingValue: number | null
  components: ContributionChild[]
  lifecycle: NodeLifecycle | null
  state: SubjectState
}

/**
 * The subject's own endpoints and its own components, in one place, so no
 * component can pair one subject's headline with another's bars.
 *
 * The combined portfolio reads its endpoints from `TotalMetrics` — the block
 * the publication NUMERICALLY bound its performance figures to, never a row
 * matched by label — and its components from the tiling the caller derived. A
 * sociedad reads both from its own node.
 */
export function resolveSubject(
  nodes: readonly ChangeNode[],
  drivers: readonly ChangeNode[],
  total: TotalMetrics | null,
  key: string,
): ResolvedSubject {
  if (key === COMBINED_SUBJECT) {
    const anchor = total?.totalRowKey != null ? (nodes.find((n) => n.rowKey === total.totalRowKey) ?? null) : null
    const components = drivers.map((node) => ({ node, groupPath: [] as string[] }))
    const openingValue = total?.previousValue ?? null
    const closingValue = total?.currentValue ?? null
    return {
      key,
      labelEs: null,
      labelEn: null,
      openingValue,
      closingValue,
      components,
      lifecycle: anchor?.lifecycle ?? null,
      state: subjectState(anchor?.lifecycle ?? null, openingValue, closingValue, components.length),
    }
  }

  const node = nodes.find((n) => n.rowKey === key) ?? null
  if (node === null) {
    return {
      key,
      labelEs: null,
      labelEn: null,
      openingValue: null,
      closingValue: null,
      components: [],
      lifecycle: null,
      state: 'not_found',
    }
  }
  const components = contributionChildren(nodes, key)
  return {
    key,
    labelEs: node.labelEs,
    labelEn: node.labelEn,
    openingValue: node.previousValue,
    closingValue: node.currentValue,
    components,
    lifecycle: node.lifecycle,
    state: subjectState(node.lifecycle, node.previousValue, node.currentValue, components.length),
  }
}

function subjectState(
  lifecycle: NodeLifecycle | null,
  opening: number | null,
  closing: number | null,
  componentCount: number,
): SubjectState {
  // Checked BEFORE the endpoints, because a lifecycle gap produces two
  // perfectly finite numbers — one of which the source never published.
  if (lifecycle !== null && lifecycle !== 'ongoing') return 'lifecycle_gap'
  if (!Number.isFinite(opening ?? Number.NaN) || !Number.isFinite(closing ?? Number.NaN)) return 'unavailable'
  if (componentCount === 0) return 'no_decomposition'
  return 'ok'
}
