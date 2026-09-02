// R13.7 § 28–29 — STRUCTURED NOTES RECONCILIATION DRY RUN.
//
// READ-ONLY BY CONSTRUCTION, NOT BY FLAG.
// ───────────────────────────────────────
// There is no `--apply`, no `--write`, and no boolean anywhere in this file
// that could be flipped to mutate a note. It imports no write function: the
// only repository symbols it pulls in are readers, and the reconciliation core
// (`reconciliation.ts`) has no write path at all. A production correction is a
// separately authorized stage with its own tool, operating on a report a human
// has read. Making the apply path merely "hard to reach" would still leave it
// reachable by accident; making it absent does not.
//
// Usage:
//   npx tsx scripts/reconcile/structuredNotesReconcile.ts
//   npx tsx scripts/reconcile/structuredNotesReconcile.ts --isin XS3164820824
//   npx tsx scripts/reconcile/structuredNotesReconcile.ts --json > report.json
//   npx tsx scripts/reconcile/structuredNotesReconcile.ts --as-of 2026-09-02

// @next/env is CJS. Resolved at runtime and tolerant of both interop shapes so
// the tool runs identically under `node --experimental-strip-types` and `tsx`.
import * as nextEnvNs from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { listStructuredNotes } from '../../src/lib/db/repositories/structuredNotesRepository'
import { resolveNoteValuationCloses } from '../../src/lib/structuredNotes/valuationCloseResolver'
import { reconcileNote, summarizeReconciliation, contractualAutocallSchedule, type NoteReconciliation } from '../../src/lib/structuredNotes/reconciliation'

/** The six notes a prior forensic audit flagged. Listed FIRST for review convenience — never treated as evidence: each is independently re-proved below, and may come back `not_called`. */
const REVIEW_SET = ['XS3288738696', 'XS3288776431', 'XS3165117832', 'XS3165032924', 'XS3164820824', 'XS3164749858']

type LoadEnv = (dir: string, dev?: boolean, logger?: { info: (m: string) => void; error: (m: string) => void }) => unknown

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

function pct(v: number | null, digits = 4): string {
  return v === null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
}

function renderNote(r: NoteReconciliation): string {
  const L: string[] = []
  const badge = {
    confirmed_missed_autocall: 'CONFIRMED MISSED AUTOCALL',
    not_called: 'NOT CALLED',
    insufficient_data: 'INSUFFICIENT DATA',
    contract_ambiguous: 'CONTRACT AMBIGUOUS',
  }[r.classification]

  L.push('='.repeat(100))
  L.push(`${r.isin ?? r.noteId}  ·  ${r.issuerDisplayName ?? 'issuer unavailable'}  ·  ${badge}`)
  L.push('='.repeat(100))
  L.push(`  stored status   : ${r.storedStatus}`)
  L.push(`  expected status : ${r.expectedStatus}`)
  L.push(`  rationale       : ${r.rationale}`)

  for (const d of r.perDate) {
    const outcome = d.autocall.outcome === 'met' ? 'AUTOCALL MET' : d.autocall.outcome === 'not_met' ? 'not met' : 'UNDETERMINED'
    L.push('')
    L.push(`  ── valuation date ${d.valuationDate}  [${outcome}]${d.observationSynthesized ? '   (autocall observation ABSENT from stored data — reconstructed from the contract)' : ''}`)
    if (d.redemptionDate) L.push(`     mandatory early redemption date: ${d.redemptionDate}`)
    for (const leg of d.legs) {
      const mark = leg.passed === null ? '?' : leg.passed ? '>=' : '< '
      const corr = leg.close === null ? '' : leg.corroborated ? ' [corroborated by 2 sources]' : ' [single source]'
      L.push(`     ${leg.underlyingName.padEnd(12)} close ${String(leg.close ?? 'unavailable').padEnd(14)} ${mark} call level ${String(leg.autocallLevel ?? '—').padEnd(12)} (${leg.closeSource})${corr}`)
      if (leg.disagreementPct !== null && leg.disagreementPct > 0.001) L.push(`       !! cross-source disagreement ${pct(leg.disagreementPct)} — requires review`)
    }
    const c = d.coupon?.outcome
    L.push(`     coupon test on the same date: ${c === 'met' ? 'eligible' : c === 'not_met' ? 'not eligible' : 'undetermined'}   (stored observation status: ${d.storedCouponStatus ?? 'none'})`)
  }

  if (r.classification === 'confirmed_missed_autocall') {
    L.push('')
    L.push(`  EXPECTED CALL DATE  : ${r.expectedCallDate}`)
    L.push(`  REDEMPTION DATE     : ${r.expectedRedemptionDate ?? 'not recorded'}   (settlement: ${r.settlement})`)
    L.push(`  COUPON ON CALL DATE : ${r.couponOnCallDate ?? 'n/a'}  — retained; a coupon is not lost because the note also called`)
    L.push(`  VOIDED OBSERVATIONS : ${r.voidedObservationDates.length > 0 ? r.voidedObservationDates.join(', ') : 'none'}`)
    L.push('')
    L.push('  NOTIONAL / AUM TREATMENT')
    L.push(`     ${r.proposedNotionalTreatment}`)
    L.push('')
    L.push('  NOTIFICATION RECONCILIATION')
    L.push(`     ${r.proposedNotification}`)
  }

  if (r.observationsToInsert.length > 0) {
    L.push('')
    L.push(`  ROWS THAT WOULD BE INSERTED (${r.observationsToInsert.length} autocall observations, currently absent):`)
    for (const o of r.observationsToInsert) {
      L.push(`     structured_note_observations  type=autocall  valuation_date=${o.valuationDate}  redemption_date=${o.redemptionDate ?? 'null'}  autocall_barrier_pct=${o.autocallBarrierPct}`)
    }
  }

  if (r.proposedChanges.length > 0) {
    L.push('')
    L.push('  FIELDS THAT WOULD CHANGE:')
    for (const c of r.proposedChanges) {
      L.push(`     ${c.table}.${c.field}  [${c.row}]`)
      L.push(`        from: ${JSON.stringify(c.from)}`)
      L.push(`        to  : ${JSON.stringify(c.to)}`)
    }
    L.push('')
    L.push('  AUDIT RECORD THAT WOULD BE WRITTEN:')
    L.push(`     ${JSON.stringify(r.proposedAuditRecord)}`)
  }
  return L.join('\n')
}

async function main(): Promise<void> {
  const envMod = nextEnvNs as unknown as { loadEnvConfig?: LoadEnv; default?: { loadEnvConfig?: LoadEnv } }
  const loadEnvConfig = envMod.loadEnvConfig ?? envMod.default?.loadEnvConfig
  if (!loadEnvConfig) throw new Error('@next/env did not expose loadEnvConfig')
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} })
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }
  const client = createClient(url, key, { auth: { persistSession: false } })

  const asOf = arg('--as-of') ?? new Date().toISOString().slice(0, 10)
  const onlyIsin = arg('--isin')
  const asJson = process.argv.includes('--json')

  // The full book, not only the live notes: a note already marked called must
  // also be checked, in case it was called on the WRONG date.
  const notes = await listStructuredNotes(client)
  const scope = onlyIsin ? notes.filter((n) => n.isin === onlyIsin) : notes

  // Review set first, then the rest of the book — the sweep that proves there
  // are no additional missed calls beyond the ones already reported (§ 29).
  const ordered = [
    ...REVIEW_SET.map((isin) => scope.find((n) => n.isin === isin)).filter((n): n is NonNullable<typeof n> => !!n),
    ...scope.filter((n) => !REVIEW_SET.includes(n.isin ?? '')),
  ]

  const results: NoteReconciliation[] = []
  for (const note of ordered) {
    const dates = contractualAutocallSchedule(note).map((s) => s.valuationDate).filter((d) => d <= asOf)
    const closes = dates.length > 0
      ? await resolveNoteValuationCloses(client, note, dates)
      : { byDate: new Map(), snapshots: [], history: [] }
    results.push(reconcileNote({ note, closesByDate: closes.byDate, asOf }))
  }

  if (asJson) {
    console.log(JSON.stringify({ asOf, mode: 'dry_run_read_only', summary: summarizeReconciliation(results), results }, null, 2))
    return
  }

  console.log('')
  console.log('R13.7 — STRUCTURED NOTES RECONCILIATION  ·  DRY RUN  ·  READ-ONLY')
  console.log(`as-of ${asOf} · ${results.length} notes examined · NO WRITE PATH EXISTS IN THIS TOOL`)
  console.log('')
  for (const r of results) console.log(renderNote(r) + '\n')

  const summary = summarizeReconciliation(results)
  console.log('='.repeat(100))
  console.log('SUMMARY')
  console.log('='.repeat(100))
  console.log(`  CONFIRMED MISSED AUTOCALL : ${summary.confirmed_missed_autocall}`)
  console.log(`  NOT CALLED                : ${summary.not_called}`)
  console.log(`  INSUFFICIENT DATA         : ${summary.insufficient_data}`)
  console.log(`  CONTRACT AMBIGUOUS        : ${summary.contract_ambiguous}`)
  console.log('')
  console.log('  Only CONFIRMED cases are eligible to enter a production reconciliation,')
  console.log('  and only after this report has been reviewed and separately authorized.')
  console.log('')
}

main().catch((e) => {
  console.error('Reconciliation dry run failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
