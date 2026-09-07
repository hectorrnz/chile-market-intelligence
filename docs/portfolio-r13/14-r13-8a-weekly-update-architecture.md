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
> **Amended by §AE (WORKBOOK HISTORY LEADS, locked).** One upload may carry several unpublished
> frozen weeks; all of them are imported, atomically, and none are ever invented.


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
> **Amended by §AE (WORKBOOK HISTORY LEADS, locked).** One upload may carry several unpublished
> frozen weeks; all of them are imported, atomically, and none are ever invented.


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
> **Amended by §AE (WORKBOOK HISTORY LEADS, locked).** One upload may carry several unpublished
> frozen weeks; all of them are imported, atomically, and none are ever invented.


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
> **Amended by §AE (WORKBOOK HISTORY LEADS, locked).** One upload may carry several unpublished
> frozen weeks; all of them are imported, atomically, and none are ever invented.


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

## AE. Amendment — WORKBOOK HISTORY LEADS (locked)

This section is an amendment recorded after A–AD were delivered. It states a rule the owner has
**locked**, and it supersedes the parts of §E, §I, §O and §P that quietly assumed one upload equals
one reporting week.

### AE.1 The rule

**Production history + all newer frozen workbook history = new Production history.**

The uploaded workbook is the authoritative source for the weekly historical sequence. If Production
ends at `2026-07-31` and the administrator misses two weeks, the next workbook carries frozen
columns for `2026-08-07`, `2026-08-14` and `2026-08-21`, and the importer **must append all three**.
Publishing only `2026-08-21` and discarding the two the operator missed is forbidden. The newest
frozen column becomes the current publication snapshot, but every valid unpublished frozen column
between Production's endpoint and that newest column is persisted in the **same import**.

### AE.2 The rule's other half — no synthetic gap filling

A reporting week exists because the source froze a column for it, **never because calendar time
passed**. If Production ends at `07-31` and the workbook carries `08-07` and `08-21` but no frozen
`08-14`, the importer appends exactly two weeks. It does not invent `08-14`, does not forward-fill
it, does not interpolate it, and does not copy either neighbour into it.

The absence surfaces in Preview as an **informational cadence gap**. A missing calendar week is an
observation about the source, not a `HISTORY_CONFLICT`.

| Situation | Required behaviour |
|---|---|
| Unpublished week **present** in the workbook | MUST be imported |
| Calendar week **not present** in the workbook | MUST NOT be invented |

### AE.3 Catch-up is not a correction

The two classes must never be conflated, and **counting weeks is the wrong test** for telling them
apart. The test is whether the reporting date **already exists in Production**.

* Reporting date **newer** than Production's endpoint → `NEW`. Appending three of these in one
  upload is `MULTI_WEEK_APPEND` — ordinary recurring behaviour. **No historical-correction
  authorization or reason is required**, however many weeks arrive at once.
* Reporting date **already in Production** whose value the workbook now states differently →
  `CHANGED`. That is a historical correction: it needs authorization and a recorded reason, because
  it changes a figure somebody has already been shown.

When both occur in one upload, the new weeks are still enumerated **separately** from the
correction, so the administrator sees exactly which of the two is being asked of them.

### AE.4 Atomicity and rollback

A catch-up either lands whole or not at all. `08-07` committed while `08-21` failed would leave the
chart showing a history no workbook ever stated. The latest snapshot and every newly discovered
historical week belong to **one import/revision transaction**, and a rollback of that import must
remove or restore **every** point it introduced or corrected — not merely the newest week.

**The current code violates both halves, and §I understated why.** `upsertEvolutionObservations` is
chunked at 250, runs *after* the publication commits, is explicitly documented as best-effort and
safe to re-run partially, and `nmi_rollback_publication` does not touch the observation series at
all. Worse for this rule specifically: `portfolio_evolution_observations` has **no publication or
revision linkage** — only `source_upload_id` — and stores no prior value, so the table as it stands
is physically incapable of rolling a three-week catch-up back. That is a schema change, not a code
change, and it belongs in R13.8B.

And rollback cannot simply be extended in place: `nmi_rollback_publication` derives its whole
lifecycle from ONE publication id and confines every read and write to that id’s `(kind, as_of_date)`
series. A catch-up creates one publication and N history points spanning N dates, so reversing it is
not a wider version of the existing rollback — it needs the import identity of AE.7.1 to know what
belonged to it.

### AE.5 Preview requirement

Preview must list every reporting date that will be added, so the administrator can see the workflow
is filling unpublished workbook history rather than jumping to the latest week:

```
Current Production endpoint:  2026-07-31
Workbook latest frozen date:  2026-08-21
New reporting dates detected: 2026-08-07, 2026-08-14, 2026-08-21
Action:                       Append 3 weekly snapshots
```

Corrections, backfills and cadence gaps are listed on their own lines, never folded into that count.

### AE.6 What was built for this amendment

`src/lib/familyPortfolio/weeklyImportPlan.ts` — a pure module, no server import, exporting
`planWeeklyImport`, `applyImportPlan`, `rollbackImport` and
`WEEKLY_IMPORT_PLAN_VERSION = 'r13.8a.weekly_import_plan.1'`.

It classifies every `(scope, basis, week)` as `new` / `unchanged` / `changed` / `historical_backfill`,
emits `newDates` / `changedDates` / `backfillDates` / `cadenceGaps` for Preview, and writes **only
what actually changes** — an unchanged week is not rewritten, which closes G3's ~500-row silent
rewrite as a side effect. `applyImportPlan` stages the whole plan and verifies it before committing
anything, returning the caller's own store object unchanged on failure; `rollbackImport` is its
exact inverse.

`applyImportPlan`/`rollbackImport` are **reference semantics, not the write**. They exist so the
all-or-nothing property is provable without a database and so R13.8B's RPC has a specification to be
tested against rather than a paragraph of prose.

`tests/portfolioWeeklyImportPlan.test.ts` — 32 tests covering the owner's cases A–G verbatim, plus
the standing invariants: no planned date exists that the workbook did not state; an unchanged
re-upload writes nothing; a malformed observation is refused rather than silently dropped; and no
scenario assumes one upload equals one reporting week.

Non-vacuity was demonstrated on two independent axes. Leaking partially-staged rows out of a failed
apply fails exactly the 2 atomicity tests. Classifying a multi-week append as a correction *by count*
fails 8 tests across C, D, F, G and the invariants — the correct blast radius, because that single
mistake blocks the entire catch-up path.

### AE.7 What R13.8B must now add

1. A `publication_id` (or import-revision) column on `portfolio_evolution_observations`, plus a
   prior-value record, so a catch-up can be rolled back as a unit.
2. A publish RPC that takes the whole plan — one publication plus N history points — inside the
   existing advisory-locked transaction, replacing the post-commit best-effort upsert.
3. `nmi_rollback_publication` extended to reverse that import's history points, closing §H's
   asymmetry for the multi-week case as well as the single-week one.
4. The Preview block of AE.5, wired to `planWeeklyImport`.

### AE.8 Two questions this amendment raises — owner decisions

**AE.8a — do intermediate catch-up weeks also become publications?** The rule says the newest frozen
column becomes the current publication snapshot and the intermediate weeks are "persisted". The
architecture already splits these cleanly: publications carry row-level weeks, `portfolio_evolution_observations`
carries the total-level series across every frozen column. I have implemented the natural reading —
**one publication (the newest) plus N history points** — because R13.R1 established that only the
most recent handful of columns produce a clean full-row parse anyway. If you want every clean
intermediate week to become its own publication revision, say so; it is a larger transaction and a
different Preview.

**AE.8b — a hole *below* Production's endpoint.** The locked rule names dates newer than the
endpoint (`NEW`) and dates already present (`CHANGED`/`UNCHANGED`). It does not name a date at or
below the endpoint that Production has **no row for** — Pablo's pre-join weeks are the benign case,
but a genuine mid-history hole the workbook now fills is not benign. I classify it separately as
`historical_backfill` and gate it behind the same authorization as a correction, on the reasoning
that it inserts a point into a period an administrator has already reviewed. If you would rather it
pass freely as a new week, that is a one-line change and a test flip.
