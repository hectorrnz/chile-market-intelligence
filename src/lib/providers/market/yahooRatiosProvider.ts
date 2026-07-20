// Live valuation ratios (P/B, ROE, P/S TTM) from Yahoo Finance quoteSummary.
//
// SERVER-ONLY. These three fields were the last permanently-static cells in
// Compare's Fundamentals table — no persisted financials source provides book
// value or a forward sales estimate, so they had no conversion path until now.
//
// CURRENCY CORRECTION (the reason this file exists rather than a one-line
// passthrough): Yahoo computes price-based ratios by dividing the QUOTE price
// by a per-share figure taken from the issuer's REPORTED financials — and for
// several Chilean issuers those two are in different currencies. SQM-B, CAP,
// ENELAM, COLBUN and LTM all quote in CLP but report in USD, so Yahoo's raw
// priceToBook for SQM-B is 3096.9 instead of ~3.3 — inflated by exactly the
// USD/CLP rate. Verified live against all 25 tickers before this was written.
//
// So every price-based ratio is divided by the quote-per-financial FX rate
// when the currencies differ. ROE needs no correction: net income and equity
// are both drawn from the same reported statements, so the currency cancels.
// If the FX rate can't be fetched, the affected ratios are returned as null —
// never the uncorrected (wrong) figure, and never a fabricated one.

import { TICKER_YF } from '../../market/liveOverlay.ts'

const TIMEOUT_MS = 12_000
/** Yahoo's own FX symbol for CLP per 1 USD. */
const USD_CLP_SYMBOL = 'USDCLP=X'

export interface YahooRatios {
  /** Price / book value per share, currency-corrected. */
  pb: number | null
  /** Return on equity as a percentage (Yahoo reports a decimal fraction). */
  roe: number | null
  /** Trailing-twelve-month price / sales, currency-corrected. NOT forward —
   *  no free source provides a forward sales estimate, so the UI must label
   *  this TTM rather than reuse the old "P/S (fwd)" label. */
  psTtm: number | null
}

const EMPTY: YahooRatios = { pb: null, roe: null, psTtm: null }

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Rounds to 1 decimal for multiples / percentages — these feed a UI table,
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
 * Fetches live valuation ratios for the given app tickers.
 * Never throws — a ticker that fails simply maps to all-null.
 */
export async function fetchYahooRatios(tickers: string[]): Promise<Map<string, YahooRatios>> {
  const out = new Map<string, YahooRatios>()
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

        const rawPb = finite(r?.defaultKeyStatistics?.priceToBook)
        const rawPs = finite(r?.summaryDetail?.priceToSalesTrailing12Months)
        const rawRoe = finite(r?.financialData?.returnOnEquity)

        out.set(ticker, {
          pb: round1(fx != null && rawPb != null ? rawPb / fx : null),
          psTtm: round1(fx != null && rawPs != null ? rawPs / fx : null),
          // Currency-independent — a ratio of two same-currency statement
          // figures — so it is never divided by fx.
          roe: round1(rawRoe != null ? rawRoe * 100 : null),
        })
      } catch {
        out.set(ticker, { ...EMPTY })
      }
    }),
  )

  return out
}
