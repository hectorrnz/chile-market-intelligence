// R13.9 — Alternatives member read model (doc 07 § 7.4, doc 08 Stage 9).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import. The
// API route and the page BOTH call these functions — the server derives the
// published view once, and the client re-derives only when a filter narrows
// it, through the very same code, so the two can never disagree on a number.
//
// FOUR CONTRACT RULES ENFORCED HERE:
//
//   1. `(category, currency)` IS THE GROUPING KEY, AND NO CROSS-CURRENCY TOTAL
//      EXISTS (doc 03 §§ 2.1, 4.2; decision D4). The source's own USD roll-up
//      is `#NAME?` — NMI must not invent one. This module exposes per-group
//      subtotals only; no function here sums across two currencies, and no
//      grand-total helper exists to call.
//
//   2. SUBTOTALS MIRROR THE R13.4 PARSER POLICY (parseAlternatives.ts): sum the
//      available values; a column with NO value in the whole group stays null —
//      never 0. A group summing only SOME holdings additionally reports how
//      many were missing, so the page can disclose partiality instead of
//      presenting a partial sum as complete.
//
//   3. EVENT CLASSIFICATION IS THE PARSER'S, VERBATIM (doc 03 § 3.4). The
//      persisted `event_type` — including `unclassified` — passes through
//      untouched. Nothing here infers a type from the amount's sign, and
//      nothing repeats the colour-matching algorithm.
//
//   4. UNAVAILABLE IS NEVER ZERO (doc 02 § 9). Nulls propagate as nulls.
//
// STATEMENT AGE, NOT A STALENESS VERDICT. Doc 07 § 7.4 requires a "staleness
// indicator" on `Fecha último statement` but commits NO numeric threshold, no
// cadence rule, and no qualitative stale definition (re-verified across docs
// 01–09 in the R13.9 audit). An age is an observation; a "stale" label would
// be a policy judgment this module has no authority to invent — so the
// indicator is the FACT: the statement's age in whole months. The basis is the
// ALTERNATIVES PUBLICATION'S OWN AS-OF DATE, never the viewer's clock, so a
// published revision renders identically whenever it is opened. The age is
// computed calendar-safely from the ISO strings' own components; a date-only
// value never passes through `new Date()` (the R13.7 timezone rule). A row
// carrying the literal `Inversión Inicial` instead of a date shows that label
// verbatim and gets NO fabricated age.
//
// PRESENTATION ORDER IS SEMANTIC, NEVER THE WORKSHEET'S ROW PLACEMENT. No R13
// document commits a presentation order for the Alternatives summary, so the
// source row sequence is an artifact — and the standing R13 rule is that
// presentation must not depend on raw row numbers (a future workbook inserting
// or moving a row must not reshuffle the member view). Groups sort by
// (category, currency label); holdings inside a group by (investment,
// sociedad) — documented dimensions only, no invented business ranking — and
// the timeline breaks every tie deterministically.

/** One published holding, as the member read path returns it. */
export interface AlternativesHoldingRead {
  id: string
  category: string
  /** Normalized source declaration — `dolares` / `euros` / `uf` / `pesos`. */
  currency: string
  investmentName: string
  sociedad: string
  capitalCommitted: number | null
  contributions: number | null
  unfunded: number | null
  lastStatementDate: string | null
  lastStatementLabel: string | null
  lastValuation: number | null
  flowSinceStatement: number | null
  currentValue: number | null
  reportedIrr: number | null
  calculatedIrr: number | null
}

/** One published timeline event. Classification is the parser's, verbatim. */
export interface AlternativesEventRead {
  holdingId: string | null
  eventDate: string
  amount: number
  currency: string
  eventType: string
}

// ---------------------------------------------------------------------------
// Currency display labels
// ---------------------------------------------------------------------------

/**
 * The source declares each category's currency in words (`inversiones en
 * dólares`) and the parser normalizes that to a bare token. These display
 * labels translate the four DOCUMENTED declarations (doc 03 § 2.1) to their
 * conventional codes. An unknown token is shown verbatim, uppercased — never
 * guessed into a code, and never dropped.
 */
const CURRENCY_LABELS: Readonly<Record<string, string>> = {
  dolares: 'USD',
  euros: 'EUR',
  uf: 'UF',
  pesos: 'CLP',
}

export function currencyLabel(raw: string): string {
  return CURRENCY_LABELS[raw] ?? raw.toUpperCase()
}

// ---------------------------------------------------------------------------
// Grouping and per-currency subtotals
// ---------------------------------------------------------------------------

/** A same-currency column sum with disclosed completeness. */
export interface GroupColumnSum {
  /** Sum of the available values; null when NO holding carried one. */
  value: number | null
  /** Holdings whose value was unavailable — 0 means the sum is complete. */
  missing: number
}

export interface AlternativesGroup {
  category: string
  currency: string
  holdings: AlternativesHoldingRead[]
  subtotal: {
    capitalCommitted: GroupColumnSum
    contributions: GroupColumnSum
    unfunded: GroupColumnSum
    currentValue: GroupColumnSum
  }
}

function columnSum(values: ReadonlyArray<number | null>): GroupColumnSum {
  let value: number | null = null
  let missing = 0
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) missing += 1
    else value = (value ?? 0) + v
  }
  return { value, missing }
}

/**
 * Groups holdings by `(category, currency)` in a SEMANTIC, deterministic
 * order: groups by (category, display currency label), holdings inside each
 * group by (investment name, sociedad). Invariant to the source rows' physical
 * placement — the same economic holdings produce the same presentation
 * regardless of how the workbook laid them out or how the transport delivered
 * them.
 */
export function groupHoldings(holdings: readonly AlternativesHoldingRead[]): AlternativesGroup[] {
  const groups: AlternativesGroup[] = []
  const index = new Map<string, AlternativesGroup>()
  for (const h of holdings) {
    // NUL escape as the key separator — the R13.4 precedent: category and
    // currency can both contain spaces, so a space separator could collapse
    // two distinct groups into one.
    const key = `${h.category}\u0000${h.currency}`
    let g = index.get(key)
    if (!g) {
      g = {
        category: h.category,
        currency: h.currency,
        holdings: [],
        subtotal: {
          capitalCommitted: { value: null, missing: 0 },
          contributions: { value: null, missing: 0 },
          unfunded: { value: null, missing: 0 },
          currentValue: { value: null, missing: 0 },
        },
      }
      index.set(key, g)
      groups.push(g)
    }
    g.holdings.push(h)
  }
  for (const g of groups) {
    g.holdings.sort(
      (a, b) =>
        a.investmentName.localeCompare(b.investmentName) || a.sociedad.localeCompare(b.sociedad),
    )
    g.subtotal = {
      capitalCommitted: columnSum(g.holdings.map((h) => h.capitalCommitted)),
      contributions: columnSum(g.holdings.map((h) => h.contributions)),
      unfunded: columnSum(g.holdings.map((h) => h.unfunded)),
      currentValue: columnSum(g.holdings.map((h) => h.currentValue)),
    }
  }
  groups.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      currencyLabel(a.currency).localeCompare(currencyLabel(b.currency)),
  )
  return groups
}

// ---------------------------------------------------------------------------
// Statement age — a FACT, never a verdict (see the module header)
// ---------------------------------------------------------------------------

export interface StatementAge {
  /** Whole calendar months between the statement date and the as-of date. */
  months: number
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Whole-month age of a statement relative to the ALTERNATIVES publication's
 * own as-of date, from the ISO strings' own components (calendar-safe — no
 * `new Date()`, no wall clock; the same published revision ages by its own
 * reference date, not by when someone opens the page). Null when either date
 * is missing or malformed; a statement DATED AFTER the as-of yields 0.
 *
 * Deliberately NO `stale` boolean and NO fresh/aging/stale buckets: the
 * contract requires a staleness indicator but authorizes no threshold, and a
 * normative label would be an invented policy (R13.9 audit).
 */
export function statementAge(
  lastStatementDate: string | null,
  asOfDate: string | null,
): StatementAge | null {
  if (lastStatementDate === null || asOfDate === null) return null
  const s = ISO_DATE.exec(lastStatementDate)
  const a = ISO_DATE.exec(asOfDate)
  if (!s || !a) return null
  let months = (Number(a[1]) - Number(s[1])) * 12 + (Number(a[2]) - Number(s[2]))
  if (Number(a[3]) < Number(s[3])) months -= 1
  if (months < 0) months = 0
  return { months }
}

// ---------------------------------------------------------------------------
// Filters (doc 07 § 7.4: sociedad, category, currency, event type)
// ---------------------------------------------------------------------------

/**
 * The narrowing, one entry per dimension.
 *
 * R13.R4A.5 — EACH DIMENSION IS A SET, AND THE EMPTY SET IS "ALL". Every
 * dimension went from one value to many in this pass, and the representation
 * is the reason the contract is enforceable rather than merely documented:
 *
 *   · OR WITHIN A DIMENSION. `sociedad: ['LA ESPERANZA', 'NAIDELT']` keeps a
 *     row belonging to EITHER. A set is the natural spelling of that.
 *
 *   · AND ACROSS DIMENSIONS. A row must satisfy every dimension that restricts,
 *     so the predicates compose with `&&` exactly as they did when each held a
 *     single value. Widening one dimension can never widen another.
 *
 *   · EMPTY MEANS UNRESTRICTED, and it is the ONLY spelling of "all". The
 *     alternative — a separate `all` flag beside a list — admits two states
 *     (`all` carrying a stale list, and an empty list that is not `all`) which
 *     mean the same thing or nothing at all; the R13.R4A.5 brief names the
 *     second exactly: "an ambiguous empty filter". Here it cannot be built.
 *     Deselecting the last specific value LANDS on `[]`, which IS all; choosing
 *     all writes `[]`, which clears the specifics. Mutual exclusivity is
 *     structural, not a rule every caller has to remember to apply.
 */
export interface AlternativesFilter {
  sociedad: readonly string[]
  category: readonly string[]
  currency: readonly string[]
  eventType: readonly string[]
  /**
   * R13.R4A.1 — calendar years drawn from the events themselves (`YYYY`).
   *
   * Like `eventType`, this narrows EVENTS ONLY and never holdings: a year in
   * which a fund recorded no movement says nothing about whether the position
   * exists, and dropping the holding would turn "no flow this year" into "no
   * investment" — the exact conflation the coverage note exists to prevent.
   */
  year: readonly string[]
}

export const EMPTY_FILTER: AlternativesFilter = {
  sociedad: [],
  category: [],
  currency: [],
  eventType: [],
  year: [],
}

/**
 * Does `value` survive one dimension's selection? Empty admits everything —
 * the single place the "empty means all" rule is spelled, so every predicate
 * below reads the same way and none of them can drift apart.
 */
export function matchesSelection(value: string, selection: readonly string[]): boolean {
  return selection.length === 0 || selection.includes(value)
}

/** True when ANY dimension restricts — i.e. the view is not the whole book. */
export function isFilterActive(filter: AlternativesFilter): boolean {
  return (
    filter.sociedad.length > 0 ||
    filter.category.length > 0 ||
    filter.currency.length > 0 ||
    filter.eventType.length > 0 ||
    filter.year.length > 0
  )
}

/**
 * Add or remove one value from a dimension's selection.
 *
 * THE RESULT IS ALWAYS A SUBSEQUENCE OF `options`, never insertion-ordered.
 * The selection is a set, so its order is invisible to the filter predicates —
 * but it is NOT invisible to a reader: the closed control names the single
 * selected value, and the checklist reads top to bottom. Rebuilding from
 * `options` makes the selection carry the module's own documented ordering
 * (alphabetical for sociedades and categories, label order for currencies,
 * legend order for event types, newest-first for years) whatever route it took
 * to get there, so the same set always renders identically.
 *
 * Removing the last value yields `[]` — which IS "all", per the interface note
 * above. That is the brief's "return to All rather than an ambiguous empty
 * filter", and it needs no special case here because there is no other empty.
 *
 * A value absent from `options` is dropped rather than added: options come
 * from the source's own present values, so a value outside them can only be
 * stale state, and admitting it would restrict a dimension to something no row
 * can match — an empty view with no visible cause.
 */
export function toggleSelection(
  current: readonly string[],
  value: string,
  options: readonly string[],
): string[] {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return options.filter((o) => next.has(o))
}

export interface FilterOptions {
  sociedades: string[]
  categories: string[]
  currencies: string[]
  eventTypes: string[]
  /**
   * Years the source actually records, NEWEST FIRST — never a generated range
   * between two endpoints, so a year with no recorded movement anywhere never
   * appears as a selectable period that would then render as an empty view.
   */
  years: string[]
}

/**
 * The persisted event-type vocabulary in its legend order (doc 03 § 3.2) —
 * mirrors `eventPresentation.ts`'s ALT_EVENT_TYPES (asserted equal in tests;
 * duplicated here so the pure model stays dependency-free).
 */
const EVENT_TYPE_ORDER = ['aporte', 'dividendo', 'distribucion', 'unclassified'] as const

/**
 * Distinct filter values actually present, deterministically ordered:
 * alphabetically for sociedades/categories/currencies, legend order for event
 * types — never the source rows' physical order.
 */
export function filterOptions(
  holdings: readonly AlternativesHoldingRead[],
  events: readonly AlternativesEventRead[],
): FilterOptions {
  const sorted = (values: readonly string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b))
  const present = new Set(events.map((e) => e.eventType))
  const known = EVENT_TYPE_ORDER.filter((t) => present.has(t))
  const unknown = sorted([...present].filter((t) => !(EVENT_TYPE_ORDER as readonly string[]).includes(t)))
  return {
    sociedades: sorted(holdings.map((h) => h.sociedad)),
    categories: sorted(holdings.map((h) => h.category)),
    currencies: [...new Set(holdings.map((h) => h.currency))].sort((a, b) =>
      currencyLabel(a).localeCompare(currencyLabel(b)),
    ),
    eventTypes: [...known, ...unknown],
    // Descending: the most recent period is the one a reader reaches for, and
    // it must be the first thing under the "all" option rather than the last.
    years: [...new Set(events.map((e) => e.eventDate.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
  }
}

/** Holdings surviving the filter. `eventType` never filters holdings. */
export function applyHoldingFilter(
  holdings: readonly AlternativesHoldingRead[],
  filter: AlternativesFilter,
): AlternativesHoldingRead[] {
  return holdings.filter(
    (h) =>
      matchesSelection(h.sociedad, filter.sociedad) &&
      matchesSelection(h.category, filter.category) &&
      matchesSelection(h.currency, filter.currency),
  )
}

/**
 * Events surviving the filter. Sociedad and category are properties of the
 * HOLDING an event belongs to, so they resolve through the event's own
 * `holdingId` — never through a name match. An event whose holding link is
 * missing survives only the event-type and currency dimensions; a sociedad or
 * category filter honestly excludes it rather than guessing its owner.
 */
export function applyEventFilter(
  events: readonly AlternativesEventRead[],
  holdings: readonly AlternativesHoldingRead[],
  filter: AlternativesFilter,
): AlternativesEventRead[] {
  const byId = new Map(holdings.map((h) => [h.id, h]))
  return events.filter((e) => {
    if (!matchesSelection(e.eventType, filter.eventType)) return false
    if (!matchesSelection(e.currency, filter.currency)) return false
    // The year comes off the ISO string's own components — never `new Date()`,
    // which would reinterpret a date-only value in the viewer's timezone and
    // could move a 1 January event into the previous year (the R13.7 rule).
    if (!matchesSelection(e.eventDate.slice(0, 4), filter.year)) return false
    if (filter.sociedad.length > 0 || filter.category.length > 0) {
      const h = e.holdingId !== null ? (byId.get(e.holdingId) ?? null) : null
      if (h === null) return false
      if (!matchesSelection(h.sociedad, filter.sociedad)) return false
      if (!matchesSelection(h.category, filter.category)) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Event timeline
// ---------------------------------------------------------------------------

export interface TimelineEvent extends AlternativesEventRead {
  investmentName: string | null
  sociedad: string | null
}

export interface TimelineMonth {
  /** `YYYY-MM`, taken from the event dates' own components. */
  month: string
  events: TimelineEvent[]
}

/**
 * The event history, newest month first; within a month, newest date first,
 * every remaining tie broken deterministically (investment, sociedad, type,
 * amount) so the order never depends on transport or source-row placement.
 * Investment and sociedad resolve through the holding link and stay null —
 * displayed as an honest unknown — when the link is absent.
 */
export function buildTimeline(
  events: readonly AlternativesEventRead[],
  holdings: readonly AlternativesHoldingRead[],
): TimelineMonth[] {
  const byId = new Map(holdings.map((h) => [h.id, h]))
  const enriched: TimelineEvent[] = events.map((e) => {
    const h = e.holdingId !== null ? (byId.get(e.holdingId) ?? null) : null
    return { ...e, investmentName: h?.investmentName ?? null, sociedad: h?.sociedad ?? null }
  })
  enriched.sort(
    (a, b) =>
      b.eventDate.localeCompare(a.eventDate) ||
      (a.investmentName ?? '').localeCompare(b.investmentName ?? '') ||
      (a.sociedad ?? '').localeCompare(b.sociedad ?? '') ||
      a.eventType.localeCompare(b.eventType) ||
      a.amount - b.amount,
  )
  const months: TimelineMonth[] = []
  for (const e of enriched) {
    const month = e.eventDate.slice(0, 7)
    const last = months[months.length - 1]
    if (last && last.month === month) last.events.push(e)
    else months.push({ month, events: [e] })
  }
  return months
}

/** Event counts per persisted type — `unclassified` included, never folded. */
export function summarizeEvents(
  events: readonly AlternativesEventRead[],
): { total: number; byType: Record<string, number>; unclassified: number } {
  const byType: Record<string, number> = {}
  for (const e of events) byType[e.eventType] = (byType[e.eventType] ?? 0) + 1
  return { total: events.length, byType, unclassified: byType['unclassified'] ?? 0 }
}

// ===========================================================================
// R13.R4A · LP POSITION AND CASH-FLOW SUMMARIES
// ===========================================================================
//
// The Dashboard's figures. Three rules govern every function below, and the
// first two are the reason the third exists.
//
// 1 · CURRENCY IS THE AGGREGATION CEILING. Every summary here is keyed by
//     currency and no function sums across two of them — the same prohibition
//     `groupHoldings` already enforces (doc 03 § 4.2, decision D4). The source's
//     own USD roll-up is `#NAME?`; NMI has no approved FX basis and must not
//     invent one.
//
// 2 · THE MASTER-DATA BLOCK AND THE EVENT TIMELINE ARE DIFFERENT BASES, AND
//     THEY DO NOT RECONCILE. Measured on the real workbook during the R13.R4A
//     audit: comparing each holding's summed `aporte` magnitude against its
//     `Contributions` column, only **18 of the 34 comparable holdings agree
//     within 0.5%** — 15 diverge, several materially (one by 212%), 1 carries
//     contributions with no timeline event at all, and 3 holdings have no
//     events whatsoever. The timeline is a record of OBSERVED cash movements
//     over its own window (2018-10 → 2026-07); the `Contributions` column is
//     the position's contributed-capital figure, which predates that window for
//     older funds. Neither is wrong; they answer different questions.
//
// 3 · THEREFORE: NO RATIO SPANS THE TWO. `distributions` lives only in the
//     timeline and `contributions` only in the master data, so DPI, TVPI, RVPI
//     and MOIC — every one of which divides one by the other — cannot be formed
//     honestly from this source and are NOT computed anywhere in this module.
//     This is an empirical finding, not a stylistic preference: a DPI built
//     from these two columns would be wrong for 15 of 34 holdings. IRR is
//     likewise never computed — the two IRR columns are cached SOURCE values
//     (doc 03 § 4.1) that pass through untouched.
//
// UNAVAILABLE IS NEVER ZERO, exactly as in `columnSum` above: a column no
// holding carries stays null and reports how many rows were missing, so the
// page can disclose partiality instead of printing a partial sum as complete.

/**
 * One currency's whole alternatives position. Counts are of DISTINCT things —
 * a fund held by four sociedades is one investment and four holdings, and
 * conflating them would overstate the book's breadth fourfold.
 */
export interface CurrencyPosition {
  currency: string
  /** Distinct fund/investment names. */
  investments: number
  /** Rows at the (investment × sociedad) grain — the table's own count. */
  holdings: number
  /** Distinct owning sociedades. */
  sociedades: number
  /** Categories present, alphabetically — never a synthetic "other". */
  categories: string[]
  commitments: GroupColumnSum
  contributions: GroupColumnSum
  unfunded: GroupColumnSum
  currentValue: GroupColumnSum
}

/**
 * Per-currency position summaries. One entry per currency actually present; a
 * currency with no holdings never appears as an empty shell.
 *
 * ORDER IS BY HOLDING COUNT, descending, then by display label — and the
 * distinction matters. A count is a NON-MONETARY dimension: it compares how
 * much of the book is denominated in each currency without comparing two
 * amounts, so it implies no exchange rate and no cross-currency total. Sorting
 * by value would require exactly the FX basis this module refuses to invent
 * (rule 1 above); sorting alphabetically would bury the currency carrying most
 * of the book beneath three that carry a handful of rows. The label breaks
 * every tie, so the order is fully deterministic.
 */
export function currencyPositions(
  holdings: readonly AlternativesHoldingRead[],
): CurrencyPosition[] {
  const byCurrency = new Map<string, AlternativesHoldingRead[]>()
  for (const h of holdings) {
    const list = byCurrency.get(h.currency)
    if (list) list.push(h)
    else byCurrency.set(h.currency, [h])
  }
  const out: CurrencyPosition[] = []
  for (const [currency, rows] of byCurrency) {
    out.push({
      currency,
      investments: new Set(rows.map((h) => h.investmentName)).size,
      holdings: rows.length,
      sociedades: new Set(rows.map((h) => h.sociedad)).size,
      categories: [...new Set(rows.map((h) => h.category))].sort((a, b) => a.localeCompare(b)),
      commitments: columnSum(rows.map((h) => h.capitalCommitted)),
      contributions: columnSum(rows.map((h) => h.contributions)),
      unfunded: columnSum(rows.map((h) => h.unfunded)),
      currentValue: columnSum(rows.map((h) => h.currentValue)),
    })
  }
  out.sort(
    (a, b) =>
      b.holdings - a.holdings ||
      currencyLabel(a.currency).localeCompare(currencyLabel(b.currency)),
  )
  return out
}

/**
 * How much of a currency's committed capital has been drawn.
 *
 * BOTH OPERANDS COME FROM THE SAME MASTER-DATA ROW SET, and that is the whole
 * point of this function existing instead of dividing the two column subtotals.
 * `commitments` is populated on a different set of holdings than
 * `contributions` (measured on the real workbook: for USD, 37 of 38 rows carry
 * a commitment but only 34 carry a contribution), so
 * `contributions.value / commitments.value` would divide a numerator and a
 * denominator drawn from different populations and present the result as a
 * percentage — the single place where partiality does the most damage, because
 * a ratio hides the row counts a subtotal at least discloses.
 *
 * So the ratio is defined over the holdings that report BOTH, and the count it
 * was computed across is returned alongside it. `ofHoldings` is that currency's
 * full row count, so the page can say "across 34 of 38" whenever the two
 * differ, and say nothing when they do not.
 *
 * Null when no holding reports both, or when the committed base is not
 * positive — never a fabricated 0% and never a division by zero.
 */
export interface CommitmentDrawn {
  /** Committed capital across the holdings reporting both figures. */
  committed: number
  /** Contributed capital across those same holdings. */
  contributed: number
  /** `contributed / committed` — a ratio, not a percentage. */
  ratio: number
  /**
   * Holdings the ratio was COMPUTED ACROSS — never "holdings that are drawn".
   *
   * R13.R4A.2: presented bare as "34/38 holdings" under a heading reading
   * "Commitment drawn", this was read as 34 drawn and 4 undrawn, which it is
   * not. It is a completeness figure about the CALCULATION: 34 of the 38 rows
   * reported both operands, so 4 could not participate. Whether a holding is
   * drawn is a different question, answered by a different column
   * (`undrawnCommitments`) over a different — measurably different — set of
   * rows: on the real workbook the ratio excludes 4 rows and the unfunded
   * column is missing on 6, and only ONE row is in both. Any presentation of
   * this number must say what it is a count OF.
   */
  holdings: number
  /** Holdings in the currency altogether — equal to `holdings` when complete. */
  ofHoldings: number
}

export function commitmentDrawn(
  holdings: readonly AlternativesHoldingRead[],
  currency: string,
): CommitmentDrawn | null {
  const rows = holdings.filter((h) => h.currency === currency)
  let committed = 0
  let contributed = 0
  let counted = 0
  for (const h of rows) {
    if (
      h.capitalCommitted === null ||
      h.contributions === null ||
      !Number.isFinite(h.capitalCommitted) ||
      !Number.isFinite(h.contributions)
    ) {
      continue
    }
    committed += h.capitalCommitted
    contributed += h.contributions
    counted += 1
  }
  if (counted === 0 || committed <= 0) return null
  return { committed, contributed, ratio: contributed / committed, holdings: counted, ofHoldings: rows.length }
}

/**
 * One currency's observed cash flow, FROM THE EVENT TIMELINE ONLY.
 *
 * Amounts keep the SOURCE'S OWN SIGNS verbatim (doc 03 § 3.3): `aporte` is
 * negative — cash out to the fund — and `dividendo`/`distribucion` positive.
 * Nothing here flips a sign to make a figure read more like a conventional LP
 * statement; the presentation layer labels the direction, the data keeps the
 * accounting meaning.
 *
 * `unclassified` is carried as its OWN figure and is deliberately excluded
 * from `net`: an event whose source colour did not resolve has no direction
 * yet, and folding it into either side would invent the very classification
 * the parser refused to guess (doc 03 § 3.4).
 */
export interface CurrencyCashFlow {
  currency: string
  /** Sum of `aporte` amounts — negative, as the source records them. */
  calls: { amount: number; count: number }
  /** Sum of `dividendo` + `distribucion` — positive. */
  distributions: { amount: number; count: number }
  /** Neither a call nor a distribution until an administrator classifies it. */
  unclassified: { amount: number; count: number }
  /** `calls + distributions`. Excludes unclassified, by design. */
  net: number
  /** Coverage of this currency's own events — `null` when it has none. */
  firstEvent: string | null
  lastEvent: string | null
}

const DISTRIBUTION_TYPES = new Set(['dividendo', 'distribucion'])

export function currencyCashFlows(
  events: readonly AlternativesEventRead[],
): CurrencyCashFlow[] {
  const byCurrency = new Map<string, CurrencyCashFlow>()
  for (const e of events) {
    let c = byCurrency.get(e.currency)
    if (!c) {
      c = {
        currency: e.currency,
        calls: { amount: 0, count: 0 },
        distributions: { amount: 0, count: 0 },
        unclassified: { amount: 0, count: 0 },
        net: 0,
        firstEvent: null,
        lastEvent: null,
      }
      byCurrency.set(e.currency, c)
    }
    if (!Number.isFinite(e.amount)) continue
    if (e.eventType === 'aporte') {
      c.calls.amount += e.amount
      c.calls.count += 1
    } else if (DISTRIBUTION_TYPES.has(e.eventType)) {
      c.distributions.amount += e.amount
      c.distributions.count += 1
    } else {
      c.unclassified.amount += e.amount
      c.unclassified.count += 1
    }
    if (c.firstEvent === null || e.eventDate < c.firstEvent) c.firstEvent = e.eventDate
    if (c.lastEvent === null || e.eventDate > c.lastEvent) c.lastEvent = e.eventDate
  }
  const out = [...byCurrency.values()]
  for (const c of out) c.net = c.calls.amount + c.distributions.amount
  // Same non-monetary rule as `currencyPositions`: by how many events the
  // record holds, never by how large the amounts are.
  const eventCount = (c: CurrencyCashFlow) =>
    c.calls.count + c.distributions.count + c.unclassified.count
  out.sort(
    (a, b) =>
      eventCount(b) - eventCount(a) ||
      currencyLabel(a.currency).localeCompare(currencyLabel(b.currency)),
  )
  return out
}

/** One calendar year of one currency's observed flow. Signs are the source's. */
export interface AnnualCashFlow {
  /** `YYYY`, read off the event date's own components — never `new Date()`. */
  year: string
  calls: number
  distributions: number
  unclassified: number
  /** `calls + distributions`; unclassified is excluded, as in `CurrencyCashFlow`. */
  net: number
  /**
   * Signed sum per PERSISTED event type, so a chart can draw one segment per
   * legend colour instead of painting `dividendo` and `distribucion` — two
   * distinct source classifications — in a single invented "distributions"
   * colour that belongs to neither.
   */
  byType: Record<string, number>
}

export interface CurrencyAnnualCashFlow {
  currency: string
  years: AnnualCashFlow[]
}

/**
 * Per-currency annual flow, oldest year first, with NO gap-filling: a year in
 * which nothing happened simply does not appear. Inventing a zero row for a
 * silent year would assert the source observed that year and found nothing,
 * which is a different claim from having no record of it.
 */
export function annualCashFlows(
  events: readonly AlternativesEventRead[],
): CurrencyAnnualCashFlow[] {
  const byCurrency = new Map<string, Map<string, AnnualCashFlow>>()
  for (const e of events) {
    if (!Number.isFinite(e.amount)) continue
    const year = e.eventDate.slice(0, 4)
    let years = byCurrency.get(e.currency)
    if (!years) {
      years = new Map()
      byCurrency.set(e.currency, years)
    }
    let y = years.get(year)
    if (!y) {
      y = { year, calls: 0, distributions: 0, unclassified: 0, net: 0, byType: {} }
      years.set(year, y)
    }
    if (e.eventType === 'aporte') y.calls += e.amount
    else if (DISTRIBUTION_TYPES.has(e.eventType)) y.distributions += e.amount
    else y.unclassified += e.amount
    y.byType[e.eventType] = (y.byType[e.eventType] ?? 0) + e.amount
  }
  const out: CurrencyAnnualCashFlow[] = []
  for (const [currency, years] of byCurrency) {
    const list = [...years.values()].sort((a, b) => a.year.localeCompare(b.year))
    for (const y of list) y.net = y.calls + y.distributions
    out.push({ currency, years: list })
  }
  out.sort(
    (a, b) =>
      b.years.length - a.years.length ||
      currencyLabel(a.currency).localeCompare(currencyLabel(b.currency)),
  )
  return out
}

/**
 * The newest `limit` events, holding-resolved, newest first — the Dashboard's
 * "recent activity" strip. Reuses `buildTimeline`'s ordering rather than
 * re-sorting, so the strip and the Cash Flows page can never disagree about
 * which event is the most recent.
 */
export function recentEvents(
  events: readonly AlternativesEventRead[],
  holdings: readonly AlternativesHoldingRead[],
  limit: number,
): TimelineEvent[] {
  if (limit <= 0) return []
  const out: TimelineEvent[] = []
  for (const month of buildTimeline(events, holdings)) {
    for (const e of month.events) {
      out.push(e)
      if (out.length === limit) return out
    }
  }
  return out
}

/**
 * How much of the book the event timeline actually covers — the honest
 * disclosure that rule 2 above demands.
 *
 * A holding with no events is NOT an error and NOT a zero: the workbook's
 * timeline opens in 2018-10, so a fund whose capital was called before that
 * window has a real position and no recorded flow. The Dashboard states this
 * count rather than letting a distributions figure imply full coverage.
 */
export interface TimelineCoverage {
  holdings: number
  holdingsWithEvents: number
  /** Holdings carrying no timeline event at all. */
  holdingsWithoutEvents: number
  /** Earliest and latest event dates across the whole publication. */
  firstEvent: string | null
  lastEvent: string | null
}

export function timelineCoverage(
  holdings: readonly AlternativesHoldingRead[],
  events: readonly AlternativesEventRead[],
): TimelineCoverage {
  const linked = new Set<string>()
  let firstEvent: string | null = null
  let lastEvent: string | null = null
  for (const e of events) {
    if (e.holdingId !== null) linked.add(e.holdingId)
    if (firstEvent === null || e.eventDate < firstEvent) firstEvent = e.eventDate
    if (lastEvent === null || e.eventDate > lastEvent) lastEvent = e.eventDate
  }
  const withEvents = holdings.filter((h) => linked.has(h.id)).length
  return {
    holdings: holdings.length,
    holdingsWithEvents: withEvents,
    holdingsWithoutEvents: holdings.length - withEvents,
    firstEvent,
    lastEvent,
  }
}

// ===========================================================================
// R13.R4A.1 · PERIOD SELECTION, MONTHLY AGGREGATION, AND THE TWO DRILL-DOWNS
// ===========================================================================
//
// Everything below serves an INTERACTION — a year selector, a clickable
// column, an inspectable list — and every one of them is bounded by the same
// three rules the R13.R4A block above established. Currency is still the
// aggregation ceiling; the master-data block and the event timeline are still
// different bases; no ratio still spans them.
//
// TWO ADDITIONAL RULES GOVERN A PERIOD:
//
// A · A SELECTABLE PERIOD IS ONE THE SOURCE RECORDS. Years come from the event
//     dates themselves, never from a generated range between two endpoints —
//     so the dropdown can never offer a year that resolves to an empty view,
//     and a gap year in the record stays visible as an absence instead of being
//     papered over with a selectable empty period.
//
// B · A ZERO IS ONLY HONEST INSIDE THE OBSERVED WINDOW. `annualCashFlows`
//     deliberately does not gap-fill, because a year outside the timeline's
//     window was never observed at all. A MONTH is different, and only in one
//     specific case: inside a currency's own recorded window the source carries
//     a strictly-monthly grid (doc 03 § 3.1), so a month with no row genuinely
//     means "recorded, nothing moved" — a fact, not an absence of record. Month
//     columns are therefore emitted contiguously but ONLY across the
//     intersection of the requested year with that currency's own window, and
//     each carries `hasEvents` so the presentation states which of the two it
//     is instead of printing a bare 0 for both.
//
// EVERY PERIOD KEY IS A PREFIX OF AN ISO DATE — `2024` or `2024-03` — matched
// by string comparison on the date's own characters. No `new Date()` anywhere
// in this section: parsing a date-only value would reinterpret it in the
// viewer's timezone and could move a 1 January event into the previous year
// (the R13.7 timezone rule).

/** Years the given events record, newest first. Never a generated range. */
export function cashFlowYears(
  events: readonly AlternativesEventRead[],
  currency?: string,
): string[] {
  const years = new Set<string>()
  for (const e of events) {
    if (currency !== undefined && e.currency !== currency) continue
    years.add(e.eventDate.slice(0, 4))
  }
  return [...years].sort((a, b) => b.localeCompare(a))
}

/**
 * Events falling inside a period. `period` is an ISO-date PREFIX — `'2024'`
 * for a year, `'2024-03'` for a month — and `null` means every period, so a
 * caller can pass its selection straight through without branching.
 */
export function eventsInPeriod(
  events: readonly AlternativesEventRead[],
  period: string | null,
): AlternativesEventRead[] {
  if (period === null) return [...events]
  return events.filter((e) => e.eventDate.startsWith(period))
}

/**
 * R13.R4A.5 — events falling inside ANY of several periods. The set sibling of
 * `eventsInPeriod`, and the same "empty means all" convention the filter uses,
 * so a caller passes its year selection straight through without branching on
 * whether one, several or no years are chosen.
 *
 * This exists so THE FIGURE AND THE CHART CANNOT DISAGREE. The brief requires
 * the observed cash-flow figures to use "exactly the same selected-year set as
 * the chart and drilldown"; the only way to guarantee that is for both to
 * derive from one scoping function over one selection, rather than each
 * re-deriving a window from the same state and being trusted to agree.
 */
export function eventsInPeriods(
  events: readonly AlternativesEventRead[],
  periods: readonly string[],
): AlternativesEventRead[] {
  if (periods.length === 0) return [...events]
  return events.filter((e) => periods.some((p) => e.eventDate.startsWith(p)))
}

/**
 * One column of a cash-flow chart. The SAME shape at both granularities, which
 * is the point: one chart component renders a year axis and a month axis, and
 * one drill-down contract (`period`) covers a click on either.
 */
export interface PeriodColumn {
  /** `YYYY` or `YYYY-MM` — also the drill-down key. */
  period: string
  unit: 'year' | 'month'
  calls: number
  distributions: number
  unclassified: number
  /** `calls + distributions`; unclassified is excluded, as everywhere else. */
  net: number
  /** Signed sum per PERSISTED event type — one segment per legend colour. */
  byType: Record<string, number>
  /** How many source events this column sums. 0 means nothing was recorded. */
  events: number
  /**
   * False means the source records no movement in this period. Only ever false
   * inside the observed window (rule B), so the presentation can honestly say
   * "nothing moved" rather than printing a 0 that might mean "not observed".
   */
  hasEvents: boolean
}

/** A `YYYY-MM` shifted by n months, on the string's own components. */
function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const zero = y * 12 + (m - 1) + delta
  const yy = Math.floor(zero / 12)
  const mm = (zero % 12) + 1
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`
}

function emptyColumn(period: string, unit: 'year' | 'month'): PeriodColumn {
  return {
    period,
    unit,
    calls: 0,
    distributions: 0,
    unclassified: 0,
    net: 0,
    byType: {},
    events: 0,
    hasEvents: false,
  }
}

function accumulate(column: PeriodColumn, e: AlternativesEventRead): void {
  if (!Number.isFinite(e.amount)) return
  if (e.eventType === 'aporte') column.calls += e.amount
  else if (DISTRIBUTION_TYPES.has(e.eventType)) column.distributions += e.amount
  else column.unclassified += e.amount
  column.byType[e.eventType] = (column.byType[e.eventType] ?? 0) + e.amount
  column.events += 1
  column.hasEvents = true
  column.net = column.calls + column.distributions
}

/**
 * The columns for ONE currency's cash-flow chart, oldest period first.
 *
 * NO YEARS (the empty set — "all") gives ONE COLUMN PER YEAR the source
 * records, with no gap year invented (the `annualCashFlows` rule: a silent
 * year outside the record is not an observed zero). This is the deliberate
 * answer to "all periods": months across eight years would be ~94 hairline
 * columns in a dashboard card, which is a faithful axis nobody can read. A
 * year is the next unit up, it is the same aggregation the module already
 * publishes, and — because both granularities share `PeriodColumn` — a click
 * on a year column drills through the very same contract as a click on a month.
 *
 * EXACTLY ONE YEAR gives ONE COLUMN PER MONTH, contiguous, bounded by the
 * intersection of that calendar year with this currency's own recorded window
 * (rule B). So selecting the year the timeline opens in yields only the months
 * from that opening onward, never twelve columns of which nine are fabricated
 * blanks.
 *
 * SEVERAL YEARS (R13.R4A.5) gives ONE COLUMN PER SELECTED YEAR — annual again,
 * not months. Months across a multi-year selection would be the misleading
 * shape the brief rules out: with 2020 and 2024 chosen, a continuous monthly
 * axis either invents the three years between them or, worse, butts December
 * 2020 against January 2024 as though they were adjacent months. Annual
 * columns state exactly what was selected and nothing else.
 *
 * A SELECTED YEAR THIS CURRENCY DOES NOT RECORD produces NO column rather than
 * a zero one — the same rule as the all-years case, applied to a narrower set.
 * The Dashboard's selector only offers years the currency records, so this is a
 * defensive path; it matters because an invented 0 column is indistinguishable
 * from an observed one, and only one of them is a fact.
 *
 * Always empty when the currency has no events at all — never a row of zeros.
 */
export function periodColumns(
  events: readonly AlternativesEventRead[],
  currency: string,
  years: readonly string[],
): PeriodColumn[] {
  const own = events.filter((e) => e.currency === currency && Number.isFinite(e.amount))
  if (own.length === 0) return []

  if (years.length !== 1) {
    const wanted = years.length === 0 ? null : new Set(years)
    const byYear = new Map<string, PeriodColumn>()
    for (const e of own) {
      const key = e.eventDate.slice(0, 4)
      if (wanted !== null && !wanted.has(key)) continue
      let col = byYear.get(key)
      if (!col) {
        col = emptyColumn(key, 'year')
        byYear.set(key, col)
      }
      accumulate(col, e)
    }
    return [...byYear.values()].sort((a, b) => a.period.localeCompare(b.period))
  }

  const year = years[0]
  // This currency's own observed window, in months.
  let firstMonth = own[0].eventDate.slice(0, 7)
  let lastMonth = firstMonth
  for (const e of own) {
    const m = e.eventDate.slice(0, 7)
    if (m < firstMonth) firstMonth = m
    if (m > lastMonth) lastMonth = m
  }
  const from = `${year}-01` > firstMonth ? `${year}-01` : firstMonth
  const to = `${year}-12` < lastMonth ? `${year}-12` : lastMonth
  if (from > to) return []

  const columns = new Map<string, PeriodColumn>()
  for (let m = from; m <= to; m = shiftMonth(m, 1)) columns.set(m, emptyColumn(m, 'month'))
  for (const e of own) {
    const col = columns.get(e.eventDate.slice(0, 7))
    if (col) accumulate(col, e)
  }
  return [...columns.values()]
}

/**
 * What a single period's flow was actually made of — the drill-down behind a
 * clicked column.
 *
 * Every row is a REAL SOURCE EVENT resolved to its holding, so a period the
 * source has no events for yields an empty list rather than a placeholder row.
 * Ordering and holding resolution both come from `buildTimeline`, and the
 * subtotals from `currencyCashFlows`, so a breakdown can never disagree with
 * the ledger or the card it was opened from.
 */
export interface PeriodBreakdown {
  period: string
  currency: string
  /** Newest first, every remaining tie broken deterministically. */
  events: TimelineEvent[]
  calls: { amount: number; count: number }
  distributions: { amount: number; count: number }
  unclassified: { amount: number; count: number }
  net: number
}

export function periodBreakdown(
  events: readonly AlternativesEventRead[],
  holdings: readonly AlternativesHoldingRead[],
  currency: string,
  period: string,
): PeriodBreakdown {
  const scoped = eventsInPeriod(
    events.filter((e) => e.currency === currency),
    period,
  )
  const ordered = buildTimeline(scoped, holdings).flatMap((m) => m.events)
  const totals = currencyCashFlows(scoped)[0] ?? null
  return {
    period,
    currency,
    events: ordered,
    calls: totals?.calls ?? { amount: 0, count: 0 },
    distributions: totals?.distributions ?? { amount: 0, count: 0 },
    unclassified: totals?.unclassified ?? { amount: 0, count: 0 },
    net: totals?.net ?? 0,
  }
}

/**
 * The holdings whose commitment is NOT yet fully drawn — the inspection behind
 * the commitment-drawn figure.
 *
 * "NOT DRAWN" IS THE SOURCE'S OWN COLUMN, NOT A DERIVATION. The workbook
 * publishes `Unfunded` per holding (doc 03 § 4.1) and this function reads it
 * verbatim: a positive figure lists, zero or less is fully drawn (a commitment
 * can be over-drawn), and a MISSING figure is neither — it is counted and
 * disclosed, never reconstructed as `committed − contributed`. Deriving it
 * would silently invent an amount for the rows the source declined to state,
 * and would do so in the one place a reader is looking for what remains to be
 * paid.
 *
 * `listedTotal` sums ONLY the listed rows and is deliberately its own figure
 * rather than the position card's `unfunded` subtotal: that subtotal includes
 * every row carrying the column, zeros and any negatives alike, so the two can
 * legitimately differ and must not be presented as the same number. Both are
 * same-currency sums — no cross-currency total exists here either.
 */
export interface UndrawnHolding {
  id: string
  investmentName: string
  sociedad: string
  category: string
  capitalCommitted: number | null
  contributions: number | null
  /** The source's own unfunded figure, always greater than 0 for a listed row. */
  unfunded: number
}

/**
 * A holding the source reports NO unfunded figure for — neither drawn nor
 * undrawn, and deliberately carrying no `unfunded` field at all, so nothing
 * downstream can read a number off it.
 *
 * These rows are NAMED rather than merely counted (R13.R4A.2) because "6 not
 * reported" invites the reader to assume the six are like the others, and they
 * are not: measured on the real workbook, deriving `committed − contributions`
 * for them would have invented 274.920,07, 34.364 and 41.236,61 for three
 * OneValley rows and — worse — a 0 for two V0 Fund rows, which would have
 * classified them as FULLY DRAWN on a figure the source never stated.
 */
export interface UnreportedUnfundedHolding {
  id: string
  investmentName: string
  sociedad: string
  category: string
  capitalCommitted: number | null
  contributions: number | null
}

export interface UndrawnCommitment {
  currency: string
  /** Largest remaining commitment first, then investment, then sociedad. */
  holdings: UndrawnHolding[]
  /** Sum of the LISTED rows' unfunded amounts — same currency, always. */
  listedTotal: number
  /** Rows whose unfunded figure the source does not carry — always `unreported.length`. */
  unavailable: number
  /** Those same rows, named, in (investment, sociedad) order. */
  unreported: UnreportedUnfundedHolding[]
  /** Rows reporting an unfunded figure of zero or less. */
  fullyDrawn: number
  /**
   * Rows in this currency altogether. The three categories above PARTITION it
   * exactly — `holdings.length + fullyDrawn + unavailable === ofHoldings` — so
   * a presentation can show all three and let the reader verify the total.
   */
  ofHoldings: number
}

export function undrawnCommitments(
  holdings: readonly AlternativesHoldingRead[],
  currency: string,
): UndrawnCommitment {
  const rows = holdings.filter((h) => h.currency === currency)
  const listed: UndrawnHolding[] = []
  const unreported: UnreportedUnfundedHolding[] = []
  let fullyDrawn = 0
  for (const h of rows) {
    if (h.unfunded === null || !Number.isFinite(h.unfunded)) {
      unreported.push({
        id: h.id,
        investmentName: h.investmentName,
        sociedad: h.sociedad,
        category: h.category,
        capitalCommitted: h.capitalCommitted,
        contributions: h.contributions,
      })
      continue
    }
    if (h.unfunded <= 0) {
      fullyDrawn += 1
      continue
    }
    listed.push({
      id: h.id,
      investmentName: h.investmentName,
      sociedad: h.sociedad,
      category: h.category,
      capitalCommitted: h.capitalCommitted,
      contributions: h.contributions,
      unfunded: h.unfunded,
    })
  }
  listed.sort(
    (a, b) =>
      b.unfunded - a.unfunded ||
      a.investmentName.localeCompare(b.investmentName) ||
      a.sociedad.localeCompare(b.sociedad),
  )
  // No amount to rank the unreported by — that is the whole point of them — so
  // they order by the two documented identity dimensions.
  unreported.sort(
    (a, b) =>
      a.investmentName.localeCompare(b.investmentName) || a.sociedad.localeCompare(b.sociedad),
  )
  return {
    currency,
    holdings: listed,
    listedTotal: listed.reduce((s, h) => s + h.unfunded, 0),
    unavailable: unreported.length,
    unreported,
    fullyDrawn,
    ofHoldings: rows.length,
  }
}
