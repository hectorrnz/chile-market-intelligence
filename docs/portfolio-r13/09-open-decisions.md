# R13.0 · Document 09 — Open Decisions

**Phase:** R13.0 — documentation only.

This document lists **only** decisions that could not be resolved by inspecting the repository, the
workbook, the reference PDFs, existing source definitions, or the existing NMI architecture.

Anything resolvable by inspection was resolved and is recorded in documents 01–08 as a
recommendation, not surfaced here. Design preferences on which I hold a defensible view were decided
and documented (see § "Decided, not open" below) rather than deferred.

---

> **Route naming is no longer open.** It was resolved during R13.0 closure: the module is
> **Family Portfolio** under `/family-portfolio`, and the existing `/portfolio` Chilean-equities
> domain is untouched. See `05-authorization-and-data-architecture.md` § 7 and the
> "Decided, not open" table below.

---

## D1 · Whether the existing personal `/portfolio` module is still in use

**Why it is genuinely open.** The repository proves the module exists and works; it cannot prove
whether anyone uses it.

**Why it still matters now that routing is settled.** It no longer blocks any stage — `/portfolio`
is retained regardless. It affects only how much effort Stage 11's regression smoke-test deserves,
and whether the module warrants continued maintenance alongside Family Portfolio.

**Cannot be inspected.** Requires the user's knowledge of their own usage.

**Interim position:** treat it as in use. Stage 11 smoke-tests it explicitly.

---

## D2 · Sociedades appearing in Alternatives but not in the R13 scope model

**Why it is genuinely open.** The `Alternatives` sheet contains sociedades that are **not** among the
nine allocation entities and not obviously attributable to a portfolio scope:

- **`SAN ROQUE`** — holds positions in `Trinity Alps Venture Opportunities Fund II-B LP` and
  `V0 F1 LP`. It appears **only** in Alternatives; it has no row in `RESUMEN`'s portfolio sections.
- **`COVAL INMOBILIARIA`** and **`GARDENS`** — appear as sociedad headers inside Main's alternatives
  block in `RESUMEN`, so they are inside Main. Their standing is clear.
- **`STATEN`** — appears in Alternatives and in RESUMEN as `Staten Capital (1/3)` under Pablo.

**The open question:** does `SAN ROQUE` belong to Main, to a personal scope, to a fourth party, or to
none of the above? Shared Alternatives is visible to every principal, so misplacing it either leaks a
holding or hides one.

**Cannot be inspected.** The workbook states the sociedad but never its ownership.

**Interim position:** ingest `SAN ROQUE` with its stated sociedad and surface it under Shared
Alternatives (which all principals see) — the same treatment as every other alternatives row. Flag it
for confirmation before Stage 9 ships.

> **R13.9 status — OUTSTANDING RELEASE CONDITION.** Stage 9 shipped the interim position exactly:
> `SAN ROQUE` renders in shared Alternatives with **no special-cased code path anywhere** (pinned by
> `tests/familyPortfolioAlternatives.test.ts`), and no member-facing surface mentions the ownership
> question. The question itself is **not resolved**: SAN ROQUE ownership must be confirmed by the
> user **before the Stage-11 production release**. This paragraph is the durable release-control
> record of that condition — removing it without a recorded confirmation fails the R13.9 suite.

---

## D3 · `.xlsx` parsing — dependency-free reader vs a vetted library

**Why it is genuinely open.** This is a maintenance-and-supply-chain trade-off the repository
constrains but does not settle.

- The standing rule is "no third-party libraries unless they solve a specific, documented problem",
  and Phase 8C.2 set the precedent of writing a dependency-free ZIP reader rather than adding one.
- But `.xlsx` parsing is materially harder than the CMF XBRL case: shared strings, styles, theme +
  tint colour resolution, cached-vs-formula values, multiple date systems, and inline strings. R13.0
  needed roughly 200 lines of throwaway code to read it — and that code contained a **fail-silent
  defect** (doc 03 § 5) that produced an empty colour census with no error.
- Against that: the mainstream `.xlsx` libraries are large, and several have had security advisories;
  adding one to a family-office app that ingests a private financial workbook is not a small decision.

**Recommendation: write a scoped, dependency-free reader**, consistent with precedent, but treat the
style/colour parser as high-risk and require the count-assertion test in doc 03 § 5. The reader needs
only the subset R13 uses, which is well-bounded by documents 02 and 03.

**Why it is still listed:** it is a genuine architectural trade-off with a real defect history, and
the user may reasonably prefer a vetted dependency. It does not block R13.1 (Stage 1–2 do not parse).

---

## D4 · Whether a USD-equivalent alternatives total should ever be produced

**Why it is genuinely open.** The workbook's own USD roll-up is `#NAME?` because it depends on
Bloomberg FX (doc 03 § 4.1). NMI *could* produce one using an approved FX source — the repository
already has Frankfurter wired for the macro FX table — but that figure would be **NMI's number, not
the source's**, and it would not tie to the administrator's own spreadsheet.

**The question is one of preference, not capability:** is a clearly-labelled NMI-derived USD total
more useful than no total at all?

**Cannot be inspected.** Requires the user's judgement about which failure mode they prefer:
an absent total, or a total that will not match their workbook.

**Interim position:** ship per-currency subtotals only (doc 03 § 4.2). Do not build the USD-equivalent
view in R13.

---

## D5 · Retention and portability of the stored source workbooks

**Why it is genuinely open.** Doc 05 specifies private storage with opaque keys, but not **how long**
uploads are retained. A weekly upload of ~450 KB is ~23 MB/year — trivial in volume, but each file is
a complete private financial record, so retention is a governance question, not a capacity one.

**Sub-questions:** indefinite retention, or a rolling window? Is an administrator export of the raw
workbook required? Must a rolled-back publication's file be deleted or merely marked?

**Cannot be inspected.** No retention policy exists anywhere in the repository to extend.

**Interim position:** retain indefinitely (published snapshots are the product's memory; deleting the
source would break auditability), with an administrator-only signed-URL download. Revisit before
Stage 11.

---

## Decided, not open

Recorded here so they are visibly *decisions*, not oversights.

| Question | Decision | Where |
|---|---|---|
| **What is the R13 module called and where does it live?** | **Family Portfolio**, under `/family-portfolio` with routes `/portfolio`, `/weekly-changes`, `/alternatives`, `/admin` | 05 § 7 |
| **What happens to the existing `/portfolio` route?** | **Untouched** — separate Chilean-equities domain; not replaced, renamed, redirected, or merged | 01 § 2.3 · 05 § 7.3 |
| **Is `administrator` a portfolio-principal value?** | **No** — role and principal are two orthogonal dimensions; admin access derives from the role | 05 § 2.2 |
| **Which principal values exist?** | `jaime`, `andres`, `pablo`, `null` | 05 § 2.2 |
| **Is SQL↔TS authorization parity testing optional?** | **No** — mandatory in Stage 1 | 05 § 2.3 · 08 Stage 1 |
| **Are flows and profit bars in the asset-change waterfall?** | **No** — asset value changes already contain their effects; a separate total-level reconciliation carries them | 07 § 6e |
| **Treemap for the hierarchical chart?** | **No** — negative and positive changes need a common zero axis | 07 § 6g |
| **May top-five be reduced to top-three on mobile?** | **No** — top five is binding on desktop and mobile alike | 07 § 6f |
| Is the existing difference `31-07 − 24-07`? | **Yes** — formula- and numerically-verified | 04 § 2 |
| What is the new publication difference? | `06-08 − 31-07`, NMI-derived, never imported | 02 § 4 |
| Which header row is authoritative? | **Row 5** (row 1 is missing the BoY column) | 02 § 3.3 |
| How is the live date handled? | Read `TODAY()`'s **cached** value; propose, never auto-publish | 02 § 3.2 |
| Is Global Equity ACWI alone or an average? | **ACWI alone** — 80/80 vs 0/80 | 06 § 3.1 |
| What are SPX/EZU/URTH/EEM for? | Unused reference data; not surfaced | 06 § 3.2 |
| Highest defensible attribution level? | **Level 3 at portfolio total, Level 1 below it** | 07 § 3 |
| Should the tab be called "Performance Attribution"? | **No** — "Weekly Changes" | 07 § 4 |
| Should an unknown event colour block publication? | **No** — require classification when the cell has a non-zero value; silent when zero/empty | 03 § 3.4 |
| Should cash be ranked in weekly changes? | Excluded by default, visible toggle | 07 § 3.3 |
| Is a new market-data provider needed? | **No** — extend `yahooHistoryProvider` with a verified symbol map | 06 § 4.2 |
| Should R13 extend the existing portfolio tables? | **No** — separate domain, separate tables | 01 § 2.2 |
| Which column does each personal performance block measure? | Jaime 150, Andrés **207**, Pablo **266** — verified numerically | 02 § 2.1 |
| Should NMI recompute Excel's `IRR`? | **No** — ingest the cached value, label it source-provided | 03 § 4.1 |

---

## Out of scope — not open decisions

The following are **excluded from R13 by the approved source boundary** and must not be reopened as
open decisions:

- **`funds.xlsx`** — not part of R13. It is not added to the private reference folder, and no
  requirement derives from it.
- **Transaction-ledger ingestion** — no such path is added.
- **Security-level return attribution** — out of scope; the honest ceiling is documented in 07 § 3.
- **Historical price or transaction requirements** beyond the approved market data used by the
  generated Overview.

R13's approved inputs remain **RESUMEN**, **Alternatives**, approved NMI market data for the
generated Overview, and optional administrator commentary. The source contracts in documents 02–04
are unchanged by this closure.

---

## Acceptance criteria

- [x] Route naming removed — resolved and recorded in the decided table
- [x] Only decisions unresolvable by inspection are listed
- [x] No design preference deferred merely to avoid a recommendation — each open item states an interim position or a recommendation
- [x] Each open decision states why it cannot be resolved by inspection
- [x] Decisions that *were* resolved are recorded explicitly so they are not mistaken for gaps
- [x] Out-of-scope items recorded as excluded, not as open decisions
