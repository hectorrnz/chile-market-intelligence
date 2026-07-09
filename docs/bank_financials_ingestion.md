# Bank-Specific CMF Financials Discovery + Persistence (Phase 8C.7 / 8C.8)

## 1. Why banks are a separate track

Chilean banks (BSANTANDER, CHILE, BCI, ITAUCL in this app) are confirmed **absent** from CMF's
securities-issuer XBRL directory (`sa_eeff_ifrs_index.php`) under every registry group the tool exposes
(`rg_rf=RVEMI/RGEIN/RGFEN` and others) — verified in Phase 8C.4 and re-confirmed live in Phase 8C.7
(RVEMI/RGFEN/RGB/RB/BANC all return the identical 158,333-byte non-bank securities list; `RGEIN` returns a
genuinely different but unrelated list of 3 fund-manager ("Administradora General de Fondos") entities with
"Banco" in their name — not the bank holding companies themselves). This is the same non-bank securities-issuer
pipeline `src/lib/financials/providers/cmfXbrlProvider.ts` already uses for the 21 enabled non-bank issuers —
it structurally cannot reach banks.

Banks report under CMF's separate banking-supervision track (the former SBIF, merged into CMF), using a
bank-specific regulatory chart of accounts under the **Compendio de Normas Contables para Bancos** (Circular
N°2.243 of 20.12.2019) — net interest income, loan-loss provisions, regulatory capital — not
revenue/EBITDA/gross profit. This taxonomy must never be forced into the industrial concept map
(`src/lib/financials/xbrl/conceptMap.ts`).

## 2. Discovery result (Phase 8C.7)

**No bank XBRL filing path was found or expected** — banks are not part of the XBRL-tagged securities-issuer
regime at all. Instead, CMF publishes a **separate, official, public, no-CAPTCHA, per-institution-identifiable
monthly regulatory data feed**:

- **Page:** `https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-30250.html` ("Estados
  Financieros" under Bancos e Instituciones Financieras statistics).
- **Publication:** "Balance y Estado de Situación Bancos `<Mes> <Año>`" — one ZIP per month, back to 2001.
- **Format:** plain tab-delimited TXT files, **NOT XBRL**. File naming (documented in the release's own
  bundled `documentacion.pdf`): `XXAAAAMMIFI.TXT` where `XX` ∈ `b1` (balance sheet, consolidated), `b2`
  (balance sheet, individual), `r1` (income statement, consolidated), `c1`/`c2` (complementary info,
  consolidated/individual); `AAAAMM` = year+month; `IFI` = a stable 3-digit CMF bank code.
- **Identity registry:** each release bundles its own official `metadata/listado_instituciones.txt` and
  `metadata/plan_de_cuentas.txt` (a 2,397-entry account-code dictionary, both in the docs and every data file's
  own header row) — this is CMF's own authoritative bank-code ↔ legal-name mapping, not a search-engine
  snippet.
- **Discovery classification:** `bank_filing_path_discovered` for all 4 banks (see
  `src/lib/financials/banks/bankRegistry.ts`) — a real, stable, structured path exists; `isXbrl: false`.

### Bank codes (verified from CMF's own official documentation)

| Ticker | CMF legal name | CMF bank code |
|---|---|---|
| CHILE | BANCO DE CHILE | 001 |
| BCI | BANCO DE CREDITO E INVERSIONES | 016 |
| BSANTANDER | BANCO SANTANDER-CHILE | 037 |
| ITAUCL | BANCO ITAU CHILE | 039 |

No RUT is asserted for any bank this phase — Phase 8C.1 already found a search-snippet RUT for BSANTANDER
(97036000) that CMF's own `entidad.php` confirmed wrong ("Sin información"); this pipeline's identifier is the
CMF bank code above (verified against an official cmfchile.cl download), not a RUT, and no RUT is guessed to
fill the gap.

## 3. Bank-specific normalized field model

`src/lib/financials/banks/bankStatementTypes.ts` declares a full target model — income statement, balance
sheet, and capital/risk ratios — deliberately **separate** from the industrial `LineItemCode` union (a bank's
"interest income" is not "revenue"; "loans to customers" is not "current assets"). Every field not currently
backed by a verified account code stays structurally absent from a payload — never zero, never inferred.

## 4. Bank concept map — account code → normalized field

`src/lib/financials/banks/bankConceptMap.ts` keys off the 9-digit CMF account code (not an XBRL concept name).
**14 fields are mapped at `high` confidence**, each verified against the real **December 2025** (most recently
completed annual) release for **all 4 target banks**:

| Account code | Official label | Normalized field |
|---|---|---|
| 100000000 | TOTAL ACTIVOS | `total_assets` |
| 200000000 | TOTAL PASIVOS | `total_liabilities` |
| 300000000 | PATRIMONIO | `total_equity` |
| 380000000 | PATRIMONIO DE LOS PROPIETARIOS | `equity_attributable_to_parent` |
| 500000000 | TOTAL COLOCACIONES | `loans_to_customers` |
| 149000000 | Provisiones constituidas por riesgo de crédito | `allowance_for_loan_losses` |
| 411000000 | INGRESOS POR INTERESES | `interest_income` |
| 412000000 | GASTOS POR INTERESES | `interest_expense` |
| 420000000 | INGRESOS POR COMISIONES Y SERVICIOS PRESTADOS | `fee_and_commission_income` |
| 425000000 | GASTOS POR COMISIONES Y SERVICIOS RECIBIDOS | `fee_and_commission_expense` |
| 470000000 | GASTO POR PÉRDIDAS CREDITICIAS | `loan_loss_provisions` |
| 480000000 | IMPUESTO A LA RENTA | `tax_expense` |
| 585000000 | RESULTADO DE OPERACIONES CONTÍNUAS ANTES DE IMPUESTOS | `profit_before_tax` |
| 590000000 | UTILIDAD (PÉRDIDA) DEL EJERCICIO (O PERIODO) | `net_income` |

**Sign convention:** the income-statement (r1) feed reports revenue/income items positive and expense items
**negative** (CMF's own convention). Codes 412000000, 425000000, 470000000, 480000000 are flagged
`expenseSign: 'negative'` and the raw signed value is preserved — never silently flipped.

**Currency unit convention:** balance-sheet (b1) rows carry 4 columns (CLP nominal / UF-indexed / FX-indexed /
FX-translated-to-CLP — all already expressed in pesos per the official documentation) that must be **summed**
for the headline peso figure; income-statement (r1) rows carry a single "Monto Total" column.

### Deliberately unmapped (documented, not guessed)

- **Customer deposits / borrowings / debt securities issued** — the chart of accounts splits these across
  several amortized-cost/fair-value sub-codes with no single unambiguous top-level total observed. Mapping any
  one sub-code would understate the true figure.
- **`350000000`** ("UTILIDAD (PÉRDIDA) DEL EJERCICIO" as an equity-roll-forward balance-sheet line) — close to
  but not verified equal to the income-statement `net_income` (590000000) in the sample checked (a small
  timing difference, likely a retained-earnings appropriation effect). Kept separate to avoid conflating a
  balance-sheet component with the income-statement flow figure.
- **`550000000`/`560000000`** (TOTAL INGRESOS/GASTOS OPERACIONALES) — broad subtotals that would double-count
  against the individually-mapped items above.
- **Capital/regulatory ratios** (CET1, Tier 1, RWA, NPL ratio, coverage ratio, cost of risk, ROA, ROE) — **no
  code for any of these exists anywhere in this feed** (confirmed by an exhaustive search of the 2,397-entry
  `plan_de_cuentas.txt`). They are published separately under CMF's quarterly **"Divulgación de Pilar 3 de
  Basilea"** disclosure, not investigated this phase. Never inferred from balance-sheet figures alone.

## 5. Verification transcript (real data, Phase 8C.7)

Using the real May-2026 monthly release (most recent at the time of discovery), the following identities were
checked programmatically for **all 4 target banks** and held **exactly** (to the peso):

```
total_assets == total_liabilities + total_equity          (summed across all 4 currency columns)
profit_before_tax + tax_expense == net_income (after tax)  (continuing-operations, no discontinued ops)
```

Result for BSANTANDER (037), CHILE (001), BCI (016), ITAUCL (039): **all 4 passed both identities exactly.**
This is the evidence basis for marking every entry in the concept map `high` confidence — mirroring the
additive-identity verification standard already used for the non-bank concept map's debt-concept entries
(Phase 8C.3).

A second live run against the real **December 2025** annual release (the release this pipeline actually
targets by default) reproduced the same result for all 4 banks: **14/14 fields mapped, validation status
`valid`, 0 warnings** (`npm run discover:cmf-bank -- --live`).

## 6. Provider + orchestrator

`src/lib/financials/providers/cmfBankProvider.ts` implements the discover → fetch → unzip → parse → map →
validate chain, reusing the existing dependency-free ZIP reader (`xbrl/unzip.ts`) unchanged. It normalizes to
the exact same `FinancialImportPayload` shape every other financials source uses, and (as of Phase 8C.8) has a
real `writeImport()` that calls the identical `financialsRepository.ts` upsert functions the non-bank CMF/XBRL
provider uses — no bank-specific table, no duplicated repository logic.

`src/lib/financials/banks/runCmfBankFinancialsIngestion.ts` (Phase 8C.8) orchestrates all 4 banks (or an
explicit subset), defaulting to the most recently completed annual (December) release. Per-bank statuses:
`success` / `partial_success` / `source_unavailable` / `parse_failed` / `mapping_failed` / `validation_failed`
/ `persistence_failed` / `deferred_unmapped`. One bank's failure never aborts the batch. A payload is only
written if it clears **both** guards: at least `minFieldsToWrite` (default 10 of 14) mapped fields, and at
least `minValidationToWrite` (default `valid_with_warnings`) validation status — a bank that fails either guard
is marked `deferred_unmapped`/`validation_failed` and stays on the Yahoo fallback for that period, never
force-written as a silently-degraded partial parse.

`src/lib/financials/banks/validateBankFinancials.ts` checks: the two identities in §5, non-negative loans and
total assets, plausible 0–100% range for any capital ratio (should one ever appear), currency presence, and
that the target period is a December (annual) release — mirroring `xbrl/validateFinancials.ts`'s severity
model (`valid` / `valid_with_warnings` / `review_required` / `invalid`).

Run it with:

```bash
npm run discover:cmf-bank                     # coverage summary, no network
npm run discover:cmf-bank -- --live           # fetch + parse + validate the latest annual release for all 4 banks
npm run discover:cmf-bank -- --live --ticker BCI --year 2025
npm run ingest:cmf-bank:dry                   # orchestrator dry-run (write:false) for all 4 banks
npm run ingest:cmf-bank -- --write            # real persistence (source_type: cmf_bank)
```

Cron route (Phase 8C.8): `GET /api/cron/financials/cmf-bank` (Bearer `CRON_SECRET`, same auth/audit-row
pattern as `/api/cron/financials/cmf-xbrl`). **Not on a Vercel cron schedule** — the CMF statistics-page
listing this pipeline scrapes for the current month's ZIP link is an undocumented HTML surface, same caveat as
the non-bank CMF/XBRL cron. Ingestion stays manually-triggered and reviewable.

## 7. Persistence: `cmf_bank` source type + priority (Phase 8C.8)

Migration `20260712000000_financials_cmf_bank_source_type.sql` (purely additive/idempotent, mirrors the
Phase 8C.5 `yahoo_finance` migration) widens the `source_type` CHECK constraint on all 4 financials tables to
accept `'cmf_bank'`. `VALID_SOURCE_TYPES` (`csvFinancials.ts`) and `DEFAULT_SOURCE_PRIORITY`
(`financialsRepository.ts`) both gained a `cmf_bank` entry at **priority 180** — above `yahoo_finance` (80),
`manual_csv` (100), `document_ingestion` (120), `broker_feed` (140), `vendor_feed` (150); below `cmf_fecu`
(200) and `xbrl` (210). The existing `financial_statement_items`/`company_reporting_periods` schema needed no
other change to *store* bank-specific fields — `line_item_code`/`statement_type` were already free-text
columns.

**Full priority ordering (highest wins for the same logical period + line item):**

```
xbrl (210) > cmf_fecu (200) > cmf_bank (180) > vendor_feed (150) > broker_feed (140)
  > document_ingestion (120) > manual_csv (100) > yahoo_finance (80) > derived (50) > static_seed (10)
```

`cmf_bank` supersedes `yahoo_finance` **only for the 14 mapped fields, for the matching fiscal year** — since
bank statement line items (`interest_income`, `total_assets`, ...) mostly don't overlap with the industrial
codes Yahoo's generic feed populates (`revenue`, `gross_profit`, ...), Yahoo's rows for those non-overlapping
codes are never superseded and continue to render unchanged. The one field that does coincide, `net_income`,
is correctly superseded by the more-authoritative `cmf_bank` value for the filed year. Yahoo remains fully
active for bank quarterly/TTM/earlier-year/unmapped-field data.

`resolveFinancials.ts`'s `summarizeSource()` now recognizes `cmf_bank` and labels it **"Official CMF bank
regulatory filing"** — deliberately distinct wording from "Persisted financials via CMF XBRL" so a bank's
official annual fields are never mistaken for the industrial XBRL pipeline. The Charting badge
(`financialsPersistedCmfBank` in `dataSourceRegistry.ts`) follows the same pattern.

## 8. Status endpoint

`GET /api/financials/cmf-xbrl/status` includes a `bankTrack` field (`src/lib/financials/banks/bankCoverageStatus.ts`)
reporting, per bank: CMF bank code, discovery status, mapped-field count, documented unmapped-gap groups,
capital-ratio fields deferred, `productionIngestion` (`'enabled'` once at least one canonical `cmf_bank` row
has been persisted for that ticker, else `'not_enabled'` — never fabricated), live period count and latest
ingested release (from `getSourceTypeCoverage('cmf_bank')`), `yahooFallback: 'active'`, and a `pillar3` field
(see §9). Also surfaces `latestIngestionRun` from the `CMF Bank Financials` provider's `ingestion_runs` rows.
This is a **separate** field from `coverageFunnel` — banks remain classified `bank_track_required` there,
unchanged (that funnel is specifically about the non-bank securities-issuer XBRL pipeline).

## 9. Pillar 3 / regulatory-metrics discovery (Phase 8C.8) — deferred

Investigated CMF's official **"Divulgación de Pilar 3 de Basilea"** publication
(`https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-46323.html`) as a candidate source for
CET1, Tier 1, total capital, RWA, and the CET1/Tier1/total-capital/NPL/coverage ratios.

**Result: `deferred` — not a viable structured source.** Each quarterly release is a short PDF
(verified live, Q4 2025: `articles-108979_recurso_1.pdf`) whose entire content is a **link directory** pointing
to every individual bank's **own investor-relations website**, where that bank self-publishes dozens of
separate Basel III disclosure forms (KM1, OV1, CC1, CR1, LR1, LIQ1, ...) under Capítulo 21-20 of the RAN — in
whatever format that bank chooses. None of the 4 app bank tickers link to a direct structured file — each
resolves to a general IR landing page (BSANTANDER → "results-center-page", CHILE → "reportes-financieros",
BCI → "informes-de-relevancia", ITAUCL → "resultados-trimestrales"). A couple of OTHER banks not in this app's
universe (JPMorgan Chase, BTG Pactual) do link directly to a stable `.xlsx`, proving the format is entirely
bank-specific and never guaranteed structured.

Reaching this data for the 4 app banks would require (a) navigating each bank's own website to find its
current-quarter disclosure page — an unstable, bank-specific target, not a documented API — then (b) parsing
whatever format that bank happens to publish (in practice a PDF for these 4 banks). Both violate this app's
standing rules: never build a per-bank-website-scraping architecture as the primary path, and never OCR a PDF
as an ingestion source. **No ingestion prototype was built** — the discovery result is documented in
`src/lib/financials/banks/pillar3Discovery.ts` (a pure, network-free module capturing the evidence) and
surfaced via the status endpoint's `bankTrack.pillar3` field, per the "document the blocker, don't build
speculative ingestion" policy. Capital/regulatory ratios remain structurally unavailable — never fabricated,
never inferred from balance-sheet figures alone.

## 10. Production result (Phase 8C.8)

After the `cmf_bank` migration was applied, `npm run ingest:cmf-bank -- --write` was run against the most
recently completed annual (December 2025) release for all 4 banks. **Result: all 4 succeeded — 60 rows
written (15 per bank: 1 reporting period + 14 statement items), 56 fields mapped, 0 failures, all `valid`.**

**A real bug was caught during this validation run**: the CLI script (`scripts/discover/cmfBankFinancials.ts`)
was missing the `@next/env` `loadEnvConfig(process.cwd())` call every other ingestion script in this project
has. Without it, `--write` ran with no Supabase credentials in the environment; both repository upserts failed
closed with "Admin Supabase client not configured", surfaced only as a generic "2 row(s) failed to write" (the
provider's `writeImport` reports an error count, not detail — same as the non-bank provider). Traced by
reproducing the exact payload directly against the repository functions (which succeeded), isolating the
difference to the CLI wrapper, and confirming the fix with a single-bank dry run before the full 4-bank write.
No partial/degraded data was ever persisted — the orchestrator's `persistence_failed` status held correctly
throughout.

**Supersession verified live**: BCI's existing `yahoo_finance` FY2025 annual `company_reporting_periods` row
is now `is_superseded: true`; the new `cmf_bank` FY2025 annual row is the canonical one. The two independently
sourced `net_income` figures for BCI FY2025 cross-validate closely (cmf_bank: 996,212,126,958; yahoo_finance:
996,006,000,000 — a ~0.02% difference, consistent with real reporting-convention rounding, not a data-quality
problem). Yahoo's quarterly/other-year data for all 4 banks remains untouched and fully active.

## 11. Scope limits (explicit)

- Bank official-source persistence + Pillar 3 discovery only. No non-bank CMF/XBRL refactor.
- Annual (December release) only — no interim/monthly ingestion, even though the source itself publishes
  monthly.
- No paid/vendor API, no Bloomberg, no CAPTCHA bypass, no OCR.
- Pillar 3 production writes out of scope — the source was found non-viable (per-bank PDF link directory), so
  no ingestion was attempted, safely.
- Deposits, borrowings, and debt securities issued left unmapped pending a dedicated verification pass.
- Bank cron (`/api/cron/financials/cmf-bank`) stays unscheduled — manually-triggered and reviewable, same as
  the non-bank CMF/XBRL cron.

## 12. Next steps

- A dedicated pass to resolve the deposits/borrowings ambiguity (would require walking the fair-value vs.
  amortized-cost sub-code trees more carefully).
- Re-investigate Pillar 3 periodically — a future CMF change could centralize the per-bank disclosures into a
  single structured file, but nothing suggests that is planned.
- Consider a bank-website-specific investor-relations monitor for one bank at a time, IF a genuinely stable,
  structured (non-PDF) endpoint is ever found on that bank's own site — evaluated case-by-case, never as a
  blanket per-bank-scraping architecture.
- Or continue with **Phase 8D** (FX/rates + economic calendar), or **Phase 9F** (Santander/older-2024-Citi
  structured-notes parser).
