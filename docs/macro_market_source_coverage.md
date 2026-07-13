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
| `fed-funds` | `FEDFUNDS` | monthly | none | 3.63% (Jun-2026) |
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
