// Phase 8C.1/8C.3/8C.4 — CMF issuer identifier mapping.
//
// Maps app tickers to their CMF issuer identity (RUT sin dígito verificador)
// so the CMF/XBRL provider can construct entidad.php requests. See
// docs/cmf_xbrl_provider_discovery.md for how the first two entries were
// verified, and docs/cmf_xbrl_financials_ingestion.md for the Phase 8C.3/8C.4
// issuer-expansion process.
//
// POLICY: never guess a RUT or CMF entity id. Only add an entry here once you
// have confirmed it against CMF's own official issuer directory (the
// `sociedad[]` dropdown in sa_eeff_ifrs_index.php, which lists every registered
// securities issuer as "<RUT-DV> <LEGAL NAME>") — never a search-engine
// snippet (8C.1 found a snippet that attached the wrong RUT to the wrong
// company). If uncertain, leave the ticker out of CMF_ISSUER_MAP and classify
// it in cmfCoverage.ts with a documented reason.
//
// Phase 8C.4 method: a full discovery sweep matched every app stock's legal
// name against CMF's official RVEMI directory; each exact match's full
// entidad.php → XBRL ZIP → instance chain was then exercised live (FY2025
// annual) before enablement. Only issuers whose live dry-run parsed and
// validated are added here.
//
// coverageStatus:
//   - 'enabled'           → included in the DEFAULT ingestion set (production
//                           writes). getEnabledTickers().
//   - 'eligible_verified' → RUT + legal identity verified and live dry-run
//                           clean, but NOT yet production-ingested (deferred to
//                           a later batch). Never written by the default run;
//                           only reachable via an explicit ?ticker= dry-run.
// Both are RUT-verified. An unverified/unsupported ticker never appears here —
// it is classified in cmfCoverage.ts instead.

export type VerificationStatus = 'verified' | 'review_required'

/** Whether an issuer is in the default (production-write) ingestion set or only verified-and-deferred. */
export type IssuerCoverageStatus = 'enabled' | 'eligible_verified'

export interface CmfIssuerEntry {
  ticker: string
  companyName: string
  cmfIssuerName: string
  /** RUT without the check digit — the form entidad.php expects in `rut=`. */
  rut: string
  cmfEntityId: string | null
  cmfMarket: 'V'
  /** CMF registry group the issuer was found under. All verified issuers so far are RVEMI (securities issuers). Banks are NOT in this directory (see cmfCoverage.ts). */
  registryGroup: 'RVEMI'
  /** Phase 8C.4: default-ingestion membership. Only 'enabled' issuers are written by the default cron/CLI run. */
  coverageStatus: IssuerCoverageStatus
  notes: string
  sourceUrl: string
  /** ISO date this mapping was last confirmed against the live CMF site. */
  verifiedAt: string
  /** Phase 8C.3 (optional, additive): explicit verification status. Only 'verified' entries are used for ingestion. */
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
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'RUT confirmed across 6 independent cmfchile.cl entidad.php links (Identificación, Información Financiera, URL a EEFF, 12 Mayores Accionistas, Prácticas de Gobierno Corporativo). Full end-to-end XBRL download+ingestion confirmed live in Phase 8C.2 (FY2025/FY2024, USD).',
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
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'RUT confirmed across 8 independent cmfchile.cl entidad.php links. Full end-to-end XBRL download chain confirmed live repeatedly (Phase 8C.1 discovery, Phase 8C.2 production write of FY2025, USD).',
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
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'RUT sourced from CMF\'s own official RVEMI issuer directory (the sociedad[] dropdown in sa_eeff_ifrs_index.php) — a single unambiguous match "76.536.353-5 ENEL CHILE S.A.". Live entidad.php + XBRL chain confirmed for FY2024/FY2023 (currency CLP FY2024) and production-written in Phase 8C.3. Currency changed CLP→USD for FY2025 — read per fact, never assumed.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=76536353&mm=12&aa=2024&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (unambiguous single match) + live entidad.php/XBRL chain + production write in Phase 8C.3.',
  },
  CMPC: {
    ticker: 'CMPC',
    companyName: 'Empresas CMPC',
    cmfIssuerName: 'EMPRESAS CMPC S.A.',
    rut: '90222000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'RUT sourced from CMF\'s official RVEMI directory: "90.222.000-3 EMPRESAS CMPC S.A." — distinguished from a DIFFERENT, unrelated entry "96.596.540-8 INVERSIONES CMPC S.A." (not used). Live XBRL chain confirmed + production-written in Phase 8C.3. Currency USD — read per fact.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=90222000&mm=12&aa=2024&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (disambiguated from a similarly-named entity) + live XBRL chain + production write in Phase 8C.3.',
  },
  CENCOSUD: {
    ticker: 'CENCOSUD',
    companyName: 'Cencosud',
    cmfIssuerName: 'CENCOSUD S.A.',
    rut: '93834000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'RUT sourced from CMF\'s official RVEMI directory: "93.834.000-5 CENCOSUD S.A." — distinguished from a DIFFERENT, unrelated entry "76.433.310-1 CENCOSUD SHOPPING S.A." (not used). Live XBRL chain confirmed + production-written in Phase 8C.3. Currency CLP — read per fact.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=93834000&mm=12&aa=2024&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (disambiguated from a similarly-named entity) + live XBRL chain + production write in Phase 8C.3.',
  },

  // ── Phase 8C.4 — enablement batch (10 non-bank issuers) ─────────────────────
  // Each: exact legal-name match in CMF's RVEMI directory + a clean live FY2025
  // annual dry-run (entidad.php → XBRL ZIP → real instance → period-matched →
  // valid_with_warnings). Currency read per fact. Fact/mapped counts recorded
  // from the live dry-run as evidence; not fabricated.
  'LAS-CONDES': {
    ticker: 'LAS-CONDES',
    companyName: 'Clínica Las Condes',
    cmfIssuerName: 'CLINICA LAS CONDES S.A.',
    rut: '93930000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "93.930.000-7 CLINICA LAS CONDES S.A.". Live FY2025 dry-run: 2765 facts, 27 mapped line items, currency CLP, valid_with_warnings (unmapped-concept long tail only).',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=93930000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  CAP: {
    ticker: 'CAP',
    companyName: 'CAP S.A.',
    cmfIssuerName: 'CAP S.A.',
    rut: '91297000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "91.297.000-0 CAP S.A.". Live FY2025 dry-run: 7960 facts, 29 mapped, currency USD (read per fact), valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=91297000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  ENELAM: {
    ticker: 'ENELAM',
    companyName: 'Enel Américas',
    cmfIssuerName: 'ENEL AMERICAS S.A.',
    rut: '94271000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "94.271.000-3 ENEL AMERICAS S.A.". Live FY2025 dry-run: 12307 facts, 25 mapped, currency USD (read per fact), valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=94271000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  COLBUN: {
    ticker: 'COLBUN',
    companyName: 'Colbún',
    cmfIssuerName: 'COLBUN S.A.',
    rut: '96505760',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "96.505.760-9 COLBUN S.A.". Live FY2025 dry-run: 4720 facts, 25 mapped, currency USD (read per fact), valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=96505760&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  'AGUAS-A': {
    ticker: 'AGUAS-A',
    companyName: 'Aguas Andinas',
    cmfIssuerName: 'AGUAS ANDINAS S.A.',
    rut: '61808000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "61.808.000-5 AGUAS ANDINAS S.A.". Live FY2025 dry-run: 4353 facts, 24 mapped, currency CLP, valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=61808000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  RIPLEY: {
    ticker: 'RIPLEY',
    companyName: 'Ripley Corp',
    cmfIssuerName: 'RIPLEY CORP S.A.',
    rut: '99579730',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "99.579.730-5 RIPLEY CORP S.A.". Live FY2025 dry-run: 5696 facts, 29 mapped, currency CLP, valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=99579730&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  PARAUCO: {
    ticker: 'PARAUCO',
    companyName: 'Parque Arauco',
    cmfIssuerName: 'PARQUE ARAUCO S.A.',
    rut: '94627000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "94.627.000-8 PARQUE ARAUCO S.A.". Live FY2025 dry-run: 5674 facts, 27 mapped, currency CLP, valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=94627000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  ENTEL: {
    ticker: 'ENTEL',
    companyName: 'Entel Chile',
    cmfIssuerName: 'EMPRESA NACIONAL DE TELECOMUNICACIONES S.A.',
    rut: '92580000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "92.580.000-7 EMPRESA NACIONAL DE TELECOMUNICACIONES S.A." (Entel). Live FY2025 dry-run: 4526 facts, 26 mapped, currency CLP, valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=92580000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  CCU: {
    ticker: 'CCU',
    companyName: 'Compañía Cervecerías Unidas',
    cmfIssuerName: 'COMPAÑIA CERVECERIAS UNIDAS S.A.',
    rut: '90413000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "90.413.000-1 COMPAÑIA CERVECERIAS UNIDAS S.A.". Live FY2025 dry-run: 15014 facts, 27 mapped, currency CLP, valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=90413000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  LTM: {
    ticker: 'LTM',
    companyName: 'LATAM Airlines Group',
    cmfIssuerName: 'LATAM AIRLINES GROUP S.A.',
    rut: '89862200',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'enabled',
    notes:
      'Exact RVEMI directory match "89.862.200-2 LATAM AIRLINES GROUP S.A.". Live FY2025 dry-run: 4296 facts, 30 mapped, currency USD (read per fact), valid_with_warnings.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=89862200&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },

  // ── Phase 8C.4 — eligible_verified (deferred to a later batch) ──────────────
  // RUT + legal identity verified and live dry-run clean, but intentionally NOT
  // production-ingested this phase (batch-size limit + name-form conservatism).
  // Never written by the default run — getEnabledTickers() excludes these.
  CONCHATORO: {
    ticker: 'CONCHATORO',
    companyName: 'Viña Concha y Toro',
    cmfIssuerName: 'VIÑA CONCHA Y TORO S.A.',
    rut: '90227000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'eligible_verified',
    notes:
      'Exact RVEMI directory match "90.227.000-0 VIÑA CONCHA Y TORO S.A.". Live FY2025 dry-run clean: 5407 facts, 29 mapped, currency CLP, valid_with_warnings. Deferred from the Phase 8C.4 production batch purely to keep the batch at 10 — enable in the next batch.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=90227000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI sociedad[] directory (exact match) + live FY2025 entidad.php/XBRL dry-run.',
  },
  FALABELLA: {
    ticker: 'FALABELLA',
    companyName: 'Falabella',
    cmfIssuerName: 'FALABELLA S.A.',
    rut: '90749000',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'eligible_verified',
    notes:
      'RVEMI directory + entidad.php razón social both "FALABELLA S.A." at RUT 90.749.000-9 — the app\'s legalName "S.A.C.I. Falabella" is the older name form for the same issuer (RUT-confirmed, not a guess). Live FY2025 dry-run clean: 16742 facts, 29 mapped, currency CLP, valid_with_warnings. Deferred one batch for conservative extra confidence on the name-form difference.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=90749000&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI directory + entidad.php razón social cross-check (name-form difference resolved) + live FY2025 XBRL dry-run.',
  },
  MALLPLAZA: {
    ticker: 'MALLPLAZA',
    companyName: 'Mall Plaza',
    cmfIssuerName: 'PLAZA S.A.',
    rut: '76017019',
    cmfEntityId: null,
    cmfMarket: 'V',
    registryGroup: 'RVEMI',
    coverageStatus: 'eligible_verified',
    notes:
      'RVEMI directory + entidad.php razón social both "PLAZA S.A." at RUT 76.017.019-4 — the issuer trades as "Mall Plaza" (app legalName "Mall Plaza S.A."); "Plaza S.A." is its registered legal name (RUT-confirmed, not a guess). Live FY2025 dry-run clean: 6557 facts, 27 mapped, currency CLP, valid_with_warnings. Deferred one batch for conservative extra confidence on the trading-name/legal-name difference.',
    sourceUrl:
      'https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&control=svs&tipoentidad=RVEMI&vig=VI&grupo=0&rut=76017019&mm=12&aa=2025&tipo=C&tipo_norma=IFRS&pestania=3',
    verifiedAt: '2026-07-08',
    verificationStatus: 'verified',
    verificationMethod: 'Official CMF RVEMI directory + entidad.php razón social cross-check (trading-name difference resolved) + live FY2025 XBRL dry-run.',
  },
}

/**
 * App tickers that are NOT securities-issuer XBRL candidates because they are
 * banks. Chilean banks are supervised under CMF's separate "Bancos e
 * Instituciones Financieras" track (former SBIF) and are NOT present in the
 * securities-issuer XBRL directory used by this pipeline — confirmed in Phase
 * 8C.4 by matching every app stock against CMF's own sociedad[] directory under
 * every registry group (rg_rf=RVEMI/RGEIN/RGB/RB/BANC all return the identical
 * securities list, with zero bank entries). The bank track uses a bank-specific
 * accounting taxonomy (net interest income, loan-loss provisions — not
 * revenue/EBITDA/gross profit) that must NEVER be forced into the industrial
 * concept map. Do not guess bank RUTs. See cmfCoverage.ts (bank_track_required).
 */
export const UNMAPPED_TICKERS: Record<string, string> = {
  BSANTANDER:
    'Bank (Banco Santander-Chile). Absent from CMF\'s securities-issuer XBRL directory under every registry group (RVEMI/RGEIN/RGB/RB/BANC) — Phase 8C.1 also found a search-snippet RUT (97036000) that returned "Sin información" when queried directly (wrong). Banks report under CMF\'s separate banking-supervision track with a bank-specific taxonomy; not ingestible through this securities-issuer pipeline and never to be forced into the industrial concept map. Do not guess.',
  CHILE:
    'Bank (Banco de Chile). Absent from CMF\'s securities-issuer XBRL directory under every registry group (RVEMI/RGEIN/RGB/RB/BANC). Banks report under CMF\'s separate banking-supervision track (bank-specific taxonomy). Do not guess.',
  BCI:
    'Bank (Banco de Crédito e Inversiones). Absent from CMF\'s securities-issuer XBRL directory under every registry group (RVEMI/RGEIN/RGB/RB/BANC). Banks report under CMF\'s separate banking-supervision track (bank-specific taxonomy). Do not guess.',
  ITAUCL:
    'Bank (Itaú Chile). Absent from CMF\'s securities-issuer XBRL directory under every registry group (RVEMI/RGEIN/RGB/RB/BANC). Banks report under CMF\'s separate banking-supervision track (bank-specific taxonomy). Do not guess.',
}

/**
 * App tickers that ARE registered securities issuers with a real annual XBRL
 * filing (verified live in Phase 8C.4), but whose filing uses a different XBRL
 * instance dialect than the current `xbrli:`-prefixed regex parser supports, so
 * it parses to zero contexts/facts. NOT enabled — extending the parser to these
 * dialects is deferred to a future phase. The RUT is directory-verified; the
 * reason is a parser limitation, not a missing filing.
 */
export const UNSUPPORTED_XBRL_TICKERS: Record<string, string> = {
  SONDA:
    'RVEMI-verified (83.628.100-4 SONDA S.A.). Real FY2025/FY2024 XBRL instances download fine, but they use the default XBRL namespace (unprefixed <context>/<unit> elements) rather than the xbrli:-prefixed dialect the current regex parser targets, so they parse to 0 facts. Parser support for the default-namespace dialect is deferred — filing exists, not a coverage gap.',
  'ANDINA-B':
    'RVEMI-verified (91.144.000-8 EMBOTELLADORA ANDINA S.A.). Real FY2025/FY2024 XBRL instances are generated by "CTI Service" in ISO-8859-1 with a different element structure the current parser does not extract (0 facts). Parser support for this dialect is deferred — filing exists, not a coverage gap.',
  VAPORES:
    'RVEMI-verified (90.160.000-7 COMPAÑIA SUD AMERICANA DE VAPORES S.A.). Real FY2025/FY2024 XBRL instances are generated by "CTI Service" in ISO-8859-1 with a different element structure the current parser does not extract (0 facts). Parser support for this dialect is deferred — filing exists, not a coverage gap.',
}

export function getCmfIssuer(ticker: string): CmfIssuerEntry | null {
  return CMF_ISSUER_MAP[ticker] ?? null
}

export function isCmfIssuerMapped(ticker: string): boolean {
  return ticker in CMF_ISSUER_MAP
}

/** All tickers with a verified CMF RUT mapping (enabled + eligible_verified). */
export function getMappedTickers(): string[] {
  return Object.keys(CMF_ISSUER_MAP)
}

/**
 * Tickers in the DEFAULT ingestion set — the only ones the cron/CLI default run
 * production-writes. eligible_verified issuers are intentionally excluded so
 * adding a verified-but-deferred issuer to the map never triggers an unintended
 * production write.
 */
export function getEnabledTickers(): string[] {
  return Object.values(CMF_ISSUER_MAP).filter((e) => e.coverageStatus === 'enabled').map((e) => e.ticker)
}

/** Verified-but-deferred tickers (not production-written by the default run). */
export function getEligibleVerifiedTickers(): string[] {
  return Object.values(CMF_ISSUER_MAP).filter((e) => e.coverageStatus === 'eligible_verified').map((e) => e.ticker)
}

/** True only for issuers in the default (production-write) ingestion set. */
export function isCmfIssuerEnabled(ticker: string): boolean {
  return CMF_ISSUER_MAP[ticker]?.coverageStatus === 'enabled'
}
