# Structured Notes Module — Design (Phase 9A)

The Structured Notes module (`/structured-notes`, ES **Notas Estructuradas**) replaces the legacy
`NUEVA BASE - Notas Estructuradas.xlsx` operating model with an **automation-first** application: the primary
workflow is *upload a term-sheet PDF → auto-extract terms → review → import → auto-fetch live levels →
auto-compute barriers/risk/exposure*. Manual entry and editing exist only as a fallback/override path, never
as the terminal design.

See `docs/structured_notes_workbook_mapping.md` for the full workbook audit and PDF→field mapping.

## End-state workflow (target)

1. User uploads a structured-note PDF (`POST /api/structured-notes/extract`).
2. Terms are extracted deterministically (`src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts`).
3. Extracted fields are validated against critical-field rules; low-confidence/missing-field extractions are
   flagged for human review (not auto-imported).
4. On confirm, the note + underlyings + barriers + coupon schedule + autocall schedule + provenance are
   persisted (`POST /api/structured-notes/import`).
5. Current underlying levels are fetched automatically via the existing Yahoo provider
   (`structuredNoteMarketProvider.ts`) — replacing the workbook's Bloomberg `BDP` calls.
6. Distance to barriers, coupon/autocall eligibility, worst performer, current notional at risk, and issuer
   exposure are computed by pure functions (`calculations.ts`).
7. Human review is reserved for low-confidence or ambiguous extraction — not routine data entry.

**Phase 9A delivers the foundation + a working MVP for the Citi CGMFL family** (steps 1–6 functioning for that
family; step 7 review UI in place). Generalization to more issuers/families and scheduled observation-event
automation are later phases.

## Architecture

| Layer | File(s) |
|---|---|
| DB schema (7 tables, user-scoped RLS) | `supabase/migrations/20260706000000_structured_notes_foundation.sql` |
| Domain types | `src/lib/structuredNotes/types.ts` |
| Pure calculations (workbook parity) | `src/lib/structuredNotes/calculations.ts` |
| Underlying → Yahoo symbol map | `src/lib/structuredNotes/underlyingSymbolMap.ts` |
| Live prices (Yahoo, no Bloomberg) | `src/lib/structuredNotes/structuredNoteMarketProvider.ts` |
| PDF text extraction (server-only) | `src/lib/structuredNotes/pdf/pdfText.ts` (`unpdf`) |
| Deterministic term parser (pure, multi-issuer router) | `src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts` (thin entry point) → `pdf/parsers/index.ts` + per-issuer modules |
| Repository (user-scoped) | `src/lib/db/repositories/structuredNotesRepository.ts` |
| API routes | `src/app/api/structured-notes/**` |
| UI (list + detail) | `src/app/structured-notes/{page,[id]/page}.tsx` |

## Database schema (7 tables)

All tables are **user-scoped** (`user_id default auth.uid()`), RLS `auth.uid() = user_id`, no public
read/write. Child tables additionally have an ownership-guard trigger validating the parent note belongs to
the user (RLS alone cannot validate a cross-table FK).

- `structured_notes` — the note header + terms + barriers + source/provenance/confidence.
- `structured_note_underlyings` — one row per underlying, with initial/strike/barrier levels + Yahoo symbol.
- `structured_note_observations` — coupon/autocall/final schedule rows (`observation_type` ∈ coupon/autocall/final; status ∈ scheduled/observed/coupon_paid/coupon_missed/autocalled/matured/cancelled).
- `structured_note_allocations` — **internal** entity/sociedad split (never from the PDF).
- `structured_note_price_snapshots` — persisted live levels (Yahoo). Compute-on-request today; persistence reserved.
- `structured_note_extraction_runs` — one audit row per extraction attempt (confidence, warnings, errors, payload).
- `structured_note_extracted_fields` — per-field provenance (raw excerpt, confidence, page, section, warning).

## Calculation methodology (workbook parity)

- Barrier level = strike × barrier % (workbook R28/R29).
- Caída a la Barrera = barrier level / current level − 1 (workbook R60/R62); negative = headroom.
- Worst-of: status driven by the weakest underlying. Coupon paid iff **all** underlyings ≥ their coupon
  barrier on an observation date; autocall iff **all** ≥ their autocall barrier.
- Current notional = 0 if called/matured/cancelled, else the sum of active allocations (workbook R52).
- Issuer/entity exposure = current notional grouped by issuer / sociedad (workbook R66–R73 `SUMIF`).
- **Never NaN/Infinity** — every guard returns `null`. **Missing market data → `unavailable`**, never a
  fabricated price or status.

## PDF extraction confidence model

- `high` — value read from an exact table label + adjacent value (most General-Information fields, barriers,
  underlying rows, schedule pairs).
- `medium` — value derived (e.g. annualized coupon computed from periodic × frequency when only one is stated).
- `low` — value absent or only weakly inferred.
- Extraction is **rejected/flagged** (`ok:false`, `needsReview:true`) if any critical field is missing: ISIN,
  issuer, trade date, maturity date, ≥1 underlying with an initial/strike level, barriers, coupon rate, or a
  schedule. An invalid extraction is **never persisted** — the import route re-validates server-side.
- Overall `confidenceScore` = fraction of critical fields present (0–1).

## Human-review exception workflow

The list page shows the extraction preview with a confidence chip and any warnings/errors before import. A
note only persists on explicit user confirm. Low-confidence (<0.9) or error-bearing extractions surface
`Needs review`. Routine, high-confidence Citi-family term sheets require only a confirm click — no data entry.

## Security

- All routes are authenticated-only (middleware protects `/structured-notes` + `/api/structured-notes`).
- PDF upload: server-side parsing, `application/pdf` MIME check, 10 MB size limit, Node runtime; the raw PDF
  is never persisted or echoed back to the client (only the structured payload + provenance are returned).
- No service-role key in client code; the admin client is not used for these user-scoped tables.
- Errors are sanitized (no JWTs/keys in responses).

## Shared book (Phase 9B)

The structured-notes tab is a **single shared book**: migration
`20260706120000_structured_notes_shared_book.sql` changes RLS from per-user to *any authenticated user*
(`auth.uid() is not null`), drops the ownership-guard triggers, and makes ISIN globally unique. Every signed-in
user of the internal terminal sees the same positions and the same book-level dashboard (live count, in/out of
the money, about-to-autocall, exposure) — auto-populating as PDFs are uploaded. `user_id` is retained only as
an upload/audit stamp. Public/anon access remains blocked.

## Multi-issuer extraction (Phase 9B)

The parser (`PARSER_VERSION 9B.multi.1`) handles multiple issuer templates for the shared autocallable
worst-of Phoenix-memory product: multi-format dates (`Month DD, YYYY`, `DD Mon YYYY`, `DD/MM/YYYY`), label
aliases, flexible underlying rows (2–5 trailing levels, inline or preceding ticker), and both the Citi
two-block and the EU combined schedule tables. Verified over the real book: **27/45 term sheets extract at
confidence 1.0 — every recent Citi and HSBC.** Unhandled templates flag for review with honest gaps.

## Multi-issuer parser architecture (Phase 9C)

`extractStructuredNoteTerms.ts` is now a thin entry point over an **issuer-parser router**
(`src/lib/structuredNotes/pdf/parsers/`):

| File | Role |
|---|---|
| `types.ts` | Shared contracts: `Line`, `IssuerParseContext`, `IssuerParser`, `DetectedIssuer`, `ReviewState` |
| `shared.ts` | Pure utilities reused by every parser — date/number/percentage parsing (incl. ordinal-date stripping), label lookup (per-line and wrap-tolerant "joined" variants), issuer-name mapping, mixed-ticker-cell parsing, barrier-role classification, review-state classification, `dedupeObservationsByDate` |
| `citiHsbcParser.ts` | The original Phase 9B generic parser, unchanged in behavior — also the **router's fallback** for any undetected issuer |
| `creditAgricoleParser.ts`, `bnpParibasParser.ts`, `barclaysParser.ts`, `bbvaParser.ts` | One module per newly-supported issuer (Phase 9C) |
| `index.ts` | `detectIssuer()` (keyword-based, never guesses between two issuers) + `extractWithRouter()` dispatch |

**Issuer detection is keyword-based and exclusive**: each issuer's regex is specific enough that two
issuers' names never collide in the same document. An unrecognized issuer falls through to the generic
Citi/HSBC parser, which is safe because it already requires every critical field before reporting `ok: true`
— an unsupported format naturally fails its critical-field checks rather than being mis-parsed with the
wrong issuer's label aliases. If the generic parser *also* can't identify any issuer display name, the router
adds an explicit `unsupported issuer format` error so the UI can show a distinct "Unsupported issuer format"
state rather than a generic "Review required".

### Confidence thresholds and review states (`classifyReviewState` in `shared.ts`)

| State | Condition | UI label |
|---|---|---|
| `ready` | `ok:true`, confidence ≥ 0.90, zero low-confidence fields | "Ready to import" |
| `review_recommended` | `ok:true`, confidence ≥ 0.70 but some field is low-confidence or below 0.90 | "Review recommended" |
| `review_required` | `ok:false` (any critical field missing) **or** confidence < 0.70 | "Review required" |
| `unsupported` | Issuer could not be identified at all | "Unsupported issuer format" |

Critical fields (unchanged from Phase 9B): ISIN, issuer, trade date, maturity date, ≥1 underlying with an
initial/strike level, barriers, coupon rate, ≥1 observation. A missing critical field **always** forces
`review_required`/`unsupported` regardless of how many other fields extracted cleanly — confidence can never
promote an incomplete extraction to "ready".

### Per-issuer notes

- **Crédit Agricole** ("Climber Reload Autocall" family): numbered-section layout (`3) Underlying(s)`,
  `4) Indicative Barrier Level(s)`, …). Barriers are labeled **Interest Barrier → couponBarrierPct**,
  **Early Redemption Barrier → autocallBarrierPct**, **Final Redemption Barrier → knockInBarrierPct** — but
  the Final Redemption Barrier is only treated as a true knock-in equivalence at `high` confidence when the
  payoff wording ("Performance is higher than or equal to X% on the Redemption Observation Date") *confirms*
  the same percentage; otherwise it's used at `medium` confidence with an explicit review warning, never
  silently assumed. Two schedule tables share an identical `t <date> <date> <pct>% <pct>%` row shape;
  underlying/barrier table rows are matched **positionally** (by table order), not by name-string matching,
  since the underlying's display name ("S&P 500 INDEX") and its Bloomberg-derived ticker ("SPX Index") share
  no substring.
- **BNP Paribas** ("Phoenix Snowball" certificates): dates are ordinal (`April 09th, 2025`) — handled
  generically by `parseTermSheetDate`'s ordinal-suffix stripping (`normalizeOrdinalDate` in `shared.ts`), so
  no BNP-specific date code is needed. Several labels wrap **mid-phrase** across physical lines in the real
  PDF text extraction (e.g. "Redemption Valuation" / "Date October 09th, 2026") — every label lookup in this
  parser goes through the whitespace/newline-tolerant `extractAfterLabel`/`labelDateJoined` helpers rather
  than the per-line `labelValue`/`labelDate`. The underlying table row is a single clean physical line that
  directly gives absolute initial/knock-in/autocall/coupon-barrier **levels** (no percentage-of-strike
  computation needed).
- **Barclays** (`Worst-of European Barrier Autocallable`): the underlying table's ticker cell mixes Bloomberg
  and Refinitiv codes inline (`(Bloomberg Screen: SPX Index; Refinitiv Screen: .SPX)`) — Bloomberg is always
  the source of truth for market-data mapping (`parseMixedTickerCell` in `shared.ts`); the Refinitiv code is
  kept only as a metadata field, never used for pricing. The real sample's cover-page underlying summary is
  rendered as an extremely narrow multi-column box — pdf.js's text extraction turns it into ~1 word per line
  and **splits several multi-digit price levels mid-decimal** across two lines (e.g. "5,183.5" then a lone
  "4"). `reconstructSplitDecimals()` rejoins these defensively, but only when the digit fragment is **entirely
  alone on its own line** (bounded by newlines on both sides) — this is what distinguishes a genuine
  split-decimal continuation from an unrelated row index that merely starts the next line. If a given
  Barclays layout doesn't fit this pattern, the level simply isn't recovered and the underlying is left with
  a warning rather than a mis-aligned number.
- **BBVA** (EU "Pricing Supplement" family): the most conservative of the four, for two reasons. (1) Format —
  a full legalistic Part A/Part B contractual-terms document (numbered clauses), not a compact one-page term
  sheet, so fields are extracted from clause text rather than a table; the two barrier clauses use
  distinctly-worded thresholds ("is **equal to or greater than** 65%" for the coupon condition vs "is
  **greater than or equal to** 100%" for autocall) which is what lets them be told apart without ambiguity.
  (2) The real sample is itself explicitly a **draft** ("DRAFT FOR DISCUSSION PURPOSES … Subject to
  completion") — when that marker is present, this parser **always** returns `ok:false` (forcing
  `review_required`), regardless of how cleanly the individual fields extracted, because the source document
  itself declares every term provisional. An ISIN found only inside an unrelated boilerplate clause of a draft
  document is flagged with an explicit "verify manually" warning rather than trusted at face value.

## Scheduled monitoring (Phase 9D)

Turns the compute-on-request dashboard (Phase 9B) into **scheduled, persisted monitoring**: a daily cron
route fetches current underlying levels, persists a price-snapshot row per underlying, evaluates any
observation whose valuation date has arrived, and applies one conservative automatic status transition.
The on-demand "Update" button is unchanged — it stays an **immediate refresh** (fetch-and-display, no
persistence), while the scheduled job is the **primary, automated path** going forward, per the module's
automation-first requirement.

### Monitoring data policy

- **Current underlying levels are MONITORING INPUTS**, not an official calculation-agent determination.
  The source (`yahoo-finance`) and an `asOf`/`price_date` are recorded on every persisted row, and every
  UI surface that shows a monitoring-derived value carries an explicit disclaimer to that effect.
- **Missing or unsupported prices → `unavailable`**, never a fabricated level — an underlying with no
  Yahoo symbol simply has no snapshot; the note's risk status and observation eligibility both fall back
  to `unavailable`/`reviewRequired` rather than guessing.
- **Coupon and autocall observations CAN be evaluated deterministically** once their valuation date
  arrives: the worst-of barrier math itself is exact, and a regular-market price is an adequate signal for
  a binary "at/above the level" check. A clean, complete evaluation is the one case allowed to
  automatically transition an observation's status (`coupon_paid`/`coupon_missed`/`autocalled`) and, for
  autocall specifically, the note's own status (`active` → `autocalled`).
- **Final/maturity observations are NEVER auto-finalized.** `evaluateFinalObservation` always sets
  `reviewRequired: true` — the exact redemption amount is a legal determination this app cannot make
  without an official calculation-agent or verified closing-price feed, so it is always surfaced as an
  estimate pending manual verification, never written as a terminal `matured` status.
- **A note a user has archived (or that is already in a terminal state) is never reactivated or
  overwritten** by scheduled monitoring — `getActiveStructuredNotesForMonitoring` filters to `status:
  'active'` only, and `shouldUpdateNoteStatus` additionally guards against touching an already-archived
  note (defense in depth).

### Architecture

| Layer | File(s) |
|---|---|
| Pure monitoring calculations | `src/lib/structuredNotes/monitoring.ts` — snapshot building, staleness detection, worst-of observation evaluation (coupon/autocall/final), conservative status-transition rules, dashboard aggregates |
| Market data wrapper | `src/lib/structuredNotes/structuredNoteMonitoringProvider.ts` — batched Yahoo fetch with per-symbol success/failure accounting for honest `partial_success` reporting |
| Repository | `src/lib/db/repositories/structuredNotesRepository.ts` — `getActiveNotesForMonitoring`, `insertStructuredNotePriceSnapshots` (upsert), `getLatestStructuredNotePriceSnapshots`, monitoring-run create/complete, `updateObservationResult`, `updateNoteStatusFromObservation` |
| Cron route | `POST/GET /api/cron/structured-notes/snapshot` — Bearer `CRON_SECRET`, service-role admin client (no user session exists for a scheduled job) |
| Status route | `GET /api/structured-notes/monitoring-status` — authenticated, user-session client, read-only |
| Schema | migration `20260709000000_structured_notes_monitoring.sql` |

### Schema additions (migration `20260709000000_structured_notes_monitoring.sql`)

- `structured_note_price_snapshots.user_id` is now **nullable** — the cron writes via the service-role
  admin client, which has no JWT/session, so `default auth.uid()` can no longer populate it. This is
  consistent with (not an exception to) the Phase 9B shared-book model, which already redefined `user_id`
  on these tables as an upload/audit stamp rather than an ownership mechanism.
- `structured_note_observations` gains: `observed_at`, `observed_source`, `observed_source_symbol`,
  `observed_levels` (jsonb), `worst_performer_ticker`, `worst_performer_return`, `coupon_eligible`,
  `autocall_eligible`, `final_barrier_breached`, `review_required` (default `false`), `review_reason`.
  These are set only by the monitoring job and are distinct from the extraction-time terms
  (`coupon_due_pct`, `autocall_barrier_pct`, `coupon_barrier_pct`) already on the same table.
- New table `structured_note_monitoring_runs` — a system-level audit log (no `user_id`, mirrors the
  module's existing `structured_note_extraction_runs` precedent rather than the generic `ingestion_runs`
  table). RLS: `select` for any authenticated user, **no insert/update/delete policy at all** — writes are
  service-role only.

### Cron schedule

`vercel.json`: `30 21 * * 1-5` (weekdays, 21:30 UTC). This is fixed after the US market's 4:00pm ET close
in both the EDT (UTC-4, → 4:30pm ET) and EST (UTC-5, → 5:30pm ET) halves of the year — Vercel Cron has no
timezone parameter, so a single UTC time was chosen that stays safely post-close year-round rather than
drifting into pre-close territory across the DST boundary. Once per weekday, matching the "no intraday
guarantee, no hourly polling" scope for this phase.

### Observation-event automation summary

| Observation type | Automatic status transition | Note status transition |
|---|---|---|
| Coupon | `coupon_paid` / `coupon_missed` (clean data) or `observed` (missing data → reviewRequired) | none |
| Autocall | `autocalled` (clean, eligible) or `observed` (ineligible or missing data) | `active` → `autocalled` (clean, eligible only) |
| Final | always `observed`, always `reviewRequired: true` | none — never auto-`matured` |

### Known monitoring limitations

- **No official calculation-agent or verified closing-price feed** — every level is a Yahoo Finance
  monitoring estimate, explicitly labeled as such everywhere it's surfaced.
- **No paid/vendor data, no Bloomberg** — same policy as the rest of the module.
- **No intraday guarantee** — the cron runs once per weekday after the US close; a note's risk status
  between runs reflects the last snapshot, flagged stale beyond a 4-day window (`detectStalePrice`).
- **Global (non-US) underlyings may need provider expansion** before this monitoring policy extends
  cleanly to them — out of scope for this phase (see "Phase 9E" in the implementation plan).
- **Final/maturity payoff always requires manual verification** — this is a deliberate, permanent policy
  in the absence of an official source, not a temporary gap expected to close on its own.

## Phase 9E — Free market-data architecture + observation QA hardening

Phase 9D's monitoring relied on Yahoo Finance directly with no abstraction, no cross-checking, and no
structured quality signal beyond a binary missing/present price. Phase 9E hardens this into a **provider
abstraction + fallback/sanity-check orchestrator + quote-quality rule set**, while keeping Yahoo as the sole
active provider (see `docs/structured_notes_market_data_sources.md` for the free-provider discovery pass —
Stooq was investigated and rejected as a secondary source: its CSV endpoints now serve a JS proof-of-work
challenge, not stable data).

### Architecture additions

| Layer | File(s) |
|---|---|
| Provider contract (pure types, no runtime imports) | `src/lib/structuredNotes/marketData/providers/types.ts` — `StructuredNoteMarketDataProvider`, `Quote`, `Request`, `Result`; `sourceType` is `free_monitoring_estimate \| proxy \| unsupported` — there is deliberately no `official` value |
| Yahoo provider (refactor, same external behavior) | `src/lib/structuredNotes/marketData/providers/yahooStructuredNoteProvider.ts` — wraps the existing `fetchYahooPriceMap`, never claims to be official |
| Quote-quality rules (pure) | `src/lib/structuredNotes/marketData/quoteQuality.ts` — `isQuoteStale`, `isQuotePriceValid`, `detectLargePriceMove`, `detectCurrencyMismatch`, `detectProviderDisagreement`, `classifyQuoteQuality`, `compareProviderQuotes`; thresholds are named exported constants (`STALE_THRESHOLD_DASHBOARD_DAYS=3`, `STALE_THRESHOLD_OBSERVATION_DAYS=1`, `LARGE_PRICE_MOVE_WARNING_PCT=15`, `PROVIDER_DISAGREEMENT_WARNING_PCT=1`) |
| Fallback/sanity-check orchestrator (pure) | `src/lib/structuredNotes/marketData/resolveStructuredNoteQuotes.ts` — queries **every** registered provider that supports a symbol (not only on failure), so a later provider both fills gaps (fallback) and lets its price be cross-checked against the primary's (sanity-check); a provider that throws is caught per-provider and never takes down the batch |
| Symbol mapping (hardened, additive) | `src/lib/structuredNotes/underlyingSymbolMap.ts` — `UnderlyingSymbolEntry` gained `normalizedCode`, `providerSymbols` (`{ yahoo, stooq }`, `stooq` always `null` today), `currency`, `verifiedAt`, `confidence`, `sourceType`, while keeping the exact pre-9E field names (`bloombergTicker`, `yahooSymbol`, `assetClass`, `displayName`, `verified`, `notes`) the 6 issuer parsers + `structuredNoteMarketProvider.ts` already depend on |

### Provider-query model: always-query, not fallback-on-failure

The orchestrator queries **every** registered provider for every symbol it supports, rather than only calling
a second provider when the first fails. With exactly one provider active (Yahoo), this costs the same single
call per symbol as before Phase 9E. The moment a second free provider is ever registered, this same code path
starts doing real work: it fills any gap the primary missed (`fallbackProviderUsed: true`), and if both
providers return a price for the same symbol, `compareProviderQuotes` flags a disagreement beyond the 1%
threshold — a genuine sanity check, not just a failover.

### Quote-quality classification

Every resolved quote is classified `ok` / `warning` / `reject`:
- **`reject`** — missing price, invalid (non-positive/non-finite) price, unsupported symbol, or a provider
  error. A `reject`-level quote is never written into a note's live price map.
- **`warning`** — usable but flagged: stale (beyond the threshold — tighter for a DUE coupon/autocall/final
  observation than for a routine dashboard read), a large day-over-day move, or a currency mismatch against
  the underlying's expected quote currency.
- **`ok`** — no issues.

### Observation QA reason vocabulary (`monitoring.ts`)

`ObservationEvaluation.reviewReasons` is now a structured `ReviewRequiredReason[]` (the pre-9E free-text
`reviewReason` string is derived from this list, not authored separately): `missing_price`, `stale_price`,
`unsupported_symbol`, `provider_error`, `large_price_move_warning`, `provider_disagreement`,
`final_observation_requires_official_verification` (always present on every final observation),
`non_trading_day_or_unavailable_close`, `ambiguous_underlying_mapping` (an underlying with no resolved symbol
at all). Passing a `quoteMeta` map (optional, additive) into `evaluateCouponObservation` /
`evaluateAutocallObservation` / `evaluateFinalObservation` / `evaluateObservation` enables this fuller
classification; omitting it preserves the exact pre-9E reason set (`missing_price` /
`ambiguous_underlying_mapping` only).

### No migration needed

`structured_note_price_snapshots`, `structured_note_observations`, and `structured_note_monitoring_runs` all
already had a `metadata jsonb not null default '{}'` column from earlier phases. Provider id, source type,
as-of, quality level/reasons, and staleness/warning diagnostics are written into these existing columns —
Phase 9E ships with **zero schema changes**.

### API additions

The cron response (`GET /api/cron/structured-notes/snapshot`) and the monitoring-status route
(`GET /api/structured-notes/monitoring-status`) both now include `providerSummary`, `unsupportedSymbols`,
`staleSymbols`, `reviewRequiredObservations`/`reviewRequiredSymbols`, `fallbackProviderUsed`, and
`providerDisagreement` — all sourced from the same monitoring run's `metadata` jsonb, so an old run recorded
before this phase safely reports these as absent/empty rather than fabricating a value.

## Post-9C hardening — Santander parser + BNP second template + shared date-label fix

Triggered by two real uploads that landed in `review_required` (never a crash — the router's
safety design worked as intended, but the notes genuinely couldn't be extracted):

- **Santander** ("Autocallable Memory Coupon Phoenix Index Basket") had no dedicated parser at all —
  it fell through to the generic Citi/HSBC fallback, which doesn't know Santander's label vocabulary
  ("ISIN Code", "`<Label> means N%`" barrier clauses, an underlying table with only one absolute level
  per row, and two SEPARATE numbered vertical date lists — "Observation Date (n)" / "Interest Payment
  Date (n)" — instead of a combined schedule table). Added `santanderParser.ts`, wired into the router's
  `detectIssuer()`/dispatch map. Extracts real term sheets at confidence 1.0.
- **BNP Paribas** already had a parser, but only for the "Phoenix Snowball" memory-coupon template
  (Phase 9C). A second real BNP template — the zero-coupon "Autocallable Certificate Plus"/"Catapult"
  family — uses different table geometry entirely: a single-underlying row with the ticker inline as
  `(Bloomberg: XXX)` and barrier percentages inline in parens (no absolute 4-column barrier table), no
  periodic coupon at all (the entire return is one fixed autocall premium, e.g. `N x 113.70%`), and its
  one early-redemption date is stated only in prose, never a table row. `bnpParibasParser.ts` (now
  `9C.bnpParibas.2`) gained fallback extraction for all three shapes, tried only when the primary
  Phoenix-Snowball-tuned regex finds nothing — the original template's extraction is unchanged and still
  regression-tested. The genuinely-absent periodic coupon is reported via `couponRateAnnualized` (the
  return-if-called) with `couponRatePeriodic`/`couponFrequency` correctly left `null`, never fabricated;
  the critical-field check for "coupon rate" now accepts either field, matching the Citi/HSBC parser's
  existing pattern.
- **Shared bug found and fixed**: `labelDateJoined` (used by every date lookup in the BNP and Santander
  parsers) took the FIRST occurrence of a label string in the document and gave up if no date followed
  it — but a label like "Final Observation Date" often also appears earlier in unrelated explanatory
  prose ("...the performance of the Underlying on Final Observation Date, the...") with no date attached.
  This silently produced a `null` `finalValuationDate` in the Santander parser even though the correct
  data line existed further down the document. Fixed to try every occurrence in order and return the
  first one immediately followed by an actual parseable date — a strict improvement (finds only dates a
  first-occurrence-only search would have missed; never removes a match the old code would have found).
- **Defense in depth**: `POST /api/structured-notes/extract` now wraps the `extractStructuredNoteTerms`
  call in a try/catch. No parser has ever been observed to throw (both real uploads investigated here
  degraded gracefully to `review_required`, as designed) — this guards against a future never-before-seen
  template hitting an unguarded regex/array access in any parser and crashing the whole upload as a bare
  500, instead of degrading to the same review-required shape every other unsupported case already uses.

New fixtures: `tests/fixtures/structured-notes/santander_sample_terms.txt`,
`bnp_catapult_sample_terms.txt` (both sanitized/fictional, matching the existing fixture policy). New/
updated tests: `tests/structuredNotesSantanderParser.test.ts` (23 tests), additions to
`tests/structuredNotesBnpParser.test.ts` (Catapult template coverage + regression that the original
Phoenix Snowball fixture is unaffected), `tests/structuredNotesParserRouter.test.ts` (Santander detection/
dispatch). Full suite 1250 → 1273/1273, lint 0, build 0 errors.

## Post-9E hardening — market-settlement check for due observations

A quote taken right at/after market close can carry a price that hasn't actually settled yet (the
exchange session is still `REGULAR`/`POST`, or the closing print is only seconds old). Rather than
retrying the same live endpoint in a loop — which does nothing against a systematically stale/live
quote, only against a transient network error — `quoteQuality.ts` now checks the quote's own exchange
session metadata before trusting it for a DUE observation:

- **`isMarketSettled(marketState, regularMarketTime, referenceDate, minSettleMinutes = 30)`** — `false`
  unless the market state is `CLOSED` **and** (if a last-trade timestamp is present) at least 30 minutes
  have passed since it. Degrades to `true` (no flag) whenever neither signal is available, so it never
  fabricates a rejection from missing data — it only flags on positive evidence the session isn't settled.
- Wired into `classifyQuoteQuality` as a new `market_not_settled` reason, gated behind
  `isForDueObservation` (the scheduled monitoring cron opts in; the on-demand dashboard read does not).
- `structuredNoteMarketProvider.ts`'s `fetchYahooPriceMap` now also returns a per-symbol
  `marketMeta: Map<symbol, { marketState, regularMarketTime }>` (Yahoo's quote response already includes
  both fields; the codebase just wasn't reading them before). `yahooStructuredNoteProvider.ts` carries
  this through each quote's `metadata`, and `resolveStructuredNoteQuotes.ts` feeds it into
  `classifyQuoteQuality`.
- `monitoring.ts`'s `reviewReasonsForUnderlyings` surfaces `market_not_settled` as a
  `ReviewRequiredReason`, same as `large_price_move_warning`/`provider_disagreement` — a due autocall
  observation flagged this way lands on `reviewRequired`, so `shouldUpdateNoteStatus` will not
  auto-transition the note to `autocalled` (and the notification/email cron will not fire) until a
  subsequent run sees a genuinely settled close.

This replaces the "retry until certain" idea discussed for this feature: repeating the same live-quote
call doesn't reveal a stale/live snapshot, since that failure mode is systematic, not noise. Checking the
market's own session state plus a settle buffer is a real, evidence-based signal instead.

## Known limitations

- **Citi CGMFL**, **HSBC (EU)**, **Crédit Agricole**, **BNP Paribas**, and **Barclays** extract at confidence
  1.0 on the real book samples validated this phase. **BBVA** extracts cleanly but is always forced to
  `review_required` because the only real sample available is itself a draft/preliminary document.
  **Santander and older-2024 Citi** templates are not yet targeted and still flag for review with honest
  per-field gaps (never mis-parsed) — they remain the next parser targets.
- **No OCR** — scanned PDFs without a text layer are rejected (`no_text_layer`), not processed.
- **No AI extraction** — deterministic regex/keyword anchoring only.
- **No Bloomberg dependency** — the workbook's `BDP` live-price mechanism is replaced by Yahoo; some
  underlyings (e.g. EURO STOXX 50) are present-but-unverified and report `unavailable` until confirmed.
- Internal **allocations still require user input** — they are portfolio data, never in the PDF.
- **Only one free market-data provider is active** (Yahoo) — the abstraction and fallback/disagreement logic
  are fully implemented and tested against mocked second providers, but no real secondary provider passed
  Phase 9E's discovery pass (see `docs/structured_notes_market_data_sources.md`).
- **Final/maturity payoff always requires manual verification** — no free source is treated as an official
  calculation-agent determination; this is a deliberate, permanent policy, not a temporary gap.
