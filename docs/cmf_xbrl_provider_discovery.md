# CMF XBRL Financial-Statement Provider Discovery (Phase 8C.1)

Companion to `docs/cmf_provider_discovery.md` (Hechos Esenciales — confirmed CAPTCHA-blocked). This document
covers a **separate** CMF surface: public financial-statement (FECU/XBRL) filings under IFRS. Unlike Hechos
Esenciales, this surface has **no CAPTCHA** and is genuinely more promising — but it is still an unofficial,
undocumented HTML surface, not a published API. Everything below was verified with real HTTP requests during
this phase (2026-07-03), not inferred from documentation alone.

**Bottom line: automation feasibility = `feasible_with_mapping`.** Real, official, currently-filed XBRL
instance documents (genuine `.xbrl`/IFRS-taxonomy files, not just blank taxonomy schemas) can be downloaded
with a two-step HTTP GET chain, no CAPTCHA, no login. But there is no published/versioned API contract — the
download link is only discoverable by parsing HTML, the company→RUT mapping must be manually verified per
issuer, and CMF could change the markup at any time without notice. This is not "blocked" the way Hechos
Esenciales is, but it is also not a stable, documented, first-class integration.

---

## 1. What was actually verified (not inferred)

### 1a. Taxonomy download pages — `feasible_now`, but not proof of filing access

- URL pattern: `https://www.cmfchile.cl/portal/principal/613/w3-article-<id>.html` (redirects to
  `w4-article-<id>.html`), one page per year, e.g. 2025 taxonomy at
  `https://www.cmfchile.cl/portal/principal/613/w3-article-89049.html`.
- Offers six taxonomy variants (CL-CI, CL-HB, CL-HS, CL-CC, CL-EI, CL-BS) as direct ZIP downloads (84 KB–1 MB),
  no login, no CAPTCHA.
- **This only proves the taxonomy schema is public.** It does **not** by itself prove that any company's
  actual filed financial statements can be downloaded — confirmed by inspecting the page: it links only to
  blank taxonomy schemas and preparer tooling (an "shell-file generator" for issuers), never to filed
  instance documents. This is the exact trap the phase brief warned about, and it does not hold here — see
  1b/1c for what does prove filing access.

### 1b. Public search form — not a stable/scriptable entry point on its own

- URL: `https://www.cmfchile.cl/institucional/estadisticas/merc_valores/sa_eeff_ifrs/sa_eeff_ifrs_index.php?lang=es&rg_rf=RGEIN`
  (or `rg_rf=RVEMI` for securities issuers).
- No CAPTCHA, no login required to load the form.
- Verified: a direct `GET` with `rut=`/`aa=` query params appended does **not** return a results table — the
  page only renders a company/date/statement-type selector; results only appear after a form submission whose
  exact POST parameters were not reverse-engineered in this phase.
- **Conclusion: this specific search page is not usable as a stable programmatic entry point without further
  reverse-engineering of its POST contract.** Not pursued further because 1c provides a better path.

### 1c. Entity filing page — `feasible_with_mapping` (the real finding)

- URL pattern (verified working via direct `curl`, no browser, no session pre-establishment):
  ```
  https://www.cmfchile.cl/institucional/mercados/entidad.php?
    mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0
    &rut=<RUT sin dígito verificador>
    &mm=<MM>&aa=<AAAA>&tipo=C&tipo_norma=IFRS&pestania=3
    &auth=&send=&row=&rut_inc=&orig=lista
  ```
- **Verified empirically that `row`/`auth`/`send` can be left blank** — the page still resolves correctly
  from `rut`+`mm`+`aa`+`tipo`+`tipo_norma`+`tipoentidad` alone. Confirmed across 3 different periods for one
  company (RUT `99530250`, Ripley Chile: 06/2017, 03/2019, 12/2023 — each returned the correct period's real
  filing data) and again for a second, unrelated company (RUT `90690000`, Empresas Copec, 12/2023). This means
  the real query key is **`rut` + `mm`/`aa` + `tipo` + `tipo_norma`**, not an opaque session token — a
  meaningfully stable, deterministic pattern.
- The resulting HTML page embeds a relative link to the actual XBRL download, e.g.:
  `../inc/inf_financiera/ifrs/safec_ifrs_verarchivo.php?auth=<base64 token>&send=<encrypted token>`
  (resolves to `https://www.cmfchile.cl/institucional/inc/inf_financiera/ifrs/safec_ifrs_verarchivo.php?...`).
  These `auth`/`send` tokens are freshly generated per page load and are **not guessable in advance** — they
  must be scraped from the entity page's HTML on each request. This is the "brittle" part: there is no
  documented contract for this token, and CMF could change its generation logic at any time.
- **Verified real downloads succeed**, no CAPTCHA, no login, cookie is trivial (a session cookie is set by the
  server but was not required to be replayed for the download step to succeed in testing):
  - RUT `99530250` (Ripley Chile), period 12/2023 → `200 OK`,
    `Content-Disposition: attachment; filename=Estados_financieros_(XBRL)99530250_202312.zip`, confirmed via
    `file` to be a genuine ZIP archive containing `99530250_202312_C.xbrl` (2 MB), `.xml`, `_shell.xsd`,
    `_dimension.xsd`, `_dim_definicion.xml`, `_dim_label.xml` — a real, complete IFRS-full + CMF-extension
    (`cl-ci`) XBRL instance with genuine facts (`ifrs-full:Assets`, `ifrs-full:BasicEarningsLossPerShare`,
    `ifrs-full:CashAndCashEquivalents`, `ifrs-full:CashFlowsFromUsedInOperatingActivities`, etc.), real
    context/period/unit blocks, `unitRef="CLP"`.
  - RUT `90690000` (**Empresas Copec — a ticker this app actually covers**), period 12/2023 → same
    two-step chain succeeded, `200 OK`, genuine ZIP (`90690000_202312_C.xbrl`, 2.7 MB).
- **Important real-world nuance found while inspecting the Copec file**: its `<xbrli:unit>` block contains
  only `USD`/`sharesItem`/`Unit_shares`/`pure` — **no `CLP` unit at all**. Facts like `ifrs-full:ProfitLoss`
  were tagged `unitRef="USD"`. Confirms the phase brief's caution not to assume uniform labels/units across
  companies — currency must always be read per-fact from the unit block, never assumed to be CLP. Ripley's
  file, by contrast, used `unitRef="CLP"` throughout. Context-ID naming conventions also differ completely
  between filers (Ripley: `AnualAnterior`, `CierreTrimestreActual`, …; Copec: `p1_Duration`, `p2_Duration`, …)
  — confirms concept mapping must key off the IFRS **concept name**, never the context ID string.
- Both companies' filings use the standard `ifrs-full` (IFRS Foundation) taxonomy namespace plus a CMF
  extension namespace (`cl-ci` for Ripley's 2023 taxonomy year) — meaning the concept vocabulary is largely
  shared across filers, which is what makes a conservative concept map worth building at all (see
  `src/lib/financials/xbrl/conceptMap.ts`).

### 1d. Access method summary

| Aspect | Finding |
|---|---|
| Source URL | `https://www.cmfchile.cl/institucional/mercados/entidad.php` (page) → `.../institucional/inc/inf_financiera/ifrs/safec_ifrs_verarchivo.php` (download) |
| Source type | Public HTML page + linked file download (not a published API) |
| Access method | Direct HTTP GET, two steps: (1) entity page by `rut`+period, (2) parse HTML for XBRL href, follow it |
| CAPTCHA | **None encountered anywhere in this chain** |
| Login/session | **None required** — verified via stateless requests; the server sets a cookie but replay was not required for success |
| Stability | Query key (`rut`+`mm`+`aa`+`tipo`+`tipo_norma`) is deterministic and reusable; the download token is per-page-load and must be scraped fresh each time — **no documented/versioned API contract exists** |
| Coverage | Confirmed for 2 companies (Ripley — not app-covered; Empresas Copec — app-covered). Not verified across all issuers or all filing types (e.g., bank-specific FECU forms, older pre-XBRL years) |
| Terms/blockers | No terms-of-service review was performed in this phase; no CAPTCHA/login blocker found technically |

### 1e. Automation feasibility verdict

**`feasible_with_mapping`** — technically accessible without CAPTCHA bypass, OCR, or AI extraction, but:
- requires HTML scraping of an undocumented, unversioned page (brittle by nature — could silently break),
- requires a verified, explicit `ticker → RUT` mapping maintained per issuer (no fuzzy matching),
- was only verified for 2 companies out of the app's covered universe (COPEC verified; SQM-B's RUT was
  verified via CMF's own entity pages but the download chain was not separately re-tested for SQM-B in this
  phase to conserve scope; BSANTANDER's RUT could **not** be confidently verified — see Section 2).

**Recommended next action:** build the provider abstraction and a working discovery/fetch/parse path (done
this phase — see Sections 3–6), but keep automated writes to `--write`-gated, per-ticker, human-reviewed
runs until the HTML-scraping surface has been exercised against more issuers and monitored for stability over
time. Do not schedule this as an unattended cron job yet.

---

## 2. Issuer identifier mapping — what was verified

See `src/lib/financials/cmfIssuerMap.ts` for the machine-readable version. Only entries with a `verifiedAt`
timestamp and a direct `sourceUrl` are considered usable by the provider; everything else is `unmapped`.

| Ticker | CMF issuer name | RUT (sin DV) | Verified via | Status |
|---|---|---|---|---|
| SQM-B | SOCIEDAD QUIMICA Y MINERA DE CHILE S.A. | `93007000` | Direct CMF `entidad.php?rut=93007000&tipoentidad=RVEMI` URL, consistent across 6 independent CMF page links (Identificación, Información Financiera, URL a EEFF, 12 Mayores Accionistas, Prácticas de Gobierno Corporativo) | Verified |
| COPEC | EMPRESAS COPEC S.A. | `90690000` | Direct CMF `entidad.php?rut=90690000&tipoentidad=RVEMI` URL, consistent across 8 independent CMF page links; **and** a full end-to-end XBRL download was successfully completed for this RUT in this phase | Verified (highest confidence — real download completed) |
| BSANTANDER | Banco Santander-Chile | — | **Not verified.** Search results returned several *related* Santander entities under `tipoentidad=RVEMI` (Santander Chile Holding S.A. `96501440`, Santander S.A. Sociedad Securitizadora `96785590`, Santander Consumer Finance Limitada `76002293`) but none of these is the bank itself, and a candidate RUT surfaced by search (`97036000`) returned "Sin información" when queried directly against `entidad.php` — i.e. it was wrong. Banks are supervised under a different CMF registry track than plain securities issuers and were not resolved in the time budget for this phase. | **Unmapped — do not guess** |

**Rule applied:** per the phase's explicit instruction, RUTs are never guessed. BSANTANDER stays unmapped
until a RUT can be confirmed directly against an official CMF page (not a search-engine snippet, which was
shown in this phase to sometimes attach the wrong RUT to the wrong entity name).

---

## 3. What Phase 8C.1 built on top of these findings

- `src/lib/financials/cmfIssuerMap.ts` — the verified mapping table above, plus an explicit unmapped list.
- `src/lib/financials/providers/types.ts` — a source-agnostic `FinancialsProvider` interface; manual CSV
  becomes one implementation of it (not the conceptual model), so CMF/XBRL and any future vendor/broker feed
  share the exact same contract and ultimately call the same `financialsRepository.ts` upsert functions.
- `src/lib/financials/providers/cmfXbrlProvider.ts` — implements the two-step fetch chain described in 1c for
  the verified issuers only; returns a structured `blocked` result (reason: `issuer_not_mapped`) for any
  ticker not in the verified map, rather than guessing or silently failing.
- `src/lib/financials/xbrl/parseXbrl.ts` — a minimal, dependency-free XBRL instance parser (contexts, units,
  facts) built and tested against a small **synthetic** fixture modeled on the real structure observed above
  (not the real 2–2.7 MB filings, which were not committed — see Section 4).
- `src/lib/financials/xbrl/conceptMap.ts` — conservative `ifrs-full:*` concept → internal line-item mapping,
  built only from concepts actually observed in the two real filings inspected in this phase.
- `scripts/discover/cmfXbrlFinancials.ts` — CLI with `discover` (default), `dry-run`, and `--write` modes.
- Supersession was validated with a controlled test (see `docs/data_source_status.md` and the final report) —
  not a scheduled/unattended production ingestion.

## 4. What was intentionally not committed

The real downloaded ZIP/XBRL files (Ripley 2 MB, Copec 2.7 MB) were inspected locally during discovery and
**were not committed** — they are large, filer-specific, and not needed for tests. Instead, a small synthetic
fixture (`tests/fixtures/xbrl/sample_instance.xbrl`, a few KB) was authored by hand, reusing the real concept
names, unit structure, and context patterns observed above, for a fictional filer — safe to commit, sufficient
to exercise the parser and concept map.

## 5. Recommended next action

Continue CMF/XBRL automation cautiously: extend the verified issuer map (manually, per issuer, no guessing),
exercise the fetch chain against more of the app's covered tickers, and monitor stability over a few weeks
before considering any scheduled/unattended ingestion. Do not treat this as equivalent to the BCCh official
API — it remains an unofficial, scrapeable-but-undocumented HTML surface.
