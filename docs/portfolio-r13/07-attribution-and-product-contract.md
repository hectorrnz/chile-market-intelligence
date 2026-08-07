# R13.0 · Document 07 — Attribution and Fable Product Contract

**Phase:** R13.0 — documentation only.

---

## Part A — Performance attribution

## 1. The three levels

| Level | Definition | Requires |
|---|---|---|
| **1** | Current market value − previous market value | two snapshots |
| **2** | Market-value change adjusted for identifiable **asset-level** flows | two snapshots **+ per-asset flows** |
| **3** | True return contribution: `wᵢ × rᵢ`, with a defined flow treatment, summing to the portfolio return | per-asset **weights, returns, and flows** |

## 2. What the RESUMEN upload actually contains — VERIFIED

| Datum | Granularity | Present? |
|---|---|---|
| Market value | every leaf, sub-asset class, asset class, sociedad subtotal, portfolio total | **yes**, weekly |
| Flows (`Aportes / Retiros`) | **portfolio total only** | **yes** — one row per scope |
| Flows | asset class, sub-asset class, individual asset | **no** |
| Returns | **portfolio total only** | **yes** — weekly + YTD, source-provided |
| Returns | any level below the total | **no** |
| Transactions / units / prices | — | **no** |

**The decisive fact:** the workbook carries exactly **one** flow row per portfolio scope
(`Aportes / Retiros de la Semana` at rows 90/97, `Retiros / Aportes` at 152/209/268). There is no
per-asset, per-sub-asset-class, or per-sociedad flow anywhere in the source.

**Corroborating evidence — VERIFIED.** Jaime's week of `2026-07-31` shows a `1,655,600` flow at the
portfolio level. In the same week `NAIDELT`'s `Investment Grade` line rose by `1,651,108` and its
`Renta Variable` by `395,654`, while `Caja y Equivalentes` fell by `367,521`. The flow plainly landed
in specific assets — but **the source never says which**. Any per-asset split would be NMI's
invention.

## 3. Highest defensible level

| Scope | Portfolio-total level | Asset-class / sub-asset / leaf level |
|---|---|---|
| **Main** | **Level 3** (source-provided) | **Level 1** |
| **Jaime** | **Level 3** (source-provided) | **Level 1** |
| **Andrés** | **Level 3** (source-provided) | **Level 1** |
| **Pablo** | **Level 3** (source-provided) | **Level 1** |

### 3.1 Why the total is genuinely Level 3

Doc 04 § 4.2 verified, exactly and across all five performance blocks, that the source computes:

- `Utilidad de la semana = ΔValue − flow` → **flow-adjusted**
- `Retorno de la semana = Utilidad ÷ prior value`
- `Retorno del Año = Π(1 + rₜ) − 1` → **chain-linked, geometric**

That is a **time-weighted return**, the institutional standard. It is not an approximation NMI is
making — it is a figure the source states and NMI reproduces and cross-checks.

### 3.2 Why every level below the total is Level 1

Level 2 requires **identifiable asset-level flows**. They do not exist. Level 3 additionally requires
per-asset returns, which cannot be computed without those flows. Therefore the strongest honest
statement about a leaf, sub-asset class, asset class, or sociedad is:

> its market value changed by `X` between these two dates.

**Attempting more would be fabrication.** A large weekly increase in `Investment Grade` may be entirely
a deposit, entirely market movement, or any mixture — and in Jaime's `2026-07-31` week it is
demonstrably mostly a deposit.

### 3.3 One hard edge

`Caja y Equivalentes` absorbs deposits and withdrawals before they are deployed. It will routinely
show the largest absolute "value change" for reasons that are purely cash movement. Ranking it as a
top contributor or detractor would be actively misleading.

**PROPOSED:** in a weekly change ranking, `Caja y Equivalentes` is **excluded by default** with a
visible, reversible toggle labelled to explain why. Never silently dropped, never silently included.

## 4. Terminology boundary — BINDING

The product tab is **Weekly Changes** / **Cambios Semanales**.

### 4.1 What the source supports

| Supported | Level |
|---|---|
| Portfolio-level source-provided **weekly return** | total only |
| Portfolio-level source-provided **investment profit or loss** | total only |
| Portfolio-level source-provided **net contributions or withdrawals** | total only |
| **Weekly market-value changes below the portfolio level** | every hierarchy node |

**The source does not support asset-level performance attribution.**

### 4.2 Required wording (EN / ES)

| Concept | English | Spanish |
|---|---|---|
| Per-node delta | **Weekly Value Change** | Variación de Valor Semanal |
| Node's share of the portfolio move | **Contribution to Weekly Portfolio Value Change** | Contribución a la Variación de Valor Semanal del Portafolio |
| Percentage-point measure | **Impact on Portfolio Value** | Impacto en el Valor del Portafolio |
| Ranked increases | **Largest Weekly Value Increases** | Mayores Aumentos de Valor Semanal |
| Ranked decreases | **Largest Weekly Value Decreases** | Mayores Disminuciones de Valor Semanal |
| Waterfall title | **Drivers of Weekly Portfolio Value Change** | Factores de la Variación de Valor Semanal del Portafolio |
| Portfolio-level | **Weekly Return** / **Year-to-date Return** | Retorno de la Semana / Retorno del Año |
| Portfolio-level | **Weekly Profit / Loss** | Utilidad de la Semana |
| Flow | **Net Contributions / Withdrawals** | Aportes / Retiros Netos |

Note that *Contribution to Weekly Portfolio **Value Change*** is permitted: it names a contribution
to a **value change**, which is arithmetically exact, not a contribution to a **return**, which is
not derivable.

### 4.3 Forbidden below the total portfolio level

In either language: **Performance Attribution**, **Performance Contribution**,
**Top Performance Contributors**, **Top Performance Detractors**, **Security Return Contribution** —
and likewise *contribution to return*, *attribution*, *alpha*, *selection effect*,
*allocation effect*, *active return*.

**PROPOSED:** enforce with a repo-wide test in the style of `tableSourceFooterConvention.test.ts`,
asserting that no R13 client component or i18n key pairs a forbidden term with a below-total row,
in EN or ES.

### 4.4 What remains valid portfolio performance

The **total-level chain-linked, flow-adjusted time-weighted return** verified in doc 04 § 4.2 is
genuine portfolio performance and is preserved as such. `Weekly Return` and `Year-to-date Return`
are correct, source-provided labels **at the portfolio total**, and nothing in this section weakens
them.

## 5. Feature-by-feature verdict

| Requested feature | Verdict | Delivered as |
|---|---|---|
| Top 5 contributors | **Relabel** | Largest Weekly Value Increases (cash excluded by default) |
| Top 5 detractors | **Relabel** | Largest Weekly Value Decreases |
| Contribution by hierarchy level | **Relabel** | Value change by asset class / sub-asset class / individual asset |
| Weekly contribution history | **Partly** | Value-change history per row (Level 1); **true** contribution history only at portfolio level |
| Net flows vs investment gain/loss | **Yes, portfolio level only** | `ΔValue = flow + profit` — an exact, source-verified identity |
| Drill-down asset class → individual asset | **Yes** | Fully supported by the hierarchy |

The **net-flows-vs-gain** split is the strongest genuinely-supported analytic in the module and
should be prominent: it is verified exact (doc 04 § 4.2) and it is precisely what makes a
1.68 M weekly move in Jaime's book legible as 1.66 M of deposits and 27 K of gain.

## 6. Upgrade path to true attribution

To reach Level 2, the source must supply, **per asset** (or per sociedad × asset), per week:

1. **Flow amount and direction** — deposits/withdrawals attributed to the asset.
2. **Flow timing** — the date within the week, for day-weighting; absent that, a stated convention
   (begin/mid/end-of-period) applied consistently.
3. **Internal transfers** flagged distinctly from external flows — a rebalance is not a contribution.
4. **Income** (dividends, coupons, interest) separated from valuation change, and whether reinvested.

For Level 3, additionally:

5. **Beginning-of-period market value per asset** — already present.
6. A stated **return methodology** per asset (TWR vs money-weighted) consistent with the total.
7. For alternatives, a **valuation-date policy** — stale NAVs carried at cost produce mechanical zero
   returns that would distort any contribution figure.

**PROPOSED:** the practical route is a **new column block in the source workbook** — a per-asset flow
column alongside each weekly value column — rather than transaction-level ingestion. That is a
change to the administrator's workbook, not to NMI, and it should be requested explicitly rather
than engineered around.

---

## Part A2 — Weekly Changes calculation contract — BINDING

## 6a. Core measures

For **every valid hierarchy node** (leaf, sub-asset class, asset class, sociedad subtotal, portfolio
subtotal, portfolio total):

```
weekly_value_change = this_week_value − previous_week_value
```

Optional per-node portfolio-impact measure:

```
impact_on_portfolio_value = weekly_value_change ÷ previous_week_portfolio_total
```

Displayed as a percentage or percentage-point figure labelled **Impact on Portfolio Value**.

> **This must never be described as return contribution.** It is a node's dollar change expressed
> against the portfolio's opening value — arithmetically exact and useful, but it says nothing about
> the node's own return, because the node's flows are unknown (§ 2).

The node's **own** percentage change (`weekly_value_change ÷ previous_week_value`) may be shown as
secondary context. It is likewise a value change, not a return.

## 6b. Historical selection

- **This Week** = the selected published week.
- **Previous Week** = the immediately preceding published week.
- **Weekly Value Change** is recalculated from those two snapshots — never read from the source's
  `Diferencia` column (doc 02 § 4).
- **All Weekly Changes visualizations update from the same selected dates.** A single selection
  drives the metrics, both reconciliations, the waterfall, both ranked panels, the hierarchical
  chart, and the full table. No component may hold its own week.

## 6c. Node validity and double-counting

- A node is valid for a given week only if **both** `this_week_value` and `previous_week_value`
  exist. Otherwise the node's change is **unavailable**, never `0` (doc 02 § 9).
- **Parent and child rows must never appear in the same aggregate total** or the same ranked list.
- Aggregations run over the **normalized hierarchy tree** built at ingestion, not over flat row
  scans.

## 6d. Reconciliation tolerance

Child changes must reconcile to the parent change. **PROPOSED tolerance:** the greater of
`0.01` absolute or `1e-6` relative to the parent's previous-week value — tight enough to catch a real
structural error, loose enough to absorb float representation. A breach is reported as a **residual
or reconciliation warning**; it is never silently absorbed.

---

## Part A3 — Weekly Changes visualization contract — BINDING

## 6e. Waterfall: *Drivers of Weekly Portfolio Value Change*

**Exact title:** `Drivers of Weekly Portfolio Value Change`.

**Primary reconciliation:**

```
Previous Week Portfolio Value
  + Top-Level Portfolio Value Changes
  = This Week Portfolio Value
```

For the **Main Portfolio**, top-level drivers normally include: Cash and Equivalents · Fixed Income ·
Equities · Options · Real Estate · Venture Capital / Private Equity · InRetail · Chilean Equities ·
and **Other or Reconciliation Residual only when genuinely required**.

For **personal portfolios**, support views by **Sociedad** and by **Asset class**.

> **The driver set is derived from the normalized hierarchy, never hardcoded to the current sample
> rows.** A new asset class, a renamed sub-asset class, or a new sociedad must appear automatically.
> Hardcoding today's nine Main rows would silently drop tomorrow's tenth.

**Explicitly excluded from this waterfall:** net contributions/withdrawals and investment profit.
The asset-level value changes **already contain their effects**, so adding them as further bars
would double-count the week.

### Separate total-level reconciliation

A distinct component, using **source-provided total-level performance and flow fields**:

```
Previous Portfolio Value
  + Net Contributions or Withdrawals
  + Investment Profit or Loss
  = Current Portfolio Value
```

This is the identity verified exact in doc 04 § 4.2 and is the strongest genuinely-supported
analytic in the module.

### When a reconciliation does not tie

If either reconciliation falls outside the § 6d tolerance:

- **show a visible residual**,
- **mark the period as partially reconciled**,
- **do not silently absorb the residual into an asset class**,
- **do not fabricate a cause**.

## 6f. Largest weekly value changes

Two **separate** ranked panels: **Largest Weekly Value Increases** and
**Largest Weekly Value Decreases**. Each shows **up to five rows**.

Rules:

- Rank by **absolute dollar Weekly Value Change**.
- Positive rows appear **only** in increases; negative rows **only** in decreases.
- Exclude zero-value changes.
- Exclude subtotal and total rows **where underlying leaf rows are available**.
- Never rank a parent and its own child in the same list.
- Show **fewer than five** rows when fewer than five qualify — never pad.
- Each row shows: asset · sociedad (where applicable) · hierarchy classification · previous value ·
  current value · **dollar change** · the asset's own percentage change.
- **Dollar change is the primary ranking field**; the asset's own percentage change is secondary
  context only.
- Include a **View All Changes** action opening the complete ranked table.
- Privacy masking applies to every monetary value.

> **Top five is the binding default on desktop and mobile alike.** The panel may re-flow, scroll, or
> stack responsively, but **the data must not be reduced to top three on narrow viewports.**

`Caja y Equivalentes` remains excluded by default per § 3.3, with a visible reversible toggle —
it is a cash conduit, and ranking it would surface deposit movement as if it were a portfolio event.

## 6g. Hierarchical weekly change chart

**Recommended section title:** `Weekly Value Change by Portfolio Hierarchy`.
A **drill-down diverging horizontal bar chart**.

Hierarchies:

```
Main Portfolio :  Asset Class → Subasset Class → Individual Asset
Personal       :  Sociedad → Asset Class → Subasset Class → Individual Asset
```

Portfolio-specific lines such as **Proportional Other Companies** and **Staten Capital** remain
**explicit nodes** wherever they do not belong inside another hierarchy — they are not folded into
an asset class and not dropped.

Required behaviour:

- Positive changes extend **right** from zero; negative changes extend **left** from zero.
- Clicking a bar **drills into its children**.
- **Breadcrumbs** return to prior hierarchy levels.
- The chart displays **dollar Weekly Value Change**.
- Supporting text may show **Impact on Portfolio Value**.
- The chart updates with the **selected published week**.
- Honest **empty** and **unavailable** states.
- Parent and child rows never contribute to the same aggregate total.
- Aggregation uses the **normalized aggregation tree**.
- Child changes **reconcile to the parent change** within the § 6d tolerance; a genuine mismatch is
  reported as a **residual or reconciliation warning**.

> **A treemap must not be the primary hierarchical visualization.** Negative and positive changes
> require a common zero axis; treemap area cannot encode sign.
>
> **The chart must not be labelled performance attribution.**

## 6h. Weekly Changes page order — recommended Fable structure

1. Page header, portfolio selector, and published-week selector
2. Total-level weekly metrics
3. Total-level flow and investment-result reconciliation
4. **Drivers of Weekly Portfolio Value Change** waterfall
5. **Largest Weekly Value Increases** and **Largest Weekly Value Decreases**
6. **Weekly Value Change by Portfolio Hierarchy**
7. Full changes table
8. Historical weekly-change trend
9. Data freshness, publication status, reconciliation status, and source notes

The design must remain Fable-native · dark-first · fully functional in light mode · responsive ·
privacy-aware · accessible · free of page-level horizontal overflow · honest about partial and
unavailable data · and free of fabricated insights.

---

## Part B — Fable product contract

## 7. Information architecture — BINDING

**Client-facing module label: `Family Portfolio`.** Full route contract in doc 05 § 7.

| Navigation | Route | Renders |
|---|---|---|
| **Overview** | `/family-portfolio` | the generated Overview |
| **Portfolio** | `/family-portfolio/portfolio` | the detailed authorized portfolio |
| **Weekly Changes** | `/family-portfolio/weekly-changes` | the Weekly Changes experience |
| **Alternatives** | `/family-portfolio/alternatives` | the shared Alternatives experience |
| **Admin** *(administrators only)* | `/family-portfolio/admin` | upload, validation, publication, revision, rollback, access management |

`Admin` is visible only to administrators, and is protected server-side rather than merely hidden.

The existing `/portfolio` route remains a **separate Chilean-equities portfolio domain** — not
replaced, renamed, redirected, merged into, or altered (doc 01 § 2.3).

A **portfolio scope selector** appears in the page header wherever more than one scope is entitled.
It lists **only** the caller's scopes (server-filtered, doc 05 § 2.1). For Jaime it shows exactly
`Main` and `Jaime` — Andrés's and Pablo's names never reach the browser.

### 7.1 Overview

Generated One Pager, Fable-native (never a rendering of the Excel layout):

- `PageHeader` — eyebrow, title, scope, publication date, `SourceStateBadge`
- **Hero** — total portfolio value via `KpiHero` + `useCountUp`, with the weekly change and
  weekly/YTD return; asymmetric composition per the approved Portfolio hero language, not an
  equal-card grid
- **Comparison table** — BoY / Previous Week / This Week / Difference, each column labelled with its
  actual date (`TableCard`)
- **Allocation** — inline-SVG donut + table on all three bases (`Total`, `Sin Acc Chile`,
  `Sin Acc Chile Sin Inretail`), each with its denominator stated
- **Evolution** — two `LineChart`s (`Sin acciones chilenas`, `Con acciones chilenas`)
- **Weekly results** — flows, weekly return, weekly profit, YTD return, YTD profit
- **Market context** — InRetail price + variation + portfolio impact; global equity; global fixed
  income. Each with its own observation date and source badge
- **Administrator commentary** — verbatim, attributed, dated; hidden entirely when absent (no
  placeholder)
- **Disclosures** — provisional-price disclaimer; `TableSourceFooter` per table

### 7.2 Portfolio

- Hierarchical table: asset class → sub-asset class → sociedad → individual asset, expand/collapse,
  with subtotal and total rows rendered as the structural rows they are
- Four columns: **Beginning of Year**, **Previous Week**, **This Week**, **Difference** — each
  headed by its real date
- Historical week selector (dated dropdown over ~100 weeks; `SegmentedControl` does not scale here)
- Full history view
- Scope selector (entitled scopes only)
- Personal scopes render their **own** terminal structures — Jaime's `TOTAL JAIME`, Andrés's
  `TOTAL Soc Personales + Proporcional`, Pablo's `Staten Capital (1/3)` and
  `TOTAL más Staten Capital Ltd`. **Never forced into a uniform shape.**

### 7.3 Weekly Changes

Full binding contract in **Part A2** (calculations) and **Part A3** (visualizations). Page order per
§ 6h. In summary:

- Total-level weekly metrics, then the total-level flow / investment-result reconciliation
- **Drivers of Weekly Portfolio Value Change** waterfall (asset-level changes only — flows and
  profit are *not* added as extra bars, § 6e)
- **Largest Weekly Value Increases** and **Largest Weekly Value Decreases**, up to five rows each,
  ranked by absolute dollar change (cash excluded by default, toggle visible)
- **Weekly Value Change by Portfolio Hierarchy** — drill-down diverging horizontal bars, never a
  treemap
- Full changes table and historical weekly-change trend
- Freshness, publication status, **reconciliation status**, and source notes
- A persistent methodology note stating plainly that below the portfolio total these are **value
  changes, not return contributions**, and why

### 7.4 Alternatives

- Investment summary grouped by `(category, currency)` — **never** a blended cross-currency total
- Commitment / contributions / unfunded
- Valuation with `Fecha último statement` per row, and a staleness indicator
- `TIR Informada` and `TIR Calculada`, both labelled source-provided
- Event history timeline with the semantic legend (`Aporte` navy / `Dividendo` green /
  `Distribución` blue), colours drawn from the source legend
- Filters: sociedad, category, currency, event type
- Unclassified events surfaced as an explicit, actionable state — never hidden
- **Its own as-of stamp**, independent of the portfolio's

### 7.5 Admin

Upload A / Upload B side by side, each with: file input, parse status, blocking findings, warnings,
detected-date proposal + confirmation, manual override with a required note, draft preview,
publish, revision history, rollback. Plus **access management** — assigning and clearing each
approved user's portfolio principal. All administrator-only **at the API layer**, not merely hidden.

## 8. Preserved Fable and NMI obligations

| Obligation | R13 application |
|---|---|
| Fable authority for visual design | All new surfaces in the Fable language; no Excel-style rendering |
| NMI authority for substance | Content, routes, data sources, disclosures, timestamps, states, i18n, auth |
| Dark-first, full light mode | Both values defined for every new token, incl. the three alternatives event colours |
| Privacy masking | `PrivacyValue` + `usePrivacyMode` on **every** monetary value — this module is the most sensitive in the app |
| Semantic tokens only | No hardcoded hex. Event colours become `--alt-event-*` variable pairs, mapped in a config module (the `--news-src-*` precedent) |
| Responsive | Grids carry responsive prefixes; measured-height pinning binds only at `lg+` via `--pin-h`; dense tables scroll inside their card with a `min-w`; zero page-level horizontal overflow |
| Honest states | Loading, empty, unavailable, **partial**, error — all distinct. `AsyncState`/`EmptyState` |
| Source badges + footers | Exactly one `TableSourceFooter` per table; plain source name; badge shows the bare status word only |
| One as-of per surface | Portfolio and Alternatives each show their own; never blended |
| i18n | Every label in `dict.en` and `dict.es`. Source labels are Spanish; `label_en` is a curated translation with `label_es` fallback |
| Accessibility | WCAG AA against the composited backdrop; visible focus ring; keyboard-operable selectors and drill-downs; never meaning by colour alone — **event type always carries a text label beside its colour chip** |
| Motion | CSS/WAAPI only; `prefers-reduced-motion` honoured in the same change |
| No mock data | Fable sample financial values never enter this module |
| Typography | Body font with `tabular-nums lining-nums` for all figures; `font-mono` only for identifiers |
| Locale | Source is USD; format per the app's conventions and label the currency explicitly |

## 9. New components required

| Component | Why not an existing one |
|---|---|
| `HierarchicalTable` | `TableCard` has no expand/collapse or depth model |
| `WeekSelector` | `SegmentedControl` cannot present ~100 dated options |
| `AllocationDonut` | none exists; inline SVG, per the no-chart-library rule (Structured Notes' donut is the precedent) |
| `EventTimeline` | none exists |
| `WorkbookUploadPanel` | the Structured Notes upload UI is the pattern, not the component |
| `DualFreshnessBadge` | existing badges assume one as-of |
| `ValueChangeWaterfall` | none exists; inline SVG, cumulative running-total bars with a residual step (§ 6e) |
| `DivergingBarChart` | none exists; drill-down, common zero axis, breadcrumbs (§ 6g) |
| `ReconciliationStatus` | none exists; ties / partially-reconciled / residual states (§ 6d) |

## 10. Acceptance criteria

- [x] Attribution capability assessed against what the upload actually contains
- [x] Highest defensible level stated per scope, with total and sub-total levels distinguished
- [x] Level 3 at portfolio total justified by verified chain-linked, flow-adjusted arithmetic
- [x] Level 1 below the total justified by the absence of per-asset flows, with corroborating evidence
- [x] Honest client-facing labels specified in EN and ES; forbidden vocabulary listed
- [x] Cash-line distortion identified and handled
- [x] Required source fields for a Level 2/3 upgrade enumerated
- [x] Weekly value-change and Impact on Portfolio Value formulas fixed; historical-selection behaviour specified
- [x] Waterfall contract fixed, including the deliberate exclusion of flows/profit from the asset-change waterfall
- [x] Separate total-level flow + investment-result reconciliation specified, with residual handling
- [x] Top-five increases/decreases contract fixed, binding on desktop and mobile alike
- [x] Hierarchical diverging bar chart contract fixed; treemap rejected with reason
- [x] Weekly Changes page order recorded
- [x] Route architecture recorded as binding; navigation resolved
- [x] Per-tab composition specified in the Fable language, preserving per-scope structures
- [x] Design, accessibility, privacy, responsive, i18n, and honesty obligations restated
