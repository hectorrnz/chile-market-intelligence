# BCCh Series Mapping Workflow (Phase 4B)

How to discover, verify, and enable official Banco Central de Chile (BCCh) BDE
series for the live macro provider. **No series codes are ever guessed** — each
is confirmed against the official catalog by a human before it is enabled.

---

## 1. Credentials

The live workflow needs a BCCh BDE / SieteRestWS account.

1. Register at the BCCh statistics portal (Base de Datos Estadísticos / SieteRestWS).
2. Put the credentials in `.env.local` (server-only, never committed):

```
BCCH_API_USER=your_user
BCCH_API_PASSWORD=your_password
# optional, has a default:
BCCH_API_BASE_URL=https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx
```

Credentials are read only by the discovery/validation scripts and the
server-side `/api/macro*` routes. They are **never** logged and **never**
exposed to the browser (no `NEXT_PUBLIC_` prefix).

Without credentials everything still works — the app stays on static MVP data
and the scripts exit cleanly with a message.

---

## 2. Discover candidates — `npm run bcch:search`

```
npm run bcch:search
```

- Queries the official **SearchSeries** catalog for DAILY / MONTHLY / QUARTERLY /
  ANNUAL frequencies (official API, **no scraping**).
- Filters titles with Spanish keyword patterns per indicator (TPM, UF, dólar
  observado, IPC, IMACEC, desocupación, cobre, BTU/BTP/BCU/PDBC/Cámara/swap…).
- Writes **`tmp/bcch-series-candidates.json`** (gitignored) and prints a report:

```
indicatorId   seriesId            confidence  frequency  name
tpm           <code>              high        DAILY      Tasa de política monetaria …
```

Confidence is a **heuristic only** (high/medium/low). It never auto-enables a
series — it is a shortlist for human review.

---

## 3. Review & confirm

1. Open `tmp/bcch-series-candidates.json`.
2. For each indicator, pick the row whose Spanish name unambiguously matches the
   intended concept and frequency (e.g. the *dólar observado* daily series, the
   IPC **12-month variation** vs the **monthly variation**, etc.).
3. Cross-check the seriesId on the BCCh portal if unsure.

---

## 4. Map the confirmed code

Edit **`src/config/bcchSeriesManualMap.ts`** — the single controlled mapping
layer. For a confirmed series:

```ts
'usdclp': {
  seriesId: 'F073.TCO.PRE.Z.D',   // ← confirmed official code (example shape only)
  verified: true,
  frequency: 'DAILY',
  transformation: 'none',
  staticId: 'usdclp',
  sourceName: 'Dólar observado',
  confidence: 'high',
  verificationDate: '2026-06-24',
  verificationMethod: 'SearchSeries + portal cross-check',
  notes: 'Observed USD/CLP',
},
```

Rules:
- Set `seriesId` and `verified: true` **only** after confirming the official code.
- Choose the right `transformation` (see §6 below).
- Leave anything unconfirmed as `seriesId: null, verified: false` — it stays
  disabled and the static fallback is used.

`src/config/macroSeries.ts` derives `enabled` / `providerSeriesCode` /
`transformation` from this map automatically — you do not edit it for codes.

---

## 5. Validate live values — `npm run bcch:validate`

```
npm run bcch:validate
```

Validates **only** entries with `verified: true` and a non-null `seriesId`. For
each it calls **GetSeries**, parses via `normalizeBcchSeries`, then checks:

- non-empty observations and parseable dates,
- latest value within a broad **plausibility band** (`src/lib/providers/plausibility.ts`),
- **frequency coherence** (median gap between observations matches the declared frequency).

Series that fail are reported and must **not** be enabled — leave them disabled
so static fallback continues.

---

## 6. Transformations

Each mapped series declares how the provider derives the displayed value/change
(`src/lib/providers/transforms.ts`):

| transformation | meaning |
|---|---|
| `none` | use the raw value; change = delta vs previous observation |
| `mom` | month-over-month % from an index level |
| `yoy` / `level-to-yoy` | 12-month % from a (monthly) level series |
| `bp-to-pct` | rescale basis points to percent |

Prefer mapping a series that is **already** in the displayed unit (e.g. the
published IPC 12-month variation) with `transformation: 'none'`. Only use `yoy`/
`mom` when you must derive the % from an index level.

UI display rules are unchanged: **value first, change second in one pair of
parentheses, no bp/pp/bps suffixes** — formatting stays in the UI layer.

---

## 7. Status

| Indicator | manualKey | Verified? |
|---|---|---|
| TPM | `tpm` | ❌ not mapped |
| IPC m/m | `ipc-mom` | ❌ not mapped |
| IPC 12m | `ipc-yoy` | ❌ not mapped |
| UF | `uf` | ❌ not mapped |
| USD/CLP (observado) | `usdclp` | ❌ not mapped |
| IMACEC 12m | `imacec-yoy` | ❌ not mapped |
| Unemployment | `unemployment` | ❌ not mapped |
| Copper | `copper` | ❌ not mapped (external/LME, not BCCh) |
| BTU 10 / BTP 10 / BTU 5 / BCU 5 | `btu-10`/`btp-10`/`btu-5`/`bcu-5` | ❌ not mapped |
| Cámara Swap 2Y/1Y, PDBC 90d, TPM TNA | `camara-swap-2y`/`camara-swap-1y`/`pdbc-90d`/`tpm-tna` | ❌ not mapped |

**All indicators are currently unmapped** because BCCh credentials were not
available during Phase 4B, so the official SearchSeries discovery could not be
run. The workflow above is ready; once credentials exist, run `bcch:search`,
confirm codes, map them, and run `bcch:validate`.

---

## Caveats & policy

- **No guessed series codes — ever.** Only official SearchSeries/GetSeries
  verification is acceptable.
- The SearchSeries response field names and the IPC/IMACEC variation-series
  availability must be confirmed on the first real run; the parser is defensive
  but may need a tweak once a live payload is seen.
- Copper and some local-rate instruments may not exist in the BCCh BDE catalog
  and may need an external provider in a later phase — keep them disabled here.
- Credentials are server-only and never logged. Scripts never run during build.
