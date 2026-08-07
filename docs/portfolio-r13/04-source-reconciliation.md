# R13.0 · Document 04 — Source Reconciliation

**Phase:** R13.0 — documentation only.
**Method:** the sample workbook was read read-only with a temporary, dependency-free XML reader
(scratchpad, since deleted). Every figure below was recomputed from the workbook's own cached cell
values and compared against the workbook's own stated results. Nothing was estimated.

**Privacy:** only the minimum representative values needed to prove each contract clause appear
here. Verification is expressed as **identities and residuals** wherever a residual alone is
sufficient proof. All figures are USD (`valores en dólares`, cell `B5`).

**Reference column map** (RESUMEN, header row 5): `BV` = `2026-01-02` (Beginning of Year) ·
`CX` = `2026-07-17` · `CY` = `2026-07-24` · `CZ` = `2026-07-31` · `DB` = `Diferencia` ·
`DE` = live (`2026-08-06`).

---

## 1. Column identification — VERIFIED

| Contract element | Column | Header cell | Evidence |
|---|---|---|---|
| Beginning of year | `BV` | `BV5 = 2026-01-02` | earliest 2026 column; **absent from row 1** |
| 17 July 2026 | `CX` | `CX5 = 2026-07-17` | ascending weekly series |
| 24 July 2026 | `CY` | `CY5 = 2026-07-24` | ascending weekly series |
| 31 July 2026 | `CZ` | `CZ5 = 2026-07-31` | last closed week |
| Existing difference | `DB` | `DB5 = "Diferencia"` | formula, § 2 |
| Live / current week | `DE` | `DE4 = "Precios en vivo"`, `DE1 = =+TODAY()` → `2026-08-06` | § 6 |

Cross-confirmed against `one-pager-reference.pdf`, whose `Cierre Semanal` block is headed
`31-07-2026` and renders exactly four columns: **`Inicio de Año 02-01-2026`** (highlighted),
**`24-07-2026`**, **`31-07-2026`**, **`Diferencia`**.

---

## 2. The existing difference is `31-07 − 24-07` — VERIFIED

**Formula evidence.** Read directly from the sheet:

```
DB7  = CZ7-CY7      DB23 = CZ23-CY23    DB25 = CZ25-CY25    DB27 = CZ27-CY27
DB54 = CZ54-CY54    DB78 = CZ78-CY78    DB79 = CZ79-CY79    DB81 = CZ81-CY81
DB83 = CZ83-CY83    DB85 = CZ85-CY85    DB87 = CZ87-CY87
```

**Numeric evidence.** `DB{r}` recomputed as `CZ{r} − CY{r}`:

| Row | Label | Residual `DB − (CZ − CY)` | Result |
|---|---|---|---|
| 7 | Caja y Equivalentes | 0.000000 | **MATCH** |
| 23 | SUBTOTAL PORTFOLIO LÍQUIDO | 0.000000 | **MATCH** |
| 79 | PORTFOLIO LÍQUIDO + ALTERNATIVOS | 0.000000 | **MATCH** |
| 83 | SUBTOTAL | 0.000000 | **MATCH** |
| 85 | ACCIONES CHILENAS (USD) | 0.000000 | **MATCH** |
| 87 | TOTAL | 0.000000 | **MATCH** |

Confirmed against the PDF, which renders `TOTAL` as
`129.391.454 | 143.444.474 | 143.677.987 | Diferencia 233.513` —
and `143.677.987 − 143.444.474 = 233.513`.

> **Conclusion (contract clause 2).** The workbook's `Diferencia` column is the *previous* week's
> difference: **31-07-2026 minus 24-07-2026**.

---

## 3. The new publication difference is `06-08 − 31-07` — VERIFIED COMPUTABLE (with one exception)

For an 06-08-2026 publication the difference must be `DE − CZ`, derived by NMI, never imported
from `DB`.

| Row | Label | `DE − CZ` | Status |
|---|---|---|---|
| 7 | Caja y Equivalentes | +100,231.98 | computable |
| 23 | SUBTOTAL PORTFOLIO LÍQUIDO | +459,361.34 | computable |
| 25 | Inmobiliario | +8,781.77 | computable |
| 54 | Venture Capital / Private Equity | 0.00 | computable |
| 78 | SUBTOTAL ALTERNATIVOS | +8,781.77 | computable |
| 79 | PORTFOLIO LÍQUIDO + ALTERNATIVOS | +468,143.10 | computable |
| 81 | INRETAIL PERU CORP | −720,000.00 | computable |
| 83 | SUBTOTAL | −251,856.90 | computable |
| **85** | **ACCIONES CHILENAS (USD)** | — | **`DE85 = #NAME?`** |
| **87** | **TOTAL** | — | **`DE87 = #NAME?`** |

> **Conclusion (contract clause 3).** The new difference is arithmetically well-defined and
> reproducible from the upload contract for every row **except** the Chilean-equity line and the
> grand `TOTAL`, which are in error in the live column of this sample (§ 5).

---

## 4. Recalculated representative rows

### 4.1 Hierarchy identities — VERIFIED at both `CZ` (closed) and `DE` (live)

Each parent recomputed from its children; residual shown.

| Identity | Residual @ `CZ` | Residual @ `DE` |
|---|---|---|
| **Sub-asset → asset class**: `Caja y Equivalentes = Caja USD + MMarket USD` | 0.000000 **MATCH** | 0.000000 **MATCH** |
| `Renta Fija = EMD + High Yield + Investment Grade + Preferred` | 0.000000 **MATCH** | 0.000000 **MATCH** |
| `Renta Variable = Global + Desarrollado + Emergente + Notas Estructuradas` | 0.000000 **MATCH** | 0.000000 **MATCH** |
| `Opciones = Call + Put` | 0.000000 **MATCH** | 0.000000 **MATCH** |
| **Asset class → subtotal**: `SUBTOTAL LÍQUIDO = Caja + RF + RV + Opciones` | 0.000000 **MATCH** | 0.000000 **MATCH** |
| **Leaf → asset class**: `Inmobiliario = SUM(rows 27:53)` | 0.000000 **MATCH** | — |
| **Leaf → asset class**: `Venture Capital / PE = SUM(rows 56:77)` | 0.000000 **MATCH** | — |
| `SUBTOTAL ALTERNATIVOS = Inmobiliario + VC/PE` | 0.000000 **MATCH** | 0.000000 **MATCH** |
| `LÍQUIDO + ALTERNATIVOS = SUBTOTAL ALT + SUBTOTAL LÍQ` | 0.000000 **MATCH** | 0.000000 **MATCH** |
| `SUBTOTAL = INRETAIL + (LÍQ + ALT)` | 0.000000 **MATCH** | 0.000000 **MATCH** |
| `TOTAL = SUBTOTAL + ACCIONES CHILENAS` | 0.000000 **MATCH** | **ERROR — `DE85`/`DE87` are `#NAME?`** |

Coverage of the brief's required row types: **leaf asset** (rows 27–53 individually, summing to
`Inmobiliario`), **sub-asset class** (`Investment Grade`, `Caja USD`, `MMarket USD`, …),
**asset class** (`Caja y Equivalentes`, `Renta Fija`, `Renta Variable`, `Inmobiliario`),
**sociedad subtotal** (§ 4.3), **personal-portfolio total** (§ 4.3), **Main total** (row 87 above),
**weekly performance** (§ 4.2).

### 4.2 Performance semantics — VERIFIED across all five blocks

Hypotheses were tested against the workbook's own hardcoded results. All five performance blocks
agree **exactly**:

| Quantity | Verified definition |
|---|---|
| **Utilidad de la semana** | `value(thisWeek) − value(previousWeek) − flow(thisWeek)` |
| **Retorno de la semana** | `Utilidad de la semana ÷ value(previousWeek)` — denominator **not** flow-adjusted |
| **Utilidad del Año** | `Σ` of the weekly `Utilidad` since BoY ( ≡ `value − value(BoY) − Σ flows` ) |
| **Retorno del Año** | **chain-linked**: `Π(1 + weekly return) − 1` over the 30 weeks `BW…CZ` |

Evidence, `CZ` (2026-07-31):

| Block | Utilidad semana | Return semana | Utilidad año | Retorno año (chain-linked) |
|---|---|---|---|---|
| Main **ex** Chilean equities (row 83) | MATCH (flow = 0) | MATCH | MATCH | **MATCH** |
| Main **con** Chilean equities (row 87) | **MATCH only after subtracting the flow** — raw ΔValue is off by exactly the flow | MATCH | MATCH | **MATCH** |
| Jaime (row 150) | **MATCH only after subtracting the flow** (flow = 1,655,600) | MATCH | MATCH | **MATCH** |
| Andrés (row 207) | MATCH (flow = 0) | MATCH | MATCH | **MATCH** |
| Pablo (row 266) | MATCH (flow = 0) | MATCH | MATCH | **MATCH** |

Two findings deserve emphasis:

**(a) Profit is flow-adjusted.** For Main-with-Chilean-equities at `CZ`:
`ΔValue = 233,513.34`, `flow = 64,563.95`, and the source's `Utilidad de la semana = 168,949.39`.
`233,513.34 − 64,563.95 = 168,949.39` — exact. The naive ΔValue reading is wrong by the full flow.

**(b) Annual return is a true time-weighted return, not a simple ratio.**
`Utilidad del Año ÷ value(BoY)` **fails** for Main-with-Chilean-equities (`0.124266` vs the stated
`0.125376`) and for Jaime. Compounding the 30 weekly returns reproduces the stated figure exactly for
**all five blocks**:

| Block | Source `Retorno del Año` | Chain-linked `Π(1+rₜ)−1` | Residual |
|---|---|---|---|
| Main ex-CL | `0.14260354` | `0.14260354` | < 1e-9 |
| Main con-CL | `0.12537566` | `0.12537566` | < 1e-9 |
| Jaime | `0.03412558` | `0.03412558` | < 1e-9 |
| Andrés | `0.11855668` | `0.11855668` | < 1e-9 |
| Pablo | `0.14073308` | `0.14073308` | < 1e-9 |

> **This is a genuine flow-adjusted, chain-linked time-weighted return at the portfolio-total
> level.** It is materially better than a value-change ratio, and it is the reason
> `07-attribution-and-product-contract.md` can defend Level 3 *for totals* while restricting leaf
> rows to Level 1.

**PROPOSED:** NMI reproduces these four definitions exactly and cross-checks each against the
source's own stated value at ingestion. A residual beyond tolerance raises
`performance_definition_mismatch` (warning) — protection against a future change in the source's
methodology going unnoticed.

### 4.3 Personal portfolio, worked end to end — VERIFIED

Jaime, `31-07-2026`, cross-checked against `jaime-portfolio-reference.pdf`:

| Level | Row | BoY (`BV`) | 24-07 (`CY`) | 31-07 (`CZ`) | Diferencia (`DB`) |
|---|---|---|---|---|---|
| **Sociedad subtotal** | 124 `SUBTOTAL LA ESPERANZA` | 6,350,284 | 5,963,885 | 5,966,942 | 3,058 |
| **Sociedad total** | 126 `TOTAL LA ESPERANZA` | 7,396,908 | 7,551,937 | 7,554,995 | 3,058 |
| **Sociedad total** | 148 `TOTAL NAIDELT` | 9,618,278 | 10,012,718 | 11,691,964 | 1,679,246 |
| **Personal total** | 150 `TOTAL JAIME` | 17,015,185 | 17,564,655 | 19,246,959 | **1,682,303** |

Checks:
- `TOTAL JAIME = TOTAL LA ESPERANZA + TOTAL NAIDELT`: `7,554,995 + 11,691,964 = 19,246,959` ✔
- `Diferencia = CZ − CY`: `19,246,959 − 17,564,655 = 1,682,303` ✔ (matches the PDF exactly)
- Flow (`row 152`) `= 1,655,600`; `Utilidad de la semana = 1,682,303 − 1,655,600 = 26,703` ✔
  matches the source's stated `26,703.39` and the PDF's `26.703`
- `Retorno de la semana = 26,703.39 ÷ 17,564,655 = 0.00152029` ✔ matches the PDF's `0,15%`

Every figure in the PDF is reproducible from the upload contract.

---

## 5. Invalid / unavailable required live cells — VERIFIED

`RESUMEN` carries **10 error cells, all in the live column `DE`**:

| Cell | Row | Formula | Error | Required? |
|---|---|---|---|---|
| `DE292`–`DE296` | Chilean bank equity last prices | `_xll.BDP($B{r},$B$290)` | `#NAME?` | technical |
| `DE287` | `CLP Curncy` | `_xll.BDP(...)` | `#NAME?` | technical |
| `DE286` | `STOCK ACCIONES CHILENAS CLP` | `=DE292*DE299+…` | `#NAME?` | technical |
| `DE288` | `STOCK ACCIONES CHILENAS USD` | `=DE286/DE287` | `#NAME?` | technical |
| **`DE85`** | **`ACCIONES CHILENAS (USD)`** | `=+DE288` | **`#NAME?`** | **REQUIRED** |
| **`DE87`** | **`TOTAL`** | `=+DE83+DE85` | **`#NAME?`** | **REQUIRED** |

Root cause: `_xll.BDP` is a Bloomberg add-in function. Without the add-in loaded, Excel cannot
resolve the name, yielding `#NAME?`, which propagates to the Chilean-equity line and the grand total.

**Additionally**, every non-error live leaf value is a formula into the external SharePoint workbook
`NUEVA BASE - Portafolios Internacionales V34 (agosto 2026).xlsx` (e.g.
`+'[1]Portfolio Líquido'!$AL205`, `+[1]Alternatives!$J$78`). Their **cached** results are present and
usable; the link itself must never be followed.

`1 Pager` carries 3 error cells (`Q45`, `Q79`, `R79` = `#VALUE!`), caused by a missing
`INRETC1` price in one week (`Q75 = #N/A N/A`) propagating into the price-variation row.
`Alternatives` carries 31 (doc 03 § 4.1).

> **Conclusion (contract clause 6).** Publishing 06-08-2026 from this exact file **must be blocked**
> for the Main portfolio: two required cells are in error. The three personal portfolios are
> unaffected — their live values resolve — but under the atomic-publication rule (doc 05 § 6) the
> Upload A publication as a whole is refused until the workbook is recalculated with Bloomberg
> available.

---

## 6. `TODAY()` — the live date is not a stored date — VERIFIED

```
DE1 = =+TODAY()     cached 2026-08-06
DE5 = =+DE$1        cached 2026-08-06
```

The live date is whatever day the workbook was last recalculated. `2026-08-06` is a cached artefact,
not an asserted publication date. This is the single strongest argument for
**detect → propose → administrator confirms** rather than automatic publication (doc 02 § 3.2).

---

## 7. Value-class taxonomy — required by the brief

Every field NMI surfaces must be classifiable as exactly one of:

| Class | Definition | Examples |
|---|---|---|
| **`source_value`** | Read verbatim from a cached cell | every weekly asset/sub-asset/subtotal/total; `Aportes / Retiros`; alternatives `D`–`L` |
| **`source_provided_return`** | A return/profit the source computed and stored | `Retorno de la semana`, `Utilidad de la semana`, `Retorno del Año`, `Utilidad del Año`; `TIR Informada`, `TIR Calculada` |
| **`source_provided_flow`** | A contribution/withdrawal stated by the source | `Aportes / Retiros de la Semana`, `Retiros / Aportes` |
| **`nmi_calculated`** | Derived by NMI from two stored snapshots | **the published `Difference`** (`thisWeek − previousWeek`); per-row weekly value change; allocation percentages |
| **`unavailable`** | Required but absent or errored | `ACCIONES CHILENAS (USD)` and `TOTAL` in the live column; alternatives `Total USD`; a leaf with no BoY baseline |
| **`not_reproducible`** | Cannot be derived from the upload contract | per-asset flows; per-asset returns; any true attribution below the portfolio total (doc 07) |

**PROPOSED:** this class is stored per field and drives the UI's source badge. A
`nmi_calculated` figure is never presented as if it came from the source, and a `source_provided_return`
is never silently recomputed and shown as if NMI derived it.

---

## 8. Acceptance criteria

- [x] Source columns identified for BoY, 17-07, 24-07, 31-07, existing difference, and live
- [x] Existing difference proven `31-07 − 24-07` by formula **and** by numeric residual on 6 rows
- [x] New publication difference established as `06-08 − 31-07`, with the two blocked rows named
- [x] Representative rows recalculated across all four portfolios
- [x] Coverage: leaf asset, sub-asset class, asset class, sociedad subtotal, personal total, Main total, weekly performance
- [x] Invalid/unavailable required live cells identified with root cause
- [x] External-formula dependence identified for every live leaf value
- [x] Source value / NMI-calculated / source return / source flow / not-reproducible distinguished
- [x] Minimum representative values used; verification expressed as residuals wherever sufficient
