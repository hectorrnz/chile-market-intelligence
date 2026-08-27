// R13.R3C.2 — HOW A CONTRIBUTION IS NAMED ON SCREEN.
//
// PURE MODULE. No React, no Next.js, no Supabase, no clock. It resolves the
// text a component is shown under and composes the omission disclosure, and
// nothing else — the figures themselves come from `contributionChart.ts`.
//
// It lives here rather than in `ContributionChart.tsx` for one reason: these
// two rules are the ones the owner reviews (which name a bar carries, and
// which entities the footnote confesses to leaving out), so they must be
// directly testable rather than asserted through a source-text regex.
//
// ── LABELS ARE DISPLAY, NEVER IDENTITY ────────────────────────────────────
//
// Every consumer selects, resolves, drills and reconciles by `rowKey`. The
// strings this module returns reach the DOM and stop there; nothing is ever
// matched by one. That is what makes an override map safe.

/**
 * Display names for the rows a personal book tiles by, keyed by SOURCE row
 * key — built once per surface by `subjectLabelOverrides` (see
 * `portfolioSubject.ts`) with the language already resolved.
 *
 * Every surface that can show one of those rows reads this same map: the
 * subject pills, the bars, the x-axis, the tooltip, the accessibility table,
 * the omission footnote and the breakdown popup's heading. A pill and the bar
 * beneath it therefore cannot read differently.
 *
 * MAIN IS GIVEN NO MAP. Its components are asset classes and individual
 * holdings whose labels are the source's own; the display rule title-cases a
 * shouted label, which is right for `TOTAL LOS LAURELES` and wrong for a
 * shouted brand (`INRETAIL PERU CORP`). Confining the rule to this map's keys
 * confines it to the roster it was written for.
 */
export type ContributionLabelOverrides = ReadonlyMap<string, string>

/** The bilingual shape every labelled thing in this module shares. */
export interface LabelledRow {
  rowKey?: string | null
  labelEs: string
  labelEn: string | null
}

/**
 * The text one component is shown under: its display name if this surface has
 * one for it, otherwise the source's own label in the reader's language.
 *
 * Falls back to Spanish whenever the English label is absent or empty — the
 * publication is Spanish, and a blank cell would be worse than the untranslated
 * name it actually carries.
 */
export function contributionLabel(
  item: LabelledRow,
  lang: string,
  overrides?: ContributionLabelOverrides,
): string {
  const override =
    overrides !== undefined && item.rowKey !== undefined && item.rowKey !== null
      ? overrides.get(item.rowKey)
      : undefined
  if (override !== undefined) return override
  return lang === 'en' && item.labelEn !== null && item.labelEn.length > 0 ? item.labelEn : item.labelEs
}

/** How many omitted components are named before the rest are counted. */
export const OMITTED_NAME_LIMIT = 6

/**
 * The omitted-components footnote, NAMED.
 *
 * "1 component(s) did not move over this period and are not plotted" told the
 * reader that something had been withheld and refused to say what, which reads
 * as a gap in the data. Naming them turns the same sentence into a finding: a
 * position that did not move over three months is worth knowing about.
 *
 * The names are the source's own, through the same display path as the bars,
 * so the disclosure and the plot can never describe different entities — and
 * nothing is invented for an entity the source did not publish.
 *
 * A long list is capped rather than allowed to run the width of the card, and
 * the overflow is COUNTED, so capping the sentence never quietly shortens the
 * disclosure. Returns null when there is nothing to disclose, so a caller
 * renders no empty line.
 */
export function omittedZeroSentence(
  omitted: readonly LabelledRow[],
  lang: string,
  copy: { template: string; more: string },
  overrides?: ContributionLabelOverrides,
  max = OMITTED_NAME_LIMIT,
): string | null {
  if (omitted.length === 0) return null
  const names = omitted.map((o) => contributionLabel(o, lang, overrides))
  const limit = Math.max(1, max)
  const shown = names.slice(0, limit)
  const rest = names.length - shown.length
  const list = rest > 0 ? `${shown.join(', ')} ${copy.more.replace('{n}', String(rest))}` : shown.join(', ')
  return copy.template.replace('{names}', list)
}
