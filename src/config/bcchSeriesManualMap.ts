// Phase 4B — Controlled BCCh series mapping layer.
//
// This is the SINGLE source of truth for which BCCh BDE series back each macro
// indicator. It is filled in by HUMAN verification only:
//   1. Run `npm run bcch:search` (needs credentials) to discover candidates.
//   2. Review tmp/bcch-series-candidates.json + the terminal confidence report.
//   3. Paste the confirmed official seriesId here and set verified=true.
//   4. Run `npm run bcch:validate` to sanity-check live values.
//
// ⚠️ POLICY: never set a seriesId you have not confirmed against the official
// BCCh SearchSeries/GetSeries catalog. No guessed codes. Until verified=true AND
// seriesId!=null, the indicator stays disabled and the app serves static data.
//
// `staticId` links each entry to the id used in the static JSON
// (macroIndicators.json / macroHistory.json / chileanRates RATE_HIST) for the
// fallback path.

export type BcchFrequency = 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
export type BcchTransform = 'none' | 'yoy' | 'mom' | 'level-to-yoy' | 'bp-to-pct'

export interface BcchManualEntry {
  /** Official BDE series code — null until verified. NEVER guess. */
  seriesId: string | null
  /** Only true once a human confirms the seriesId against the catalog. */
  verified: boolean
  frequency: BcchFrequency
  /** How the provider derives the displayed value/change from the raw series. */
  transformation: BcchTransform
  /** Static id this maps to for the fallback path. */
  staticId: string
  sourceName: string | null
  confidence: 'high' | 'medium' | 'low'
  verificationDate: string | null
  verificationMethod: string | null
  notes: string
}

const pending = (
  staticId: string,
  frequency: BcchFrequency,
  transformation: BcchTransform,
  notes = 'Pending official BDE verification'
): BcchManualEntry => ({
  seriesId: null,
  verified: false,
  frequency,
  transformation,
  staticId,
  sourceName: null,
  confidence: 'low',
  verificationDate: null,
  verificationMethod: null,
  notes,
})

export const bcchSeriesManualMap: Record<string, BcchManualEntry> = {
  // ── Verified series (Phase 4B.1 — 2026-06-24) ─────────────────────────────

  tpm: {
    seriesId: 'F022.TPM.TIN.D001.NO.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'tpm',
    sourceName: 'Tasa de política monetaria (TPM) (porcentaje)',
    confidence: 'high',
    verificationDate: '2026-06-24',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'Exact name match. Latest 24-06-2026 = 4.5%. Only TPM level series in catalog.',
  },

  uf: {
    seriesId: 'F073.UFF.PRE.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'uf-diaria',
    sourceName: 'Unidad de fomento (UF)',
    confidence: 'high',
    verificationDate: '2026-06-24',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'Unambiguous. High-confidence hit. Latest 24-06-2026 = 40,804 CLP.',
  },

  'btu-10': {
    seriesId: 'F022.BUF.TIS.AN10.UF.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'btu10-ref',
    sourceName: 'Tasa de interés mercado secundario, bonos en UF a 10 años (BCU, BTU)',
    confidence: 'high',
    verificationDate: '2026-06-24',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'BCCh secondary market composite rate for UF bonds at 10Y. Covers BCU+BTU. Latest 22-06-2026 = 2.47%.',
  },

  'btu-5': {
    seriesId: 'F022.BUF.TIS.AN05.UF.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'btu5',
    sourceName: 'Tasa de interés mercado secundario, bonos en UF a 5 años (BCU, BTU)',
    confidence: 'high',
    verificationDate: '2026-06-24',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'BCCh secondary market composite rate for UF bonds at 5Y. Covers BCU+BTU. Latest 22-06-2026 = 2.34%.',
  },

  'camara-swap-2y': {
    seriesId: 'F022.SPC.TIN.AN02.NO.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'swap2y',
    sourceName: 'Swap promedio camara (SPC) en pesos 2 años',
    confidence: 'high',
    verificationDate: '2026-06-24',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'SPC nominal 2Y in CLP. Latest 23-06-2026 = 4.66%.',
  },

  'camara-swap-1y': {
    seriesId: 'F022.SPC.TPR.D360.NO.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'swap1y',
    sourceName: 'Swap promedio de camara, nominal. 360 días',
    confidence: 'high',
    verificationDate: '2026-06-24',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: '360-day nominal Cámara swap (~1Y). No SPC.TIN.AN01.NO exists; TPR.D360.NO is the correct 1Y. Latest 23-06-2026 = 4.498%.',
  },

  // ── Verified series (Phase 4B.2 — 2026-06-25) ─────────────────────────────

  usdclp: {
    seriesId: 'F073.TCO.PRE.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'usdclp',
    sourceName: 'Tipo de cambio nominal (dólar observado $CLP/USD)',
    confidence: 'high',
    verificationDate: '2026-06-25',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'Official dólar observado (CLP per USD). Latest 25-06-2026 = 921.42. Encoding fix was required to discover via SearchSeries.',
  },

  'ipc-mom': {
    seriesId: 'F074.IPC.VAR.Z.EP23.C.M',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'none',
    staticId: 'ipc-mensual',
    sourceName: 'Serie Empalmada IPC Diciembre 2009 a la fecha, Variación Mensual, base 2023 = 100',
    confidence: 'high',
    verificationDate: '2026-06-25',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'Directly the m/m % change (not index level). Serie empalmada base 2023=100. Latest May-2026 = 0.2%. Encoding fix required to discover.',
  },

  'ipc-yoy': {
    seriesId: 'F074.IPC.V12.Z.EP23.C.M',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'none',
    staticId: 'ipc-anual',
    sourceName: 'Serie Empalmada IPC Diciembre 2009 a la fecha, Variación 12 Meses, base 2023 = 100',
    confidence: 'high',
    verificationDate: '2026-06-25',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'Directly the 12-month % change. Base 2023=100 spliced from Dec 2009. Latest May-2026 = 3.9%. Encoding fix required to discover.',
  },

  'imacec-yoy': {
    seriesId: 'F032.IMC.IND.Z.Z.EP18.Z.Z.0.M',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'yoy',
    staticId: 'imacec-anual',
    sourceName: 'Imacec a costo de factores, serie empalmada (índice 2018=100)',
    confidence: 'high',
    verificationDate: '2026-06-25',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'IMACEC level index (base 2018=100). No direct 12m variation series found in BCCh catalog; transformation=yoy derives the yoy % change. Latest Apr-2026 = 114.24 (index level). Encoding fix required to discover.',
  },

  unemployment: {
    seriesId: 'F049.DES.TAS.INE.10.M',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'none',
    staticId: 'desempleo',
    sourceName: 'Tasa de desocupación, total | Ajustada estacionalmente | INE | Mensual | Porcentaje',
    confidence: 'high',
    verificationDate: '2026-06-25',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'INE total unemployment rate, seasonally adjusted, national. Latest Apr-2026 = 8.9%. Encoding fix required to discover.',
  },

  // Phase 8D — verified via live SearchSeries: F019.PPB.PRE.100.D (daily) is
  // USD/oz (unit mismatch with the UI's USD/lb), but F019.PPB.PRE.40.M is a
  // SEPARATE, distinct BCCh series already published in USD/lb — exactly the
  // unit macroSeries.ts's `cobre-lme` entry expects. Confirmed live: real
  // current values (e.g. May-2026 = 6.13 USD/lb), monthly frequency, labeled
  // by BCCh itself as "valores referenciales, obtenidas de fuentes
  // internacionales" (a compiled international reference price, not BCCh's
  // own market operation) — cross-checked against Yahoo Finance's COMEX
  // copper futures (HG=F, ~6.28 USD/lb same period) and found consistent.
  copper: {
    seriesId: 'F019.PPB.PRE.40.M',
    verified: true,
    frequency: 'MONTHLY',
    transformation: 'none',
    staticId: 'cobre-lme',
    sourceName: 'Precio del cobre refinado BML (dólares/libra)',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation (Phase 8D); cross-checked against Yahoo Finance HG=F futures for the same period.',
    notes: 'Official BCCh reference copper price already in USD/lb (matches the UI unit exactly) — distinct from the USD/oz daily series (F019.PPB.PRE.100.D) that caused the original unit-mismatch deferral. Monthly frequency only; no daily USD/lb series exists at BCCh.',
  },

  // Phase 8D.1 — verified via live SearchSeries + a fresh GetSeries re-check
  // this phase (real recent daily values ~1040-1054 CLP/EUR, plausible).
  // Previously discovered (Phase 8D) but deliberately left unwired pending a
  // UI slot; now wired as the FX panel's second BCCh-verified pair.
  eurclp: {
    seriesId: 'F072.CLP.EUR.N.O.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'eurclp',
    sourceName: 'Tipo de cambio nominal euro ($CLP/EUR)',
    confidence: 'high',
    verificationDate: '2026-07-10',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation (Phase 8D discovery); re-confirmed live with a fresh GetSeries call in Phase 8D.1 before wiring.',
    notes: 'Official BCCh nominal EUR/CLP exchange rate. Daily. Latest observations in the ~1040-1054 CLP/EUR range, consistent with real EUR/CLP levels.',
  },

  // Chilean fixed-income — partial progress:
  // BTU/BCU 10Y and 5Y are mapped above via the BUF secondary market composite.
  // BCU 5Y: BCU bonds stale (last auction 2011-2013); re-confirmed live 2026-07-15
  // (GetSeries returned zero valid observations for 2025-2026) — genuinely no live
  // source exists. The "BCU 5" row was removed from the UI rather than fake it.
  'bcu-5': pending('bcu5', 'DAILY', 'none',
    'BCU bonds no longer actively issued (re-confirmed 2026-07-15: zero valid 2025-2026 observations via GetSeries). Row removed from the Chilean Rates panel — no live proxy substituted.'),

  // BTP 10Y — re-verified 2026-07-15: BCCh only auctions the 10Y tenor
  // occasionally (F022.BTP.TIN.AN10.NO.Z.D last printed 17-Dec-2025, 7 months
  // stale). BTP 2Y (F022.BTP.TIN.AN02.NO.Z.D) is the closest tenor with a
  // materially fresher print. Per explicit user decision, the row is relabeled
  // "BTP 2" (chileanRates.json name/fullName) rather than showing a stale 10Y
  // value or leaving it static — the id stays "btp10" internally only to avoid
  // churning the persisted drag-order key.
  'btp-10': {
    seriesId: 'F022.BTP.TIN.AN02.NO.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'btp10',
    sourceName: 'Tasas de interés por licitación de BTP a 2 años (base 365 días) (porcentaje)',
    confidence: 'medium',
    verificationDate: '2026-07-15',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation; user-approved tenor substitution (10Y auction rate too stale, 2Y is the freshest longer tenor)',
    notes: 'Row relabeled "BTP 2" in the UI — this is an auction rate for the 2-year tenor, not the 10-year the row previously showed. No live 10Y BTP rate exists (auctions too infrequent).',
  },

  // PDBC: 90d tenor discontinued. Active instrument is 14d — verified live
  // 2026-07-15 (F022.PDBC.TIN.D014.NO.Z.D, daily, last obs 14-07-2026 = 4.5%).
  // UI label updated to "PDBC 14d" to match.
  'pdbc-90d': {
    seriesId: 'F022.PDBC.TIN.D014.NO.Z.D',
    verified: true,
    frequency: 'DAILY',
    transformation: 'none',
    staticId: 'pdbc90',
    sourceName: 'Tasa de interés de PDBC a 14 días (porcentaje)',
    confidence: 'high',
    verificationDate: '2026-07-15',
    verificationMethod: 'BCCh SearchSeries + GetSeries validation',
    notes: 'BCCh no longer issues PDBC at 90d; the active tenor is 14d. Row relabeled "PDBC 14d" in the UI to match what is actually live.',
  },

  // TPM TNA: BCCh TPM (F022.TPM.TIN.D001.NO.Z.D) IS the nominal annual rate —
  // the same series already live for the main "tpm" indicator. No distinct TNA
  // series exists in the catalog. This entry is intentionally left NOT
  // separately live-enabled here (verified stays false) to avoid a redundant
  // duplicate BCCh fetch of the exact same series under a second series
  // definition — the UI (Home + Macro Chilean Rates panels) instead resolves
  // this row's live value directly from the already-fetched "tpm" indicator
  // via `getSeriesByStaticId('tpm-tna').fallbackStaticId === 'tpm'`
  // (src/config/macroSeries.ts), so it always matches the Macro Chile table's
  // TPM value exactly with zero extra network calls.
  'tpm-tna': pending('tpm-tna', 'DAILY', 'none',
    'TPM is already expressed as nominal annual rate — no distinct TNA series exists. Deliberately not separately live-enabled: the UI resolves this row\'s value from the already-fetched "tpm" indicator (see macroSeries.ts fallbackStaticId) instead of duplicating the fetch.'),
}

/** A mapping is live-eligible only when verified AND it has a seriesId. */
export function isManualSeriesLive(entry: BcchManualEntry | undefined): boolean {
  return Boolean(entry && entry.verified && entry.seriesId)
}

/** Count of verified entries — used by scripts/tests/docs. */
export function verifiedCount(): number {
  return Object.values(bcchSeriesManualMap).filter(isManualSeriesLive).length
}
