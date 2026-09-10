// POST-R13.8 FOLLOW-UP F — one paginator, one invariant.
//
// THE INVARIANT THIS MODULE EXISTS TO STATE:
//
//     A SHORT SERVER RESPONSE IS NOT END OF TABLE.
//
// PostgREST caps every response at a server-configured row limit — 1,000 on this
// project. A client that asks for 5,000 rows and receives 1,000 has not reached
// the end of anything; it has hit the cap. Terminating on
//
//     if (batch.length < requestedPageSize) break
//
// therefore reads exactly one capped page and calls it the whole table, silently.
// That is precisely how the R13.8 planner came to see 1,000 of 19,757 row-history
// identities and 1,000 of 2,260 performance-history identities: the remaining
// ~18,757 and ~1,260 looked ABSENT, so an identical re-upload would have proposed
// them all as fresh insertions — the exact fabrication the loaders exist to stop.
//
// Matching the page size to today's cap would happen to work and would still be
// wrong: the next cap change, the next `db-pool` setting, the next self-hosted
// instance moves it, and the failure is silent again. The cap is not knowable
// from here, so nothing here may depend on knowing it.
//
// THE ONLY TERMINATION RULE IS AN EMPTY PAGE. The offset advances by the number
// of rows ACTUALLY RECEIVED, never by the number requested, so a capped page is
// simply a smaller page and the walk continues from where it really stopped. A
// table whose size is an exact multiple of the cap costs one extra empty request;
// that request is the price of never mistaking a cap for an ending.
//
// DETERMINISTIC ORDERING IS THE CALLER'S HALF OF THE CONTRACT. Offset paging over
// a non-total order lets tied rows reorder between requests, so a row can land on
// two pages or on none — and a row that lands on none reads as ABSENT, which is
// the same fabrication by a different route. Every caller of `readAllPages` must
// order by a tuple that uniquely identifies a row.
//
// WHY OFFSET AND NOT KEYSET, given a table can move between two page requests.
// It can, in principle: a row inserted before the current offset shifts the rest
// forward and repeats one at the boundary; a row deleted before it skips one. In
// this book the only writers are `nmi_import_portfolio_workbook` and
// `nmi_rollback_portfolio_import` — `authenticated` holds SELECT and no write
// policy exists — and both take `nmi_lock_portfolio_import`, so writes are
// serialised and weekly. A plan built from a torn read is then caught three more
// times before anything is written: the publish route RE-PLANS on the confirm
// request and refuses on a `planFingerprint` mismatch; the import re-reads every
// asserted pre-state `for update` and refuses on divergence; and the analytical
// inserts run against `portfolio_row_history_key` and its performance-history
// twin, so an identity proposed as new that already exists is a refusal, not a
// duplicate. A keyset cursor over a three-column key cannot be expressed in
// PostgREST without an RPC, which would be a far larger change to the import path
// than a defect these gates already contain. Offset with a TOTAL order it is.

/**
 * The only thing a paged query has to offer: a bounded window and a result.
 *
 * Deliberately structural rather than a Supabase type. Every repository in this
 * project already casts its client through a hand-written shape because the
 * generated types exceed TypeScript's inference depth, and a paginator that
 * demanded the real `PostgrestFilterBuilder` could not be handed one of those.
 */
export interface RangeableQuery<T> {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>
}

/**
 * Rows requested per page.
 *
 * Set AT the observed server cap rather than above it, purely so the common case
 * costs no wasted round trip. Correctness does not depend on this number: a
 * server capping lower still returns whole tables, because termination is the
 * empty page and not this value.
 */
export const DEFAULT_PAGE_SIZE = 1000

/**
 * A refusal ceiling, not a page count.
 *
 * If a server ever ignored `range` entirely, an empty page would never arrive
 * and the walk would not end. This makes that case a LOUD failure instead of an
 * unbounded loop — and, unlike a short read, a failure cannot be mistaken for
 * data. It sits far above every table in this book (the largest is ~19,757 rows).
 */
export const MAX_TOTAL_ROWS = 1_000_000

export type ReadAllPagesResult<T> =
  | { ok: true; rows: T[]; pages: number }
  | { ok: false; reason: string }

export interface ReadAllPagesOptions {
  pageSize?: number
  maxRows?: number
}

/**
 * Reads every row a query matches, across as many pages as the server needs.
 *
 * `build` is called once per page and must produce the SAME query each time —
 * same table, same columns, same filters and, critically, the same total
 * ordering. It is a factory rather than a single builder because a PostgREST
 * builder is a one-shot thenable: re-ranging a used one is not defined.
 *
 * Returns a failure rather than a partial list on a read error, so a caller can
 * never confuse "the table is empty here" with "the read did not finish".
 */
export async function readAllPages<T>(
  build: () => RangeableQuery<T>,
  options: ReadAllPagesOptions = {},
): Promise<ReadAllPagesResult<T>> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE))
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? MAX_TOTAL_ROWS))

  const rows: T[] = []
  let from = 0
  let pages = 0

  for (;;) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    pages += 1
    if (error) return { ok: false, reason: error.message ?? 'paged_read_failed' }

    const batch = data ?? []
    // THE termination rule, and the only one. A page smaller than the one asked
    // for proves nothing at all about the end of the table — see the header.
    if (batch.length === 0) return { ok: true, rows, pages }

    rows.push(...batch)
    // Advance by what ARRIVED. A capped page moves the offset by the cap, so the
    // next request resumes at the first row this one could not carry.
    from += batch.length

    if (rows.length > maxRows) {
      return { ok: false, reason: 'paged_read_exceeded_max_rows' }
    }
  }
}
