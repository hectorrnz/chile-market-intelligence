// R13.R2C OWNER-REVIEW PASS 3 §§ 32-35 — behavioural tests for the third
// owner-review pass.
//
// The four subjects, and what actually carries risk in each:
//
//   * PERFORMANCE NAMING. The defect being fixed is semantic, not cosmetic: a
//     "Weekly" heading sat over a row containing year-to-date figures. So the
//     tests assert the RELATIONSHIP — Main's band is titled by its horizon
//     because every figure under it shares one; a personal band is titled
//     plainly because its figures do not — and that no Main basis word can
//     reach a personal scope.
//   * WEEKLY NOTES. Several live notes per week, each with its own identity.
//     The tests prove the model can actually do that (which
//     `portfolio_commentary` structurally cannot), that one note's edit or
//     deletion cannot touch another, that deletion is a tombstone the DATABASE
//     enforces, and that every mutation is administrator-gated on the server.
//   * PERSONAL HISTORY. Source-backed or nothing. The tests assert the
//     extractor reads real cells across the historical grid, reports gaps
//     instead of filling them, and writes through a key that makes the backfill
//     idempotent.
//   * PRINT. The risk is a second surface that shows what the Summary would
//     refuse. The tests assert there is no second fetch and no second
//     entitlement decision, that the sheet excludes every control, and that the
//     privacy flag is passed through rather than dropped.
//
// NO PRIVATE DATA. Every number below is invented and hand-checkable.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dict } from '../src/lib/i18n.ts'
import {
  MAX_WEEKLY_NOTE_LENGTH,
  NOTE_SCOPES,
  nextDisplayOrder,
  normalizeWeeklyNote,
  scopeHasWeeklyNotes,
  sortWeeklyNotes,
  type WeeklyNote,
} from '../src/lib/familyPortfolio/weeklyNotes.ts'
import {
  EVOLUTION_SERIES_SPECS,
  EVOLUTION_EXTRACTOR_VERSION,
  MAIN_EVOLUTION_BASES,
  PERSONAL_EVOLUTION_SCOPES,
} from '../src/lib/familyPortfolio/resumen/evolutionHistory.ts'
import {
  buildPersonalEvolutionSeries,
  buildEvolutionSeries,
} from '../src/lib/familyPortfolio/overview.ts'
import { highWaterMarket, shouldShowHighWaterMarket } from '../src/lib/familyPortfolio/highWaterMarket.ts'
import { selectEvolutionRange } from '../src/lib/familyPortfolio/evolutionRange.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = read('src/app/portfolio/page.tsx')
const STRIP = read('src/components/familyPortfolio/PerformanceMarketsStrip.tsx')
const NOTES_PANEL = read('src/components/familyPortfolio/WeeklyNotesPanel.tsx')
const PRINT = read('src/components/familyPortfolio/SummaryPrintSheet.tsx')
const CSS = read('src/app/globals.css')
const OVERVIEW_ROUTE = read('src/app/api/family-portfolio/overview/[scope]/route.ts')
const NOTES_ROUTE = read('src/app/api/family-portfolio/admin/publications/[id]/notes/route.ts')
const NOTE_ROUTE = read('src/app/api/family-portfolio/admin/publications/[id]/notes/[noteId]/route.ts')
const NOTES_REPO = read('src/lib/db/repositories/familyPortfolioWeeklyNotesRepository.ts')
const NOTES_MIGRATION = read('supabase/migrations/20260813000000_family_portfolio_weekly_notes.sql')
const NOTES_PGTAP = read('supabase/tests/database/family_portfolio_weekly_notes_test.sql')
// R13.R2C1 — the sibling pending migration, swept for the same postcondition
// defect class as the notes migration (deparsed-policy-text matching).
const SETTINGS_MIGRATION = read(
  'supabase/migrations/20260812000000_family_portfolio_presentation_settings.sql',
)
const EVO_MIGRATION = read('supabase/migrations/20260811000000_portfolio_evolution_history.sql')
const EXTRACTOR = read('src/lib/familyPortfolio/resumen/evolutionHistory.ts')
const BACKFILL = read('scripts/admin/backfillEvolutionHistory.ts')

const en = dict.en.fp.overview
const es = dict.es.fp.overview

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Performance naming and hierarchy (§§ 2-5, 27; § 32)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2C § 2 — Main\'s headline band states its horizon', () => {
  test('the section is titled Weekly Performance in both languages', () => {
    assert.equal(en.weeklyPerformanceTitle, 'Weekly Performance')
    assert.equal(es.weeklyPerformanceTitle, 'Rentabilidad Semanal')
    assert.match(PAGE, /const performanceSectionTitle = isMain \? o\.weeklyPerformanceTitle : o\.performanceTitle/)
    assert.match(PAGE, /sectionTitle=\{performanceSectionTitle\}/)
    assert.match(STRIP, /\{sectionTitle\}/)
  })

  test('the band carries weekly PORTFOLIO returns and weekly MARKET returns', () => {
    // PASS 4 § 4 — row 1 is the weekly comparison; both groups still sit under
    // the one heading, now as explicit primary groups.
    assert.match(PAGE, /portfolioPrimary=\{portfolioPrimary\}/)
    assert.match(PAGE, /marketsPrimary=\{marketsPrimary\}/)
    assert.equal(en.blockExChilean, 'Portfolio excl. Chilean equities')
    assert.equal(en.blockWithChilean, 'Portfolio incl. Chilean equities')
    // § 4A — "(weekly)" is gone from the comparator labels: the band's title
    // carries the horizon for everything in row 1.
    assert.equal(en.globalEquity, 'Global Equity')
    assert.equal(en.globalFixedIncome, 'Global Fixed Income')
    assert.ok(!/weekly|semanal/i.test(en.globalEquity + en.globalFixedIncome))
    assert.ok(!/weekly|semanal/i.test(es.globalEquity + es.globalFixedIncome))
  })

  test('the group labels are subordinate to the band title, not competing with it', () => {
    // One <h2> for the band; the two column groups are <h3>; a basis group
    // inside a column is an <h4> below them again.
    assert.match(STRIP, /<h2 className="ui-label text-foreground[^"]*">\{sectionTitle\}<\/h2>/)
    assert.match(STRIP, /<h3 id=\{`\$\{uid\}-portfolio`\}/)
    assert.match(STRIP, /<h3 id=\{`\$\{uid\}-markets`\}/)
    assert.match(STRIP, /<h4 className="ui-meta text-muted-fg font-semibold">\{group\.title\}<\/h4>/)
  })

  test('§ 4A — row 1 pairs each basis return with its P&L, and INCL leads', () => {
    // The owner reads the total portfolio first, so the order is explicit
    // rather than whatever the parser emitted.
    assert.match(
      PAGE,
      /\['with_chilean_equities', 'ex_chilean_equities'\]/,
      'Incl. Chilean equities must be ordered first',
    )
    assert.match(PAGE, /label: o\.metricReturn/)
    assert.match(PAGE, /label: o\.metricProfit/)
    assert.equal(en.metricReturn, 'Return')
    assert.equal(en.metricProfit, 'P&L')
    // § 4A — row 2 carries YTD and flows, per basis.
    const secondary = PAGE.slice(PAGE.indexOf('const portfolioSecondary'), PAGE.indexOf('const metricState'))
    for (const key of ['o.ytdReturn', 'o.ytdProfit', 'o.flow']) {
      assert.ok(secondary.includes(key), `row 2 must carry ${key}`)
    }
  })

  test('§ 4B — the market block sits immediately beside the weekly metrics', () => {
    // A content-width portfolio column, a content-width markets column, and a
    // trailing track that absorbs the leftover width — so the comparators can
    // never be pushed to the far edge of the card, which is what made them hard
    // to compare against on a personal scope.
    assert.match(STRIP, /lg:grid-cols-\[minmax\(0,auto\)_minmax\(0,auto\)_minmax\(0,1fr\)\]/)
  })

  test('§ 4 — a P&L amount in the band obeys the page mask', () => {
    // Amounts entered this component in pass 4; they are portfolio money and
    // must never be formatted straight to text here.
    assert.match(STRIP, /<MaskedAmount/)
    assert.match(STRIP, /masked=\{masked\}/)
    assert.match(PAGE, /masked=\{masked\}\s*\n\s*\/>/)
  })
})

describe('R13.R2C § 3 — compact institutional P&L terminology', () => {
  test('EN uses Weekly P&L / YTD Return / YTD P&L', () => {
    assert.equal(en.weeklyProfit, 'Weekly P&L')
    assert.equal(en.ytdReturn, 'YTD Return')
    assert.equal(en.ytdProfit, 'YTD P&L')
    assert.equal(en.weeklyReturn, 'Weekly Return')
  })

  test('ES keeps the recognisable P&L shorthand the app already uses', () => {
    // `P&L No Real.` / `P&L %` are pre-existing Spanish labels on the personal
    // portfolio page, so the shorthand is established vocabulary here.
    assert.equal(es.weeklyProfit, 'P&L Semanal')
    assert.equal(es.ytdProfit, 'P&L YTD')
    assert.equal(es.ytdReturn, 'Retorno YTD')
    assert.equal(es.weeklyReturn, 'Retorno de la Semana')
  })

  test('the verbose forms are gone from the Summary vocabulary', () => {
    for (const d of [en, es]) {
      for (const v of Object.values(d)) {
        if (typeof v !== 'string') continue
        assert.ok(!/Weekly Profit \/ Loss/.test(v), `stale label: ${v}`)
        assert.ok(!/Year-to-date Profit \/ Loss/.test(v), `stale label: ${v}`)
      }
    }
  })

  test('the flow disclosure was updated with the rename, not left contradicting it', () => {
    assert.match(en.snapFlowNote, /Weekly P&L/)
    assert.equal(en.snapFlowIdentity, 'Portfolio Value Change = Weekly P&L + Net Flows')
    assert.match(es.snapFlowNote, /P&L Semanal/)
    assert.equal(es.snapFlowIdentity, 'Variación del Valor del Portafolio = P&L Semanal + Flujos Netos')
  })
})

describe('R13.R2C §§ 5, 27-28 — a personal scope is never labelled weekly-only', () => {
  test('its band is titled Performance, not Weekly Performance', () => {
    assert.equal(en.performanceTitle, 'Performance')
    assert.equal(es.performanceTitle, 'Rentabilidad')
  })

  test('its band carries BOTH horizons, each named, and duplicates none', () => {
    // PASS 4 § 4B — row 1 is Weekly Return + Weekly P&L; row 2 is YTD Return,
    // YTD P&L and Net Flows. That is the owner's five metrics, each stating its
    // own horizon, with no figure shown twice.
    assert.match(PAGE, /key: 'personal-weekly-return'/)
    assert.match(PAGE, /key: 'personal-weekly-pl'/)
    assert.equal(en.personalWeekly, 'Weekly Return')
    assert.equal(en.personalYtd, 'YTD Return')
    assert.equal(es.personalWeekly, 'Retorno Semanal')
    assert.equal(es.personalYtd, 'Retorno YTD')

    const primary = PAGE.slice(PAGE.indexOf("key: 'personal-weekly'"), PAGE.indexOf('// ── ROW 2'))
    assert.ok(!/o\.ytdReturn|o\.ytdProfit/.test(primary), 'row 1 is weekly-only for a personal scope')
    const secondary = PAGE.slice(PAGE.indexOf('const portfolioSecondary'), PAGE.indexOf('const metricState'))
    for (const key of ['o.ytdReturn', 'o.ytdProfit', 'o.flow']) {
      assert.ok(secondary.includes(key), `row 2 must carry ${key}`)
    }
  })

  test('a personal scope shows no basis group heading at all', () => {
    // A group title is Main-gated in BOTH rows — this is what used to put a
    // "Weekly" heading over a row containing YTD figures.
    assert.match(PAGE, /title: isMain \? blockLabel\(b\.basis\) : undefined/)
    const primary = PAGE.slice(PAGE.indexOf("key: 'personal-weekly'"), PAGE.indexOf('// ── ROW 2'))
    assert.ok(!/title:/.test(primary), 'the personal row-1 group carries no title at all')
  })

  test('§ 28 — no Incl./Excl. Chilean-equities control can reach a personal scope', () => {
    // The series rail is rendered only for Main…
    assert.match(PAGE, /\{isMain && \(\s*<div className="max-w-full overflow-x-auto nv-scrollbar-hidden">\s*<SegmentedControl\s*options=\{\[\s*\{ value: 'compare'/)
    // …and a persisted Main mode cannot leak onto a personal scope.
    assert.match(PAGE, /const safeMode: SeriesMode = isMain \? storedMode : 'incl'/)
    // The single personal series is labelled neutrally, never with a basis name.
    // PASS 4 § 2 — that neutral label is now the flow-adjusted one, because the
    // flow-adjusted path is what the personal chart draws.
    assert.match(PAGE, /const singleSeriesLabel = isMain \? o\.evoModeIncl : o\.evoAdjustedValueLabel/)
    assert.ok(!/Chilean|Chilena/i.test(en.evoAdjustedValueLabel + es.evoAdjustedValueLabel))
  })

  test('the AUM basis line is Main-only too', () => {
    assert.match(PAGE, /basis=\{isMain \? o\.aumBasis : null\}/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Weekly Notes (§§ 7-12; § 33)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2C § 9 — the commentary model genuinely cannot hold several notes', () => {
  test('portfolio_commentary is ONE live document per (publication, scope)', () => {
    const publication = read('supabase/migrations/20260810000000_family_portfolio_publication.sql')
    assert.match(
      publication,
      /create unique index if not exists portfolio_commentary_current_idx\s+on public\.portfolio_commentary \(publication_id, scope\)\s+where superseded_by is null/,
    )
  })

  test('so a SEPARATE table was added, and the commentary index is untouched', () => {
    assert.match(NOTES_MIGRATION, /create table if not exists public\.family_portfolio_weekly_notes/)
    assert.match(NOTES_MIGRATION, /the one-live-revision index on portfolio_commentary is missing/)
  })
})

describe('R13.R2C § 7 — Weekly Notes are MAIN only', () => {
  test('the product rule is declared once, in the pure module', () => {
    assert.deepEqual([...NOTE_SCOPES], ['main'])
    assert.equal(scopeHasWeeklyNotes('main'), true)
    for (const s of ['jaime', 'andres', 'pablo', 'alternatives', 'admin']) {
      assert.equal(scopeHasWeeklyNotes(s), false, s)
    }
  })

  test('the READ path applies it — a personal scope receives an empty list', () => {
    assert.match(OVERVIEW_ROUTE, /scopeHasWeeklyNotes\(scope\)\s*\?\s*await getWeeklyNotes\(selected\.id, scope\)/)
  })

  test('the WRITE path applies it — a personal scope is refused 422', () => {
    assert.match(NOTES_ROUTE, /!scopeHasWeeklyNotes\(scope\) \|\| !canReadScope\(entitlement\.input, scope\)/)
    assert.match(NOTES_ROUTE, /unknown_scope[\s\S]{0,60}422/)
  })

  test('the LAYOUT applies it — no empty third column on a personal scope', () => {
    assert.match(PAGE, /const showNotes = activeScope !== null && scopeHasWeeklyNotes\(activeScope\)/)
    assert.match(PAGE, /\{showNotes && \(/)
    // Main's THREE-track shape (Snapshot | Allocation | Notes) is pinned
    // exactly. The personal row's own shape is a visual-tuning knob — R13.R2F2
    // retuned its ratio and R13.R2F3 moved Performance into it as a third
    // column — so what is asserted here is the INVARIANT this test exists to
    // protect: a personal scope renders no notes column at all, empty or
    // otherwise, and `WeeklyNotesPanel` is reached from exactly one place.
    assert.match(PAGE, /showNotes\s*\?\s*'grid grid-cols-1 xl:grid-cols-\[minmax\(0,3fr\)_minmax\(0,5fr\)_minmax\(0,4fr\)\]'/)
    const personalTrack = PAGE.match(/:\s*'grid grid-cols-1 xl:grid-cols-\[(minmax\(0,\d+fr\)(?:_minmax\(0,\d+fr\))*)\]'/)
    assert.ok(personalTrack, 'personal analytical row must declare an explicit xl track list')
    assert.equal((PAGE.match(/<WeeklyNotesPanel/g) ?? []).length, 1)
    assert.match(PAGE, /\{showNotes && \(\s*\n\s*<div[\s\S]{0,200}?<WeeklyNotesPanel/)
  })
})

describe('R13.R2C §§ 8-10 — several notes, each with its own identity', () => {
  test('the table keys on the week and the scope, and orders deterministically', () => {
    assert.match(NOTES_MIGRATION, /publication_id\s+uuid not null references public\.portfolio_publications\(id\) on delete cascade/)
    assert.match(NOTES_MIGRATION, /scope\s+text not null check \(scope in/)
    assert.match(NOTES_MIGRATION, /display_order\s+int\s+not null default 0/)
    assert.match(NOTES_MIGRATION, /created_by\s+uuid not null references auth\.users/)
    assert.match(NOTES_MIGRATION, /created_at\s+timestamptz not null default now\(\)/)
    assert.match(NOTES_MIGRATION, /updated_at\s+timestamptz not null default now\(\)/)
    assert.match(NOTES_MIGRATION, /deleted_at\s+timestamptz/)
    assert.match(NOTES_MIGRATION, /deleted_by\s+uuid references auth\.users/)
  })

  test('ordering is TOTAL — two notes in the same tick still have one order', () => {
    const notes: WeeklyNote[] = [
      { id: 'c', body: 'c', displayOrder: 1, createdAt: '2026-07-31T10:00:00Z', updatedAt: 'x' },
      { id: 'a', body: 'a', displayOrder: 0, createdAt: '2026-07-31T10:00:00Z', updatedAt: 'x' },
      { id: 'b', body: 'b', displayOrder: 1, createdAt: '2026-07-31T09:00:00Z', updatedAt: 'x' },
    ]
    assert.deepEqual(sortWeeklyNotes(notes).map((n) => n.id), ['a', 'b', 'c'])
    // Same order, same createdAt → the id breaks the tie, stably.
    const tied: WeeklyNote[] = [
      { id: 'z', body: 'z', displayOrder: 0, createdAt: 'T', updatedAt: 'x' },
      { id: 'y', body: 'y', displayOrder: 0, createdAt: 'T', updatedAt: 'x' },
    ]
    assert.deepEqual(sortWeeklyNotes(tied).map((n) => n.id), ['y', 'z'])
    // Pure: the input array is not mutated.
    assert.deepEqual(notes.map((n) => n.id), ['c', 'a', 'b'])
  })

  test('a new note lands past the highest position, never at the array length', () => {
    assert.equal(nextDisplayOrder([]), 0)
    assert.equal(
      nextDisplayOrder([
        { id: 'a', body: 'a', displayOrder: 0, createdAt: 'T', updatedAt: 'T' },
        { id: 'b', body: 'b', displayOrder: 7, createdAt: 'T', updatedAt: 'T' },
      ]),
      8,
      'a tombstoned note in the middle must not make a new note collide with a live one',
    )
  })

  test('the create route positions a new note with that helper', () => {
    assert.match(NOTES_ROUTE, /nextDisplayOrder\(existing\.notes\)/)
  })

  test('edit and delete address ONE note by id', () => {
    assert.match(NOTE_ROUTE, /export async function PATCH/)
    assert.match(NOTE_ROUTE, /export async function DELETE/)
    assert.match(NOTE_ROUTE, /updateWeeklyNote\(\{\s*id: noteId/)
    assert.match(NOTE_ROUTE, /deleteWeeklyNote\(\{ id: noteId/)
    assert.match(NOTES_REPO, /\.eq\('id', input\.id\)/)
  })

  test('§ 11 — deletion is a TOMBSTONE, enforced by RLS not by the app', () => {
    assert.match(NOTES_MIGRATION, /using \(public\.nmi_can_access_scope\(scope\) and deleted_at is null\)/)
    assert.match(NOTES_MIGRATION, /a deleted note is still readable — the tombstone is not enforced by RLS/)
    // The repository stamps rather than deletes.
    assert.ok(!/\.delete\(\)/.test(codeOf(NOTES_REPO)), 'no row is ever removed')
    assert.match(NOTES_REPO, /deleted_at: new Date\(\)\.toISOString\(\), deleted_by: input\.author/)
    // And a tombstone cannot be edited back into existence.
    assert.match(NOTES_REPO, /\.is\('deleted_at', null\)/)
  })

  // R13.R2C1 — the migration's own tombstone postcondition must survive contact
  // with PostgreSQL. `pg_policies.qual` is the DEPARSED expression, not this
  // file's source text, and the deparser writes SQL keywords in upper case, so a
  // case-SENSITIVE match on `deleted_at is null` cannot match the very policy it
  // checks and would abort a correct migration. The guard must therefore be
  // case-insensitive; anything that reads `qual` for a keyword phrase must be
  // too.
  test('R13.R2C1 — the tombstone postcondition matches DEPARSED policy text case-insensitively', () => {
    const guard = /and qual (~\*|like|~) ('|\$)[^\n]*deleted_at[^\n]*/i.exec(NOTES_MIGRATION)
    assert.ok(guard !== null, 'the tombstone postcondition still exists')
    assert.match(
      guard![0],
      /~\*/,
      'the tombstone postcondition must use a case-insensitive operator — a lower-case LIKE ' +
        'cannot match pg_get_expr output, which renders IS NULL in upper case',
    )
    // Every postcondition in BOTH pending migrations that inspects deparsed
    // policy text must either be case-insensitive or match an identifier, which
    // the deparser preserves verbatim. A bare lower-case keyword is the defect.
    for (const [name, sql] of [
      ['weekly notes', NOTES_MIGRATION],
      ['presentation settings', SETTINGS_MIGRATION],
    ] as const) {
      for (const m of sql.matchAll(/(?:qual|with_check|v_sel|v_upd|v_ins)\s+(?:not\s+)?like\s+'([^']*)'/g)) {
        assert.ok(
          !/\b(is|not|null|and|or|any|array|coalesce)\b/i.test(m[1]),
          `${name}: a case-sensitive LIKE on deparsed policy text matches the SQL keyword ` +
            `in ${JSON.stringify(m[1])}; the deparser upper-cases keywords, so this cannot match`,
        )
      }
    }
  })
})

describe('R13.R2C §§ 10-12 — permissions and validation', () => {
  test('every mutation re-derives administrator on the SERVER', () => {
    assert.match(NOTES_ROUTE, /if \(!entitlement\.isAdministrator \|\| !entitlement\.userId\)[\s\S]{0,120}403/)
    assert.match(NOTE_ROUTE, /if \(!entitlement\.isAdministrator \|\| !entitlement\.userId\)[\s\S]{0,160}403/)
    // Both mutation verbs go through the same guard.
    assert.match(NOTE_ROUTE, /const auth = await requireAdministrator\(\)[\s\S]{0,80}export async function DELETE|export async function DELETE[\s\S]{0,200}requireAdministrator\(\)/)
  })

  test('reads use the caller\'s session; writes use the admin client', () => {
    assert.match(NOTES_REPO, /getSupabaseUserClient\(\)/)
    assert.match(NOTES_REPO, /getSupabaseAdminClient\(\)/)
    const reader = /export async function getWeeklyNotes[\s\S]*?^}/m.exec(NOTES_REPO)
    assert.ok(reader !== null)
    assert.ok(!/getSupabaseAdminClient/.test(reader![0]), 'a read must never bypass RLS')
  })

  test('a member is shown no write affordance at all', () => {
    assert.match(NOTES_PANEL, /\{canEdit && editing === null && \(/)
    assert.match(NOTES_PANEL, /\{canEdit && \(/)
    assert.ok(!/disabled=\{!canEdit\}/.test(NOTES_PANEL))
  })

  test('the body is validated at both bounds, and trimmed', () => {
    assert.deepEqual(normalizeWeeklyNote(''), { ok: false, code: 'empty' })
    assert.deepEqual(normalizeWeeklyNote('   \n '), { ok: false, code: 'empty' })
    assert.deepEqual(normalizeWeeklyNote(null), { ok: false, code: 'empty' })
    assert.deepEqual(normalizeWeeklyNote(123), { ok: false, code: 'empty' })
    const atLimit = 'x'.repeat(MAX_WEEKLY_NOTE_LENGTH)
    assert.deepEqual(normalizeWeeklyNote(atLimit), { ok: true, body: atLimit })
    assert.deepEqual(normalizeWeeklyNote(`${atLimit}x`), { ok: false, code: 'too_long' })
    assert.deepEqual(normalizeWeeklyNote('  bought X\nsold Y  '), { ok: true, body: 'bought X\nsold Y' })
  })

  test('the database re-applies both bounds independently', () => {
    assert.match(NOTES_MIGRATION, /body\s+text not null check \(length\(btrim\(body\)\) > 0 and length\(body\) <= 4000\)/)
    assert.equal(MAX_WEEKLY_NOTE_LENGTH, 4000, 'the module and the CHECK must agree')
  })

  test('a note is rendered as TEXT — never as markup', () => {
    assert.ok(!/dangerouslySetInnerHTML/.test(codeOf(NOTES_PANEL)))
    assert.ok(!/dangerouslySetInnerHTML/.test(codeOf(PRINT)))
    assert.match(NOTES_PANEL, /whitespace-pre-wrap/)
  })

  test('§ 11 — deletion is confirmed in the app\'s own dialog, never window.confirm', () => {
    // `codeOf` — the component's own header explains the rule by naming the
    // thing it forbids, and a raw match would report that comment as a breach.
    assert.ok(!/window\.confirm/.test(codeOf(NOTES_PANEL)))
    assert.match(NOTES_PANEL, /<ModalShell/)
    assert.match(NOTES_PANEL, /role="alertdialog"/)
    assert.match(NOTES_PANEL, /dismissDisabled=\{deleting\}/)
    for (const d of [en, es]) {
      for (const k of ['notesDelete', 'notesDeleteTitle', 'notesDeleteBody', 'notesDeleteConfirm', 'notesDeleteError'] as const) {
        assert.equal(typeof d[k], 'string', k)
        assert.ok((d[k] as string).length > 0, k)
      }
    }
  })

  test('the pgTAP suite proves the DB behaviours the product depends on', () => {
    for (const [needle, why] of [
      ['three notes are live for the same week and scope at once', 'several live notes'],
      ['ordering is deterministic', 'deterministic order'],
      ['editing one note changes that note', 'independent edit'],
      ['and leaves its siblings untouched', 'siblings untouched by an edit'],
      ['deleting one note leaves exactly the other two live', 'independent delete'],
      ['the deleted note is RETAINED as a tombstone', 'delete is not erasure'],
      ['a deleted note is invisible AT THE DATABASE', 'the tombstone is enforced by RLS'],
      ['a member cannot INSERT a note', 'members cannot write'],
      ['an account with no portfolio scope reads no note', 'unauthorized cannot read'],
      ['anon cannot read the notes table at all', 'anon cannot read'],
      ['Jaime cannot read a note written on Pablo', 'scope isolation'],
    ] as Array<[string, string]>) {
      assert.ok(NOTES_PGTAP.includes(needle), `pgTAP must prove: ${why}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Personal historical Evolution (§§ 15-20; § 34)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2C § 17 — the EXISTING evolution structure carries personal scopes', () => {
  test('no second evolution system was created', () => {
    assert.match(EVO_MIGRATION, /scope\s+text not null check \(scope in \('main','jaime','andres','pablo'\)\)/)
    assert.match(EVO_MIGRATION, /basis\s+text not null check \(basis in\s+\('ex_chilean_equities','with_chilean_equities','total'\)\)/)
    // The personal scopes needed NO schema change at all.
    assert.match(EVO_MIGRATION, /constraint portfolio_evolution_observations_key unique \(scope, basis, observation_date\)/)
  })

  test('the read policy is per-scope, so history obeys the entitlement matrix', () => {
    assert.match(EVO_MIGRATION, /using \(public\.nmi_can_access_scope\(scope\)\)/)
    assert.match(EVO_MIGRATION, /writes are service-role only/)
  })

  test('the extractor now produces one series per published scope', () => {
    assert.deepEqual([...PERSONAL_EVOLUTION_SCOPES], ['jaime', 'andres', 'pablo'])
    assert.deepEqual([...MAIN_EVOLUTION_BASES], ['ex_chilean_equities', 'with_chilean_equities'])
    assert.deepEqual(EVOLUTION_SERIES_SPECS.map((s) => `${s.scope}:${s.basis}`), [
      'main:ex_chilean_equities',
      'main:with_chilean_equities',
      'jaime:total',
      'andres:total',
      'pablo:total',
    ])
    // A personal basis is `total` — never a Main basis name (§ 28).
    for (const s of EVOLUTION_SERIES_SPECS) {
      if (s.scope !== 'main') assert.equal(s.basis, 'total', s.scope)
    }
  })

  test('the extractor version was bumped with the semantics', () => {
    assert.equal(EVOLUTION_EXTRACTOR_VERSION, 'r13.r2c.evolution.2')
  })

  test('§ 16 — a gap is REPORTED, never filled or back-projected', () => {
    // The extraction skips a column with no usable number and records the date.
    assert.match(EXTRACTOR, /gapDates\.push\(date\)\s*\n\s*continue/)
    assert.ok(!/carryForward|interpolat|backProject/i.test(codeOf(EXTRACTOR)))
    // Each observation carries the exact cell it was read from.
    assert.match(EXTRACTOR, /sourceCell: sourceCell\(sheet\.name, column\.column, row\.sourceRow\)/)
  })

  test('a series counts only its OWN observations, not every series sharing a basis', () => {
    // The three personal scopes all use the basis `total`; counting by basis
    // alone would have reported each of them as the sum of all three.
    assert.match(EXTRACTOR, /observations\.filter\(\(o\) => o\.scope === scope && o\.basis === basis\)\.length/)
  })

  test('the backfill is idempotent and never deletes', () => {
    assert.match(BACKFILL, /onConflict: 'scope,basis,observation_date'/)
    assert.ok(!/\.delete\(\)/.test(codeOf(BACKFILL)))
    // Dry run is the default; a write needs a named approved administrator.
    assert.match(BACKFILL, /if \(!args\.write\)/)
    assert.match(BACKFILL, /if \(actor\.role !== 'administrator'\) die/)
    // TOCTOU: the stored object's digest is re-verified before parsing.
    assert.match(BACKFILL, /source_digest_mismatch/)
    // It never prints a portfolio amount.
    assert.ok(!/o\.value|\.value\)/.test(/console\.log\([\s\S]*?\)/g.exec(BACKFILL)?.[0] ?? ''))
  })

  test('it is a CLI, unreachable over HTTP', () => {
    assert.match(BACKFILL, /SERVER-SIDE CLI ONLY/)
    assert.ok(!BACKFILL.includes('NextResponse'))
  })
})

describe('R13.R2C § 18 — the personal Evolution UI', () => {
  test('the route serves one basis for a personal scope and two for Main', () => {
    assert.match(OVERVIEW_ROUTE, /total: isMain \? \[\] : pointsFor\('total'\)/)
    assert.match(OVERVIEW_ROUTE, /exChilean: isMain \? pointsFor\('ex_chilean_equities'\) : \[\]/)
    assert.match(OVERVIEW_ROUTE, /const persisted = await getEvolutionObservations\(scope\)/)
  })

  test('the publications fallback also covers a personal scope', () => {
    assert.match(OVERVIEW_ROUTE, /buildPersonalEvolutionSeries\(input\)/)
    const input = {
      publications: [
        { id: 'p1', asOfDate: '2026-07-17' },
        { id: 'p2', asOfDate: '2026-07-24' },
      ],
      bindings: [
        { publicationId: 'p1', basis: 'total', boundRowKey: 'jaime.total' },
        { publicationId: 'p2', basis: 'total', boundRowKey: 'jaime.total' },
      ],
      boundValues: [
        { publicationId: 'p1', rowKey: 'jaime.total', value: 100 },
        { publicationId: 'p2', rowKey: 'jaime.total', value: 110 },
      ],
    }
    assert.deepEqual(buildPersonalEvolutionSeries(input), [
      { date: '2026-07-17', value: 100 },
      { date: '2026-07-24', value: 110 },
    ])
    // The Main builder finds nothing in the same input — the two shapes cannot
    // be confused for one another.
    assert.deepEqual(buildEvolutionSeries(input), { exChilean: [], withChilean: [] })
  })

  test('a week with no binding or no value contributes NO point', () => {
    assert.deepEqual(
      buildPersonalEvolutionSeries({
        publications: [
          { id: 'p1', asOfDate: '2026-07-17' },
          { id: 'p2', asOfDate: '2026-07-24' },
          { id: 'p3', asOfDate: '2026-07-31' },
        ],
        bindings: [
          { publicationId: 'p1', basis: 'total', boundRowKey: 'k' },
          { publicationId: 'p2', basis: 'total', boundRowKey: null },
          { publicationId: 'p3', basis: 'total', boundRowKey: 'k' },
        ],
        boundValues: [
          { publicationId: 'p1', rowKey: 'k', value: 10 },
          { publicationId: 'p3', rowKey: 'k', value: null },
        ],
      }),
      [{ date: '2026-07-17', value: 10 }],
      'gaps stay gaps',
    )
  })

  test('the period rail still slices a personal series, and truncation is honest', () => {
    const points = [
      { date: '2026-05-01', value: 100 },
      { date: '2026-06-01', value: 110 },
      { date: '2026-07-31', value: 120 },
    ]
    const all = selectEvolutionRange(points, 'ALL', null)
    assert.equal(all.points.length, 3)
    const oneMonth = selectEvolutionRange(points, '1M', null)
    assert.ok(oneMonth.points.length >= 1 && oneMonth.points.length <= 3)
    // A period that predates the record truncates rather than inventing weeks.
    const oneYear = selectEvolutionRange(points, '1Y', null)
    assert.equal(oneYear.points.length, 3)
    assert.equal(oneYear.truncatedByHistory, true)
  })

  test('§ 19 — HWM applies to the single personal series, from real observations', () => {
    const points = [
      { date: '2026-05-01', value: 100 },
      { date: '2026-06-01', value: 140 },
      { date: '2026-07-31', value: 120 },
    ]
    assert.deepEqual(highWaterMarket(points), { value: 140, date: '2026-06-01', isCurrent: false })
    // One series + ALL → shown. There is no Compare case to suppress.
    assert.equal(shouldShowHighWaterMarket({ period: 'ALL', seriesCount: 1 }), true)
    assert.equal(shouldShowHighWaterMarket({ period: '1Y', seriesCount: 1 }), false)
  })

  test('§ 20 — privacy masks a personal history exactly as it masks Main', () => {
    assert.match(PAGE, /const hwmPoint = hwmVisible && !masked \? highWaterMarket\(/)
    // The chart itself is replaced wholesale while masked — one branch, both
    // scopes, so a personal history cannot be the one that leaks.
    assert.match(PAGE, /\) : masked \? \(/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Print (§§ 21-26; § 35)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2C §§ 21, 26 — one print action, driven by the scope on screen', () => {
  test('a printer action exists, once, with an accessible name', () => {
    assert.match(PAGE, /onClick=\{\(\) => window\.print\(\)\}/)
    assert.match(PAGE, /aria-label=\{o\.printAction\}/)
    assert.equal((PAGE.match(/window\.print\(\)/g) ?? []).length, 1, 'exactly one print entry point')
    assert.equal(en.printAction, 'Print')
    assert.equal(es.printAction, 'Imprimir')
  })

  test('it serves every authorized scope — Main and the three personal ones', () => {
    // The control is not gated on `isMain`: it prints whatever scope is on
    // screen, which the route already established this caller may read.
    const button = /aria-label=\{o\.printAction\}[\s\S]*?<\/button>/.exec(PAGE)
    assert.ok(button !== null)
    assert.ok(!/isMain/.test(button![0]), 'print must not be Main-only')
  })

  test('§ 26 — there is NO second fetch and NO second entitlement decision', () => {
    // The sheet renders the payload the Summary already has.
    assert.match(PAGE, /<SummaryPrintSheet[\s\S]*?totalValue=\{data\.hero\?\.totalValue \?\? null\}/)
    assert.ok(!/fetch\(/.test(codeOf(PRINT)), 'the print sheet must not fetch anything')
    assert.ok(!/canReadScope|entitlement/.test(codeOf(PRINT)), 'it must not re-decide authorization')
    // And it is gated on the SAME ready-state as the screen composition.
    assert.match(PAGE, /\{current\?\.outcome === 'ready' && data && pub && \(\s*<SummaryPrintSheet/)
  })

  test('privacy is passed through, never dropped for paper', () => {
    assert.match(PAGE, /masked=\{masked\}\s*\n\s*formatDate=\{formatIsoDateLabel\}\s*\n\s*\/>/)
    assert.match(PRINT, /<MaskedAmount value=\{totalValue\} masked=\{masked\}/)
    // The reference line is withheld while masked, exactly as on screen.
    assert.match(PRINT, /hwmValue=\{masked \? null : hwmValue\}/)
    assert.ok(!/masked=\{false\}/.test(PRINT), 'nothing may unmask itself')
  })
})

describe('R13.R2C §§ 22-25 — the sheet is a deliberate A4 composition', () => {
  test('the whole interactive page is excluded from print', () => {
    assert.match(PAGE, /<div className="no-print">/)
    assert.match(CSS, /\.no-print \{ display: none !important; \}/)
  })

  test('A4 portrait with real margins', () => {
    assert.match(CSS, /@page \{ size: A4 portrait; margin: 12mm; \}/)
  })

  test('no control, editor or gear can reach the sheet', () => {
    for (const forbidden of [
      'SettingsGearButton', 'SegmentedControl', 'PrivacyToggle', 'textarea',
      'onClick', 'window.print', 'ModalShell', 'PageHeader',
    ]) {
      assert.ok(!codeOf(PRINT).includes(forbidden), `the print sheet must not contain ${forbidden}`)
    }
  })

  test('it is vector and text, never a raster', () => {
    assert.match(PRINT, /<svg/)
    assert.ok(!/<img|canvas|toDataURL|screenshot/i.test(codeOf(PRINT)))
  })

  test('the print chart geometry is FIXED, so the sheet prints deterministically', () => {
    // Unlike the interactive chart, which is sized by a ResizeObserver reading
    // whatever width it happened to have on screen.
    assert.ok(!/ResizeObserver/.test(PRINT))
    assert.match(PRINT, /const PW = \d+/)
    assert.match(PRINT, /viewBox=\{`0 0 \$\{PW\} \$\{PH\}`\}/)
  })

  test('§ 23 — Main prints its basis distinction and its notes', () => {
    // PASS 4 § 4 — the sheet is driven by the SAME groups as the band, so the
    // basis title comes from the group rather than being re-derived here. A
    // personal group has none, and prints none.
    assert.match(PAGE, /detailGroups=\{portfolioSecondary\.map\(\(g\) => \(\{/)
    assert.match(PAGE, /title: g\.title \?\? ''/)
    assert.match(PAGE, /notes=\{showNotes \? \(data\.weeklyNotes \?\? \[\]\)/)
    assert.match(PRINT, /\{notes\.length > 0 && \(/)
  })

  test('§ 24 — a personal sheet carries no notes and no basis wording', () => {
    // `showNotes` is false for a personal scope, so the notes array is empty
    // and the region does not render at all.
    assert.match(PAGE, /notes=\{showNotes \?/)
    // The basis line and the group title are both Main-gated.
    assert.match(PAGE, /valueBasis=\{isMain \? o\.aumBasis : null\}/)
    assert.match(PRINT, /\{valueBasis \? ` · \$\{valueBasis\}` : ''\}/)
  })

  test('the sheet degrades legibly and cannot overflow horizontally', () => {
    assert.match(CSS, /\.nv-print-sheet \{[\s\S]*?width: 100%;/)
    assert.match(CSS, /\.nv-print-sheet svg text \{ fill: #444444 !important; \}/)
    assert.match(CSS, /break-inside: avoid/)
  })

  test('every print label exists in both languages', () => {
    for (const k of ['printAction', 'printTitle', 'printPreparedFor', 'printAsOf', 'printPage'] as const) {
      assert.equal(typeof en[k], 'string', `EN ${k}`)
      assert.equal(typeof es[k], 'string', `ES ${k}`)
      assert.notEqual(en[k], es[k], `${k} must actually be translated`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Regression (§ 29)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2C § 29 — Main Evolution did not regress', () => {
  test('every range and both bases are still offered on Main', () => {
    assert.match(PAGE, /options=\{EVOLUTION_PERIODS\.map/)
    assert.match(PAGE, /value: 'compare' as SeriesMode/)
    assert.match(PAGE, /value: 'incl' as SeriesMode/)
    assert.match(PAGE, /value: 'excl' as SeriesMode/)
  })

  test('the HWM summary band, its help and the x-axis fix all survive', () => {
    assert.match(PAGE, /\{o\.hwmSetAt\}/)
    assert.match(PAGE, /aria-label=\{o\.hwmHelpLabel\}/)
    const chart = read('src/components/familyPortfolio/PortfolioEvolutionChart.tsx')
    assert.match(chart, /const anchor = i === 0 \? 'start' : i === xTickIndices\.length - 1 \? 'end' : 'middle'/)
    assert.match(chart, /const MR = 22/)
  })

  test('the shared Difference invariant is untouched', () => {
    const overview = read('src/lib/familyPortfolio/overview.ts')
    assert.match(overview, /resolveDisplayedDifference/)
    assert.ok(!/thisWeek\s*-\s*previousWeek/.test(codeOf(PAGE)))
  })

  test('the settings gear stayed a gear, and print did not move into it', () => {
    assert.match(PAGE, /<SettingsGearButton/)
    const dialog = codeOf(read('src/components/familyPortfolio/AllocationSettingsDialog.tsx'))
    assert.ok(!/print/i.test(dialog), 'print is a printer action, not a chart setting')
    // Scoped to note CONTROLS, not the substring "note" — `settingsGlobalNote`
    // is a legitimate explanatory line inside the settings dialog.
    for (const control of ['WeeklyNotesPanel', 'notesAdd', 'notesEdit', 'notesDelete', 'createWeeklyNote']) {
      assert.ok(!dialog.includes(control), `notes are their own controls, not a chart setting (${control})`)
    }
  })
})
