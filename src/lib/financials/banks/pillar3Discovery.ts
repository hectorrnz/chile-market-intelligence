// Phase 8C.8 — Pillar 3 / bank regulatory-metrics source discovery (research
// only — no ingestion). Pure, network-free module documenting a real, live
// discovery result so the status endpoint can report it honestly instead of
// silently having "no answer" for CET1/RWA/NPL/coverage.
//
// DISCOVERY RESULT: CMF's own "Divulgación de Pilar 3 de Basilea" page
// (https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-46323.html)
// is NOT a centralized structured data file. Each quarterly release is a
// short PDF whose entire content is a LINK DIRECTORY pointing to every
// individual bank's OWN investor-relations website, where that bank
// self-publishes dozens of separate Basel III disclosure forms (KM1, OV1,
// CC1, CR1, LR1, LIQ1, ...) under Capítulo 21-20 of the RAN — in whatever
// format that bank chooses. Verified live (Q4 2025 release,
// articles-108979_recurso_1.pdf): the links for all 4 app bank tickers
// resolve to a general investor-relations landing page, not a direct
// file — e.g. BSANTANDER -> "results-center-page", CHILE ->
// "reportes-financieros", BCI -> "informes-de-relevancia", ITAUCL ->
// "resultados-trimestrales". (A few OTHER banks not in this app's universe —
// JPMorgan Chase, BTG Pactual — do link directly to a stable .xlsx, proving
// the format varies bank-by-bank and is never guaranteed structured.)
//
// This means: there is no single official, structured, low-risk CMF file for
// CET1/Tier1/RWA/NPL/coverage for BSANTANDER/CHILE/BCI/ITAUCL. Reaching this
// data would require (a) navigating each bank's own website to find its
// current-quarter disclosure page (an unstable, bank-specific target — 4
// different site structures, not a documented API), then (b) parsing
// whatever format that bank happens to publish (in practice a PDF for these
// 4 banks). Both violate this app's standing rules: never build a
// per-bank-website-scraping architecture as the primary path, and never OCR
// a PDF as an ingestion source.
//
// CLASSIFICATION: `deferred`. No ingestion prototype was built — per policy,
// a non-viable source gets a documented blocker, not speculative code.

export type Pillar3DiscoveryStatus =
  | 'pillar3_source_discovered'
  | 'official_metric_file_discovered'
  | 'bank_specific_disclosure_discovered'
  | 'pdf_only'
  | 'html_only'
  | 'captcha_blocked'
  | 'source_unstable'
  | 'mapping_required'
  | 'not_found'
  | 'deferred'

export interface Pillar3DiscoveryResult {
  status: Pillar3DiscoveryStatus
  sourceUrl: string
  format: 'pdf_link_directory'
  verifiedAt: string
  blockingReason: string
  targetMetrics: string[]
  perBankLinks: Record<string, { linkDescription: string; isDirectStructuredFile: false }>
}

export const PILLAR3_DISCOVERY: Pillar3DiscoveryResult = {
  status: 'deferred',
  sourceUrl: 'https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-46323.html',
  format: 'pdf_link_directory',
  verifiedAt: '2026-07-09',
  blockingReason:
    'CMF\'s Pillar 3 quarterly publication is a PDF whose only content is a directory of links to each bank\'s own investor-relations website (verified live, Q4 2025 release). None of the 4 app bank tickers link to a direct structured file — each points to a general IR landing page. Reaching CET1/RWA/NPL/coverage would require per-bank website navigation + (in practice) PDF parsing, both against this app\'s standing no-fragile-scraping and no-OCR rules. Deferred — no ingestion prototype built for a non-viable source.',
  targetMetrics: [
    'cet1_capital', 'tier1_capital', 'total_capital', 'risk_weighted_assets',
    'cet1_ratio', 'tier1_ratio', 'total_capital_ratio', 'npl_ratio', 'coverage_ratio', 'cost_of_risk',
  ],
  perBankLinks: {
    BSANTANDER: { linkDescription: 'bancosantanderchile.investor-relations.co/results-center-page (general IR landing page, no direct file)', isDirectStructuredFile: false },
    CHILE: { linkDescription: 'sitiospublicos.bancochile.cl .../reportes-financieros (general IR landing page, no direct file)', isDirectStructuredFile: false },
    BCI: { linkDescription: 'bci.cl/investor-relations/.../informes-de-relevancia (general IR landing page, no direct file)', isDirectStructuredFile: false },
    ITAUCL: { linkDescription: 'ir.itau.cl/es/resultados-e-informes/resultados-trimestrales (general IR landing page, no direct file)', isDirectStructuredFile: false },
  },
}
