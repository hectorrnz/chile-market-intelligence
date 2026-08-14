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

export interface AlternativesFilter {
  sociedad: string | null
  category: string | null
  currency: string | null
  eventType: string | null
}

export const EMPTY_FILTER: AlternativesFilter = {
  sociedad: null,
  category: null,
  currency: null,
  eventType: null,
}

export interface FilterOptions {
  sociedades: string[]
  categories: string[]
  currencies: string[]
  eventTypes: string[]
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
  }
}

/** Holdings surviving the filter. `eventType` never filters holdings. */
export function applyHoldingFilter(
  holdings: readonly AlternativesHoldingRead[],
  filter: AlternativesFilter,
): AlternativesHoldingRead[] {
  return holdings.filter(
    (h) =>
      (filter.sociedad === null || h.sociedad === filter.sociedad) &&
      (filter.category === null || h.category === filter.category) &&
      (filter.currency === null || h.currency === filter.currency),
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
    if (filter.eventType !== null && e.eventType !== filter.eventType) return false
    if (filter.currency !== null && e.currency !== filter.currency) return false
    if (filter.sociedad !== null || filter.category !== null) {
      const h = e.holdingId !== null ? (byId.get(e.holdingId) ?? null) : null
      if (h === null) return false
      if (filter.sociedad !== null && h.sociedad !== filter.sociedad) return false
      if (filter.category !== null && h.category !== filter.category) return false
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
