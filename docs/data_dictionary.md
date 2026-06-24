# Data Dictionary — Chile Market Intelligence

This file defines the data entities, their fields, and where each field comes from. It is the authoritative reference for what the database and API layer will eventually store. During MVP, these entities are populated with static JSON files.

---

## Entity: Company

Represents a Chilean listed company tracked by the family office.

| Field | Type | Description | Source |
|---|---|---|---|
| `ticker` | string | CMF/Bolsa ticker symbol (e.g., `BSANTANDER`) | Manual / Bolsa de Santiago |
| `name` | string | Official registered name | CMF company registry |
| `short_name` | string | Display name used in tables | Manual |
| `sector` | string | Sector classification (e.g., Banking, Mining, Retail) | Manual |
| `industry` | string | Sub-sector or industry | Manual |
| `exchange` | string | Always `BCS` (Bolsa de Comercio de Santiago) for now | Manual |
| `isin` | string | ISIN identifier | CMF |
| `rut` | string | Chilean tax ID of the issuer | CMF |
| `cmf_id` | string | CMF internal entity ID | CMF |
| `website` | string | Company investor relations URL | Manual |
| `description` | text | Short business description | Manual |
| `is_tracked` | boolean | Whether the office actively monitors this company | Internal |
| `updated_at` | timestamp | Last data refresh | System |

---

## Entity: StockPrice

Daily closing price record for a company.

| Field | Type | Description | Source |
|---|---|---|---|
| `ticker` | string | FK → Company.ticker | |
| `date` | date | Trading date | Bolsa de Santiago / Brain Data |
| `open` | decimal | Opening price (CLP) | Market data |
| `high` | decimal | Daily high (CLP) | Market data |
| `low` | decimal | Daily low (CLP) | Market data |
| `close` | decimal | Closing price (CLP) | Market data |
| `volume` | bigint | Shares traded | Market data |
| `adjusted_close` | decimal | Close adjusted for dividends/splits | Market data |

Note: In MVP, only the latest `close` is stored as a static value per company.

---

## Entity: EarningsRelease

One row per quarterly or annual earnings report.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | uuid | Primary key | System |
| `ticker` | string | FK → Company.ticker | |
| `period` | string | Reporting period (e.g., `2024-Q3`, `2024-FY`) | Manual |
| `period_end_date` | date | Last day of the reporting period | CMF / manual |
| `release_date` | date | Date results were published | CMF / manual |
| `revenue_clp` | bigint | Total revenue in CLP millions | Company filing |
| `ebitda_clp` | bigint | EBITDA in CLP millions | Company filing |
| `net_income_clp` | bigint | Net income in CLP millions | Company filing |
| `eps_clp` | decimal | Earnings per share in CLP | Company filing |
| `revenue_yoy_pct` | decimal | YoY revenue growth (%) | Calculated |
| `net_income_yoy_pct` | decimal | YoY net income growth (%) | Calculated |
| `consensus_eps` | decimal | Bloomberg/FactSet consensus EPS | Future |
| `beat_miss` | string | `beat`, `miss`, or `in-line` vs. consensus | Calculated |
| `cmf_filing_url` | string | Link to CMF FECU filing | CMF |
| `notes` | text | Analyst notes | Internal |

---

## Entity: HechoEsencial

A CMF material disclosure filing.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | uuid | Primary key | System |
| `cmf_id` | string | CMF filing reference number | CMF |
| `ticker` | string | FK → Company.ticker | CMF |
| `company_name` | string | Issuer name as registered with CMF | CMF |
| `filing_type` | string | `hecho_esencial`, `informacion_interes`, `other` | CMF |
| `received_at` | timestamp | CMF receipt timestamp | CMF |
| `title` | string | Short description or subject line | CMF |
| `body_text` | text | Full text of the filing | CMF |
| `pdf_url` | string | Direct link to the CMF PDF | CMF |
| `tags` | string[] | Internal classification tags | Internal |

---

## Entity: MacroIndicator

One row per data point for a macroeconomic time series.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | uuid | Primary key | System |
| `series_code` | string | Identifier for the series (e.g., `TPM`, `IPC`, `IMACEC`) | Banco Central |
| `series_name` | string | Human-readable name | Manual |
| `date` | date | Observation date | Banco Central BDE API |
| `value` | decimal | Numeric value | Banco Central BDE API |
| `unit` | string | Unit of measure (e.g., `%`, `CLP`, `index`) | Manual |
| `frequency` | string | `daily`, `monthly`, `quarterly`, `annual` | Manual |
| `source` | string | Source institution (e.g., `Banco Central`, `CMF`) | Manual |

Key series to track:

| `series_code` | Description | Frequency |
|---|---|---|
| `TPM` | Tasa de Política Monetaria | Per meeting |
| `IPC` | Índice de Precios al Consumidor (monthly change %) | Monthly |
| `IPC_YOY` | IPC YoY % | Monthly |
| `UF` | Unidad de Fomento daily value | Daily |
| `USD_CLP` | USD/CLP spot rate | Daily |
| `EUR_CLP` | EUR/CLP spot rate | Daily |
| `IMACEC` | Monthly Economic Activity Index (% change) | Monthly |
| `GDP_QOQ` | GDP quarter-on-quarter growth | Quarterly |
| `COPPER_LME` | Copper price LME (USD/lb) | Daily |

---

## Entity: NewsItem

A Chilean market or macro news item with buyside-oriented AI summary.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | string | Unique identifier | System / scraper |
| `headline` | string | News headline | Source publication |
| `source` | string | Publication or institution name (e.g., `df.cl`, `BCCh`, `CMF`) | Source |
| `timestamp` | string (ISO 8601) | Publication datetime | Source |
| `category` | enum | `Macro` \| `Company` \| `Regulation` \| `Earnings` \| `Market` | Classified |
| `summary` | string | 2–3 sentence buyside summary: what happened · why it matters · what is affected | AI-generated (future) |
| `affectedTickers` | string[] | Bolsa tickers directly referenced or likely affected | Analyst / AI |
| `affectedMacroVariables` | string[] | Macro series codes affected (e.g., `TPM`, `UF`, `IPC_YOY`) | Analyst / AI |
| `materiality` | enum | `High` \| `Medium` \| `Low` — investor relevance rating | Analyst / AI |
| `url` | string | Source URL (may be placeholder in MVP) | Source |

**MVP status:** Populated from static mock array in `src/data/news_mock.ts`. Live ingestion is future work.

**Future sources:** emol.com, df.cl, diarioestrategia.cl, CMF API, BCCh communications, company IR pages.

---

## Entity: DocumentRecord

An internal registry entry that represents a source document (CMF filing, earnings release, etc.) and stores a buyside-oriented AI-generated summary. This is a local abstraction — it does not download or cache actual PDF/HTML files in MVP.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | string | Unique identifier (e.g., `doc-he-001`, `doc-earn-3`) | System |
| `type` | enum | `hecho_esencial` \| `earnings_release` \| `financial_statement` \| `news_source` | Manual |
| `ticker` | string | FK → Company.ticker | Manual |
| `companyName` | string | Display name of the issuing company | Manual |
| `title` | string | Filing or document title | Manual / CMF |
| `date` | string | Publication or filing date (YYYY-MM-DD) | CMF / company |
| `source` | string | Source institution (e.g., `CMF`, `Bolsa de Santiago`) | Manual |
| `sourceUrl` | string | URL of the original document on the external source | CMF / company |
| `localStatus` | enum | `external_only` \| `placeholder` \| `synced_future` — tracks sync state | System |
| `summary` | string | Short plain-language summary (1–2 sentences) | Manual (MVP) |
| `aiSummary` | string | Buyside-oriented 4-element summary: event → relevance → price implication → watch item | AI-generated (future) / manual (MVP) |
| `keyPoints` | string[] | 3–5 structured bullet points for buyside analysis | Manual (MVP) |
| `relatedRecordId` | string | ID of the linked HechoEsencial or EarningsRelease record | Manual |
| `fileType` | enum | `pdf` \| `html` \| `xbrl` \| `press_release` \| `unknown` | Manual |

**`localStatus` values:**
- `external_only` — only the source URL is available; no local copy or sync planned yet (current MVP state for all records)
- `placeholder` — a local copy slot exists but is not yet populated
- `synced_future` — full local sync planned for a future phase

**MVP status:** 24 records in `src/data/documents.json`. All are `external_only`. No PDF download, scraping, or sync happens in MVP. The `sourceUrl` links to real CMF document pages.

**Accessor helpers:** `src/lib/data/documents.ts` exports `getAllDocuments()`, `getDocumentById()`, `getDocumentsByTicker()`, `getDocumentByRelatedId()`, `getDocumentsByType()`.

---

## Entity: Watchlist (future)

Associates a user with a set of tracked companies.

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK → auth.users (Supabase) |
| `ticker` | string | FK → Company.ticker |
| `position_size` | decimal | Number of shares held |
| `cost_basis_clp` | decimal | Average cost per share |
| `notes` | text | Free-form notes |
| `created_at` | timestamp | |

---

## Static Data Files (MVP)

During MVP all entities above are backed by static JSON files located at:

```
src/data/
  companies.json        — Company[]
  stock_prices.json     — StockPrice[] (latest close only)
  earnings.json         — EarningsRelease[]
  hechos_esenciales.json — HechoEsencial[]
  macro_indicators.json  — MacroIndicator[] (latest values per series)
```

These files are the source of truth during MVP. When Supabase is connected, these files are replaced by database queries. The TypeScript types derived from this dictionary must not change between phases — only the data source changes.
