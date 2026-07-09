// Phase 8C.7 — bank identity + filing-path registry.
//
// Confirms in Phase 8C.4/8C.6 (docs/cmf_xbrl_financials_ingestion.md §4c/§4d):
// Chilean banks are absent from CMF's securities-issuer XBRL directory
// (sa_eeff_ifrs_index.php) under every registry group the tool exposes
// (RVEMI/RGEIN/RGFEN and other rg_rf variants all return either the identical
// non-bank securities list or an unrelated fund-manager list — zero bank
// holding companies). Banks report under a SEPARATE CMF track.
//
// Phase 8C.7 discovery: that separate track is CMF's own public "Balance y
// Estado de Situación Bancos" monthly regulatory publication —
// https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-30250.html
// — a stable, official, no-CAPTCHA, per-institution-identifiable ZIP release
// published every month. Each release embeds its own official identity
// registry: `metadata/listado_instituciones.txt` and the documentation PDF's
// "Anexo N°1: Listado de códigos de instituciones financieras vigentes",
// listing a stable 3-digit CMF-assigned bank code alongside each bank's
// registered legal name (razón social) — this IS the official CMF identity
// evidence for this pipeline, verified directly from an official cmfchile.cl
// download, never a search-engine snippet.
//
// This bank code (not RUT) is the identifier this pipeline's fetch/parse
// chain actually needs (it is embedded in the release's file names and is
// CMF's own regulatory identifier for the banking-supervision track). A RUT
// was NOT independently re-verified this phase — Phase 8C.1 already found a
// search-snippet RUT for BSANTANDER (97036000) that CMF's entidad.php
// confirmed wrong ("Sin información"), so no RUT is asserted here rather than
// repeat that mistake. If a RUT is later needed, it must be verified against
// an official CMF source before being added — never guessed.

export type BankFilingDiscoveryStatus =
  | 'bank_registry_discovered'
  | 'bank_filing_path_discovered'
  | 'bank_xbrl_available'
  | 'bank_pdf_only'
  | 'bank_html_only'
  | 'bank_taxonomy_only'
  | 'bank_captcha_blocked'
  | 'bank_unsupported_page_shape'
  | 'bank_mapping_required'
  | 'bank_not_found'
  | 'bank_source_deferred'

export interface BankRegistryEntry {
  ticker: string
  companyName: string
  /** Official legal name as it appears in CMF's own Anexo N°1 / listado_instituciones.txt. */
  cmfLegalName: string
  /** CMF's own 3-digit regulatory bank code (the "IFI" identifier in the release's file-naming convention). Verified directly from an official cmfchile.cl download, Phase 8C.7. */
  bankCode: string
  /** Not independently re-verified this phase — see file header. Never guessed. */
  rut: null
  discoveryStatus: BankFilingDiscoveryStatus
  /** Whether the official feed is XBRL. It is not — a proprietary tab-delimited chart-of-accounts format. */
  isXbrl: false
  notes: string
  sourceUrl: string
  verifiedAt: string
}

const MONTHLY_BANK_STATS_URL = 'https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-30250.html'

export const BANK_REGISTRY: Record<string, BankRegistryEntry> = {
  BSANTANDER: {
    ticker: 'BSANTANDER',
    companyName: 'Banco Santander-Chile',
    cmfLegalName: 'BANCO SANTANDER-CHILE',
    bankCode: '037',
    rut: null,
    discoveryStatus: 'bank_filing_path_discovered',
    isXbrl: false,
    notes:
      'Confirmed via official cmfchile.cl documentation (Anexo N°1 of the monthly release\'s documentacion.pdf, and the bundled listado_instituciones.txt) — bank code 037. Verified present in the May-2026 monthly release with a consistent, plausible balance sheet (assets = liabilities + equity exactly) and income statement (profit before tax + tax expense == net income exactly). Absent from the securities-issuer XBRL directory (8C.4/8C.6) — this monthly regulatory feed is the only officially-discovered structured path.',
    sourceUrl: MONTHLY_BANK_STATS_URL,
    verifiedAt: '2026-07-09',
  },
  CHILE: {
    ticker: 'CHILE',
    companyName: 'Banco de Chile',
    cmfLegalName: 'BANCO DE CHILE',
    bankCode: '001',
    rut: null,
    discoveryStatus: 'bank_filing_path_discovered',
    isXbrl: false,
    notes:
      'Confirmed via official cmfchile.cl documentation — bank code 001. Verified present in the May-2026 monthly release with a consistent balance sheet and income statement identity (see BSANTANDER note for the exact checks). Absent from the securities-issuer XBRL directory.',
    sourceUrl: MONTHLY_BANK_STATS_URL,
    verifiedAt: '2026-07-09',
  },
  BCI: {
    ticker: 'BCI',
    companyName: 'Banco de Crédito e Inversiones',
    cmfLegalName: 'BANCO DE CREDITO E INVERSIONES',
    bankCode: '016',
    rut: null,
    discoveryStatus: 'bank_filing_path_discovered',
    isXbrl: false,
    notes:
      'Confirmed via official cmfchile.cl documentation — bank code 016. Verified present in the May-2026 monthly release; this is the bank used to derive the full concept-map verification transcript (docs/bank_financials_ingestion.md §5). Absent from the securities-issuer XBRL directory.',
    sourceUrl: MONTHLY_BANK_STATS_URL,
    verifiedAt: '2026-07-09',
  },
  ITAUCL: {
    ticker: 'ITAUCL',
    companyName: 'Banco Itaú Chile',
    cmfLegalName: 'BANCO ITAU CHILE',
    bankCode: '039',
    rut: null,
    discoveryStatus: 'bank_filing_path_discovered',
    isXbrl: false,
    notes:
      'Confirmed via official cmfchile.cl documentation — bank code 039 (formerly "ITAU CORPBANCA" post the 2016 CorpBanca merger, renamed "Banco Itaú Chile" from April 2023 per the release\'s own footnote). Verified present in the May-2026 monthly release with a consistent balance sheet and income statement identity. Absent from the securities-issuer XBRL directory.',
    sourceUrl: MONTHLY_BANK_STATS_URL,
    verifiedAt: '2026-07-09',
  },
}

export function getBankRegistryEntry(ticker: string): BankRegistryEntry | null {
  return BANK_REGISTRY[ticker.toUpperCase()] ?? null
}

export function isBankTicker(ticker: string): boolean {
  return ticker.toUpperCase() in BANK_REGISTRY
}

export function getAllBankTickers(): string[] {
  return Object.keys(BANK_REGISTRY)
}
