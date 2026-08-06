# R13.0 · Document 03 — Alternatives Source Contract (Upload B)

**Phase:** R13.0 — documentation only.
**Source inspected:** `portfolio-source-reference.xlsx`, worksheet `Alternatives` (read-only,
temporary). 182 rows × 117 columns, 12,491 cells.

---

## 1. Independence from Upload A — PROPOSED

Upload B is a **separate workbook upload** with its own upload record, validation, draft,
publication date, revision history, rollback control, and freshness indicator.

**Consequence — VERIFIED as a real risk.** Alternatives valuations are driven by
`Fecha último statement`, which in the sample carries dates spread across **2022-12-31 through
2026-07-31**, while the RESUMEN publication is a single weekly date. The two datasets are
*structurally* out of step. The UI must therefore always show **two independent as-of stamps** and
must never present one date as covering both. A mismatch is normal and must be stated honestly, not
reconciled away.

An Upload B workbook must be parsed for its `Alternatives` sheet only; a `RESUMEN` sheet present in
the same file is ignored.

---

## 2. Master-data block — VERIFIED

Header row **5**:

| Col | Header | Meaning |
|---|---|---|
| `A` | *(unlabelled)* | completeness marker, value `completo` |
| `B` | `Nombre de la Inversión` | investment name / legal entity |
| `C` | `Sociedad` | owning sociedad |
| `D` | `Capital Committed` | committed capital |
| `E` | `Contributions` | contributions to date |
| `F` | `Unfunded` | unfunded commitment |
| `G` | `Fecha último statement` | last statement date (or the literal `Inversión Inicial`) |
| `H` | `Última Valorización` | last reported valuation |
| `I` | `Flujo desde último statement` | cash flow since that statement |
| `J` | `Valor Actual` | current value |
| `K` | `TIR Informada` | reported IRR |
| `L` | `TIR Calculada` | calculated IRR |

`B1` carries the instruction **`No modificar las filas o c…`** ("do not modify the rows or columns"),
confirming the layout is intended to be stable — but the parser must still anchor semantically
(§ 6), because "intended to be stable" is not a guarantee.

### 2.1 Category and currency grouping — VERIFIED

Category header rows carry the category in `B` and a currency declaration in `D`:

| Row | Category | Currency declaration |
|---|---|---|
| 7 | `Private Debt` | `inversiones en dólares` |
| 12 | `Private Equity` | `inversiones en dólares` |
| 63 | `Real Assets` | `inversiones en dólares` |
| 97 | `Real Assets` | `inversiones en euros` |
| 105 | `Private Equity` | `inversiones en UF` |
| 111 | `Real Assets` | `inversiones en pesos` |

**Critical — VERIFIED:** the sheet is **multi-currency**. `(category, currency)` is the grouping key;
category alone is ambiguous (`Real Assets` appears three times in three currencies). Amounts in
columns `D`–`J` are denominated in the **currency of their governing category header**, not in USD.

**PROPOSED:** every ingested alternatives row must store its source currency, taken from the nearest
category header above it. A row whose currency cannot be resolved blocks with
`alternatives_currency_unresolved`. Cross-currency totals must **not** be computed by NMI (§ 4.2).

### 2.2 Structure below a category

```
<category row>            B=category,  D=currency declaration
  <investment name row>   B=fund name, other columns empty
    <sociedad rows>       A=completo, B=legal entity, C=SOCIEDAD, D..L=values
```

One fund is typically held by several sociedades, each on its own row (e.g.
`Trinity Alps Venture Opportunities Fund II-B LP` appears under `NAIDELT`, `RETBOY`, `VANGLOR`,
`SAN ROQUE`). The grain of the master table is therefore **(investment × sociedad)**.

### 2.3 Derived columns — VERIFIED

Read from the sample (156 hardcoded vs 141 formula cells across `D`–`L`, rows 9–120):

```
F = D − E                    Unfunded  =  Capital Committed − Contributions
J = I + H                    Valor Actual = Flujo desde último statement + Última Valorización
I = −<last timeline cell>    e.g. I15 = -DC15
L = IRR(N{r}:DE{r})          TIR Calculada = Excel IRR over the event timeline
```

`K` (`TIR Informada`) is always hardcoded — it is externally reported, never derived.

**PROPOSED:** ingest `F`, `J`, and `L` as **cached source values** and additionally **recompute**
`F` and `J` from their components as a validation cross-check. A discrepancy beyond a small
tolerance raises `alternatives_derived_mismatch` (warning, not a block). `L` is discussed in § 4.1.

---

## 3. Event timeline and colour semantics — VERIFIED

### 3.1 Timeline geometry

Row 5 continues past the master-data columns into a **strictly monthly** date series:

- **94 columns**, `N` = `2018-10-31` through `DC` = `2026-07-31`
- Verified **strictly monthly with no gaps and no out-of-order entries**
- Each investment×sociedad row carries its cash-flow events in these columns

### 3.2 The legend — VERIFIED

The legend is three cells in column `DC`, rows 1–3, each filled with the colour it defines:

| Cell | Label | Fill (as stored) | Resolved colour |
|---|---|---|---|
| `DC1` | **`Aporte`** | `rgb="FF002060"` | `#002060` — very dark navy |
| `DC2` | **`Dividendo`** | `rgb="FF92D050"` | `#92D050` — green |
| `DC3` | **`Distribución`** | `theme="3" tint="0.3999…"` | theme 3 = `dk2` = `#1F497D`, lightened → medium blue |

Theme resolution — VERIFIED from `xl/theme/theme1.xml`. The `clrScheme` element order is
`dk1, lt1, dk2, lt2, accent1…`, but Excel's `theme=` attribute indexes
`0=lt1, 1=dk1, 2=lt2, 3=dk2, 4=accent1…`. **`theme="3"` therefore resolves to `dk2 = #1F497D`**, not
to `lt2`. Getting this mapping wrong inverts light and dark and would misclassify every
`Distribución`.

> **Collision warning — VERIFIED.** Column `DC` is simultaneously the **last timeline column**
> (`DC5 = 2026-07-31`) and the **legend column** (`DC1:DC3`). A parser that treats "column DC" as the
> legend will discard a month of real events; one that treats all of `DC` as timeline will read the
> legend labels as data. The legend is `DC1:DC3` **specifically**, above the header row.

### 3.3 Colour census — VERIFIED

Across the timeline zone (rows ≥ 6, columns `N`–`DC`):

| Fill | Event | Value-bearing cells | Sign |
|---|---|---|---|
| `FF002060` | Aporte | **154** | 152 negative, 4 zero, **0 positive** |
| `FF92D050` | Dividendo | **29** | **all positive** |
| `theme3@0.40` | Distribución | **28** | **all positive** |
| *(no fill)* | **unclassified** | **73** | mixed |
| any other colour | — | **0** | — |

**Sign convention — VERIFIED and consistent:** `Aporte` is negative (cash out to the fund);
`Dividendo` and `Distribución` are positive (cash in). This is what makes `L = IRR(...)` well-formed.

### 3.4 The 73 uncoloured cells — VERIFIED, and the real ambiguity

No *unknown* colour exists in the sample, but **73 value-bearing timeline cells carry no fill at
all**. Inspection shows two distinct populations:

1. **Long runs of `0`** — e.g. `N69`…`AQ69` on `Comercial de Valores Inmobiliaria` (FIP HMC
   Multifamily). A zero is not an event; it is padding.
2. **At least one non-zero uncoloured value** — `CX10 = 21775.67` on
   `Inmobiliaria e Inversiones La Esperanza` (Private Debt / FI Compass). This is a real amount with
   no event classification.

**PROPOSED — deterministic classification and warning contract:**

| Case | Classification | Action |
|---|---|---|
| Known legend colour, non-zero value | that event type | ingest |
| Known legend colour, value `0` | that event type, zero amount | ingest; do not emit an event row |
| **No fill, value `0` or empty** | `not_an_event` | ingest silently as padding — **no warning** |
| **No fill, non-zero value** | `unclassified_event` | **warning + administrator classification required before publication** |
| **Unknown fill, value `0` or empty** | `not_an_event` | warning `unknown_fill_no_value` (informational) |
| **Unknown fill, non-zero value** | `unclassified_event` | **warning + administrator classification required** |
| Legend colour outside `DC1:DC3` or legend missing | — | **block** `alternatives_legend_missing` |

**Answering the brief's question directly:** an unknown or absent colour should **not** hard-block
publication, and should **not** be silently allowed. It should **require administrator
classification** when the cell carries a value, and be **allowed silently only when the cell has no
value** (or a zero). Blocking outright would make the module unusable — 73 such cells exist today,
almost all benign zeros. Silently allowing would fabricate event semantics. Requiring an explicit
decision on the small non-zero subset is the only honest option, and it degrades gracefully: an
administrator who classifies nothing simply cannot publish that one investment's event history.

**PROPOSED — tint/shade tolerance.** Match within a colour *family*, not by exact equality:
normalise the fill to sRGB (resolving `theme` + `tint` via `theme1.xml`, and `indexed` via the
standard palette), convert to HSL, and accept a candidate when hue is within ±12° of the legend
colour and it is the nearest legend colour by ΔE. This admits genuine tints/shades of navy, green,
and blue while keeping `#002060` (navy, Aporte) and `#1F497D`+tint (medium blue, Distribución)
distinguishable — they are 20°+ apart in hue and far apart in lightness. If two legend colours tie
within tolerance, do not guess: emit `ambiguous_fill_classification` and require classification.

**PROPOSED — provenance.** Every ingested event stores: source sheet, source cell reference, raw
fill as stored (`rgb` or `theme`+`tint`), resolved sRGB hex, normalised event type, classification
method (`legend_exact` / `legend_family` / `administrator`), source amount, source date (from the
timeline header), currency, and the upload revision. The original fill representation is preserved
verbatim so a future re-classification can be re-derived.

---

## 4. Errors and unavailable values — VERIFIED

### 4.1 The Bloomberg cascade

The `Alternatives` sheet contains **31 error cells**:

| Cells | Formula | Error |
|---|---|---|
| `E123`, `F123`, `G123` | `_xll.BDP(E122,"LAST PRICE")` for `EUR Curncy`, `CLF Curncy`, `CLP Curncy` | `#NAME?` |
| `H127`–`H142`, `H144`, `H151`–`H154` | `+D{r}+(E{r}*$E$123)+(F{r}*$F$123/$G$123)+(G{r}/$G$…)` | `#NAME?` |
| `D168`, `F168`, `D172`, `F172`, `D169`, `D173` | `+SUM(...)`, `+D/3`, `+'[1]Portfolio Líquido'!…` | `#REF!` |
| `D170`, `D174` | `+H135`, `+H134` | `#NAME?` |

> **The entire per-sociedad "Total USD" roll-up (column `H`, rows 127–154) is unavailable**, because
> it converts EUR/UF/CLP to USD using FX rates fetched by the Bloomberg add-in.

This is the same root cause as the RESUMEN `TOTAL` failure (doc 02 § 6.3) and confirms it is
systemic, not incidental.

**PROPOSED:** the multi-currency roll-up block (rows ~122–154) and the `#REF!` block (rows ~168–174)
are **technical/derived areas, not ingested**. Their errors are therefore **warnings, not blocks**.
Required alternatives cells are the master-data columns `B`–`L` for each investment×sociedad row.

**PROPOSED — `TIR Calculada` (`L`).** Ingest the **cached value**. Do **not** re-run Excel's `IRR`
server-side in R13: Excel's IRR is an iterative solver with its own convergence behaviour and a
`0.1` default guess, and reproducing it to the digit is a solved-but-fiddly problem that adds risk
for no user benefit. Present `TIR Calculada` as source-provided and label it as such. If the cached
value is missing or errored, show `—`. (Re-deriving IRR from the ingested event timeline is a
legitimate *future* enhancement once the timeline is trusted; it is out of scope for R13.)

### 4.2 No cross-currency totals

Because the workbook's own USD conversion is `#NAME?`, **NMI has no source-provided USD total for
alternatives**. NMI must not invent one by applying its own FX rates and presenting the result as if
it came from the source. Alternatives are presented **grouped by currency**, with per-currency
subtotals. A USD-equivalent view is a **future, explicitly-labelled derived feature** requiring an
approved FX source (see `09-open-decisions.md` § D5).

---

## 5. Parser-safety requirement — carried from the audit

`.xlsx` is a ZIP of XML, and R13's parser must read `xl/styles.xml` to resolve fills. The
`cellXfs` block uses a mix of self-closing `<xf …/>` and child-bearing `<xf …>…</xf>` elements.

> **A combined `(?:\/>|>[\s\S]*?<\/xf>)` alternation silently swallows runs of self-closing
> elements.** Measured on this workbook: 630 real `<xf>` entries parsed as **211**. Cell style
> indices then exceed the array bounds and every fill lookup returns `null` — the colour census came
> back completely empty with no error raised.

**PROPOSED:** match **opening tags only** (`/<xf\b([^>]*?)\/?>/g`) and assert that the parsed count
equals the `count` attribute on `<cellXfs>`. Add a unit test with a fixture containing both element
forms. This is a fail-*silent* defect — the most dangerous kind for a colour-semantic parser — so it
warrants an explicit regression test.

---

## 6. Anchor detection — PROPOSED

1. **Header row** — the row whose column `B` matches `/nombre de la inversi[oó]n/i`; its columns are
   resolved by header text, not by letter.
2. **Timeline start** — the first column right of `TIR Calculada` whose header-row cell is a
   date-formatted number; timeline end = the last such column.
3. **Legend** — cells above the header row carrying the labels `Aporte`, `Dividendo`,
   `Distribución` (accent- and case-insensitive); their fills define the palette. Missing → block.
4. **Category rows** — a row with a value in `B`, nothing in `C`, and a `/inversiones en (.+)/i`
   declaration in `D`.
5. **Investment rows** — a row with a value in `B`, nothing in `C`, and no currency declaration.
6. **Holding rows** — a row with a value in `C` (sociedad) and at least one value in `D`–`L`.
7. **Technical zone** — everything at or below the first row whose `E`/`F`/`G` carry
   `/Curncy$/` tickers (row 122 in the sample). Not ingested.

Blocking: `alternatives_header_not_found`, `alternatives_legend_missing`,
`alternatives_timeline_not_found`, `alternatives_currency_unresolved`,
`alternatives_orphan_holding_row` (a holding with no category above it).

---

## 7. Acceptance criteria

- [x] All 12 master-data columns identified from their own header row
- [x] Multi-currency category grouping discovered; `(category, currency)` established as the key
- [x] Derived columns `F`, `J`, `L` and their formulas documented; `K` confirmed externally reported
- [x] Timeline verified as 94 strictly-monthly columns, `2018-10-31` → `2026-07-31`
- [x] Legend located at `DC1:DC3` and all three colours resolved, including the theme-index mapping
- [x] `DC` legend/timeline collision identified
- [x] Colour census completed; sign convention verified per event type
- [x] 73 uncoloured value cells found; deterministic classification + warning contract defined
- [x] Tint/shade family-matching rule specified with an ambiguity escape hatch
- [x] All 31 error cells enumerated and attributed; required vs technical cells separated
- [x] Cross-currency total confirmed unavailable and prohibited from fabrication
- [x] Style-parser fail-silent defect documented with a required regression test
