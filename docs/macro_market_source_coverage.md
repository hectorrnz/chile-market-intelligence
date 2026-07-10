# Macro/Market Source Coverage — FX, Rates, Copper, US Macro, Economic Calendar (Phase 8D)

This document records the source discovery performed for Phase 8D, mirroring the discovery-doc convention
already established for CMF/Hechos Esenciales (`docs/cmf_provider_discovery.md`), CMF/XBRL financials
(`docs/cmf_xbrl_provider_discovery.md`), and structured-notes market data
(`docs/structured_notes_market_data_sources.md`).

Scope: expand live macro coverage for Chile FX/rates, copper, US macro, and the economic calendar, using
only official sources or stable, clearly-labeled free sources. Per the standing policy: missing values
stay `unavailable`, never static-filled or guessed; a source is only wired in after live verification.

## Summary of decisions

| Area | Decision | Source | Status |
|---|---|---|---|
| Copper (USD/lb, monthly) | **Implement** | BCCh `F019.PPB.PRE.40.M` | Enabled |
| BTP-10, BCU-5, PDBC-90d, TPM-TNA | **Defer** (re-verified, unchanged) | BCCh BDE | No live series exists |
| EUR/CLP | **Defer** (verified, not wired) | BCCh `F072.CLP.EUR.N.O.D` | Verified but out of scope this phase |
| US macro (9 series) | **Implement** | FRED (St. Louis Fed) public CSV | Enabled |
| Economic calendar | **Defer** (unchanged) | — | No stable free structured-event source found |

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

## 3. EUR/CLP — verified, deliberately not wired this phase

While cross-checking Chile FX coverage, `F072.CLP.EUR.N.O.D` ("Tipo de cambio nominal euro") was confirmed
live against the official BCCh SearchSeries catalog — a genuine, correctly-identified series, not a guess.

It is **not** wired into the live macro registry this phase because `eur-clp` does not yet exist as a row in
the `macro_indicators` table, and `macro_observations.indicator_id` has a foreign-key constraint against that
table. Adding a new `macro_indicators` row is a data operation (not a schema migration, since the table has
no CHECK constraint on `id`), but doing so — plus adding the corresponding static-fallback JSON entry, UI
card, and i18n labels — is UI/data-model surface beyond this phase's scope of "expand FX rates and calendar
sources" without a corresponding UI slot already existing. Documented here so a future phase can wire it in
directly without re-discovering the series code.

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

**Decision: defer, unchanged.** Per the phase's calendar rule — "if no stable source exists, document
deferred status" — this is recorded here rather than building a fragile scraper or a partially-fabricated
calendar. The existing synthetic calendar continues to serve its stated purpose (a realistic release
schedule for UI/testing) and is not represented anywhere as a live external feed.

## Cross-cutting notes

- **No secrets were required for any implemented source this phase** — FRED's CSV endpoint needs no key,
  and BCCh's existing SearchSeries/GetSeries credentials (already configured) were reused unchanged.
- **No raw HTTP payloads, .env values, or credentials appear in this document, any log, or any test
  fixture** — only series codes (which are public identifiers, not secrets) and already-public verified
  values.
- **No schema migration was needed.** The existing `macro_observations` / `macro_indicators` tables already
  support an arbitrary `source_provider` string and per-row `metadata` jsonb — FRED rows are written through
  the exact same `upsertMacroObservations()` repository function BCCh rows use, with `source_provider: 'FRED
  (St. Louis Fed)'` and `metadata.provider: 'fred'` distinguishing them.
