# Product Specification — Chile Market Intelligence

## Purpose

Chile Market Intelligence is an internal buyside web terminal for a family office that invests in Chilean public markets. It aggregates Chilean stock data, macroeconomic indicators, earnings releases, and regulatory filings (Hechos Esenciales) into a single, dense, institutional-grade interface.

The product is not a SaaS tool. It is an internal workbench.

---

## Target User

A Chilean family office analyst or principal who:
- Tracks a concentrated portfolio of Chilean listed equities.
- Monitors CMF filings and corporate actions daily.
- Needs a single place to cross-reference macro context, earnings, and price action.
- Does not need consumer-grade UX — prefers information density over visual simplicity.

---

## Pages and Tab Structure

### 1. Home Dashboard (`/`)

A one-screen summary of what matters today. Think of it as the morning briefing page.

Content:
- Date and market status (open/closed).
- Key macro indicators at a glance (UF, USD/CLP, overnight rate).
- Recent Hechos Esenciales (last 3–5 filings).
- Upcoming earnings this week.
- Watchlist price summary (static in MVP).

Design: three-column layout at desktop width. Timestamps on every row.

#### Chilean News sub-module

A monitoring panel below the main grid. Shows Chilean macro and company-specific news in institutional format.

Each item includes:
- Headline
- Source, timestamp, category tag, materiality badge (High / Medium / Low)
- 2–3 sentence buyside AI summary: what happened · why it matters · what is affected
- Affected tickers and macro variable chips

**Future news sources (not connected yet):**
| Source | Coverage |
|---|---|
| emol.com | General business news |
| df.cl | Financial / market news |
| diarioestrategia.cl | Capital markets / strategy |
| CMF Hechos Esenciales | Corporate material events |
| Banco Central de Chile | Monetary policy / data releases |
| Company IR pages | Earnings, capex, strategy updates |

**Current status (MVP):** Static mock data in `src/data/news_mock.ts`. Live ingestion via scraper or API is a future phase. Do not connect external sources until explicitly instructed.

---

### 2. Stocks (`/stocks`)

A sortable table of Chilean listed companies tracked by the office.

Columns (MVP — static data):
- Ticker
- Company name
- Sector
- Last price (CLP)
- 1-day change (%)
- 52-week high / low
- Market cap
- P/E ratio (trailing)
- Last updated

Detail view: clicking a row opens `/stocks/[ticker]` — the Company Detail page.

Future: live prices from Bolsa de Santiago / Brain Data API.

---

### 3. Macro (`/macro`)

A dashboard of Chilean macroeconomic indicators.

Sections:
- **Monetary Policy**: Tasa de Política Monetaria (TPM), Banco Central meeting dates.
- **Inflation**: IPC monthly, IPC YoY, UF value and trajectory.
- **Currency**: USD/CLP spot, EUR/CLP, historical chart.
- **Activity**: IMACEC monthly, GDP quarterly.
- **External**: Copper price (LME), terms of trade index.

Each indicator shows: current value, prior value, date, source label.

Future: Banco Central BDE API, CMF, Hacienda.

---

### 4. Earnings (`/earnings`)

A calendar and results log for Chilean listed companies.

Tabs within the page:
- **Calendar**: upcoming earnings dates by company.
- **Results**: table of reported quarters — EPS, revenue, YoY growth, beat/miss vs. consensus.
- **Transcripts / Summaries**: placeholder for future AI summaries of earnings calls.

MVP: all data loaded from a static JSON file or CSV. No live feed yet.

---

### 5. Hechos Esenciales (`/hechos-esenciales`)

A feed of CMF-registered material disclosures (Hechos Esenciales and Información de Interés).

Columns:
- Date/time received
- Company
- Ticker
- Filing type (Hecho Esencial / Información de Interés / Ad-hoc)
- Short description
- Link to CMF PDF

MVP: static JSON array with example filings. Future: CMF API or scraper.

Filters: by company, by date range, by filing type.

---

### 6. Company Detail (`/stocks/[ticker]`)

A full-page profile for a single company. Template-driven — same layout for all companies.

Sections:
- Header: ticker, name, sector, exchange.
- Price chart placeholder.
- Key financial metrics table (trailing twelve months).
- Recent earnings history.
- Recent Hechos Esenciales from this company.
- Notes field (future: saved to Supabase per user).

---

### 7. Watchlist / Portfolio (future, not in MVP)

- User-defined list of tickers with position sizes.
- P&L tracking.
- Alert configuration (price threshold, new HE filing).
- Requires authentication and Supabase backend.

---

### 8. Document Viewer (`/documents/[id]`)

An internal drill-down page for a single source document — a CMF filing, earnings release, or other regulatory disclosure.

This is not a PDF viewer. It is a buyside summary page that links out to the original source and presents an AI-generated analysis alongside key structured points.

**Header:**
- Document title and company name
- Ticker link → Company Detail
- Document type, filing date, source institution
- Sync status pill (`External only` in MVP)

**Body sections:**
- **AI Summary** — 4-element buyside analysis: what happened → why it matters → price/macro implication → what to monitor going forward
- **Key Points** — 3–5 numbered bullets with structured observations
- **Related links** — back to the filing list (HE or Earnings) and the company overview

**Open Source button:** Links to `sourceUrl` — the original document on CMF or the company's IR page. Opens in new tab.

**MVP note banner:** States clearly that this is a static placeholder and live document sync is planned for a future phase.

**Access path:** Users reach this page by clicking "View Summary" links in:
- Hechos Esenciales table (rightmost column)
- Earnings results table (rightmost column)
- Home hechos and earnings panels (→ arrow link)

**Future:** Real-time document sync using CMF API; AI summary generation via Anthropic API on document ingest.

---

## What We Are Deliberately Not Building Yet

- Authentication or user accounts.
- Live API connections (all data is static in MVP).
- Portfolio P&L or position tracking.
- Price chart rendering (placeholder divs only).
- Push notifications or alerts.
- Admin panel or content management.
- Mobile layout optimization.
- Multi-user or multi-portfolio support.

These are Phase 2+ features and should not influence MVP architecture decisions.

---

## Data Sources (Future Integration Targets)

| Source | Data | Status |
|---|---|---|
| Banco Central BDE API | TPM, IPC, IMACEC, UF, USD/CLP | Future |
| CMF API / scraper | Hechos Esenciales, company registry | Future |
| Bolsa de Santiago / Brain Data | Stock prices, OHLCV | Future |
| Manual CSV / JSON | Earnings, financial metrics | MVP fallback |
| Supabase Postgres | All persistent storage | Future |

---

## Success Criteria for MVP

- All five pages render with static data.
- Tables are sortable.
- Clicking a stock row opens the company detail page.
- The design is institutional and readable at desktop width.
- The project is deployable to Vercel with `vercel deploy`.
