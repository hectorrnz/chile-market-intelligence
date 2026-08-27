# R13.R1 — BVL / INRETC1 source discovery

Answers §§ 12 and 13 of the R13.R1 instruction. Every probe below was executed
live on **2026-08-11** from this development machine with a normal browser
User-Agent. Verdict: **no free official BVL source yields a dated,
currency-qualified CLOSE for INRETC1**, so § 12's stated fallback
(administrator/workbook-supplied price with explicit provenance) is what ships,
behind the full provider contract.

---

## 1 · What was probed

### 1.1 The issuer page § 12 names

`https://www.bvl.com.pe/en/issuers/detail?companyCode=74222` → **200**, but the
body is an Angular SPA shell. The host serves **one identical 9 030-byte
response for every path it does not server-render** — including a genuinely
existing static asset (`/assets/bundles/highcharts.js`). There is no issuer data
in the HTML and the bundles cannot be retrieved to find the API base.

### 1.2 The SPA's backend

`https://api.bvl.com.pe/` and every path under it → **403
`{"message":"Forbidden"}`** (AWS API Gateway, uniform for `api/Market/GetQuote`,
`v1/companies`, `api/v1/companies`, `sistema/inf_diaria`). This is a key-gated
API; BVL sells access under "Market Data / Servicios de suscripción". A paid,
keyed vendor feed is outside this project's standing no-paid-vendor rule.

### 1.3 BVL's official daily publications

`https://documents.bvl.com.pe/` — the legacy document server the current site
redirects to for pre-migration URLs. Its own landing page states:

> "Este sitio web solo brinda información actualizada para: **Consulta Renta
> Fija · Operaciones Extrabursátiles · Alerta Bolsa News**"

Equity quotation publications are not in that list, and the equity file that
does still respond confirms it:

`pubdif/boldia/presencia.htm` → 200, 21 927 bytes, real content, **does list
`INRETC1`** — but it is stamped **"Actualizado al 28 de diciembre de 2023"** and
carries *Presencia Bursátil %* (a market-presence percentage), not a price.

Directory listings under `pubdif/` return `application/x-directory` with zero
bytes; other legacy paths return 403.

### 1.4 The daily-movements page

`https://www.bvl.com.pe/mercado/movimientos-diarios` server-renders (56 250
bytes with a full browser UA) and **does contain `INRETC1`** — in a ticker
marquee:

```
|SCHD|34.420| (0.67%) |INRETC1|36.600| (0.00%) |IHYA|7.500| (-0.16%) …
```

The daily-movements **table itself is client-rendered** and absent from the
server response; the marquee is the only INRETC1 occurrence.

**This marquee is not usable as a close, for five independent reasons** — each
of which maps to a specific § 12 requirement:

| § 12 requirement | Why the marquee fails it |
|---|---|
| close price | The page states **"Los datos de cotización tienen un retraso de 20 min"** — an intraday delayed quote, not a close. |
| source observation date | The strip carries **no date at all**. Stamping it with a server date would fabricate the observation date. |
| USD validation | The strip carries **no currency**, and mixes PEN- and USD-denominated instruments in the same list. USD could only be assumed. |
| unavailable state distinct from zero | The strip prints **`0.000`** for instruments that have not traded (`SPY`, `AMZN`, `TSLA`, `IFS` … in the captured response). Ingesting it would turn "no trade" into "price zero". |
| weekly historical observations | Today-only. No history is derivable. |

---

## 2 · What ships

`src/lib/providers/market/bvlProvider.ts` implements the **complete § 12
contract** — symbol validation, currency validation, exact-date and prior-close
alignment, the never-future-close rule, explicit provenance, a 6-hour cache, an
8-second timeout, and an unavailable result that carries no number — behind a
gate:

```ts
export const BVL_SOURCE_VERIFIED = false
```

While that gate is false the app makes **no BVL request at all**. The default
fetcher exists and returns `{ ok: false }` deliberately, so the gate is the only
thing standing between this module and the network — not the absence of an
implementation, which would quietly become a different guarantee the day someone
added one.

The active path is § 12's fallback, `adminSuppliedClose(...)`, which returns
provenance `admin_supplied` and the label *"Administrator-supplied price (source
workbook)"*. It is a **separate function**, not a branch inside `getBvlClose`,
so an administrator figure can never be returned wearing `bvl_official_close`
provenance.

**There is no Yahoo fallback.** § 12 forbids silently substituting an unofficial
provider, and the One Pager's InRetail row already has an honest source: the
workbook's own price.

Tests (`tests/bvlProvider.test.ts`) are fixture-based and **never touch the
network** — fixtures are written from the official response *shape*, not copied
from private data (§ 13).

---

## 3 · What would flip the gate

A free, official BVL endpoint returning, per session: symbol, ISO date, close,
and currency. If one appears, only two things change — `BVL_SOURCE_VERIFIED`
becomes `true` and `defaultFetcher` gains a real request. Every alignment,
validation and provenance rule is already written and already tested.

Re-check periodically; the site was mid-migration at the time of this probe (the
legacy document server is explicitly in wind-down), so the surface may change.
