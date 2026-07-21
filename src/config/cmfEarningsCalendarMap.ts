// CMF earnings-calendar (EEFF sending-date) RUT map for the app's 25 tracked
// tickers.
//
// SOURCE: CMF's own official "Fechas de envío de EEFF" calendar
// (https://www.cmfchile.cl/institucional/mercados/novedades_envio_fechas_eeff.php),
// a public, no-CAPTCHA page listing every registered issuer's Razón Social,
// RUT, and the dates it will send its interim (Mar/Jun/Sep) and annual (Dec)
// financial statements. Directed by the user to use this exact source.
//
// POLICY: never guess a RUT. Every RUT below was verified directly against that
// CMF page (matched on the RUT prefix for the 21 securities issuers already in
// cmfIssuerMap.ts, and read straight off CMF's own row for the two banks). The
// `rut` value is the RUT WITHOUT its check digit — CMF's table prints it with a
// check digit (e.g. "97004000-5"), and rows are matched on the prefix.
//
// COVERAGE GAP (honest, not fabricated): Banco Santander-Chile (BSANTANDER) and
// Banco Itaú Chile (ITAUCL) are ABSENT from this CMF calendar entirely — only
// three banks appear on it (Banco de Chile, BCI, Banco Ripley). Their `rut` is
// therefore null and they carry no published report date; the UI shows an
// honest "—" for them rather than an invented date.

export interface CmfEarningsCalendarEntry {
  ticker: string
  /** RUT without the check digit, matched against the CMF calendar's rows. Null when the issuer is absent from the CMF calendar. */
  rut: string | null
  /** Why an entry has no RUT (documented gap), when applicable. */
  note?: string
}

export const CMF_EARNINGS_CALENDAR_MAP: Record<string, CmfEarningsCalendarEntry> = {
  // Securities issuers — RUTs cross-checked against cmfIssuerMap.ts AND matched live in the CMF calendar.
  'SQM-B': { ticker: 'SQM-B', rut: '93007000' },
  COPEC: { ticker: 'COPEC', rut: '90690000' },
  ENELCHILE: { ticker: 'ENELCHILE', rut: '76536353' },
  CMPC: { ticker: 'CMPC', rut: '90222000' },
  CENCOSUD: { ticker: 'CENCOSUD', rut: '93834000' },
  'LAS-CONDES': { ticker: 'LAS-CONDES', rut: '93930000' },
  CAP: { ticker: 'CAP', rut: '91297000' },
  ENELAM: { ticker: 'ENELAM', rut: '94271000' },
  COLBUN: { ticker: 'COLBUN', rut: '96505760' },
  'AGUAS-A': { ticker: 'AGUAS-A', rut: '61808000' },
  RIPLEY: { ticker: 'RIPLEY', rut: '99579730' },
  PARAUCO: { ticker: 'PARAUCO', rut: '94627000' },
  ENTEL: { ticker: 'ENTEL', rut: '92580000' },
  CCU: { ticker: 'CCU', rut: '90413000' },
  LTM: { ticker: 'LTM', rut: '89862200' },
  CONCHATORO: { ticker: 'CONCHATORO', rut: '90227000' },
  FALABELLA: { ticker: 'FALABELLA', rut: '90749000' },
  MALLPLAZA: { ticker: 'MALLPLAZA', rut: '76017019' },
  SONDA: { ticker: 'SONDA', rut: '83628100' },
  'ANDINA-B': { ticker: 'ANDINA-B', rut: '91144000' },
  VAPORES: { ticker: 'VAPORES', rut: '90160000' },
  // Banks present in the CMF calendar — RUT read directly off CMF's own row.
  CHILE: { ticker: 'CHILE', rut: '97004000' }, // "97004000-5 BANCO DE CHILE"
  BCI: { ticker: 'BCI', rut: '97006000' }, // "97006000-6 BANCO DE CREDITO E INVERSIONES"
  // Banks ABSENT from the CMF calendar — no published EEFF-sending date exists here.
  BSANTANDER: {
    ticker: 'BSANTANDER',
    rut: null,
    note: 'Banco Santander-Chile is not listed in the CMF EEFF-dates calendar (only Banco de Chile, BCI and Banco Ripley appear). No published report date.',
  },
  ITAUCL: {
    ticker: 'ITAUCL',
    rut: null,
    note: 'Banco Itaú Chile is not listed in the CMF EEFF-dates calendar. No published report date.',
  },
}

/** Reverse lookup: RUT-without-check-digit → ticker, for the tickers that have one. */
export const RUT_TO_TICKER: Record<string, string> = Object.fromEntries(
  Object.values(CMF_EARNINGS_CALENDAR_MAP)
    .filter((e): e is CmfEarningsCalendarEntry & { rut: string } => e.rut !== null)
    .map((e) => [e.rut, e.ticker]),
)

/** Tracked tickers with NO CMF-published report date (documented gap). */
export const UNLISTED_EARNINGS_TICKERS: string[] = Object.values(CMF_EARNINGS_CALENDAR_MAP)
  .filter((e) => e.rut === null)
  .map((e) => e.ticker)
