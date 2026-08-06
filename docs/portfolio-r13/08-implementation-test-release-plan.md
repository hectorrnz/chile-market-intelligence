# R13.0 · Document 08 — Implementation, Test, and Release Plan

**Phase:** R13.0 — documentation only. Nothing below is implemented.

Each stage is narrow, independently reviewable, and ends in a green suite. **No stage prompts are
written here** — that is deliberately out of scope for R13.0.

---

## 0. Ground rules for every stage

1. **Documentation-only phases change no code; code phases change no documentation contract**
   without saying so explicitly and updating the relevant doc in the same change.
2. Every stage ends with `npm run lint` (0), `npm run build` (0 errors), `npm test` (all pass).
3. **No stage may weaken an existing guarantee** — the personal `/portfolio` module, `user_profiles`
   RLS, default-deny routing, and the Source Badge / `TableSourceFooter` conventions are untouchable.
4. **No private financial data enters the repository.** Fixtures are synthetic and structurally
   faithful, never real values.
5. Migrations are forward-only, idempotent, and carry in-migration postcondition assertions in the
   style of `20260730000000_user_profiles_admin_controlled_approval.sql`.
6. `database.types.ts` is updated in the same change as any migration that alters a table it declares.
7. R13 writes nothing to `src/data/` — that keeps the branch free of conflicts with the twice-daily
   data-refresh bot commits (audit § 5.2).
8. Verification against the real workbook happens **outside** the repository, read-only, with the
   temporary tooling deleted afterwards — the method used throughout R13.0.
9. **Source boundary.** R13's approved inputs are **RESUMEN**, **Alternatives**, approved NMI market
   data used by the generated Overview, and optional administrator commentary. No stage may add a
   transaction-ledger ingestion path, expand into security-level return attribution, introduce
   historical-price or transaction requirements, or alter the approved source contracts in docs 02–04.

---

## 0a. Model execution strategy

| Work | Model |
|---|---|
| Database, authorization, ingestion, parsing, reconciliation, security, release auditing | **the strongest reasoning and coding model** |
| Client-facing Overview, Portfolio, Weekly Changes, Alternatives, and Admin UI stages (6–9) | the **Fable model** available in Claude Code **may** be used for major visual composition, Fable-system alignment, responsive layout design, and interaction refinement |

**Boundaries on Fable-model use — binding:**

- The Fable model **must not** independently redefine source semantics, authorization, financial
  calculations, or database contracts.
- Architecture and data-integrity decisions remain controlled by the approved R13 documentation
  (docs 02–07). Where a UI need appears to conflict with a documented contract, the contract wins and
  the conflict is escalated, not resolved in the component.
- **A separate reasoning-model review must audit every Fable-generated UI change before release**,
  covering: entitlement handling, honest states, label compliance (doc 07 § 4.3), reconciliation and
  residual display, privacy masking, and source/freshness disclosure.
- The Fable model is **not** used for documentation phases, including this closure.

---

## Stage 1 — Database and entitlement foundation

**Goal.** Establish the **two orthogonal authorization dimensions** and prove they are enforced at
the database layer.

- Migration: add the portfolio-entitlement column (`portfolio_principal`, nullable, CHECK-constrained
  to `jaime | andres | pablo`) and the scope-resolution SQL helper taking **both** the administrative
  role and the principal. **`administrator` is not a principal value** (doc 05 § 2.2).
- Settle the physical shape of the administrative-role dimension against the repository (activate the
  existing `role` column, add a dedicated flag, or a separate table) — doc 05 § 2.2 deliberately
  leaves this open pending that inspection.
- Correct the pre-existing `database.types.ts` drift (`role`, `preferences`, `avatar_url` — audit § 3.3).
- Pure module `src/lib/portfolioAccess/entitlements.ts` taking `{ isAdministrator, principal }`.
- Extend `scripts/admin/provisionUser.ts` to set/clear the principal (service-role only).
- No R13 tables, no routes, no UI.

**Tests — SQL ↔ TypeScript authorization parity is mandatory, not optional.**
- Scope matrix over every `(isAdministrator, principal)` combination, including administrator with
  `principal = null` and non-administrator with `principal = null` (both fail-closed cases).
- Parity assertion comparing the SQL helper body in the migration against the TS module — identical
  scope sets for identical inputs.
- Assertion that no principal value can yield administrative capability, and that no administrative
  role depends on a principal value.
- Migration idempotency and postconditions; regression — existing `userProfilesRls.test.ts` and
  `accessControl.test.ts` pass unchanged.

**Acceptance.** A non-administrator with no principal resolves to **zero** scopes. An administrator
resolves to every scope **regardless of principal**. The matrix matches doc 05 § 2.3 exactly in both
languages.

**Risk.** Touching the app's authorization boundary. **Mitigation:** additive column only; the R1.5
policy and privilege posture are re-asserted, not modified.

---

## Stage 1a — Administrator bootstrap continuity + executable DB validation (R13.1.1A) ✅ committed

Added because Stage 1 as shipped had **no writer for `role`**, deadlocking the module (no
administrator could ever exist ⇒ no principal could ever be assigned).

- `scripts/admin/setUserRole.ts` — `--bootstrap` (legal only at zero approved administrators) and
  ordinary `--actor`-authorized changes; dry-run default; last-administrator protection;
  no self-role-change; writes only `role`; audits every applied change.
- `src/lib/portfolioAccess/roleAssignment.ts` — pure decision rules, executed directly in tests.
- **Narrow amendment to the unpushed R13.1 migration**: `actor_user_id` made nullable and
  `actor_kind` (`administrator | service_bootstrap`) added, CHECK-bound, so a bootstrap is recorded
  honestly instead of naming the target as its own actor. No second migration.
- `supabase/config.toml` — local/CI only; no project ref, no production URL, no credential.
- `supabase/tests/database/family_portfolio_entitlements_test.sql` — executable pgTAP.
- `.github/workflows/r13-family-portfolio-db-validation.yml` — hermetic, pinned CLI, no secrets.

**Validation boundary — binding.** Stage 1's guarantees are proven in two places, and only one of
them has run:

| Proven locally (executed) | Proven only by the workflow (NOT yet run) |
|---|---|
| TypeScript rule, role/principal decisions, all denial paths, structural assertions | migration application from clean, postconditions + in-database parity truth table, CHECK enforcement, SECURITY DEFINER behaviour, function privileges, `auth.uid()`, RLS, audit protection |

> **Creating the harness is not validation.** **R13.2 must not begin until
> `R13 Family Portfolio DB Validation` has actually run and passed on the committed branch.**
> Production credentials are never used by it.

---

## Stage 2 — Upload and storage foundation

**Goal.** Accept, validate, hash, and privately store a workbook. Parse nothing yet.

- Private bucket `portfolio-source-uploads`; service-role-only storage policies.
- Migration: `portfolio_source_uploads`, `portfolio_upload_findings`.
- `POST /api/family-portfolio/admin/uploads` — administrator-only; the full 13-check validation
  ladder (doc 05 § 4), including **macro-enabled rejection** and **XXE/`<!DOCTYPE>` rejection**.
- Hardened `.xlsx` container reader extending `unzip.ts`'s guards (entry-count ceiling added).
- Administrator-only signed-URL download, short TTL.

**Tests.** Each rejection path with a synthetic fixture (wrong MIME, `.xlsm`, oversized, non-ZIP,
traversal entry name, zip bomb, `<!DOCTYPE>` in a part, duplicate SHA-256). Non-administrator → 403.
Unauthenticated → 401. No raw content in any response or log. Storage policies deny `authenticated`.

**Acceptance.** A valid `.xlsx` is stored under an opaque key with a SHA-256 record; every invalid
input is refused with a structured code and no stack trace.

**Risk.** New attack surface. **Mitigation:** fail-closed ladder; in-memory only; nothing written to
the serverless filesystem.

---

## Stage 3 — RESUMEN parser and reconciliation

**Goal.** Turn Upload A into a validated draft. No publication yet.

- Pure `.xlsx` reader (shared strings, sheets, cells, cached values, styles). **Opening-tag-only
  `<xf>` matching with a count assertion** (doc 03 § 5).
- Semantic anchor + date detection (doc 02 § 3.4), incl. `TODAY()` cached-value handling and the
  row-1/row-5 precedence rule.
- Scope, hierarchy, and performance-block extraction with correct per-scope total binding.
- Required-cell error detection → blocking findings.
- NMI-derived difference (`thisWeek − previousWeek`); `Diferencia` used only as a cross-check.
- Independent recomputation of all four performance definitions as a cross-check.
- Migration: `portfolio_snapshot_rows`, `portfolio_performance_rows`, `portfolio_publications`.
- `parser_version` recorded on every upload.

**Tests.** Synthetic fixtures reproducing every verified structural fact: `TODAY()` live column;
row 1 missing the BoY column; an inserted row shifting anchors; duplicate/out-of-order dates; a
`#NAME?` in a required cell; a leaf with no BoY baseline; a sparse flow row; sociedad headers inside
a summed range. Golden-value tests asserting the four performance identities and the chain-linked
YTD. Assertion that Main ingests only Main's row range.

**Acceptance.** Against a synthetic workbook mirroring the sample's structure, the parser reproduces
every identity in doc 04 § 3–4 to < 1e-6, and blocks on the doc 04 § 5 error condition.

**Manual verification (outside the repo).** Run the parser against the real workbook read-only and
confirm it reproduces the doc 04 residuals and blocks the 06-08-2026 publication for the Main scope.

**Risk.** The parser is the correctness heart of R13. **Mitigation:** every rule in doc 02 traces to a
verified observation; each becomes a test.

---

## Stage 4 — Alternatives parser and colour normalisation

**Goal.** Turn Upload B into a validated draft.

- Master-data extraction with `(category, currency)` grouping.
- Monthly timeline detection; legend resolution at `DC1:DC3` (theme+tint → sRGB via `theme1.xml`,
  with the `theme="3" → dk2` mapping).
- Colour normalisation: exact → family (hue ±12°, nearest by ΔE) → unclassified.
- The uncoloured/unknown classification matrix (doc 03 § 3.4).
- Migration: `alternatives_holdings`, `alternatives_events`.
- Derived-column cross-checks (`F = D − E`, `J = I + H`); `L` ingested as a cached source value.

**Tests.** Theme-index mapping (the `theme3 = dk2` trap); tint/shade family matching; navy vs
medium-blue kept distinct; uncoloured zero → silent, uncoloured non-zero → requires classification;
unknown colour handling; missing legend → block; multi-currency grouping; `DC` legend/timeline
collision; the `<xf>` self-closing regression.

**Acceptance.** Against a synthetic sheet, all three event types classify correctly, the sign
convention holds, uncoloured non-zero cells surface for classification, and no cross-currency total
is produced.

---

## Stage 5 — Draft review and publication

**Goal.** Administrator preview → confirm → atomic publish, with revisions and rollback.

- Draft preview API + Admin UI: findings (blocking/warning), detected-date proposal, confirmation,
  manual override requiring a note.
- Atomic publication via a Postgres RPC (or the deferred `is_current` flip — doc 05 § 6).
- Same-date revision, supersession, rollback.
- Administrator commentary (optional, audited revisions).
- Independent Portfolio and Alternatives lifecycles.

**Tests.** Publication is atomic (a failure mid-write leaves no `is_current` rows); exactly one
`is_current` per `(kind, as_of_date)`; rollback restores a prior revision without deletion; override
without a note is refused; blocking findings prevent publication; non-administrator cannot publish.

**Acceptance.** A published week is immutable; a re-publish creates revision 2 and supersedes
revision 1; rollback restores revision 1; nothing is ever deleted.

---

## Stage 6 — Portfolio UI

- Module shell at **`/family-portfolio`** with navigation `Overview · Portfolio · Weekly Changes ·
  Alternatives · Admin`; `Admin` visible to administrators only.
- **`/family-portfolio/portfolio`** with the entitled scope selector.
- Hierarchical table, four dated columns, historical week selector, full history.
- Per-scope terminal structures preserved verbatim.
- Fable composition, privacy masking, dual-freshness badges, `TableSourceFooter`, EN/ES.

**Tests.** Scope selector renders only entitled scopes; the API omits unentitled scopes entirely
(not merely hidden); `Admin` navigation absent for a non-administrator **and** the route/API rejects
them server-side; responsive conventions (`responsiveLayout.test.ts` extension); footer convention;
i18n key parity; personal structures rendered without forced uniformity; **`/portfolio` (Chilean
equities) is untouched and still behaves identically.**

**Acceptance.** Jaime's session cannot obtain Andrés's data from any endpoint, verified by direct API
call, not by UI inspection.

---

## Stage 7 — Generated Overview (One Pager)

- Benchmark symbol **discovery and verification** first (doc 06 § 4.3) — `verified: false` until a
  live history fetch reproduces the workbook's own rows 77/78/79.
- `src/config/onePagerBenchmarks.ts`; weekly-close alignment with a 5-day lookback.
- Overview composition: hero, comparison, allocation (3 bases), two evolution charts, weekly results,
  market context, commentary, provisional disclaimer.

**Tests.** Benchmark arithmetic (ACWI alone; mean of AGGG/GHYG/CEMB; INRETC1 return) against fixtures
derived from the verified definitions; missing observation → `unavailable`, never carried forward;
allocation denominators; the mandatory disclaimer is present.

**Acceptance.** Every element of doc 06 § 5 renders or shows an honest `—`. No unverified symbol
publishes a number.

---

## Stage 8 — Weekly Changes (`/family-portfolio/weekly-changes`)

Implements doc 07 Part A2 (calculations) and Part A3 (visualizations), in the § 6h page order.

- Pure calculation module: `weekly_value_change`, `impact_on_portfolio_value`, node validity,
  parent/child reconciliation with the § 6d tolerance.
- Total-level weekly metrics; total-level **flow + investment-result reconciliation**.
- **Drivers of Weekly Portfolio Value Change** waterfall — driver set derived from the normalized
  hierarchy, never hardcoded; flows and profit deliberately **excluded** from this waterfall.
- **Largest Weekly Value Increases** / **Decreases** — up to five each, ranked by absolute dollar
  change, cash excluded by default with a visible toggle, `View All Changes` action.
- **Weekly Value Change by Portfolio Hierarchy** — drill-down diverging horizontal bars with
  breadcrumbs; Main and personal hierarchies; `Proportional Other Companies` and `Staten Capital`
  as explicit nodes.
- Full changes table; historical weekly-change trend; reconciliation status.
- Persistent methodology note.

**Tests.**
- Forbidden-vocabulary test — none of *Performance Attribution*, *Performance Contribution*,
  *Top Performance Contributors*, *Top Performance Detractors*, *Security Return Contribution*
  (or *contribution to return* / *attribution* / *alpha* / *selection effect* / *allocation effect* /
  *active return*) paired with a below-total row, **EN and ES**.
- `ΔValue = flow + profit` identity at total level.
- Ranking rules: absolute-dollar ordering; positive-only in increases and negative-only in decreases;
  zero changes excluded; subtotals excluded where leaves exist; **no parent and child in the same
  list**; fewer than five rows when fewer qualify; cash excluded by default.
- **Top five is preserved at every breakpoint** — a viewport-width test asserting the mobile render
  still carries five rows when five qualify.
- Waterfall reconciles `previous + Σ drivers = current` within tolerance; a forced mismatch surfaces a
  **visible residual** and a *partially reconciled* marker, and is **not** absorbed into an asset class.
- Hierarchy chart: sign-correct left/right extent; drill-down and breadcrumb round-trip; parent and
  child never in the same aggregate; child changes reconcile to parent; honest empty/unavailable.
- A single week selection drives **every** Weekly Changes component.

---

## Stage 9 — Alternatives UI

- Summary grouped by `(category, currency)`; commitment/unfunded; valuation with staleness; IRRs
  labelled source-provided; event timeline with the semantic legend; filters; unclassified-event
  surfacing; independent as-of.

**Tests.** No cross-currency total is rendered anywhere; legend colours resolve in light **and** dark;
event type carries a text label (never colour alone); staleness indicator; independent as-of.

---

## Stage 10 — Independent security and data-integrity audit

A dedicated review stage, not folded into feature work. **Performed by the reasoning model, not the
Fable model** (§ 0a).

- Attempt cross-principal access at the API layer for every R13 endpoint.
- Confirm RLS denies even with a forged `scope` parameter.
- Confirm administrative capability derives **only** from the role dimension, and that no principal
  value grants it.
- Confirm no service-role key reaches a client bundle.
- Confirm storage objects are unreachable without a server-minted signed URL.
- Re-verify no formula evaluation, no external-link resolution, no macro execution, no Bloomberg call.
- Re-verify no required-cell error can publish.
- **Audit every Fable-generated UI change** for entitlement handling, honest states, label compliance,
  reconciliation/residual display, privacy masking, and source/freshness disclosure.
- Confirm no private workbook, PDF, or real financial value is committed (extend the existing
  committed-secrets test to `.xlsx` and `docs/portfolio-r13/`).
- Confirm logs contain no financial values.

**Acceptance.** Every check passes, or the finding is fixed before Stage 11.

---

## Stage 11 — Production release and smoke testing

- Apply migrations via the Supabase CLI workflow (`migration list` → `db push --dry-run` → review →
  `db push`) — **never** by pasting SQL into the remote editor.
- Assign principals to the real users through `provisionUser.ts`.
- Deploy; smoke-test as each principal:
  - Jaime sees Main + Jaime + Alternatives; Andrés/Pablo endpoints return 403/omit.
  - Administrator sees every scope and every administrative control; `Admin` is absent for
    non-administrators **and** rejected server-side.
  - Administrator can upload, preview, publish, revise, roll back, and assign principals.
  - Overview renders with real benchmark data or honest `—`.
  - Weekly Changes: both reconciliations tie or show a visible residual; top-five panels hold five
    rows at 390 px.
  - Dark and light; EN and ES; 390 px through 1728 px with zero page-level horizontal overflow.
- **Confirm `/portfolio` (Chilean equities) is unchanged** — same route, same behaviour, no redirect.
- Confirm other existing surfaces are unaffected: `/watchlist`, `/structured-notes`, macro, market,
  `/api/health/ingestion`.

**Rollback.** Publication rollback is in-product (Stage 5). Schema rollback: the entitlement column
is additive and safe to leave; R13 tables can be left in place with the UI routes removed, since
nothing else reads them.

---

## Cross-cutting test additions

| Test | Asserts |
|---|---|
| `portfolioEntitlements.test.ts` | scope matrix over `(isAdministrator, principal)`; **SQL↔TS parity**; fail-closed on null; no principal grants admin |
| `portfolioUploadSecurity.test.ts` | the 13-check ladder; no content leakage |
| `resumenParser.test.ts` | anchors, dates, hierarchy, performance identities, error blocking |
| `alternativesParser.test.ts` | colours, theme mapping, classification matrix, currency grouping |
| `portfolioPublication.test.ts` | atomicity, revisions, rollback, immutability |
| `weeklyChanges.test.ts` | value-change and impact formulas; node validity; parent/child reconciliation tolerance; ranking rules; top-five at every breakpoint; waterfall residual behaviour |
| `portfolioAttributionLanguage.test.ts` | forbidden vocabulary, EN + ES |
| `portfolioPrivateDataHygiene.test.ts` | no `.xlsx`/private PDF committed; no real values in fixtures or docs; **no `funds.xlsx` anywhere** |
| `familyPortfolioRouteIsolation.test.ts` | `/portfolio` unchanged — not replaced, renamed, or redirected; no shared tables or repositories |
| extensions to `responsiveLayout.test.ts`, `tableSourceFooterConvention.test.ts`, `accessControl.test.ts` | existing conventions hold for new routes |

---

## Sequencing and dependencies

```
1 Entitlement ──► 2 Upload/Storage ──┬─► 3 RESUMEN parser ──┐
                                     └─► 4 Alternatives ────┴─► 5 Publication
5 ──► 6 Portfolio UI ──► 7 Overview
5 ──► 8 Weekly Changes
5 ──► 9 Alternatives UI
6,7,8,9 ──► 10 Security audit ──► 11 Release
```

Stages 3 and 4 are independent and may run in parallel. Stages 6–9 are independent once 5 lands.
Stage 10 must not begin until 6–9 are complete, and Stage 11 must not begin until 10 is clean.

---

## Acceptance criteria for this document

- [x] Work divided into narrow sequential stages
- [x] Database and entitlement foundation planned
- [x] Separate upload and storage foundation planned
- [x] RESUMEN parser and reconciliation planned
- [x] Alternatives parser and colour normalisation planned
- [x] Draft review and publication planned
- [x] Portfolio UI, generated Overview, Weekly Changes, Alternatives UI planned
- [x] Independent security and data-integrity audit planned as its own stage
- [x] Production release and smoke testing planned, with rollback
- [x] SQL↔TypeScript authorization parity tests required in Stage 1
- [x] Model execution strategy recorded, with binding limits on Fable-model use and a mandatory reasoning-model UI audit
- [x] Source boundary restated: RESUMEN + Alternatives + approved market data + optional commentary only
- [x] No stage prompts written
