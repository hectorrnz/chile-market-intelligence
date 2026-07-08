// Phase 8C.1/8C.3 — CMF issuer identifier mapping.
//
// Maps app tickers to their CMF issuer identity (RUT sin dígito verificador)
// so the CMF/XBRL provider can construct entidad.php requests. See
// docs/cmf_xbrl_provider_discovery.md ("Section 2") for how the first two
// entries were verified, and docs/cmf_xbrl_financials_ingestion.md for the
// Phase 8C.3 issuer-expansion process.
//
// POLICY: never guess a RUT or CMF entity id. Only add an entry here once you
// have confirmed it against a direct cmfchile.cl URL (not a search-engine
// snippet — 8C.1 found a search snippet that attached the wrong RUT to the
// wrong company). If uncertain, leave the ticker out of CMF_ISSUER_MAP and add
// it to UNMAPPED_TICKERS with a note explaining why.
//
// Phase 8C.3 verification method: CMF's own search form
// (sa_eeff_ifrs_index.php) embeds a `sociedad[]` multi-select listing every
// registered entity as "<RUT with check digit> <LEGAL NAME>" — this is CMF's
// own official RUT<->legal-name directory, not a search-engine guess. An
// entry is only added here when its legal name in that directory is an
// unambiguous match for the ticker's issuer (verified against companies.json's
// legalName), AND the full entidad.php -> XBRL ZIP -> instance chain was
// exercised live.

export type VerificationStatus = 'verified' | 'review_required'

export interface CmfIssuerEntry {
  ticker: string
  companyName: string
  cmfIssuerName: string
  /** RUT without the check digit — the form entidad.php expects in `rut=`. */
  rut: string
  cmfEntityId: string | null
  cmfMarket: 'V'
  notes: string
  sourceUrl: string
  /** ISO date this mapping was last confirmed against the live CMF site. */
  verifiedAt: string
  /** Phase 8C.3 (optional, additive): explicit verification status. Only 'verified' entries are used for ingestion; a future 'review_required' entry would need human confirmation before use. Defaults to 'verified' for entries present in this map at all (an unverified candidate belongs in UNMAPPED_TICKERS instead). */
  verificationStatus?: VerificationStatus
  /** Phase 8C.3 (optional, additive): how the RUT/identity was confirmed. */
  verificationMethod?: string
}

export const CMF_ISSUER_MAP: Record<string, CmfIssuerEntry> = {
  'SQM-B': {
    ticker: 'SQM-B',
    companyName: 'SQM',
    cmfIssuerName: 'SOCIEDAD QUIMICA Y MINERA DE CHILE S.A.',
    rut: '93007000',
    cmfEntityId: null,
    cmfMarket: 'V',
    notes:
      'RUT confirmed across 6 independent cmfchile.cl entidad.php links (Identificación, Información Financiera, URL a EEFF, 12 Mayores Accionistas, Prácticas de Gobierno Corporativo). Full end-to-end XBRL download+ingestion confirmed live in Phase 8C.2 (FY2025/FY2024, USD, 23 mapped line items each).',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&rut=93007000&grupo=&tipoentidad=RVEMI&row=&vig=VI&control=svs&pestania=1',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Direct cmfchile.cl entidad.php URL (6 independent page links); full XBRL chain proven end-to-end in Phase 8C.2.',
  },
  COPEC: {
    ticker: 'COPEC',
    companyName: 'Empresas Copec',
    cmfIssuerName: 'EMPRESAS COPEC S.A.',
    rut: '90690000',
    cmfEntityId: null,
    cmfMarket: 'V',
    notes:
      'RUT confirmed across 8 independent cmfchile.cl entidad.php links. Full end-to-end XBRL download chain (entidad.php -> parse href -> download safec_ifrs_verarchivo.php) confirmed live repeatedly (Phase 8C.1 discovery, Phase 8C.2 production write of FY2025, 24 rows, USD).',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&rut=90690000&tipoentidad=RVEMI&vig=VI&row=&control=svs&pestania=1',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Direct cmfchile.cl entidad.php URL (8 independent page links); full XBRL chain proven end-to-end + production write in Phase 8C.2.',
  },
  ENELCHILE: {
    ticker: 'ENELCHILE',
    companyName: 'Enel Chile',
    cmfIssuerName: 'ENEL CHILE S.A.',
    rut: '76536353',
    cmfEntityId: null,
    cmfMarket: 'V',
    notes:
      'RUT sourced from CMF\'s own official RVEMI issuer directory (the sociedad[] dropdown in sa_eeff_ifrs_index.php, which lists every registered entity as "<RUT-DV> <LEGAL NAME>") — a single unambiguous match "76.536.353-5 ENEL CHILE S.A.", matching companies.json\'s legalName exactly. Live entidad.php + XBRL ZIP + instance parse confirmed for FY2024 and FY2023: 1008/1003 plain-context facts, 22 distinct mapped concepts each, currency CLP (unit block: CLP/pure/shares).',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=76536353&mm=12&aa=2024&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (unambiguous single match) + live entidad.php/XBRL chain exercised for 2 periods.',
  },
  CMPC: {
    ticker: 'CMPC',
    companyName: 'Empresas CMPC',
    cmfIssuerName: 'EMPRESAS CMPC S.A.',
    rut: '90222000',
    cmfEntityId: null,
    cmfMarket: 'V',
    notes:
      'RUT sourced from CMF\'s official RVEMI directory: "90.222.000-3 EMPRESAS CMPC S.A." — distinguished from a DIFFERENT, unrelated directory entry "96.596.540-8 INVERSIONES CMPC S.A." (a separate holding entity, not this ticker\'s issuer; not used). Live entidad.php + XBRL ZIP + instance parse confirmed for FY2024 and FY2023: 1083/1094 plain-context facts, 24 distinct mapped concepts each. Currency is USD, not CLP (unit block: pure/shares/USD) — same non-CLP-filing pattern already seen with COPEC; currency is always read per-fact, never assumed.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=90222000&mm=12&aa=2024&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (disambiguated from a similarly-named but distinct entity) + live entidad.php/XBRL chain exercised for 2 periods.',
  },
  CENCOSUD: {
    ticker: 'CENCOSUD',
    companyName: 'Cencosud',
    cmfIssuerName: 'CENCOSUD S.A.',
    rut: '93834000',
    cmfEntityId: null,
    cmfMarket: 'V',
    notes:
      'RUT sourced from CMF\'s official RVEMI directory: "93.834.000-5 CENCOSUD S.A." — distinguished from a DIFFERENT, unrelated directory entry "76.433.310-1 CENCOSUD SHOPPING S.A." (a shopping-center subsidiary, not this ticker\'s issuer; not used). Live entidad.php + XBRL ZIP + instance parse confirmed for FY2024 and FY2023: 967/957 plain-context facts, 24 distinct mapped concepts each, currency CLP (unit block: CLP/pure/shares).',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=93834000&mm=12&aa=2024&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (disambiguated from a similarly-named but distinct entity) + live entidad.php/XBRL chain exercised for 2 periods.',
  },
}

/**
 * Tickers this app covers that could NOT be confidently mapped to a CMF RUT.
 * Document the reason so a future pass knows what was tried.
 */
export const UNMAPPED_TICKERS: Record<string, string> = {
  BSANTANDER:
    'Banks are not present under either CMF registry group exposed by the XBRL search tool. Phase 8C.1 found a search-snippet RUT (97036000) that returned "Sin información" when queried directly — confirmed wrong; the only Santander-named entries under tipoentidad=RVEMI are Santander Chile Holding S.A. (96501440), Santander S.A. Sociedad Securitizadora (96785590), and Santander Consumer Finance Limitada (76002293) — none is Banco Santander-Chile itself. Phase 8C.3 re-checked CMF\'s own official issuer directory (the sociedad[] dropdown) under BOTH rg_rf=RVEMI and rg_rf=RGEIN registry groups directly — zero entries for "Banco Santander" or "Santander-Chile" in either. Banks are supervised/reported under a separate CMF track this public XBRL search tool does not expose. Do not guess.',
  CHILE:
    'Banco de Chile — same finding as BSANTANDER. Phase 8C.3 checked CMF\'s official issuer directory (sociedad[] dropdown) under both rg_rf=RVEMI and rg_rf=RGEIN registry groups: zero entries containing "BANCO DE CHILE" in either (only unrelated fund-management subsidiaries with "Banco" in their name, e.g. Banco Internacional Administradora General de Fondos, BancoEstado S.A. Administradora General de Fondos — neither is Banco de Chile). Banks are supervised/reported under a separate CMF track this public XBRL search tool does not expose. Do not guess.',
}

export function getCmfIssuer(ticker: string): CmfIssuerEntry | null {
  return CMF_ISSUER_MAP[ticker] ?? null
}

export function isCmfIssuerMapped(ticker: string): boolean {
  return ticker in CMF_ISSUER_MAP
}

export function getMappedTickers(): string[] {
  return Object.keys(CMF_ISSUER_MAP)
}
