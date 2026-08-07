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
import {
  getUploadFindings,
  getPublication,
  recordConfirmedDate,
  publishPortfolio,
  publishAlternatives,
  upsertCommentary,
  type HoldingPayload,
  type EventPayload,
  type SnapshotRowPayload,
  type PerformanceRowPayload,
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

  const stored = await getUploadFindings(id)
  const review = summarizeDraft(loaded.draft, stored, decisions)

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

  let published: { ok: true; id: string } | { ok: false; code: string; reason?: string }

  if (loaded.draft.resumen) {
    const rows: SnapshotRowPayload[] = loaded.draft.resumen.rows.map((r) => ({
      scope: r.scope,
      row_key: r.rowKey,
      parent_row_key: r.parentRowKey,
      depth: r.depth,
      display_order: r.displayOrder,
      row_type: r.rowType,
      label_es: r.labelEs,
      label_en: null,
      currency: 'USD',
      // NULL stays NULL. An unavailable value is not zero (doc 02 § 9), and a
      // leaf with no beginning-of-year baseline keeps its comparison suppressed
      // rather than computed off a fabricated 0.
      value: r.value,
      value_class: r.valueClass,
      source_sheet: r.sourceSheet,
      source_cell: r.sourceCell,
      metadata: {
        sourceRow: r.sourceRow,
        previousValue: r.previousValue,
        beginningOfYearValue: r.beginningOfYearValue,
        // NMI-derived, never imported from the workbook's own `Diferencia`
        // column, which measures the PREVIOUS week (doc 04 § 2).
        difference: r.difference,
        differenceClass: r.differenceClass,
      },
    }))

    const performance: PerformanceRowPayload[] = loaded.draft.resumen.performance.map((p) => ({
      scope: p.scope,
      basis: p.basis,
      metric: p.metric,
      // The SOURCE's own stated figure is what is stored and displayed. NMI's
      // recomputation rides in metadata as a cross-check and never replaces it
      // (doc 04 § 7).
      value: p.sourceValue,
      value_class: p.valueClass,
      source_sheet: p.sourceSheet,
      source_cell: p.sourceCell,
      metadata: {
        sourceRow: p.sourceRow,
        boundRowKey: p.boundRowKey,
        boundSourceCell: p.boundSourceCell,
        crossChecks: p.crossChecks,
      },
    }))

    published = await publishPortfolio({
      uploadId: id,
      asOfDate: dateResult.date,
      publishedBy: entitlement.userId,
      parserVersion: RESUMEN_PARSER_VERSION,
      rows,
      performance,
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
      },
    })
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
    const status = published.code === 'not_configured' ? 503 : reason.startsWith('publication_refused') ? 409 : 500
    // `publication_refused_duplicate_submission` lands here as a 409: the
    // database recognised a double-click or transport retry of the publication
    // that is already current, at the same parser version. An intentional
    // re-publish always carries a different upload (R13.2 makes the same bytes
    // unrepeatable for one kind) or a different parser version, and is allowed.
    return fail(reason, status)
  }

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
    },
    { status: 201, headers: NO_STORE },
  )
}
