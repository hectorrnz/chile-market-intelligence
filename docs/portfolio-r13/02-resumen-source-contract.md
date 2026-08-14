# R13.0 · Document 02 — RESUMEN Source Contract (Upload A)

**Phase:** R13.0 — documentation only.
**Source inspected:** `portfolio-source-reference.xlsx`, worksheet `RESUMEN` (read-only, temporary,
outside the repository). No financial values beyond the minimum needed to prove the contract appear
in this document.

Statements marked **VERIFIED** were read directly from the sample workbook's XML. Statements marked
**PROPOSED** define required future parser behaviour.

---

## 1. Workbook shape — VERIFIED

`portfolio-source-reference.xlsx` contains exactly three worksheets, all visible:

| # | Sheet | Dimensions | Role in R13 |
|---|---|---|---|
| 1 | `RESUMEN` | 328 rows × 119 cols, 30,081 cells | **Upload A** — portfolio data |
| 2 | `1 Pager` | 127 rows × 98 cols, 7,025 cells | **Not an upload source.** Definitions + benchmarks only (doc 06) |
| 3 | `Alternatives` | 182 rows × 117 cols, 12,491 cells | **Upload B** — alternatives (doc 03) |

The sample is a single workbook containing all three. The product contract splits them into two
independent uploads. **PROPOSED:** the RESUMEN parser must accept a workbook containing a `RESUMEN`
sheet and must **ignore** any `Alternatives` or `1 Pager` sheet that happens to be present — an
Upload A that also contains Alternatives must never write alternatives data.

---

## 2. Portfolio scopes — VERIFIED

Row anchors in the sample. **These are sample positions, not a contract** — see § 3 for detection.

| Scope | Anchor label (col B) | Rows | Identity |
|---|---|---|---|
| Main | `Resumen Portfolio` / `Watermill + Dubai + 3 Uruguayas` | 3–101 | B4 states the Main definition literally |
| Jaime | `Jaime` | 104–157 | `LA ESPERANZA` 106–126, `NAIDELT` 128–148 |
| Andrés | `Andrés` | 159–214 | `LOS SAUZALES` 161–181, `RETBOY` 183–203 |
| Pablo | `Pablo` | 216–273 | `LOS LAURELES` 218–238, `VANGLOR` 240–260 |
| *(technical)* | `CÁLCULO DE STOCKS` | 277–328 | **Excluded from ingestion** — see § 7 |

**Main-portfolio isolation — VERIFIED.** Cell **B4 = `Watermill + Dubai + 3 Uruguayas`**. The Main
scope's own totals (rows 79–101) are computed from rows 6–78 only. Jaime's, Andrés's, and Pablo's
sections live in disjoint row ranges below and never feed the Main totals.

**PROPOSED (hard requirement):** the Main portfolio must be ingested strictly from the Main row
range. Personal sociedades, personal totals, and the `Proporcional Otras Sociedades` rows must never
be added into Main.

### 2.1 Per-scope terminal structures — VERIFIED

The three personal portfolios are **deliberately not identical**. Reproduce each as it is.

**Jaime** — `TOTAL LA ESPERANZA` (126), `TOTAL NAIDELT` (148), **`TOTAL JAIME` (150)**,
`Retiros / Aportes` (152), performance (154–157).

**Andrés** — `TOTAL LOS SAUZALES` (181), `TOTAL RETBOY` (203), `TOTAL ANDRÉS (DIRECTO)` (205),
`Proporcional Otras Sociedades` (206), **`TOTAL Soc Personales + Proporcional` (207)**,
`Retiros / Aportes` (209), performance (211–214).

**Pablo** — `TOTAL LOS LAURELES` (238), `TOTAL VANGLOR` (260), `TOTAL PABLO (DIRECTO)` (262),
`Proporcional Otras Sociedades` (263), `TOTAL Soc Personales + Proporcional` (264),
`Staten Capital (1/3)` (265), **`TOTAL más Staten Capital Ltd` (266)**, `Retiros / Aportes` (268),
performance (270–273).

**VERIFIED — which row each performance block measures.** Established numerically (doc 04 § 4), not
assumed:

| Scope | Performance measures | Confirmation |
|---|---|---|
| Main, ex-Chilean equities | row **83** (`SUBTOTAL`) | exact |
| Main, with Chilean equities | row **87** (`TOTAL`) | exact |
| Jaime | row **150** (`TOTAL JAIME`) | exact |
| Andrés | row **207** (`TOTAL Soc Personales + Proporcional`) | exact; **not** 205 |
| Pablo | row **266** (`TOTAL más Staten Capital Ltd`) | exact; **not** 264 |

Binding a personal performance block to the wrong total is a silent, plausible-looking error. Andrés
row 205 mismatches by ~1.58 M on the weekly figure alone.

---

## 3. Date detection contract

### 3.1 What the sample contains — VERIFIED

| Element | Location | Value |
|---|---|---|
| Weekly history headers | **row 5**, cols `C`…`CZ` | `2024-08-23` … `2026-07-31`, weekly |
| Duplicate header row | **row 1**, cols `C`…`CZ` | same series — **but incomplete, see § 3.3** |
| Beginning of Year | **`BV5` = `2026-01-02`** | first column of the current year |
| Prior weeks | `CX5`=`2026-07-17`, `CY5`=`2026-07-24`, `CZ5`=`2026-07-31` | last three closed weeks |
| Existing difference | **column `DB`**, header `DB5 = "Diferencia"` | formula `CZ{r}-CY{r}` (§ 4) |
| Live / current week | **column `DE`**, label `DE4 = "Precios en vivo"` | `DE1` = `=+TODAY()`, `DE5` = `=+DE$1` |
| Workflow markers | `DA2 = "insertar columna"`, `DB1/DB2 = "reemplazar"` | the manual weekly ritual |
| Allocation block | `DG5 = "Allocation Portfolio"`, `DG6`/`DH6`/`DI6` | `líquido ex INRETC1` / `total con INRETC1` / `líquido con INRETC1` |

Between the last closed week (`CZ`) and the live column (`DE`) sit `DA` (insert marker), `DB`
(difference), `DC`, `DD` (empty). **The live column is not adjacent to the last history column.**

### 3.2 `TODAY()` — the single most important date finding — VERIFIED

```
DE1 :  =+TODAY()      cached value 2026-08-06
DE5 :  =+DE$1         cached value 2026-08-06
```

The live-week date is **`TODAY()`**, a volatile function. Its `2026-08-06` value is the *cached
result of the last recalculation performed on the administrator's machine*, not a stored date.

**PROPOSED — binding rules:**
1. The parser reads the **cached `<v>` value** of the live-date cell. It must **never** evaluate
   `TODAY()`, and must never substitute the server's current date. Doing so would silently re-stamp
   an old workbook with today's date.
2. Because the date is `TODAY()`, it reflects *when the file was last calculated*, which may differ
   from the intended publication week. The detected date is therefore always **a proposal requiring
   administrator confirmation**, never an automatic publication date.
3. If the cached value is missing (a workbook saved without cached formula results), the live date is
   **undetectable** → block with `live_date_unavailable` and require an explicit administrator date.

### 3.3 Structural fragility already present — VERIFIED

**Row 1 is missing `BV`.** Row 1 runs `…BU1=2025-12-26`, then **`BW1=2026-01-09`** — the
`2026-01-02` column is absent. Row 5 has `BV5 = 2026-01-02`.

The two "identical" header rows already disagree, and the missing entry is exactly the
**Beginning-of-Year** column. A parser keyed to row 1 would silently lose the YTD baseline for every
row in the workbook.

**PROPOSED:** **row 5 is the authoritative header row** (it is the one visually adjacent to the data
and the one the `1 Pager` sheet references — `1 Pager` `D5 = +[1]RESUMEN!X5`). Row 1 is a technical
duplicate and must be ignored. If row 5 is absent, fail closed; do not fall back to row 1.

### 3.4 Detection algorithm — PROPOSED

Never use fixed row/column indices. Resolve by structure and semantics:

**A. Locate the header row.** Scan rows 1–20 for the row with the greatest count of date-formatted
numeric cells forming a strictly ascending weekly series (≥ 20 members). Ties → the **lowest-numbered
row that also carries a label in column B** (row 5 carries `valores en dólares`).

**B. Classify each header cell.**
- *Historical weekly column* — date-formatted, numeric, **no formula**, part of the ascending series.
- *Live column* — carries a formula (`TODAY()` or a reference to one), **and/or** sits under a label
  matching `/precios en vivo/i` within 2 rows above. Both signals present in the sample; either alone
  is sufficient, both required to agree if both present.
- *Difference column* — header text matching `/^diferencia$/i`. **Never** ingested as a value column
  (§ 4).
- *Marker columns* — `insertar columna`, `reemplazar` → ignored.
- *Allocation block* — anything at or right of a header matching `/allocation/i` → out of scope for
  the value grid.

**C. Derive the anchors.**
- `thisWeek` = the confirmed publication column (live for a normal run; a selected historical column
  for a back-publication).
- `previousWeek` = the immediately preceding **historical** column by date order.
- `beginningOfYear` = the **earliest** historical column whose date falls in the same calendar year
  as `thisWeek`. In the sample, `thisWeek = 2026-08-06` → `beginningOfYear = BV (2026-01-02)`. **Not**
  a hardcoded "first week of January".

**D. Blocking anomalies** (publication refused):

| Condition | Code |
|---|---|
| No header row identifiable | `header_row_not_found` |
| Duplicate dates in the series | `duplicate_week_date` |
| Series not strictly ascending | `out_of_order_week_date` |
| More than one live-column candidate | `ambiguous_live_column` |
| Live column found but cached date missing | `live_date_unavailable` |
| No column in `thisWeek`'s calendar year | `beginning_of_year_not_found` |
| `previousWeek` resolves to `thisWeek` | `previous_week_not_found` |
| Confirmed date ≤ the latest already-published date | `date_not_advancing` (override → revision, § 8) |

**E. Non-blocking warnings:** a gap > 10 days between consecutive weeks; a shifted section anchor;
an unrecognised row label inside a known section; a leaf row present this week but absent from the
prior published snapshot.

---

## 4. The difference column — VERIFIED, and why it must not be imported

Read directly from the sample:

```
DB5 : "Diferencia"
DB7  = CZ7-CY7      DB25 = CZ25-CY25    DB27 = CZ27-CY27
DB54 = CZ54-CY54    DB78 = CZ78-CY78    DB79 = CZ79-CY79
DB81 = CZ81-CY81    DB83 = CZ83-CY83    DB85 = CZ85-CY85    DB87 = CZ87-CY87
```

`CZ = 2026-07-31`, `CY = 2026-07-24`.

> **The existing `Diferencia` column is `31-07-2026 − 24-07-2026`.**
> Numerically re-verified on 6 rows in doc 04 § 2 — all exact.

For an **06-08-2026** publication the correct difference is
**`06-08-2026 − 31-07-2026`** = `DE − CZ`.

**PROPOSED (hard requirement):** column `DB` is **never** ingested as the published difference. It is
the *previous* week's difference and importing it would understate/overstate every delta by one week.
The published difference is always derived by NMI as
`value(thisWeek) − value(previousWeek)`, computed from the two stored snapshots. When a historical
week is selected, the same derivation runs against that week and its own predecessor.

**PROPOSED:** the parser may read `DB` **only** as a cross-check — if `DB ≠ value(CZ) − value(CY)`
for the last closed pair, raise warning `difference_column_inconsistent`. It is never a data source.

---

## 5. Row hierarchy — VERIFIED

### 5.1 Liquid portfolio (asset class → sub-asset class)

```
PORTAFOLIO LÍQUIDO                       (group header, no values)
  Caja y Equivalentes                    = Caja USD + MMarket USD
  Renta Fija                             = EMD USD + High Yield + Investment Grade + Preferred
  Renta Variable                         = Global + Desarrollado + Emergente + Notas Estructuradas
  Opciones                               = Call + Put
SUBTOTAL PORTFOLIO LÍQUIDO               = Caja + Renta Fija + Renta Variable + Opciones
```

### 5.2 Alternatives (asset class → sociedad → individual asset)

```
ALTERNATIVOS                             (group header, no values)
  Inmobiliario                           = SUM(rows 27:53)
    Watermill / Coval Inmobiliaria / Gardens 5901 / Naidelt SA / Retboy SA / Vanglor SA
                                         (sociedad sub-headers — labels only, NO values)
      <individual funds>
  Venture Capital / Private Equity       = SUM(rows 56:77)
    Watermill / Dubai / Naidelt SA / Retboy SA / Vanglor SA / Nevada
      <individual funds>
SUBTOTAL ALTERNATIVOS                    = Inmobiliario + Venture Capital / Private Equity
```

**VERIFIED:** the sociedad header rows carry **no values** and sit *inside* the summed range. A
parser must treat them as grouping labels, not as leaves, or every alternatives total double-counts
by zero (harmless) while the hierarchy is misattributed (not harmless).

### 5.3 Main portfolio spine

```
PORTFOLIO LÍQUIDO + ALTERNATIVOS  = SUBTOTAL ALTERNATIVOS + SUBTOTAL PORTFOLIO LÍQUIDO
INRETAIL PERU CORP                (single named holding, own line)
SUBTOTAL                          = INRETAIL PERU CORP + (LÍQUIDO + ALTERNATIVOS)
ACCIONES CHILENAS (USD)           (derived from the technical block, § 7)
TOTAL                             = SUBTOTAL + ACCIONES CHILENAS (USD)
```

All identities re-computed and confirmed exact in both the last closed week and the live column
(doc 04 § 3).

### 5.4 Personal portfolios

Each sociedad repeats the full liquid hierarchy (`Caja y Equivalentes` … `Opciones`), then
`SUBTOTAL <SOCIEDAD>`, then a single **`Alternativos`** line, then `TOTAL <SOCIEDAD>`. Confirmed
against `jaime-portfolio-reference.pdf`, which renders exactly this structure with the
`Inicio de Año / 24-07-2026 / 31-07-2026 / Diferencia` column set.

---

## 6. Source-value policy

### 6.1 What the cells actually are — VERIFIED

| Region | Formula status |
|---|---|
| Historical weekly columns (`C`…`CZ`), all value rows | **Hardcoded values, no formulas** — pasted each week |
| Performance rows (90–94, 97–101, 152–157, 209–214, 268–273), all history | **Hardcoded values, no formulas** |
| Difference column `DB` | Formula `CZ{r}-CY{r}` |
| Live column `DE`, leaf rows | Formula referencing an **external workbook** |
| Live column `DE`, aggregate rows | Formula summing other `DE` cells |
| Live column `DE`, Chilean-equity block | Formula calling **Bloomberg** `_xll.BDP(...)` |

The weekly ritual (`insertar columna` → `reemplazar`) pastes the live column's values into a new
history column. **Historical data is therefore inert and safe; only the live column is live.**

### 6.2 External dependencies the server must never resolve — VERIFIED

**External workbook link** (`xl/externalLinks/_rels/externalLink1.xml.rels`):

```
https://inevada.sharepoint.com/sites/Inversiones/Documentos compartidos/
  InversionesHolding/IH - Portfolio/
  NUEVA BASE - Portafolios Internacionales V34 (agosto 2026).xlsx
```

Live-column formulas reference it as `[1]`, e.g.
`+'[1]Portfolio Líquido'!$AL205+…`, `+[1]Alternatives!$J$78`.

**Bloomberg add-in and RTD** — `xl/volatileDependencies.xml` declares
`<volType type="realTimeData"><main first="bofaddin.rtdserver">` with five `BDH|…` topics bound to
cells `DI292`–`DI296`. Live Chilean-equity prices use `_xll.BDP($B292,$B$290)`.

**PROPOSED (hard requirements):**
- Never open, fetch, resolve, or follow `externalLink1.xml` or any `TargetMode="External"` target.
- Never evaluate any formula. Read cached `<v>` values only.
- Never execute macros. **Reject `.xlsm`/`.xltm` outright** (`macro_enabled_workbook`).
- Never attempt Bloomberg connectivity. NMI has no Bloomberg relationship — the standing
  Structured Notes rule ("No Bloomberg in the app") applies identically here.
- Ignore `xl/volatileDependencies.xml` entirely.

### 6.3 Error cells — VERIFIED PRESENT IN THE SAMPLE

The sample workbook's `RESUMEN` sheet contains **10 cells in error state (`t="e"`), all in the live
column `DE`**:

| Cell | Row meaning | Error | Cause |
|---|---|---|---|
| `DE292`–`DE296` | `BCI/BSAN/CHILE/ITAUCL/CONDES CC Equity` last price | `#NAME?` | `_xll.BDP(...)` — Bloomberg add-in not loaded |
| `DE287` | `CLP Curncy` | `#NAME?` | `_xll.BDP(...)` |
| `DE286` | `STOCK ACCIONES CHILENAS CLP` | `#NAME?` | depends on the above |
| `DE288` | `STOCK ACCIONES CHILENAS USD` | `#NAME?` | `=DE286/DE287` |
| **`DE85`** | **`ACCIONES CHILENAS (USD)`** | `#NAME?` | `=+DE288` |
| **`DE87`** | **`TOTAL`** | `#NAME?` | `=+DE83+DE85` |

> **In the sample, the Main portfolio's grand `TOTAL` is unavailable in the live column.**

This is not hypothetical: publishing 06-08-2026 from this exact file would require the Chilean-equity
line and the grand total, and both are `#NAME?`.

**PROPOSED — required-cell error policy (blocking):**

Any of `#NAME?`, `#REF!`, `#VALUE!`, `#DIV/0!`, `#N/A`, `#NULL!`, `#NUM!` in a **required** cell
blocks publication of the affected dataset with `source_cell_error`, reporting sheet, cell, row
label, and error text. The system must **never**:
- carry the previous week's value forward silently,
- substitute `0`,
- recalculate the model,
- omit the row and still publish a total that no longer reconciles.

**Required cells** = every asset-class, sub-asset-class, sociedad-subtotal, portfolio-subtotal and
portfolio-total row of every in-scope portfolio, for the publication column.
**Not required** = the technical block (§ 7), the allocation block, the difference column, marker
cells. An error in a non-required cell is a **warning**, not a block.

**PROPOSED — partial publication is not permitted.** Because Chilean equities feed the Main `TOTAL`,
a `#NAME?` there invalidates the Main scope as a whole. The administrator's remedy is to open the
workbook with Bloomberg available, recalculate, save, and re-upload — not to publish a partial book.
Publication is atomic per upload (doc 05 § 6).

---

## 7. Technical block — VERIFIED, and excluded

Rows **277–328** (`CÁLCULO DE STOCKS`) hold the Chilean-equity working: `Acciones Chilenas`,
`Stock One Pager USD/CLP`, `STOCK ACCIONES CHILENAS CLP/USD`, `CLP Curncy`, `LAST PRICE`,
`RESUMEN PRECIOS`, `RESUMEN CUSTODIA`, per-broker custody (`Custodia BCI / Credicorp / Santander
Corredores de Bolsa`), `Dividendos`.

**PROPOSED:** not ingested as client-facing portfolio data. It is inspected only to explain that
`ACCIONES CHILENAS (USD)` (row 85) derives from `STOCK ACCIONES CHILENAS USD` (row 288), and to
attribute the `#NAME?` cascade in § 6.3. Its Bloomberg tickers (`BCI CC Equity`, `BSAN CC Equity`,
`CHILE CC Equity`, `ITAUCL CC Equity`, `CONDES CC Equity`) are recorded as identifiers only.

---

## 8. Publication semantics — PROPOSED

**Normal run.** Upload → parse → detect live date → propose it → administrator confirms → publish an
immutable snapshot for that date. `previousWeek` = the immediately preceding published snapshot.

**Historical selection.** Selecting an earlier published week sets `thisWeek` to it, `previousWeek`
to its own predecessor, and recomputes the difference from those two snapshots. Every published week
is retained permanently; nothing is overwritten by a later publication.

**Same-date revision.** Re-publishing an already-published date creates a **new revision** of that
date, requires an audit note, and supersedes rather than deletes. The prior revision stays
addressable for rollback.

**Manual date override.** Permitted only when detection is ambiguous or the administrator asserts the
detected date is wrong. Requires an audit note recording the detected date, the chosen date, and the
justification. Never the default path.

**Contributions/withdrawals are sparse — VERIFIED.** `Retiros / Aportes` is a **sparse event row**: it
is populated in some weeks and empty in others (e.g. Main ex-Chile is empty at `CZ`; Jaime's is
`1.655.600`; Andrés's and Pablo's are empty). A **genuinely empty** flow cell means **zero flow**, not
missing data — confirmed because the source's own profit identity balances exactly when the blank is
treated as `0` (doc 04 § 4). A **malformed or errored** cell does **not** mean zero: only a genuine
blank receives zero semantics (see the fail-closed table below).

**The sparse-event rule, stated in full (R13.R2E.1 § 2, owner-authoritative).** Contributions and
withdrawals are unusual events, so the flow field's *normal* state is empty:

| Flow cell | Reading |
|---|---|
| genuinely blank (empty cell, or no cell at all) | **zero** — no contribution or withdrawal occurred |
| numeric | that flow actually occurred, at that value |
| error / malformed / ambiguous / explicitly unavailable | **unknown** — never zero |

**This holds independently of whether the neighbouring performance metrics were maintained.** An
unmaintained performance block (no Weekly Return, no Weekly P&L, no YTD figures) means nobody
computed that week's *return*. It says nothing about whether money moved, and must not be read as
"the flow is unknown". Doing so is what truncated Main's Including-Chilean-Equities flow-adjusted
history to its final 32 weeks in R13.R2E; the corrected reading restores all 102.

**Census — VERIFIED** against the reference workbook, all five flow rows × all 102 week columns
(`RESUMEN` r90 Main ex-Chile, r97 Main incl.-Chile, r152 / r209 / r268 personal):

| | cells |
|---|---|
| genuinely blank | **477** |
| numeric non-zero | **33** |
| literal `0` | **0** |
| error / text / boolean | **0** |

So the field contains *only* blanks and real events — there is no literal zero anywhere, and the
"unknown" row of the table above has **no instance in the current workbook**. It is implemented
regardless, so that the day one appears it cannot be silently read as "no money moved".

**Independently validated 394 times.** Every explicit zero now in the book originated as a blank
cell, and each one reconciles exactly against the source's *own* published weekly P&L via
`Δvalue = weekly_profit + flow` — 427 basis-weeks checked, 0 failures, worst relative deviation
`8.87e-13`.

**A flow on one basis is not a flow on another.** An `ex_chilean_equities` flow can be an internal
reallocation between sleeves, which is not an external portfolio flow at all (R13.R2E.1 § 7). The
source draws that line itself: in the one week where it states a flow on *both* Main bases at once,
`2026-01-02`, it states the ex-Chile flow as non-zero and the total-portfolio flow as exactly **zero**.
Never substitute one basis' flow for another's, and never infer a flow from a holdings change.

**The parser fails closed — R13.R2E.2.** `classifyFlowCell` (`resumen/hierarchy.ts`) is the single
place a flow cell is read, and every layer downstream consumes its decision rather than re-deriving
one:

| Cell state | Reading | `value_class` |
|---|---|---|
| no cell at all | **blank → 0** | `source_provided_flow` |
| stored empty cell, no formula | **blank → 0** | `source_provided_flow` |
| empty-string text (e.g. `=IF(…,"",…)`) | **blank → 0** | `source_provided_flow` |
| any finite number, **literal `0` included** | **stated**, that number | `source_provided_flow` |
| Excel error (`#REF!`, `#N/A`, …) | **unreadable** | `unavailable` |
| text where a number was expected | **unreadable** | `unavailable` |
| boolean | **unreadable** | `unavailable` |
| formula with no cached result | **unreadable** | `unavailable` |

This replaces `numberAt(...) ?? 0`, which returned null for *every* non-numeric kind and therefore
collapsed an error, a mistyped amount and a stray boolean onto the same zero as a genuine blank — a
corrupted capital movement would have published as **performance**. No such cell exists in the
workbook (census above), so no published figure ever changed: re-parsing all 102 historical columns
emits **427 flow rows, byte-for-byte identical** to the hosted book, with zero blocking findings.

**An unreadable flow cell REFUSES THE WEEK (blocking).** It cannot be downgraded to a warning:
dropping the block would publish no flow row at all, and an absent row is a blank — so a silent drop
would convert an error into a confident "no money moved". Nor can the block be published with an
`unavailable` flow, because the basis is established by reconciling the stated weekly profit against
each candidate total, and that reconciliation needs the flow (doc 02 § 2.1 forbids deciding a basis
any other way). The finding names the sheet and the cell; the administrator repairs the workbook and
re-uploads. Findings never echo cell content — an amount mistyped as text is still an amount — except
Excel's own fixed error literals, which are not private and are what the operator needs.

**No schema change.** `unavailable` is already in the published `value_class` CHECK constraint on
both `portfolio_snapshot_rows` and `portfolio_performance_rows`.

---

## 9. New-position handling — VERIFIED

Seven rows carry a `2026-07-31` value but **no Beginning-of-Year value**:
`NEXOR AI- Safe`; `Trinity Alps Venture Opportunities Fund II-B LP` (×3, under Naidelt/Retboy/
Vanglor); `CONDES CC Equity`; plus the two flow rows.

**PROPOSED:** a leaf with no BoY baseline renders BoY as `—` (unavailable), never `0`. YTD change for
that leaf is **not computed** — a zero baseline would produce a meaningless or infinite return. The
parent aggregate still includes the position; only the leaf's YTD comparison is suppressed, with a
"held since <first observed week>" note.

---

## 10. Acceptance criteria

- [x] Exact source columns identified for BoY, 17-07, 24-07, 31-07, existing difference, and live
- [x] Existing difference proven to be `31-07 − 24-07`
- [x] New publication difference defined as `06-08 − 31-07`, derived by NMI, never imported
- [x] Semantic (non-positional) date detection specified with blocking and warning conditions
- [x] `TODAY()` volatility identified and its handling rule fixed
- [x] Row-1 / row-5 header inconsistency found and resolved in favour of row 5
- [x] Full hierarchy and per-scope terminal structures documented without forced uniformity
- [x] Each performance block bound to its correct total row, numerically confirmed
- [x] External-link, macro, RTD, and Bloomberg prohibitions stated
- [x] Live error cells enumerated; blocking policy defined
- [x] Technical block identified and excluded
