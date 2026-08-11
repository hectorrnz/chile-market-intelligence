# R13.R1.1 — Full historical snapshot normalization

Record of the census, the root causes, and the decisions taken. Written after the
work, from measurements against the private reference workbook read in place. No
private amount, label or holding name appears here.

Baseline: `93bb6b3` (R13.R1 complete). Parser `r13.r1.resumen.4` →
`r13.r1.1.resumen.5`.

---

## 1. The census before repair

Every one of the 102 historical columns was parsed independently through the real
parser. 6 produced a publishable snapshot; 96 were refused.

| Blocking code | Weeks |
|---|---|
| `duplicate_row_key` | 95 |
| `ambiguous_performance_basis` | 71 |
| `previous_week_not_found` | 1 |

| Combination | Weeks |
|---|---|
| `ambiguous_performance_basis` + `duplicate_row_key` | 71 |
| `duplicate_row_key` alone | 24 |
| clean | 6 |
| `previous_week_not_found` | 1 |

Two facts shaped everything that followed.

**The row universe never changed.** Every week produced exactly 195 rows, from the
same source rows carrying the same labels. Nothing was inserted, deleted, moved or
renamed across two years. What varied was only which cells carried values.

**Every failure category collapsed to four causes**, and all four were the parser
reading a legitimate portfolio-history event as a structural fault. None was a
defect in the workbook.

---

## 2. Root cause — `duplicate_row_key` (95 weeks)

`classifyRow` decided a row's TYPE from whether the cell in the **publication
column** was populated. Its terminal branch reads "a labelled row with no value is
a grouping label".

Three source rows carry the same fund name, one per holding sociedad. In a week
where each carries a value they classify as `individual_asset`, their keys include
their sociedad, and all three are distinct. In a week where the position did not
exist yet the cells are empty — so all three became `sociedad_header` CONTAINERS
directly under the asset class, and all three collapsed onto one key. The same
mechanism re-parented their neighbours.

Only **two distinct keys** ever collided, in exactly this shape.

**Fix (§ 9).** Row type is answered over EVERY date column in the sheet
(`rowCarriesValueAnywhere`), never the one being published. It is a property of the
source row, so it is identical for all 102 weeks and a week's own emptiness can
only change VALUES.

Measured after the fix: **195 identities, one identity set, 0 identities whose row
type or parentage varies across the history.**

---

## 3. Root cause — `ambiguous_performance_basis` (71 weeks, 85 findings)

Two distinct causes, both misdiagnosed as ambiguity.

**(a) An absent block, reported as ambiguous — 78 findings.** The block's LABEL
rows exist in every column, so a block the source had not started still reached the
binder with every metric cell empty. Binding needs a stated weekly profit, so it
returned null and the caller reported ambiguity. Main's second block carries no
figures at all before 2026 (70 weeks); one personal scope's block is unmaintained
in the first 8. Nothing was ambiguous — the series had not started.

**(b) Section aggregates competing as candidates — 3 findings.** Main carries FIVE
rows typed `portfolio_subtotal`/`portfolio_total`, of which only two are published
bases. `SUBTOTAL` = the spine aggregate + a privately-marked holding, so whenever
that holding is unchanged week-over-week — routine — the two rows have identical
weekly deltas, both reconcile, and the match is not unique.

This was also a latent correctness risk on the live path: had a section aggregate
ever reconciled ALONE, `basisFor` would have published it under the `ex_chilean_
equities` name — the wrong row under the right label. The ambiguity guard was the
only thing preventing it.

**Fixes (§ 8).** A block whose every metric is empty is ABSENT: skipped, `info`,
week publishes. `isPerformanceBasisCandidate` narrows the CANDIDATE SET to a
scope's genuine bases; personal scopes are unaffected and keep every total, since
doc 02 § 2.1 relies on reconciliation to choose between two of them. Basis
assignment itself is unchanged — still numeric reconciliation, never a label.

Verified: the `EX` basis binds uniquely to `SUBTOTAL` in every week; the two
candidates are numerically distinguishable in 101/101 comparable weeks.

---

## 4. Root cause — `previous_week_not_found` (1 week)

The earliest column on record has no predecessor and no earlier baseline in its own
year. That is the beginning of the record, not missing data.

**Fix (§ 11).** `resolveAnchors` resolves the earliest historical column with both
anchors null; every `previousValue`, `difference` and `beginningOfYearValue` is then
`unavailable` — never 0, never carried forward. The condition is deliberately "is
the earliest column in the sheet", not "has no prior", so a middle week that lost
its predecessor still blocks. It is also why the year-start week of any later year
keeps its own date as its baseline (a legitimate 0 % YTD) while the first week on
record does not: its year began before the record did.

---

## 5. The one week that could not be fully normalized

`2025-12-26` — the second Main block carries year-end YTD figures but **no weekly
profit**, so reconciliation is impossible and the block's basis cannot be
established. Its title names a portfolio, but promoting a title to a decider is
what doc 02 § 2.1 forbids.

The block is DROPPED with a `warning` (`performance_block_unbindable`) rather than
attributed on a guess, and the week publishes normally. Exactly **1 block-week of
509** has this shape (82 all-empty, 426 fully bindable).

Cost: two YTD figures for one basis in one week are not published. Nothing else is
affected — that week's 188 snapshot rows and its other basis are complete.

---

## 6. Snapshot model — what a week contains

ONE rule, applied to a fixed point: **a row that carries no value and has no
surviving descendant was not part of the portfolio that week, and is not part of its
snapshot.**

- An empty leaf is a position not yet held, or since sold. Emitting it as a blank
  row would state that the family held something worth nothing — and would have put
  nine blank fund rows into a 2024 Holdings table, the defect R13.R1 § 4 removed
  from the live one.
- A label container whose every child dropped out labels nothing.
- A valueless row that still has a surviving descendant is KEPT: it is load-bearing
  structure, and dropping it would orphan its children.
- **An error cell is not an absence** and is never pruned. It stays, `unavailable`.

That last point is what makes the comparison layer sound: a row MISSING from a
cleanly-published snapshot is DEFINITIVELY absent, never merely unknown.

Measured: row counts run 167 → 195 across the history (the portfolio growing), and
**no published row carries a null value except a pure label container.**

---

## 7. Canonical identity — why no new tables

§ 10 invited a canonical-node table plus a snapshot-row → node mapping table, and
asked for the smallest robust design the workbook actually supports.

The measurement settles it. `row_key` is the normalized label PATH, and after § 9 it
is provably column-invariant: **195 identities, the same set in every week, zero
row-type and zero parentage variance over 102 weeks.** It already IS the canonical
economic identity, and the schema already separates the two concerns:

- **source/snapshot identity** — `portfolio_snapshot_rows.id`, `publication_id`,
  `source_cell`, `metadata.sourceRow`: where a figure physically came from
- **canonical economic identity** — `(scope, row_key)`: which node it is, across weeks

A node table and a mapping table would add two tables and a resolution layer for
zero observed benefit. **No new migration was required and none was created.**

**Renames and moves (§§ 6, 7).** None occurs in the 102-week history — that is what
"one identity set for every week" means. So no alias mechanism was built: § 6
authorises one "only where source evidence supports equivalence", and there is
none. Instead the system FAILS VISIBLY if one ever appears:
`detectReclassifications` reports an economic name that left one parent and arrived
under another, for administrator review. It never merges — two sociedades genuinely
holding the same fund is the normal shape of this book, so an identical label across
parents is evidence of a possible move, never proof of one. An ambiguous pairing
(the label exits or arrives more than once) is deliberately NOT reported, because
choosing among several would be a guess.

---

## 8. Comparison contract (§§ 13, 14, 15)

Default behaviour is unchanged: a week against the immediately preceding PUBLISHED
week. `selectComparisonRange` adds an explicit FROM → TO range over any two
published weeks; both endpoints must be weeks the book holds (no nearest-date
substitution), and `from` must be strictly earlier than `to`.

The mode is carried, not inferred from the gap, and the surface titles itself from
it — a multi-week range is never called a Weekly Change.

**Union semantics.** Confirmed absent → present is a New Position against zero;
present → confirmed absent is an Exited Position to zero; a row PRESENT with an
unusable value stays `unavailable` and is never converted. A new position has no
percentage change — an opening zero would make it an artefact, so the dollar change
carries it.

**Withheld over a range.** The source's `flow`, `weekly_profit` and `weekly_return`
describe ONE week; over a range they answer a different question, since the
intervening weeks' flows are nowhere in the payload. They are suppressed and the
surface says so. The value change itself is derived from the two snapshots and is
correct over any span.

**Reconciliation, measured against the live published data:**

| Comparison | Waterfall | Unavailable drivers | Relative residual |
|---|---|---|---|
| weekly (latest pair) | complete | 0 | 0 |
| custom, full history | complete | 0 | 0 |
| custom, ~1 year | complete | 0 | 2.6e-16 |

The full-history comparison spans 48 → 66 Main rows with 12 new positions, and ties
exactly. Before this stage it was impossible: only 6 weeks existed, and one-sided
rows forced a partial waterfall.

---

## 9. Backfill result

All **102** weeks published through the real `nmi_publish_portfolio` transaction —
96 new, 6 re-published at the new parser version. `published 102 · skipped 0 ·
failed 0`. A second run: `published 0 · skipped 102 · failed 0`.

Live state: 102 current publications spanning the full record, all at
`r13.r1.1.resumen.5`, 6 at revision > 1 with the superseded revisions retained;
20,149 snapshot rows; 2,310 performance rows; 204 evolution observations.

---

## 10. Future uploads (§ 17)

A new investment, a new asset class, a new sociedad holding or a disposal is a DATA
event and needs no parser change: row type is decided over every date column, so a
row whose only value is in the newest column is a leaf in every week, including the
ones before it existed.

An unknown structural DIALECT remains a separate, blocking concern
(`ambiguous_hierarchy_row`, `duplicate_row_key` for a true collision under one
parent). The two are deliberately not conflated.
