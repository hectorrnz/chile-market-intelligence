# Bank-Specific CMF Financials Discovery (Phase 8C.7)

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

## 6. Dry-run prototype (no production write)

`src/lib/financials/providers/cmfBankProvider.ts` implements the discover → fetch → unzip → parse → map →
validate chain, reusing the existing dependency-free ZIP reader (`xbrl/unzip.ts`) unchanged. It normalizes to
the exact same `FinancialImportPayload` shape every other financials source uses.

**There is no `writeImport` in this module** — it is discovery/dry-run only. Run it with:

```bash
npm run discover:cmf-bank            # coverage summary, no network
npm run discover:cmf-bank -- --live  # fetch + parse + validate the latest annual release for all 4 banks
npm run discover:cmf-bank -- --live --ticker BCI --year 2025
```

`src/lib/financials/banks/validateBankFinancials.ts` checks: the two identities above, non-negative loans and
total assets, plausible 0–100% range for any capital ratio (should one ever appear), currency presence, and
that the target period is a December (annual) release — mirroring `xbrl/validateFinancials.ts`'s severity
model (`valid` / `valid_with_warnings` / `review_required` / `invalid`).

## 7. Persistence readiness (not enabled this phase)

The existing `financial_statement_items`/`company_reporting_periods` schema is **source-agnostic** and
`line_item_code`/`statement_type` are free-text columns — no migration is needed to *store* bank-specific
fields. However, `source_type`'s CHECK constraint (`VALID_SOURCE_TYPES` in `csvFinancials.ts`) does **not**
currently include `cmf_bank`, and `DEFAULT_SOURCE_PRIORITY` in `financialsRepository.ts` has no priority entry
for it. **A future migration + priority entry would be required before any real write** — this phase
deliberately stops at dry-run diagnostics per the "no production writes unless source path and mapping are
both safe" rule, and because 4 of 40 possible fields (14 of a ~40-field target model) is a genuinely partial
mapping, not yet a basis for a confident default-ingestion decision.

## 8. Source priority and fallback (unchanged)

Yahoo Finance (`yahoo_finance`, priority 80) remains the **active, unofficial** fundamentals source for all 4
banks — untouched by this phase. If `cmf_bank` is ever promoted to a real write path, it should sit **above**
`yahoo_finance` (an official regulatory filing outranks an unofficial free aggregator) and below `xbrl`/
`cmf_fecu` (this is a lower-detail regulatory report, not a full audited IFRS statement) — a priority around
150–180 would preserve that ordering, to be set explicitly in the migration that adds it, never inferred.

## 9. Status endpoint

`GET /api/financials/cmf-xbrl/status` now includes a `bankTrack` field
(`src/lib/financials/banks/bankCoverageStatus.ts`) reporting, per bank: CMF bank code, discovery status,
mapped-field count, documented unmapped-gap groups, capital-ratio fields deferred, and confirmation that
`productionIngestion: 'not_enabled'` and `yahooFallback: 'active'`. This is a **separate** field from
`coverageFunnel` — banks remain classified `bank_track_required` there, unchanged.

## 10. Scope limits (explicit)

- Bank-specific discovery + architecture only. No non-bank CMF/XBRL refactor.
- Annual (December release) only — no interim/monthly ingestion, even though the source itself publishes
  monthly (the pipeline deliberately targets only the December snapshot, matching the annual-only convention
  already used for the non-bank track).
- No production write, no migration, no new cron schedule.
- No paid/vendor API, no Bloomberg, no CAPTCHA bypass.
- Capital/regulatory ratios structurally unavailable this phase — not fabricated.
- Deposits, borrowings, and debt securities issued left unmapped pending a dedicated verification pass.

## 11. Next steps

- A dedicated pass to resolve the deposits/borrowings ambiguity (would require walking the fair-value vs.
  amortized-cost sub-code trees more carefully).
- Investigate CMF's quarterly "Divulgación de Pilar 3 de Basilea" disclosure as a separate source for capital
  ratios (CET1, RWA, NPL, coverage) — a different page/format, not evaluated this phase.
- If mapping coverage and page-stability confidence grow, add `cmf_bank` to `VALID_SOURCE_TYPES` +
  `DEFAULT_SOURCE_PRIORITY` via a migration and wire a real (still manually-triggered, reviewable) ingestion
  cron — mirroring exactly how the non-bank CMF/XBRL cron stayed unscheduled through 8C.2–8C.6.
