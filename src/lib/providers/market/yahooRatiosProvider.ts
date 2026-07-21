// Live valuation + ratios from Yahoo Finance quoteSummary.
//
// SERVER-ONLY. A SINGLE quoteSummary call per ticker yields the whole
// valuation set — price, market cap, P/E, P/S, EV/EBITDA, margins, ROE, FCF
// yield, P/B, dividend yield, net-debt/EBITDA — so every field shares ONE
// consistent price basis. This is deliberate: the reported bug (item 4) was
// the Compare Market Data price and the Fundamentals "Last Price" disagreeing
// because they came from two different fetches. Reading price AND every
// price-based ratio from the same snapshot makes them agree by construction.
//
// CURRENCY CORRECTION (the reason this file is a provider, not a passthrough):
// Yahoo computes price-based ratios by dividing the QUOTE price by a per-share
// figure taken from the issuer's REPORTED financials — and for several Chilean
// issuers those two are in different currencies. SQM-B, CAP, ENELAM, COLBUN and
// LTM all quote in CLP but report in USD, so Yahoo's raw priceToBook for SQM-B
// is 3096.9 instead of ~3.3 — inflated by exactly the USD/CLP rate. Verified
// live against all 25 tickers before this was written.
//
// So every price-based ratio (P/E, P/S, P/B) is divided by the quote-per-
// financial FX rate when the currencies differ. Margins/ROE/net-debit-EBITDA
// need no correction (numerator and denominator are both from the same reported
// statements, so the currency cancels). EV/EBITDA and FCF yield are recomputed
// from raw components in the financial currency (market cap converted into it)
// so they are correct regardless of currency. If the FX rate can't be fetched,
// the affected fields are returned as null — never the uncorrected (wrong)
// figure, and never a fabricated one.

import { TICKER_YF } from '../../market/liveOverlay.ts'

const TIMEOUT_MS = 12_000
/** Yahoo's own FX symbol for CLP per 1 USD. */
const USD_CLP_SYMBOL = 'USDCLP=X'

/** Full live valuation for one ticker, from a single Yahoo quoteSummary call. */
export interface YahooValuation {
  /** Regular-market price in the quote currency. */
  price: number | null
  /** Quote currency (e.g. 'CLP'). */
  currency: string | null
  /** Market capitalization in the quote currency (raw units, not millions). */
  marketCap: number | null
  /** Forward P/E (falls back to trailing when forward is unavailable), currency-corrected. */
  peFwd: number | null
  /** Trailing-twelve-month price / sales, currency-corrected. */
  psTtm: number | null
  /** Enterprise value / EBITDA, recomputed from raw components in one currency. */
  evEbitda: number | null
  /** Operating margin as a percentage. */
  opMargin: number | null
  /** Gross margin as a percentage. */
  grossMargin: number | null
  /** Return on equity as a percentage. */
  roe: number | null
  /** Free-cash-flow yield as a percentage (FCF / market cap). */
  fcfYield: number | null
  /** Price / book value per share, currency-corrected. */
  pb: number | null
  /** Trailing dividend yield as a percentage. */
  dividendYield: number | null
  /** Net debt / EBITDA. */
  netDebtEbitda: number | null
}

/** Back-compat subset used by the previous fetchYahooRatios consumers. */
export interface YahooRatios {
  pb: number | null
  roe: number | null
  psTtm: number | null
}

const EMPTY_VALUATION: YahooValuation = {
  price: null, currency: null, marketCap: null, peFwd: null, psTtm: null,
  evEbitda: null, opMargin: null, grossMargin: null, roe: null, fcfYield: null,
  pb: null, dividendYield: null, netDebtEbitda: null,
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Rounds to 1 decimal for multiples / percentages — these feed UI tables,
 *  and a raw float like 3.312426 is never what we want to render. */
function round1(v: number | null): number | null {
  return v == null ? null : Math.round(v * 10) / 10
}

async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS),
    ),
  ])
}

/**
 * Fetches the full live valuation for the given app tickers.
 * Never throws — a ticker that fails simply maps to an all-null valuation.
 */
export async function fetchYahooValuation(tickers: string[]): Promise<Map<string, YahooValuation>> {
  const out = new Map<string, YahooValuation>()
  const symbols = tickers
    .map((t) => ({ ticker: t, symbol: TICKER_YF[t] }))
    .filter((x): x is { ticker: string; symbol: string } => Boolean(x.symbol))

  if (symbols.length === 0) return out

  let YahooFinance
  try {
    YahooFinance = (await import('yahoo-finance2')).default
  } catch {
    return out
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yf = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] })

  // One FX lookup per batch, used only to correct mismatched-currency issuers.
  let usdClp: number | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fxQuote: any = await withTimeout(
      yf.quote(USD_CLP_SYMBOL, {}, { validateResult: false }),
      'Yahoo FX quote',
    )
    usdClp = finite(fxQuote?.regularMarketPrice)
  } catch {
    usdClp = null
  }

  await Promise.all(
    symbols.map(async ({ ticker, symbol }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = await withTimeout(
          yf.quoteSummary(
            symbol,
            { modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail', 'price'] },
            { validateResult: false },
          ),
          `Yahoo quoteSummary ${symbol}`,
        )

        const quoteCurrency = r?.price?.currency ?? null
        const financialCurrency = r?.financialData?.financialCurrency ?? null

        // Factor converting one unit of the financial currency into the quote
        // currency. 1 when they already match; null when we can't correct.
        let fx: number | null = 1
        if (quoteCurrency && financialCurrency && quoteCurrency !== financialCurrency) {
          fx = financialCurrency === 'USD' && quoteCurrency === 'CLP' ? usdClp : null
        }
        const correct = (raw: number | null): number | null =>
          fx != null && raw != null ? raw / fx : null

        const price = finite(r?.price?.regularMarketPrice)
        const marketCap = finite(r?.price?.marketCap ?? r?.summaryDetail?.marketCap)

        const rawPb = finite(r?.defaultKeyStatistics?.priceToBook)
        const rawPs = finite(r?.summaryDetail?.priceToSalesTrailing12Months)
        // Forward P/E preferred (matches the "P/E (fwd)" label); trailing is a
        // reasonable fallback so a stock with only a trailing figure still shows.
        const rawPe = finite(r?.defaultKeyStatistics?.forwardPE ?? r?.summaryDetail?.forwardPE)
          ?? finite(r?.summaryDetail?.trailingPE)

        const rawRoe = finite(r?.financialData?.returnOnEquity)
        const rawOpMargin = finite(r?.financialData?.operatingMargins)
        const rawGrossMargin = finite(r?.financialData?.grossMargins)
        const rawDivYield = finite(r?.summaryDetail?.dividendYield)

        // EV/EBITDA, FCF yield and net-debt/EBITDA from raw components so the
        // currency is always internally consistent (see file header).
        const ebitda = finite(r?.financialData?.ebitda)
        const totalDebt = finite(r?.financialData?.totalDebt)
        const totalCash = finite(r?.financialData?.totalCash)
        const freeCashflow = finite(r?.financialData?.freeCashflow)
        // Market cap converted into the financial currency (fx converts
        // financial→quote, so quote→financial divides by fx).
        const marketCapFinancial = fx != null && marketCap != null ? marketCap / fx : null
        const netDebt = totalDebt != null && totalCash != null ? totalDebt - totalCash : null

        const evEbitda =
          marketCapFinancial != null && netDebt != null && ebitda != null && ebitda !== 0
            ? (marketCapFinancial + netDebt) / ebitda
            : null
        const netDebtEbitda =
          netDebt != null && ebitda != null && ebitda !== 0 ? netDebt / ebitda : null
        const fcfYield =
          freeCashflow != null && marketCapFinancial != null && marketCapFinancial !== 0
            ? (freeCashflow / marketCapFinancial) * 100
            : null

        out.set(ticker, {
          price,
          currency: quoteCurrency,
          marketCap,
          peFwd: round1(correct(rawPe)),
          psTtm: round1(correct(rawPs)),
          evEbitda: round1(evEbitda),
          opMargin: round1(rawOpMargin != null ? rawOpMargin * 100 : null),
          // Yahoo returns exactly 0 for a bank's gross margin (the concept
          // doesn't apply to banks) — treat that as "not reported", never a
          // misleading literal 0%.
          grossMargin: round1(rawGrossMargin != null && rawGrossMargin !== 0 ? rawGrossMargin * 100 : null),
          roe: round1(rawRoe != null ? rawRoe * 100 : null),
          fcfYield: round1(fcfYield),
          pb: round1(correct(rawPb)),
          dividendYield: round1(rawDivYield != null ? rawDivYield * 100 : null),
          netDebtEbitda: round1(netDebtEbitda),
        })
      } catch {
        out.set(ticker, { ...EMPTY_VALUATION })
      }
    }),
  )

  return out
}

/**
 * Back-compat projection: the three fields (P/B, ROE, P/S TTM) earlier
 * consumers read. Delegates to fetchYahooValuation so there is exactly one
 * Yahoo code path and one currency-correction implementation.
 */
export async function fetchYahooRatios(tickers: string[]): Promise<Map<string, YahooRatios>> {
  const full = await fetchYahooValuation(tickers)
  const out = new Map<string, YahooRatios>()
  for (const [ticker, v] of full) {
    out.set(ticker, { pb: v.pb, roe: v.roe, psTtm: v.psTtm })
  }
  return out
}
