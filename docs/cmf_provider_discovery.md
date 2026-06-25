# CMF Provider Discovery — Phase 5A

Discovery document for Comisión para el Mercado Financiero (CMF) data sources.
Covers Hechos Esenciales, Información de Interés, EEFF/XBRL, entity pages, and the CMF API.

**Status:** Preliminary survey — no live ingestion enabled yet. All sources must be validated
via `npm run cmf:discover-hechos` before implementing live provider calls.

---

## CMF Portal Overview

The CMF (Comisión para el Mercado Financiero) is the Chilean financial regulator. It publishes
mandatory disclosure filings electronically. The primary public portal is:

- **Portal CMF:** https://www.cmfchile.cl

There is also a dedicated API for the banking sector:
- **CMF Bancos API:** https://api.cmf.cl — covers banking/insurance supervision data.
  Does **not** appear to cover Mercado de Valores (stock/bond) filings. Verify before using.

---

## A. Hechos Esenciales (HE) and Información de Interés (II)

### What they are

- **HE (Hecho Esencial):** Material fact filings mandatory for publicly listed companies when any event
  could significantly affect share price. Examples: dividends, M&A, debt issuance, management changes.
- **II (Información de Interés):** Supplementary filings of general investor interest.

### Portal redesign (confirmed 2025-06-25 during Phase 5A.1 discovery)

**The old `/sitio/aplic/serdoc/` path is completely dead.** All legacy PHP paths return HTTP 404.
CMF has migrated to the Newtenberg CMS platform. New base URL: `https://www.cmfchile.cl/portal/principal`.

**Current HE page:** `https://www.cmfchile.cl/institucional/hechos/hechos.php`

This page is a **search form**, not a passive listing. It POSTs/GETs to `hechos2.php` with:
- Tipo de Entidad (dropdown)
- Entidad (text), Fecha desde/hasta, Días, Materia
- **CAPTCHA (required):** `/biblioteca/captcha2/captcha_hechos.php`

### ⚠ CAPTCHA GATE — live scraping blocked

The CMF HE search form requires image CAPTCHA validation before returning results.
Automated bypass is **prohibited** by project scope rules. This blocks HTML scraping of HE data.

### Expected filing fields (from prior portal — structure likely preserved in results)

| Field | Description |
|---|---|
| Fecha | Filing date (DD-MM-YYYY format) |
| Hora | Filing time (HH:MM) |
| Nro. Documento | Document number — the primary filing identifier |
| Entidad | Legal entity name (usually uppercase) |
| Materia | Subject/topic (Spanish, varies by company) |
| Link | Link to PDF or HTML filing on cmfchile.cl |

### Access

- **Status:** Search form accessible publicly; results require CAPTCHA — **not automatable via HTML**
- **Format:** Unknown (results served by `hechos2.php`; not yet inspected due to CAPTCHA)
- **Update frequency:** Near real-time during market hours
- **Parser difficulty:** N/A until CAPTCHA-free path found

### Rate limit / robots

- CAPTCHA itself functions as an access control
- Must use a conservative User-Agent; never hammer the portal
- Subscription service available: `/institucional/publicaciones/suscripcion_interes/`

### Recommended phase

- **5A:** Architecture, parser design, fixture-based tests ✓ COMPLETE
- **5A.1:** Portal discovery run ✓ COMPLETE — CAPTCHA gate found, live HTML scraping blocked
- **5A.2-alt:** Identify CAPTCHA-free access path (CMF API, licensed data feed, or broker provider)
  before enabling live CMF HE ingestion
- **5B+:** Supabase persistence design — proceed with static data

### Known caveats

- Entity names in CMF filings use legal names (e.g. "SOCIEDAD QUIMICA Y MINERA DE CHILE S.A.")
  that must be mapped to internal tickers via `cmfEntityMap.ts`.
- Document numbers are integers and appear unique per filing. Use as the primary external key.
- Some filings link to PDFs hosted on cmfchile.cl; others to HTML versions. Both must be handled.
- CMF occasionally re-publishes corrected filings with new document numbers.
- `parserConfidence` in discovery output reflects how cleanly each row was parsed (1.0 = all fields
  present, 0.5 = some fields missing, 0.0 = row could not be parsed).

---

## B. Entity-Specific CMF Pages

Each registered issuer has an entity page on the CMF portal listing:

- All Hechos Esenciales by that entity
- Memoria Anual (Annual Report)
- EEFF / estados financieros (financial statements)
- Sanctions/resolutions (when applicable)
- Bond prospectuses

### Access

- **Status:** Publicly accessible; URL includes entity RUT or CMF entity code
- **Format:** HTML; typically requires knowing the entity's RUT or CMF identifier
- **Structure stability:** Moderate
- **Parser difficulty:** High — paginated, varies by entity type (bank vs. issuer vs. fund)

### Recommended phase

- **6+:** Deep per-entity ingestion (out of scope until Phase 5A.1 entity mapping is confirmed)

---

## C. Financial Statements / XBRL (EEFF / FECU)

The CMF publishes quarterly and annual financial statements in XBRL format for issuers.

- **XBRL portal:** https://www.cmfchile.cl/sitio/aplic/informes/

### Access

- **Status:** Publicly accessible
- **Format:** XBRL (XML-based); also available as HTML renderings
- **Parser difficulty:** High — requires an XBRL taxonomy parser; schemas vary by entity type

### Recommended phase

- **7+:** XBRL parsing is a dedicated later phase. Do not attempt in Phase 5A.

### Known caveats

- Banks file under a different taxonomy than non-financial issuers.
- FECU (the older format) is still used for some historical filings.
- XBRL taxonomy version changes require parser updates.

---

## D. CMF API

### CMF Bancos API

- **URL:** https://api.cmf.cl/api/v1
- **Coverage:** Banking sector — balance sheets, loan portfolios, interest rates, liquidity ratios
- **Auth:** May require registration; check documentation at https://api.cmf.cl
- **Scope:** Banking supervision data only — does **not** cover Mercado de Valores HE filings

### CMF Mercado de Valores

- No documented REST API for Hechos Esenciales or EEFF was confirmed at time of writing.
- The portal appears to be a server-rendered website, not an API backend.
- **Do not assume an undocumented API exists.** If discovered, document it here before using.

### Recommended phase

- Confirm CMF Bancos API scope in Phase 5A.1 if banking metrics are needed
- Monitor for any official CMF Mercado de Valores API announcement

---

## Source Summary Table

| Source | Data Available | Public? | Structure | Parser Difficulty | Phase |
|---|---|---|---|---|---|
| CMF HE/II listing (7 days) | Filings list, links to PDFs | Yes | HTML table | Medium | 5A / 5A.1 |
| CMF entity page | All filings per company | Yes | HTML, paginated | High | 6+ |
| CMF XBRL/EEFF | Financial statements | Yes | XBRL / XML | High | 7+ |
| CMF Bancos API | Banking sector metrics | Likely free | REST JSON | Low (if documented) | TBD |
| CMF Mercado API | HE/EEFF via API | Unknown | Unknown | Unknown | TBD |

---

## No-Scraping Policy

- Use only public, officially accessible pages.
- No reverse-engineering of private endpoints.
- No session token extraction.
- No CAPTCHA bypass.
- No aggressive crawling (one request per discovery run).
- No storing or re-distributing CMF document contents beyond what is necessary for indexing.
- If a source requires login or registration, do not automate credentials — document and flag.

---

## Phase 5A.1 — Discovery Results (2026-06-25)

Discovery ran successfully. Findings:

1. **Old `/sitio/aplic/serdoc/` paths:** All HTTP 404 — legacy portal completely offline.
2. **Current HE URL:** `https://www.cmfchile.cl/institucional/hechos/hechos.php`
   (found via homepage link extraction).
3. **CAPTCHA gate confirmed:** Form requires image CAPTCHA before serving results.
   Automated HTML scraping blocked — CAPTCHA bypass prohibited by project rules.
4. **Parser status:** `hechosListParser.ts` is correct for HTML tables; 0 rows returned
   because no table data is served without CAPTCHA. All 114 tests pass.
5. **Entity mapping:** All 25 entries remain `verified:false` — no official CMF data obtained.
6. **Subscription service found:** `/institucional/publicaciones/suscripcion_interes/` —
   manual email alerts only, not machine-readable.

## Phase 5A.2-alt — Paths to CAPTCHA-Free Access

Before enabling live CMF HE ingestion, confirm one of:

1. **CMF api.cmf.cl** — banking/insurance API; verify if Mercado de Valores HE are covered.
2. **Direct `hechos2.php` URL with known params** — test if CAPTCHA is only client-side validation;
   if server enforces it (expected), this path fails. Do not attempt bypass.
3. **CMF licensed data feed** — CMF may offer institutional data feeds; contact CMF directly.
4. **Brain Data / broker aggregator** — Phase 4C provider may include CMF HE data in their feed.
5. **Discovery script `discoverHechos.ts`** — now probes multi-candidate URLs and saves homepage
   for structural analysis. Update `CMF_HECHOS_CANDIDATES` if a new path is found.

## Next Phase Recommendation

**Proceed to Phase 5B — Supabase persistence design** with static CMF data.
Live CMF HE ingestion via public HTML is blocked until a CAPTCHA-free path is confirmed.
