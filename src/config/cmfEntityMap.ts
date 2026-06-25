// Phase 5A — CMF entity → internal ticker mapping.
//
// Maps the legal entity names that appear in CMF filings to internal tickers.
// All entries are verified:false until the RUT and CMF entity URL are confirmed
// against the official CMF portal (Phase 5A.1 discoverHechos.ts run).
//
// Do NOT set verified:true unless:
//   1. The RUT matches the entity's official CMF registration page.
//   2. The cmfEntityUrl returns hechos for the expected company.
//   3. The mapping has been tested against at least one live filing.

export interface CmfEntityMapEntry {
  /** Internal ticker used throughout the app. */
  ticker: string
  /** Display company name. */
  companyName: string
  /** Chilean RUT (Rol Único Tributario). Null until confirmed. */
  rut: string | null
  /** CMF entity page URL for this issuer. Null until confirmed. */
  cmfEntityUrl: string | null
  /** CMF entity type: issuer (emisor), bank, fund, etc. */
  cmfEntityType: 'emisor' | 'banco' | 'fondo' | 'unknown'
  /** Legal name as it appears in CMF filings (uppercase). Null until confirmed. */
  cmfLegalName: string | null
  /** True only after RUT + URL confirmed from official CMF portal (Phase 5A.1). */
  verified: boolean
  notes: string
}

export const cmfEntityMap: CmfEntityMapEntry[] = [
  { ticker: 'SQM-B',     companyName: 'SQM',                     rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'Listed as SQM-B (Serie B); CMF entity name unconfirmed' },
  { ticker: 'COPEC',     companyName: 'Empresas Copec',           rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: '' },
  { ticker: 'FALABELLA', companyName: 'Falabella',                rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: '' },
  { ticker: 'CENCOSUD',  companyName: 'Cencosud',                 rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: '' },
  { ticker: 'BSANTANDER',companyName: 'Banco Santander Chile',    rut: null, cmfEntityUrl: null, cmfEntityType: 'banco',   cmfLegalName: null, verified: false, notes: 'CMF name may be "BANCO SANTANDER-CHILE"' },
  { ticker: 'CHILE',     companyName: 'Banco de Chile',           rut: null, cmfEntityUrl: null, cmfEntityType: 'banco',   cmfLegalName: null, verified: false, notes: '' },
  { ticker: 'BCI',       companyName: 'Banco BCI',                rut: null, cmfEntityUrl: null, cmfEntityType: 'banco',   cmfLegalName: null, verified: false, notes: 'CMF name may be "BANCO DE CREDITO E INVERSIONES"' },
  { ticker: 'ENELAM',    companyName: 'Enel Américas',            rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: '' },
  { ticker: 'ENELCHILE', companyName: 'Enel Chile',               rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "ENEL CHILE S.A."' },
  { ticker: 'COLBUN',    companyName: 'Colbún',                   rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may include accent: "COLBÚN S.A."' },
  { ticker: 'CMPC',      companyName: 'CMPC',                     rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "EMPRESAS CMPC S.A."' },
  { ticker: 'CAP',       companyName: 'CAP',                      rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "CAP S.A."' },
  { ticker: 'VAPORES',   companyName: 'CSAV',                     rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "COMPAÑIA SUD AMERICANA DE VAPORES S.A."' },
  { ticker: 'LTM',       companyName: 'LATAM Airlines',           rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'Previously filed as LAN; CMF name needs confirmation' },
  { ticker: 'PARAUCO',   companyName: 'Parque Arauco',            rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "PARQUE ARAUCO S.A."' },
  { ticker: 'MALLPLAZA', companyName: 'Mall Plaza',               rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: '' },
  { ticker: 'AGUAS-A',   companyName: 'Aguas Andinas',            rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'Listed as AGUAS-A (Serie A)' },
  { ticker: 'ANDINA-B',  companyName: 'Coca-Cola Andina',         rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'Listed as ANDINA-B (Serie B); CMF name unconfirmed' },
  { ticker: 'CCU',       companyName: 'CCU',                      rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "COMPAÑIA CERVECERIAS UNIDAS S.A."' },
  { ticker: 'CONCHATORO',companyName: 'Viña Concha y Toro',       rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may include "VIÑA CONCHA Y TORO S.A."' },
  { ticker: 'ENTEL',     companyName: 'Entel',                    rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "EMPRESA NACIONAL DE TELECOMUNICACIONES S.A."' },
  { ticker: 'SONDA',     companyName: 'Sonda',                    rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "SONDA S.A."' },
  { ticker: 'RIPLEY',    companyName: 'Ripley Corp',              rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "RIPLEY CORP S.A."' },
  { ticker: 'SECURITY',  companyName: 'Grupo Security',           rut: null, cmfEntityUrl: null, cmfEntityType: 'emisor',  cmfLegalName: null, verified: false, notes: 'CMF name may be "GRUPO SECURITY S.A."' },
  { ticker: 'ITAUCORP',  companyName: 'Itaú CorpBanca',           rut: null, cmfEntityUrl: null, cmfEntityType: 'banco',   cmfLegalName: null, verified: false, notes: 'CMF name may be "BANCO ITAU CORPBANCA"' },
]

export function getCmfEntityByTicker(ticker: string): CmfEntityMapEntry | undefined {
  return cmfEntityMap.find(e => e.ticker === ticker)
}

/** Attempt a fuzzy match of a CMF legal name to an internal ticker.
 *  Returns null if no confident match found (caller should log as unmatched). */
export function matchCmfEntityName(cmfName: string): CmfEntityMapEntry | null {
  const normalized = cmfName.toUpperCase().trim()
  // Exact legal name match first
  const exact = cmfEntityMap.find(e => e.cmfLegalName === normalized)
  if (exact) return exact
  // Partial keyword match — conservative: only match if the company's display name
  // appears as a substring of the CMF name (after normalization)
  for (const entry of cmfEntityMap) {
    const kw = entry.companyName.toUpperCase().replace(/[^A-Z0-9 ]/g, '')
    if (kw.length > 3 && normalized.includes(kw)) return entry
  }
  return null
}

export function verifiedCmfEntityCount(): number {
  return cmfEntityMap.filter(e => e.verified).length
}
