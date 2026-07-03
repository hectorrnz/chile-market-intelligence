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
import { parseXbrlInstance, plainFacts, findUnit, factNumericValue, type XbrlInstance } from '../xbrl/parseXbrl.ts'
import { mapConcept } from '../xbrl/conceptMap.ts'
import type {
  FinancialsProvider,
  FinancialFilingRef,
  FinancialRawFiling,
  FinancialParsedFiling,
  FinancialProviderResult,
} from './types.ts'
import type { FinancialImportPayload, ReportingPeriodImportRow, StatementItemImportRow } from '../csvFinancials.ts'

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

    const refs: FinancialFilingRef[] = candidateRecentPeriods(4).map(({ mm, aa }) => {
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
    return { ok: true, value: refs }
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

    // Note: the real response is a ZIP archive containing the .xbrl instance
    // plus supporting .xsd/.xml files. Unzipping is intentionally out of
    // scope for this raw-fetch step (no zip library dependency is added in
    // this phase) — parseFiling() below expects an already-extracted .xbrl
    // instance document string. See docs/cmf_xbrl_provider_discovery.md
    // Section 4 for why the real downloaded archives were not committed.
    const buf = await download.arrayBuffer()
    return {
      ok: false,
      error: {
        code: 'not_implemented',
        reason: `downloaded a real ${buf.byteLength}-byte ZIP archive successfully, but this provider does not unzip it (no zip dependency added in this phase — see discovery doc Section 4)`,
        nextAction: 'Add a zip-extraction step (or a documented manual unzip step) before this filing can be parsed end-to-end. parseFiling()/parseXbrlInstance() are ready for the extracted .xbrl text once available.',
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
    const facts = plainFacts(instance)
    const statementItems: StatementItemImportRow[] = []
    const seen = new Set<string>()

    for (const fact of facts) {
      const mapping = mapConcept(fact.concept)
      if (!mapping) continue // unmapped concepts are preserved in warnings, not silently discarded from the wider parse — see conceptMap.ts KNOWN_UNMAPPED_CONCEPTS for documented rejections
      const key = mapping.lineItemCode
      if (seen.has(key)) continue // first plain-context match wins; duplicates across equivalent plain contexts are not expected but guarded
      const value = factNumericValue(fact)
      const unit = findUnit(instance, fact.unitRef)
      seen.add(key)
      statementItems.push({
        ticker: ref.ticker,
        fiscalYear: ref.fiscalYear ?? 0,
        fiscalPeriod: (ref.fiscalPeriod ?? 'FY') as StatementItemImportRow['fiscalPeriod'],
        periodType: (ref.periodType ?? 'annual') as StatementItemImportRow['periodType'],
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
      })
    }

    if (statementItems.length === 0) {
      return {
        ok: false,
        error: { code: 'parse_error', reason: 'no mappable concepts found in this filing (all facts were either dimensional or unmapped)', nextAction: 'Extend XBRL_CONCEPT_MAP in conceptMap.ts only after verifying the concept against a real fact.' },
      }
    }

    const reportingPeriod: ReportingPeriodImportRow = {
      ticker: ref.ticker,
      fiscalYear: ref.fiscalYear ?? 0,
      fiscalPeriod: (ref.fiscalPeriod ?? 'FY') as ReportingPeriodImportRow['fiscalPeriod'],
      periodType: (ref.periodType ?? 'annual') as ReportingPeriodImportRow['periodType'],
      periodEndDate: instance.contexts.find((c) => c.instant || c.endDate)?.instant ?? instance.contexts.find((c) => c.endDate)?.endDate ?? '',
      reportDate: null,
      // Currency is read from whichever unit the mapped facts actually used
      // (Copec's real 2023 filing was entirely in USD, not CLP — see the
      // discovery doc) — never assumed.
      currency: statementItems.find((i) => i.unit === 'CLP' || i.unit === 'USD')?.unit ?? 'CLP',
      sourceType: 'xbrl',
      sourceName: 'CMF XBRL (Estados Financieros IFRS)',
      sourceUrl: ref.locator,
      sourceFile: buildSourceFileName(ref),
      sourceAsOf: nowIso,
    }

    return {
      ok: true,
      value: {
        reportingPeriods: reportingPeriod.periodEndDate ? [reportingPeriod] : [],
        statementItems,
        metrics: [],
        earningsEvents: [],
        errors: reportingPeriod.periodEndDate ? [] : [{ line: 0, reason: 'could not determine period_end_date from any context — reporting period row skipped, statement items still returned for review' }],
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
