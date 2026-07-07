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
- **No scheduled observation-event automation yet** — coupon-paid/autocalled transitions are manual/status
  edits in this phase; live price snapshots are compute-on-request (not yet persisted on a schedule).
