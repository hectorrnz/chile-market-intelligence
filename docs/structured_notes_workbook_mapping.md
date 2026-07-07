# Structured Notes — Excel Workbook Audit + Sample PDF Mapping (Phase 9A)

This document is the **specification** derived from the legacy operating model
(`NUEVA BASE - Notas Estructuradas.xlsx`) plus the sample Citi term sheet
(`202606 TS_XS3180975347 (Citi 10.15% 24m - Custodio Santander).pdf`,
ISIN `XS3180975347`). It defines which fields are **extracted from the PDF**,
which are **internal/manual**, which are **derived/calculated**, and which are
**external market data** — and maps every workbook row/formula to a normalized
database field and (where applicable) a TypeScript pure function.

**Neither the workbook nor any real term-sheet PDF is committed to the repo.**
They were read locally for this audit only. A tiny sanitized text fixture
(`tests/fixtures/structured-notes/citi_sample_terms.txt`) reproduces the *field
structure* of the Citi family using only the specific values the user already
shared in plain text, with fictional internal allocations.

---

## 1. Workbook layout

- Single sheet: **`Notas`**, range `A1:AU74` (74 rows × 47 columns).
- **Each structured note is a column** (notes occupy columns `C` … `AU`).
- **Field labels are in column `B`** (not column A — column A is reused by the
  issuer-exposure summary formulas at the bottom).
- **No true header table** — it is a transposed key/value grid.
- A bottom block (rows 66–73) is an **issuer-exposure summary** computed with
  `SUMIF` across all note columns.

## 2. Row-by-row map

| Row (col B label) | Classification | Workbook meaning | DB field | Notes |
|---|---|---|---|---|
| R4 (blank) | **Internal** | status flag — literal `"llamada"` (called) when autocalled, else blank | `structured_notes.status` (`active`/`autocalled`/…) | Internal override, **never from PDF** |
| R5 `ISIN` | **PDF** | ISIN | `structured_notes.isin` | |
| R6 `Issuer` | **PDF** | issuer short name (JP Morgan, Citi, Barclays, BNP Paribas, HSBC, BBVA, Crédit Agricole, Santander) | `structured_notes.issuer_display_name` | Full legal issuer/guarantor also captured |
| R7 `Custodio` | **Internal** | custodian (Citi, Santander…) | `structured_note_allocations.custodian` | **Not a PDF term** (the sample's custodian appears only in the *filename*, not the document body) |
| R9 `Trade Date` | **PDF** | trade/strike date | `structured_notes.trade_date` | |
| R10 `Issue Date` | **PDF** | issue/settlement date (sometimes workbook formula `=+D9+7`) | `structured_notes.issue_date` | |
| R11 `Initial Valuation Date` | **Derived** | `=+C9` → equals trade date | `structured_notes.initial_valuation_date` | Parity: defaults to trade/strike date |
| R12 `Final Valuation Date` | **PDF** | final valuation date | `structured_notes.final_valuation_date` | |
| R13 `Redemption Date` | **PDF** | maturity/redemption (sometimes formula `=+E12+n`) | `structured_notes.maturity_date` | |
| R15/R16 `Tipo` | **PDF-derived** | `WOF` (worst-of) + `Phoenix Autocall` | `structured_notes.structure_type` | e.g. `worst_of_autocall` |
| R17 `Observaciones` | **PDF** | `Trimestrales` (quarterly) | `structured_notes.coupon_frequency` | |
| R18 `Plazo` | **Derived** | tenor in months (`15 meses`) | (computed) | `calculateTenorMonths` |
| R19 `Subyacentes` | **PDF** | `SPX/RTY`, `SPY/IWM`, … | `structured_note_underlyings.underlying_name` / `source_ticker` | |
| R20 `EKI` | **PDF** | knock-in barrier % (`0.65`) | `structured_notes.knock_in_barrier_pct` | Coupon barrier equals EKI in this family |
| R21 `Cupón (p.a.)` | **PDF** | annual coupon; workbook formula `=2.0125%*4` = periodic × frequency | `structured_notes.coupon_rate_annualized` (+ `_periodic`) | `calculateCouponAnnualized` |
| R24/R25 `Strike` → `SPX`/`RTY` | **PDF** | per-underlying strike/initial level | `structured_note_underlyings.strike_level` / `initial_level` | |
| R28/R29 `Coupon Barrier Level` → `SPX`/`RTY` | **Derived** | workbook formula `=+C24*C20` (strike × EKI) | `structured_note_underlyings.coupon_barrier_level` | → `calculateBarrierLevel` |
| R31–R39 `Interest Valuation Date(s)` (1ª…8ª) | **PDF** | coupon/observation schedule | `structured_note_observations` (`observation_type='coupon'`) | |
| R41 `Monto por Sociedad` (header) | — | — | — | |
| R42–R50 `WATERMILL`,`DUBAI`,`STATEN`,`LA ESPERANZA`,`NAIDELT`,`LOS SAUZALES`,`RETBOY`,`LOS LAURELES`,`VANGLOR` | **Internal** | notional allocated per in-house entity/sociedad | `structured_note_allocations` (`entity_name`,`notional_amount`) | **Never from PDF** — this is the single most important non-extraction rule |
| R51 `Total` | **Derived** | `=+SUM(C42:C50)` | (computed) | `calculateAllocationTotal` |
| R52 `Monto Vigente` | **Derived** | `=+IF(C$4="llamada",0,C$51)` → 0 if called else total | (computed) | `calculateCurrentNotional` |
| R54–R58 `Subyacente` / `LAST PRICE` | **External market data** | Bloomberg tickers (`SPY US Equity`, `IWM US Equity`) + **`=+_xll.BDP(ticker,"LAST PRICE")`** live pull | `structured_note_price_snapshots.price` | **This is the Bloomberg dependency the app replaces with Yahoo Finance** |
| R59–R62 `Caída a la Barrera` | **Derived** | `=+C$28/C$56-1` → couponBarrierLevel / lastPrice − 1 | (computed) | `calculateDistanceToBarrier` |
| R66–R73 (issuer exposure) | **Derived** | `=+SUMIF($6:$6, <issuer>, $52:$52)` → sum of Monto Vigente grouped by issuer | (computed) | `calculateIssuerExposure` |

## 3. Bloomberg dependency (to be removed in the app)

The workbook's only live-data mechanism is the **Bloomberg `BDP` function**
(`=+_xll.BDP(<ticker>, "LAST PRICE")`) in the LAST PRICE rows. Everything else
is a hardcoded term-sheet value, an internal allocation, or a spreadsheet
formula. Per the phase brief, the app **must not** use Bloomberg formulas — it
replaces `BDP` with the existing Yahoo-Finance market provider (see
`src/lib/structuredNotes/structuredNoteMarketProvider.ts`). Bloomberg-style
tickers (`SPX Index`, `RTY Index`, `SPY US Equity`, `IWM US Equity`) are mapped
to Yahoo symbols in `underlyingSymbolMap.ts`; unmapped tickers report price
`unavailable` rather than a fake number.

## 4. Formulas → TypeScript pure functions (`src/lib/structuredNotes/calculations.ts`)

| Workbook formula | Pure function |
|---|---|
| `barrier = strike × barrierPct` (R28/R29) | `calculateBarrierLevel(strikeOrInitial, barrierPct)` |
| (inverse) | `calculateBarrierPct(barrierLevel, strikeLevel)` |
| `Caída = barrierLevel / currentLevel − 1` (R60/R62) | `calculateDistanceToBarrier(currentLevel, barrierLevel)` |
| performance = `currentLevel / initialLevel − 1` | `calculateUnderlyingPerformance(currentLevel, initialLevel)` |
| worst-of status = weakest underlying | `calculateWorstPerformer`, `calculateCurrentRiskStatus` |
| coupon paid iff all ≥ coupon barrier | `calculateCouponEligibility` |
| autocall iff all ≥ autocall barrier | `calculateAutocallEligibility` |
| `Total = SUM(allocations)` (R51) | `calculateAllocationTotal` |
| `Monto Vigente = called ? 0 : Total` (R52) | `calculateCurrentNotional` |
| coupon p.a. = periodic × frequency (R21) | `calculateCouponAnnualized` |
| `SUMIF(issuer)` of Monto Vigente (R66–73) | `calculateIssuerExposure` / `calculateEntityExposure` |

## 5. Sample PDF → field mapping (`XS3180975347`, Citi CGMFL Memory Coupon Barrier Autocall)

PDF text is extracted with `unpdf` (pdf.js) in reading order — labels pair with
values on the same logical line, e.g. `Issue Size USD 1,050,000`,
`Strike Date / Trade Date June 4, 2026`. Section = the PDF heading the value
sits under.

| PDF field | PDF section | Extracted value | Workbook row | DB field | Confidence |
|---|---|---|---|---|---|
| Product title | header | Memory Coupon Barrier Autocall Notes … Worst Performing of the Russell 2000® Index and the S&P 500® Index | R15/16 | `product_name` | high |
| Issuer | General Information → Issuer | Citigroup Global Markets Funding Luxembourg S.C.A. (CGMFL) | R6 | `issuer_name` | high |
| Guarantor | General Information → Guarantor | Citigroup Global Markets Limited (CGML) | — | `guarantor_name` | high |
| Issuer display | (derived from issuer) | Citi | R6 | `issuer_display_name` | high |
| Issue Size | General Information → Issue Size | USD 1,050,000 | (context only) | `issue_size` + `currency` | high |
| Currency | General Information → Currency | USD | — | `currency` | high |
| Specified Denomination | General Information | USD 1,000 | — | `denomination` | high |
| Issue Price | General Information → Issue Price | 100.00% | — | `issue_price_pct` | high |
| Trade Date | General Information → Strike Date / Trade Date | June 4, 2026 → `2026-06-04` | R9 | `trade_date` | high |
| Issue Date | General Information → Issue Date | June 11, 2026 → `2026-06-11` | R10 | `issue_date` | high |
| Final Valuation Date | General Information → Final Valuation Date | June 5, 2028 → `2028-06-05` | R12 | `final_valuation_date` | high |
| Maturity Date | General Information → Maturity Date | June 12, 2028 → `2028-06-12` | R13 | `maturity_date` | high |
| Series Number | Additional Information | CGMFL177813 | — | `metadata.series_number` | high |
| ISIN | Additional Information → ISIN | XS3180975347 | R5 | `isin` | high |
| Structure type | title/payout | worst-of memory-coupon barrier autocall | R15/16 | `structure_type`/`payoff_type` | high |
| Coupon (periodic) | The Payout → Contingent Coupon Amount | 2.5375% per quarter (USD 25.375) | R21 | `coupon_rate_periodic` | high |
| Coupon (annualized) | The Payout | ~10.15% per annum | R21 | `coupon_rate_annualized` | high |
| Coupon frequency | schedule cadence | quarterly | R17 | `coupon_frequency` | high |
| Knock-In Barrier | Underlyings → Knock-In Barrier Level | 65.00% | R20 | `knock_in_barrier_pct` | high |
| Coupon Barrier | Underlyings → Coupon Barrier Level | 65.00% | R20 | `coupon_barrier_pct` | high |
| Autocall Barrier | Underlyings → Autocall Barrier Level | 100.00% | — | `autocall_barrier_pct` | high |
| Principal protection | Redemption Amount / Barrier Event | none (not protected) | — | `principal_protection=false` | high |
| Underlying 1 | Underlyings table | RTY Index / Russell 2000 — initial 2927.000, strike 2927.000, KI 1902.550, coupon 1902.550, autocall 2927.000 | R25/R29 | `structured_note_underlyings` | high |
| Underlying 2 | Underlyings table | SPX Index / S&P 500 — initial 7576.00, strike 7576.00, KI 4924.40, coupon 4924.40, autocall 7576.00 | R24/R28 | `structured_note_underlyings` | high |
| Coupon schedule | Contingent Coupon Valuation/Payment Dates | 7 quarterly pairs (2026-09-04/2026-09-14 … 2028-03-06/2028-03-13) + final (final valuation / maturity) | R31–R39 | `structured_note_observations` (`coupon`) | high |
| Autocall schedule | Autocall Valuation / Mandatory Early Redemption Dates | same 7 quarterly pairs | — | `structured_note_observations` (`autocall`) | high |

### Fields that are internal-only and must NEVER be inferred from this PDF
- Allocation by sociedad (WATERMILL, DUBAI, STATEN, LA ESPERANZA, NAIDELT, LOS SAUZALES, RETBOY, LOS LAURELES, VANGLOR) — the PDF's `Issue Size USD 1,050,000` is the *total* deal size, not the in-house split.
- Custodian — appears only in the internal filename, not the document body.
- Internal status overrides / internal notes.

## 6. Deterministic-parse anchors (Citi CGMFL family)

- ISIN: `\bXS\d{10}\b` after the `ISIN` label.
- Series number: `CGMFL\d+` after `Series Number`.
- General-info dates: label→value pairs `Strike Date / Trade Date`, `Issue Date`, `Final Valuation Date`, `Maturity Date`, each followed by a `Month DD, YYYY` value; validated `trade ≤ issue < final ≤ maturity`.
- Coupon: `USD <amt> or <p>% per quarter` and `approximately <a>% per annum`.
- Barriers: `Knock-In Barrier Level For each Underlying, <p>%`, `Coupon Barrier Level … <p>%`, `Autocall Barrier Level … <p>%`.
- Underlyings: numeric data row = 5 trailing decimals `initial strike knockIn coupon autocall`; underlying identity from `RTY Index`/`SPX Index` + `Russell 2000`/`S&P 500` tokens.
- Schedules: after the `Contingent Coupon Valuation Date Contingent Coupon Payment Date` header, collect `Month DD, YYYY  Month DD, YYYY` pairs (skipping page-break noise) until the `Final Valuation Date Maturity Date` sentinel; likewise after `Autocall Valuation Date Mandatory Early Redemption Date`.

Critical fields (reject/flag extraction if missing): ISIN, issuer, trade date,
maturity date, ≥1 underlying with an initial/strike level, barriers, coupon
rate, and ≥1 observation.

## 7. Phase 9C — four additional issuers, now supported

The four term sheets scoped in the original Phase 9C candidate review (below, kept for history) were
implemented as dedicated parser modules under `src/lib/structuredNotes/pdf/parsers/` and validated end-to-end
against the real documents (confidence 1.0 for three of the four; BBVA extracts cleanly but is always forced
to manual review because the only real sample is itself a draft — see
`docs/structured_notes_design.md` § "Multi-issuer parser architecture (Phase 9C)" for the full router
design and per-issuer notes). Deterministic-parse anchors for each:

### Crédit Agricole CIB (`creditAgricoleParser.ts`)
- ISIN: `ISIN Code\s*:?\s*XS\d{10}` (colon-tolerant).
- Issuer/Guarantor: per-line `Issuer\s+` / `Guarantor\s+` labels, stripped of a trailing `LEI :` continuation.
- Dates: `Trade Date` / `Issue Date` / `Redemption Date` / `Redemption Observation Date`, all `DD/MM/YYYY`, one clean label per physical line.
- Barriers: `<pct>% (Interest Barrier)` / `(Early Redemption Barrier)` / `(Final Redemption Barrier)` — label words joined with `\s+` since the parenthetical often wraps mid-label in the real PDF (e.g. `(Early Redemption\nBarrier)`); Final Redemption Barrier only promoted to `high`-confidence knock-in equivalence when the "Performance is higher than or equal to X% on the Redemption Observation Date" payoff sentence confirms the same percentage.
- Underlyings: `<n|N=n> <NAME> Index <sponsor...> <TICKER> <initial> Not Applicable`, sponsor gap matched with `[\s\S]+?` (crosses the real doc's mid-sponsor line wraps); absolute barrier levels from a second `<n> <NAME> <coupon> <autocall> <finalRedemption> <strike>` table, matched **positionally** by row order (not by name, since the two tables' name strings don't share a substring with the ticker-based `sourceTicker`).
- Schedule: two tables sharing the row shape `<t> <DD/MM/YYYY> <DD/MM/YYYY> <pct>% <pct>%`, scoped by a `\s+`-tolerant header match (the header itself wraps hard, e.g. "Automatic Early\nRedemption Observation\nDates and Automatic Early\nRedemption Dates").

### BNP Paribas (`bnpParibasParser.ts`)
- Ordinal dates (`April 09th, 2025`) handled generically by `parseTermSheetDate`'s ordinal-suffix stripping — no BNP-specific date parsing needed.
- ISIN: `ISIN:\s*XS\d{10}` (colon form).
- Several labels wrap **mid-phrase** in the real extraction (e.g. "Redemption Valuation" / "Date October 09th, 2026") — looked up via the wrap-tolerant `extractAfterLabel`/`labelDateJoined` helpers, not the per-line `labelValue`/`labelDate`. "Redemption Valuation Date" is looked up before the plain "Redemption Date" label; the two never collide because `\s+` between "Redemption" and "Date" cannot bridge the word "Valuation".
- Denomination: `1 Certificate = <CCY> <amount>`.
- Barriers: `Automatic Early i <pct>% x Index` (autocall), `Knock-in Leveli <pct>% x Index` (knock-in), `greater than or equal to <pct>% of IndexiInitial` (coupon) — a single 65% threshold serves both knock-in and coupon in this product.
- Coupon: `N x <pct>% x (1 + T)`.
- Underlyings: a single clean physical-line table row `<n> <Name> <TICKER> <initial> <knockIn> <autocall> <couponBarrier> <sponsor...>` gives **absolute levels directly** — no percentage-of-strike computation needed.
- Schedule: `<t> <ordinal date> <ordinal date> <ordinal date>` rows after the (heavily-wrapped) "Automatic Early Redemption Valuation Daten / Coupon Valuation Daten ..." header.

### Barclays Bank PLC (`barclaysParser.ts`)
- ISIN: `ISIN:\s*XS\d{10}`.
- Dates: clean `Trade Date` / `Issue Date` / `Initial Valuation Date` / `Final Valuation Date` / `Redemption Date` labels, plain `D Month YYYY` (day-first, no ordinal) — one clean physical line each.
- Barriers: `Knock-in Barrier Price (<pct>%...)` / `Interest Barrier (<pct>%...)` / `Autocall Barrier (<pct>%...)`.
- Underlyings: the ticker cell mixes Bloomberg and Refinitiv codes inline, `Name (Bloomberg Screen: TICKER Index; Refinitiv Screen: .XXX)` — `parseMixedTickerCell` (shared.ts) extracts the Bloomberg ticker as the source of truth; the Refinitiv code is captured loosely (`\.[\s\S]*?` up to the closing paren, since even the Refinitiv code itself gets split mid-token in the real narrow-column cover table, e.g. "Screen: .SP\nX)") and kept only as metadata, never used for pricing. Absolute levels come from a `N/A <CCY> <initial> Intrada[y] Price <strike> <knockIn> <interest> <autocall>` pattern — "Intraday" itself is split mid-word in the real sample ("Intrada\ny Price"). Several multi-digit levels are split mid-decimal across two physical lines (e.g. "5,183.5" then a lone "4"); `reconstructSplitDecimals()` rejoins them, but **only** when the trailing digit fragment is entirely alone on its own line (bounded by newlines both sides) — this is what stops it from misjoining an unrelated row-index digit that starts the next line.
- Schedule: two tables (`Interest Valuation Date(s)...` and `Autocall Valuation Date(s)...`) with clean single-line rows `<i> <D Month YYYY> <pct>% <D Month YYYY>`.

### BBVA Global Markets, B.V. (`bbvaParser.ts`, most conservative)
- A full "Part A - Contractual Terms" Pricing Supplement — fields extracted from numbered-clause text, not a compact term-sheet table.
- Issuer/Guarantor: `<NAME> (a private company` / `guaranteed by <NAME> (incorporated`.
- Series/currency/issue size: `Issue of Series <n> <CCY> <amount> Index Linked Notes`.
- Dates: `Trade Date:` / `Issue Date:` / `Maturity Date:` numbered-clause labels, `D Month YYYY`.
- Barriers: the two clauses use **distinctly-worded** thresholds so they never collide — `is equal to or greater than <pct>%` (coupon) vs `is greater than or equal to <pct>%` (autocall); a single barrier serves both coupon and knock-in ("Digital" payoff).
- Underlyings: `<n> <Name> <TICKER> INDEX <sponsor...> <level>` (Reference Item(s) basket table) — initial level only, no separate strike/barrier levels in this format (barrier levels computed from strike × pct like the generic parser).
- Coupon: `"Rate (i)" means <pct>%.` (note: a closing quote character sits between the `)` and `means`).
- Schedule: two tables with identical `<n> <D Month YYYY> <D Month YYYY>` rows (no percent column) — extraction of the first table naturally stops once the second table's row index resets to 1.
- **Draft/preliminary conservatism**: if "DRAFT FOR DISCUSSION PURPOSES" / "Subject to completion" is present anywhere in the document, this parser **always** returns `ok:false` regardless of field completeness — the source itself declares every term provisional.

### Original Phase 9C candidate-template review (kept for history)

Four additional real term sheets were reviewed locally (2026-07-07, not committed — same
no-commit rule as the Citi sample) to scope the parser generalization implemented above. All four are
worst-of autocallable Phoenix/Snowball structures on SPX+RTY, structurally similar to the
already-supported Citi/HSBC families, but each used a distinct label vocabulary and table
layout the `9B.multi.1` parser did not recognize at the time:

- **Crédit Agricole CIB** (`XS3306812929`, "Climber Reload Autocall"): numbered-section
  layout (`3) Underlying(s)`, `4) Indicative Barrier Level(s)`, `6) Dates`). Barriers
  labeled `Interest Barrier` / `Early Redemption Barrier` / `Final Redemption Barrier`
  (not "Knock-In"/"Coupon"/"Autocall"). Issuer is `Crédit Agricole CIB
  Financial Solutions`, Guarantor `Crédit Agricole Corporate and Investment Bank`.
- **BNP Paribas** (`XS2999188746`, "Phoenix Snowball"): dates written `Month DDth, YYYY`
  (ordinal suffixes). Barrier labels: `Knock-in Level` / `Automatic Early Redemption Level` /
  `Coupon Barrier Level`. Issuer `BNP Paribas Issuance B.V.`, Guarantor `BNP Paribas`.
- **Barclays Bank PLC** (`XS2998054097`, "Worst-of European Barrier Autocallable"):
  clean label/value pairs with plain `D Month YYYY` dates (day-first, no ordinal).
  Underlying table includes Bloomberg *and* Refinitiv tickers inline in the name cell.
- **BBVA Global Markets, B.V.** (`LA-SN-2025-0193` / series `25561`): a full EU
  "Pricing Supplement" (Part A - Contractual Terms) format, the most verbose/legalistic
  of the four. Issuer `BBVA GLOBAL MARKETS, B.V.`, Guarantor `BANCO BILBAO VIZCAYA
  ARGENTARIA, S.A.`.

**Remaining gap**: Barclays/BNP/Santander/Crédit Agricole/BBVA appendix layouts *other* than the ones
validated above (e.g. Santander's own template, and older 2024-vintage Citi single-underlying layouts) are
still not targeted — they correctly flag for review with honest per-field gaps, never mis-parsed.
