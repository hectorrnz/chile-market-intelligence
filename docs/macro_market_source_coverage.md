# Macro/Market Source Coverage — FX, Rates, Copper, US Macro, Economic Calendar (Phase 8D + 8D.1)

This document records the source discovery performed for Phase 8D and its follow-up Phase 8D.1, mirroring
the discovery-doc convention already established for CMF/Hechos Esenciales (`docs/cmf_provider_discovery.md`),
CMF/XBRL financials (`docs/cmf_xbrl_provider_discovery.md`), and structured-notes market data
(`docs/structured_notes_market_data_sources.md`).

Scope: expand live macro coverage for Chile FX/rates, copper, US macro, and the economic calendar, using
only official sources or stable, clearly-labeled free sources. Per the standing policy: missing values
stay `unavailable`, never static-filled or guessed; a source is only wired in after live verification.

## Summary of decisions

| Area | Decision | Source | Status |
|---|---|---|---|
| Copper (USD/lb, monthly) | **Implement** | BCCh `F019.PPB.PRE.40.M` | Enabled |
| BTP-10, BCU-5, PDBC-90d, TPM-TNA | **Defer** (re-verified, unchanged) | BCCh BDE | No live series exists |
| EUR/CLP | **Implement (Phase 8D.1)** — was deferred in 8D, now wired | BCCh `F072.CLP.EUR.N.O.D` | Enabled |
| US macro (9 series) | **Implement** | FRED (St. Louis Fed) public CSV | Enabled |
| Nonfarm Payrolls (level) | **Defer (Phase 8D.1)** | FRED `PAYEMS` | Verified live but not wired — see §6 |
| Macro category classification | **Fixed (Phase 8D.1)** | — | Real bug fixed — see §7 |
| FX panel (Home page) | **Cleaned up — BCCh-only (Phase 8D.1)** | BCCh (usdclp, eurclp) | See §8 |
| Economic calendar (dates-only) | **Implement (Phase 8D.1)** | FRED Releases API (`FRED_API_KEY`) | 13 curated releases, dates only |
| Macro / US forex table | **Implemented then replaced (FX Data Task → FX Integrity Task)** | CurrencyFreaks (§13, deprecated) → **Frankfurter, no key** | 12 USD-base pairs + real 1D/YTD change — see §14 |
| Chile Macro-page FX depth table | **Removed from production (FX Integrity Task)** | was `fxRates.json` static/sample | No live/persisted backing existed — see §14 |
| Yield curve (both regions) | **Implement (Macro UX task)** | US: 5 already-verified FRED series · CL: 5 already-verified BCCh series | Today / 1-week-ago / prior-year-end — see §15 |
| Economic calendar current-month embed | **Implement (Macro UX task)** | Same FRED release calendar, explicit month window | Embedded on `/macro` main tab — see §15 |
| Macro subtitle / badge wording / Market Implication column | **Fixed (Macro UX task)** | — | See §15 |

## 1. Copper — implemented via BCCh

The original Phase 4B deferral was a genuine unit mismatch: BCCh's daily copper series
(`F019.PPB.PRE.100.D`) publishes in **USD/oz**, while the app's copper card expects **USD/lb**. Re-running
BCCh's official SearchSeries catalog this phase surfaced a second, previously-unnoticed series:

- **`F019.PPB.PRE.40.M`** — "Precio del cobre refinado BML (dólares/libra)" — **monthly**, already in
  **USD/lb**, the exact unit the UI expects. No unit conversion, no assumption — verified directly against
  the official SearchSeries/GetSeries catalog (never guessed).

Cross-checked (not as the source of truth, only as a sanity check) against Yahoo Finance's `HG=F` copper
futures contract for the same period — the BCCh reference price and the futures settle price move in the
same range and direction, consistent with BCCh publishing a genuine refined-copper reference price rather
than a mismapped series.

**Trade-off accepted:** this series is monthly, not daily — there is no official BCCh series in USD/lb at a
higher frequency. The UI already treats copper as a `high`-importance macro indicator without assuming daily
granularity, so this is a labeling/frequency fact (`frequency: 'monthly'` in the series registry), not a
degraded feature.

**Verified live (Phase 8D dry-run):** 131 raw monthly points → 118 stored (2016–2026 window), values in a
plausible USD/lb band (see `PLAUSIBILITY['copper']`).

## 2. BTP-10, BCU-5, PDBC-90d, TPM-TNA — re-verified, still deferred

Re-ran the SearchSeries catalog lookup for all four to check whether a new series had appeared since Phase
4B. Findings unchanged:

- **BTP-10** — no continuous secondary-market BTP rate exists in the BCCh catalog (only discrete auction
  results), same as Phase 4B.
- **BCU-5** — BCU bonds are effectively discontinued (last issued 2011–2013); BTU 5Y (already live) is the
  correct real-rate proxy and is not a substitute worth conflating with a distinct instrument code.
- **PDBC-90d** — confirmed the 90-day PDBC series (`...D090...`) has been dead since 2023-01-06 (no BCCh
  auctions of that tenor since); the active PDBC tenor is 14 days, a different instrument the UI does not
  currently model. Renaming/remapping the UI label was out of scope this phase.
- **TPM-TNA** — TPM itself *is* the nominal annual rate; no distinct "TNA" series exists at BCCh separate
  from TPM.

All four remain `verified: false, seriesId: null` in `bcchSeriesManualMap.ts` — never guessed, per the
project's standing "never set a seriesId you have not confirmed" policy.

## 3. EUR/CLP — verified in Phase 8D, wired in Phase 8D.1

`F072.CLP.EUR.N.O.D` ("Tipo de cambio nominal euro") was confirmed live against the official BCCh
SearchSeries catalog in Phase 8D but deliberately left unwired pending a UI slot decision. Phase 8D.1
re-confirmed it live (fresh `GetSeries` call — real recent daily values, ~1,040–1,054 CLP/EUR) and wired it
in as the FX panel's second BCCh-verified pair (see §8): added to `bcchSeriesManualMap.ts` (verified entry),
`macroSeries.ts` (new `eurclp` BASE entry, category `FX`), `macroIndicators.json` (static fallback entry),
and a new `macro_indicators` row inserted directly (a data operation, not a migration — the table has no
CHECK constraint on `id`). Live dry-run: 2,486 rows ingested and persisted successfully.

## 4. US macro — implemented via FRED (Federal Reserve Bank of St. Louis)

**Source chosen: FRED's public CSV "graph" endpoint**
(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES_ID>`). Verified live, Phase 8D:

- Genuinely free, official (FRED is the Federal Reserve Bank of St. Louis' own data platform).
- **No API key required** — this is the same public download mechanism `fredgraph.stlouisfed.org`'s own
  chart-embed feature uses, not a scrape of rendered HTML — a simple two-column CSV (`date,value`) is
  returned directly.
- No rate limiting encountered during discovery or the dry-run ingestion of all 9 series.

This directly satisfies the phase's "avoid new API keys unless clearly justified" and "avoid fragile
scraping" constraints — FRED is strictly better than either a paid vendor or a scraped page.

### Series mapped (all verified live, Phase 8D)

| Indicator id | FRED series | Frequency | Transform | Verified value (Phase 8D) |
|---|---|---|---|---|
| `fed-funds` | `DFEDTARU` (upper target limit — swapped from `FEDFUNDS`, Phase 8D.4, resampled month-end from FRED's native daily cadence) | monthly | none | 3.75% (2026-07-13) |
| `us3m` | `DGS3MO` | daily | none | — |
| `us2y` | `DGS2` | daily | none | — |
| `us10y` | `DGS10` | daily | none | 4.56% (2026-07-08) |
| `us20y` | `DGS20` | daily | none | — |
| `us30y` | `DGS30` | daily | none | — |
| `us-unemployment` | `UNRATE` | monthly | none | 4.2% (Jun-2026) |
| `us-cpi-mensual` | `CPIAUCSL` | monthly | `mom` (derived) | — |
| `us-cpi-anual` | `CPIAUCSL` | monthly | `yoy` (derived) | — |

`us-cpi-mensual` and `us-cpi-anual` intentionally share the **same** underlying FRED series
(`CPIAUCSL`, the seasonally-adjusted CPI index level) — CPI MoM% and CPI YoY% are two different
*transformations* of one index-level series, not two different official series. This mirrors the existing
BCCh pattern where IPC mensual/anual are both derived transforms over an index level, never two independently
fetched series that could silently drift apart.

### Deliberately NOT added this phase (candidates considered, rejected)

- **Nonfarm payrolls** — FRED has this (`PAYEMS`), but there is no existing `macro_indicators` UI slot for
  it and adding one is UI-model scope, not source-discovery scope. Flag for a future phase alongside NFP.
- **ISM/PMI** — the Institute for Supply Management does not publish this as a free FRED series (ISM's own
  index requires a paid subscription); no reliable free proxy was found. **Deferred**, per the phase's
  explicit "only if reliable" gate.
- **A dedicated recession/leading-indicator series** — FRED has several (e.g. the Conference Board's LEI is
  not on FRED directly; `USREC` recession-indicator dummy exists but is a binary 0/1 series, not a chart-
  worthy continuous metric matching this app's existing indicator format). **Deferred** — a binary series
  doesn't fit the existing `MacroIndicator` value/change model without a bespoke UI treatment, which is out
  of scope.

### Architecture

- `src/lib/providers/fredClient.ts` — server-only client; `isFredConfigured()` always `true` (no
  credentials needed); `parseFredCsv()` is a pure parser (FRED's `.` missing-observation marker → `null`,
  never `0` or `NaN`); `fetchFredSeries()` has the same `ProviderResult<T>` shape as `bcchClient.ts`.
- `src/config/usFredSeriesManualMap.ts` — mirrors `bcchSeriesManualMap.ts`'s verification discipline exactly:
  every entry is a **human-verified** `{ seriesId, verified, frequency, transformation, confidence,
  verificationDate, notes }` record. No code is ever guessed.
- `src/lib/providers/fredMacroProvider.ts` — implements the same `MacroProvider` interface as
  `bcchMacroProvider.ts` (`getIndicators`, `getHistory`), so the orchestrator treats both providers
  uniformly.
- `src/config/macroSeries.ts` — the registry's `merge()` function now dispatches each `BASE` entry to
  `bcchSeriesManualMap` or `usFredSeriesManualMap` based on its `sourceProvider` field (`'BCCh' | 'FRED'`).
  `getEnabledBcchSeries()` / `getEnabledFredSeries()` let each provider (and each ingestion script) see only
  its own series — a FRED-sourced series can never accidentally be sent to the BCCh client, or vice versa.
- `src/lib/providers/macroProvider.ts` — `resolveMacroIndicators()` now queries **both** providers in
  parallel and merges their results (a provider with nothing enabled for the requested region simply
  contributes nothing — never a hard error); `resolveMacroHistory()` dispatches to the single correct
  provider for the requested indicator, based on its `sourceProvider`. The Supabase-persisted read layer
  (Layer 1) and static-fallback layer (Layer 3) are **provider-agnostic already** — they key purely off
  `indicator_id`, so no changes were needed there for FRED history to persist and read back identically to
  BCCh history.
- `src/lib/ingestion/fredMacroIngestion.ts` + `scripts/ingest/fredMacro.ts` + `scripts/ingest/fredMacroCore.ts`
  — mirror the BCCh ingestion trio exactly (`runFredMacroIngestion`, CLI script, pure core helpers).
- `GET /api/cron/ingest-fred-macro` — Bearer `CRON_SECRET`, **not added to `vercel.json`** — manual/
  reviewable trigger only, same policy as the BCCh/CMF-XBRL/Yahoo-financials cron routes until stability is
  observed over time. No new cron schedule was added this phase per the explicit instruction not to
  schedule new cron jobs without justification.

### Two real production bugs caught and fixed during validation

- **Unbounded FRED fetches caused a timeout.** `fetchFredSeries` originally had no date-range parameter,
  so daily Treasury-yield series (`DGS10`, `DGS2`, `DGS3MO`, `DGS20`, `DGS30` — decades of history) were
  downloaded in full just to read the latest value, for both the indicators listing and history/ingestion.
  Fixed by adding `cosd`/`coed` support (FRED's own "chart observation start/end date" params) and scoping
  every call site (`getIndicators`, `getHistory`, the ingestion script, the cron route) to the window it
  actually needs — mirroring `bcchClient`'s existing `firstDate`/`lastDate` pattern.
- **FRED silently stalled requests with no descriptive `User-Agent`.** Even after the date-range fix,
  `GET /api/macro?region=US` still hung indefinitely (90+ seconds, no response) from the live Vercel
  deployment, while the identical request completed in under a second from a regular machine, and Yahoo
  Finance calls from that same deployment returned in ~2s — ruling out a general network or payload
  problem. Node's default `fetch` sends no descriptive User-Agent; FRED's edge appears to silently stall
  such requests rather than reject them outright. Fixed by sending an explicit UA string. Verified live:
  `/api/macro?region=US` now returns in ~2.6s.

### Plausibility bands added

`src/lib/providers/plausibility.ts` gained 9 new bands (`fed-funds`, `us3m`, `us2y`, `us10y`, `us20y`,
`us30y`, `us-unemployment`, `us-cpi-mensual`, `us-cpi-anual`) — same guardrail role as the existing Chile
bands: reject an implausible value (e.g. an index level mistaken for a rate) rather than display a wrong
mapping.

## 5. Economic calendar — deferred, unchanged

The calendar (`src/lib/data/calendar.ts`) remains **schedule-driven and synthetic** (deterministic recurring
release rules, not fetched from any external source) — the Phase 2F/8A design, honestly labeled as such
already. No new stable, free, structured (dates + values, not scraped HTML) economic-calendar source was
found during this phase's discovery pass:

- Government statistical-agency calendars (BCCh, INE, BLS, Fed) publish release *dates* on their own
  websites, but none expose a free, documented, machine-readable calendar API with consensus/prior
  values — only rendered HTML pages, which this project's standing no-scraping policy rules out.
- Paid calendar vendors (Trading Economics, Econoday, etc.) require a commercial API key — explicitly
  out of scope ("no paid/vendor APIs").

**Decision (as of Phase 8D): defer, unchanged.** Per the phase's calendar rule — "if no stable source exists,
document deferred status" — this is recorded here rather than building a fragile scraper or a
partially-fabricated calendar.
> **Superseded by §10.** A later read-only audit found the synthetic calendar's fabricated values were being
> mistaken for real data in production despite the "not represented as a live external feed" intent above —
> it was subsequently removed from every production route/page (see §10, "Calendar production-integrity
> fix"). The module itself is retained, explicitly marked test/demo-only in its own file header.

## 6. Nonfarm Payrolls — verified live, deliberately deferred (Phase 8D.1)

FRED's `PAYEMS` series ("All Employees, Total Nonfarm") was verified live via the same public CSV endpoint
used for the other 9 FRED series — real current values confirmed (e.g. 158,984 thousand for June 2026).

**Deferred, not wired.** `PAYEMS` is a cumulative employment **level** (thousands of persons), not the
month-over-month **change** that the conventional "Nonfarm Payrolls" headline print refers to (e.g. "+150K
jobs added"). Deriving that headline figure requires an absolute month-over-month *difference* transform —
a genuinely different operation from every transform already in `transforms.ts`'s vocabulary (`none` /
`yoy` / `mom` / `level-to-yoy` / `bp-to-pct`, all percentage-based or pass-through). Adding a new `diff`
transform type, threading it through both providers' shared math, and testing it properly is real new
architecture, not "straightforward" — showing the raw 158,984 (thousand) level as if it were the payrolls
print would be actively misleading. Per the phase's own instruction ("if NFP cannot be added cleanly,
document deferred status instead of overbuilding"), deferred here rather than built partially.

## 7. Macro category classification bug — fixed (Phase 8D.1)

**Bug (pre-existing, introduced before this phase, first flagged during Phase 8D validation):** both live
macro providers hardcoded a single category for every indicator — `bcchMacroProvider.ts`'s `toIndicator()`
always set `category: 'Rates'`, and `fredMacroProvider.ts`'s always set `category: 'US Rates'` — regardless
of the indicator's true category. Verified live before the fix: `GET /api/macro?region=CL` showed `tpm`,
`ipc-mensual`, `ipc-anual`, `uf-diaria`, `usdclp`, `imacec-anual`, `desempleo`, `cobre-lme`, and all Chilean
fixed-income rates **all** reporting `category: "Rates"`, even though their static fallback entries in
`macroIndicators.json` have correct, distinct categories (Inflation, FX, Activity, Labor, Commodities).
Copper (a commodity) and CPI/UF (inflation measures) would silently move into the wrong Macro-page section
once live data replaced the static fallback.

**Fix:** `MacroSeriesDef` (the single series registry, `src/config/macroSeries.ts`) gained a `category`
field — a new `MacroCategory` union matching `macroIndicators.json`'s existing category values exactly.
Every `BASE` entry now carries its correct category (verified against `macroIndicators.json` for every id
that has a static counterpart). Both providers' `toIndicator()` functions now read `def.category` instead
of a hardcoded literal. A regression test (`tests/macroSeriesDualProvider.test.ts`) asserts every
`MACRO_SERIES` entry's category matches its static-JSON counterpart exactly, so a newly-added series can
never silently fall into the wrong category again.

## 8. FX panel — cleaned up to BCCh-only (Phase 8D.1)

**Before:** the Home page's FX table (`src/data/fxRates.json`) rendered 23 currency pairs across 4 sections
(Key FX / # USD per / # of currency per USD / # of Yen per), all static, with fabricated source labels
("Bloomberg", "CoinMarketCap", "ICE / FRED") this project has never actually had a relationship with — only
`usdclp` (labeled "CLP" in that file) was coincidentally backed by a genuinely live BCCh series elsewhere in
the app (the Macro page's indicator table), while the FX panel itself never queried it.

**After:** the Home page's FX panel now renders directly from the live macro `FX` category
(`getByCategory('FX')` in `src/lib/data/macro.ts`) — the exact same category the Macro page's indicators
use, now correctly assigned per §7. This means the FX panel automatically inherits live/persisted/static
status via the existing `DataSourceBadge`, with zero new provider code. Currently 2 rows, both verified live
BCCh series: **USD/CLP** and **EUR/CLP** (see §3). The old sectioned layout, the "# of currency per USD"
helper label, and the "Static MVP sample" footer were all removed; the footer now reads "Source: Banco
Central de Chile (BCCh) — verified live pairs only".

**Pairs removed and why:** `fxRates.json` had 25 total rows across its 4 sections. 2 are kept (promoted to
the live FX-category path instead): **USD/CLP** (the file's `clp` row) and **EUR/CLP** (verified this
phase — see §3). The remaining **23 rows are removed from the FX panel**, all for the same documented
reason — **`no_verified_bcch_series`**: CLPCOP, DXY, Bitcoin, EURUSD, GBPUSD, AUDUSD, NZDUSD, USDMXN,
USDCOP, USDBRL, USDPEN, USDUYU, USDARS, USDKRW, USDJPY, USDCNY, USDCAD, USDCHF, USDHKD, USDTRY, EURJPY,
GBPJPY, CHFJPY. None of these has a confirmed live BCCh series — BCCh's FX catalog covers CLP-denominated
pairs only; a cross like EURUSD, USDJPY, or a DXY index level would need an entirely different, non-BCCh
provider, out of scope per the standing "no Frankfurter/Finnhub/paid vendors" rule. Separately (a
`static_sample_removed` concern, not pair-specific): the fabricated "Bloomberg"/"CoinMarketCap"/"ICE / FRED"
source attributions on these rows are removed along with them, since this project has never had a
relationship with any of those vendors.

`src/data/fxRates.json` and `src/lib/data/fxRates.ts` are left in place (the Macro page's separate "FX
depth" table — a different, sortable, curated-list feature — still reads from them) but are no longer
consumed by the Home page. Bringing the Macro page's FX depth table to the same BCCh-only standard is a
natural next step, not done this phase (it wasn't the specific artifact the reported symptoms — the
"# of currency per USD" label and "Static MVP sample" text — pointed to).

## 9. Economic release calendar — dates-only FRED calendar implemented (Phase 8D.1)

Phase 8D concluded no viable free economic-calendar source existed. Phase 8D.1 revisited this with a
server-only `FRED_API_KEY` (free, self-service, https://fred.stlouisfed.org/docs/api/api_key.html) newly
available, and found FRED's own **Releases API** (`https://api.stlouisfed.org/fred/release/dates`,
distinct from the public CSV graph endpoint) — a genuine, official, structured, dates-only source.

**Discovery process:** queried FRED's `/fred/releases` catalog (329 releases total) for keyword matches
against every target category (CPI, PPI, PCE, Employment Situation, JOLTS, ADP, GDP, Retail Sales,
Industrial Production, Housing Starts/Sales, Existing Home Sales, International Trade, FOMC, H.15,
Consumer Sentiment, ISM) — never guessed a release id. 15 matches found and verified against
`/fred/release/dates`; **University of Michigan Consumer Sentiment and ISM Manufacturing/Services PMI have
no matching FRED release** (searched, not guessed) — deliberately excluded rather than approximated.

**A real data-quality issue was found and excluded, not silently shipped:** live-testing all 15 candidate
releases over a 45-day window showed 13 behaving exactly as expected (a small number of correctly-spaced
discrete dates — e.g. CPI/PPI/Retail Sales each appeared ~monthly), but **release_id 101 ("FOMC Press
Release") and release_id 18 ("H.15 Selected Interest Rates") returned a release-date entry for essentially
every single consecutive calendar day** in the window (53 and 36 hits respectively, spanning every date) —
not discrete scheduled-event dates. This is a genuine FRED API/data-modeling quirk specific to those two
releases, confirmed by direct inspection of the returned dates. Both were removed from the curated allowlist
rather than displayed as near-daily "events," which would have made the calendar unusable. The final curated
allowlist (`src/config/fredReleaseAllowlist.ts`) has **13 entries** across 8 categories (Inflation, Labor,
GDP/Growth, Retail/Consumer, Housing, Trade, Industrial Production — `Monetary Policy` currently empty after
excluding FOMC/H.15).

**Architecture:** `src/lib/providers/fredReleaseCalendarClient.ts` (server-only, reads `FRED_API_KEY`) →
`src/lib/providers/fredReleaseCalendar.ts` (orchestrator: queries every curated release in parallel, tags
each event `datesOnly: true` with `actual`/`consensus`/`prior` always `null`) → `GET
/api/macro/fred-release-calendar` (public, sanitized — never echoes the key or a raw FRED payload; reports
`configured: false` with an empty list, not an error, when `FRED_API_KEY` is unset) →
`src/lib/data/fredCalendar.ts` (client-safe fetch helper, type-only import from the provider layer) → a new
panel on `/macro/calendar`, explicitly labeled "Dates only — no consensus" with a subtitle clarifying that
actual reported values come from the macro time-series indicators, sourced separately. At the time this
section was written, this panel sat additively below the existing synthetic schedule-driven table — see §10
below for the production-integrity fix that subsequently removed that synthetic table from production.

**No persistence, no migration, no new cron.** Every request live-queries FRED's Releases API directly
(13 parallel requests, ~60-day window); given the modest request volume and no rate-limit issues observed,
persistence was judged unnecessary complexity for this phase — a future phase could add it if usage patterns
justify it.

**Verified live (local):** all 13 releases queried successfully; 19 discrete, correctly-spaced upcoming/
recent events returned in a 45–60 day window (e.g. CPI 2026-07-14, PPI 2026-07-15, Retail Sales 2026-07-16,
GDP 2026-07-30, Employment Situation 2026-08-07) — no noise, no fabricated values.

## Cross-cutting notes

- **No secrets were required for the Phase 8D macro time-series sources** — FRED's CSV graph endpoint needs
  no key, and BCCh's existing SearchSeries/GetSeries credentials (already configured) were reused unchanged.
  **Phase 8D.1's release-date calendar is the one exception**: FRED's Releases API requires the free,
  server-only `FRED_API_KEY` (never `NEXT_PUBLIC_`, never sent to the browser — read only in
  `fredReleaseCalendarClient.ts`). The app runs fine with no key set; the calendar panel simply reports
  `configured: false` and shows nothing rather than erroring.
- **No raw HTTP payloads, .env values, or credentials appear in this document, any log, or any test
  fixture** — only series codes (which are public identifiers, not secrets) and already-public verified
  values.
- **No schema migration was needed.** The existing `macro_observations` / `macro_indicators` tables already
  support an arbitrary `source_provider` string and per-row `metadata` jsonb — FRED rows are written through
  the exact same `upsertMacroObservations()` repository function BCCh rows use, with `source_provider: 'FRED
  (St. Louis Fed)'` and `metadata.provider: 'fred'` distinguishing them.

## 10. Calendar production-integrity fix — synthetic table removed from production

A read-only audit of `/macro/calendar` (post-Phase 8D.1) found that the page rendered **two** sections: the
real FRED dates-only calendar (§9, unchanged) and a schedule-driven **synthetic table** above it
(`src/lib/data/calendar.ts`) showing deterministic pseudo-random forecast/actual/prior values via
`mulberry32(hash(key+date))` — including Chile rows whose event names referenced BCCh/INE by name despite
having zero actual BCCh/INE backing. The same synthetic module also powered a "today's releases" preview
widget on the Macro page (`/macro`). Both were fully production-reachable and could be mistaken for real
economic data, since they rendered with the same table styling as genuinely live indicator values and only a
generic disclaimer (`common.mvpNote`) — no dedicated synthetic-data label.

**Fix — removed from production, not merely relabeled:**
- `/macro/calendar` no longer imports `src/lib/data/calendar.ts` at all. The removed synthetic table (week
  navigation, free-text search, forecast/actual/prior columns, Chile + US rows) is gone; the page now shows
  only the real FRED dates-only calendar (§9, unchanged) plus a new honest **Chile release calendar: deferred**
  block (no fabricated rows — states plainly that no free/stable/structured official Chile release-date
  source has been verified, and that BCCh/INE macro *values* remain available via the macro indicators
  elsewhere in the app, separately from release *dates*).
- `/macro` (the Macro page) no longer imports `src/lib/data/calendar.ts` either. Its "today's releases"
  synthetic preview widget was replaced with a plain link out to `/macro/calendar` — same visual container,
  no fabricated table.
- `src/lib/data/calendar.ts` itself is **retained**, not deleted, since `tests/calendarSchedule.test.ts`
  (added when a real user-reported weekend-scheduling bug was fixed in the module) still exercises its pure
  date-scheduling logic as a regression guard. The file's header comment now explicitly reads
  "TEST/DEMO-ONLY — NOT IMPORTED BY ANY PRODUCTION ROUTE OR PAGE," and a new test
  (`tests/calendarProductionIntegrity.test.ts`) walks every file under `src/app/**` and asserts none of them
  import it — so it cannot silently be wired back into a production surface without a test failure.

**No new provider added; no scraping added.** Per this fix's explicit scope: no Finnhub, no Frankfurter, no
Investing.com/ForexPros crawling, no paid vendor calendar, no Chile HTML scraping, no PAYEMS diff-transform
work — all remain out of scope, matching §5's and §6's standing deferrals.

**Tests:** `tests/calendarProductionIntegrity.test.ts` (20 new) — no production file imports the synthetic
module; the module is explicitly marked test/demo-only; `/macro/calendar` renders no forecast/actual/prior
columns and no week-nav/search controls; the FRED section's dates-only/no-consensus labeling is unchanged;
the FRED provider's `actual`/`consensus`/`prior` fields are structurally `null`; the new Chile deferred copy
exists in both EN/ES and asserts "no verified official source"; the now-dead synthetic-table-only i18n keys
(`search`/`today`/`next`/`results`/`noResults`/`noToday`/`time`/`country`/`event`/`forecast`/`actual`/`prior`)
are confirmed removed; the Macro page's widget removal is confirmed; `FRED_API_KEY` handling (server-only,
never `NEXT_PUBLIC_`, never echoed in the route's JSON response) is unchanged and re-verified. Full suite
1278 → 1298/1298, lint 0, build 0 errors.

**Local validation:** `npm run supabase:check` / `supabase:check-macro` unchanged from baseline (22/22 macro
indicators healthy, `eurclp`/`cobre-lme` persisted correctly) — this fix touches only the calendar UI/i18n
layer, no macro ingestion or category logic.

Scope limits (explicit, unchanged from the fix's brief): no new economic-calendar provider; no Finnhub,
Frankfurter, Investing.com/ForexPros, or paid vendor sources; no Chile HTML scraping; no NFP PAYEMS
diff-transform; no visual redesign beyond the minimal content swap needed to remove fabricated data; no
financials/Structured Notes/auth/watchlist/portfolio changes.

## 11. Calendar actual/previous enrichment from primary official data (Phase 8D.3)

Builds on §9/§10: the FRED **release calendar** still supplies the release *dates* (§9), but each curated US
release is now enriched with **real `actual` and `previous` values** — replacing the "dates only" limitation
noted in §9. Consensus/forecast/surprise remain **unavailable by design** (no free official source provides
them; this is not a vendor-style calendar).

**Release-date source vs actual-value source — two distinct, honestly-labeled sources:**
- **Release dates:** FRED Releases API (`/fred/release/dates`, `fredReleaseCalendarClient.ts`) — unchanged.
- **Actual/previous values:** FRED **time-series** (the keyless public CSV endpoint `fredClient.ts` already
  uses for US macro), transformed via the shared `transforms.ts` logic. Each metric records its
  `originatingAgency` (BLS / BEA / Census / Federal Reserve) for provenance; the value we actually **fetch**
  is always FRED, and the UI labels it as such. We never claim to have called BLS/BEA/Census directly.

**Why FRED-normalized and not direct BLS/BEA/Census APIs — deferred, not skipped.** Direct integration of
the BLS, BEA, and Census APIs was assessed. FRED redistributes those agencies' primary series verbatim, and
every FRED series id used here was **verified live** (Phase 8D.3 — real Jun/2026 data returned) before being
added to `src/config/calendarEnrichmentMap.ts` — matching the project's standing never-guess-an-identifier
rule. Standing up three new keyed agency clients with unverified series/table/line-code mappings in one phase
would have been more error-prone and out of proportion to the value, so it is **deferred** and documented
here. The prompt explicitly authorized "FRED as normalized fallback where primary-source integration is not
practical in this phase" — that is the path taken.

**Release-to-source mapping** (`src/config/calendarEnrichmentMap.ts`, all series verified live):

| FRED release (id) | Metric(s) | FRED series | Transform | Originating agency |
|---|---|---|---|---|
| Consumer Price Index (10) | CPI y/y, CPI m/m | `CPIAUCSL` | `yoy`, `mom` | BLS |
| Producer Price Index (46) | PPI y/y, PPI m/m | `PPIFIS` | `yoy`, `mom` | BLS |
| Personal Income & Outlays (54) | PCE y/y, Core PCE y/y | `PCEPI`, `PCEPILFE` | `yoy` | BEA |
| Employment Situation (50) | Nonfarm Payrolls (m/m chg), Unemployment Rate | `PAYEMS`, `UNRATE` | `level-diff`, `none` | BLS |
| JOLTS (192) | Job Openings | `JTSJOL` | `none` | BLS |
| GDP (53) | Real GDP q/q (SAAR) | `A191RL1Q225SBEA` | `none` | BEA |
| Retail Sales (9) | Retail Sales m/m | `RSAFS` | `mom` | Census |
| Industrial Production (13) | Industrial Production m/m | `INDPRO` | `mom` | Federal Reserve |
| Housing Starts (27) | Housing Starts (SAAR) | `HOUST` | `none` | Census |
| New Residential Sales (97) | New Home Sales (SAAR) | `HSN1F` | `none` | Census |
| Int'l Trade in Goods & Services (51) | Trade Balance | `BOPGSTB` | `none` | BEA |

**Excluded, not fabricated:** ADP (release 194) — its FRED series `NPPTTL` is **stale** (latest obs 2022,
discontinued on FRED); Existing Home Sales (291) — NAR data, not a government agency. Both stay dates-only
(actual/previous rendered as unavailable) rather than shown with a stale or mislabeled number.

**Nonfarm Payrolls — headline monthly change, not the raw level.** `PAYEMS` is a cumulative employment
*level* (thousands of persons). A new `level-diff` transform (`transforms.ts`) derives the headline print
(`level[t] − level[t-1]`, e.g. +57K for Jun-2026) — the raw level is never shown as the headline. This is the
`diff` transform §5/§6/§10 repeatedly deferred; it is now implemented, bounded to this one use.

**Actual/previous semantics** (`src/lib/providers/calendarEnrichment.ts`): a **past** release shows the
latest published print as `actual` + the prior print as `previous` (`published`); a **scheduled** release
shows `actual = pending` (not yet published) + the last published print as `previous` (`pending`); a
failed/insufficient series is `unavailable` (never zero-filled). Enrichment is **best-effort** — any fetch
failure degrades that metric to `unavailable` and the dates-only calendar always still renders.

**Persistence:** none. Enrichment is computed live per request from FRED (deduped/parallel series fetches;
most enrichment series are not in `macro_indicators`, so deriving from persisted observations was not
possible without adding indicators — out of scope). A **weekday post-close refresh cron**
(`/api/cron/refresh-calendar-enrichment`, Bearer `CRON_SECRET`, `vercel.json` `30 22 * * 1-5`) recomputes the
enrichment ~30 min after the US close and returns a structured availability/health summary — stateless
(`persisted: false`), a post-close validity check rather than a data-write. `FRED_API_KEY` stays server-only.

**Tests:** `tests/calendarEnrichment.test.ts` (22 new — `level-diff` math, map shape/exclusions, buildEnriched
published/pending/unavailable, multi-metric releases, provider-error isolation via injected fetcher, cron
auth/no-key-leak, no forecast/surprise fields, vercel schedule) + `tests/calendarProductionIntegrity.test.ts`
updated for the new (real) actual/previous columns. Full suite 1298 → 1320/1320, lint 0, build 0 errors.

**Local validation (dev server, real FRED):** `/api/macro/fred-release-calendar?days=45` → `enriched: true`,
`consensusAvailable: false`, 22 enriched events; Trade Balance (past) `actual -77585 / previous -54570`
(published, BEA); CPI (upcoming) `actual pending / previous 4.17% y/y` (BLS); NFP `previous +57K` (level-diff,
never the raw 158,984 level); consensus null and no forecast/surprise field on any metric. Cron: 401 without
bearer, authorized run `status: success` (37 metrics, 0 unavailable). `supabase:check-macro` unchanged
(22/22 healthy).

Scope limits (explicit): actual/previous enrichment for curated US releases only; FRED-normalized sourcing
(direct BLS/BEA/Census API clients deferred, documented above); no consensus/forecast/surprise; no Finnhub/
Frankfurter/Investing.com/ForexPros/paid vendor; no Chile HTML scraping (Chile calendar stays deferred, §10);
no persistence/migration; no financials/Structured Notes/auth/watchlist/portfolio changes; no visual
redesign beyond adding the metric/actual/previous/source columns.

## 12. Fed Funds indicator swapped from effective rate to target range upper limit (Phase 8D.4)

A user-reported anomaly ("Fed Funds moved from 4.51% to 4.48% between points — that's not a multiple of
25bp, and there are ~8 FOMC meetings a year") led to a real finding: `fed-funds` was mapped to FRED's
`FEDFUNDS` — the **effective** federal funds rate, a volume-weighted-average market rate that floats
smoothly within/near the FOMC's target range and is not required to move in clean 25bp steps at meeting
dates. That's correct FRED data, just not what most readers mean by "the Fed funds rate."

**Swapped to `DFEDTARU`** — the FOMC's **target range upper limit**, the number markets actually quote (e.g.
"4.25–4.50%, upper bound 4.50%"). Verified live: current upper 3.75% / lower (`DFEDTARL`) 3.50% — a clean
25bp band, confirming `DFEDTARU` is a genuine step function that only changes on an FOMC decision date.

**Kept monthly periodicity, per instruction.** `DFEDTARU` is published **daily** by FRED (unchanged between
meetings, since it's a step function) — resampling it to raw daily rows would multiply stored/returned points
without adding real information and would break the monthly cadence every other US indicator uses. A new
pure helper, `monthEndSample()` (`src/lib/providers/transforms.ts`), downsamples to one observation per
calendar month (the latest real observation on/before each month's end — never invents a value). A new
`resample?: 'month-end'` field on `FredManualEntry`/`MacroSeriesDef` gates this, applied identically in all
three places raw FRED points are consumed for this series: `fredMacroProvider.ts` (live indicator + history
endpoints), `fredMacroIngestion.ts` (cron/API ingestion), and `fredMacroCore.ts` (CLI ingestion script) — so
the live display, the persisted Supabase history, and the manual CLI backfill can never disagree.

**No other series affected** — `resample` is undefined for every other FRED/BCCh entry, so their raw daily/
monthly cadence from FRED/BCCh is completely unchanged.

**Tests:** `tests/transforms.test.ts` extended with `monthEndSample` cases (multiple points per month keeps
only the latest; already-monthly input passes through unchanged; empty/single-point input; non-chronological
input order). Full suite passes (see validation below).

Scope limits: this single indicator swap only; no new FRED series added beyond `DFEDTARU`/`DFEDTARL`
(verification only, `DFEDTARL` not wired to any UI — it was fetched only to confirm the band width); no
change to any other US or Chile indicator's series/cadence/transform.

## 13. Macro / US forex table — CurrencyFreaks (unofficial third-party FX)

The Macro page's "FX depth" panel had two independent problems on the US side: it read from the same static
`fxRates.json` sample the 8D.1 fix already removed from the Home page's FX panel (fabricated "Bloomberg"
source attribution, no live/persisted path at all), and its 8-pair `US_FX` id list (`dxy, eurusd, gbpusd,
usdjpy, usdcny, usdcad, usdchf, usdkrw`) never matched the requested pair set. Chile's FX depth panel is
untouched — it stays exactly as it was (static sample, `CL_FX` id list), per the standing rule that Chile FX
is BCCh-official only.

**CurrencyFreaks** (`https://api.currencyfreaks.com/v2.0/rates/latest`) was chosen and wired for the Macro /
US table only. It is explicitly **not** presented as official — `sourceType: 'unofficial_third_party_fx'`
everywhere in code and copy, matching this project's "never call an unofficial source official" rule (the
same discipline already applied to Yahoo Finance fundamentals and the LatAm index proxies).

**Free-plan characteristics verified live** (2026-07-14, curl against the real endpoint, key never printed):
base is **USD-only** (no custom base currency available on this plan — confirmed via the real response's
`"base": "USD"` field); `rates` are returned as numeric strings; `date` was a midnight-UTC timestamp
(`2026-07-14 00:00:00+00`) and did not change across repeated same-day calls — the plan appears to publish
**one snapshot per day**, not intraday. No day-change, YTD-change, or historical-series field exists on this
endpoint at any tier used here. Consequently:
- The 6-hour server-side cache (`resolveUsForexTable()`, module-scope, per server instance) is conservative
  by design but not the limiting factor — the source itself would return the same value for the whole day
  regardless of cache TTL. Estimated monthly request volume at this TTL: at most 4 fetches/day × ~30 days
  ≈ **120 requests/month**, far inside any reasonable free-tier quota.
- **Day/YTD change columns are never fabricated.** `UsForexRow.dayChangePct`/`ytdChangePct` are typed `null`
  (not optional-zero) — the UI renders an "As of" timestamp column instead of a change column for this table,
  consistent with the "omit, don't fake" instruction.
- No historical endpoint was used or is needed — only `/rates/latest`.

**Pair methodology** (`src/lib/providers/currencyFreaksFxProvider.ts`, pure `buildUsForexRows()`): the
requested symbol set (EUR, GBP, JPY, CHF, CAD, AUD, NZD, MXN, BRL, CNY, KRW, TWD) is split into **8 direct
pairs** (USD/JPY, USD/CHF, USD/CAD, USD/MXN, USD/BRL, USD/CNY, USD/KRW, USD/TWD — the raw USD-base rate used
as-is) and **4 inverted pairs** (EUR/USD, GBP/USD, AUD/USD, NZD/USD — `1 / rate`, since CurrencyFreaks only
publishes the USD-base direction). Inverted pairs carry a `direction: 'inverted'` tag and render with a `†`
marker + an explicit "Derived (1 / USD-base rate)" disclaimer in the UI — never silently presented as if
CurrencyFreaks itself published the EUR-base rate directly. A rate that is missing, zero, negative, or
non-numeric for a given symbol is **omitted from the row list**, never coerced to zero or fabricated. If the
provider ever reports a non-USD base, the whole table fails closed (`ok:false`) rather than silently
mislabeling every derived pair — the pair methodology's correctness depends entirely on the USD-base
assumption holding.

**Architecture**: `currencyFreaksClient.ts` (server-only raw HTTP client — reads
`process.env.CURRENCYFREAKS_API_KEY` only, sanitizes any error text, 10s timeout, never throws) →
`currencyFreaksFxProvider.ts` (server-only orchestrator — pair methodology + the 6h cache + fail-closed base
check) → `GET /api/macro/fx/us` (public, sanitized, never echoes the key or raw provider JSON) →
`src/lib/data/currencyFreaksFx.ts` (client-safe fetch helper — only a TYPE import from the provider layer, so
no server code reaches the browser bundle) → the Macro page's US-region FX depth table (fetched lazily only
when `region === 'US'`, never on the Chile tab).

**No new env var pattern** — mirrors `FRED_API_KEY`'s existing server-only handling exactly
(`.env.example` documents it, never `NEXT_PUBLIC_`, never logged, blank-key path returns
`configured: false`/empty rows rather than erroring, matching the app's "must run with zero env vars" rule).

**Verified locally** (dev server, real key): `/api/macro/fx/us` → `ok: true`, `source: CurrencyFreaks`,
`sourceType: unofficial_third_party_fx`, `base: USD`, 12 rows, all 8 direct + 4 inverted pairs correctly
computed against the real live rates. Macro page US region renders the table with the `SourceStateBadge`,
the "As of" column, the `†`/disclaimer footer, and correctly shows **no** day/YTD columns. Chile region
regression-checked unchanged (same static table, same `CL_FX` list). Confirmed the API key never appears in
the Next.js client bundle (`.next/static`) — only in server-side build cache, which is not shipped to the
browser.

Scope limits (explicit): Macro / US forex table only; Chile FX untouched (stays BCCh-official/static, no
CurrencyFreaks call ever made for CL); no paid CurrencyFreaks tier/feature; no historical CurrencyFreaks data;
no non-USD crosses beyond the 4 documented inverted pairs; no fabricated day-change/YTD; no changes to
financials, Structured Notes, the economic calendar's actual/previous logic, or auth/watchlist/portfolio.

## 14. Macro / US FX moved to Frankfurter; real 1D/YTD change; Chile FX depth table removed

§13's CurrencyFreaks integration had a real limitation: its free-plan `/rates/latest` endpoint has no
day-change/YTD/historical field at all, so the Macro / US forex table could only ever show a static "last"
value with no change — never the 1D/YTD figures a genuine FX reference table needs. Separately, an audit for
this task found the Chile Macro-page "FX depth" table (`src/data/fxRates.json` via `getFxRates()`/`CL_FX`)
had **no live or persisted backing at all** — a pure static/sample table sitting in production next to
genuinely live BCCh data, exactly the pattern the no-static-terminal-state policy forbids.

**Frankfurter chosen and verified live** (2026-07-14, no API key, confirmed via `https://frankfurter.dev/`:
"Free, open-source exchange rates API sourcing from 84 central banks. Current and historical rates for 201
currencies. No API key required."). The real v2 REST shape (`https://api.frankfurter.dev/v2/rates`) was
verified directly, not assumed — it differs from the classic v1 `frankfurter.app` shape
(`{amount, base, date, rates: {...}}`): v2 returns a **flat array** of `{date, base, quote, rate}`, and uses
`quotes=` (not `symbols=`) for currency filtering. Confirmed the historical single-date path
(`?date=YYYY-MM-DD`) and the time-series path (`?from=...&to=...`) both work with `base=USD&quotes=...`. All
12 target currencies (EUR, GBP, JPY, CHF, CAD, AUD, NZD, MXN, BRL, CNY, KRW, TWD) confirmed present in
`/v2/currencies` — **no pairs were removed**, the full requested set is supported.

**A genuine data-quality question was investigated and resolved before wiring anything in**: querying single
weekend dates (e.g. a Saturday) returned a *slightly different* rate each day rather than the prior business
day's frozen value — unlike the classic ECB-only `frankfurter.app`, which correctly freezes at the last
business day for a weekend query (re-verified live on `frankfurter.app` for comparison). This is not
fabrication: v2 blends up to 84 real central-bank feeds (confirmed via `/v2/providers`, which lists each
contributing bank, its `rate_type`, and its own last-published date), so a weekend value can be a real, if
minor, multi-source blend rather than a single frozen ECB print. This is why the resolver never assumes any
particular day has data — it always queries a bounded window and picks whatever dates are actually present.

**Pair methodology, unchanged from §13's direct/inverted design** (`src/lib/providers/frankfurterFxProvider.ts`):
8 direct pairs (USD/JPY, USD/CHF, USD/CAD, USD/MXN, USD/BRL, USD/CNY, USD/KRW, USD/TWD — the raw USD-base
rate) + 4 inverted pairs (EUR/USD, GBP/USD, AUD/USD, NZD/USD — `1/rate`, marked `†` "derived" in the UI).

**1D/YTD change — real, computed from two bounded time-series calls per refresh, never fabricated:**
1. A **recent window** (last 10 calendar days through today) locates the two most recent *distinct* dates
   actually present in the response — `currentDate` and `previousDate`. This is deliberately date-arithmetic-
   free (no "yesterday = today − 1" assumption): whatever gap or oddity the provider has, the two latest real
   observations are used, tolerating any holiday/outage without special-casing weekends.
2. A **prior-year-end window** (Dec 20 → Dec 31 of the previous calendar year) locates the latest date on or
   before Dec 31 — `ytdBaseDate`. If nothing is found in that bounded window, `ytdBaseDate` stays `null` and
   every pair's `ytdChangePct` is `null` — never interpolated or guessed.
3. **1D % = (current/previous − 1) × 100; YTD % = (current/ytdBase − 1) × 100.** For inverted pairs, **both**
   snapshots are inverted first (`1/rate`) and the % change is computed on the *inverted* values — never
   derived from the raw USD-base quote's own change (a wrong-sign bug this project's tests specifically guard
   against: EUR/USD must go *up* when the raw USD-base EUR rate goes *down*).
4. Any pair whose previous/YTD-base rate isn't found in its window reports that one field as `null` (never
   `0`, never a stale/interpolated value) — the UI renders `—` for that cell only, the pair's current value
   and the other change still display normally.

**Caching — 2 Frankfurter calls per refresh, 6-hour server-side TTL** (unchanged conservative posture from
§13; Frankfurter has no published rate limit for its self-hosted-friendly free tier, so this is deliberately
generous, not a quota necessity). Estimated volume: at most 4 refreshes/day × 2 calls ≈ 8 requests/day ≈ 240/
month — trivial for a free, keyless, open-source API.

**Chile Macro-page FX depth table removed from production.** The CL region's second grid slot now shows a
plain integrity note ("A broader Chilean FX depth table is not shown here — verified BCCh-live pairs (USD/CLP,
EUR/CLP) are in the table above.") instead of the removed static table — no empty visual gap, no static data
presented as if live. Chile's genuinely live/persisted BCCh pairs (USD/CLP, EUR/CLP) are untouched and remain
visible in the main indicators table's FX category, exactly as before. `getFxRates()`/`CL_FX` are no longer
referenced anywhere in `macro/page.tsx`.

**`fxRates.ts`/`fxRates.json` retained but marked test/demo-only** — mirrors the `calendar.ts` precedent from
the calendar production-integrity fix (Phase 8D.2): the file header now explicitly reads "TEST/DEMO-ONLY — NOT
IMPORTED BY ANY PRODUCTION ROUTE OR PAGE," and `tests/frankfurterFx.test.ts` walks every file under `src/app`
and `src/lib/data` and fails if any of them import it — so it cannot silently be wired back into a production
surface without a test failure.

**CurrencyFreaks deprecated, not deleted.** `currencyFreaksClient.ts`/`currencyFreaksFxProvider.ts`/
`src/lib/data/currencyFreaksFx.ts` remain in the repo with explicit "DEPRECATED ... NOT IMPORTED BY ANY
PRODUCTION ROUTE OR PAGE" headers; `GET /api/macro/fx/us` now imports `frankfurterFxProvider.ts` instead.
`CURRENCYFREAKS_API_KEY` **remains configured in Vercel** (per instruction — never removed from the
environment) but is no longer read by any production code path. A regression test walks `src/app` and
`src/lib/data` and fails if any production file re-imports the deprecated provider/client.

**Tests:** `tests/frankfurterFx.test.ts` (new, 42 tests) — Frankfurter response parsing (latest/historical/
time-series), currency-code coverage, direct/inverted pair value + 1D/YTD math (including the inverted-sign
regression case above), weekend/holiday-tolerant date selection, missing-snapshot → `null` (never 0/
fabricated), caching, no-raw-payload leakage, Macro-page wiring, Chile-depth-table removal, CurrencyFreaks-
production-import guard, `fxRates.ts` production-import guard. `tests/currencyFreaksFx.test.ts` retained (25
tests) as regression coverage for the deprecated-but-kept low-level client/provider, updated to assert the
deprecation itself rather than production wiring. Full suite 1397 → **1436/1436**, lint 0, build 0 errors.

**Local validation (dev server, real Frankfurter):** `/api/macro/fx/us` → `ok: true`, `source: Frankfurter FX
reference`, `sourceType: free_third_party_fx_reference`, `currentDate: 2026-07-14`, `previousDate:
2026-07-13`, `ytdBaseDate: 2025-12-31`, all 12 pairs with real, distinct 1D/YTD percentages (e.g. USD/BRL YTD
−7.09%, AUD/USD YTD +3.68%). Macro / US page confirmed rendering the `SourceStateBadge`, Day/YTD columns with
real signed percentages, the `†`/attribution footer. Macro / Chile page confirmed rendering the integrity note
in place of the removed static table, live BCCh USD/CLP + EUR/CLP unaffected in the indicators table above. No
console errors. `supabase:check`/`supabase:check-macro` unchanged (this task touches no schema).

Scope limits (explicit): Macro / US forex table + Chile FX depth table removal only; no CurrencyFreaks
historical workaround; no paid FX API; no Frankfurter MCP server (direct REST API only, per instruction); no
broad FX architecture refactor; no changes to financials, Structured Notes, the economic calendar's actual/
previous logic, or auth/watchlist/portfolio; `CURRENCYFREAKS_API_KEY` left configured in Vercel, unremoved.

## 15. Live yield curves, region-aware subtitle, Update button, current-month calendar embed, "Live" badge wording, column removal (Macro UX task)

User-requested Macro page overhaul, six parts:

**1. Live yield curve data (both regions).** New `src/lib/providers/yieldCurveProvider.ts` (server-only)
builds today / 1-week-ago / prior-year-end for each region **reusing only already-verified series** — no new,
unverified series codes were introduced (network access to verify additional FRED tenors, e.g. DGS1MO/DGS6MO/
DGS1/DGS3/DGS5/DGS7, was unavailable from this task's sandbox; both `curl` and `WebFetch` against
`fred.stlouisfed.org` were blocked/403'd, consistent with fredClient.ts's own documented note that FRED's edge
requires a real browser-like User-Agent the app's own server-side client sends but this environment's tools
don't). US curve: the 5 already-enabled FRED series (3M/2Y/10Y/20Y/30Y). Chile curve: the 5 already-enabled
BCCh series (TPM, Cámara Swap 1Y/2Y, BTU 5Y/10Y) — the BTU tenors are UF-indexed **real** rates, not nominal,
so they're labeled `(UF)` rather than silently mixed into what would otherwise read as one homogeneous nominal
curve. For each target date, `latestOnOrBefore()` picks the most recent observation on/before that date from a
bounded fetch window (mirrors the Frankfurter FX task's "bounded window, never fixed date arithmetic"
pattern) — a tenor with no usable point for *any* of the 3 target dates is **dropped entirely** from all three
series rather than fabricated, keeping the arrays aligned index-for-index. Server-cached 6h, success-only
(a transient failure retries next request). New `GET /api/macro/yield-curve?region=CL|US` route; client-safe
`src/lib/data/yieldCurveLive.ts` helper. The Macro page falls back to the static `yieldCurves.json` sample
curve when the live fetch is unavailable/under-populated — verified live in the dev server for both regions
("Live BCCh" / "Live FRED" badges, real current dates in the footer).

**2. Green-dot badges now say "Live"; footnote convention `"Source: X as of Mon/DD/YY"` across Macro's
tables.** `src/lib/dataSourceRegistry.ts`'s `frankfurterLive`/`yahooLiveOverlay` labels reworded to lead with
"Live —" (all other `state:'live'` entries, e.g. `bcchLive`="Live BCCh", already followed this convention).
New `formatSourceDate()` (`src/lib/formatters.ts`) formats a YYYY-MM-DD string as `Mon/DD/YY` by parsing the
components directly (never via `new Date()`+`toLocaleDateString`, which can shift a day depending on the
reader's timezone). New shared `<TableSourceFooter source asOf />` component
(`src/components/ui/TableSourceFooter.tsx`) renders the standardized footnote; wired into the Macro page's
indicators table, yield curve, US forex table, and `/macro/calendar`'s FRED table, plus the Home page's
combined Macro card and FX table (both of which have a real per-row `lastUpdated` to compute a genuine as-of
date from — sector/index/rates panels on Home have no per-row date field and were left as their existing
honest "static sample" wording rather than fabricating a date).

**3. Update Data button on the Macro page.** Reuses the existing `<UpdateDataButton onRefresh={doRefresh} />`
component (already used on Home/Stocks/Portfolio/Company). `doRefresh` is a self-contained async function
(never called from inside a `useEffect` body — the React Compiler's `react-hooks/set-state-in-effect` lint
rule flags any effect that invokes a function it can trace into a `setState` call, even an async one whose
promise isn't awaited synchronously; every mount effect on this page keeps its original inline
`fetch(...).then(res => setState(res))` shape instead) that re-fetches indicators (both regions), the yield
curve, and — for the US region — the Frankfurter FX table and the current-month calendar, all via
`Promise.all`, refreshing exactly what's visible for whichever region tab is currently active.

**4. Current-month economic calendar embedded on the Macro main tab.** `resolveFredReleaseCalendar(daysAhead)`
in `fredReleaseCalendar.ts` was refactored into a thin wrapper over a new `resolveFredReleaseCalendarRange(start,
end)` (identical behavior, verified via the existing test suite unchanged) that accepts an explicit window
instead of a fixed 7-day-back rolling one. The API route (`GET /api/macro/fred-release-calendar`) now accepts
optional `start`/`end` query params (both must be valid `YYYY-MM-DD`) that take precedence over `days`. The
table markup itself was extracted from `/macro/calendar/page.tsx` into a shared
`src/components/macro/EconomicCalendarTable.tsx` so both pages stay pixel-identical. The Macro page computes
the current calendar month's `[1st, last day]` window (`currentMonthRangeIso()`, using the reader's local
clock, never UTC/fixed arithmetic) and embeds the table for the US region; Chile shows the same honest
"release calendar deferred" message `/macro/calendar` already shows (no fabricated Chile rows). "View full
calendar →" still links to `/macro/calendar` for other months.

**5. Region-aware subtitle — a real mislabeling bug fixed.** The Macro page's `SectionHeader` subtitle was
previously always `t.macro.subtitle`, a single fixed string reading "Sources: Banco Central de Chile (BDE) ·
INE · **Hacienda** · LME" — shown **even on the US tab**, incorrectly naming Chilean government agencies as
sources for FRED-backed US data. (Separately: Hacienda — Chile's Ministry of Finance — was never actually a
data source for any indicator in this app; the string appears to have been copied into the subtitle without
verification.) `t.macro.clSubtitle`/`t.macro.usSubtitle` already existed in `i18n.ts` but were dead code — never
wired to the `SectionHeader`. Fixed: the subtitle is now `region === 'CL' ? t.macro.clSubtitle :
t.macro.usSubtitle`, and both strings were corrected — CL: "Sources: Banco Central de Chile (BDE) · INE · LME"
(Hacienda removed); US: "Sources: Federal Reserve · BLS · BEA · FRED" (added BEA, which the FRED-sourced GDP/
PCE releases actually originate from, per `calendarEnrichmentMap.ts`'s existing `originatingAgency` field).

**6. Market Implication column removed.** The rightmost column on the indicators table (both regions) showed
`marketImplication` — static editorial commentary from `macroIndicators.json`, never a live/derived data
field — per explicit instruction. The column, its i18n header key (`t.macro.implication`), and the `Row.
implication`/`toRow()`/`clRatesRows` field mappings were removed from `macro/page.tsx`; the underlying
`marketImplication` field stays in `MacroIndicator`/`macroIndicators.json` (used elsewhere, e.g. document
drill-downs) — only the table column rendering it was dropped.

**Tests:** `tests/yieldCurveProvider.test.ts` (new, 14 tests — `latestOnOrBefore` pure logic, tenor-definition
hygiene guarding against any unverified series reference, mocked-network resolution for both regions including
tenor-dropping on partial data, `ok:false` on insufficient tenors, and cache behavior) + additions to
`tests/fredReleaseCalendar.test.ts` (3 new — `resolveFredReleaseCalendarRange`'s explicit-window behavior,
configured:false short-circuit, and a regression check that `resolveFredReleaseCalendar(daysAhead)`'s own
7-day-back rolling window is unchanged) + additions to `tests/formatters.test.ts` (4 new — `formatSourceDate`
formatting, timezone-safety, and malformed-input passthrough). Full suite 1436 → **1456/1456**, lint 0, build 0
errors (13 → 14 API routes, new `/api/macro/yield-curve`).

**Local validation (dev server, real BCCh/FRED/Frankfurter):** both Macro regions confirmed rendering
correctly — CL: subtitle without Hacienda, no Market Implication column, table footer "Source: Banco Central de
Chile (BCCh) as of Jun/17/25", yield curve **"Live BCCh"** with real TPM/1Y/2Y/5Y(UF)/10Y(UF) values and a
real as-of date, honest Chile-calendar-deferred message. US: subtitle without Chilean agencies, table sources
correctly "Federal Reserve (via FRED)"/"US Treasury (via FRED)"/"BLS (via FRED)" (never Chilean), yield curve
**"Live FRED"** with real 3M/2Y/10Y/20Y/30Y values, current-month (July 2026) FRED calendar embedded with real
CPI/PPI/GDP/PCE/Retail Sales/Housing/Trade events, FX table showing **"Live — Frankfurter FX reference (free
third-party)"**. Clicked Update Data on both regions — server logs confirmed every expected endpoint
(`/api/macro`, `/api/macro/yield-curve`, `/api/macro/fx/us`, `/api/macro/fred-release-calendar`) re-fetched
successfully with no errors. Home page's Macro card and FX table confirmed rendering the new
`"Source: X as of Mon/DD/YY"` footer format with real dates. No console errors on any page.

Scope limits (explicit): this Macro-page UX task only — the broader "all tables of the platform" footer/badge
sweep (task ask #2) was applied to the Macro page (all 3 tables), `/macro/calendar`, and the Home page's
Macro/FX panels (the sections with a genuine per-row as-of date); Home's sector/rates/index panels, and other
pages' static-only footers (Compare, Charting, Earnings, Hechos, Watchlist, Portfolio, Structured Notes) were
left unchanged — they have no real per-row date to report and already carry honest "static sample" wording, so
converting them to the new footer format would either fabricate a date or require deeper per-page plumbing
beyond this task's scope. US yield curve stays a 5-tenor curve (vs. the prior 11-tenor static sample) pending
live verification of FRED's other constant-maturity series from an environment with network access. No new
dependency, no schema/migration change, no changes to financials/Structured Notes/auth/watchlist/portfolio.

Next: verify and add the remaining FRED Treasury tenors (1M/6M/1Y/3Y/5Y/7Y) to enrich the US yield curve;
consider extending the `"Source: X as of Y"` footer convention to Home's sector/rates/index panels if a
meaningful as-of date becomes available for them; periodically re-check for a live Chile release-date source
for the current-month calendar embed's Chile side.
