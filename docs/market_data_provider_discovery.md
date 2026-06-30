# Market Data Provider Discovery — Phase 4C / 4C.1-alt

**Last updated:** 2026-06-30  
**Status:** Yahoo Finance free overlay active (Phase 4C.1-alt). Brain Data institutional access blocked.

---

## 1. What We Need

| Data type | Endpoint concept | Current source |
|---|---|---|
| Stock snapshot (price, day %, YTD %) | `/api/market/live-snapshot` (live overlay) | `src/data/stockPrices.json` (static base) |
| Stock OHLCV history | Static only | `src/data/stockHistory.json` |
| Index level & % change | `/api/market/live-snapshot` (live overlay) | `src/data/indexPerformance.json` (static base) |
| Sector performance | Aggregated from stock day% | `src/data/sectorPerformance.json` (static base) |

Tracked tickers: 25 Bolsa de Santiago equities — see `src/lib/market/liveOverlay.ts`.  
Indices: IPSA + 10 global (S&P 500, Ibovespa, IPC México, COLCAP, BVL Peru, Euro Stoxx 50, FTSE 100, Nikkei, Hang Seng, KOSPI).

---

## 2. Preferred Provider: Brain Data / Bolsa de Santiago — BLOCKED

**Brain Data** (`braindata.cl`) is the official technology arm of Bolsa de Santiago. They provide the authoritative source for Chilean equity data with an API product on the BCS marketplace (`marketplace.bolsadesantiago.com`).

### Why it is blocked

Access to the Brain Data API product requires an **institutional account**. The personal "Personas" retail account on `marketplace.bolsadesantiago.com` does not display the "Servicios de información" API product in the available offerings. There is no self-service free trial for individuals.

To unblock this path, you would need to:
1. Contact Bolsa de Santiago as an institutional entity (not a personal account)
2. Negotiate data licensing terms
3. Obtain API credentials under a firm / RUT empresarial

**Until institutional access is obtained, Brain Data remains blocked.**  
The Brain Data provider shell in `src/lib/providers/market/brainDataProvider.ts` returns `ok: false` with a clear reason and falls back to static data automatically. No credentials are required and no code changes are needed to try again later — simply set `BRAIN_DATA_API_KEY` and `BRAIN_DATA_API_BASE_URL` in `.env.local` once credentials are obtained.

---

## 3. Current Solution: Yahoo Finance (Phase 4C.1-alt)

**Yahoo Finance** is used as a free, unofficial, no-registration-required source for market data. This was an explicit decision made with the understanding of its limitations (see Section 5 below).

### Coverage

All 25 Chilean BCS tickers are available via the `.SN` suffix (Bolsa de Santiago):

| Internal | Yahoo symbol | Exchange |
|---|---|---|
| BSANTANDER | BSANTANDER.SN | Bolsa de Santiago |
| CHILE | CHILE.SN | Bolsa de Santiago |
| BCI | BCI.SN | Bolsa de Santiago |
| SECURITY | SECURITY.SN | Bolsa de Santiago |
| ITAUCORP | ITAUCORP.SN | Bolsa de Santiago |
| SQM-B | SQM-B.SN | Bolsa de Santiago |
| CAP | CAP.SN | Bolsa de Santiago |
| ENELAM | ENELAM.SN | Bolsa de Santiago |
| ENELCHILE | ENELCHILE.SN | Bolsa de Santiago |
| COLBUN | COLBUN.SN | Bolsa de Santiago |
| AGUAS-A | AGUAS-A.SN | Bolsa de Santiago |
| CMPC | CMPC.SN | Bolsa de Santiago |
| COPEC | COPEC.SN | Bolsa de Santiago |
| FALABELLA | FALABELLA.SN | Bolsa de Santiago |
| CENCOSUD | CENCOSUD.SN | Bolsa de Santiago |
| RIPLEY | RIPLEY.SN | Bolsa de Santiago |
| PARAUCO | PARAUCO.SN | Bolsa de Santiago |
| MALLPLAZA | MALLPLAZA.SN | Bolsa de Santiago |
| ENTEL | ENTEL.SN | Bolsa de Santiago |
| SONDA | SONDA.SN | Bolsa de Santiago |
| ANDINA-B | ANDINA-B.SN | Bolsa de Santiago |
| CCU | CCU.SN | Bolsa de Santiago |
| CONCHATORO | CONCHATORO.SN | Bolsa de Santiago |
| LTM | LTM.SN | Bolsa de Santiago |
| VAPORES | VAPORES.SN | Bolsa de Santiago |

Indices available via Yahoo Finance standard symbols (`^IPSA`, `^GSPC`, etc.) — see `INDEX_YF` in `src/lib/market/liveOverlay.ts`.

### Implementation

Two complementary mechanisms:

**1. GitHub Actions static refresh (twice daily)**  
`scripts/refresh/refreshMarketData.py` (Python + yfinance library) runs on a GitHub Actions schedule:
- **13:30 UTC weekdays** — ~30 min after Bolsa de Santiago opens (09:00 SCL winter)
- **21:30 UTC weekdays** — after market close (17:30 SCL winter)

The script fetches YTD close prices via `yf.download()`, computes day % and YTD % from the close series, and writes updated values to `src/data/stockPrices.json`, `sectorPerformance.json`, `indexPerformance.json`, and `marketMeta.json`. GitHub Actions commits only if data changed and pushes to `master`; Vercel auto-redeploys.

**2. Next.js API route (on-demand refresh button)**  
`src/app/api/market/live-snapshot/route.ts` uses the `yahoo-finance2` npm package to batch-quote all 25 tickers + 11 indices in a single request. The UI refresh button calls this route; the response overlays live data on top of the static baseline in client state without requiring a page reload or redeploy.

- No API key is required
- All Yahoo calls are server-side (never exposed to clients)
- Route has a 10-second timeout; returns 503 on failure
- Pure aggregation logic lives in `src/lib/market/liveOverlay.ts` (testable without Next.js)
- 20 unit tests cover ticker mapping, buildStocks, buildSectors, buildIndices

---

## 4. Data Architecture

```
Static base (always available):
  src/data/stockPrices.json
  src/data/sectorPerformance.json
  src/data/indexPerformance.json
  src/data/marketMeta.json
        ↓ (refreshed twice daily by GitHub Actions / yfinance)

Live overlay (on user demand):
  MarketRefreshButton → fetch /api/market/live-snapshot
        ↓ (server-only, yahoo-finance2)
  src/lib/market/liveOverlay.ts (buildStocks / buildSectors / buildIndices)
        ↓
  client useState<LiveSnapshot> overlaid on static base
```

Pages with refresh capability:
- **Home** — Tracked Stocks card + Sector Heat Map card
- **Stocks** — filter toolbar
- **Company detail** — SectionHeader actions (price + day% KPIs)

---

## 5. Limitations and Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Yahoo Finance API changes without notice | High | Static JSON baseline always available; worst case = prices are stale, not missing |
| Delayed quotes (15-min) during market hours | Medium | Quotes show "as of" timestamp; user informed data is unofficial |
| Incomplete market cap data | Low | `marketCapCLP` is `null` when not returned; UI shows `—` |
| No official SLA | High | App works 100% without live data; fallback is transparent |
| Rate limiting by Yahoo | Medium | Single batch call per user request; GitHub Actions runs twice daily only |
| Data is not official BCS data | Critical | Disclaimer shown in app footer; never labeled "official" |

**This data must never be labeled "official BCS data" or used for trading decisions.**  
The app footer disclaimer (`AppDisclaimer`) states this explicitly.

---

## 6. Future Path to Official Data

When institutional Brain Data / Bolsa de Santiago access is obtained:

1. Set `BRAIN_DATA_API_KEY` and `BRAIN_DATA_API_BASE_URL` in `.env.local` and Vercel
2. Set `MARKET_DATA_MODE=live` (or `hybrid`)
3. Confirm endpoint paths against official OpenAPI spec
4. Implement `brainDataProvider.ts` (shell exists in `src/lib/providers/market/`)
5. Confirm ticker symbol mapping in `src/config/tickerMap.ts` (all `verified: false`)
6. Remove or retain yfinance as a fallback based on licensing terms

The architecture supports switching providers without changing the UI layer.

---

## 7. No-Scraping Policy (unchanged)

The project will never:
- Scrape the Bolsa de Santiago website for prices
- Reverse-engineer private APIs
- Use Chrome automation or Puppeteer for market data

Yahoo Finance is used via the documented `yfinance` / `yahoo-finance2` libraries which use published Yahoo quote endpoints. This is treated as a temporary free-tier workaround, not a permanent solution.
