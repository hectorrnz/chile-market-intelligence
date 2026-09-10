// R13.5 — POST /api/family-portfolio/admin/uploads/[id]/publish
//
// Administrator confirmation → atomic publication (doc 05 §§ 6, 7.4).
//
// ORDER MATTERS AND IS DELIBERATE:
//   1. approved session, then administrative capability — before the body is
//      read, so an unauthorized caller cannot make this route do work or learn
//      whether an upload exists;
//   2. re-parse the stored workbook and re-derive the draft — the request never
//      supplies rows, values, dates or classifications-as-facts, only DECISIONS,
//      so a caller cannot inject a figure into the book;
//   3. resolve the publication date, refusing an unexplained override;
//   4. refuse on any blocking finding or unresolved event;
//   5. hand the whole payload to a single Postgres function, which is the
//      transaction.
//
// The database independently refuses a blocking-finding upload, an unclassified
// event and an empty payload. Steps 3-4 here are the server layer of the same
// rule, not its only enforcement (doc 05 § 2.1).
//
// NO RAW CONTENT LEAVES THE SERVER. The parsed amounts go straight from the
// parser into the RPC. The response carries identifiers, a date, a revision and
// counts.

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { loadDraft, summarizeDraft } from '@/lib/familyPortfolio/draftReview'
import {
  resolvePublicationDate,
  applyEventClassifications,
  validateEventClassifications,
  verifyPerCurrencySubtotals,
  isClassifiableEventType,
  normalizeCommentary,
  PUBLICATION_LIFECYCLE_VERSION,
  type EventClassificationDecision,
} from '@/lib/familyPortfolio/publication'
import { RESUMEN_PARSER_VERSION } from '@/lib/familyPortfolio/resumen/parseResumen'
import { ALTERNATIVES_PARSER_VERSION } from '@/lib/familyPortfolio/alternatives/parseAlternatives'
import { planImportForDraft } from '@/lib/familyPortfolio/importPreviewServer'
import { isImportFixtureId } from '@/lib/familyPortfolio/fixtures/importPreviewFixtures'
import {
  getUploadFindings,
  getPublication,
  recordConfirmedDate,
  publishAlternatives,
  upsertCommentary,
  importPortfolioWorkbook,
  stageRowHistory,
  discardRowHistoryStaging,
  stagePerformanceHistory,
  discardPerformanceHistoryStaging,
  type HoldingPayload,
  type EventPayload,
  type ImportObservationPayload,
} from '@/lib/db/repositories/portfolioPublicationRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: code, ...extra }, { status, headers: NO_STORE })
}

/** Accepts only well-formed decisions; anything else is dropped, never coerced. */
function readDecisions(raw: unknown): EventClassificationDecision[] {
  if (!Array.isArray(raw)) return []
  const out: EventClassificationDecision[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const cell = record.sourceCell
    const type = record.eventType
    if (typeof cell === 'string' && cell.length > 0 && isClassifiableEventType(type)) {
      out.push({ sourceCell: cell, eventType: type })
    }
  }
  return out
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  if (!entitlement.isAdministrator || !entitlement.userId) {
    return fail('not_authorized', 403)
  }

  const { id } = await context.params
  if (!UUID.test(id)) return fail('not_found', 404)

  // R13.8C § 12 — a review fixture is READ-ONLY, in every environment. It exists
  // in no table, so there is nothing to publish; refusing here, before the body
  // is read, means a fixture can never reach `loadDraft` or the import RPC.
  if (isImportFixtureId(id)) return fail('read_only_fixture', 403)

  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await request.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    // An absent body means "publish exactly what detection proposed".
    body = {}
  }

  // The workbook is re-downloaded and RE-PARSED here. Nothing the browser saw
  // during the preview is carried forward: not a row, not a value, not a date,
  // not a classification outcome. `loadDraft` also re-verifies the object's
  // SHA-256 against the upload record, so a publication can only ever describe
  // the exact bytes that were validated at upload time.
  const loaded = await loadDraft(id)
  if (!loaded.ok) {
    const status =
      loaded.code === 'not_found' ? 404
      : loaded.code === 'not_configured' ? 503
      : loaded.code === 'source_digest_mismatch' ? 409
      : 502
    return fail(loaded.code, status)
  }

  const decisions = readDecisions(body.eventClassifications)

  // Administrator judgement is bound to the SERVER'S OWN reparse. A decision
  // that names a cell this parse did not produce, names one twice, or overrides
  // a colour the workbook's legend already resolved is refused outright — the
  // browser may express judgement, it may not define source facts.
  const rejected = validateEventClassifications(loaded.draft.alternatives?.events ?? [], decisions)
  if (rejected.length > 0) {
    return fail('classification_refused', 422, { rejections: rejected })
  }

  // FOLLOW-UP G — the findings recorded at upload time decide publishability.
  // An unreadable table must refuse the publish, never be read as "this file had
  // no blocking findings".
  const stored = await getUploadFindings(id)
  if (!stored.ok) {
    return fail(stored.code === 'not_configured' ? 'not_configured' : 'findings_read_failed', 503)
  }
  const review = summarizeDraft(loaded.draft, stored.findings, decisions)

  // --- Date. Detection proposes; the administrator confirms; a divergence
  // requires a written justification (doc 02 § 8).
  const dateResult = resolvePublicationDate({
    detected: review.detectedAsOfDate,
    confirmed: typeof body.confirmedAsOfDate === 'string' ? body.confirmedAsOfDate : null,
    overrideNote: typeof body.overrideNote === 'string' ? body.overrideNote : null,
  })
  if (!dateResult.ok) return fail(dateResult.code, 422)

  // --- Publishability. Every reason at once, so a recalculation round-trip
  // through Excel fixes them all rather than one at a time.
  if (!review.publishable) {
    return fail('publication_refused', 409, {
      refusals: review.refusals,
      blockingFindings: review.findings.filter((f) => f.severity === 'blocking'),
      unclassifiedEventCells: review.unclassifiedEventCells,
    })
  }

  const adminNote = typeof body.adminNote === 'string' && body.adminNote.trim().length > 0
    ? body.adminNote.trim()
    : null

  const recorded = await recordConfirmedDate({
    uploadId: id,
    detected: review.detectedAsOfDate,
    confirmed: dateResult.date,
    overrideNote: dateResult.overrideNote,
  })
  if (!recorded.ok) {
    const status = recorded.code === 'not_configured' ? 503 : 500
    return fail(recorded.code === 'rpc_failed' ? recorded.reason : recorded.code, status)
  }

  const metadata = {
    lifecycleVersion: PUBLICATION_LIFECYCLE_VERSION,
    detectedAsOfDate: review.detectedAsOfDate,
    dateOverridden: dateResult.overridden,
    administratorClassifiedEvents: decisions.length,
  }

  let published:
    | { ok: true; id: string; importOperationId?: string; inserted?: number; updated?: number }
    | { ok: false; code: string; reason?: string }

  if (loaded.draft.resumen) {
    // ── R13.8B § 8 — THE ATOMIC IMPORT.
    //
    // The plan is rebuilt HERE, from the same bytes and against Production's
    // CURRENT state — never carried over from the preview the browser saw. The
    // browser may send a fingerprint of the plan it displayed and an
    // authorization decision; it may not send a classification, a date, a prior
    // value or a row.
    const correctionAuthorized = body.historicalCorrectionAuthorized === true
    const correctionReason =
      typeof body.correctionReason === 'string' && body.correctionReason.trim().length > 0
        ? body.correctionReason.trim()
        : null

    // The SAME function the preview route calls, one request later. Preview and
    // confirm cannot disagree about what Production currently holds because
    // neither of them decides it independently.
    const built = await planImportForDraft(loaded.draft, {
      historicalCorrectionAuthorized: correctionAuthorized,
      correctionReason,
    })
    if (!built.ok) {
      return fail(built.code, built.code === 'not_configured' ? 503 : 500)
    }
    const plan = built.plan

    // R13.8C.2 — THE ROWS THE PLAN WAS COMPARED AGAINST ARE THE ROWS PUBLISHED.
    //
    // `planImportForDraft` builds this payload from the same re-parsed draft and
    // diffs it against the standing publication to decide `publicationChanged`.
    // Rebuilding it here would let the no-op verdict describe one payload while
    // the RPC wrote another, and that divergence would be silent — exactly the
    // class of bug R13.8C.2 exists to close. Nothing the browser sent reaches it:
    // the draft is re-parsed on this request and its bytes re-hashed by
    // `loadDraft`.
    const rows = built.rows
    const performance = built.performance

    // --- R13.8B § 9: STALE PREVIEW. The fingerprint covers every assertion the
    // plan makes about Production's current state. If another import moved any
    // of them since the administrator looked, the plan they confirmed is not the
    // plan about to run — refuse and make them re-preview. Nothing is written,
    // and no materially different plan is applied behind a confirmation.
    const expected = body.expectedPlanFingerprint
    if (typeof expected === 'string' && expected.length > 0 && expected !== built.preview.planFingerprint) {
      return fail('plan_stale', 409, {
        expected,
        actual: built.preview.planFingerprint,
      })
    }

    // --- R13.8B § 7: only an OVERWRITE needs authorization. Any number of NEW
    // weeks and any number of GAP_FILLs never do.
    // R13.8D.1 — the gate now has two causes, and the refusal names which. An
    // administrator refused for a restatement they were never shown could not
    // act on the refusal; the dates and counts are what make it actionable. No
    // amount is added here that the preview does not already carry.
    if (plan.blocked) {
      return fail('import_refused', 422, {
        blockCodes: plan.blockCodes,
        requiresHistoricalCorrection: plan.requiresHistoricalCorrection,
        requiresEvolutionCorrection: plan.requiresEvolutionCorrection,
        requiresPublicationRestatementCorrection: plan.requiresPublicationRestatementCorrection,
        corrections: built.preview.corrections,
        historicalRestatementDates: plan.historicalRestatementDates,
        historicalRestatementCount: plan.historicalPublicationRestatements.length,
        // R13.8E - the third cause of the gate. Naming it is what makes the
        // refusal actionable: an administrator refused for a row-level overwrite
        // they were never shown could not act on it.
        requiresRowHistoryCorrection: plan.requiresRowHistoryCorrection,
        rowHistoryChangedDates: plan.rowHistory.datesChanged,
        rowHistoryChangedCount: plan.rowHistory.changedCount,
        // FOLLOW-UP D - the fourth cause, named for the same reason.
        requiresPerformanceHistoryCorrection: plan.requiresPerformanceHistoryCorrection,
        performanceHistoryChangedDates: plan.performanceHistory.datesChanged,
        performanceHistoryChangedCount: plan.performanceHistory.changedCount,
      })
    }

    // --- R13.8C.2: A NO-OP IMPORT IS REFUSED — AND A NO-OP IS THE WHOLE IMPORT.
    //
    // The console disables Apply for a NO_CHANGES preview, but a disabled button
    // is not an invariant: this route can be called directly. An import that
    // mutates nothing would record a revision and an import operation that
    // changed nothing, and hand a rollback handle to an import that moved
    // nothing.
    //
    // R13.8C.1 tested only the history packet, and that was too narrow. A
    // workbook can leave every evolution point identical and still restate a
    // holding, a flow or a performance figure in the CURRENT snapshot; refusing
    // that as "nothing to append" left the stale figure published and told the
    // administrator there was nothing to do. So the test is BOTH halves: no
    // history mutation AND a standing publication materially equivalent to the
    // one this packet would mint.
    //
    // The database repeats the comparison against its own rows under the
    // publication lock (`import_refused_nothing_to_append`) and remains the
    // authority; this is the same rule stated one layer earlier, so the
    // administrator gets the answer without a write path being entered at all.
    // R13.8D.1 widens it once more: an import that appends nothing and leaves
    // this week's snapshot equivalent can still be correcting already-published
    // weeks, and that is a durable financial mutation, not a no-op.
    // R13.8E widens it a fourth time: recording row-level values for reporting
    // dates the book has never held at row grain is a durable write, even when
    // every level and every published figure is identical.
    if (
      plan.observationsToWrite.length === 0 &&
      !plan.publicationChanged &&
      plan.historicalPublicationRestatements.length === 0 &&
      plan.rowHistory.insertedCount === 0 &&
      plan.rowHistory.changedCount === 0 &&
      // FOLLOW-UP D widens it a fifth time: recording the source's own weekly
      // flows for dates the book has never held is a durable write too, and it
      // is what makes a custom period reconcilable at all.
      plan.performanceHistory.insertedCount === 0 &&
      plan.performanceHistory.changedCount === 0
    ) {
      return fail('nothing_to_append', 409, {
        action: plan.action,
        productionEndpoint: plan.productionEndpoint,
        publicationComparison: plan.publicationComparison,
      })
    }

    // The locked rule: the current publication carries the newest VALID FROZEN
    // reporting date. Detection now proposes exactly that, so an override to any
    // other date would publish a week under a date the workbook never froze.
    if (plan.publicationDate !== null && dateResult.date !== plan.publicationDate) {
      return fail('publication_date_not_newest_frozen', 422, {
        newestValidFrozenDate: plan.publicationDate,
        confirmed: dateResult.date,
      })
    }

    // Source provenance per observation, joined back from the extraction that
    // produced the values. Keyed on the canonical identity, never on order.
    const sourceOf = new Map(
      built.extraction.observations.map((o) => [
        `${o.scope}|${o.basis}|${o.observationDate}`,
        o,
      ]),
    )

    const observations: ImportObservationPayload[] = plan.observationsToWrite.map((o) => {
      const src = sourceOf.get(`${o.scope}|${o.basis}|${o.observationDate}`)
      return {
        scope: o.scope,
        basis: o.basis,
        series_identity: o.seriesIdentity,
        observation_date: o.observationDate,
        disposition: o.disposition as ImportObservationPayload['disposition'],
        new_value: o.value,
        new_status: o.status,
        // The pre-state the plan asserts. The database re-reads it under lock and
        // refuses the whole import if it has moved.
        prior_value: o.priorValue,
        prior_status: o.priorStatus,
        source_sheet: src?.sourceSheet ?? 'RESUMEN',
        source_cell: src?.sourceCell ?? '',
        source_row_label: src?.sourceRowLabel ?? '',
        currency: 'USD',
        parser_version: built.extraction.parserVersion,
        extractor_version: built.extraction.extractorVersion,
      }
    })

    // -- R13.8E: STAGE THE ROW HISTORY FIRST.
    //
    // A first backfill carries every clean frozen column the workbook holds --
    // measured at 19,757 rows and 4.2 MB of JSON for the current book. Sending
    // that as one more RPC argument would make a financial write depend on an
    // HTTP body limit that says nothing about whether the data is correct, so it
    // travels in bounded chunks and the import receives only the batch id.
    //
    // NOTHING DURABLE HAPPENS HERE. These rows are transport: no surface reads
    // them, the RPC consumes and deletes them inside its own transaction, and it
    // REFUSES unless the number staged matches the number declared -- so a lost
    // chunk is a refusal, never a partially written history.
    const rowHistoryStagingId = randomUUID()
    const rowHistoryRows = built.rowHistory.rows
    if (rowHistoryRows.length > 0) {
      const staged = await stageRowHistory(rowHistoryStagingId, rowHistoryRows)
      if (!staged.ok) return fail('row_history_stage_failed', 502)
    }

    // FOLLOW-UP D -- the performance-history relay, staged the same way. A
    // failure here discards the row-history batch too: leaving one relay full
    // while the import never runs is scratch nothing will consume.
    const performanceHistoryStagingId = randomUUID()
    const performanceHistoryRows = built.performanceHistory.rows
    if (performanceHistoryRows.length > 0) {
      const staged = await stagePerformanceHistory(
        performanceHistoryStagingId,
        performanceHistoryRows,
      )
      if (!staged.ok) {
        if (rowHistoryRows.length > 0) await discardRowHistoryStaging(rowHistoryStagingId)
        return fail('performance_history_stage_failed', 502)
      }
    }

    // ONE call. The publication, every history mutation, every row-history row
    // and the audit record commit together or not at all. There is no
    // post-commit second write and no sequential fallback -- a partially-applied
    // catch-up is exactly what R13.8B exists to make impossible.
    const imported = await importPortfolioWorkbook({
      uploadId: id,
      asOfDate: dateResult.date,
      publishedBy: entitlement.userId,
      parserVersion: RESUMEN_PARSER_VERSION,
      planVersion: plan.planVersion,
      rows,
      observations,
      performance,
      // R13.8D.1 — the corrected payload for every already-published week this
      // workbook restates, computed by the SAME `planImportForDraft` call above.
      // They travel in the one RPC call so the five new weeks, the seven
      // historical corrections and the new current publication commit together
      // or not at all.
      historicalPublications: built.historicalPublications,
      correctionAuthorized,
      correctionReason,
      counts: built.preview.counts,
      adminNote,
      // R13.6 — the workbook's OWN previous-week and beginning-of-year column
      // dates ride on the publication. The read path heads the four-column view
      // with these (doc 07 § 7.2, "each column labelled with its actual date")
      // rather than inferring them from adjacent publications, which could
      // mislabel a column whenever a week was skipped. Null stays null: a
      // column whose source date is unknown renders without a date, never with
      // a guessed one.
      metadata: {
        ...metadata,
        previousWeekDate: review.previousWeekDate,
        beginningOfYearDate: review.beginningOfYearDate,
        importPreviewVersion: built.preview.previewVersion,
        planFingerprint: built.preview.planFingerprint,
        frozenPublicationColumn: loaded.draft.frozen?.publicationColumnLetter ?? null,
        // Recorded so the audit shows the live column was SEEN and not selected,
        // rather than leaving it ambiguous whether it was considered at all.
        liveColumnLetter: loaded.draft.frozen?.liveColumnLetter ?? null,
        liveColumnDate: loaded.draft.frozen?.liveColumnDate ?? null,
        // R13.8E -- the row-history relay. The id names the staged batch and the
        // count is what makes a lost chunk a refusal instead of a silent partial
        // write. Both ride in the already-versioned metadata packet, so
        // `nmi_import_portfolio_workbook` KEEPS ITS EXACT 14-ARGUMENT SIGNATURE
        // and there is never a moment with two callable import functions.
        rowHistoryStagingId: rowHistoryRows.length > 0 ? rowHistoryStagingId : null,
        rowHistoryRowCount: rowHistoryRows.length,
        rowHistoryVersion: built.rowHistory.version,
        // FOLLOW-UP D -- the performance-history relay, riding the SAME metadata
        // packet for the same reason. Two analytical histories, one 14-argument
        // import function, one transaction.
        performanceHistoryStagingId:
          performanceHistoryRows.length > 0 ? performanceHistoryStagingId : null,
        performanceHistoryRowCount: performanceHistoryRows.length,
        performanceHistoryVersion: built.performanceHistory.version,
      },
    })

    // A refused or failed import leaves the relay behind. The chunks are scratch
    // and nothing can read them, but removing them keeps the table empty between
    // imports rather than relying on the next one's purge.
    if (!imported.ok && rowHistoryRows.length > 0) {
      await discardRowHistoryStaging(rowHistoryStagingId)
    }
    if (!imported.ok && performanceHistoryRows.length > 0) {
      await discardPerformanceHistoryStaging(performanceHistoryStagingId)
    }

    // The RPC reports counts alongside its identifiers; the route reduces that to
    // the common publication shape and keeps the import id for the response.
    published = imported.ok
      ? {
          ok: true,
          id: String(imported.result.publicationId ?? ''),
          importOperationId: String(imported.result.importOperationId ?? ''),
          inserted: Number(imported.result.inserted ?? 0),
          updated: Number(imported.result.updated ?? 0),
        }
      : imported
  } else if (loaded.draft.alternatives) {
    const draft = loaded.draft.alternatives
    const applied = applyEventClassifications(draft.events, decisions)

    // Cross-currency guard (doc 03 section 4.2, decision D4). This is NOT a
    // tautology: it fails when the draft carries ONE subtotal for a category
    // that its holdings denominate in several currencies. `Real Assets` appears
    // in three currencies, so a merged entry would be arithmetic over unlike
    // units that looks entirely plausible on screen.
    const subtotalCheck = verifyPerCurrencySubtotals(
      draft.holdings.map((h) => ({ category: h.category, currency: h.currency })),
      draft.subtotals,
    )
    if (!subtotalCheck.ok) {
      return fail('cross_currency_total', 422, {
        category: subtotalCheck.category,
        expected: subtotalCheck.expected,
        found: subtotalCheck.found,
      })
    }

    // A holding with no currency could not name the denomination of its own
    // amounts. The column is NOT NULL, so the database would refuse it too;
    // refusing here names the offending row instead of surfacing a driver error.
    const undenominated = draft.holdings.find((h) => h.currency.trim().length === 0)
    if (undenominated) {
      return fail('missing_currency', 422, { sourceCell: undenominated.sourceCell })
    }

    // Ids are generated here so each event references its holding DIRECTLY.
    // Re-deriving the link by name at insert time would be ambiguous the moment
    // one investment appears under two categories, and a mis-attached event
    // still looks like a valid timeline.
    const holdingIndex: Array<{
      id: string
      currency: string
      investmentName: string
      sociedad: string
    }> = []
    const holdings: HoldingPayload[] = draft.holdings.map((h) => {
      const uuid = randomUUID()
      holdingIndex.push({
        id: uuid,
        currency: h.currency,
        investmentName: h.investmentName,
        sociedad: h.sociedad,
      })
      return {
        id: uuid,
        category: h.category,
        currency: h.currency,
        investment_name: h.investmentName,
        sociedad: h.sociedad,
        capital_committed: h.capitalCommitted,
        contributions: h.contributions,
        unfunded: h.unfunded,
        last_statement_date: h.lastStatementDate,
        last_statement_label: h.lastStatementLabel,
        last_valuation: h.lastValuation,
        flow_since_statement: h.flowSinceStatement,
        current_value: h.currentValue,
        reported_irr: h.reportedIrr,
        // Cached source value. Excel's IRR is an iterative solver and is never
        // re-run server-side (doc 03 section 4.1).
        calculated_irr: h.calculatedIrr,
        source_sheet: h.sourceSheet,
        source_row: h.sourceRow,
        source_cell: h.sourceCell,
        metadata: {},
      }
    })

    const events: EventPayload[] = []
    for (const e of applied.events) {
      // A parsed event does not carry its category, so its holding is matched on
      // (currency, investment, sociedad). EXACTLY ONE match is required: zero
      // means the event has no home, and more than one means the category would
      // have to be guessed. Both fail closed rather than attach the event to a
      // plausible-looking wrong holding.
      const candidates = holdingIndex.filter(
        (h) =>
          h.currency === e.currency &&
          h.investmentName === e.investmentName &&
          h.sociedad === e.sociedad,
      )
      if (candidates.length !== 1) {
        return fail('ambiguous_event_holding', 422, { sourceCell: e.sourceCell })
      }
      events.push({
        holding_id: candidates[0].id,
        event_date: e.eventDate,
        amount: e.amount,
        currency: e.currency,
        event_type: e.eventType,
        raw_fill: e.rawFill,
        resolved_hex: e.resolvedHex,
        classification_method: e.classificationMethod,
        source_sheet: e.sourceSheet,
        source_cell: e.sourceCell,
        source_row: e.sourceRow,
        metadata: {},
      })
    }

    published = await publishAlternatives({
      uploadId: id,
      asOfDate: dateResult.date,
      publishedBy: entitlement.userId,
      parserVersion: ALTERNATIVES_PARSER_VERSION,
      holdings,
      events,
      adminNote,
      metadata,
    })
  } else {
    return fail('draft_not_parsed', 422)
  }

  if (!published.ok) {
    const reason = published.code === 'rpc_failed' ? (published.reason ?? 'publication_failed') : published.code
    // R13.8B — an `import_refused_*` is the same class of answer as a
    // `publication_refused_*`: the database looked and declined, which is a
    // conflict, not a server fault.
    const refused = reason.startsWith('publication_refused') || reason.startsWith('import_refused')
    const status = published.code === 'not_configured' ? 503 : refused ? 409 : 500
    // `publication_refused_duplicate_submission` lands here as a 409: the
    // database recognised a double-click or transport retry of the publication
    // that is already current, at the same parser version. An intentional
    // re-publish always carries a different upload (R13.2 makes the same bytes
    // unrepeatable for one kind) or a different parser version, and is allowed.
    return fail(reason, status)
  }

  // --- R13.8B § 8 — THE POST-COMMIT HISTORY WRITE IS GONE.
  //
  // R13.R1 § 9 wrote the weekly evolution series HERE: after the publication had
  // already committed, chunked, and best-effort, on the reasoning that the series
  // was supplementary and a failure must never invalidate a valid week.
  //
  // That reasoning does not survive the locked catch-up rule. When one upload
  // carries three unpublished frozen weeks, the history IS the import — and a
  // chunked best-effort upsert can leave two weeks written and one missing, with
  // a publication already committed on top and no way to reverse any of it. The
  // history mutations now travel inside `nmi_import_portfolio_workbook` with the
  // publication, so `published.ok` already means every one of them landed.
  const evolutionObservations = published.ok
    ? (published.inserted ?? 0) + (published.updated ?? 0)
    : null

  // Optional commentary, written after the publication it annotates exists.
  // A failure here never invalidates a valid publication, but it is reported
  // honestly rather than being echoed back as though it had been recorded.
  let commentaryPersisted = true
  const rawCommentary = body.commentary
  if (Array.isArray(rawCommentary)) {
    for (const item of rawCommentary) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const scope = typeof record.scope === 'string' ? record.scope : null
      const normalized = normalizeCommentary(record.body)
      if (!scope || !normalized.ok) {
        commentaryPersisted = false
        continue
      }
      const written = await upsertCommentary({
        publicationId: published.id,
        scope,
        body: normalized.body,
        author: entitlement.userId,
      })
      if (!written.ok) commentaryPersisted = false
    }
  }

  const record = await getPublication(published.id)

  return NextResponse.json(
    {
      publicationId: published.id,
      uploadId: id,
      uploadKind: review.uploadKind,
      asOfDate: dateResult.date,
      detectedAsOfDate: review.detectedAsOfDate,
      dateOverridden: dateResult.overridden,
      // The version that actually parsed THIS publication's bytes. Preview and
      // publish are separate requests, so a deployment between them can move the
      // parser forward; there is no snapshot isolation across deployments and
      // none is claimed. Returning the version that ran makes any such shift
      // observable instead of silent — and it is the same value stored on the
      // publication row.
      parserVersion: record?.parserVersion ?? null,
      revision: record?.revision ?? null,
      isCurrent: record?.isCurrent ?? null,
      recordCount: review.recordCount,
      warningCount: review.warningCount,
      administratorClassifiedEvents: decisions.length,
      commentaryPersisted,
      // R13.8B — the import that owns this publication and every history point it
      // wrote. It is the handle a rollback names; without it a reversal would be
      // back to guessing from a date or a filename.
      importOperationId: published.importOperationId ?? null,
      observationsInserted: published.inserted ?? null,
      observationsUpdated: published.updated ?? null,
      // Now the number of history mutations that committed IN THE SAME
      // transaction as this publication, not a best-effort count taken after it.
      evolutionObservations,
    },
    { status: 201, headers: NO_STORE },
  )
}
