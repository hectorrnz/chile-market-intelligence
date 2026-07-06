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
| Deterministic term parser (pure) | `src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts` |
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

## Known limitations

- Only the **Citi CGMFL "Memory Coupon Barrier Autocall"** family is validated for extraction. Other
  issuers/families extract partially and are flagged for review rather than mis-parsed.
- **No OCR** — scanned PDFs without a text layer are rejected (`no_text_layer`), not processed.
- **No AI extraction** — deterministic regex/keyword anchoring only.
- **No Bloomberg dependency** — the workbook's `BDP` live-price mechanism is replaced by Yahoo; some
  underlyings (e.g. EURO STOXX 50) are present-but-unverified and report `unavailable` until confirmed.
- Internal **allocations still require user input** — they are portfolio data, never in the PDF.
- **No scheduled observation-event automation yet** — coupon-paid/autocalled transitions are manual/status
  edits in this phase; live price snapshots are compute-on-request (not yet persisted on a schedule).
