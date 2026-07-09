# CMF/XBRL Automated Financials Ingestion (Phase 8C.2 / 8C.3 / 8C.4 / 8C.6)

Turns the Phase 8C.1 CMF/XBRL proof-of-concept into a **working, end-to-end automated financials ingestion
pipeline** for Chile issuers, writing into the same source-agnostic financials tables manual CSV uses. This
is the step that makes automated official-filing data — not manual CSV — the **preferred** source for Chile
issuer financials where a public CMF filing exists. Manual CSV remains a fallback/override/exception path.

**Phase 8C.3** expanded issuer coverage from 2 to 5 (SQM-B, COPEC, ENELCHILE, CMPC, CENCOSUD) using a
conservative, verified, issuer-by-issuer process — see §4 for the verification method and §12 for the
strengthened bank-registry finding (BSANTANDER, and now also CHILE/Banco de Chile, confirmed unmappable).

**Phase 8C.4** ran a **full coverage discovery sweep** over the entire 25-stock app universe and expanded
enabled coverage from 5 to **15 issuers** (added LAS-CONDES, CAP, ENELAM, COLBUN, AGUAS-A, RIPLEY, PARAUCO,
ENTEL, CCU, LTM), with **3 more verified-but-deferred** (CONCHATORO, FALABELLA, MALLPLAZA), **3 real filings
the current parser can't yet read** (SONDA, ANDINA-B, VAPORES — different XBRL dialects), and **4 banks
confirmed on a separate CMF track** (BSANTANDER, CHILE, BCI, ITAUCL). Every app stock now has an explicit
coverage classification (§4c) surfaced through the status endpoint's coverage funnel. A coverage sweep CLI
(`npm run discover:cmf-coverage`) and a pure classifier (`src/lib/financials/cmfCoverage.ts`) make the funnel
reproducible.

Companion docs: `docs/cmf_xbrl_provider_discovery.md` (8C.1 discovery — how the CMF surface was verified),
`docs/data_dictionary.md` (financials schema), `docs/data_source_status.md` (source matrix).

---

## 1. What was blocking automation, and what unblocked it

Phase 8C.1 verified the entire CMF chain (entidad.php page → parse XBRL href → download the ZIP) and built the
provider abstraction, a dependency-free XBRL instance parser, and a conservative concept map — but stopped at
one wall: **the download is a ZIP archive, and no ZIP dependency was added**, so `fetchFiling` returned
`not_implemented` and no filing could be parsed end to end.

Phase 8C.2 removes that wall with a **dependency-free ZIP reader** (`src/lib/financials/xbrl/unzip.ts`) built
on Node's built-in `node:zlib` (`inflateRawSync`) — ZIP entries use raw DEFLATE (compression method 8), which
`inflateRawSync` decompresses directly. No new package. Verified live: the real COPEC 12/2023 archive
(`90690000_202312_C.xbrl` + `.xsd` + `-definition.xml`, all method 8) unzips, and its 2.7 MB instance parses
into 1,618 contexts / 9,909 facts.

## 2. Source hierarchy and policy

For a Chile issuer's reported financials, the source hierarchy is:

1. **Official CMF/XBRL filing** (`source_type = 'xbrl'`, priority 210) — preferred when available and parsed.
2. **Manual CSV** (`manual_csv`, priority 100) — fallback / bridge / override / exception-review only.
3. Document ingestion / vendor / broker feeds — future, higher-or-lower priority as configured.
4. **Static/mock** — never a terminal source.

Rules enforced in code:

- CMF/XBRL **supersedes** manual CSV for the same logical period automatically — `source_priority` (xbrl 210 >
  manual_csv 100) drives `reconcileSupersession` in `financialsRepository.ts`; the read path filters
  `is_superseded = false`. (A deliberate manual *correction* can still win if entered with a higher priority.)
- **Missing concepts stay missing, never zero.** An unmapped or absent concept is simply not written as a
  line item (never fabricated as 0). Unmapped concept counts are reported as a diagnostic, not dropped
  silently.
- **Currency is read per-fact from the XBRL unit block, never assumed.** Both SQM-B and COPEC file in USD; the
  pipeline records USD, not CLP.
- **Period nature is labeled honestly** (annual / quarterly_discrete / year_to_date / instant) so a cumulative
  YTD figure is never silently charted as a discrete quarter.
- **Uncertain data requires review**: the validator can mark a filing `review_required`/`invalid`; the
  orchestrator will not write an `invalid` filing.

## 3. Discovery method (why taxonomy ZIPs alone are insufficient)

CMF publishes two different things that both come as ZIPs:

- **Taxonomy packs** (from `.../portal/principal/613/w3-article-*.html`) — blank schema/label files
  (`.xsd`/`.xml`) only. These prove the schema is public but contain **no company data**. `unzip.ts`'s
  `isTaxonomyOnlyArchive` detects an archive with no `.xbrl` instance and the provider rejects it — a taxonomy
  pack is never treated as a filing.
- **Filing archives** (from a company's `entidad.php` page) — contain the real `<rut>_<period>_C.xbrl`
  instance document with genuine `ifrs-full` facts. This is the usable source.

The entidad.php page resolves deterministically from `rut` + `mm`/`aa` + `tipo` + `tipo_norma` (verified in
8C.1; re-confirmed live in 8C.2 for COPEC 12/2024 and 12/2023). The XBRL download href carries per-page-load
`auth`/`send` tokens that must be scraped fresh each request — this is the brittle, undocumented part, which
is why ingestion is **manually triggered and reviewable, not yet on an unattended cron schedule**.

## 4. Supported issuers

Only issuers with a RUT verified against a direct cmfchile.cl source are enabled (`src/lib/financials/cmfIssuerMap.ts`).
As of Phase 8C.4, **15 issuers are `enabled`** (production-ingested) and **3 are `eligible_verified`**
(RUT-verified + dry-run clean, deferred to a later batch — never written by the default run). Currency is
read per fact, never assumed.

**Enabled (21 as of Phase 8C.6 — every non-bank app stock):**

| Ticker | CMF issuer | RUT | Currency | Enabled in |
|---|---|---|---|---|
| SQM-B | Sociedad Química y Minera de Chile S.A. | 93007000 | USD | 8C.2 |
| COPEC | Empresas Copec S.A. | 90690000 | USD | 8C.2 |
| ENELCHILE | Enel Chile S.A. | 76536353 | USD (FY2025) / CLP (FY2024) | 8C.3 |
| CMPC | Empresas CMPC S.A. | 90222000 | USD | 8C.3 |
| CENCOSUD | Cencosud S.A. | 93834000 | CLP | 8C.3 |
| LAS-CONDES | Clínica Las Condes S.A. | 93930000 | CLP | 8C.4 |
| CAP | CAP S.A. | 91297000 | USD | 8C.4 |
| ENELAM | Enel Américas S.A. | 94271000 | USD | 8C.4 |
| COLBUN | Colbún S.A. | 96505760 | USD | 8C.4 |
| AGUAS-A | Aguas Andinas S.A. | 61808000 | CLP | 8C.4 |
| RIPLEY | Ripley Corp S.A. | 99579730 | CLP | 8C.4 |
| PARAUCO | Parque Arauco S.A. | 94627000 | CLP | 8C.4 |
| ENTEL | Empresa Nacional de Telecomunicaciones S.A. | 92580000 | CLP | 8C.4 |
| CCU | Compañía Cervecerías Unidas S.A. | 90413000 | CLP | 8C.4 |
| LTM | LATAM Airlines Group S.A. | 89862200 | USD | 8C.4 |
| CONCHATORO | Viña Concha y Toro S.A. | 90227000 | CLP | 8C.6 (promoted) |
| FALABELLA | FALABELLA S.A. (app "S.A.C.I. Falabella") | 90749000 | CLP | 8C.6 (promoted) |
| MALLPLAZA | PLAZA S.A. (trades as "Mall Plaza") | 76017019 | CLP | 8C.6 (promoted) |
| SONDA | SONDA S.A. | 83628100 | CLP | 8C.6 (default-namespace dialect) |
| ANDINA-B | Embotelladora Andina S.A. | 91144000 | CLP | 8C.6 (CTI-Service ISO-8859-1 dialect) |
| VAPORES | Compañía Sud Americana de Vapores S.A. | 90160000 | USD | 8C.6 (CTI-Service dialect; no ifrs-full:Revenue line — honest gap, Yahoo fills it) |

**Not ingestible via this securities-issuer pipeline (documented, not guessed):**

| Ticker | Reason | Coverage status |
|---|---|---|
| BSANTANDER, CHILE, BCI, ITAUCL | Banks — absent from the securities-issuer XBRL directory under every registry group; separate CMF banking track with a bank-specific taxonomy | `bank_track_required` |

As of Phase 8C.6 there are **no** `eligible_verified` or `unsupported_page_shape` issuers remaining — the
coverage funnel is **21 enabled + 4 bank_track_required = 25**.

RUTs are **never guessed**. Adding an issuer requires confirming its RUT against CMF's own directory first (§4a/§4c).

### 4a. Verification method (Phase 8C.3)

CMF's own search form (`sa_eeff_ifrs_index.php`) embeds a `sociedad[]` multi-select listing **every**
registered entity as `"<RUT-with-check-digit> <LEGAL NAME>"` — this is CMF's own official RUT↔legal-name
directory, not a search-engine guess. Phase 8C.3's process for each candidate:

1. Fetch the directory and search for the candidate's legal name (from `companies.json`'s `legalName`).
2. Confirm an **unambiguous** match — e.g. "EMPRESAS CMPC S.A." (RUT 90222000) was carefully distinguished
   from a different, unrelated directory entry "INVERSIONES CMPC S.A." (RUT 96596540); "CENCOSUD S.A." (RUT
   93834000) was distinguished from "CENCOSUD SHOPPING S.A." (RUT 76433310, a shopping-center subsidiary).
3. Exercise the full entidad.php → XBRL ZIP → unzip → parse chain live, for at least 2 fiscal years.
4. Only then add the entry to `CMF_ISSUER_MAP` with `verificationStatus: 'verified'`.

**Banks are not present in this directory at all.** Phase 8C.3 checked CMF's directory under both registry
groups the search tool exposes (`rg_rf=RVEMI` and `rg_rf=RGEIN`) — zero entries for "Banco Santander" or
"Banco de Chile" in either (only unrelated fund-management subsidiaries with "Banco" in their name). This
strengthens the Phase 8C.1 finding: Chilean banks are supervised/reported under a separate CMF track this
public XBRL search tool does not expose. **BSANTANDER and CHILE remain `not_configured`, not guessed.**

### 4b. Currency can change between fiscal years for the same issuer (real finding)

ENELCHILE's FY2024 filing reports entirely in **CLP** (confirmed: unit block contains `CLP`/`pure`/`shares`,
no USD); its FY2025 filing reports entirely in **USD** (confirmed: unit block contains only
`pure`/`shares`/`USD`, zero CLP facts; the entity identifier `76536353-5` matches in both, ruling out a
wrong-entity mixup). This is exactly why currency is always read per-fact from the XBRL unit block and
recorded on the reporting period, never assumed or cached from a prior year.

### 4c. Full coverage classification (Phase 8C.4)

Phase 8C.4 classified **every** app stock into a single CMF/XBRL coverage status, so no name is left
unaccounted for. The pure classifier lives in `src/lib/financials/cmfCoverage.ts` (`classifyTickerCoverage`,
`buildCmfCoverageReport`); a reproducible sweep CLI is `npm run discover:cmf-coverage` (add `--live` to
cross-check every stock's legal name against CMF's live directory). The status endpoint
(`/api/financials/cmf-xbrl/status`) exposes the full funnel.

The 25-stock app universe currently funnels to:

| Coverage status | Count | Tickers |
|---|---|---|
| `enabled` | 15 | SQM-B, COPEC, ENELCHILE, CMPC, CENCOSUD, LAS-CONDES, CAP, ENELAM, COLBUN, AGUAS-A, RIPLEY, PARAUCO, ENTEL, CCU, LTM |
| `eligible_verified` | 3 | CONCHATORO, FALABELLA, MALLPLAZA |
| `unsupported_page_shape` | 3 | SONDA, ANDINA-B, VAPORES |
| `bank_track_required` | 4 | BSANTANDER, CHILE, BCI, ITAUCL |

The status type also defines (for a broader future universe) `candidate_needs_review`, `missing_rut`,
`not_found_in_cmf_directory`, `no_xbrl_filing_found`, `taxonomy_only`, `bank_track_discovered`,
`bank_xbrl_mapping_required`, `foreign_or_not_cmf_eligible`, `etf_or_index_not_cmf_eligible`,
`inactive_or_delisted`, `unsupported_security_type`, `review_required`, `not_configured` — none of which the
current 25-stock universe hits, but which let the same model classify an expanded universe without a reshape.

**Discovery-sweep method (8C.4):** the sweep matched all 25 app legal names against CMF's own RVEMI
`sociedad[]` directory (483 entries); 19 exact-matched (5 already enabled + 14 candidates), FALABELLA and
MALLPLAZA matched on razón social with a legal-name-form difference, and the 4 banks matched **nothing** under
any registry group (`rg_rf=RVEMI/RGEIN/RGB/RB/BANC` all return the identical securities list — zero banks).
Each of the 16 non-bank candidates then had its full entidad.php → XBRL → parse chain exercised live (FY2025):
13 parsed clean (→ enabled/eligible), 3 (SONDA/ANDINA-B/VAPORES) downloaded a real instance that the current
`xbrli:`-prefixed regex parser can't extract (→ `unsupported_page_shape`, deferred — the filing exists, the
parser dialect support does not).

### 4d. Banking-sector track (Phase 8C.4; discovery completed Phase 8C.7)

Chilean banks (BSANTANDER, CHILE, BCI, ITAUCL) are **confirmed absent** from CMF's securities-issuer XBRL
directory under every registry group the tool exposes. They are supervised under CMF's separate "Bancos e
Instituciones Financieras" track (former SBIF), which uses a **bank-specific accounting taxonomy** — net
interest income, loan-loss provisions, and regulatory-capital line items, *not* revenue / EBITDA / gross
profit. That taxonomy **must never be forced into the industrial concept map**. Bank RUTs are **not guessed**.

**Phase 8C.7 discovery result:** no XBRL path exists for banks (none was expected — banks are not part of the
XBRL-tagged regime at all). A real, official, non-XBRL, public, no-CAPTCHA monthly regulatory data feed was
found instead ("Balance y Estado de Situación Bancos"), and a conservative 14-field account-code map + a
dry-run-only ingestion prototype were built and verified against real data for all 4 banks. Production
ingestion is **not enabled** — Yahoo Finance remains the active unofficial fallback. Full detail, the verified
account-code table, and scope limits: **[docs/bank_financials_ingestion.md](bank_financials_ingestion.md)**.

## 5. Pipeline architecture

| Stage | File |
|---|---|
| Issuer → RUT map | `src/lib/financials/cmfIssuerMap.ts` |
| Discovery + fetch + unzip (provider) | `src/lib/financials/providers/cmfXbrlProvider.ts` |
| ZIP reader (dependency-free) | `src/lib/financials/xbrl/unzip.ts` |
| XBRL instance parser | `src/lib/financials/xbrl/parseXbrl.ts` |
| Period classification | `src/lib/financials/xbrl/periodClassify.ts` |
| Concept → line-item map (+ confidence) | `src/lib/financials/xbrl/conceptMap.ts` |
| Data-quality validation | `src/lib/financials/xbrl/validateFinancials.ts` |
| Orchestrator | `src/lib/financials/cmf/runCmfXbrlIngestion.ts` |
| Repository (shared upsert + supersession) | `src/lib/db/repositories/financialsRepository.ts` |
| Cron route | `src/app/api/cron/financials/cmf-xbrl/route.ts` |
| Status route | `src/app/api/financials/cmf-xbrl/status/route.ts` |
| CLI | `scripts/discover/cmfXbrlFinancials.ts` |

### Period handling — the hardest part

A CMF instance carries facts on many contexts: the current period, prior-year comparatives, and (for interim
filings) both a cumulative year-to-date window and a discrete-quarter window. `periodClassify.ts`:

- **builds the target period** from `mm`/`aa` — annual for mm=12; Q1 (`quarterly_discrete`, since Q1 YTD ==
  Q1 discrete) for mm=03; Q2/Q3 (`year_to_date`, cumulative) for mm=06/09.
- **matches facts to the current period only** — income/cash facts on the duration that starts Jan 1 and ends
  on the period end; balance-sheet facts on the period-end instant. **Prior-year comparative contexts are
  excluded.** This replaces the 8C.1 "first plain context wins" placeholder, which could have grabbed a
  comparative or a YTD figure by accident.
- `period_type` stays `quarterly`/`annual`/`ttm` (unchanged vocabulary) so supersession still groups an XBRL
  Q2 with a manual-CSV Q2; the finer cumulative distinction is recorded in `period_nature`.

**Conservative default: the orchestrator ingests ANNUAL (December) filings only** (unambiguous full-year
duration + year-end balance). The provider fully supports interim filings, but interim YTD figures carry a
comparability caveat and are not part of the default automated run.

### Concept mapping and confidence

`conceptMap.ts` maps ~31 standard `ifrs-full` concepts to normalized line items, each tagged
`high`/`medium`/`low`/`review_required`. Only concepts that are unambiguous standard IFRS vocabulary are
mapped; ambiguous note-only concepts (e.g. `AccountingProfit`, related-party revenue) are documented as
deliberately unmapped, not guessed. **EBITDA is never fabricated here** — it stays a derived metric computed
(only from present inputs) by `csvFinancials.ts`'s `deriveFinancialMetrics`.

**Phase 8C.3 additions** (debt + shares outstanding + real capex/dividend concept names), added only after
verifying them against real ENELCHILE/CMPC/CENCOSUD FY2025 facts:

- `total_debt` / `long_term_debt` / `short_term_debt` — mapped from `ifrs-full:Borrowings` /
  `ifrs-full:LongtermBorrowings` / `ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings`.
  Verified via an **exact additive identity** in two real filings: `LongtermBorrowings +
  CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings == Borrowings`, to the peso/dollar, for both CMPC
  and CENCOSUD's FY2025 current-period instant. Two similarly-named concepts —
  `ifrs-full:ShorttermBorrowings` and `ifrs-full:CurrentPortionOfLongtermBorrowings` — were deliberately left
  **unmapped**: both were found to diverge from the mapped concept's value in at least one real filing (a
  double-counting/understatement risk), so the safer, verified-additive concept was preferred instead.
  `ifrs-full:NetDebt` (debt net of cash — a genuinely different metric, verified NOT equal to gross
  `Borrowings` in a real filing) is also deliberately unmapped, never conflated with `total_debt`.
- `shares_outstanding` — mapped from `ifrs-full:NumberOfSharesOutstanding` (unit: shares), verified present on
  the current-period instant in all three new issuers.
- The `capex`/`dividends_paid` concepts guessed in Phase 8C.1/8C.2
  (`PaymentsToAcquirePropertyPlantAndEquipment` / `DividendsPaid`) were never actually observed in any of the
  5 real filings inspected — every real filer instead uses
  `ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities` /
  `ifrs-full:DividendsPaidClassifiedAsFinancingActivities`, now mapped at `high` confidence. The original
  guesses are kept as lower-confidence fallbacks for a future filer that might use them.

### Raw fact provenance — no new table

Per-fact provenance (source concept, contextRef, unitRef, decimals, mapping confidence, period nature,
context dates) is written into the existing `financial_statement_items.metadata` jsonb column, and honest
period metadata (period_start_date, period_nature, filing_period_label) into
`company_reporting_periods.metadata`. **No migration is needed** — both columns existed since Phase 8C,
mirroring the 9D/9E "reuse existing metadata jsonb" approach. A dedicated raw-facts table remains a documented
future option if deeper fact-level auditability is ever required.

### Validation checks

`validateFinancials.ts` produces `valid` / `valid_with_warnings` / `review_required` / `invalid` with warning
codes: balance-sheet identity (assets ≈ liabilities + equity, 1% tolerance), period chronology, non-finite
values, missing currency/unit, YTD-derived figure, unmapped concepts, low-confidence mapping. The orchestrator
refuses to write an `invalid` filing.

## 6. Cron route and schedule

`GET /api/cron/financials/cmf-xbrl` — Bearer `CRON_SECRET` (same pattern as the macro/structured-notes crons),
service-role admin client, records an `ingestion_runs` row, returns a sanitized summary (no secrets, no raw
XBRL). Safe optional params: `?ticker=COPEC`, `?periods=2` (clamped 1–5), `?dryRun=1`.

**Not on a Vercel cron schedule.** Intentionally: the entidad.php surface is undocumented HTML, so ingestion
stays a manually-triggered, reviewable run until its stability has been observed over time. The route exists
and is protected so it can be triggered on demand. Adding a schedule later should use a conservative cadence
(e.g. quarterly, after filing season) and be documented here.

## 7. Status endpoint

`GET /api/financials/cmf-xbrl/status` — public read-only diagnostics, consistent with the app's other public
ingestion-status endpoints (`/api/health/ingestion`, `/api/macro/ingestion-status`,
`/api/market/ingestion-status`). Exposes the latest run, per-issuer XBRL coverage, and the mapped/unmapped
issuer lists — never secrets, never raw fact payloads. (The 8C.2 spec suggested an auth-gated endpoint; this
follows the app's established convention of public read-only ingestion diagnostics, honoring the same
no-secrets/no-raw-payload safety properties.)

## 8. UI

The Charting page's source badge now reflects the dominant persisted source_type: **CMF XBRL** when the
ticker's financials are XBRL-sourced (`financialsPersistedXbrl`), manual CSV otherwise. `resolveFinancials`
reports `sourceType`; a ticker with both manual and XBRL periods surfaces the authoritative XBRL label
("via CMF XBRL (+ manual)") rather than hiding it.

## 9. Security and private-file handling

- Server-only execution; the raw XBRL is never returned by any route or echoed to logs.
- `unzip.ts` fails closed: rejects non-ZIPs, oversized archives, zip bombs (per-entry + total caps), unsupported
  compression, and unsafe entry names (path traversal, absolute paths, drive letters, backslashes, NUL).
  Nothing is written to disk — extraction is fully in-memory.
- No raw XBRL ZIP, no full CMF page, and no real company filing is committed. The only committed fixture is
  the small **synthetic** `tests/fixtures/cmf/sample_instance.xbrl` (+ the in-memory ZIP the test builds from it).
- Errors are sanitized to bounded strings (JWT/key redaction).

## 10. How to run

```bash
# full coverage funnel over the app universe (no writes); add --live for a CMF directory cross-check
npm run discover:cmf-coverage
npm run discover:cmf-coverage -- --live

# feasibility report (no network, no writes)
npm run discover:cmf-financials

# real fetch + unzip + parse + validate, NO write
npm run ingest:cmf-financials:dry -- --ticker COPEC

# real end-to-end ingestion (writes xbrl financials, supersedes manual CSV for the same period)
npm run ingest:cmf-financials -- --ticker COPEC --write --periods 1

# via the protected cron route
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://nevada-market-intelligence.vercel.app/api/cron/financials/cmf-xbrl?ticker=COPEC&periods=1"
```

## 11. Validation performed (real data)

- Live COPEC FY2025 + FY2024 and SQM-B FY2025 + FY2024 ingested end to end (dry run): 23 line items each,
  `valid_with_warnings`, USD, honest `annual` nature, balance-sheet identity holds
  (assets = liabilities + equity exactly).
- Real **write** of COPEC FY2025 to production Supabase: 24 rows (1 period + 23 items), `source_type = xbrl`,
  priority 210.
- **Supersession proven live**: a synthetic manual_csv FY2025 COPEC row was correctly demoted
  (`is_superseded = true`, `superseded_by` set) when the XBRL row was reconciled, then cleaned up.
- Read path confirmed: `/api/financials/COPEC/statements` reports `sourceType: xbrl`; the status endpoint shows
  the run + coverage; cron auth returns 401 without the bearer token.

## 11a. Phase 8C.3 — issuer coverage expansion, production-validated

Real production writes (Supabase, no separate staging environment): **ENELCHILE** FY2025 (26 rows, USD),
**CMPC** FY2025 (31 rows, USD), **CENCOSUD** FY2025 (31 rows, CLP). All confirm `sourceType: xbrl` on read,
`valid_with_warnings` (only `UNMAPPED_CONCEPTS`, no `review_required`/`invalid`), and the Charting page badge
correctly renders "Persisted financials via CMF XBRL" for each — verified live in the browser (CMPC screenshot,
real revenue value 7,475,096,000 in the underlying-data table, EBITDA correctly "—" since it's not a raw fact).
The concept-map expansion (§ Concept mapping and confidence) also **increased mapped-field counts for the
pre-existing SQM-B/COPEC** (23→29 and 23/24→24 fields respectively), since the new debt/shares/capex/dividend
concepts turned out to be broadly used, not issuer-specific.

## 11b. Phase 8C.4 — coverage sweep + 10-issuer batch, production-validated

Real production write (Supabase, no separate staging environment) of the full **15-issuer enabled set** for
FY2025 in one run: **422 rows written, 0 issuers failed**, all `valid_with_warnings`. The 10 newly-enabled
issuers wrote (rows = 1 period + line items): LAS-CONDES 28 (CLP), CAP 30 (USD), ENELAM 26 (USD), COLBUN 26
(USD), AGUAS-A 25 (CLP), RIPLEY 30 (CLP), PARAUCO 28 (CLP), ENTEL 27 (CLP), CCU 28 (CLP), LTM 31 (USD) — the
existing 5 re-wrote idempotently. Currency was read per fact in every case (USD vs CLP as filed). No concept
mappings were added this phase: all 13 verified candidates validated cleanly against the existing ~31-concept
map (extending it without a concrete gap would violate the evidence-only rule), so §"Concept mapping" is
unchanged. The default ingestion set is now `getEnabledTickers()` (15) — the 3 `eligible_verified` issuers are
**never** written by a default/cron run, only by an explicit `?ticker=`/`--ticker` dry-run.

## 12. Remaining gaps and future work

- **Only annual filings** are ingested by default; interim (YTD) filings are supported by the provider but need
  clear YTD-vs-discrete handling before charting — a documented future enhancement.
- **15 issuers are enabled** (as of Phase 8C.4), **3 more are `eligible_verified`** and can be promoted with a
  one-line `coverageStatus` flip + a production write. Expanding further is per-issuer RUT verification against
  CMF's official directory (§4a/§4c).
- **3 real filings are unreadable by the current parser** (SONDA default-namespace dialect; ANDINA-B/VAPORES
  CTI-Service ISO-8859-1 dialect) — `unsupported_page_shape`. Supporting these dialects is a bounded future
  parser enhancement; the RUTs are already directory-verified.
- **4 banks are `bank_track_required`** — a separate CMF banking track with a bank-specific taxonomy (§4d).
  Building a bank-XBRL path (its own concept map + normalized fields) is deferred; the industrial concept map
  must never be forced onto bank filings.
- **Not scheduled** — manual/reviewable runs only until the HTML surface's stability is observed; 15 issuers is
  broader but still an undocumented HTML surface.
- **No unzip of the taxonomy/definition companions** for label resolution — the concept map keys off the
  stable `ifrs-full` concept names instead.
- Future options: promote the eligible_verified batch; add parser support for the two extra XBRL dialects; a
  bank-specific ingestion track; an official CMF API if one is ever published; a licensed vendor feed.

## 13. Phase 8C.5 — Yahoo Finance universal fundamentals fills every remaining gap

CMF/XBRL structurally cannot reach 10 of the 25 app stocks (4 banks + 3 unsupported-dialect + 3 unresearched),
and even the 15 enabled issuers only carry **one annual data point** each — not enough for the Charting page's
Quarterly/TTM/Annual toggle to do anything useful. Phase 8C.5 added **Yahoo Finance** as a universal
fundamentals fallback (`src/lib/financials/providers/yahooFundamentalsProvider.ts`,
`src/lib/financials/yahoo/runYahooFinancialsIngestion.ts`) covering all 25 tickers with real quarterly +
annual income/balance/cash-flow data — including the 4 banks. New `source_type = 'yahoo_finance'` at
**priority 80** (below `manual_csv`=100, above `derived`=50) — migration
`20260711000000_financials_yahoo_source_type.sql` widens the `source_type` CHECK (idempotent, additive). CMF/
XBRL annual (210) automatically supersedes Yahoo annual for the same fiscal year; Yahoo quarterly (a distinct
logical period) always coexists. Badge: "Fundamentals via Yahoo Finance (unofficial)" — never claims official
status.

**Real bug found and fixed during validation**: `yahoo-finance2`'s `fundamentalsTimeSeries(..., {module:
'all'})` intermittently throws a "Failed to generate key" error non-deterministically — the same ticker can
succeed on one call and fail on the next. SQM-B's first production ingestion silently wrote 0 quarterly
periods (vs. 5-6 for every peer) because the original code swallowed the error into an empty array via
`.catch(() => [])`. Fixed with a 3-attempt retry per fetch; a fetch that still fails after retries now fails
the whole ticker loudly rather than silently persisting a partial/degraded history.

Ingestion: `npm run ingest:yahoo-financials[:dry]` (`--ticker`, `--write`) + cron route
`GET /api/cron/financials/yahoo` (Bearer `CRON_SECRET`, unscheduled). Production: all 25 tickers, 2,921 rows,
0 failures — every stock now has 7-10 real reporting periods. The 3 tickers (SQM-B, COPEC, BSANTANDER)
carrying stale synthetic `manual_csv` sample data from the original Phase 8C CSV templates had that data
deleted. Tests: `tests/yahooFundamentals.test.ts` (18 new).

## 14. Phase 8C.6 — non-bank CMF/XBRL completion (promotion + dialect support)

The three `eligible_verified` issuers were **promoted to enabled** (CONCHATORO, FALABELLA, MALLPLAZA) after a
re-confirmed clean live FY2025 dry-run, and the three `unsupported_page_shape` issuers are now **readable and
enabled** after two XBRL parser dialects were added — bringing every non-bank app stock (21 of 25) onto
authoritative CMF/XBRL. The 4 banks stay `bank_track_required`.

**Two dialects added to `src/lib/financials/xbrl/parseXbrl.ts`** (verified byte-identical output for the 15
already-working issuers — CCU regression-checked):

- **Default/unprefixed-namespace (SONDA):** the xbrli instance namespace is the XML *default*, so
  `<context>`/`<unit>`/`<identifier>`/`<period>` are unprefixed (facts stay `cl-ci:`/`ifrs-full:`-prefixed).
  The context/unit/period regexes now accept an **optional `xbrli:` prefix**. SONDA parsed 0 contexts before →
  2044 contexts / 11756 facts / 30 mapped now.
- **CTI-Service ISO-8859-1 (ANDINA-B, VAPORES):** `xbrli:`-prefixed but with **single-quoted attributes** and
  an ISO-8859-1 encoding declaration. All attribute regexes now accept both quote styles, and a new
  `decodeXbrlBytes(buf)` decodes per the `<?xml encoding=?>` declaration (ISO-8859-1 → `latin1`, UTF-8/absent →
  `utf8`, any other declared encoding → `utf8` fail-safe). The provider's `fetchFiling` uses it instead of a
  hardcoded `toString('utf8')`. ANDINA-B 818/4402/30; VAPORES 200/1024/23.

Namespace URIs are parsed into `XbrlInstance.namespaces` (prefix → URI) so a concept's namespace is never
dropped. Taxonomy-only ZIP rejection is unchanged (provider-level, before parsing) — the parser still yields 0
facts for a schema-only document.

**No concept-map change** — both dialects use standard `ifrs-full:` for every mapped concept (verified live).
VAPORES (CSAV, a shipping holdco dominated by its Hapag-Lloyd equity stake) reports **zero** `ifrs-full:Revenue`
facts; that line stays honestly missing (never fabricated; Yahoo fills revenue/quarterly).

**Precedence/fallback (verified live in the DB):** for the 6 newly-enabled issuers, the XBRL FY2025 annual
(priority 210) **supersedes** the Yahoo annual (80) for that year (`is_superseded=true` on the Yahoo row),
while all Yahoo quarterly periods and pre-2025 annual periods stay active as the fallback. Production write:
**174 rows, 0 failures**, all `valid_with_warnings`. No migration, no source-priority change, cron still
unscheduled.
