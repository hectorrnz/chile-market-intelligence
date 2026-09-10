// POST-R13.8 FOLLOW-UP G — A FAILED READ IS NOT AN EMPTY TABLE.
//
// THE DEFECT. Three administrator listings answered `[]` for two different
// facts: "this table holds nothing" and "this table could not be read". The
// first is an answer; the second is the absence of one. Collapsing them means a
// transport failure, a revoked key or a dropped connection presents itself as a
// book with no history in it.
//
// WHY IT MATTERED. `listPublications` is not a listing. It is consumed three
// times by import planning:
//
//   · `planImportForDraft` derives `latestPublishedAsOf` from it — the endpoint
//     that separates a NEW week from a GAP_FILL. An unreadable ledger read as
//     `[]` gives a null endpoint, and every week in the workbook, including
//     weeks published years ago, then classifies as NEW.
//   · `getStandingPublicationPayload` finds the week being published in it. A
//     missing entry means "nothing stands at this date", which the caller reads
//     as "there is plainly something to publish".
//   · `listStandingPublicationPayloads` finds the ALREADY-PUBLISHED weeks in
//     it. A missing entry means "this week is not published", so a workbook that
//     overwrites settled history reports zero restatements and passes the
//     correction-authorization gate without ever asking for authorization.
//
// `getUploadFindings` was the same defect in the publish gate: `summarizeDraft`
// folds the findings recorded at upload time into the refusal set on the stated
// rule that "a blocking finding recorded at UPLOAD time still blocks now", so an
// unreadable findings table withdrew every one of them and could turn an
// unpublishable draft publishable.
//
// HOW THIS SUITE PROVES IT. Not by reading source. The repository is EXECUTED:
// `support/aliasHooks.mjs` teaches the loader the `@/` alias and swaps
// `@/lib/supabase/admin` for a stub the test controls, so every assertion below
// runs the shipped function against a database whose answers it chooses. The
// fake honours `Range` and caps a response at 1,000 rows, exactly as Production
// does, so the FOLLOW-UP F pagination path is exercised at the same time.
//
// NON-VACUITY. § 4 drives the same shipped function twice over inputs that
// differ in ONE bit — the table is empty, versus the table errors — and shows
// the two answers the old code could not tell apart. § 5 rebuilds the discarded
// `catch → return []` reader and shows it producing the wrong actionable answer
// from the identical failure. Restoring that behaviour fails §§ 1-5.
//
// NO PRIVATE DATA. Every row below is synthetic.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(HERE, '..', rel), 'utf8')

// The loader hook must be in place before the repository is imported, so the
// import is dynamic and everything below awaits it.
register('./support/aliasHooks.mjs', import.meta.url)

const repo = await import('../src/lib/db/repositories/portfolioPublicationRepository.ts')
const preview = await import('../src/lib/familyPortfolio/importPreviewServer.ts')

// ──────────────────────────────────────────────────────────────────────────
// The fake database.
//
// One script per table: rows to serve, or an error to raise. `range` slices and
// caps at 1,000 the way PostgREST does; an awaited chain returns the whole set.
// Every builder method that the repositories chain is present and returns the
// same builder, so no call site has to be shaped specially for the test.
// ──────────────────────────────────────────────────────────────────────────

interface TableScript {
  rows?: Record<string, unknown>[]
  error?: string
}

const SERVER_ROW_CAP = 1000

function fakeAdminClient(tables: Record<string, TableScript>) {
  const seen: string[] = []

  const answerAll = (table: string) => {
    const script = tables[table] ?? { rows: [] }
    if (script.error !== undefined) return { data: null, error: { message: script.error } }
    return { data: script.rows ?? [], error: null }
  }

  const answerRange = (table: string, from: number, to: number) => {
    const script = tables[table] ?? { rows: [] }
    if (script.error !== undefined) return { data: null, error: { message: script.error } }
    const rows = script.rows ?? []
    const end = Math.min(to + 1, from + SERVER_ROW_CAP, rows.length)
    return { data: rows.slice(from, Math.max(from, end)), error: null }
  }

  const builderFor = (table: string) => {
    seen.push(table)
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'gt', 'gte', 'lt', 'lte', 'order', 'limit', 'neq']) {
      chain[method] = () => chain
    }
    chain.range = async (from: number, to: number) => answerRange(table, from, to)
    chain.maybeSingle = async () => answerAll(table)
    chain.single = async () => answerAll(table)
    // Thenable, so `await client.from(t).select(c).eq(a, b)` resolves.
    chain.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(answerAll(table)).then(onFulfilled, onRejected)
    return chain
  }

  return {
    client: {
      from: (table: string) => builderFor(table),
      rpc: async () => ({ data: null, error: { message: 'no rpc in this suite' } }),
      storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'no storage' } }) }) },
    },
    tablesRead: seen,
  }
}

function install(tables: Record<string, TableScript>) {
  const { client, tablesRead } = fakeAdminClient(tables)
  ;(globalThis as Record<string, unknown>).__NMI_TEST_ADMIN_CLIENT__ = client
  return tablesRead
}

function installNothing() {
  delete (globalThis as Record<string, unknown>).__NMI_TEST_ADMIN_CLIENT__
}

const publicationRow = (asOfDate: string, extra: Record<string, unknown> = {}) => ({
  id: `pub-${asOfDate}`,
  upload_id: `up-${asOfDate}`,
  upload_kind: 'portfolio',
  as_of_date: asOfDate,
  revision: 1,
  is_current: true,
  superseded_by: null,
  published_at: `${asOfDate}T12:00:00.000Z`,
  admin_note: null,
  parser_version: 'test',
  ...extra,
})

const uploadRow = (id: string) => ({
  id,
  upload_kind: 'portfolio',
  original_filename: `${id}.xlsx`,
  storage_object_path: `private/${id}.xlsx`,
  file_sha256: 'a'.repeat(64),
  file_size_bytes: 1,
  status: 'parsed',
  uploaded_at: '2026-09-04T12:00:00.000Z',
  detected_as_of_date: '2026-09-04',
  confirmed_as_of_date: null,
  date_override_note: null,
  parser_version: 'test',
})

const operationRow = (id: string) => ({
  id,
  upload_id: `up-${id}`,
  as_of_date: '2026-09-04',
  publication_id: `pub-${id}`,
  previous_publication_id: null,
  plan_version: 'test',
  counts: {},
  correction_authorized: false,
  correction_reason: null,
  created_at: '2026-09-04T12:00:00.000Z',
  rolled_back_at: null,
  rollback_note: null,
})

const READ_FAILURE = 'connection terminated unexpectedly'

// ──────────────────────────────────────────────────────────────────────────
describe('FOLLOW-UP G § 1 · a valid empty table still answers empty', () => {
  test('listPublications: an empty ledger is a successful empty answer', async () => {
    install({ portfolio_publications: { rows: [] } })
    const result = await repo.listPublications()
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok === true ? result.publications : null, [])
  })

  test('listUploads: an empty table is a successful empty answer', async () => {
    install({ portfolio_source_uploads: { rows: [] } })
    const result = await repo.listUploads()
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok === true ? result.uploads : null, [])
  })

  test('listImportOperations: an empty ledger is a successful empty answer', async () => {
    install({ portfolio_import_operations: { rows: [] } })
    const result = await repo.listImportOperations()
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok === true ? result.operations : null, [])
  })

  test('getUploadFindings: an upload with no findings is a successful empty answer', async () => {
    install({ portfolio_upload_findings: { rows: [] } })
    const result = await repo.getUploadFindings('up-1')
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok === true ? result.findings : null, [])
  })
})

// ──────────────────────────────────────────────────────────────────────────
describe('FOLLOW-UP G § 2 · a failed read is an explicit failure', () => {
  test('listPublications refuses, and does NOT answer []', async () => {
    install({ portfolio_publications: { error: READ_FAILURE } })
    const result = await repo.listPublications()
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.code : null, 'rpc_failed')
    // The shape carries no rows at all — there is nothing a caller could read as
    // a book with no publications in it.
    assert.ok(!('publications' in result))
  })

  test('listUploads refuses, and does NOT answer []', async () => {
    install({ portfolio_source_uploads: { error: READ_FAILURE } })
    const result = await repo.listUploads()
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.code : null, 'rpc_failed')
    assert.ok(!('uploads' in result))
  })

  test('listImportOperations refuses, and does NOT answer []', async () => {
    install({ portfolio_import_operations: { error: READ_FAILURE } })
    const result = await repo.listImportOperations()
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.code : null, 'rpc_failed')
    assert.ok(!('operations' in result))
  })

  test('getUploadFindings refuses, so a blocking finding can never go missing', async () => {
    install({ portfolio_upload_findings: { error: READ_FAILURE } })
    const result = await repo.getUploadFindings('up-1')
    assert.equal(result.ok, false)
    assert.equal(result.ok === false ? result.code : null, 'rpc_failed')
    assert.ok(!('findings' in result))
  })

  test('an unconfigured database is its own explicit code, never an empty book', async () => {
    installNothing()
    for (const result of [
      await repo.listPublications(),
      await repo.listUploads(),
      await repo.listImportOperations(),
      await repo.getUploadFindings('up-1'),
    ]) {
      assert.equal(result.ok, false)
      assert.equal(result.ok === false ? result.code : null, 'not_configured')
    }
  })

  test('the driver message never escapes: the reason is a code, not prose', async () => {
    install({ portfolio_publications: { error: 'relation "portfolio_publications" does not exist' } })
    const result = await repo.listPublications()
    assert.equal(result.ok, false)
    const reason = result.ok === false && result.code === 'rpc_failed' ? result.reason : ''
    assert.ok(!/relation|does not exist/.test(reason), 'no driver text may be echoed')
  })
})

// ──────────────────────────────────────────────────────────────────────────
describe('FOLLOW-UP G § 3 · every planner consumer of the ledger fails closed', () => {
  test('getStandingPublicationPayload refuses rather than reporting "nothing stands here"', async () => {
    install({ portfolio_publications: { error: READ_FAILURE } })
    const result = await repo.getStandingPublicationPayload('2026-09-04')
    assert.equal(result.ok, false)
    // The dangerous answer would have been `{ ok: true, payload: null }`, which
    // the caller reads as "there is plainly something to publish".
    assert.ok(!('payload' in result))
  })

  test('listStandingPublicationPayloads refuses rather than reporting zero restatements', async () => {
    install({ portfolio_publications: { error: READ_FAILURE } })
    const result = await repo.listStandingPublicationPayloads(['2026-08-28', '2026-09-04'])
    assert.equal(result.ok, false)
    // The dangerous answer would have been `{ ok: true, payloads: [] }`: no week
    // is published, therefore no week is restated, therefore no authorization is
    // required for an import that overwrites settled history.
    assert.ok(!('payloads' in result))
  })

  test('planImportForDraft refuses: an unknown endpoint cannot classify NEW or GAP_FILL', async () => {
    install({
      portfolio_evolution_observations: { rows: [] },
      portfolio_publications: { error: READ_FAILURE },
    })
    const plan = await preview.planImportForDraft(minimalDraft())
    assert.equal(plan.ok, false)
    assert.equal(plan.ok === false ? plan.code : null, 'publication_ledger_read_failed')
    // Nothing an administrator could act on came back.
    assert.ok(!('preview' in plan))
    assert.ok(!('plan' in plan))
  })

  test('a failed evolution read still refuses, unchanged by this stage', async () => {
    install({ portfolio_evolution_observations: { error: READ_FAILURE } })
    const plan = await preview.planImportForDraft(minimalDraft())
    assert.equal(plan.ok, false)
    assert.equal(plan.ok === false ? plan.code : null, 'evolution_read_failed')
  })
})

// ──────────────────────────────────────────────────────────────────────────
describe('FOLLOW-UP G § 4 · the two facts the old code could not tell apart', () => {
  // Same shipped function, same call, ONE bit different in what the database
  // did. Before this stage both produced the identical `[]` and therefore the
  // identical downstream decision.

  test('empty ledger versus failed ledger now diverge in getStandingPublicationPayload', async () => {
    install({ portfolio_publications: { rows: [] } })
    const onEmpty = await repo.getStandingPublicationPayload('2026-09-04')
    install({ portfolio_publications: { error: READ_FAILURE } })
    const onFailure = await repo.getStandingPublicationPayload('2026-09-04')

    assert.deepEqual(onEmpty, { ok: true, payload: null }, 'an empty book still answers honestly')
    assert.equal(onFailure.ok, false, 'an unreadable book refuses')
    assert.notDeepEqual(onEmpty, onFailure)
  })

  test('empty ledger versus failed ledger now diverge in planImportForDraft', async () => {
    install({
      portfolio_evolution_observations: { rows: [] },
      portfolio_publications: { rows: [] },
      portfolio_row_history: { rows: [] },
      portfolio_performance_history: { rows: [] },
    })
    // The empty book carries straight past the ledger read into the payload
    // build, where this deliberately skeletal draft has nothing to offer. That
    // it gets that far is the point: emptiness does not refuse.
    const onEmpty = await preview
      .planImportForDraft(minimalDraft())
      .then((r) => (r.ok ? 'planned' : r.code))
      .catch(() => 'proceeded past the ledger read')

    install({
      portfolio_evolution_observations: { rows: [] },
      portfolio_publications: { error: READ_FAILURE },
    })
    const onFailure = await preview.planImportForDraft(minimalDraft())

    assert.equal(onFailure.ok, false)
    assert.equal(onFailure.ok === false ? onFailure.code : null, 'publication_ledger_read_failed')
    // The refusal is caused by the FAILURE, never by the emptiness. That is the
    // whole distinction, and before this stage it did not exist.
    assert.notEqual(onEmpty, 'publication_ledger_read_failed')
  })

  test('a readable ledger is still read whole, through the capped server', async () => {
    // 2,400 publications over a 1,000-row cap: three pages plus the empty one.
    // A successful read is unchanged by this stage in every respect but shape.
    const rows = Array.from({ length: 2400 }, (_, i) =>
      publicationRow(`20${20 + Math.floor(i / 400)}-01-${String((i % 28) + 1).padStart(2, '0')}`, {
        id: `pub-${i}`,
      }),
    )
    install({ portfolio_publications: { rows } })
    const result = await repo.listPublications()
    assert.equal(result.ok, true)
    const publications = result.ok === true ? result.publications : []
    assert.equal(publications.length, 2400)
    assert.equal(new Set(publications.map((p) => p.id)).size, 2400, 'no duplicate, no skip')
  })

  test('a readable ledger maps every field exactly as before', async () => {
    install({ portfolio_publications: { rows: [publicationRow('2026-09-04')] } })
    const result = await repo.listPublications()
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok === true ? result.publications : null, [
      {
        id: 'pub-2026-09-04',
        uploadId: 'up-2026-09-04',
        uploadKind: 'portfolio',
        asOfDate: '2026-09-04',
        revision: 1,
        isCurrent: true,
        supersededBy: null,
        publishedAt: '2026-09-04T12:00:00.000Z',
        adminNote: null,
        parserVersion: 'test',
      },
    ])
  })

  test('a readable upload list still drops the opaque storage key', async () => {
    install({ portfolio_source_uploads: { rows: [uploadRow('up-1')] } })
    const result = await repo.listUploads()
    assert.equal(result.ok, true)
    const uploads = result.ok === true ? result.uploads : []
    assert.equal(uploads.length, 1)
    assert.ok(!('storageObjectPath' in uploads[0]))
    assert.equal(uploads[0].originalFilename, 'up-1.xlsx')
  })

  test('a readable operation ledger maps every field exactly as before', async () => {
    install({ portfolio_import_operations: { rows: [operationRow('op-1')] } })
    const result = await repo.listImportOperations()
    assert.equal(result.ok, true)
    const operations = result.ok === true ? result.operations : []
    assert.equal(operations.length, 1)
    assert.equal(operations[0].id, 'op-1')
    assert.equal(operations[0].correctionAuthorized, false)
    assert.equal(operations[0].rolledBackAt, null)
  })
})

// ──────────────────────────────────────────────────────────────────────────
describe('FOLLOW-UP G § 5 · the discarded reader, and what it would still do', () => {
  // The old body, rebuilt exactly: page the table, swallow the error, answer
  // with whatever was collected. Driving it from the SAME failing database the
  // shipped function refuses shows the defect is real and not merely historical.

  async function legacyListPublications(): Promise<{ asOfDate: string; isCurrent: boolean }[]> {
    const client = (globalThis as Record<string, unknown>).__NMI_TEST_ADMIN_CLIENT__ as {
      from: (t: string) => {
        select: () => { order: () => { order: () => { order: () => { range: (a: number, b: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }> } } } }
      }
    } | undefined
    if (client === undefined) return []
    const rows: Record<string, unknown>[] = []
    let from = 0
    for (;;) {
      const { data, error } = await client
        .from('portfolio_publications')
        .select()
        .order()
        .order()
        .order()
        .range(from, from + 999)
      // ← THE DISCARDED LINE: a failure answers with a list.
      if (error) return rows.map((r) => ({ asOfDate: String(r.as_of_date), isCurrent: r.is_current === true }))
      const batch = data ?? []
      if (batch.length === 0) break
      rows.push(...batch)
      from += batch.length
    }
    return rows.map((r) => ({ asOfDate: String(r.as_of_date), isCurrent: r.is_current === true }))
  }

  /** The endpoint derivation exactly as `planImportForDraft` performs it. */
  const endpointOf = (publications: { asOfDate: string; isCurrent: boolean }[]) =>
    publications.filter((p) => p.isCurrent).map((p) => p.asOfDate).sort().pop() ?? null

  test('the discarded reader turns an unreadable ledger into a null endpoint', async () => {
    install({ portfolio_publications: { error: READ_FAILURE } })
    const legacy = await legacyListPublications()
    assert.deepEqual(legacy, [], 'the old body answers with a list')
    assert.equal(endpointOf(legacy), null, 'and the endpoint is unknowable but reported as null')
  })

  test('a null endpoint reclassifies settled weeks as NEW — the harm, stated plainly', async () => {
    // With the true endpoint at 2026-09-04, a 2026-08-28 week sits BELOW it and
    // is a GAP_FILL. With the endpoint lost to a swallowed failure, the same week
    // sits above nothing and reads as a brand-new week.
    const real = [
      { asOfDate: '2026-08-28', isCurrent: true },
      { asOfDate: '2026-09-04', isCurrent: true },
    ]
    const classify = (endpoint: string | null, week: string) =>
      endpoint !== null && week <= endpoint ? 'GAP_FILL' : 'NEW'

    assert.equal(classify(endpointOf(real), '2026-08-28'), 'GAP_FILL')
    assert.equal(classify(endpointOf([]), '2026-08-28'), 'NEW')
  })

  test('the shipped reader refuses on the very same failure', async () => {
    install({ portfolio_publications: { error: READ_FAILURE } })
    const shipped = await repo.listPublications()
    assert.equal(shipped.ok, false, 'if the discarded line were restored, this fails')
  })
})

// ──────────────────────────────────────────────────────────────────────────
describe('FOLLOW-UP G § 6 · the discredited form is gone from the module', () => {
  const PUB_REPO = read('src/lib/db/repositories/portfolioPublicationRepository.ts')

  /** The body of one exported function, from its signature to the next one. */
  function bodyOf(name: string): string {
    const start = PUB_REPO.indexOf(`export async function ${name}`)
    assert.ok(start > 0, `${name} must exist`)
    const next = PUB_REPO.indexOf('\nexport ', start + 1)
    return PUB_REPO.slice(start, next === -1 ? PUB_REPO.length : next)
  }

  for (const name of ['listPublications', 'listUploads', 'listImportOperations', 'getUploadFindings']) {
    test(`${name} never answers a collection where it means a failure`, () => {
      const body = bodyOf(name)
      assert.ok(!/return \[\]/.test(body), 'an empty list is never a failure answer')
      assert.ok(!/return null/.test(body), 'null is never a failure answer')
      assert.match(body, /return \{ ok: false, code: 'not_configured' \}/)
      assert.match(body, /code: 'rpc_failed'/)
      assert.match(body, /ok: false/)
      assert.match(body, /return \{[\s\S]{0,24}ok: true/)
    })
  }

  test('both planner consumers check `.ok` before reading the ledger', () => {
    for (const consumer of ['getStandingPublicationPayload', 'listStandingPublicationPayloads']) {
      const body = bodyOf(consumer)
      assert.match(body, /const publications = await listPublications\(\)/)
      assert.match(body, /if \(!publications\.ok\) return publications/,
        `${consumer} must propagate the refusal`)
    }
  })

  test('the planner refuses on the ledger read, by its own named code', () => {
    const server = read('src/lib/familyPortfolio/importPreviewServer.ts')
    assert.match(server, /code: 'publication_ledger_read_failed'/)
    assert.match(server, /if \(!publications\.ok\)/)
    // The endpoint is derived from the CHECKED value, never from the wrapper.
    assert.match(server, /publications\.publications[\s\S]{0,80}filter\(/)
  })

  test('the publish gate refuses on an unreadable findings table', () => {
    const publish = read('src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts')
    assert.match(publish, /if \(!stored\.ok\)/)
    assert.match(publish, /findings_read_failed/)
    assert.match(publish, /summarizeDraft\(loaded\.draft, stored\.findings, decisions\)/)

    const review = read('src/lib/familyPortfolio/draftReview.ts')
    assert.match(review, /if \(!stored\.ok\)/)
    assert.match(review, /code: 'findings_read_failed'/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
describe('FOLLOW-UP G § 7 · the console shows an honest unavailable state', () => {
  const ROUTE = read('src/app/api/family-portfolio/admin/uploads/route.ts')
  const PAGE = read('src/app/portfolio/admin/page.tsx')

  test('the index route refuses rather than serving three empty tables', () => {
    const get = ROUTE.slice(ROUTE.indexOf('export async function GET'), ROUTE.indexOf('export async function POST'))
    assert.ok(get.length > 0)
    assert.match(get, /if \(!uploadsRead\.ok \|\| !publicationsRead\.ok \|\| !operationsRead\.ok\)/)
    assert.match(get, /console_read_failed/)
    assert.match(get, /503/)
  })

  test('it does not crash the console: the payload shape on success is unchanged', () => {
    const get = ROUTE.slice(ROUTE.indexOf('export async function GET'), ROUTE.indexOf('export async function POST'))
    assert.match(get, /NextResponse\.json\(\{ uploads, publications, importOperations \}/)
    assert.match(get, /const uploads = uploadsRead\.uploads/)
    assert.match(get, /const publications = publicationsRead\.publications/)
    assert.match(get, /const importOperations = operationsRead\.operations/)
  })

  test('the console renders the reason, not a bare code and not an empty table', () => {
    assert.match(PAGE, /loadError \?\? a\.error/)
    assert.match(PAGE, /setLoadError\(/)
    // The tables render only in the ready state, so a failed load can never put
    // an authoritative-looking empty history on screen.
    assert.match(PAGE, /\{state === 'ready' && \(/)
  })

  test('both languages explain every new refusal', () => {
    const i18n = read('src/lib/i18n.ts')
    for (const key of ['console_read_failed', 'findings_read_failed', 'publication_ledger_read_failed']) {
      const hits = i18n.split(`${key}:`).length - 1
      assert.equal(hits, 2, `${key} must be written in English and in Spanish`)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────
describe('FOLLOW-UP G § 8 · nothing else changed', () => {
  test('no write path, authorization gate or classification rule moved', () => {
    const server = read('src/lib/familyPortfolio/importPreviewServer.ts')
    // The correction gate and the classification vocabulary are untouched.
    assert.match(server, /historicalCorrectionAuthorized/)
    assert.match(server, /historicalRestatements/)
    const PUB_REPO = read('src/lib/db/repositories/portfolioPublicationRepository.ts')
    assert.match(PUB_REPO, /nmi_import_portfolio_workbook|callRpc/)
  })

  test('the member-facing read repository was already fail-closed and is untouched', () => {
    const member = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')
    const failures = member.split("code: 'read_failed'").length - 1
    assert.ok(failures >= 10, 'every member read still refuses explicitly')
    assert.ok(!/catch\s*\([^)]*\)\s*\{\s*return \[\]/.test(member))
  })

  test('the pagination invariant from FOLLOW-UP F is still the only termination rule', () => {
    const pagination = read('src/lib/db/pagination.ts')
    assert.match(pagination, /if \(batch\.length === 0\) return \{ ok: true, rows, pages \}/)
    assert.match(pagination, /from \+= batch\.length/)
    // The discredited comparison survives in the header ONLY as the quoted rule
    // the file exists to refuse. Anywhere else it would be live code again.
    for (const line of pagination.split('\n')) {
      if (!/\.length < /.test(line)) continue
      assert.match(line.trim(), /^\/\//, 'the discredited rule may only appear in a comment')
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────
// A draft that is just complete enough to reach the ledger read. Everything
// beyond that point is exercised by the existing planner suites; what matters
// here is which refusal comes back and that no plan does.
function minimalDraft() {
  return {
    upload: uploadRow('up-1'),
    bytes: Buffer.alloc(0),
    resumen: { findings: [], scopes: [] },
    alternatives: null,
    frozen: { publicationDate: null, refusal: null, columns: [] },
    historicalPayloads: new Map(),
  } as never as Parameters<typeof preview.planImportForDraft>[0]
}
