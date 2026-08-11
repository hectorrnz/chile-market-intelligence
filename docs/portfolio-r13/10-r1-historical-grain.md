# R13.R1 — RESUMEN historical inventory and grain determination

Answers §§ 7 and 8 of the R13.R1 instruction. Everything below was measured by
running the project's **own** `dateDetection` / `hierarchy` / `parseResumen`
modules against the private reference workbook
(`C:\projects\nmi-private-inputs\portfolio-r13\portfolio-source-reference.xlsx`,
read in place, never copied into this repository). **No private financial value
appears in this document** — only dates, counts, row identities and parse
outcomes.

---

## 1 · Historical column inventory (§ 7)

| Property | Value |
|---|---|
| Worksheet | `RESUMEN` (328 rows × 119 columns) |
| Header row | **5** (row 1 is the decoy that omits the Beginning-of-Year column — doc 02 § 3.3) |
| Historical week columns | **102** |
| Earliest observation | **2024-08-23** (column `C`) — matches the owner's confirmation |
| Latest historical observation | **2026-07-31** (column `CZ`) |
| Live column | `DE`, formula-driven, cached date 2026-08-11 — **excluded from history** |
| `Diferencia` column | `DB` — classified and never ingested (doc 02 § 4) |
| Duplicate dates | **none** |
| Out-of-order dates | **none** |
| Detection blocking findings | **none** |

**Cadence.** Consecutive-column day gaps: `7 × 87`, `6 × 6`, `8 × 6`, `4 × 1`,
`10 × 1`. Weekday census: **95 Friday**, 6 Thursday, 1 Monday. This is a weekly
Friday cadence with holiday-shifted weeks — consistent with the owner's
statement, and none of the gaps exceeds the contract's `MAX_WEEK_GAP_DAYS`
threshold, so no gap warning is raised.

**Per-year:** 2024 → 19 · 2025 → 52 · 2026 → 31.

**The two Main series.** Both are identified structurally, through the numeric
performance binding the parser already performs (doc 02 § 2.1, doc 04 § 4) —
never by matching a Spanish label:

| Basis | Bound row | Source row | Coverage across the 102 columns |
|---|---|---|---|
| `ex_chilean_equities` | `SUBTOTAL` | 83 | **102 / 102 numeric · 0 errors · 0 blanks** |
| `with_chilean_equities` | `TOTAL` | 87 | **102 / 102 numeric · 0 errors · 0 blanks** |

Personal terminal totals (`TOTAL JAIME` r150, `TOTAL ANDRÉS (DIRECTO)` r205,
`TOTAL PABLO (DIRECTO)` r262) are likewise 102/102, so a personal evolution
series would be source-backed. It is **not** ingested in R13.R1: no surface
consumes it, and § 9 asks only that personal series never be *invented*.

---

## 2 · Grain determination (§ 8) — **MIXED**

The two questions § 8 poses have different answers, and conflating them would
have produced either a fabricated history or an unnecessarily poor one.

### Total-level evolution — COMPLETE (Type A, fully available)

Both Main bases carry a real number in **every one of the 102 weeks**, with no
error literals and no blanks. The weekly evolution history is therefore entirely
source-backed from 2024-08-23 onward, with no gaps to fill and nothing to
interpolate.

### Full row-level snapshots — PRESENT IN THE SOURCE, PUBLISHABLE FOR 6 WEEKS

Row-level data physically exists for every historical week: each column parses
into ~195 rows across all four scopes, and 87–100 % of the 175 value-bearing
rows carry a number. But **only 6 of the 102 columns produce a CLEAN full
parse** under the validated R13.3 parser:

```
2026-06-26 (CU) · 2026-07-03 (CV) · 2026-07-10 (CW)
2026-07-17 (CX) · 2026-07-24 (CY) · 2026-07-31 (CZ)
```

The other 96 are refused, for three real and distinct reasons:

1. **`duplicate_row_key` (95 columns).** Row classification depends on whether a
   row carries a value *in the publication column* (doc 02 § 5.2: a labelled row
   with no value is a grouping label). A holding that did not yet exist in an
   older week is empty there, so it classifies as a `sociedad_header`, is pushed
   onto the container stack, and re-parents its neighbours — which collides two
   different source rows onto one `row_key`. Economic identity is genuinely not
   stable across the full history, and the parser fails closed rather than
   silently merging two rows in every week-over-week comparison.

2. **`ambiguous_performance_basis` (71 columns).** The source did not maintain
   its performance blocks historically. `with_chilean_equities` metrics exist in
   only 31 columns, and both Main bases together only from 2026-01-02. Without a
   stated weekly profit, `bindBlockToCandidate` has nothing to reconcile against
   and refuses to guess which total a block measures.

3. **`previous_week_not_found` (1 column).** The earliest column, 2024-08-23, has
   no predecessor. Inherent and correct.

**Row identity drift, measured.** Against the latest week's 195 keys:
2025-02-14 → 9 missing / 5 extra; 2026-01-30 → 4 missing / 2 extra;
2026-07-31 → 0 / 0.

### Consequences (§§ 9-11)

* **Portfolio Evolution** consumes the complete 102-week series — see
  `src/lib/familyPortfolio/resumen/evolutionHistory.ts` and migration
  `20260811000000_portfolio_evolution_history.sql`.
* **Historical publication backfill** covers exactly the 6 clean weeks
  (`scripts/admin/backfillPortfolioHistory.ts`). A week that does not parse
  cleanly is reported and skipped — never published with substituted values and
  never approximated from a neighbouring week.
* **Weekly Changes** stays publication-based and unchanged. With 6 published
  weeks it now has **5 comparable consecutive pairs**, so its waterfall, ranked
  movers, hierarchy contribution, full table and trend all render from real
  published data. Earlier weeks will only become available if the source's own
  historical completeness improves — the app will not manufacture them.

---

## 3 · What would change this verdict

Nothing in this repository. The limit is the workbook's own historical
completeness: 96 weeks lack either a stable row hierarchy or a stated
performance block. A future parser could plausibly widen coverage by resolving
row type from a week-independent signal rather than from value presence in the
publication column, but that is a change to validated financial semantics and is
explicitly out of R13.R1's scope.
