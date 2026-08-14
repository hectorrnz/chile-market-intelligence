# 13 · R13.R2F1 — Weekly drawdown: future-pass plan

**Status: DEFERRED. Nothing in this document is implemented.**

Recorded during R13.R2F1 (the immediate visual refinement pass) at the owner's
direction: *"Do not implement the drawdown chart in this pass. Instead, prepare
the project for a later pass by documenting the correct future direction."*

It should be picked up **after the current Summary refinement is closed** —
i.e. after the Summary is approved, the two pending migrations are applied, and
the branch is committed. Starting it before then would reopen a surface that is
currently in owner review.

---

## 1 · What it is, stated honestly

A **real weekly drawdown chart**, not a proxy — but a chart of **weekly**
observations, because weekly observations are the only grain this book has.

The publication record is one observation per week (102 weeks for Main
Incl./Excl., Jaime and Andrés; 94 for Pablo). There is no daily portfolio
history and none is obtainable from the source workbook. So the module must be
labelled as a **weekly** drawdown and must never be presented as, or compared
against, a daily-resolution drawdown series.

Two consequences to state in the UI rather than leave the reader to infer:

- A trough that occurred **between** two Friday observations is invisible. The
  measured maximum drawdown is therefore a **lower bound** on the true intra-week
  maximum drawdown, not an estimate of it.
- Recovery dates are likewise resolved only to the week.

Both are honest limits of the source, not defects — but a drawdown chart that
does not say so invites the reader to treat it as a daily series.

## 2 · What it is computed FROM

**The existing flow-adjusted weekly evolution series** — the same stable series
the Portfolio Evolution card already plots, built once over the whole record by
`buildFlowAdjustedSeries` (`src/lib/familyPortfolio/flowAdjustedEvolution.ts`).

This is not a convenience; it is the only correct input. The raw published value
path moves when the family contributes or withdraws, so a raw drawdown would
report a **withdrawal as a loss** — precisely the distortion the flow adjustment
exists to remove. A contribution would likewise mask a real decline.

The series must be taken **already adjusted and already stable**, then sliced by
the range control — never re-adjusted per window (R13.R2E's stability rule;
adjusting after the window is chosen made the same calendar date carry different
values per range, measured at up to 13.80% of one portfolio's value).

Inputs it must NOT use: raw AUM, share counts, internal buy/sell activity, or
any daily market series as a stand-in.

## 3 · Formula

Running peak, then drawdown against it:

```
peak_t     = max(level_0 … level_t)          // running maximum, never reset
drawdown_t = (level_t / peak_t) - 1          // ≤ 0, expressed as a ratio
```

where `level_t` is the flow-adjusted level at observation *t*.

Notes that matter in implementation:

- `drawdown_0 = 0` by construction, and every point at a new high is `0`.
- Guard a non-positive `peak_t` → yield `null`, never `Infinity`/`NaN`. The
  existing modules' NaN/Infinity discipline applies unchanged.
- **Maximum drawdown** over a window is `min(drawdown_t)` across that window's
  own points — computed from the sliced series, so it agrees with what is drawn.
- The running peak is the peak of the **displayed** flow-adjusted path, which is
  exactly what `High Water Market` already means on the Evolution card. The two
  must be derived from one helper so they can never disagree; if the HWM says
  the peak was set on a given date, the drawdown series must read `0` there.

## 4 · Architecture

Follow the shape the module already uses:

- **A new pure module**, e.g. `src/lib/familyPortfolio/drawdown.ts` — no Next.js,
  Supabase, environment, filesystem or clock import; relative `./x.ts` imports so
  it loads under `node --test`. It takes the adjusted points and returns the
  drawdown series plus the maximum and its date.
- **No new API route, no new table, no migration.** Everything needed is already
  in the payload the Summary fetches; this is a derivation, not a data source.
- **A dedicated companion card**, not another band inside the Portfolio Evolution
  card. The evolution card already carries a heading, a flow-adjusted qualifier,
  a KPI pair, two control rails, a High Water Market disclosure and a chart;
  adding a second chart to it would produce exactly the card-inside-card
  fragmentation the owner has been removing across R13.R2.
- The companion card should **share the evolution card's range selection** so the
  two always describe the same window, and should reuse the same series tokens.
- Reuse `selectEvolutionRange` for slicing rather than writing a second windowing
  path.

## 5 · Presentation contract it inherits

- It is a **value-path** statistic. It is not a return, and § 18's terminology
  contract applies to every label on it.
- Amounts (if any are shown) go through `MaskedAmount`; a drawdown **ratio** is
  not a wealth figure and follows the same policy as returns.
- Both languages, EN and ES, from the dictionary — no inlined copy.
- Both themes, semantic tokens only.
- The chart is replaced wholesale when amounts are masked if it exposes any raw
  level; a pure ratio series does not, so decide this explicitly rather than
  copying the evolution card's branch without thought.
- Dates shown must be **real source observation dates** — no interpolation, no
  synthesised trough between observations.

## 6 · Tests the future pass should carry

- `drawdown_0 = 0`; a monotonically rising series is `0` throughout.
- A known synthetic peak-and-trough reproduces a hand-checkable maximum.
- The running peak never resets after a recovery below the prior high.
- A non-positive peak yields `null`, never `Infinity`/`NaN`.
- The maximum drawdown date and the High Water Market date agree with one
  another on the same series.
- Computed from the **flow-adjusted** series: a fixture whose raw path contains a
  large withdrawal must NOT report that withdrawal as a drawdown.
- Range slicing does not re-anchor the series (the R13.R2E stability property).
