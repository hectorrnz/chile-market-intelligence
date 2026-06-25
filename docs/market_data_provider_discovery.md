# Market Data Provider Discovery — Phase 4C

**Last updated:** 2026-06-25  
**Status:** Architecture complete; Brain Data credentials/official endpoint mapping PENDING  
**No-scraping policy:** Only official APIs with valid credentials are permitted. No website scraping, no reverse-engineered endpoints.

---

## 1. What We Need

The app currently shows static stock prices, index performance, and sector heat-map data from local JSON files. Phase 4C creates the provider abstraction so these can be upgraded to live data when an official market data feed is configured. Data needed:

| Data type | Endpoint concept | Current source |
|---|---|---|
| Stock snapshot (price, day %, YTD %) | `/stocks` or `/last-trade` | `src/data/stockPrices.json` |
| Stock OHLCV history | `/historical-prices` | `src/data/stockHistory.json` |
| Index level & % change | `/indices` | `src/data/indexPerformance.json` |
| Sector performance | `/sectors` | `src/data/sectorPerformance.json` |

Tracked tickers: ~25 Bolsa de Santiago equities — see `src/config/tickerMap.ts`.  
Index: IPSA (primary), plus LatAm/global indices currently from static data.

---

## 2. Preferred Provider: Brain Data / Bolsa de Santiago

**Brain Data** (`braindata.cl`) is the technology arm of Bolsa de Santiago that provides official market data APIs. They are the authoritative source for Chilean equity data.

### Registration and access

- **Official site:** https://www.braindata.cl (as of 2026-06-25 — confirm current URL)
- Access requires registration and an approved account.
- Pricing and SLA unknown without a signed agreement.
- API credentials obtained only after account setup.

### Authentication method (UNKNOWN — must confirm with Brain Data)

Brain Data's auth mechanism has not been confirmed from official documentation. Possible approaches:

| Mode | Env vars needed | Notes |
|---|---|---|
| API key (header) | `BRAIN_DATA_API_KEY` | Most common for REST market data APIs |
| OAuth2 client credentials | `BRAIN_DATA_CLIENT_ID`, `BRAIN_DATA_CLIENT_SECRET`, `BRAIN_DATA_AUTH_URL` | Standard for financial data platforms |
| Combination | Both | Some providers require initial OAuth then use the token as a bearer |

**Required action:** Contact Brain Data / Bolsa de Santiago to obtain:
1. Official OpenAPI specification or API reference URL
2. Authentication method
3. Rate limits and data lag (real-time vs 15-min delay)
4. Historical data depth
5. Sandbox/test environment if available

### Known data constraints (assumptions — not confirmed)

- Chilean equities trade on the **Bolsa de Santiago** (BCS) — primary exchange.
- IPSA is the benchmark index.
- Market hours: Santiago time (UTC-3 in summer, UTC-4 in winter).
- Currency: CLP for all domestic equities.
- Data lag: unknown — real-time, 15-min delay, or end-of-day depending on subscription tier.

---

## 3. Potential API Surface (NOT confirmed — for discovery only)

Do NOT hard-code these paths until confirmed against official documentation. These are informed guesses based on typical financial data API conventions.

| Concept | Possible path concept | Status |
|---|---|---|
| Securities master | `GET /v*/instruments` or `/securities` | ❓ Unknown |
| Last trade / snapshot | `GET /v*/prices/last` or `/quotes` | ❓ Unknown |
| OHLCV history | `GET /v*/prices/history` or `/historical` | ❓ Unknown |
| Index levels | `GET /v*/indices` | ❓ Unknown |
| Sector classification | `GET /v*/sectors` | ❓ Unknown |
| Market summary | `GET /v*/market/summary` | ❓ Unknown |

**All paths in `src/config/marketDataProviders.ts` are marked `status: 'pending'` until confirmed.**

---

## 4. Alternative / Fallback Providers

If Brain Data access is not obtainable, these alternatives exist:

| Provider | What it covers | Notes |
|---|---|---|
| **Bolsa de Santiago direct** | Real-time IPSA, equities | May require institutional membership |
| **Refinitiv / LSEG** | Global incl. Chilean equities | Expensive; institutional-grade |
| **Bloomberg** | Full universe | Very expensive; terminal-based |
| **Yahoo Finance** | IPSA, some Chilean ADRs | Unofficial API — do NOT use |
| **Alpha Vantage** | Limited Chilean coverage | Does not cover local BCS symbols |

**Policy:** Only officially licensed/registered data sources. Do not implement Yahoo Finance or any other unofficial scraping method.

---

## 5. Current Architecture (Phase 4C)

The provider abstraction was built in Phase 4C. All data flows through server-only route handlers:

```
UI components
  ↓ static sync
src/lib/data/stocks.ts, stockHistory.ts, indexPerformance.ts, sectorPerformance.ts
  ↓ optional async upgrade
src/lib/data/marketData.ts  (fetchStockSnapshots, fetchIndexPerformance, etc.)
  ↓ HTTP
/api/market/stocks
/api/market/stocks/[ticker]
/api/market/stocks/[ticker]/history
/api/market/indices
/api/market/sectors
  ↓ server-only
src/lib/providers/market/marketProvider.ts  (orchestrator)
  ↓
staticMarketProvider.ts  OR  brainDataProvider.ts
```

Brain Data provider is a **shell** — it returns `ok: false, reason: 'Brain Data credentials not configured'` until `BRAIN_DATA_API_KEY` (or confirmed auth fields) are set. The app falls back to static data without breaking.

---

## 6. Ticker Symbol Mapping Status

See `src/config/tickerMap.ts` for the full mapping. All Brain Data / Bolsa de Santiago symbols are `verified: false` pending official API confirmation. The `bolsaSymbol` values are our best estimate of the official symbol convention for each equity — to be confirmed against the official securities master endpoint.

---

## 7. Required Next Steps (Phase 4C.1)

1. **Obtain Brain Data API credentials** — register at https://www.braindata.cl or contact via Bolsa de Santiago institutional channel.
2. **Get official OpenAPI spec** — confirm authentication method, base URL, and endpoint paths.
3. **Run `npm run market:search`** (to be added in Phase 4C.1) — discover which tickers are in the official securities master.
4. **Confirm ticker mappings** — set `verified: true` in `src/config/tickerMap.ts` for each confirmed symbol.
5. **Enable endpoint config** — update `src/config/marketDataProviders.ts` `confirmedEndpoints` with real paths.
6. **Implement Brain Data provider** — replace TODO shell with actual API calls in `brainDataProvider.ts`.
7. **Deploy to Preview first** — validate live data on Preview before promoting to Production.

---

## 8. No-Scraping Policy

This project will NEVER:
- Scrape the Bolsa de Santiago website for prices
- Use unofficial endpoints from any provider
- Reverse-engineer private APIs
- Use Chrome automation, Puppeteer, or similar to extract market data

Only official, registered, credentialed API access is acceptable.
