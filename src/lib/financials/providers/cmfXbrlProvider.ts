// Phase 8C.1 — CMF/XBRL financials provider.
//
// Implements FinancialsProvider against the real, verified two-step public
// HTTP chain documented in docs/cmf_xbrl_provider_discovery.md:
//   1. GET the entity filing page (entidad.php) for a known RUT + period.
//   2. Parse the "Estados financieros (XBRL)" download href out of that HTML
//      and GET it (relative URL resolves one level above /mercados/).
//
// Honesty rules this file must never violate:
//   - Never invents data for an unmapped ticker — returns a structured
//     `blocked` result (code: 'issuer_not_mapped') instead.
//   - Never claims a filing exists without having actually fetched and
//     parsed it — discoverFilings returns *candidate* periods (constructed
//     deterministically, not scraped from an index), and fetchFiling is the
//     step that confirms whether a candidate period actually has data.
//   - This is NOT treated as equivalent to the BCCh official API. The
//     discovery doc explicitly rates this `feasible_with_mapping`, not
//     `feasible_now` — there is no published/versioned contract for the
//     entidad.php page or the download token, only an empirically-verified
//     pattern that could change without notice.
//   - No live network call happens as a side effect of importing this
//     module, running tests, linting, or building — every network call is
//     behind an explicit function call from the CLI script (scripts/discover/
//     cmfXbrlFinancials.ts), which itself defaults to discovery/dry-run.

import { getCmfIssuer } from '../cmfIssuerMap.ts'
import { parseXbrlInstance, plainFacts, findUnit, findContext, factNumericValue, type XbrlInstance } from '../xbrl/parseXbrl.ts'
import { mapConcept } from '../xbrl/conceptMap.ts'
import { unzip, findXbrlInstance, isTaxonomyOnlyArchive } from '../xbrl/unzip.ts'
import { buildTargetPeriod, currentPeriodContextIds, type TargetPeriod } from '../xbrl/periodClassify.ts'
import type {
  FinancialsProvider,
  FinancialFilingRef,
  FinancialRawFiling,
  FinancialParsedFiling,
  FinancialProviderResult,
} from './types.ts'
import type { FinancialImportPayload, ReportingPeriodImportRow, StatementItemImportRow } from '../csvFinancials.ts'

/** Reconstructs the quarter-end month (mm) a filing covers from its fiscal period label. FY→12, Q1→03, Q2→06, Q3→09. */
function monthForFiscalPeriod(fiscalPeriod: string | null): string {
  switch (fiscalPeriod) {
    case 'FY': return '12'
    case 'Q1': return '03'
    case 'Q2': return '06'
    case 'Q3': return '09'
    default: return '12'
  }
}

export const CMF_XBRL_PROVIDER_ID = 'cmf-xbrl'
export const CMF_BASE_URL = 'https://www.cmfchile.cl'

function entidadUrl(rut: string, mm: string, aa: string): string {
  const params = new URLSearchParams({
    mercado: 'V',
    control: 'svs',
    tipoentidad: 'RVEMI',
    vig: 'VI',
    grupo: '0',
    rut,
    mm,
    aa,
    tipo: 'C',
    tipo_norma: 'IFRS',
    pestania: '3',
    auth: '',
    send: '',
    row: '',
    rut_inc: '',
    orig: 'lista',
  })
  return `${CMF_BASE_URL}/institucional/mercados/entidad.php?${params.toString()}`
}

/** Extracts the "Estados financieros (XBRL)" download href from an entidad.php page's HTML, resolved to an absolute URL. Returns null if not found (e.g. no filing exists for that period). */
export function extractXbrlDownloadUrl(html: string): string | null {
  // The real link text observed during discovery was "Estados financieros (XBRL)"
  // immediately preceding or following the href within the same anchor's
  // neighborhood. We match the href pattern directly (safec_ifrs_verarchivo.php
  // under ../inc/inf_financiera/ifrs/) since it is specific enough on its own —
  // the PDF/Análisis Razonado links use different filenames.
  const hrefRe = /\.\.\/inc\/inf_financiera\/ifrs\/safec_ifrs_verarchivo\.php\?auth=[^"'\s]+/g
  const matches = [...html.matchAll(hrefRe)]
  if (matches.length === 0) return null
  // The XBRL link is consistently the last of the document links on the page
  // in every real filing observed during discovery (Análisis Razonado, PDF,
  // then XBRL last). If CMF reorders these, this heuristic could pick the
  // wrong link — flagged in the discovery doc as an unofficial-surface risk.
  const relative = matches[matches.length - 1][0]
  return `${CMF_BASE_URL}/institucional/${relative.replace(/^\.\.\//, '')}`
}

async function fetchText(url: string): Promise<{ ok: true; text: string } | { ok: false; status: number }> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, text: await res.text() }
}

function buildSourceFileName(ref: FinancialFilingRef): string {
  return `cmf_xbrl_${ref.ticker}_${ref.fiscalYear ?? 'unknown'}_${ref.fiscalPeriod ?? 'unknown'}.xbrl`
}

function periodToFiscal(mm: string, aa: string): { fiscalYear: number; fiscalPeriod: string; periodType: 'quarterly' | 'annual' } {
  const month = Number(mm)
  const fiscalPeriod = month === 12 ? 'FY' : `Q${Math.ceil(month / 3)}`
  return { fiscalYear: Number(aa), fiscalPeriod, periodType: month === 12 ? 'annual' : 'quarterly' }
}

/** Candidate recent quarter-end periods (mm/aa), most recent first, going back `count` quarters from today. Discovery only — existence is confirmed by actually fetching, never assumed. */
export function candidateRecentPeriods(count = 4, from: Date = new Date()): { mm: string; aa: string }[] {
  const quarterEndMonths = [3, 6, 9, 12]
  const out: { mm: string; aa: string }[] = []
  let year = from.getFullYear()
  let idx = quarterEndMonths.filter((m) => m <= from.getMonth() + 1).length - 1
  while (out.length < count) {
    if (idx < 0) {
      idx = quarterEndMonths.length - 1
      year -= 1
    }
    out.push({ mm: String(quarterEndMonths[idx]).padStart(2, '0'), aa: String(year) })
    idx -= 1
  }
  return out
}

/**
 * Candidate recent ANNUAL (December year-end) periods, most recent first.
 * Annual filings have unambiguous period semantics (full-year duration +
 * year-end balance), so they are the conservative default for automated
 * ingestion — interim filings carry a YTD/discrete-quarter distinction that
 * needs care before charting (see docs/cmf_xbrl_financials_ingestion.md).
 * Starts from the most recently *completed* fiscal year (last year, since the
 * current year's annual filing isn't published until the following year).
 */
export function candidateAnnualPeriods(count = 3, from: Date = new Date()): { mm: string; aa: string }[] {
  const out: { mm: string; aa: string }[] = []
  let year = from.getFullYear() - 1 // last completed fiscal year
  for (let i = 0; i < count; i++) {
    out.push({ mm: '12', aa: String(year) })
    year -= 1
  }
  return out
}

/** Counts DISTINCT plain-context concepts in an instance that have no mapping — a diagnostic signal (preserved, never fabricated), computed by the orchestrator. */
export function countUnmappedPlainConcepts(instance: XbrlInstance): number {
  const seen = new Set<string>()
  for (const f of plainFacts(instance)) {
    if (!mapConcept(f.concept) && !seen.has(f.concept)) seen.add(f.concept)
  }
  return seen.size
}

/** Extracts the parsed XbrlInstance from a parsed filing (the orchestrator needs it for validation/diagnostics). */
export function instanceFromParsed(parsed: FinancialParsedFiling): XbrlInstance | null {
  return (parsed.facts.instance as unknown as XbrlInstance) ?? null
}

/** Builds filing refs for an issuer over a set of (mm, aa) periods. Existence is confirmed only by actually fetching, never assumed. Returns [] for an unmapped ticker. */
export function buildFilingRefs(ticker: string, periods: { mm: string; aa: string }[]): FinancialFilingRef[] {
  const issuer = getCmfIssuer(ticker)
  if (!issuer) return []
  return periods.map(({ mm, aa }) => {
    const { fiscalYear, fiscalPeriod, periodType } = periodToFiscal(mm, aa)
    return {
      ticker,
      sourceType: 'xbrl',
      locator: entidadUrl(issuer.rut, mm, aa),
      fiscalYear,
      fiscalPeriod,
      periodType,
      description: `${issuer.cmfIssuerName} (RUT ${issuer.rut}) — candidate period ${mm}/${aa} (existence unconfirmed until fetched)`,
    }
  })
}

export const cmfXbrlProvider: FinancialsProvider = {
  providerId: CMF_XBRL_PROVIDER_ID,
  providerName: 'CMF XBRL (Estados Financieros IFRS)',
  sourceType: 'xbrl',

  async discoverFilings(ticker: string): Promise<FinancialProviderResult<FinancialFilingRef[]>> {
    const issuer = getCmfIssuer(ticker)
    if (!issuer) {
      return {
        ok: false,
        error: {
          code: 'issuer_not_mapped',
          reason: `"${ticker}" is not in the verified CMF issuer map (src/lib/financials/cmfIssuerMap.ts)`,
          nextAction: 'Manually verify this ticker\'s CMF RUT against a direct cmfchile.cl entidad.php URL, then add it to CMF_ISSUER_MAP. Never guess.',
        },
      }
    }
    return { ok: true, value: buildFilingRefs(ticker, candidateRecentPeriods(4)) }
  },

  async fetchFiling(ref: FinancialFilingRef): Promise<FinancialProviderResult<FinancialRawFiling>> {
    const entidadPage = await fetchText(ref.locator)
    if (!entidadPage.ok) {
      return {
        ok: false,
        error: { code: 'network_error', reason: `entidad page returned HTTP ${entidadPage.status}`, nextAction: 'Retry later; if persistent, the URL pattern may have changed.' },
      }
    }

    if (/Sin\s+informaci[oó]n/i.test(entidadPage.text)) {
      return {
        ok: false,
        error: { code: 'not_found', reason: `no filing found for ${ref.description}`, nextAction: 'Try a different fiscal period, or confirm the issuer files under a different tipoentidad/tipo_norma.' },
      }
    }

    const xbrlUrl = extractXbrlDownloadUrl(entidadPage.text)
    if (!xbrlUrl) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          reason: `entidad page loaded but no "Estados financieros (XBRL)" link was found for ${ref.description}`,
          nextAction: 'The filing may only have a PDF, or CMF changed the page markup — verify manually before assuming this ticker/period has no XBRL.',
        },
      }
    }

    const download = await fetch(xbrlUrl, { redirect: 'follow' })
    if (!download.ok) {
      return {
        ok: false,
        error: { code: 'network_error', reason: `XBRL download returned HTTP ${download.status}`, nextAction: 'The download token may be single-use or time-limited — refetch the entidad page and retry.' },
      }
    }
    const contentType = download.headers.get('content-type') ?? ''
    const disposition = download.headers.get('content-disposition') ?? ''
    if (!/zip|octet-stream|text\/plain/i.test(contentType) && !/\.zip/i.test(disposition)) {
      return {
        ok: false,
        error: { code: 'parse_error', reason: `unexpected content-type "${contentType}" for XBRL download`, nextAction: 'CMF may have changed the response format — verify manually.' },
      }
    }

    // Phase 8C.2 — the response is a ZIP archive containing the .xbrl instance
    // plus companion .xsd/.xml taxonomy files. We unzip it in memory with a
    // dependency-free reader (node:zlib), extract the .xbrl instance, and
    // return its text as the raw filing. A taxonomy-only archive (no .xbrl
    // instance — e.g. one of CMF's blank taxonomy packs) is rejected here so it
    // is never treated as a financial filing.
    const buf = Buffer.from(await download.arrayBuffer())
    const unzipped = unzip(buf)
    if (!unzipped.ok) {
      return {
        ok: false,
        error: { code: 'parse_error', reason: `downloaded a ${buf.byteLength}-byte archive but could not unzip it: ${unzipped.error.code} — ${unzipped.error.reason}`, nextAction: 'Verify the download is a real ZIP; if CMF changed the archive format, update the unzip reader.' },
      }
    }
    if (isTaxonomyOnlyArchive(unzipped.entries)) {
      return {
        ok: false,
        error: { code: 'not_found', reason: `archive contains only taxonomy/schema files (.xsd/.xml), no .xbrl instance — this is a taxonomy pack, not a financial filing`, nextAction: 'Confirm the entidad page linked an actual filing, not a taxonomy download.' },
      }
    }
    const instance = findXbrlInstance(unzipped.entries)
    if (!instance) {
      return {
        ok: false,
        error: { code: 'not_found', reason: `archive (${unzipped.entries.length} entries) had no .xbrl instance document`, nextAction: 'Verify manually — the filing may use an unexpected archive layout.' },
      }
    }
    return {
      ok: true,
      value: {
        ref,
        raw: instance.data.toString('utf8'),
        fetchedAt: new Date().toISOString(),
        sourceFile: buildSourceFileName(ref),
        sourceUrl: ref.locator,
      },
    }
  },

  parseFiling(raw: FinancialRawFiling): FinancialProviderResult<FinancialParsedFiling> {
    let instance: XbrlInstance
    try {
      instance = parseXbrlInstance(raw.raw)
    } catch (e) {
      return { ok: false, error: { code: 'parse_error', reason: e instanceof Error ? e.message : 'unknown parse error', nextAction: 'Inspect the raw XBRL text manually.' } }
    }
    if (instance.contexts.length === 0 || instance.facts.length === 0) {
      return {
        ok: false,
        error: { code: 'parse_error', reason: 'parsed 0 contexts or 0 facts — this does not look like a valid XBRL instance document', nextAction: 'Verify the raw text is the .xbrl file, not the .xsd/.xml companion files in the same ZIP.' },
      }
    }
    return {
      ok: true,
      value: {
        ref: raw.ref,
        facts: { instance: instance as unknown as Record<string, unknown> },
        warnings: instance.warnings,
      },
    }
  },

  normalizeToFinancialImportPayload(parsed: FinancialParsedFiling): FinancialProviderResult<FinancialImportPayload> {
    const instance = parsed.facts.instance as unknown as XbrlInstance
    if (!instance) {
      return { ok: false, error: { code: 'parse_error', reason: 'parsed filing carries no xbrl instance', nextAction: 'Re-parse the raw filing.' } }
    }

    const ref = parsed.ref
    const nowIso = new Date().toISOString()

    // Phase 8C.2 — build the target period this filing is about, then select
    // ONLY facts on the current period's contexts (the income/cash duration
    // ending on the period end + the period-end instant for balance items).
    // This replaces the Phase 8C.1 "first plain context wins" heuristic, which
    // could have grabbed a prior-year comparative or a YTD figure where a
    // discrete period was intended (see periodClassify.ts).
    const mm = monthForFiscalPeriod(ref.fiscalPeriod)
    const target: TargetPeriod | null = ref.fiscalYear ? buildTargetPeriod(mm, String(ref.fiscalYear)) : null
    if (!target) {
      return { ok: false, error: { code: 'parse_error', reason: `could not build a target period for ${ref.ticker} ${ref.fiscalPeriod}/${ref.fiscalYear}`, nextAction: 'Verify the filing ref carries a valid fiscal year and period.' } }
    }

    const { durationIds, instantIds } = currentPeriodContextIds(instance.contexts, target)
    const facts = plainFacts(instance)

    const statementItems: StatementItemImportRow[] = []
    const seen = new Set<string>()

    for (const fact of facts) {
      const mapping = mapConcept(fact.concept)
      // Unmapped concepts are not silently discarded from the wider parse —
      // they remain in the instance for the orchestrator to count/report as a
      // diagnostic (see countUnmappedPlainConcepts). They are simply not turned
      // into a normalized line item here.
      if (!mapping) continue
      // Only accept the fact if it sits on the correct CURRENT context for its
      // statement kind: balance-sheet items on the current period-end instant,
      // income/cash items on the current duration (YTD/annual). A fact on a
      // prior-year or non-current context is skipped, not mis-attributed.
      const isBalance = mapping.statementType === 'balance'
      const onCurrentContext = isBalance ? instantIds.has(fact.contextRef) : durationIds.has(fact.contextRef)
      if (!onCurrentContext) continue

      const key = mapping.lineItemCode
      if (seen.has(key)) continue // one value per line item per period
      seen.add(key)

      const value = factNumericValue(fact)
      const unit = findUnit(instance, fact.unitRef)
      const ctx = findContext(instance, fact.contextRef)
      statementItems.push({
        ticker: ref.ticker,
        fiscalYear: ref.fiscalYear ?? 0,
        fiscalPeriod: (ref.fiscalPeriod ?? 'FY') as StatementItemImportRow['fiscalPeriod'],
        periodType: target.periodType as StatementItemImportRow['periodType'],
        statementType: mapping.statementType,
        lineItemCode: mapping.lineItemCode,
        lineItemName: mapping.lineItemCode,
        value,
        unit: unit?.measure ?? 'unknown',
        scale: value !== null ? 'units' : null,
        sourceType: 'xbrl',
        sourceName: 'CMF XBRL (Estados Financieros IFRS)',
        sourceUrl: ref.locator,
        sourceFile: buildSourceFileName(ref),
        sourceAsOf: nowIso,
        // Raw XBRL fact provenance → persisted into the row's metadata jsonb.
        metadata: {
          sourceConcept: fact.concept,
          contextRef: fact.contextRef,
          unitRef: fact.unitRef,
          decimals: fact.decimals,
          mappingConfidence: mapping.confidence,
          periodNature: isBalance ? 'instant' : target.periodNature,
          contextInstant: ctx?.instant ?? null,
          contextStart: ctx?.startDate ?? null,
          contextEnd: ctx?.endDate ?? null,
        },
      })
    }

    if (statementItems.length === 0) {
      return {
        ok: false,
        error: { code: 'parse_error', reason: `no mappable current-period concepts found for ${ref.ticker} ${target.filingPeriodLabel} (all facts were dimensional, unmapped, or on a non-current/comparative context)`, nextAction: 'Verify the period exists in the filing and extend XBRL_CONCEPT_MAP only after confirming a concept against a real fact.' },
      }
    }

    // Currency is read from whichever unit the mapped facts actually used
    // (Copec's real filings are entirely in USD, not CLP — discovery doc) —
    // never assumed.
    const currency = statementItems.find((i) => i.unit === 'CLP' || i.unit === 'USD')?.unit ?? null

    const reportingPeriod: ReportingPeriodImportRow = {
      ticker: ref.ticker,
      fiscalYear: ref.fiscalYear ?? 0,
      fiscalPeriod: (ref.fiscalPeriod ?? 'FY') as ReportingPeriodImportRow['fiscalPeriod'],
      periodType: target.periodType as ReportingPeriodImportRow['periodType'],
      periodEndDate: target.periodEndDate,
      reportDate: null,
      currency: currency ?? 'CLP',
      sourceType: 'xbrl',
      sourceName: 'CMF XBRL (Estados Financieros IFRS)',
      sourceUrl: ref.locator,
      sourceFile: buildSourceFileName(ref),
      sourceAsOf: nowIso,
      periodStartDate: target.periodStartDate,
      periodNature: target.periodNature,
      filingPeriodLabel: target.filingPeriodLabel,
    }

    return {
      ok: true,
      value: {
        reportingPeriods: [reportingPeriod],
        statementItems,
        metrics: [],
        earningsEvents: [],
        errors: [],
        // Diagnostics for the orchestrator/validator — not persisted rows.
        // (FinancialImportPayload carries only the four row arrays + errors;
        // the orchestrator recomputes unmapped/validation itself, so this is
        // conveyed via the statement item count and metadata.)
      },
    }
  },

  dryRunImport(payload: FinancialImportPayload) {
    const errorCount = payload.errors.length
    return {
      valid: errorCount === 0,
      errorCount,
      summary: `${payload.reportingPeriods.length} reporting period(s), ${payload.statementItems.length} statement item(s), ${payload.metrics.length} metric(s), ${payload.earningsEvents.length} earnings event(s), ${errorCount} error(s)`,
    }
  },

  async writeImport(payload: FinancialImportPayload, ingestionRunId?: string | null) {
    const { upsertReportingPeriods, upsertStatementItems } = await import('../../db/repositories/financialsRepository.ts')
    const periodsResult = await upsertReportingPeriods(payload.reportingPeriods, ingestionRunId)
    const itemsResult = await upsertStatementItems(payload.statementItems, periodsResult.idsByKey, ingestionRunId)
    const rowsFailed = periodsResult.errors.length + itemsResult.errors.length
    if (rowsFailed > 0) {
      return {
        ok: false,
        error: {
          code: 'network_error',
          reason: `${rowsFailed} row(s) failed to write`,
          nextAction: 'Check Supabase admin credentials and table constraints.',
        },
      }
    }
    return { ok: true, value: { rowsInserted: periodsResult.inserted + itemsResult.inserted, rowsFailed } }
  },
}
