// R13.R1 § 12/§ 13 — official Bolsa de Valores de Lima (BVL) close provider
// for INRETC1.
//
// PURE + INJECTABLE. The only impure thing this module can do is call the
// `fetcher` it is handed; the default fetcher is the one place a network
// request is made, and every test supplies its own. Relative `.ts` imports (not
// the `@/` alias) per the standing provider-file convention — this module runs
// directly under Node's native test runner.
//
// ── DISCOVERY RESULT: NO FREE OFFICIAL BVL CLOSE FEED EXISTS ────────────────
//
// § 12 asks for an official BVL source "only if it can be made operationally
// reliable". It cannot, today. What was actually probed (2026-08-11):
//
//   1. `www.bvl.com.pe/en/issuers/detail?companyCode=74222` — the issuer page
//      § 12 names. An Angular SPA. Its own bundles are not even retrievable:
//      every unknown path on that host, INCLUDING a real static asset, returns
//      one identical 9 030-byte shell. There is no parseable issuer data.
//
//   2. `api.bvl.com.pe` — the SPA's backend. Returns `{"message":"Forbidden"}`
//      (AWS API Gateway) for EVERY path with no key. BVL sells access as
//      "Market Data / Servicios de suscripción". A paid, keyed vendor feed is
//      outside this project's standing no-paid-vendor rule.
//
//   3. BVL's official daily publications (`documents.bvl.com.pe`) — § 12's
//      second target. The server states outright that it now maintains only
//      Renta Fija, Operaciones Extrabursátiles and Bolsa News. Its equity
//      publication `pubdif/boldia/presencia.htm` is real and does list INRETC1,
//      but it is stamped "Actualizado al 28 de diciembre de 2023" and carries a
//      market-presence PERCENTAGE, not a price.
//
//   4. `www.bvl.com.pe/mercado/movimientos-diarios` — server-renders a ticker
//      MARQUEE that does contain `INRETC1`. It is not usable as a close, and
//      the reasons are not stylistic:
//        · the page states the data is 20 MINUTES DELAYED — an intraday quote,
//          not a close;
//        · it carries NO observation date, so § 12's "source observation date",
//          "latest valid close on or before the target date" and "never
//          future-close" rules would all have to be fabricated;
//        · it carries NO currency, while listing PEN- and USD-denominated
//          instruments side by side — so § 12's USD validation could only be
//          assumed;
//        · it prints `0.000` for an instrument that has not traded. Ingesting
//          that marquee would turn "no trade" into "price zero", which is
//          exactly the unavailable-is-not-zero failure § 12 forbids;
//        · it is today-only, so no weekly history is derivable.
//
// Full record: docs/portfolio-r13/11-r1-bvl-discovery.md.
//
// ── WHAT THIS MODULE THEREFORE IS ──────────────────────────────────────────
//
// The complete § 12 CONTRACT — symbol validation, currency validation, exact-
// date and prior-close alignment, the never-future-close rule, provenance,
// caching, timeout and failure handling — implemented and tested, sitting
// behind a `verified` gate that is currently FALSE. Nothing is fetched while
// that gate is false, so the app performs no BVL request at all.
//
// The active source is § 12's stated fallback: the ADMIN/WORKBOOK-SUPPLIED
// price, carried with explicit provenance so it can never be mistaken for an
// official BVL close. There is deliberately NO Yahoo fallback here — § 12
// forbids silently substituting an unofficial provider, and the price the
// workbook itself used is the honest answer.

/** BVL's own mnemonic for InRetail Perú Corp. Never inferred from a name. */
export const INRETAIL_BVL_SYMBOL = 'INRETC1'

/** INRETC1 is quoted in USD on BVL. A quote in anything else is REFUSED. */
export const INRETAIL_EXPECTED_CURRENCY = 'USD'

/**
 * THE GATE. Flip to `true` only when a free, official BVL endpoint that returns
 * a DATED, CURRENCY-QUALIFIED CLOSE has been verified end to end — see the
 * discovery record above for what has already been ruled out. While false, no
 * BVL request is made from anywhere in the app.
 */
export const BVL_SOURCE_VERIFIED = false

/** How long a resolved observation may be reused. Closes do not change. */
export const BVL_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** Hard ceiling on a single BVL request. */
export const BVL_TIMEOUT_MS = 8_000

export type BvlProvenance =
  /** A dated close read from an official BVL endpoint. */
  | 'bvl_official_close'
  /** A price supplied by an administrator or read from the source workbook. */
  | 'admin_supplied'

export interface BvlCloseObservation {
  symbol: string
  /** ISO date of the session this close belongs to — never a server date. */
  observationDate: string
  close: number
  currency: string
  provenance: BvlProvenance
  /** Human-readable origin, shown beside the figure. Never a bare vendor name. */
  sourceLabel: string
}

export type BvlUnavailableReason =
  /** The gate above is false — nothing was requested. */
  | 'source_not_verified'
  /** A symbol this provider does not serve. */
  | 'unsupported_symbol'
  /** The response could not be parsed into a dated, currency-qualified close. */
  | 'malformed_response'
  /** The request failed, timed out, or the endpoint refused it. */
  | 'provider_error'
  /** Parsed cleanly, but the currency is not the expected one. */
  | 'currency_mismatch'
  /** No session on or before the requested date lies inside the lookback. */
  | 'no_close_on_or_before_date'

export type BvlCloseResult =
  | { ok: true; observation: BvlCloseObservation }
  /** UNAVAILABLE IS NEVER ZERO — there is no `close` field on this branch. */
  | { ok: false; reason: BvlUnavailableReason }

/** A raw quotation as an official endpoint would express one. */
export interface BvlRawQuote {
  symbol: string
  date: string
  close: number
  currency: string
}

export type BvlFetcher = (
  symbol: string,
  from: string,
  to: string,
  signal: AbortSignal,
) => Promise<{ ok: true; quotes: BvlRawQuote[] } | { ok: false }>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function epochDays(iso: string): number | null {
  if (!ISO_DATE.test(iso)) return null
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null
}

/**
 * Accepts a raw quote only if EVERY field is genuinely present and usable.
 *
 * `close === 0` is REJECTED, deliberately: BVL's own surfaces print `0.000` for
 * an instrument that did not trade, so a zero is an absence marker and must
 * never enter the app as a price (§ 12: "unavailable state distinct from zero").
 */
export function isUsableQuote(q: unknown): q is BvlRawQuote {
  if (!q || typeof q !== 'object') return false
  const r = q as Record<string, unknown>
  return (
    typeof r.symbol === 'string' && r.symbol.trim().length > 0 &&
    typeof r.date === 'string' && ISO_DATE.test(r.date) &&
    typeof r.close === 'number' && Number.isFinite(r.close) && r.close > 0 &&
    typeof r.currency === 'string' && r.currency.trim().length > 0
  )
}

/**
 * § 12's alignment rule: the LATEST close on or before `targetDate`, within
 * `lookbackDays`.
 *
 * A quote dated AFTER the target is discarded outright — a weekly as-of must
 * never be satisfied by a session that had not happened yet. Nothing is
 * interpolated and nothing is carried forward beyond the window.
 */
export function alignBvlClose(
  quotes: readonly BvlRawQuote[],
  targetDate: string,
  lookbackDays = 7,
): BvlRawQuote | null {
  const target = epochDays(targetDate)
  if (target === null) return null
  let best: BvlRawQuote | null = null
  let bestDay = -Infinity
  for (const q of quotes) {
    if (!isUsableQuote(q)) continue
    const day = epochDays(q.date)
    if (day === null) continue
    if (day > target) continue                 // never a future close
    if (day < target - lookbackDays) continue  // never carried forward past the window
    if (day > bestDay) {
      bestDay = day
      best = q
    }
  }
  return best
}

interface CacheEntry {
  at: number
  result: BvlCloseResult
}

/** Module-scope cache. Closes are immutable, so a hit is always safe. */
const cache = new Map<string, CacheEntry>()

/** Test seam — never called by application code. */
export function clearBvlCache(): void {
  cache.clear()
}

async function defaultFetcher(): ReturnType<BvlFetcher> {
  // Unreachable while `BVL_SOURCE_VERIFIED` is false. It exists so the gate is
  // the only thing standing between this module and a request — not the absence
  // of an implementation, which would silently become a different guarantee the
  // day someone added one.
  return { ok: false }
}

/**
 * Resolves INRETC1's official close for one weekly as-of date.
 *
 * ORDER: gate → symbol → cache → fetch (bounded) → parse → currency → align.
 * Every failure yields an explicit reason and NO number.
 */
export async function getBvlClose(
  symbol: string,
  targetDate: string,
  options: {
    fetcher?: BvlFetcher
    now?: number
    lookbackDays?: number
    /** Test/operator override of the gate. Defaults to the module constant. */
    verified?: boolean
  } = {},
): Promise<BvlCloseResult> {
  const verified = options.verified ?? BVL_SOURCE_VERIFIED
  if (!verified) return { ok: false, reason: 'source_not_verified' }
  if (symbol !== INRETAIL_BVL_SYMBOL) return { ok: false, reason: 'unsupported_symbol' }
  if (!ISO_DATE.test(targetDate)) return { ok: false, reason: 'malformed_response' }

  const now = options.now ?? Date.now()
  const key = `${symbol}|${targetDate}`
  const hit = cache.get(key)
  if (hit && now - hit.at < BVL_CACHE_TTL_MS) return hit.result

  const lookback = options.lookbackDays ?? 7
  const fromDay = epochDays(targetDate)
  if (fromDay === null) return { ok: false, reason: 'malformed_response' }
  const from = new Date((fromDay - lookback) * 86_400_000).toISOString().slice(0, 10)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BVL_TIMEOUT_MS)
  let raw: Awaited<ReturnType<BvlFetcher>>
  try {
    raw = await (options.fetcher ?? defaultFetcher)(symbol, from, targetDate, controller.signal)
  } catch {
    // A throw is never allowed to escape: a provider outage degrades this one
    // metric, it does not fail the page.
    raw = { ok: false }
  } finally {
    clearTimeout(timer)
  }

  const store = (result: BvlCloseResult): BvlCloseResult => {
    cache.set(key, { at: now, result })
    return result
  }

  if (!raw.ok) return store({ ok: false, reason: 'provider_error' })
  if (!Array.isArray(raw.quotes)) return store({ ok: false, reason: 'malformed_response' })

  const usable = raw.quotes.filter(isUsableQuote).filter((q) => q.symbol === symbol)
  if (usable.length === 0) return store({ ok: false, reason: 'malformed_response' })

  // Currency is validated BEFORE alignment: a PEN quote is not a worse USD
  // quote, it is a different instrument's number.
  const wrong = usable.find((q) => q.currency.trim().toUpperCase() !== INRETAIL_EXPECTED_CURRENCY)
  if (wrong) return store({ ok: false, reason: 'currency_mismatch' })

  const aligned = alignBvlClose(usable, targetDate, lookback)
  if (!aligned) return store({ ok: false, reason: 'no_close_on_or_before_date' })

  return store({
    ok: true,
    observation: {
      symbol: aligned.symbol,
      observationDate: aligned.date,
      close: aligned.close,
      currency: INRETAIL_EXPECTED_CURRENCY,
      provenance: 'bvl_official_close',
      sourceLabel: 'Bolsa de Valores de Lima (BVL)',
    },
  })
}

/**
 * § 12's stated fallback: a price supplied by an administrator or read from the
 * source workbook, carried with EXPLICIT provenance.
 *
 * It is a separate function, not a branch inside `getBvlClose`, so an
 * admin-supplied figure can never be returned wearing `bvl_official_close`
 * provenance. Both the date and the price must be supplied by the caller —
 * nothing here invents either, and a zero or non-finite price is refused for
 * the same reason a `0.000` marquee value is.
 */
export function adminSuppliedClose(
  price: number | null,
  observationDate: string | null,
  currency: string = INRETAIL_EXPECTED_CURRENCY,
): BvlCloseResult {
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: 'provider_error' }
  }
  if (observationDate === null || !ISO_DATE.test(observationDate)) {
    return { ok: false, reason: 'no_close_on_or_before_date' }
  }
  if (currency.trim().toUpperCase() !== INRETAIL_EXPECTED_CURRENCY) {
    return { ok: false, reason: 'currency_mismatch' }
  }
  return {
    ok: true,
    observation: {
      symbol: INRETAIL_BVL_SYMBOL,
      observationDate,
      close: price,
      currency: INRETAIL_EXPECTED_CURRENCY,
      provenance: 'admin_supplied',
      sourceLabel: 'Administrator-supplied price (source workbook)',
    },
  }
}
