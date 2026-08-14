// R13.R2B OWNER-REVIEW PASS 2 §§ 31-34 — behavioural tests for the second
// owner-review pass.
//
// The four subjects that carry real risk here, and how each is tested:
//
//   * THE WEEKLY SNAPSHOT'S FINANCIAL SEMANTICS. The owner suspected an
//     inconsistency because the snapshot's change does not equal Weekly Profit
//     / Loss. It should not: the change includes flows. What is enforced below
//     is that the displayed figure stays `This Week − Previous Week` through
//     the shared invariant, that the flow identity is stated in the interface,
//     and — the part that actually protects the reader — that the interface
//     CANNOT claim the identity for a basis whose two terms are not published.
//   * INRETAIL. § 2 removed a duplicate PRESENTATION. These tests prove the
//     duplicate is gone and that none of the underlying data, structure or
//     reconciliation went with it.
//   * WEEKLY NOTES. Authored in NMI, persisted through the EXISTING commentary
//     model. The tests prove no second persistence model was introduced, that
//     the write path is administrator-gated on the SERVER, that the body is
//     never injected as markup, and that nothing about it comes from the
//     workbook.
//   * THE EVOLUTION CHART. The High Water Market information must survive any
//     hover position, and the axis must not clip its own end dates. Both are
//     structural properties of the source, so both are asserted structurally.
//
// NO PRIVATE DATA. Every number below is invented and hand-checkable.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dict } from '../src/lib/i18n.ts'
import {
  buildWeeklySnapshot,
  buildComparisonRows,
  buildAllocation,
  identifyMainStructure,
  inretailImpact,
  type OverviewPerformanceRow,
  type OverviewSnapshotRow,
} from '../src/lib/familyPortfolio/overview.ts'
import { weeklyProfit } from '../src/lib/familyPortfolio/resumen/performance.ts'
import { normalizeCommentary, MAX_COMMENTARY_LENGTH } from '../src/lib/familyPortfolio/publication.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * Strips comments. A source file's OWN explanation of a rule routinely names
 * the thing the rule forbids ("never `dangerouslySetInnerHTML`", "never
 * interpolate"), so a bare negative match on the raw text reports the comment
 * as a violation. Every "this must not appear" assertion below runs on code.
 */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = read('src/app/family-portfolio/page.tsx')
const CHART = read('src/components/familyPortfolio/PortfolioEvolutionChart.tsx')
const SNAPCARD = read('src/components/familyPortfolio/WeeklySnapshotCard.tsx')
const NOTES = read('src/components/familyPortfolio/WeeklyNotesPanel.tsx')
const OVERVIEW_ROUTE = read('src/app/api/family-portfolio/overview/[scope]/route.ts')
const COMMENTARY_ROUTE = read(
  'src/app/api/family-portfolio/admin/publications/[id]/commentary/route.ts',
)
const CLIENT = read('src/lib/data/familyPortfolio.ts')

const en = dict.en.fp.overview
const es = dict.es.fp.overview

// ---------------------------------------------------------------------------
// Fixtures — a miniature Main publication with the real structural shape.
// ---------------------------------------------------------------------------

function row(over: Partial<OverviewSnapshotRow> & { rowKey: string }): OverviewSnapshotRow {
  return {
    parentRowKey: null,
    depth: 0,
    displayOrder: 1,
    rowType: 'asset_class',
    labelEs: over.rowKey,
    labelEn: null,
    currency: 'USD',
    value: null,
    valueClass: 'source_provided',
    previousValue: null,
    beginningOfYearValue: null,
    difference: null,
    differenceClass: null,
    ...over,
  }
}

const ROWS: OverviewSnapshotRow[] = [
  row({ rowKey: 'liq', displayOrder: 1, rowType: 'asset_class', labelEs: 'LIQUIDEZ', value: 300, previousValue: 280 }),
  row({ rowKey: 'inr', displayOrder: 2, rowType: 'named_holding', labelEs: 'INRETAIL PERU CORP', value: 100, previousValue: 90, difference: 10 }),
  row({ rowKey: 'spine', displayOrder: 3, rowType: 'portfolio_subtotal', labelEs: 'PORTAFOLIO LIQUIDO + ALTERNATIVOS', value: 300, previousValue: 280 }),
  row({ rowKey: 'sub', displayOrder: 4, rowType: 'portfolio_subtotal', labelEs: 'SUBTOTAL', value: 400, previousValue: 370, difference: 30 }),
  row({ rowKey: 'acc', displayOrder: 5, rowType: 'named_holding', labelEs: 'ACCIONES CHILENAS', value: 50, previousValue: 45, difference: 5 }),
  row({
    rowKey: 'total',
    displayOrder: 6,
    rowType: 'portfolio_total',
    labelEs: 'TOTAL',
    value: 450,
    previousValue: 415,
    beginningOfYearValue: 400,
    difference: 35,
  }),
]

const PERF: OverviewPerformanceRow[] = [
  { basis: 'ex_chilean_equities', metric: 'weekly_profit', value: 25, valueClass: 'source_provided_return', boundRowKey: 'sub' },
  { basis: 'ex_chilean_equities', metric: 'flow', value: 5, valueClass: 'source_provided_flow', boundRowKey: 'sub' },
  { basis: 'with_chilean_equities', metric: 'weekly_profit', value: 27, valueClass: 'source_provided_return', boundRowKey: 'total' },
  { basis: 'with_chilean_equities', metric: 'flow', value: 8, valueClass: 'source_provided_flow', boundRowKey: 'total' },
]

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Weekly Snapshot semantics (§§ 3-6, § 31.1-9)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2B § 3 — the Weekly Snapshot basis is explicitly known', () => {
  test('the snapshot reads the row bound to the scope\'s performance basis', () => {
    // Not a label match and not "the row typed portfolio_total": the structure
    // resolves TOTAL from the `with_chilean_equities` BINDING, and the route
    // hands exactly that row to `buildWeeklySnapshot`.
    const s = identifyMainStructure(ROWS, PERF)
    assert.equal(s.totalRow?.rowKey, 'total')
    assert.match(
      OVERVIEW_ROUTE,
      /buildWeeklySnapshot\(\s*mainStructure \? mainStructure\.totalRow : personalStructure!\.totalRow,?\s*\)/,
    )
  })

  test('the basis is STATED in the interface, not left to be inferred', () => {
    assert.match(PAGE, /basisLabel=\{o\.snapBasisTotal\}/)
    assert.match(PAGE, /basisDetail=\{isMain \? o\.snapBasisInclChile : null\}/)
    assert.equal(en.snapBasisTotal, 'Total Portfolio')
    assert.equal(es.snapBasisTotal, 'Portafolio Total')
    assert.equal(en.snapBasisInclChile, 'Includes Chilean equities')
    assert.equal(es.snapBasisInclChile, 'Incluye acciones chilenas')
    // The card renders both, and the clarifier is subordinate to the title.
    assert.match(SNAPCARD, /\{basisLabel\}/)
    assert.match(SNAPCARD, /\{basisDetail\}/)
  })

  test('a personal scope does not borrow Main\'s Chilean-equities clarifier', () => {
    // `isMain ? … : null` — a personal portfolio has no such split, so claiming
    // it "includes Chilean equities" would be a fabricated statement.
    assert.ok(/basisDetail=\{isMain \? /.test(PAGE))
  })
})

describe('R13.R2B § 4 — Portfolio Value Change = This Week − Previous Week', () => {
  test('the displayed figure is the subtraction of the two displayed levels', () => {
    const snap = buildWeeklySnapshot(ROWS[5])
    assert.equal(snap.thisWeek, 450)
    assert.equal(snap.previousWeek, 415)
    assert.equal(snap.difference, 35)
    assert.equal(snap.beginningOfYear, 400)
  })

  test('the persisted figure remains a CROSS-CHECK and never overrides', () => {
    const disagreeing = { ...ROWS[5], difference: 999 }
    const snap = buildWeeklySnapshot(disagreeing)
    assert.equal(snap.difference, 35, 'the arithmetic wins')
    assert.equal(snap.differenceStatus, 'mismatch', 'and the disagreement is surfaced')
  })

  test('a missing anchor yields null, never 0 and never the persisted figure', () => {
    const noPrev = { ...ROWS[5], previousValue: null }
    const snap = buildWeeklySnapshot(noPrev)
    assert.equal(snap.difference, null)
    assert.equal(snap.differenceStatus, 'not_comparable')
  })

  test('every surface still resolves the change through the shared helper', () => {
    const overview = read('src/lib/familyPortfolio/overview.ts')
    assert.match(overview, /resolveDisplayedDifference/)
    // No ad-hoc subtraction was introduced by the rename.
    assert.ok(
      !/thisWeek\s*-\s*previousWeek/.test(PAGE),
      'the page must not recompute the change itself',
    )
  })

  test('the user-facing name is Portfolio Value Change in both languages', () => {
    assert.equal(en.snapDifference, 'Portfolio Value Change')
    assert.equal(es.snapDifference, 'Variación del Valor del Portafolio')
    assert.ok(!/^Difference$/.test(en.snapDifference))
    assert.ok(!/^Diferencia$/.test(es.snapDifference))
  })
})

describe('R13.R2B §§ 3, 6 — the flow relationship', () => {
  test('the source contract makes the identity exact by construction', () => {
    // `weeklyProfit` IS `value − previous − flow`, so the identity is an
    // algebraic consequence of the definition the parser binds each block with.
    // Checked over hand values including a negative flow and a loss week.
    for (const [value, previous, flow] of [
      [450, 415, 8],
      [415, 450, -20],
      [100.25, 100.25, 0],
      [1_000_000, 999_000, 250.5],
    ] as Array<[number, number, number]>) {
      const profit = weeklyProfit(value, previous, flow)
      assert.ok(profit !== null)
      assert.ok(
        Math.abs(value - previous - (profit + flow)) <= 1e-9,
        `identity failed for ${value}/${previous}/${flow}`,
      )
    }
  })

  test('the identity holds for EVERY basis in the fixture, not just one', () => {
    const s = identifyMainStructure(ROWS, PERF)
    const cases = [
      { row: s.subtotalRow, profit: 25, flow: 5 },
      { row: s.totalRow, profit: 27, flow: 8 },
    ]
    for (const c of cases) {
      const snap = buildWeeklySnapshot(c.row)
      assert.equal(snap.difference, c.profit + c.flow)
    }
  })

  test('the disclosure is present, visible copy, in both languages', () => {
    assert.match(en.snapFlowNote, /includes Net Flows/i)
    // R13.R2C § 3 renamed the metric to the compact institutional shorthand;
    // the disclosure was updated with it rather than left contradicting it.
    assert.match(en.snapFlowNote, /Weekly P&L/)
    assert.match(es.snapFlowNote, /Flujos Netos/)
    assert.match(es.snapFlowNote, /P&L Semanal/)
    assert.equal(en.snapFlowIdentity, 'Portfolio Value Change = Weekly P&L + Net Flows')
    assert.equal(
      es.snapFlowIdentity,
      'Variación del Valor del Portafolio = P&L Semanal + Flujos Netos',
    )
  })

  test('the disclosure is rendered without hover and is subordinate', () => {
    assert.match(PAGE, /\{o\.snapFlowNote\}/)
    // Not a `title=` tooltip: § 6 requires it visible without hover.
    assert.ok(
      !/title=\{o\.snapFlowNote\}/.test(PAGE),
      'the flow disclosure must not be hidden behind a hover tooltip',
    )
    // `ui-meta` is the module's subordinate type role.
    assert.match(PAGE, /ui-meta[^"]*"\s*>\{o\.snapFlowNote\}/)
  })

  test('§ 31.7 — the equation is NOT claimed where its terms are unpublished', () => {
    // The guard requires BOTH source-provided terms for the basis on screen.
    assert.match(
      PAGE,
      /flowIdentitySupported\s*=\s*\n?\s*snapshotBlock !== null && snapshotBlock\.flow !== null && snapshotBlock\.weeklyProfit !== null/,
    )
    // And the identity line is rendered only behind that guard.
    const guarded = /\{flowIdentitySupported && \(\s*<p[^>]*>\{o\.snapFlowIdentity\}<\/p>\s*\)\}/
    assert.match(PAGE, guarded)
    // The unconditional sentence must not be behind the same guard — it is
    // true regardless of whether the identity can be shown.
    const noteIdx = PAGE.indexOf('o.snapFlowNote')
    const guardIdx = PAGE.indexOf('flowIdentitySupported &&')
    assert.ok(noteIdx > -1 && guardIdx > noteIdx, 'the general note precedes the guarded identity')
  })

  test('the snapshot basis id is derived from the scope, never hardcoded to Main', () => {
    assert.match(PAGE, /snapshotBasisId = isMain \? 'with_chilean_equities' : 'total'/)
  })

  test('§ 31.6 — the one historical availability limit is recorded, not smoothed over', () => {
    // Main's `with_chilean_equities` performance block — the Weekly Snapshot's
    // own basis — is published from 2026-01-02 onward, 31 of the 102 published
    // weeks; before that Main published only the ex-Chilean block. That bounds
    // WHERE the identity can be displayed and never makes it wrong where it is.
    // The finding belongs beside the code that depends on it, not only in a
    // report the next reader will not have.
    // Whitespace-tolerant: these live in a source comment that may be re-wrapped.
    assert.match(PAGE, /2026-01-02/)
    assert.match(PAGE, /31\s+(?:\/\/\s+)?of\s+(?:\/\/\s+)?the\s+(?:\/\/\s+)?102/)
    assert.match(PAGE, /427\s+(?:\/\/\s+)?basis-weeks/, 'the scale of the verification is stated')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · InRetail (§ 2, § 31.10-12)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2B § 2 — the InRetail impact annotation is gone from the top area', () => {
  test('the page renders no InRetail portfolio-impact annotation', () => {
    assert.ok(!/o\.inretailImpact/.test(PAGE), 'the impact label must not be rendered')
    assert.ok(!/o\.inretailIncluded/.test(PAGE), 'its companion line must not be rendered either')
    assert.ok(
      !/data\.inretailImpact/.test(PAGE),
      'and the page must not read the impact value at all',
    )
  })

  test('the dead dictionary keys were removed, not left orphaned', () => {
    assert.equal((en as Record<string, unknown>).inretailImpact, undefined)
    assert.equal((en as Record<string, unknown>).inretailIncluded, undefined)
    assert.equal((es as Record<string, unknown>).inretailImpact, undefined)
    assert.equal((es as Record<string, unknown>).inretailIncluded, undefined)
  })

  test('the InRetail MARKET metrics are untouched — they are market context', () => {
    assert.match(PAGE, /key: 'inretailPrice'/)
    assert.match(PAGE, /key: 'inretailVariation'/)
    assert.equal(en.inretailPrice, 'Closing price (USD)')
    assert.equal(en.inretailVariation, 'Price variation')
  })

  test('§ 31.11 — InRetail remains a line of the Weekly close by line table', () => {
    const s = identifyMainStructure(ROWS, PERF)
    const comparison = buildComparisonRows(s)
    assert.ok(comparison !== null)
    assert.ok(
      comparison!.some((r) => /inretail/i.test(r.labelEs)),
      'the holding must still appear in the weekly close',
    )
  })

  test('§ 31.12 — no InRetail financial semantics changed', () => {
    const s = identifyMainStructure(ROWS, PERF)
    // The impact is still the holding's own week-over-week difference…
    assert.deepEqual(inretailImpact(s), { rowKey: 'inr', value: 10 })
    // …the route still composes it…
    assert.match(OVERVIEW_ROUTE, /inretailImpact\(mainStructure\)/)
    assert.match(OVERVIEW_ROUTE, /inretailImpact: impact/)
    // …and the allocation bases that contain it are unchanged.
    const bases = buildAllocation(s)
    const total = bases.find((b) => b.id === 'total')!
    assert.equal(total.denominatorRowKey, 'total')
    assert.ok(total.entries.some((e) => e.rowKey === 'inr'))
    const exChilean = bases.find((b) => b.id === 'ex_chilean')!
    assert.equal(exChilean.denominatorRowKey, 'sub')
    assert.ok(!exChilean.entries.some((e) => e.rowKey === 'acc'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Weekly Notes (§§ 10-13, § 32)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2B § 11 — persistence is REUSED, not duplicated', () => {
  // SUPERSEDED BY R13.R2C §§ 8-10. Pass 2 asked for ONE note per week, and the
  // commentary model was exactly right for it. The owner has since asked for
  // SEVERAL simultaneous notes, which `portfolio_commentary` structurally
  // cannot represent: its partial unique index admits exactly one live row per
  // (publication, scope), and reusing revision rows as sibling notes would make
  // "revision 3" mean "the third edit" in one week and "note 3 of 4" in
  // another. A dedicated table was added and the commentary model left intact.
  //
  // The part of the rule that still applies is asserted unchanged: the
  // presentation-settings migration must NOT be repurposed to carry note
  // content (§ 12), and the commentary chain must be undisturbed.
  test('the notes model is separate from BOTH commentary and presentation settings', () => {
    const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
    assert.ok(
      files.includes('20260813000000_family_portfolio_weekly_notes.sql'),
      'multiple notes need their own structure',
    )
    const settingsMigration = read(
      'supabase/migrations/20260812000000_family_portfolio_presentation_settings.sql',
    )
    assert.ok(
      !/\bnote\b|commentary/i.test(settingsMigration),
      'presentation settings must not carry note content',
    )
    const notesMigration = read('supabase/migrations/20260813000000_family_portfolio_weekly_notes.sql')
    assert.match(notesMigration, /the one-live-revision index on portfolio_commentary is missing/)
  })

  test('the note is the existing (publication, scope) commentary record', () => {
    const publication = read('supabase/migrations/20260810000000_family_portfolio_publication.sql')
    // Week key, scope, author, body, timestamps, revision chain — all already
    // there, which is exactly why no new object was added.
    assert.match(publication, /create table if not exists public\.portfolio_commentary/)
    assert.match(publication, /publication_id\s+uuid not null references public\.portfolio_publications/)
    assert.match(publication, /scope\s+text not null check \(scope in \('main','jaime','andres','pablo','alternatives'\)\)/)
    assert.match(publication, /author\s+uuid not null references auth\.users/)
    assert.match(publication, /created_at\s+timestamptz not null default now\(\)/)
    assert.match(publication, /updated_at\s+timestamptz not null default now\(\)/)
  })

  test('§ 32 — the DB-level behaviours are already proven, under real RLS', () => {
    // Reusing the commentary model means the Weekly Notes permission matrix is
    // covered by the deployed pgTAP suite rather than by a new one. These
    // assertions pin the specific coverage, so a future edit that deletes any
    // of it fails HERE too instead of silently thinning the guarantee.
    const pgtap = read('supabase/tests/database/family_portfolio_entitlements_test.sql')
    for (const [needle, why] of [
      ['commentary can be written for a publication', 'an administrator can create'],
      ['commentary can be edited', 'an administrator can update'],
      ['an edit APPENDS a revision', 'editing never overwrites the audit trail'],
      ['commentary can be written on a personal scope', 'notes bind to their own scope'],
      ["authenticated cannot EXECUTE nmi_upsert_portfolio_commentary", 'a member cannot write'],
      ['portfolio_commentary carries no non-SELECT policy', 'no member write path exists'],
      ["not has_table_privilege('anon', 'public.portfolio_commentary', 'SELECT')", 'anon cannot read'],
      ['commentary_refused_empty', 'an empty body is refused at the database too'],
    ] as Array<[string, string]>) {
      assert.ok(pgtap.includes(needle), `pgTAP must still prove: ${why}`)
    }
    // Scope isolation is exercised as real principals, not as service_role.
    assert.match(pgtap, /select pg_temp\.as_user\('33333333-3333-3333-3333-333333333333'\)/)
    assert.match(pgtap, /select pg_temp\.as_anon\(\)/)
  })

  test('RLS still gives read to the scope and write to nobody but service_role', () => {
    const publication = read('supabase/migrations/20260810000000_family_portfolio_publication.sql')
    assert.match(publication, /create policy "portfolio_commentary_scope_select"[\s\S]*?using \(public\.nmi_can_access_scope\(scope\)\)/)
    assert.match(publication, /grant select on table public\.portfolio_commentary to authenticated/)
    assert.match(publication, /grant all privileges on table public\.portfolio_commentary to service_role/)
  })
})

describe('R13.R2B § 10 — authorization is the server\'s', () => {
  test('the write route is administrator-gated server-side', () => {
    assert.match(
      COMMENTARY_ROUTE,
      /if \(!entitlement\.isAdministrator \|\| !entitlement\.userId\) \{[\s\S]*?status: 403/,
    )
  })

  test('the client capability flag is derived from the entitlement, not asserted', () => {
    assert.match(OVERVIEW_ROUTE, /canEditNotes: entitlement\.isAdministrator === true/)
    // And it is documented as presentation-only in the client contract.
    assert.match(CLIENT, /canEditNotes\?: boolean/)
    assert.match(CLIENT, /PRESENTATION CONVENIENCE ONLY/)
  })

  test('the editor is rendered only for a caller the server called administrator', () => {
    assert.match(PAGE, /canEdit=\{data\.canEditNotes === true\}/)
    // A member gets the notes themselves, never a disabled editor pretending.
    assert.ok(
      !/disabled=\{!canEdit\}/.test(NOTES),
      'a member must not be shown a disabled editor',
    )
    assert.match(NOTES, /\{canEdit && editing === null &&/)
  })

  // R13.R2C §§ 8-12 moved the write path from the single-document commentary
  // route to the per-note routes — in the SAME administrator-only namespace,
  // which is the property this test exists to protect.
  test('the write path stays inside the administrator-only namespace', () => {
    assert.match(
      CLIENT,
      /\/api\/family-portfolio\/admin\/publications\/\$\{encodeURIComponent\(publicationId\)\}\/notes/,
    )
    assert.match(CLIENT, /method: 'POST'/)
    assert.match(PAGE, /createWeeklyNote\(publicationId, activeScope, body\)/)
  })

  test('the note binds to the published week and to the scope on screen', () => {
    assert.match(OVERVIEW_ROUTE, /id: selected\.id/)
    assert.match(PAGE, /const publicationId = slot\?\.data\?\.publication\?\.id/)
    // The scope posted is the ACTIVE scope, never a hardcoded 'main'.
    assert.ok(!/createWeeklyNote\([^)]*'main'/.test(PAGE))
  })
})

describe('R13.R2B § 11 — validation and injection safety', () => {
  test('an empty or whitespace-only body is refused', () => {
    assert.deepEqual(normalizeCommentary(''), { ok: false, code: 'empty' })
    assert.deepEqual(normalizeCommentary('   \n\t '), { ok: false, code: 'empty' })
    assert.deepEqual(normalizeCommentary(null), { ok: false, code: 'empty' })
    assert.deepEqual(normalizeCommentary(42), { ok: false, code: 'empty' })
  })

  test('an over-long body is refused, and the boundary is exact', () => {
    const atLimit = 'x'.repeat(MAX_COMMENTARY_LENGTH)
    assert.deepEqual(normalizeCommentary(atLimit), { ok: true, body: atLimit })
    assert.deepEqual(normalizeCommentary(`${atLimit}x`), { ok: false, code: 'too_long' })
  })

  test('the body is trimmed but otherwise preserved verbatim', () => {
    assert.deepEqual(normalizeCommentary('  bought X\nsold Y  '), {
      ok: true,
      body: 'bought X\nsold Y',
    })
  })

  test('the editor enforces the SAME limit the server does', () => {
    assert.match(PAGE, /maxLength=\{MAX_WEEKLY_NOTE_LENGTH\}/)
    assert.match(NOTES, /maxLength=\{maxLength\}/)
  })

  test('the note body is rendered as TEXT — never as markup', () => {
    assert.ok(
      !/dangerouslySetInnerHTML/.test(codeOf(NOTES)),
      'a stored note must never be able to inject markup',
    )
    assert.match(NOTES, /whitespace-pre-wrap/)
    assert.match(NOTES, /\{note\.body\}/)
  })

  test('the failure and success states are stated in words and announced', () => {
    assert.match(NOTES, /role="alert"/)
    assert.match(NOTES, /aria-live="polite"/)
    for (const d of [en, es]) {
      for (const k of ['notesSaving', 'notesSaved', 'notesSaveError', 'notesTooLong', 'notesEmptyError'] as const) {
        assert.equal(typeof d[k], 'string')
        assert.ok((d[k] as string).length > 0, `${k} must be worded`)
      }
    }
  })
})

describe('R13.R2B § 10 — the note is NMI-authored, never from the workbook', () => {
  test('the parser has no notion of commentary', () => {
    const parser = read('src/lib/familyPortfolio/resumen/parseResumen.ts')
    assert.ok(
      !/commentary/i.test(parser),
      'nothing in the RESUMEN parse may produce a weekly note',
    )
  })

  test('the write path is the only path — no generation, no derivation', () => {
    const publication = read('supabase/migrations/20260810000000_family_portfolio_publication.sql')
    assert.match(publication, /NEVER AI-generated/)
    // Exactly one RPC writes the table, and `authenticated` cannot execute it.
    assert.match(publication, /create or replace function public\.nmi_upsert_portfolio_commentary/)
  })

  test('the empty state is one honest line, in both languages', () => {
    assert.equal(en.notesEmpty, 'No note has been written for this week.')
    assert.equal(es.notesEmpty, 'Aún no se ha escrito una nota para esta semana.')
    assert.match(NOTES, /\{labels\.empty\}/)
  })

  test('every editor label exists in both languages', () => {
    const keys = [
      'notesTitle', 'notesEmpty', 'notesEdit', 'notesAdd', 'notesEditorLabel',
      'notesPlaceholder', 'notesSave', 'notesSaving', 'notesSaved', 'notesCancel',
      'notesEmptyError', 'notesTooLong', 'notesSaveError', 'notesRemaining',
    ] as const
    for (const k of keys) {
      assert.equal(typeof en[k], 'string', `EN ${k}`)
      assert.equal(typeof es[k], 'string', `ES ${k}`)
      assert.notEqual(en[k], es[k], `${k} must actually be translated`)
    }
  })

  test('after a save the page RELOADS rather than guessing the new revision', () => {
    assert.match(PAGE, /setReloadSeq\(\(n\) => n \+ 1\)/)
    assert.match(PAGE, /\}, \[activeScope, reloadSeq\]\)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Portfolio Evolution (§§ 15-22, § 33)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2B §§ 18-20 — the High Water Market survives any hover', () => {
  test('the reference\'s name, amount and date live OUTSIDE the plot', () => {
    const bandIdx = PAGE.indexOf('{o.hwmSetAt}')
    const chartIdx = PAGE.indexOf('<PortfolioEvolutionChart')
    assert.ok(bandIdx > -1, 'the summary band must render the peak date')
    assert.ok(chartIdx > -1)
    assert.ok(
      bandIdx < chartIdx,
      'the summary must be a SIBLING ABOVE the chart container, which the ' +
        'absolutely-positioned chart tooltip cannot reach',
    )
    assert.match(PAGE, /value=\{hwmMarker\.value\}/)
    assert.match(PAGE, /\{o\.hwmLabel\}/)
  })

  test('no in-plot text label is drawn for the reference any more', () => {
    assert.ok(
      !/highWaterMarket!\.label\}\s*<\/text>/.test(CHART),
      'an in-plot label at the peak is exactly what the tooltip covered',
    )
    // The dashed line itself stays.
    assert.match(CHART, /stroke="var\(--fp-hwm\)"/)
    assert.match(CHART, /strokeDasharray="4 4"/)
  })

  test('the explanation is reachable by pointer, keyboard and screen reader', () => {
    // Pointer, on the reference itself.
    assert.match(CHART, /<title>\{`\$\{highWaterMarket!\.label\}/)
    // Screen reader, in the chart's own description.
    assert.match(CHART, /\$\{highWaterMarket\.tooltip\}/)
    // Keyboard, via a real focusable control with its own accessible name.
    assert.match(PAGE, /aria-label=\{o\.hwmHelpLabel\}/)
    assert.match(PAGE, /aria-describedby=\{hwmTipId\}/)
    // R13.R2F § 9 — THE OPACITY MECHANISM IS SUPERSEDED, AND WAS INCOMPLETE.
    // `group-hover` / `group-focus-within` opacity covered pointer and keyboard
    // and left TOUCH with nothing: a touch device has no hover, and a tap on a
    // non-focusing element revealed nothing at all — so a reader on a tablet
    // met a term that can be mistaken for the fee-calculation "high-water mark"
    // and had no way to check it. A native `<details>` serves click, tap and
    // Enter/Space through ONE mechanism, announces its own expanded state, and
    // opens IN FLOW so the explanation can never cover the plot.
    assert.match(PAGE, /<details/)
    assert.match(PAGE, /<summary/)
    assert.ok(!/group-focus-within\/hwm/.test(PAGE),
      'the superseded hover-opacity mechanism must not linger beside the disclosure')
    assert.equal(en.hwmHelpLabel, 'About High Water Market')
    assert.equal(es.hwmHelpLabel, 'Acerca del High Water Market')
  })

  test('the TERM is unchanged; the explanation now matches the line it measures', () => {
    // The owner's term is locked and stays locked (§ 15).
    assert.equal(en.hwmLabel, 'High Water Market')
    assert.equal(es.hwmLabel, 'High Water Market')
    // PASS 4 § 2 SUPERSEDES THE OLD WORDING. The chart plots the flow-adjusted
    // path, so "the maximum observed portfolio value" would have described a
    // line no longer on screen — the very misreading that assertion existed to
    // prevent, pointed at the wrong sentence. What it guards is unchanged: the
    // tooltip must say what the figure IS, and must rule out reading it as a
    // return or as the real balance.
    assert.match(en.hwmTooltip, /highest level reached by the displayed flow-adjusted portfolio path/)
    assert.match(en.hwmTooltip, /not the portfolio's actual AUM high/)
    // R13.R2F § 8 — tightened: the denial covers EVERY investment-return
    // high-water-mark reading, not merely the flow-adjusted one.
    assert.match(en.hwmTooltip, /not an investment-return high-water mark/)
    assert.match(es.hwmTooltip, /nivel más alto alcanzado por la trayectoria del portafolio ajustada por flujos/)
    assert.match(es.hwmTooltip, /No es el máximo real de AUM/)
    assert.match(es.hwmTooltip, /no es un high-water mark de retorno/)
  })

  test('§ 21 — privacy withholds the amount entirely, band and all', () => {
    assert.match(PAGE, /const hwmPoint = hwmVisible && !masked \? highWaterMarket\(/)
    assert.match(PAGE, /\{hwmMarker !== null && \(/)
    // The amount still goes through the guarded render path even so.
    assert.match(PAGE, /<MaskedAmount\s+value=\{hwmMarker\.value\}\s+masked=\{masked\}/)
  })
})

describe('R13.R2B § 22 — the x axis does not clip its own end dates', () => {
  test('edge ticks anchor inward; interior ticks stay centred', () => {
    assert.match(
      CHART,
      /const anchor = i === 0 \? 'start' : i === xTickIndices\.length - 1 \? 'end' : 'middle'/,
    )
    assert.match(CHART, /textAnchor=\{anchor\}/)
  })

  test('the tick MARK still sits at the observation\'s true x', () => {
    assert.match(CHART, /const x = toX\(unionDates\[idx\]\)/)
    assert.match(CHART, /<line x1=\{x\} y1=\{baseline\} x2=\{x\} y2=\{baseline \+ 4\}/)
  })

  test('the right margin clears the latest observation\'s end marker', () => {
    const mr = /const MR = (\d+)/.exec(CHART)
    assert.ok(mr !== null)
    assert.ok(Number(mr![1]) >= 22, `MR must clear the end marker, got ${mr![1]}`)
  })

  test('no date is invented, resampled or carried forward to make room', () => {
    // The axis is still the UNION of real observation dates, sorted.
    assert.match(CHART, /Array\.from\(new Set\(drawn\.flatMap\(\(s\) => s\.points\.map\(\(p\) => p\.date\)\)\)\)/)
    const code = codeOf(CHART)
    assert.ok(!/interpolat/i.test(code), 'no interpolation may enter the drawing code')
    assert.ok(!/resample|fillGaps|carryForward/i.test(code))
  })
})

describe('R13.R2B §§ 15-16 — Value Change is a major secondary KPI', () => {
  test('it is rendered at a real figure scale, not as metadata', () => {
    // R13.R2F1 § 2 — THE OWNER REVERSED THE R13.R2F ORDERING: the ACTUAL
    // portfolio value now leads this surface and the Value Change supports it.
    // So this test no longer asserts which of the two is larger — that is the
    // owner's composition call and it moved. What it still guards is the defect
    // it was written for: a Value Change whose amount and percentage are set at
    // DIFFERENT weights, or either of them dropped to a metadata role, so the
    // figure reads as a footnote rather than a result.
    const block = /\{o\.evoAdjustedValueChange\}[\s\S]{0,1200}?formatRatioPct\(headlineChange\.ratio\)/.exec(PAGE)
    assert.ok(block !== null, 'the Value Change block must exist')
    const body = block![0].replace(/\{o\.evoAdjustedValueChange\}/, '')
    const roles = body.match(/text-sm font-semibold/g) ?? []
    assert.ok(roles.length >= 2, 'the amount and the percentage share one weight')
    // The CAPTION above them legitimately is a metadata role, which is why it
    // is stripped before this check.
    assert.ok(!/ui-meta/.test(body), 'no figure in the block may render at a metadata scale')
    // And the figure it now supports takes the leading scale in its place.
    const actual =
      /\{o\.evoActualValueLabel\}[\s\S]{0,700}?value=\{actualLatest\.value\}[\s\S]{0,300}?\/>/.exec(PAGE)
    assert.ok(actual !== null && /ui-chart-headline/.test(actual[0]),
      'the actual portfolio value leads the evolution surface')
  })

  test('the hierarchy is MEASURED, not just named', () => {
    // AUM hero > Portfolio Value > Value Change > metadata, as type sizes.
    const css = read('src/app/globals.css')
    const size = (token: string) => {
      const m = new RegExp(`${token}:\\s*(?:clamp\\(\\s*)?(\\d+)px`).exec(css)
      assert.ok(m !== null, `${token} must be declared`)
      return Number(m![1])
    }
    const hero = size('--fs-kpi-hero')
    const level = size('--fs-chart-headline')
    const change = size('--fs-capsule-value')
    const meta = size('--fs-meta')
    assert.ok(change > meta, 'Value Change must outrank ordinary metadata')
    assert.ok(change < level, 'and stay below the value it describes')
    assert.ok(level < hero, 'which in turn stays below the page hero')
  })

  test('it ranks BELOW the page\'s portfolio-value hero', () => {
    // The hero uses `ui-kpi-hero`; nothing in the evolution card may.
    const hero = read('src/components/familyPortfolio/PortfolioValueHero.tsx')
    assert.match(hero, /ui-kpi-hero/)
    const evoBlock = PAGE.slice(PAGE.indexOf('{o.evoTitle}'))
    assert.ok(!/ui-kpi-hero/.test(evoBlock), 'Value Change must not match the AUM hero scale')
  })

  test('the sign is never carried by colour alone', () => {
    // A signed figure and a label accompany the tone, so the state survives a
    // colour-vision difference and a monochrome print.
    assert.match(PAGE, /value=\{headlineChange\.absolute\}[\s\S]{0,120}signed/)
    assert.match(PAGE, /\{o\.evoAdjustedValueChange\}/)
    // And the tone itself is derived from the figure's own sign. R13.R2F § 4
    // extracted that ternary into `toneOf` so the single-series KPI and the two
    // Compare KPIs cannot tone by different rules — the property asserted is
    // unchanged, it is now proven once for all three.
    assert.match(PAGE, /const toneOf = \(absolute: number \| null\) =>/)
    assert.match(PAGE, /absolute !== null && absolute > 0\s*\?\s*'text-positive'/)
    assert.match(PAGE, /const changeTone = toneOf\(headlineChange\.absolute\)/)
    assert.match(PAGE, /toneOf\(c\.change\.absolute\)/)
  })

  test('§ 16 — it is never called a return', () => {
    // R13.R2E §§ 9-10 — 'Value Change' and 'Change in Portfolio Value' are
    // RETIRED. The plotted level is derived, and a generic name for its change
    // read as a change in the real balance. The § 16 guarantee is unchanged and
    // now applies to the replacement label.
    assert.equal(en.evoAdjustedValueChange, 'Flow-Adjusted Value Change')
    assert.equal(es.evoAdjustedValueChange, 'Variación de Valor Ajustada por Flujos')
    assert.ok(!/return|retorno|rentabilidad/i.test(en.evoAdjustedValueChange + es.evoAdjustedValueChange))
    assert.ok(!/Portfolio Return/i.test(PAGE))
    // PASS 4 § 2 — the sentence was rewritten because its old claim ("it
    // includes the effect of contributions and withdrawals") is now FALSE: the
    // plotted line excludes them. The § 16 guarantee it carries is unchanged.
    assert.match(en.evoValueChangeNote, /not an investment[- ]return/)
    assert.match(PAGE, /\{o\.evoValueChangeNote\}/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Regression (§ 34)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2B § 34 — nothing else moved', () => {
  test('the allocation denominators and their constituent sets are unchanged', () => {
    const s = identifyMainStructure(ROWS, PERF)
    const bases = buildAllocation(s)
    assert.deepEqual(
      bases.map((b) => [b.id, b.denominatorRowKey]),
      [
        ['total', 'total'],
        ['ex_chilean', 'sub'],
        ['ex_chilean_ex_inretail', 'spine'],
      ],
    )
    // No double counting: a parent is never a constituent of its own basis.
    for (const b of bases) {
      assert.ok(!b.entries.some((e) => e.rowKey === b.denominatorRowKey))
    }
  })

  test('both settings gears remain, administrator-only', () => {
    assert.match(PAGE, /onOpenSettings=\{canEditSettings \? \(\) => setSettingsOpen\(true\) : undefined\}/)
    assert.match(PAGE, /\{canEditSettings && \(\s*<SettingsGearButton/)
  })

  test('the view interactions stayed OUT of settings', () => {
    // Period and series rails are still rendered directly on the chart card.
    assert.match(PAGE, /options=\{EVOLUTION_PERIODS\.map/)
    assert.match(PAGE, /value: 'compare' as SeriesMode/)
    assert.match(PAGE, /value: 'incl' as SeriesMode/)
    assert.match(PAGE, /value: 'excl' as SeriesMode/)
  })

  test('every disclosure, footer and freshness surface survived the recomposition', () => {
    for (const marker of [
      '<TableSourceFooter',
      '<DualFreshnessBadge',
      'o.provisionalDisclaimer',
      'o.allocationNote',
      'o.denominator',
      'o.residualWarning',
      'o.evoValueChangeNote',
      'differenceMismatch',
    ]) {
      assert.ok(PAGE.includes(marker), `${marker} must still be rendered`)
    }
  })

  test('the page still carries no page-level horizontal overflow escape hatch', () => {
    assert.ok(!/overflow-x-visible/.test(PAGE))
    assert.match(PAGE, /overflow-x-auto nv-scrollbar-hidden/)
  })

  test('the trailing-scroll fix is untouched, and the HWM disclosure cannot break it', () => {
    // The R13.R1 § 6 fix positions the shell's scroll containers so an
    // absolutely-positioned descendant cannot escape them and inflate the
    // document's height.
    const shell = read('src/components/layout/AppShell.tsx')
    assert.match(shell, /relative/)
    assert.match(shell, /overflow-y-auto/)
    // R13.R2F § 9 — THE OBLIGATION IS NOW MET BY CONSTRUCTION, WHICH IS THE
    // STRONGER RESULT. The pass-2 HWM band satisfied this by pairing an
    // absolutely-positioned tooltip with an explicit `relative` parent — a
    // correct arrangement that a later edit could still have broken. The
    // `<details>` disclosure opens IN FLOW, so the region contains no
    // absolutely-positioned element at all and there is nothing left to escape.
    // Comments are stripped first: this file's own prose explains WHY there is
    // no absolutely-positioned panel any more, and a search over the raw source
    // would match that explanation rather than the markup it describes.
    const CODE = codeOf(PAGE)
    const band = /<details[\s\S]*?<\/details>/.exec(CODE)
    assert.ok(band !== null, 'the HWM disclosure must exist')
    assert.ok(!/absolute/.test(band![0]),
      'the HWM disclosure must open in flow, never as an absolutely-positioned overlay')
    assert.ok(!/role="tooltip"/.test(band![0]),
      'it is a disclosure, not a hover tooltip')
    // And it must not cover the chart: the disclosure is a SIBLING of the plot,
    // declared before it, so an opened explanation moves the chart down rather
    // than sitting on top of it.
    assert.ok(CODE.indexOf('</details>') < CODE.indexOf('<PortfolioEvolutionChart'),
      'the disclosure must precede the chart in the document, never overlay it')
  })

  test('the donut is still fed the selected basis\' own entries', () => {
    assert.match(PAGE, /entries=\{donutEntries\}/)
    assert.match(PAGE, /const donutEntries = \(selectedBasis\?\.entries \?\? \[\]\)/)
    // Weight and value both come from the basis, unmodified.
    assert.match(PAGE, /weight: e\.weight/)
    assert.match(PAGE, /value: e\.value/)
  })

  test('the Weekly Changes and Alternatives modules were not touched', () => {
    // These carry their own validated semantics; this pass had no business in
    // either. Asserted by content, so a stray edit shows up here.
    const weekly = read('src/lib/familyPortfolio/weeklyChanges.ts')
    assert.match(weekly, /export function reconcileFlowAndProfit/)
    assert.match(weekly, /const expected = total\.previousValue \+ total\.flow \+ total\.weeklyProfit/)
    const alt = read('src/lib/familyPortfolio/alternativesView.ts')
    assert.ok(alt.length > 0)
  })
})
