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

### Public listing pages

The CMF publishes a rolling listing of recent HE/II filings on its portal. Observed entry structure:

| Field | Description |
|---|---|
| Fecha | Filing date (DD-MM-YYYY format) |
| Hora | Filing time (HH:MM) |
| Nro. Documento | Document number — the primary filing identifier |
| Entidad | Legal entity name (usually uppercase) |
| Materia | Subject/topic (Spanish, varies by company) |
| Link | Typically a link to the PDF or HTML filing on cmfchile.cl |

### Access

- **Status:** Appears publicly accessible without authentication
- **Format:** HTML table (Bootstrap-style, server-rendered)
- **Structure stability:** Moderate — CMF has redesigned its portal before. Parser must be robust
  to class name and whitespace changes.
- **Update frequency:** Near real-time during market hours; filings available shortly after submission
- **Parser difficulty:** Medium — Spanish date formats, inconsistent entity names, link patterns vary

### Rate limit / robots

- No published API rate limit for public HTML pages
- Must use a conservative User-Agent and request interval
- **Do not hammer the portal.** One request per discovery run is sufficient for a 7-day sample.
- Check robots.txt before any automated ingestion in Phase 5A.1

### Recommended phase

- **5A:** Architecture, parser design, fixture-based tests (current)
- **5A.1:** Run `discoverHechos.ts`, validate parser against real output, confirm field extraction
- **5B+:** Scheduled ingestion with Supabase persistence

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

## Phase 5A.1 Next Steps

1. Run `npm run cmf:discover-hechos` to fetch and parse the public HE listing.
2. Inspect `tmp/cmf-hechos-discovery.json` for field coverage and parser confidence.
3. Confirm entity name → ticker mapping for top 10 issuers in `cmfEntityMap.ts`.
4. If parser confidence is ≥ 0.8 for most rows, proceed to scheduled ingestion design.
5. Document any format issues or missing fields in this file.
6. Confirm robots.txt policy at cmfchile.cl before any scheduled runs.
