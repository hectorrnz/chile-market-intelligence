// Phase 8C.1 — CMF issuer identifier mapping.
//
// Maps app tickers to their CMF issuer identity (RUT sin dígito verificador)
// so the CMF/XBRL provider can construct entidad.php requests. See
// docs/cmf_xbrl_provider_discovery.md ("Section 2") for how each entry below
// was verified.
//
// POLICY: never guess a RUT or CMF entity id. Only add an entry here once you
// have confirmed it against a direct cmfchile.cl URL (not a search-engine
// snippet — this phase found a search snippet that attached the wrong RUT to
// the wrong company). If uncertain, leave the ticker out of CMF_ISSUER_MAP and
// add it to UNMAPPED_TICKERS with a note explaining why.

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
      'RUT confirmed across 6 independent cmfchile.cl entidad.php links (Identificación, Información Financiera, URL a EEFF, 12 Mayores Accionistas, Prácticas de Gobierno Corporativo). Full XBRL download chain not separately re-tested for this RUT in this phase (COPEC was used for the end-to-end download proof) — treat as verified identity, unverified full-chain download.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&rut=93007000&grupo=&tipoentidad=RVEMI&row=&vig=VI&control=svs&pestania=1',
    verifiedAt: '2026-07-03',
  },
  COPEC: {
    ticker: 'COPEC',
    companyName: 'Empresas Copec',
    cmfIssuerName: 'EMPRESAS COPEC S.A.',
    rut: '90690000',
    cmfEntityId: null,
    cmfMarket: 'V',
    notes:
      'RUT confirmed across 8 independent cmfchile.cl entidad.php links. Full end-to-end XBRL download chain (entidad.php -> parse href -> download safec_ifrs_verarchivo.php) was successfully completed for this RUT in this phase (period 12/2023, genuine ZIP with real ifrs-full facts). Highest-confidence entry.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&rut=90690000&tipoentidad=RVEMI&vig=VI&row=&control=svs&pestania=1',
    verifiedAt: '2026-07-03',
  },
}

/**
 * Tickers this app covers that could NOT be confidently mapped to a CMF RUT
 * in this phase. Document the reason so a future pass knows what was tried.
 */
export const UNMAPPED_TICKERS: Record<string, string> = {
  BSANTANDER:
    'Search surfaced several related Santander entities under tipoentidad=RVEMI (Santander Chile Holding S.A. 96501440, Santander S.A. Sociedad Securitizadora 96785590, Santander Consumer Finance Limitada 76002293) but none is Banco Santander-Chile itself. A candidate RUT from a search snippet (97036000) returned "Sin información" when queried directly — confirmed wrong. Banks appear to sit under a different CMF registry track than plain securities issuers; not resolved in this phase. Do not guess.',
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
