# R13.8A — Family Portfolio weekly workbook update: discovery, contract, architecture

**Stage:** discovery / contract / architecture. **No Production writes, no migrations, no release.**
**Branch:** `feat/r13-8-family-portfolio-import`, cut from `origin/master` at `f81530c`.

Everything below was established by reading the code and schema and by running the repository's own
parsers against the private reference workbook, read-only. Where an earlier document and the code
disagree, the code is reported. Where the brief's premise and the code disagree, that is called out
explicitly rather than quietly worked around.

---

## 0. Executive summary — the premise needs correcting

The brief describes the weekly workbook update workflow as *missing*. It is not. **R13.2 through
R13.R1 already shipped the entire pipeline** — private storage, security validation, parsing,
draft preview, administrator confirmation, an atomic publication transaction, revisioning,
rollback, and a durable weekly-history table. It is a mature, well-guarded system.

Three things are genuinely missing or wrong for the *recurring* case, and they are the whole of
R13.8B:

| # | Gap | Severity |
|---|---|---|
| **G1** | **There is no way to upload a workbook from the application.** `POST /api/family-portfolio/admin/uploads` exists and works; nothing in the UI calls it. The admin console at `/portfolio/admin` has a date input, two text inputs and buttons — **no file input at all**. The weekly ritual currently has no front door. | **Blocking** |
| **G2** | **The default publication column is the LIVE column**, whose date is a cached `=TODAY()` and whose Chilean-equity block is Bloomberg `_xll.BDP(...)`. On any machine without the Bloomberg add-in it resolves to `#NAME?` and the parse blocks. **The reference workbook in the private inputs directory demonstrates exactly this failure.** | **Blocking** |
| **G3** | **Weekly history is refreshed by an unguarded `upsert`.** Every upload rewrites all ~500 historical observations with no diff, no confirmation and no before/after audit. A column-shift or a source restatement silently rewrites two years of chart history. | **High** |

Two further gaps are real but lower: there is **no workbook schema/version contract** (§3 of the
brief — addressed by the prototype this stage adds), and the **preview does not tell the
administrator whether the week is new, a duplicate, or a correction**.

---

## A. Existing Family Portfolio architecture

Five deployed migrations plus two later additions define the domain.

| Migration | Provides |
|---|---|
| `20260806000000_family_portfolio_entitlements` | `nmi_is_administrator()`, `nmi_can_access_scope(text)`, `portfolio_principal` on the profile |
| `20260807000000_family_portfolio_upload_storage` | `portfolio_source_uploads`, `portfolio_upload_findings`, the **private** storage bucket |
| `20260808000000_family_portfolio_snapshots` | `portfolio_publications`, `portfolio_snapshot_rows`, `portfolio_performance_rows` |
| `20260809000000_family_portfolio_alternatives` | Alternatives holdings + events |
| `20260810000000_family_portfolio_publication` | `nmi_publish_portfolio`, `nmi_publish_alternatives`, `nmi_rollback_publication`, commentary |
| `20260811000000_portfolio_evolution_history` | `portfolio_evolution_observations` — the long weekly series |
| `20260812/13…` | presentation settings, weekly notes |

**Posture, verified in the SQL, not assumed.** `authenticated` has **no** insert/update/delete
policy on any of these tables. Every write is service-role, performed after a server-side
administrator check. Reads of financial rows resolve through `nmi_can_access_scope(scope)`, so a
principal sees Main plus their own scope and nothing else — enforced by PostgreSQL, not a route
filter. `portfolio_source_uploads` and `portfolio_publications` are administrator-read only.

**The pipeline, end to end:**

```
POST /admin/uploads          → validate (13 checks) → sha256 → private bucket → status 'received'
GET  /admin/uploads/[id]     → re-download, re-verify digest, RE-PARSE, return a draft review
POST /admin/uploads/[id]/publish
                             → re-parse again (the browser supplies DECISIONS, never facts)
                             → resolve date (detected → confirmed → override needs a note)
                             → refuse on any blocking finding / unresolved event
                             → nmi_publish_portfolio(...)  ← ONE transaction
                             → best-effort evolution-history upsert
                             → optional commentary
POST /admin/publications/[id]/rollback → nmi_rollback_publication
```

---

## B. Current source-of-truth map

| Surface | Source | Notes |
|---|---|---|
| Summary / Holdings / Weekly Changes rows | `portfolio_snapshot_rows` where `is_current` | one publication per (kind, `as_of_date`) |
| Weekly P&L / return / flows | `portfolio_performance_rows` | stored as **source-provided**; NMI's recomputation rides in `metadata` as a cross-check and never replaces the figure |
| Portfolio Evolution chart | `portfolio_evolution_observations` | 502 rows: Main ×2 bases ×102, Jaime 102, Andrés 102, Pablo 94 |
| Alternatives | `portfolio_alternative_holdings` / `_events` | independent publication lifecycle |
| **One Pager** | **derived** from `portfolio_snapshot_rows` by `overview.ts` | the workbook's `1 Pager` sheet is **never parsed** |
| One Pager market context | `overviewMarket.ts` + `ONE_PAGER_BENCHMARKS` | live/persisted market feed, not the workbook |

Nothing is static. Nothing is generated. Everything client-visible traces to a published row.

---

## C. Private workbook structure — measured, not assumed

`C:\projects\nmi-private-inputs\portfolio-r13\portfolio-source-reference.xlsx`
455,885 bytes · sha256 `697416e7…c50c8334` · last modified 2026-08-11.

**This is the only workbook in the directory. There is no newer week to test against.** Its own
history ends at the same 2026-07-31 that Production already holds, so the "new week" path could not
be exercised end to end in this stage. See **AB. Blockers**.

| Sheet | Rows × Cols | Cells | Formulas | Errors |
|---|---|---|---|---|
| `RESUMEN` | 328 × 119 | 22,097 | 271 | **10** |
| `1 Pager` | 127 × 94 | 4,160 | 1,340 | 24 |
| `Alternatives` | 182 × 112 | 1,059 | 319 | 31 |

The brief calls the third sheet `alternativos`. Its **sheet name is `Alternatives`**; `Alternativos`
is the section title in cell `B3`. The parser keys on the sheet name.

### C.1 The RESUMEN column grid

- Header row **5** is authoritative (row 1 is a technical duplicate and is **missing** the
  beginning-of-year column — a parser keyed to row 1 would silently lose every YTD baseline).
- **102 frozen historical weekly columns**, `C` … `CZ`, 2024-08-23 → 2026-07-31, all hard values,
  no formulas.
- `DA1 = "insertar columna"`, `DB1 = "reemplazar"` — the workbook literally documents its own weekly
  ritual: freeze the live column into a new week at this marker.
- `DB` = `Diferencia`, a formula `CZ{r}-CY{r}`. **Never ingested** — it measures the *previous*
  week.
- `DE` = the live column: `DE4 = "Precios en vivo"`, `DE1 = =+TODAY()`, `DE5 = =+DE$1`.
- `DG`…`DO` = the allocation block, out of the value grid.

### C.2 The ten `#NAME?` cells — all of them in the live column

```
DE85  ACCIONES CHILENAS (USD)          DE286 STOCK ACCIONES CHILENAS CLP
DE87  TOTAL                            DE287 CLP Curncy
DE292-DE296  BCI / BSAN / CHILE / ITAUCL / CONDES  LAST PRICE
```

Every one is a Bloomberg `_xll.BDP(...)` call whose add-in was not loaded when the file was last
saved. **No historical column carries a single error.** This is the structural fact behind G2.

### C.3 Scope sections

`Resumen Portfolio` (Main, 81 labels) · `Jaime` (49) · `Andrés` (51) · `Pablo` (53), each personal
scope repeating the full liquid hierarchy per sociedad, then `SUBTOTAL <SOC>`, then `Alternativos`,
then `TOTAL <SOC>`. Below row 277 sits the technical `CÁLCULO DE STOCKS` block, excluded from every
scope range.

### C.4 What the repository's own parsers make of it

| Run | Result |
|---|---|
| `parseResumen(bytes)` — **default, i.e. the live column** | **`ok: false`** · `blocking source_cell_error` at `RESUMEN!DE87` |
| `parseResumen(bytes, { publicationColumnLetter: 'CZ' })` | `ok: true` · as-of 2026-07-31 · 195 rows · 25 performance rows · 0 blocking |
| `…{ 'CY' }` / `…{ 'CX' }` | `ok: true` · identical shape |
| `extractEvolutionHistory(bytes)` | `ok: true` · **502 observations** · 102/102/102/94 · 2024-08-23 → 2026-07-31 |
| `parseAlternatives(bytes)` | `ok: true` · 43 holdings · 212 events · 6 subtotals · 3 unclassified events |

The 502 observations reproduce the stated production baseline exactly, which confirms this file is
the source Production was built from.

---

## D. Workbook schema contract — `family_portfolio_workbook_v1`

**Nothing in the repository versions the workbook's shape today.** `RESUMEN_PARSER_VERSION` and
`ALTERNATIVES_PARSER_VERSION` version *the reader*, not *what was read*. A hand-maintained Excel
file is one keystroke from a restructure that still parses — of the wrong thing.

This stage adds `src/lib/familyPortfolio/workbookContract.ts` (pure, 0 server imports) implementing
the contract, plus 24 tests. It runs **before** any value is read and reads none itself.

### D.1 Verdicts

| Verdict | Meaning | Operator action |
|---|---|---|
| `supported` | skeleton matches | publish normally |
| `supported_with_warnings` | readable, something changed or is unusual | look, then publish |
| `ambiguous` | more than one reading of a structure required to be singular | **never** resolved by picking; a human decides |
| `unsupported_schema` | a required structure is absent — a *different* workbook, not a broken one | reject |
| `invalid` | not readable as OOXML | reject |

Ambiguity **outranks** a co-occurring structural refusal: "two columns claim the same week" and "a
section is missing" call for different actions, and collapsing them hides which happened.

### D.2 Required structures

`portfolio`: a `RESUMEN` sheet · an authoritative header row · ≥ 20 strictly ascending weekly
columns · **exactly one** live column · all four scope anchors.
`alternatives`: an `Alternatives` sheet · the `Nombre de la Inversión` header row · ≥ 8 master-data
column headers.

Warnings: a > 10-day gap between consecutive weeks (a skipped week is a legitimate history event and
is **reported, never repaired**).

### D.3 The structural fingerprint

`structureHash` = sha256 over a canonical skeleton:

| In the hash | Out of the hash |
|---|---|
| sorted sheet names | every amount |
| the ordered column-role pattern, **historical runs collapsed to one token** | every date |
| each scope's anchor label | the historical column **count** |
| each scope's ordered, accent/case-normalized label list | cadence / gaps |
| the Alternatives master-data headers | |

That split is the entire design. A normal week adds one column and rewrites ~200 numbers; if any of
that entered the hash it would move every week and an operator would correctly learn to ignore it.
Restructuring moves it and nothing else does. Both halves are asserted by test, and both were shown
non-vacuous by deliberately breaking the module (see **X**).

A workbook that fails the contract gets **no** fingerprint — emitting one would let a rejected shape
be compared against an accepted one as if commensurable.

**Measured against the real workbook:** both kinds classify `supported`, zero findings.

### D.4 What forces which change

| Change | Response |
|---|---|
| A week added; values change | nothing — hash stable by construction |
| A skipped week | `supported_with_warnings` |
| Row renamed / inserted / reordered; sheet added or renamed | hash moves → administrator reviews → same version, recorded drift |
| A new sociedad or scope section | same-version parser adjustment + a recorded fingerprint change |
| Header row moves, live column disappears, scope anchor removed | `unsupported_schema` → **new contract version** before it can be accepted |
| Two live columns / duplicate week date | `ambiguous` → human resolves in Excel |

---

## E. Canonical import model
> **Superseded in part by §AE (WORKBOOK HISTORY LEADS, LOCKED).** One upload may carry several
> unpublished frozen weeks. All of them import, atomically, and none are ever invented. An insertion
> — `NEW` above the endpoint, `GAP_FILL` below it — needs no correction authorization; only an
> overwrite of an existing identity does.


The pipeline **already** normalizes fully before any write, and no calculation reaches back into
workbook cells afterwards. Mapping the brief's names onto what exists:

| Brief | Exists as | Provenance carried |
|---|---|---|
| `WorkbookMetadata` | `portfolio_source_uploads` | filename (sanitized), sha256, size, uploader, status, detected/confirmed date |
| `ImportBatch` | `portfolio_publications` | upload, kind, `as_of_date`, revision, `is_current`, `parser_version`, publisher, metadata |
| `PortfolioSnapshot` | `ParsedSnapshotRow` → `portfolio_snapshot_rows` | `source_sheet`, `source_cell`, `metadata.sourceRow`, `value_class` |
| `PortfolioFlow` | `portfolio_performance_rows` metric `flow` | `value_class` ∈ `source_provided_flow` \| `unavailable` |
| `PortfolioHistoryPoint` | `portfolio_evolution_observations` | source cell, row label, upload id, parser + extractor version |
| `AlternativeInvestmentSnapshot` | holdings + events | source cell/row, fill colour, classification method |
| `ValidationIssue` | `ParseFinding` / `portfolio_upload_findings` | severity, code, scope, cell — **never an amount** |
| `OnePagerSnapshot` | **deliberately absent** | derived from published rows — one source of truth |

**Only addition R13.8B needs:** the contract report (verdict + `structureHash` + contract version)
must be persisted on the upload, and the contract version stamped on the publication.

---

## F. Date / week identity

`report_date` = a **date-only** ISO string, no timezone. It is `as_of_date` on the publication and
`observation_date` on the observation, and `(upload_kind, as_of_date)` is the week's identity.

The rules already in force, and correct: the parser reads the **cached** value of the date cell and
**never** evaluates `TODAY()` or substitutes the server clock; detection **proposes** and the
administrator **confirms**; a divergence requires a written note, enforced by a database CHECK.

**The defect is which column supplies the proposal.** `loadDraft` calls `parseResumen(bytes)` with
no column, so the proposal comes from `DE1 = =+TODAY()` — *the date Excel last recalculated on the
operator's machine*. That is one confirmation click away from the anti-pattern the brief names.

**Recommendation — R13.8B should publish the newest UNPUBLISHED HISTORICAL column, not the live
column.** After the weekly `insertar columna` ritual the newest historical column *is* the week that
just closed. It carries:

- a **real reporting date**, not a save date;
- **frozen values**, no Bloomberg dependency, no `#NAME?`;
- exactly the figures the family's own PDF reports show.

The live column stays useful as an *intra-week* preview; it should not be the default publication
column for a recurring weekly run. This is a behaviour change to a shipped, owner-approved
lifecycle, so it is a **decision for the owner**, not something to be assumed — see **AA**.

---

## G. Duplicate / reupload semantics

| Case | Current behaviour | Verdict |
|---|---|---|
| **A.** New week | new `(kind, date)` series, revision 1 | correct |
| **B.** Same workbook twice, same kind | `409 duplicate_upload`; `unique (upload_kind, file_sha256)` is the real guarantee | correct |
| **C.** Same week, byte-identical data | cannot arise — B blocks it at upload | correct |
| **D.** Same week, corrected data | different bytes → new upload → **new revision**, predecessor superseded, never deleted | correct |
| **E.** Older historical week | permitted via `publicationColumnLetter`, reachable **only** from the CLI backfill script — no route exposes it | correct |
| **F.** Newest week older than Production | `date_not_advancing` is *defined* but the check is **not wired into the publish route** | **gap** |
| **G.** Workbook containing many historical weeks | **every** weekly workbook does. Publication takes one week; the evolution upsert takes **all** of them | **gap — see H/I** |
| Double-click / transport retry | `publication_refused_duplicate_submission` (same upload + same parser version already current) | correct |

**F and G are the two R13.8B must close.** F is a missing wire-up. G is the history-preservation
problem.

---

## H. Correction semantics

Correction is **revision, never mutation**. `nmi_publish_portfolio` inserts the new revision
**non-current**, fills its children, demotes the predecessor (pointing `superseded_by` at a row that
now exists), then promotes — an ordering forced by a partial unique index pulling against a
non-deferrable self-FK, and the safe state to be interrupted in. Rollback flips the flag.
**Nothing is ever deleted.**

**One asymmetry to fix:** `nmi_rollback_publication` restores publication rows but does **not**
touch `portfolio_evolution_observations`. Roll a bad week back and the snapshot returns while the
chart keeps the bad point.

---

## I. History-preservation rules
> **Superseded in part by §AE (WORKBOOK HISTORY LEADS, LOCKED).** One upload may carry several
> unpublished frozen weeks. All of them import, atomically, and none are ever invented. An insertion
> — `NEW` above the endpoint, `GAP_FILL` below it — needs no correction authorization; only an
> overwrite of an existing identity does.


**The strongest finding after G1/G2.** `upsertEvolutionObservations` is a plain
`upsert(onConflict: 'scope,basis,observation_date')`, chunked at 250, run **after** the publication
commits, **best-effort**.

It is append-safe and cannot truncate. But every weekly workbook carries the whole history, so
**every upload silently rewrites all ~500 historical observations.** A column-shift bug, a source
restatement, or an operator editing an old column rewrites two years of chart history with no diff,
no confirmation, no before/after audit, and — being chunked and non-transactional — possibly only
half of it.

**Rules R13.8B must enforce:**

1. **Append is the default.** A new `(scope, basis, observation_date)` writes freely.
2. **A changed value on an existing observation is a CORRECTION.** Compute the diff during preview;
   show it; require explicit confirmation and a reason. Never write it as a side effect of
   publishing a different week.
3. **Block an unexpected historical rewrite by default** — the brief's own rule, and the current
   code does the opposite.
4. **Protect the floor.** Main / Jaime / Andrés ≥ 102 and Pablo ≥ 94 observations; a post-write
   verify that finds fewer must fail loudly.
5. **Make the write transactional**, so a mid-run failure cannot leave a partial rewrite.
6. **Roll back the series with the publication** (closes H's asymmetry).

Immutable once published: `as_of_date`, `parser_version`, `revision`, every `source_cell`, the
predecessor chain. Replaceable only by an explicit new revision: values, classifications,
commentary.

---

## J. Flow parsing matrix

Fully implemented and correct, in exactly one place — `classifyFlowCell` in
`resumen/hierarchy.ts`. Everything downstream consumes its decision rather than re-deriving it, so
the blank/unreadable distinction cannot drift between layers.

| Excel cell | Reading | Value | Published class |
|---|---|---|---|
| no cell written | `blank` | **0** | `source_provided_flow` |
| numeric, finite (**including a literal 0**) | `stated` | exact | `source_provided_flow` |
| numeric, non-finite | `unreadable` | **null** | `unavailable` |
| empty **with** a formula (no cached result) | `unreadable` | null | `unavailable` |
| empty **without** a formula | `blank` | 0 | `source_provided_flow` |
| text `""` (a formula returning empty) | `blank` | 0 | `source_provided_flow` |
| any other text — `"-"`, `"N/A"`, a number typed as text | `unreadable` | null | `unavailable` |
| `TRUE` / `FALSE` | `unreadable` | null | `unavailable` |
| `#N/A` `#VALUE!` `#NAME?` `#REF!` `#DIV/0!` `#NULL!` `#NUM!` | `unreadable` | null | `unavailable` |

**Unavailable is never zero.** The blank-means-zero rule is justified, not assumed: the source's own
profit identity balances exactly when the blank is treated as 0. In the reference workbook all 477
blanks across the five flow rows are literally absent cells and all 33 values are numbers, so nothing
has ever been mis-read — the classifier closes the door before a bad cell appears.

**R13.8B changes nothing here.** It only needs to surface an `unavailable` flow prominently in
preview, because it suppresses the weekly identity for that block.

---

## K. Financial validation and invariants

| Check | Current | Class |
|---|---|---|
| Weekly identity `ΔValue = P&L + Flows` | recomputed per block and used to **bind** a performance block to the total it measures; disagreement is stored as a cross-check | `HARD_ERROR` for binding, `WARNING` for divergence |
| `SUBTOTAL + ACCIONES CHILENAS = TOTAL` | verified in structural derivation | `HARD_ERROR` |
| Any blocking finding | refuses publication in the route **and independently** in `nmi_assert_publishable` | `HARD_ERROR` |
| Empty payload | `publication_refused_nothing_to_publish` | `HARD_ERROR` |
| Duplicate `row_key` | fails closed at parse | `HARD_ERROR` |
| Alternatives per-currency subtotals | `verifyPerCurrencySubtotals` — not a tautology: `Real Assets` spans three currencies, and one merged subtotal would be arithmetic over unlike units that looks entirely plausible | `HARD_ERROR` |
| Holding with no currency | refused, naming the row | `HARD_ERROR` |
| Event matching exactly one holding | zero or many both fail closed | `HARD_ERROR` |
| Unclassified event colour | blocks until the administrator classifies | `HARD_ERROR` |
| Week gap > 10 days | warning | `WARNING` |
| `date_not_advancing` | **defined but not wired** | must become `HARD_ERROR` unless overridden with a note |
| Contract verdict | **does not exist yet** | `supported`/`_with_warnings` pass; all else `HARD_ERROR` |
| Historical-observation drift | **does not exist yet** | `HARD_ERROR` unless confirmed as a correction |

Nothing here rejects on an invariant the source does not itself guarantee — source-provided returns
are stored as stated and NMI's recomputation never silently replaces them.

---

## L. Main / personal / Alternatives mapping

| Workbook section | Scope |
|---|---|
| `Resumen Portfolio` / `Watermill + Dubai + 3 Uruguayas` | `main` |
| `Jaime` → `LA ESPERANZA`, `NAIDELT` | `jaime` |
| `Andrés` → `LOS SAUZALES`, `RETBOY` (+ proportional) | `andres` |
| `Pablo` → `LOS LAURELES`, `VANGLOR` (+ proportional, + Staten ⅓) | `pablo` |
| `Alternatives` sheet, 13 sociedades | `alternatives` (own lifecycle) |
| `CÁLCULO DE STOCKS` and below | excluded — technical |

Scope is assigned from the **section anchor** and Main's range is bounded by the next anchor, so a
personal sociedad cannot leak into the shared book. Scope isolation is the single highest-risk
property in the parser and is treated as such.

**Workbook labels never confer authorization.** Entitlement resolves from the caller's own profile
(`role`, `portfolio_principal`) inside `nmi_can_access_scope`. The two concerns are already
separate and must stay so.

---

## M. One Pager source mapping

| Element | Source |
|---|---|
| Cierre Semanal rows, allocations, subtotals, totals | **derived** from `portfolio_snapshot_rows`, structurally — never label-guessed |
| InRetail **portfolio-value impact** | derived from published snapshots; needs no market feed |
| InRetail **price and weekly variation** | `ONE_PAGER_BENCHMARKS` market resolver |
| Benchmark returns | same resolver |

The workbook's `1 Pager` sheet is **not parsed at all**, and should stay that way — it is a
presentation of RESUMEN, and parsing both would create two sources that can disagree. One source of
truth, already achieved.

**Live status, honestly:** the InRetail benchmark is `UNVERIFIED` after the 2026-08-10 operator run
— attempted and failed, which is different from not attempted. Two findings block promotion: the
venue declares no quote currency, and Lima history is incomplete enough that the recomputed weekly
return misses the reference by > 0.5 pp in 3 of 76 weeks. **Price and variation therefore render
unavailable.** R13.8B does not change this; it is benchmark-verification work, not import work.

---

## N. Alternatives source mapping

Item identity is `(currency, investment_name, sociedad)`, and an event must match **exactly one**
holding — zero means no home, many means the category would be guessed; both fail closed, because a
mis-attached event still looks like a valid timeline.

Fields: capital committed · contributions · unfunded · last statement date/label · last valuation ·
flow since statement · current value · reported IRR · **calculated IRR cached from the source**
(Excel's IRR is an iterative solver and is never re-run server-side).

Currencies observed: `dolares` 38, `euros` 2, `uf` 1, `pesos` 2 — which is exactly why per-currency
subtotals are enforced. Categories: Private Equity 26, Real Assets 16, Private Debt 1.
Event types: aporte 152, dividendo 29, distribución 28, **unclassified 3**.

Alternatives is deliberately **not** forced into the listed-holdings schema — the economics differ,
and it has its own tables, parser and publication lifecycle. Correct as built.

**Its `as_of_date` is not detected from the sheet** (the parsed draft carries none); the
administrator supplies it. R13.8B should propose the RESUMEN week for the same upload rather than
leaving the field blank.

---

## O. Preview-before-apply
> **Superseded in part by §AE (WORKBOOK HISTORY LEADS, LOCKED).** One upload may carry several
> unpublished frozen weeks. All of them import, atomically, and none are ever invented. An insertion
> — `NEW` above the endpoint, `GAP_FILL` below it — needs no correction authorization; only an
> overwrite of an existing identity does.


The stages all exist — `UPLOAD → PARSE → VALIDATE → PREVIEW → CONFIRM → ATOMIC APPLY → AUDIT` — and
**no write occurs during parse or preview**. The workbook is re-downloaded, its digest re-verified
against the upload record, and re-parsed on every preview and again at publish, so a publication can
only ever describe the exact bytes that were validated.

Against the brief's required preview contents:

| Required | Status |
|---|---|
| workbook version | ✗ — **added by this stage's contract**, needs wiring |
| reporting date (detected + confirmed + override) | ✓ |
| scopes detected, per-scope row and unavailable counts | ✓ |
| warnings / errors / refusals | ✓ |
| Alternatives impact (holdings, groups, legend, unclassified) | ✓ |
| **new week vs duplicate vs correction** | ✗ |
| rows to insert / update / unchanged | ✗ — the model is revision-based, so the honest equivalent is a **row-key delta vs the current publication** |
| totals before/after | ✗ |
| flows before/after | ✗ |
| history-point counts before/after | ✗ |
| One Pager impact | n/a — derived, moves with the rows |

The five missing items are the R13.8B preview work. They are additive to `DraftReview`.

---

## P. Atomic transaction boundary
> **Superseded in part by §AE (WORKBOOK HISTORY LEADS, LOCKED).** One upload may carry several
> unpublished frozen weeks. All of them import, atomically, and none are ever invented. An insertion
> — `NEW` above the endpoint, `GAP_FILL` below it — needs no correction authorization; only an
> overwrite of an existing identity does.


**Already correct for the publication**, and it should not be redesigned: one plpgsql function,
`search_path = ''`, EXECUTE revoked from public/anon/authenticated and granted only to
`service_role`, a transaction-scoped advisory lock serialising every writer of a `(kind, date)`
series, insert-non-current → fill → demote → promote.

**Two boundaries R13.8B must extend:**

1. **Evolution observations must join the transaction** — today they are a separate, chunked,
   best-effort, post-commit upsert (§I).
2. **Rollback must cover the series** (§H).

Precondition assertions to add, in the Structured Notes reconciliation style: the caller states the
`structureHash`, the contract version, and the expected count of pre-existing observations it
intends to touch; the function refuses if state has moved. Reuse the **discipline**, not the
schema — a portfolio week is not a note reconciliation.

---

## Q. Idempotency

Distinguishing the four cases:

| Case | Discriminator |
|---|---|
| same file | `file_sha256` — unique per `(upload_kind, sha256)` |
| same data, different file | **normalized payload hash — does not exist yet** |
| same week, corrected data | new upload + same `as_of_date` → new revision |
| different week | different `as_of_date` |

Filename is used for **display only** — never identity. Add a `payload_sha256` over the canonical
normalized payload (rows + performance, sorted by `row_key`, excluding volatile provenance) so a
re-parse that produces identical figures under a new parser version is recognisable as a no-op
rather than published as a fresh revision.

---

## R. Audit trail

Already durable and administrator-only, spread across `portfolio_source_uploads` (filename, digest,
size, uploader, status, detected vs confirmed date, override note enforced by CHECK),
`portfolio_upload_findings`, and `portfolio_publications` (upload, kind, date, revision, publisher,
`published_at`, `is_current`, `superseded_by`, `parser_version`, admin note, metadata).

**Recommendation: extend the existing tables; do not create a Family Portfolio import table.** The
spine already models the whole lifecycle and a parallel table would fork the audit. Missing fields:
`workbook_contract_version`, `structure_hash`, `payload_sha256` on the upload; contract version on
the publication; and a correction reason plus a before/after summary for any historical-observation
change (§I) — the one genuinely new record, which belongs beside the observations, not beside the
uploads.

---

## S. Admin import-status model

`portfolio_source_uploads.status` already carries `received | parsing | draft | blocked | …`, kept in
sync by `nmi_sync_upload_status`. Mapping the brief's states: *Ready to upload* (no record) ·
*Parsing* · *Validation failed* → `blocked` · *Ready for review* → `draft` · *Applied* → a current
publication · *Applied with warnings* → current + warning findings · *No changes* → the new
payload-hash no-op · *Failed / rolled back* → superseded.

After success the administrator should see: last update date, source workbook (sanitized name +
digest prefix), upload and apply timestamps, who applied it, warning count, contract version,
structure-hash drift, and the current history-point count per scope. **None of this is shown to
ordinary members.**

---

## T. Authorization and security

| Capability | Gate |
|---|---|
| Upload / preview / apply / rollback / read audit | `entitlement.isAdministrator`, checked **before the body is read**, plus `guardPrivateApi()` |
| Read financial rows | `nmi_can_access_scope(scope)` in RLS |
| Write anything | service-role only — `authenticated` has no write policy anywhere in the domain |
| Reach a stored workbook | server-minted signed URL; the bucket is private with **no** `authenticated` policy |

`canAdminister` resolves from `role === 'administrator'` and is **independent of
`portfolio_principal`** — importer permission is already decoupled from portfolio ownership,
exactly as §18 requires. A non-administrator refusal is deliberately identical everywhere, so a
caller learns nothing about whether a resource exists.

---

## U. File security

All thirteen checks are implemented and tested (`portfolioUploadSecurity.test.ts`, 60 tests):
administrator first · `Content-Length` screened **before** `formData()` materialises the body ·
authoritative `file.size` before `arrayBuffer()` · extension and MIME · **macro-enabled refused by
extension `.xlsm/.xltm/.xlsb` and independently by content (`vbaproject.bin`)** · ZIP validity ·
entry-name traversal · compression ratio and zip-bomb caps (≤ 512 entries, 20 MB) · `<!DOCTYPE` /
`<!ENTITY` refused outright · required OOXML parts · filename sanitized · sha256 · duplicate
detection.

Formulas are **retained for classification and never evaluated**; external workbook links are never
followed. Raw workbooks are retained privately (correct — publication re-parses from them and
re-verifies the digest) and are never publicly reachable. No cell value, part content or exception
text is ever returned or logged.

**R13.8B adds nothing here.** The one adjustment: the contract check (§D) should run at upload so a
materially different workbook is refused before it is stored.

---

## V. Fixture and test strategy

Synthetic builders already exist — `resumenWorkbook()` (single-week shapes),
`buildBook()` in `portfolioHistoricalNormalization.test.ts` (22-week multi-column), `makeZip()`
(malformed archives) — and this stage adds a **four-scope, N-week builder** in
`portfolioWorkbookContract.test.ts` with switches for renames, row insertion, missing scopes,
missing live column, duplicate weeks and skipped weeks.

**No private data is ever committed.** Structures are reproduced from docs 02/03; the numbers are
invented, and a test asserts no finding or reported structure can echo one.

R13.8B scenarios to add, all expressible on that builder: valid new week · identical reupload ·
same-week correction · schema drift · missing sheet · malformed flow · Excel error · missing
portfolio · duplicate week · **historical regression (a changed old column)** · Alternatives edge
cases · partial data · cross-sheet mismatch.

---

## W. Repository changes in this stage

| File | Status | Lines |
|---|---|---|
| `docs/portfolio-r13/14-r13-8a-weekly-update-architecture.md` | new | this document |
| `src/lib/familyPortfolio/workbookContract.ts` | new, pure, additive | 385 |
| `tests/portfolioWorkbookContract.test.ts` | new | 24 tests |

**Nothing existing was modified.** No migration, no route, no UI, no parser change. The contract
module is not yet wired into any route — wiring it is R13.8B.

---

## X. Tests run

| Gate | Result |
|---|---|
| `portfolioWorkbookContract.test.ts` (new) | **24 / 24 pass** |
| `familyPortfolioPublication` + `portfolioUploadSecurity` + `resumenParser` + `portfolioHistoricalNormalization` + `familyPortfolioEntitlements` | **405 / 405 pass** |
| Contract against the real workbook | `supported`, 0 findings, both kinds |

**Non-vacuity demonstrated on two independent axes:**

- letting the historical column count into the fingerprint → exactly 1 failure
  (*"adding a week does not move the structure hash"*);
- collapsing `ambiguous` into `unsupported_schema` → exactly 2 failures.

Both breaks were reverted and the suite returned to green.

---

## Y. Candidate SHA · Z. origin/master

Recorded in the summary message accompanying this document. `origin/master` at the start and end of
this stage is **`f81530c0255172e4b993dacb334ee3c62333310f`**, and the feature branch is a
descendant of it (`git merge-base --is-ancestor` verified).

---

## AA. Unresolved questions — owner decisions
> **RESOLVED — see §AE.** AA.1 (which column publishes) is answered: the newest valid FROZEN
> reporting date, never the live `=TODAY()` column. AA.2 (a changed historical observation) is
> answered by §AE.4: only an overwrite of an existing identity is a correction.


1. **Which column is the weekly publication column?** (§F) Live (`TODAY()`, Bloomberg-dependent) as
   today, or the newest unpublished historical column. **Recommendation: historical.** This changes
   a shipped, owner-approved lifecycle and must not be assumed.
2. **What should happen when a historical observation's value changes?** Recommended: block, show
   the diff, require confirmation and a reason.
3. **Should the same workbook keep being uploaded twice**, once per kind? It works
   (`unique(upload_kind, sha256)` is scoped by kind) but doubles the weekly ritual. A single upload
   fanning out to both publications is possible and is a UX decision.
4. **Retention** of raw workbooks — currently indefinite. Correct for re-parse and audit; confirm it
   is intended.
5. **Should `date_not_advancing` block**, or warn with an override note? (§G case F.)

## AB. Blockers

1. **No new weekly workbook exists.** The private inputs directory holds only the R13 reference
   file, whose history ends at the already-published 2026-07-31. **The new-week path cannot be
   validated end to end until a genuinely newer workbook is provided.** Everything in this document
   about that path is derived from code and schema, not from an observed run.
2. **The reference workbook's live column is unusable** (`#NAME?` × 10). If the owner keeps the live
   column as the publication column, R13.8B needs a workbook saved on a Bloomberg-enabled machine to
   test against at all.
3. Question **AA.1** gates the shape of R13.8B's parse step.

## AC. Recommended R13.8B scope
> **Partly delivered — see §AE.7/§AE.9.** The import-operation identity, the before-image ledger,
> both RPCs and the planner exist. The administrator upload control (G1) and the route wiring do not.


**In, in order:**

1. **G1** — the administrator upload control on `/portfolio/admin`: file picker, kind selector,
   progress, and the structured rejection codes the route already returns.
2. **D** — wire `classifyWorkbook` into upload and preview; persist `workbook_contract_version` and
   `structure_hash`; refuse a non-supported verdict; surface hash drift in preview.
3. **G2** — publication-column selection per **AA.1**.
4. **I** — historical-observation protection: diff in preview, confirmation + reason, transactional
   write, floor assertion (102/102/102/94), rollback coverage.
5. **O** — preview completions: new/duplicate/correction, row-key delta, totals and flows before/
   after, history counts before/after.
6. **G/F** — wire `date_not_advancing`.
7. **Q** — `payload_sha256` and the no-op path.
8. **V** — the scenario fixtures.

**Out:** any redesign of the publication RPC or the entitlement model; any change to flow semantics;
parsing the `1 Pager` sheet; InRetail benchmark verification; a second import table.

**Migration expected:** one additive, forward-only migration for the new upload/publication columns
and the corrections record — authored and CI-tested in R13.8B, applied to Production only under an
explicit owner-authorized release.

## AD. Verdict

**READY FOR R13.8B IMPLEMENTATION**, with the premise correction in §0 and the two owner decisions
in AA.1 and AA.2 resolved first, and with AB.1 understood: the new-week path cannot be proven
end to end until a newer workbook exists.

---

## AE. WORKBOOK HISTORY LEADS — final catch-up and gap-fill semantics (LOCKED)

Recorded after A–AD were delivered, and **locked by the owner**. It supersedes every part of §§ E,
G, H, I, O and P that assumed one upload equals one reporting week, and it closes two of the
questions §AA left open:

* **AA.1 — which column publishes — is answered.** The current publication carries *the newest valid
  **frozen** reporting date*. It is never the live `=TODAY()` column. G2 is therefore resolved in
  favour of the frozen historical column, and the Bloomberg dependency described in §C stops being a
  publication-path concern.
* **AA.2 — what happens when a historical observation's value changes — is answered** by AE.4 below.

### AE.1 The rule

**Production history + all newer frozen workbook history = new Production history.**

The uploaded workbook is authoritative for the weekly historical sequence. If Production ends at
`2026-07-31` and the administrator misses two weeks, the next workbook carries frozen columns for
`08-07`, `08-14` and `08-21`, and the importer **must append all three**. Publishing only `08-21` and
discarding the weeks the operator missed is forbidden.

### AE.2 And the workbook also bounds it — no synthetic gap filling

A reporting week exists because the source froze a column for it, **never because calendar time
passed**. If the workbook carries `08-07` and `08-21` but no frozen `08-14`, exactly two weeks
import. Nothing invents `08-14`, forward-fills it, interpolates it, or synthesises a zero or an
`unavailable` point to make the cadence look weekly.

| Situation | Required behaviour |
|---|---|
| Missing in Production, **present** in the workbook | MUST be imported |
| Missing in Production, **absent** from the workbook | MUST NOT be invented |

A calendar cadence gap is **informational**. It is never a `HISTORY_CONFLICT`, and never permission
to fabricate.

### AE.3 One import, one current publication, N history points

A catch-up produces **one** import operation:

```
ONE workbook upload
  → ONE import operation / revision
  → N historical observations appended, gap-filled or corrected
  → ONE current publication, at the newest valid frozen reporting date
```

No publication revision is minted for an intermediate week. `08-07` and `08-14` contribute history
points; only `08-21` becomes current. The workbook was uploaded once, so the audit model says so
once.

Note that `is_current` is unique per `(upload_kind, as_of_date)`, not globally — each week stays
current for itself, and the book's current snapshot is the newest `as_of_date` among current rows.
So publishing `08-21` does not demote `07-31`; a rollback of that import simply demotes `08-21` and
the newest current reverts to `07-31`.

### AE.4 Final point classification

Per canonical identity `(scope, basis, series identity, reporting date)`:

| Class | Condition | Effect | Authorization |
|---|---|---|---|
| `UNCHANGED` | Production row exists, normalized state identical | nothing written | — |
| `NEW` | Production row **absent**, date **newer** than the endpoint | insertion | none |
| `GAP_FILL` | Production row **absent**, date **at or below** the endpoint | insertion | none |
| `CHANGED` | Production row exists, workbook states a different value/status | overwrite | **required, with a non-empty reason** |
| `INVALID` | the observation cannot be interpreted safely | blocks the import | — |

**`GAP_FILL` is an insertion; `CHANGED` is an overwrite.** Only an overwrite needs authorization —
nothing is being replaced by an insertion, so there is no honest correction reason to write. Neither
the number of weeks arriving nor a date sitting below the endpoint is the test. **The test is whether
the canonical Production identity already exists.**

`INVALID` is a classification, not a silent drop: dropping an uninterpretable observation would
shorten the history the workbook actually states.

### AE.5 Explicit `unavailable` is not missing

A Production row whose status is `unavailable` is an **existing historical state**, not a hole. A
workbook that now supplies a number for it is *overwriting* that state — `CHANGED`, with the
authorization that implies — never `GAP_FILL`. `GAP_FILL` applies only when the canonical identity is
**genuinely absent**.

A contradiction (a `stated` row with no finite number, an `unavailable` row carrying one) is
`INVALID`. Guessing which half the source meant is how a fabricated figure gets in.

**One caveat, and it is a real one.** `portfolio_evolution_observations.value` is `NOT NULL` by
deliberate R13.R1 design — that table models a gap as an *absent row* and cannot store an explicit
`unavailable`. So for the evolution series the AE.5 case cannot currently arise, and a week that was
unreadable when first imported and is later repaired classifies as `GAP_FILL` (no authorization)
rather than `CHANGED`. The planner implements the full semantics regardless, because snapshot rows
*do* carry `unavailable` via `value_class`, and the RPC refuses `new_status = 'unavailable'` loudly
rather than coercing it into a numeric column. Whether the evolution series should start carrying
explicit `unavailable` states would reverse an explicit R13.R1 decision, so it is flagged here rather
than decided.

### AE.6 Preview

The three groups are listed **separately**, never merged into one count:

```
Current Production endpoint:  2026-08-21
Gap fills:                    2026-08-14
New reporting dates:          2026-08-28
Historical corrections:       none
→ normal Confirm allowed
```

With an overwrite present, that block becomes `2026-08-07: before X → after Y`, and the correction
reason and authorization are required **for that point only**. Cadence gaps and invalid points get
their own lines.

### AE.7 Atomic import identity — the schema change

`20260821000000_portfolio_import_operations.sql`, forward-only and additive. The shipped schema
could not express any of the above: `portfolio_evolution_observations` records only
`source_upload_id`, keeps no before-image, and is written by a chunked best-effort upsert *after* the
publication commits; `nmi_rollback_publication` never touches it and is scoped to one
`(kind, as_of_date)` series.

The smallest change that fixes it is two tables and one column:

1. **`portfolio_import_operations`** — the durable identity of one import: the upload, the
   publication it made current, the publication it displaced, the counts, and the correction
   authorization and reason (a CHECK makes an authorized correction without a reason impossible).
2. **`portfolio_import_observation_mutations`** — a per-identity **before-image**. An insertion
   records no prior state (that *is* the record that it was an insertion); an overwrite records the
   exact prior value, status, and the import that previously owned the row.
3. **`portfolio_evolution_observations.import_operation_id`** — forward lineage. Not strictly needed
   to reverse an import, but it is what lets a rollback **refuse** when a later import has already
   moved a row on. Without it a stale rollback would silently clobber the newer import's work.

`nmi_import_portfolio_workbook` does the whole thing in one transaction, under a single
`nmi_lock_portfolio_import` advisory lock (the publication lock is per-date and an import spans many
dates). It **delegates the publication verbatim** to `nmi_publish_portfolio` rather than
reimplementing the insert-non-current → fill → demote → promote ordering, which took a production
failure to get right. And it **asserts its own pre-state**, exactly as the structured-notes
reconciliation RPC does: every mutation states what it believes Production holds, the function
verifies it under lock, and the before-image it writes is the one it **read**, never the one the
caller supplied. A plan built against state that has since moved is refused whole.

Rollback never matches on a date, a filename or an upload id. Every reversal is driven by the
canonical identity recorded against a specific import id.

### AE.8 Rollback semantics

| Class | Rollback |
|---|---|
| `NEW` | the inserted observation is removed |
| `GAP_FILL` | the inserted observation is removed |
| `CHANGED` | the exact prior value, status **and owning import** are restored |
| `UNCHANGED` | nothing |
| Current publication | demoted; the displaced publication is promoted, or none when there was none |

All of it atomically. Restoring the prior *owning import* is what lets rollbacks chain: reverse
import B, and import A can still be reversed afterwards.

**One narrow deletion, deliberately.** R13's standing rule is that a publication is never deleted,
and this migration keeps that — a rollback demotes and re-promotes. But the inverse of *inserting* a
history point is *removing* it, so rolling back a `NEW` or `GAP_FILL` observation does delete that
row. Nothing is lost from the audit trail: the mutation ledger retains the identity, the value and
the import that wrote it, permanently.

### AE.9 What was built

* `src/lib/familyPortfolio/weeklyImportPlan.ts` — pure, no server import.
  `planWeeklyImport` classifies every identity, enumerates the three Preview groups separately,
  measures cadence over the **post-import** sequence (so a gap this import fills stops being
  reported), and writes only what actually changes — which also closes G3's ~500-row silent rewrite.
  `applyImportPlan`/`rollbackImport` are the **reference semantics**, not the write: they make the
  all-or-nothing property provable without a database and give the RPC a specification to be tested
  against.
* `tests/portfolioWeeklyImportPlan.test.ts` — 45 tests covering the owner's cases A–H verbatim.
* `supabase/tests/database/portfolio_import_operations_test.sql` — the executable half, with a
  deliberately **late** failure (three observations, an operation row and a publication already
  written before the fourth entry raises) and a chained-rollback case.
* `tests/portfolioImportOperations.test.ts` — 33 structural guards on the migration's posture.

### AE.10 What is proven, and what is not

Proven now: the classification, the Preview grouping, the insertion/overwrite split, the
publication-date choice, and the apply/rollback semantics at the model level — non-vacuously, by four
independent deliberate breaks (treating a gap fill as a correction fails 21 tests; treating an
explicit `unavailable` as absent fails 4; forgetting to restore status on rollback fails 1;
publishing the newest *new* week instead of the newest *valid* week fails 3).

**The SQL is now proven.** The isolated-stack workflow ran on the exact commit, applied the full
migration chain from a clean database and executed every pgTAP suite: `Files=10, Tests=791,
Result: PASS`, with `20260821000000_portfolio_import_operations.sql` applied and
`portfolio_import_operations_test.sql` reported `ok`. Non-vacuity was established on a throwaway
branch carrying two deliberate breaks — turning the insertion-over-existing-identity refusal into a
`continue`, and neutralising the forward-lineage check in rollback. **14 of that suite's 49 tests
failed**, including *"a packet whose LAST entry fails still raises"*, *"the three observations written
BEFORE the failure did not persist"*, *"no import operation row survived the failed packet"*, *"a
stale rollback is refused, not attempted"* and the three chained-rollback assertions. The probe
branch was deleted; its run remains in Actions as the evidence.

### AE.11 The administrator workflow (G1), delivered

* **The front door posts to the EXISTING route.** `POST /api/family-portfolio/admin/uploads` already
  runs the whole validation ladder — capability before a byte of the body, a Content-Length screen
  before `formData()` materialises the workbook, the authoritative `file.size` bound, the digest, the
  content checks and duplicate detection. A parallel endpoint would have had to reimplement all of
  it, so none was created.
* **Frozen-column selection moved into the application path.** This is the defect R13.8A could only
  describe: `loadDraft` called `parseResumen(bytes)`, and that default selects `detection.live` — the
  `=TODAY()` Bloomberg column. The shipped path was therefore implicitly publishing off the live
  column. It now calls `parseAtFrozenPublicationColumn`, which picks the newest frozen column whose
  FULL parse is clean. **No letter is hard-coded**: against the real reference workbook the selector
  derives `CZ` / 2026-07-31 on its own, while reporting the live column `DE` / 2026-08-11 as a
  diagnostic that is never published.
* **One preview function, two requests.** `planImportForDraft` is called by the preview route and
  again by the confirm route, so the two cannot disagree about what Production currently holds.
* **The confirmation carries a decision and a fingerprint, nothing else.** No row, value, date,
  classification or before-image travels from the browser. `planFingerprint` digests every assertion
  the plan makes about Production; if any of them has moved, confirm is refused as `plan_stale` — and
  the RPC's own under-lock pre-state check is the second, independent layer.
* **Confirm applies through `nmi_import_portfolio_workbook` and nothing else.** The R13.R1
  post-commit, chunked, best-effort evolution upsert is **gone from the publish path**. It remains
  exported for the standalone historical backfill, which runs outside any publication.
* **Rollback gained its own route**, `POST /api/family-portfolio/admin/imports/[id]/rollback`, beside
  the publication rollback rather than replacing it: the publication rollback is still correct for an
  alternatives publication and for any portfolio publication no import owns, and moving one
  `is_current` pointer reverses none of a five-point catch-up.

### AE.12 What is still NOT proven

**No real workbook newer than 2026-07-31 exists.** Against Production the reference workbook
classifies `nothing_to_append` — 102 unchanged weeks, zero new, zero gap fills, zero corrections —
which is the correct answer, and is also why the catch-up path has never run on real data. Every
catch-up case is proven on synthetic workbooks and in pgTAP, not on a genuine newer week.

That same run is the strongest available evidence for the frozen-column rule: had the live column
been selected, its cached `2026-08-11` header would have been proposed as a NEW week — a week the
source never froze. The planner proposes nothing.

**The migration has not been applied to Production.** A read-only probe confirms
`portfolio_import_operations` is absent there (PGRST205). Nothing in R13.8B has touched Production.

R13.8B is therefore **IMPLEMENTATION COMPLETE — AWAITING REAL NEW-WEEK E2E**. The first genuinely
newer workbook must be run through upload → preview → classification → expected packet before any
Production release is authorized.

### AE.13 R13.8C — the owner preview (presentation only)

R13.8C changed **how the administrator sees** the R13.8B workflow and nothing about what it does.
Workbook semantics, the NEW / GAP_FILL / CHANGED classification, frozen-column selection, the atomic
import RPC, rollback lineage, authorization and the correction-reason rule are byte-for-byte the
R13.8B code paths; every R13.8B test still runs against them.

**Where the Preview comes from.** The repository is linked to the Vercel project
`nevada-market-intelligence` through the GitHub integration (`.vercel/repo.json`, untracked). Every
push of a branch produces a Preview deployment and a GitHub *Deployment* record whose status carries
the URL — there is no Vercel CLI on the workstation and none is needed:

```
gh api "repos/{owner}/{repo}/deployments?ref=<sha>&environment=Preview" --jq '.[0].id'
gh api "repos/{owner}/{repo}/deployments/<id>/statuses" --jq '.[0].environment_url'
```

The Preview runs against the **same Supabase project as Production** (there is one project). Reading
the console there is a Production read; **uploading a real workbook through the Preview would be a
Production write** (`portfolio_source_uploads` + storage), and confirming would fail because
`20260821000000` is not applied there. Until the migration is released, the Preview is for looking,
and the synthetic states below are what to look at.

**Synthetic review states (§ 12).** `src/lib/familyPortfolio/fixtures/importPreviewFixtures.ts`
defines seven fixed upload ids (`00000000-0000-4000-8000-0000000f1c0a` … `…f1c10`) — A no changes ·
B one new week · C three-week catch-up · D gap fill + new · E historical change · F mixed · G
validation failure — plus two ledger rows (an active catch-up and a reversed correction). Each state
is a set of synthetic `SeriesObservation`s run through the **real** `planWeeklyImport` and mapped by
the **real** `previewFromPlan` (split out of `buildWeeklyImportPreview` for exactly this reuse); the
fixture module never assigns a disposition. The gate is `reviewFixturesEnabled()` in
`src/lib/reviewFixtures.ts`, shared with the Structured Notes called-state fixture and closed when
`VERCEL_ENV === 'production'`. The console index and the per-upload GET serve fixtures only after the
administrator check; the publish and import-rollback routes refuse a fixture id with
`read_only_fixture` before reading a body. On Preview the fixtures appear at the end of the uploads
table, every filename beginning `FIXTURE-`, status `review_fixture`.

**What the console now says.** `ImportPlanPreview` (`src/components/familyPortfolio/`) composes the
plan in order of consequence: a one-line **verdict** ("3 new weeks will be stored. All 3 weeks are
added to the history; 2026-08-21 becomes the current publication."), the **publication facts**
(current endpoint · new publication · newest frozen week · publication source = *Frozen weekly
snapshot*) with the live column reported on a non-interactive diagnostic line marked *Not used for
publication*, then **New weeks** and **Gap fills** as separate cards (every date a chip; the one that
becomes current says so in words; the gap-fill copy reads "insertions, not overwrites — normal
confirmation remains available"), then — only when an identity is overwritten — a visibly stronger
**Historical correction required** card holding the before/after table (scope · date · metric ·
current value · workbook value · change), the authorization checkbox, the reason field and the
*Apply historical correction* button, so the reason is never below unrelated metadata. Warnings
follow; unchanged count, cadence gaps and workbook metadata are folded into a details block. The
normal *Publish* button is disabled whenever an overwrite is present and reads *Nothing to apply* for
`nothing_to_append`. Both rollbacks use the shared `DeleteButton`; the import ledger names each
import's source workbook and shows its NEW / GAP_FILL / CHANGED counts in their own tones.
`describeImportPlan` (`src/lib/familyPortfolio/importPlanPresentation.ts`) is the pure verdict
derivation, tested under Node in both languages.

**Observed, not changed.** The server still accepts a confirmation for a `nothing_to_append` plan:
`nmi_import_portfolio_workbook` has no zero-observation guard, so such a request would create a new
revision of the same week with an empty history packet (the R13.5 re-publication semantic). The
console never offers it. Whether the RPC should refuse it outright is an owner decision.

**Residual.** The ledger shows an import's as-of date, source workbook and counts, not the list of
dates it touched — the before-image ledger is not exposed by any read route yet. Spanish rendering is
covered by dictionary parity and the verdict tests, not by the headless-Chrome sweep (the language
provider reads `localStorage` only on the client).
