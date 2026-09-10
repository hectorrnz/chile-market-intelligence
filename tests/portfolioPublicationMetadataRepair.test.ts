// POST-R13.8 FOLLOW-UP F — the bounded publication-metadata repair mechanism.
//
// TWO HALVES, AND THIS IS ONLY ONE OF THEM. Atomicity, the late-failure
// rollback, idempotency, financial invariance and the EXECUTE privilege are
// properties of a real database and are proven in
// `supabase/tests/database/portfolio_publication_metadata_repair_test.sql`,
// which runs against an isolated PostgreSQL stack in CI. This file proves the
// half that lives in TypeScript: that the packet is derived rather than typed
// in, that its identity is deterministic, that the orchestrator cannot apply by
// accident, that it has exactly one write path, and that the migration's
// security posture is what it claims to be.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  REPAIRABLE_METADATA_FIELDS,
  METADATA_REPAIR_RPC,
  buildMetadataRepairPacket,
  canonicalizeMetadataRepairPacket,
  hashMetadataRepairPacket,
  validateMetadataRepairPacket,
  previousSourceReportingDate,
  type MetadataRepairEntry,
  type MetadataRepairPacket,
} from '../src/lib/familyPortfolio/publicationMetadataRepair.ts'

const MIGRATION = readFileSync(
  'supabase/migrations/20260823000000_portfolio_publication_metadata_repair.sql',
  'utf8',
)
const ORCHESTRATOR = readFileSync('scripts/portfolio/repairPublicationMetadata.ts', 'utf8')
const PGTAP = readFileSync(
  'supabase/tests/database/portfolio_publication_metadata_repair_test.sql',
  'utf8',
)
const PACKET_MODULE = readFileSync('src/lib/familyPortfolio/publicationMetadataRepair.ts', 'utf8')
const AUTHORIZATION = JSON.parse(
  readFileSync('scripts/portfolio/previousWeekDateRepair.expected.json', 'utf8'),
) as { field: string; corrections: Array<{ asOfDate: string; expectedRevision: number; expectedValue: string; correctedValue: string }> }

/** Comment-stripped TS source, so a rule is never satisfied by prose describing it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

/**
 * Comment-stripped SQL. Essential rather than tidy: the migration's header
 * explains at length that the function never writes a financial table, so a
 * check for those statements against the raw file would fail on the very
 * sentence promising they are absent.
 */
function sqlCode(src: string): string {
  return src.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '')
}

const uuidAt = (n: number) => `0000000${n}-0000-4000-8000-000000000000`

function entry(over: Partial<MetadataRepairEntry> = {}, n = 1): MetadataRepairEntry {
  return {
    publicationId: uuidAt(n),
    asOfDate: '2026-06-19',
    expectedRevision: 2,
    expectedIsCurrent: true,
    expectedUploadKind: 'portfolio',
    expectedValue: '2026-08-28',
    correctedValue: '2026-06-12',
    ...over,
  }
}

function packet(entries: MetadataRepairEntry[]): MetadataRepairPacket {
  return buildMetadataRepairPacket(entries, {
    operationId: 'op-1',
    actor: 'H Martinez',
    reason: 'Correct previousWeekDate metadata written during the R13.8 historical restatement.',
    field: 'previousWeekDate',
  })
}

// ---------------------------------------------------------------------------
describe('POST-R13.8F · the repairable-key allowlist', () => {
  it('is exactly the two spine anchors, in both the module and the database', () => {
    assert.deepEqual([...REPAIRABLE_METADATA_FIELDS], ['previousWeekDate', 'beginningOfYearDate'])
    // The SQL function is the enforcement point; the constant must not drift.
    const fn = MIGRATION.match(
      /nmi_portfolio_repairable_metadata_fields\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$/,
    )
    assert.ok(fn, 'the allowlist function is defined in the migration')
    for (const f of REPAIRABLE_METADATA_FIELDS) assert.match(fn[1], new RegExp(`'${f}'`))
  })

  it('excludes every key that is not a checkable spine anchor', () => {
    for (const forbidden of ['parserVersion', 'importOperationId', 'correctionReason', 'revision']) {
      assert.ok(!(REPAIRABLE_METADATA_FIELDS as readonly string[]).includes(forbidden))
    }
  })
})

// ---------------------------------------------------------------------------
describe('POST-R13.8F · packet identity is deterministic', () => {
  it('hashes the same content identically regardless of construction order', () => {
    const a = packet([entry({ asOfDate: '2026-06-19', correctedValue: '2026-06-12' }, 1),
                      entry({ asOfDate: '2026-06-26', correctedValue: '2026-06-19' }, 2)])
    const b = packet([entry({ asOfDate: '2026-06-26', correctedValue: '2026-06-19' }, 2),
                      entry({ asOfDate: '2026-06-19', correctedValue: '2026-06-12' }, 1)])
    assert.equal(a.packetHash, b.packetHash)
    assert.equal(canonicalizeMetadataRepairPacket(a), canonicalizeMetadataRepairPacket(b))
  })

  it('changes the hash when any corrected value changes', () => {
    const a = packet([entry()])
    const b = packet([entry({ correctedValue: '2026-06-05' })])
    assert.notEqual(a.packetHash, b.packetHash)
  })

  it('excludes the hash from its own input', () => {
    const p = packet([entry()])
    assert.ok(!canonicalizeMetadataRepairPacket(p).includes(p.packetHash))
    assert.equal(hashMetadataRepairPacket(p), p.packetHash)
  })

  it('sorts entries by week so a differently-ordered read still retries cleanly', () => {
    const p = packet([entry({ asOfDate: '2026-07-03', correctedValue: '2026-06-26' }, 3),
                      entry({ asOfDate: '2026-06-19', correctedValue: '2026-06-12' }, 1)])
    assert.deepEqual(p.entries.map((e) => e.asOfDate), ['2026-06-19', '2026-07-03'])
  })
})

// ---------------------------------------------------------------------------
describe('POST-R13.8F · packet validation refuses what the database would', () => {
  it('accepts a well-formed packet', () => {
    assert.deepEqual(validateMetadataRepairPacket(packet([entry()])), [])
  })

  it('refuses a corrected anchor that is not strictly before its own week', () => {
    const equal = validateMetadataRepairPacket(packet([entry({ correctedValue: '2026-06-19' })]))
    assert.ok(equal.some((e) => e.includes('not strictly before')))
    const after = validateMetadataRepairPacket(packet([entry({ correctedValue: '2026-08-28' })]))
    assert.ok(after.some((e) => e.includes('not strictly before')))
  })

  it('refuses a correction that would write the value already stored', () => {
    const errs = validateMetadataRepairPacket(
      packet([entry({ expectedValue: '2026-06-12', correctedValue: '2026-06-12' })]),
    )
    assert.ok(errs.some((e) => e.includes('nothing to correct')))
  })

  it('refuses a field outside the allowlist', () => {
    const p = { ...packet([entry()]), field: 'parserVersion' } as unknown as MetadataRepairPacket
    const errs = validateMetadataRepairPacket({ ...p, packetHash: hashMetadataRepairPacket(p) })
    assert.ok(errs.some((e) => e.includes('is not repairable')))
  })

  it('refuses a placeholder reason', () => {
    const p = buildMetadataRepairPacket([entry()], {
      operationId: 'op-1', actor: 'H Martinez', reason: 'fix', field: 'previousWeekDate',
    })
    assert.ok(validateMetadataRepairPacket(p).some((e) => e.includes('at least 20 characters')))
  })

  it('refuses the same publication twice', () => {
    const p = packet([entry({}, 1), entry({ asOfDate: '2026-06-26', correctedValue: '2026-06-19' }, 1)])
    assert.ok(validateMetadataRepairPacket(p).some((e) => e.includes('more than once')))
  })

  it('refuses a count that disagrees with the entries', () => {
    const p = { ...packet([entry()]), expectedCount: 7 }
    assert.ok(validateMetadataRepairPacket(p).some((e) => e.includes('does not match')))
  })

  it('refuses a tampered hash', () => {
    const p = { ...packet([entry()]), packetHash: 'deadbeef' }
    assert.ok(validateMetadataRepairPacket(p).some((e) => e.includes('does not match the packet content')))
  })
})

// ---------------------------------------------------------------------------
describe('POST-R13.8F · the corrected date is DERIVED from the source spine', () => {
  const spine = [
    '2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26',
    '2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31',
  ]

  it('returns the greatest reporting date strictly before the week', () => {
    assert.equal(previousSourceReportingDate(spine, '2026-06-19'), '2026-06-12')
    assert.equal(previousSourceReportingDate(spine, '2026-07-31'), '2026-07-24')
  })

  it('never returns the week itself', () => {
    for (const d of spine) assert.notEqual(previousSourceReportingDate(spine, d), d)
  })

  it('returns null rather than guessing at the earliest week the source has', () => {
    assert.equal(previousSourceReportingDate(spine, '2026-06-05'), null)
    assert.equal(previousSourceReportingDate([], '2026-06-19'), null)
  })

  it('is order-independent', () => {
    assert.equal(previousSourceReportingDate([...spine].reverse(), '2026-07-03'), '2026-06-26')
  })

  it('reproduces every corrected date the owner authorized', () => {
    // NON-VACUITY: the derivation is run against the spine, and its answer must
    // equal the authorization line by line. If the two ever disagree the
    // orchestrator STOPS — this asserts they currently agree.
    for (const c of AUTHORIZATION.corrections) {
      assert.equal(
        previousSourceReportingDate(spine, c.asOfDate),
        c.correctedValue,
        `${c.asOfDate} derives to its authorized predecessor`,
      )
    }
  })
})

// ---------------------------------------------------------------------------
describe('POST-R13.8F · the authorized correction set', () => {
  it('is the seven weeks the brief names, for previousWeekDate only', () => {
    assert.equal(AUTHORIZATION.field, 'previousWeekDate')
    assert.equal(AUTHORIZATION.corrections.length, 7)
    assert.deepEqual(
      AUTHORIZATION.corrections.map((c) => c.asOfDate),
      ['2026-06-19', '2026-06-26', '2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31'],
    )
  })

  it('records the same impossible anchor on every one of them', () => {
    for (const c of AUTHORIZATION.corrections) assert.equal(c.expectedValue, '2026-08-28')
  })

  it('proposes only anchors strictly earlier than their own week', () => {
    for (const c of AUTHORIZATION.corrections) assert.ok(c.correctedValue < c.asOfDate)
  })

  it('carries the revision each week actually stands at', () => {
    const byDate = Object.fromEntries(AUTHORIZATION.corrections.map((c) => [c.asOfDate, c.expectedRevision]))
    assert.equal(byDate['2026-06-19'], 2)
    assert.equal(byDate['2026-07-31'], 4)
    for (const d of ['2026-06-26', '2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24']) {
      assert.equal(byDate[d], 3)
    }
  })
})

// ---------------------------------------------------------------------------
describe('POST-R13.8F · the orchestrator has exactly one write path', () => {
  const src = code(ORCHESTRATOR)

  it('calls the repair RPC and nothing else', () => {
    assert.match(src, new RegExp(`rpc\\(\\s*METADATA_REPAIR_RPC`))
    assert.equal(METADATA_REPAIR_RPC, 'nmi_repair_portfolio_publication_metadata')
    const rpcCalls = src.match(/\.rpc\(/g) ?? []
    assert.equal(rpcCalls.length, 1, 'exactly one RPC call exists in the tool')
  })

  it('contains no per-table write, so a failed apply cannot degrade into partial writes', () => {
    for (const forbidden of ['.update(', '.insert(', '.upsert(', '.delete(']) {
      assert.ok(!src.includes(forbidden), `the orchestrator must not contain ${forbidden}`)
    }
  })

  it('defaults to validate-only and gates applying behind four separate flags', () => {
    for (const flag of ['--apply', '--expect-project-ref', '--confirm', '--operation-id', '--actor']) {
      assert.ok(src.includes(flag), `${flag} is required by the tool`)
    }
    assert.match(src, /APPLY-METADATA-REPAIR/)
    assert.match(src, /projectRef mismatch|project ref mismatch/i)
  })

  it('derives the corrected date and refuses when the derivation disagrees with the authorization', () => {
    assert.match(src, /previousSourceReportingDate\(spine, want\.asOfDate\)/)
    assert.match(src, /derives to \$\{derived\}|derives to/)
    assert.ok(!/correctedValue:\s*want\.correctedValue/.test(src),
      'the packet must carry the DERIVED value, never the authorized one')
    assert.match(src, /correctedValue:\s*derived/)
  })

  it('refuses when production no longer matches the reviewed plan', () => {
    assert.match(src, /PLAN DOES NOT MATCH PRODUCTION/)
    assert.match(src, /Nothing was sent/)
  })

  it('uses extensionless-free relative imports, so plain node can run it', () => {
    const rel = [...src.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1])
    assert.ok(rel.length > 0)
    for (const r of rel) assert.ok(r.endsWith('.ts'), `${r} must carry an explicit .ts extension`)
  })
})

// ---------------------------------------------------------------------------
describe('POST-R13.8F · the migration security posture', () => {
  const sql = sqlCode(MIGRATION)

  it('is SECURITY INVOKER with a pinned search_path', () => {
    assert.match(sql, /create or replace function public\.nmi_repair_portfolio_publication_metadata/)
    assert.match(sql, /security invoker/)
    assert.match(sql, /set search_path = ''/)
    assert.ok(!/security definer/i.test(sql), 'the repair function is never SECURITY DEFINER')
  })

  it('grants EXECUTE to service_role only', () => {
    assert.match(sql, /revoke all on function public\.nmi_repair_portfolio_publication_metadata\(jsonb\)\s*\n?\s*from public, anon, authenticated/)
    assert.match(sql, /grant execute on function public\.nmi_repair_portfolio_publication_metadata\(jsonb\) to service_role/)
  })

  it('never writes a financial table', () => {
    for (const t of ['portfolio_snapshot_rows', 'portfolio_performance_rows', 'portfolio_evolution_observations']) {
      assert.ok(!new RegExp(`update\\s+public\\.${t}`, 'i').test(sql), `no update against ${t}`)
      assert.ok(!new RegExp(`insert\\s+into\\s+public\\.${t}`, 'i').test(sql), `no insert into ${t}`)
      assert.ok(!new RegExp(`delete\\s+from\\s+public\\.${t}`, 'i').test(sql), `no delete from ${t}`)
    }
  })

  it('updates only portfolio_publications, and only its metadata column', () => {
    const updates = [...sql.matchAll(/update\s+public\.(\w+)\s+\w*\s*set\s+(\w+)/gi)]
    assert.equal(updates.length, 1, 'exactly one UPDATE statement exists')
    assert.equal(updates[0][1], 'portfolio_publications')
    assert.equal(updates[0][2], 'metadata')
  })

  it('asserts financial invariance before returning', () => {
    assert.match(sql, /repair_refused_publication_state_changed_beyond_metadata_key/)
    assert.match(sql, /snapshotSum/)
    assert.match(sql, /perfSum/)
  })

  it('refuses a corrected anchor that is not strictly before its own week', () => {
    assert.match(sql, /repair_refused_corrected_value_not_before_publication/)
    assert.match(sql, /portfolio_publication_metadata_repair_entries_before_ck/)
    assert.match(sql, /check \(corrected_value::date < as_of_date\)/)
  })

  it('is idempotent on a durable database-enforced identity', () => {
    assert.match(sql, /unique \(operation_id\)/)
    assert.match(sql, /already_applied/)
    assert.match(sql, /repair_refused_operation_id_reused_with_different_packet/)
    assert.match(sql, /pg_advisory_xact_lock/)
  })

  it('serialises on the same publication-series key the publish path uses', () => {
    assert.match(sql, /perform public\.nmi_lock_publication_series/)
  })

  it('keeps both ledgers unreadable to a member session', () => {
    assert.match(sql, /alter table public\.portfolio_publication_metadata_repairs enable row level security/)
    assert.match(sql, /alter table public\.portfolio_publication_metadata_repair_entries enable row level security/)
    assert.match(sql, /revoke all privileges on table public\.portfolio_publication_metadata_repairs\s*\n?\s*from public, anon, authenticated/)
  })

  it('contains no dynamic SQL inside the apply function', () => {
    const fn = sql.match(/create or replace function public\.nmi_repair_portfolio_publication_metadata[\s\S]*?\$fn\$;/)
    assert.ok(fn, 'the apply function body is present')
    assert.ok(!/\bexecute\b/i.test(fn[0]), 'the apply function contains no EXECUTE')
  })

  it('does not modify any already-applied migration', () => {
    // The mechanism lives in its OWN migration, after the analytical-history
    // one, precisely so nothing Production has already applied is edited.
    assert.match(MIGRATION, /apply 20260822000000 first/)
  })
})

// ---------------------------------------------------------------------------
describe('POST-R13.8F · the pgTAP suite covers § 6 A–J', () => {
  it('proves the exact packet applies (A)', () => {
    assert.match(PGTAP, /the reviewed four-entry packet applies/)
  })
  it('proves a stored-value mismatch refuses the whole packet (B)', () => {
    assert.match(PGTAP, /repair_refused_stored_value_mismatch/)
    assert.match(PGTAP, /corrected nothing and recorded nothing/)
  })
  it('proves a revision mismatch refuses (C)', () => {
    assert.match(PGTAP, /repair_refused_revision_mismatch/)
  })
  it('proves an anchor on or after its own week refuses (D)', () => {
    assert.match(PGTAP, /repair_refused_corrected_value_not_before_publication/)
  })
  it('proves a LATE failure rolls back every earlier correction (E)', () => {
    assert.match(PGTAP, /mr-late-failure/)
    assert.match(PGTAP, /rolled back -- all four anchors still read 2026-08-28/)
  })
  it('proves retry idempotency with no duplicate audit (F)', () => {
    assert.match(PGTAP, /already_applied/)
    assert.match(PGTAP, /the retry created no second audit record/)
  })
  it('proves financial invariance (G)', () => {
    assert.match(PGTAP, /financial_fingerprint/)
    assert.match(PGTAP, /byte-identical after the repair/)
  })
  it('proves member and anon cannot invoke it (H)', () => {
    assert.match(PGTAP, /an authenticated member cannot execute the repair function/)
    assert.match(PGTAP, /anon cannot execute the repair function/)
  })
  it('proves the service_role path works (I)', () => {
    assert.match(PGTAP, /service_role can execute the repair function/)
  })
  it('proves the prospective importer fix still holds (J)', () => {
    assert.match(PGTAP, /import_refused_impossible_previous_week_date/)
    assert.match(PGTAP, /carries ITS OWN anchor/)
  })
})

// ---------------------------------------------------------------------------
describe('POST-R13.8F · the pure module decides nothing', () => {
  const src = code(PACKET_MODULE)

  it('reads no database and no workbook', () => {
    for (const forbidden of ['supabase', 'createClient', 'readFileSync', 'fetch(']) {
      assert.ok(!src.includes(forbidden), `the packet module must not reference ${forbidden}`)
    }
  })

  it('hard-codes no publication id, week or corrected date', () => {
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(src), 'no literal date appears in the packet module')
  })
})
