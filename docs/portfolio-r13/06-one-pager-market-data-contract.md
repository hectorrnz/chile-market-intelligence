# R13.0 · Document 06 — One Pager Content and Market-Data Contract

**Phase:** R13.0 — documentation only.
**Sources inspected:** worksheet `1 Pager` (definitions only — **not an upload source**) and
`one-pager-reference.pdf`.

---

## 1. Status of the `1 Pager` worksheet — PROPOSED

**There is no One Pager upload.** The worksheet was inspected solely to recover definitions, source
mappings, formulas, and benchmark identities. It must never become an ingestion source.

This is corroborated by the sheet itself: every value cell is either a cross-reference into `RESUMEN`
(e.g. `C7 = +[1]RESUMEN!B7`, `D7 = +[1]RESUMEN!X7`) or a hardcoded pasted market price. It is a
**presentation layer over RESUMEN**, which is precisely what NMI will regenerate natively.

Rows 81–90 carry the literal marker **`eliminar`** ("delete") in column B — legacy scaffolding the
author has already flagged for removal. Never ingested.

---

## 2. Verified One Pager content — from the reference PDF

Everything inside the blue border of `one-pager-reference.pdf`, verified against the workbook and
against my own extraction:

### 2.1 `Cierre Semanal` (top-left)

Header `31-07-2026`, subtitle `cifras en dólares`. Four columns:

| `Inicio de Año` `02-01-2026` *(highlighted)* | `24-07-2026` | `31-07-2026` | `Diferencia` |
|---|---|---|---|

Rows: `Caja y Equivalentes`, `Renta Fija`, `Renta Variable`, `Opciones`, `Inmobiliario`,
`Venture Capital / Private Equity`, `INRETAIL PERU CORP`, **`SUBTOTAL`**, `ACCIONES CHILENAS (USD)`,
**`TOTAL`**.

> This is the **exact** Beginning-of-Year / Previous-Week / This-Week / Difference presentation the
> R13 contract requires, already in use. Every figure reconciles to the workbook (doc 04 § 2).

### 2.2 Two performance blocks (left, green headers)

`PORTAFOLIO EX ACCIONES CHILENAS` and `PORTAFOLIO CON ACCIONES CHILENAS`, each with:
`Aportes / Retiros de la Semana`, `Retorno de la semana`, `Utilidad de la semana`,
`Retorno del Año`, `Utilidad del Año`.

### 2.3 `DISTRIBUCIÓN DE LOS ACTIVOS` (top-right)

A table of asset-class weights on **three bases** — `Total`, `Sin Acc Chile`,
`Sin Acc Chile Sin Inretail` — plus a pie chart.

Corroborated in the workbook: `RESUMEN` `DG5 = "Allocation Portfolio"` with
`DG6 = líquido ex INRETC1`, `DH6 = total con INRETC1`, `DI6 = líquido con INRETC1`; and `1 Pager`
`CM7 = +$CK7/SUM($CK$7:$CK$13)` (all rows) vs `CN7 = +$CK7/SUM($CK$7:$CK$12)` (excluding the last
row) — two denominators, matching the two "sin" bases.

**PROPOSED:** allocation percentages are `nmi_calculated` from published snapshot values. All three
bases are reproduced; each column states its denominator explicitly.

### 2.4 `Evolución del Patrimonio` (bottom-right)

**Two** line charts — `Sin acciones chilenas` and `Con acciones chilenas` — plotting portfolio value
across the full weekly history.

**PROPOSED:** rendered with the existing `LineChart` (measured width, responsive, `prefers-reduced-motion`
honoured) from published snapshots. No new charting dependency.

### 2.5 `Resumen Semanal` (bottom-left)

Three columns (BoY, previous week, this week):

- **`Portafolio`** — `Aportes o Retiros (USD)`, `Retorno durante la semana`,
  `Mayor o Menor valor del portafolio`
- **`Inretail`** — `Precio de cierre (USD)`, `Variación del precio`,
  `Mayor o menor valor en el portafolio`
- **`Variaciones de la semana`** — `Renta Variable Mundial`, `Promedio de Renta Fija Mundial`

### 2.6 Commentary and disclaimers

- **`Movimientos destacados de la semana:`** — free-text administrator commentary. Two lines in the
  sample; the workbook marks them with `Comentario` in column A (`A53`, `A54`, `A55`).
- **Scope note** — `Se consideran Dubai, Watermill, Naidelt, Retboy y Vanglor para el stock.`
- **Provisional-data disclaimer** — `*** Todos los precios son provisionales en base a la info de
  Bloomberg o últimos cierres informados por cartolas`

> **PROPOSED:** the provisional disclaimer is **mandatory** on the generated One Pager. The source
> itself declares its prices provisional; NMI must not present them as final.

---

## 3. Benchmark definitions — VERIFIED NUMERICALLY

The `1 Pager` market block (`Información para el cierre`, rows 65–79) is **100 % hardcoded** — zero
formula cells across rows 66–79. The definitions therefore could not be read from formulas and were
instead **proven numerically** across all **80** week-over-week pairs in the sheet.

Instruments collected (row → Bloomberg-style label):

| Row | Label |
|---|---|
| 66 | `ACWI US EQUITY` |
| 67 | `SPX INDEX` |
| 68 | `EZU US EQUITY` |
| 69 | `URTH US EQUITY` |
| 70 | `EEM US EQUITY` |
| 71 | `AGGG LN Equity` |
| 72 | `GHYG US Equity` |
| 73 | `CEMB US Equity` |
| 75 | `INRETC1 PE Equity` |

Derived rows: 77 `Bolsas Mundiales`, 78 `Promedio Renta Fija`, 79 `Inretail`.

### 3.1 Results

| Hypothesis | Matches | Mismatches | Verdict |
|---|---|---|---|
| `Bolsas Mundiales` = **ACWI weekly price return, alone** | **80** | 0 | **CONFIRMED** |
| `Bolsas Mundiales` = average of ACWI+SPX+EZU+URTH+EEM | 0 | 80 | **REJECTED** |
| `Promedio Renta Fija` = **arithmetic mean of AGGG, GHYG, CEMB weekly price returns** | **80** | 0 | **CONFIRMED** |
| `Promedio Renta Fija` = AGGG alone | 0 | 80 | **REJECTED** |
| `Inretail` = **INRETC1 weekly price return** | **78** | 0 | **CONFIRMED** (2 weeks n/a — missing price) |

All confirmed matches are exact to < 1e-9.

> **Answering the brief directly:** **`Global Equity` is ACWI alone — it is *not* an average of the
> equity instruments.** The competing hypothesis was tested and fails on every single week.

### 3.2 Role of SPX, EZU, URTH, EEM — VERIFIED

These four are **collected but unused**. They feed no One Pager output: `Renta Variable Mundial`
(row 49) references row 77, and row 77 is ACWI alone on all 80 pairs. They are also not inputs to
`Promedio Renta Fija`.

**Classification: unused reference data.** They appear to be maintained as background market context
for the author's own reading.

**PROPOSED:** do **not** display them on the generated One Pager. Do not silently drop them either —
record in `docs/data_source_status.md` that they exist in the source and are deliberately not
surfaced, so a future request to add a "market context" strip has a documented starting point.

### 3.3 Formula mapping

| One Pager row | Formula | Resolves to |
|---|---|---|
| 44 `Precio de cierre (USD)` | `+D75` | INRETC1 price |
| 45 `Variación del precio` | `+E79` | INRETC1 weekly return |
| 46 `Mayor o menor valor en el portafolio` | `+E$13-D$13` | **week-over-week change in the `INRETAIL PERU CORP` portfolio line** — a portfolio value delta, *not* a price-derived estimate |
| 49 `Renta Variable Mundial` | `+E77` | ACWI weekly return |
| 50 `Promedio de Renta Fija Mundial` | `+E78` | mean of AGGG/GHYG/CEMB |
| 39 `Aportes o Retiros (USD)` | `+D20` | RESUMEN flow row |
| 40 `Retorno durante la semana` | `+D21` | RESUMEN weekly return |
| 41 `Mayor o Menor valor del portafolio` | `+D22` | RESUMEN weekly profit |

**Important:** row 46 is `nmi_calculated` from **published portfolio snapshots**, not from market
data. It requires no market feed at all.

---

## 4. Market-data architecture audit

### 4.1 What is needed

Only **five** instruments are actually required to regenerate the One Pager:

| Instrument | Purpose | Currency |
|---|---|---|
| `INRETC1 PE Equity` | InRetail closing price + weekly variation | USD (per `Precio de cierre (USD)`) |
| `ACWI US EQUITY` | Global equity weekly variation | USD |
| `AGGG LN Equity` | Global fixed-income component | **USD-denominated, London-listed** |
| `GHYG US Equity` | Global fixed-income component | USD |
| `CEMB US Equity` | Global fixed-income component | USD |

All five are exchange-listed ETFs or equities. **No new provider is required.**

### 4.2 Existing capability — VERIFIED

| Capability | Existing implementation | Fit |
|---|---|---|
| Arbitrary-symbol historical bars | `yahooHistoryProvider.ts` → `getYahooStockHistory()` wrapping `yf.chart(symbol, …)` | direct fit — symbol is a parameter |
| Batched quotes | `/api/market/live-snapshot` | reusable |
| Static → persisted → live tiering | `marketProvider.ts` (`MARKET_DATA_MODE`) | reusable pattern |
| Symbol mapping convention | `TICKER_YF`, `INDEX_YF` in `liveOverlay.ts` | extend with a new map |
| Persistence | `stock_snapshots` / `index_snapshots` | reusable shape |
| Refresh via committed snapshot | `refresh-market-data.yml` (Python/yfinance) | available if request-time proves unreliable |

**PROPOSED:** add `src/config/onePagerBenchmarks.ts` — a pure, client-safe map from the Bloomberg-style
label to the resolution symbol, mirroring `yahooMacroSeries.ts` (which exists precisely so a page can
label a chart without importing a server-only provider).

### 4.3 Symbol resolution — UNVERIFIED, must be confirmed live

The project's standing rule is absolute: **never guess an identifier.** Candidate mappings:

| Source label | Candidate | Status |
|---|---|---|
| `ACWI US EQUITY` | `ACWI` | plausible; **must be verified** |
| `GHYG US Equity` | `GHYG` | plausible; **must be verified** |
| `CEMB US Equity` | `CEMB` | plausible; **must be verified** |
| `AGGG LN Equity` | `AGGG.L` | plausible; London listing — **must be verified**, and its quote currency confirmed (the ETF is USD-denominated but a venue may quote otherwise) |
| `INRETC1 PE Equity` | `INRETC1.LM` | **least certain.** Lima-listed; Yahoo's coverage of the Lima exchange is thin. Must be verified, and if history is unavailable this is a genuine blocker |

**PROPOSED:** R13.1 runs a one-time discovery script that, for each candidate, fetches ~90 days of
history and asserts: non-empty series, plausible price band, expected quote currency, and — the
decisive test — that recomputing the weekly returns reproduces the workbook's own hardcoded rows 77,
78, 79 for recent weeks. A candidate that fails is recorded `verified: false` and its metric renders
`unavailable`. **A benchmark is never published from an unverified symbol.** This mirrors the
`bcchSeriesManualMap.ts` discipline exactly.

**Precedent warning — VERIFIED:** `^IPSA` returns metadata but only a *single* history bar from
Yahoo at request time. A symbol resolving is **not** evidence its history resolves. The discovery
script must test history, not quotes.

### 4.4 Weekly-close alignment — PROPOSED

The workbook's `PX_LAST` header carries the same weekly dates as `RESUMEN`, and those dates are
**mostly Fridays but not exclusively** (verified: the RESUMEN series includes `2025-04-17`,
`2025-08-14`, `2025-09-22`, `2026-01-02` — Thursdays, Mondays, and holiday-shifted dates).

**Rule:** for a publication week `W`, use each instrument's **last available close on or before `W`**,
within a **5-calendar-day lookback**. If no bar exists in that window, the instrument is
`unavailable` for that week and its derived metric renders `—`. Never interpolate, never carry
forward beyond the window, never substitute a different index.

Each instrument's actual observation date is stored, and the UI discloses it when it differs from the
publication date.

### 4.5 Currency

All five instruments are USD-denominated, matching the portfolio's USD base. **No FX conversion is
required, and none may be introduced** — the standing rule against fabricating an FX-converted figure
applies (doc 03 § 4.2).

### 4.6 Missing / stale observations — VERIFIED as a live condition

The sample already contains gaps: `INRETC1` is missing for the week of `2025-04-17`
(`Q75 = #N/A N/A`), producing `#VALUE!` in `Q45`, `Q79`, and `R79`; and one column lacks all three
fixed-income instruments.

**PROPOSED:** a missing observation yields `unavailable` for that instrument and for any metric
derived from it. The One Pager still renders, with `—` and an explicit note. It never shows a stale
number as current, never zero-fills, and never omits the row silently.

### 4.7 Prohibitions

- No HTML scraping of any market source.
- No parallel market-data architecture — reuse `marketProvider`/`yahooHistoryProvider`.
- No paid vendor, no Bloomberg (NMI has no Bloomberg relationship; the source's Bloomberg dependency
  is precisely what R13 replaces).
- No new charting or HTTP dependency.

---

## 5. Generated One Pager — content contract

| # | Element | Source | Class |
|---|---|---|---|
| 1 | Closing / as-of date | confirmed publication date | `source_value` |
| 2 | BoY / previous-week / this-week / difference comparison | published snapshots; difference derived | `source_value` + `nmi_calculated` |
| 3 | Main asset classes | published snapshot rows | `source_value` |
| 4 | Total portfolio | `TOTAL` row | `source_value` |
| 5 | Portfolio excluding Chilean equities | `SUBTOTAL` row | `source_value` |
| 6 | Portfolio including Chilean equities | `TOTAL` row | `source_value` |
| 7 | Contributions / withdrawals | flow rows | `source_provided_flow` |
| 8 | Weekly return | performance row | `source_provided_return` |
| 9 | Weekly profit / loss | performance row | `source_provided_return` |
| 10 | Year-to-date return | performance row (chain-linked) | `source_provided_return` |
| 11 | Year-to-date profit / loss | performance row | `source_provided_return` |
| 12 | Asset allocation (3 bases) | snapshot values | `nmi_calculated` |
| 13 | Portfolio evolution (2 charts) | full published history | `source_value` |
| 14 | InRetail closing price | market data | `live`/`persisted` |
| 15 | InRetail weekly price variation | market data | `nmi_calculated` |
| 16 | InRetail portfolio value impact | `INRETAIL PERU CORP` row Δ | `nmi_calculated` |
| 17 | Global equity weekly variation | ACWI | `nmi_calculated` |
| 18 | Global fixed-income weekly variation | mean(AGGG, GHYG, CEMB) | `nmi_calculated` |
| 19 | Administrator weekly commentary | `portfolio_commentary` | administrator input |
| 20 | Source status | per-element badge | — |
| 21 | Data freshness | portfolio as-of + market as-of + alternatives as-of | — |
| 22 | Provisional / published status | publication state | — |
| 23 | Provisional-price disclaimer | mandatory (§ 2.6) | — |

**Layout may be reordered** for client interpretability and rebuilt in the Fable language (doc 07).
**Content may not be dropped**, and Fable sample financial data must never appear.

---

## 6. Acceptance criteria

- [x] `1 Pager` confirmed as a definition source only, never an upload
- [x] All blue-border content enumerated from the reference PDF
- [x] `Bolsas Mundiales` proven to be ACWI alone (80/80), average-of-five rejected (0/80)
- [x] `Promedio Renta Fija` proven to be the mean of AGGG/GHYG/CEMB (80/80)
- [x] `Inretail` proven to be INRETC1's weekly price return (78/78 available)
- [x] SPX/EZU/URTH/EEM classified as unused reference data with evidence
- [x] Existing market-data architecture assessed; no new provider needed
- [x] Symbol candidates listed as **unverified** with a mandatory live-verification protocol
- [x] Weekly-close alignment, currency handling, and missing-observation behaviour specified
- [x] Scraping / parallel architecture / paid vendor prohibitions restated
