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

  // ── Pending — not yet mapped ───────────────────────────────────────────────

  // IPC and IMACEC: actual BCCh data was not found in candidates due to encoding
  // issue in SearchSeries response (UTF-8 served as Latin-1 garbled accented chars).
  // These series likely exist as MONTHLY in BCCh BDE. Re-run bcch:search after
  // fixing encoding, or look up on BCCh BDE portal at si3.bcentral.cl.
  'ipc-mom': pending('ipc-mensual', 'MONTHLY', 'none',
    'Not found: encoding issue in SearchSeries response masked accented titles. Use the published m/m variation series; else set transformation=mom on the IPC level index.'),
  'ipc-yoy': pending('ipc-anual', 'MONTHLY', 'none',
    'Not found: encoding issue in SearchSeries response. Use the published 12-month variation series; else set transformation=yoy on the IPC level index.'),
  'imacec-yoy': pending('imacec-anual', 'MONTHLY', 'none',
    'Not found: zero candidates (encoding issue). IMACEC 12-month variation series is published monthly by BCCh. Re-run after encoding fix.'),

  // USD/CLP: "dólar observado" not found in candidates (accent in "dólar" garbled).
  // Likely F072.TCO.PRE.Z.D but this is NOT confirmed — do not set seriesId until
  // verified via SearchSeries or BCCh BDE portal. No guessing.
  usdclp: pending('usdclp', 'DAILY', 'none',
    'Not found: encoding issue masked "dólar observado" title. Candidate likely in F072 family. Needs SearchSeries re-run or portal lookup to confirm.'),

  // Unemployment: not found in candidates. May be in MONTHLY BCCh BDE (INE via BDE).
  unemployment: pending('desempleo', 'MONTHLY', 'none',
    'Not found: zero candidates. INE unemployment data may be in MONTHLY frequency. Re-run after encoding fix.'),

  // Copper: BCCh series is USD/oz (F019.PPB.PRE.100.D). UI expects CLP/lb. Unit
  // mismatch — keep disabled here; source externally in a later phase.
  copper: pending('cobre-lme', 'DAILY', 'none',
    'Unit mismatch: BCCh publishes copper in USD/oz, UI needs CLP/lb. Source from LME/external in a later phase. Keep disabled for BCCh.'),

  // Chilean fixed-income — partial progress:
  // BTU/BCU 10Y and 5Y are mapped above via the BUF secondary market composite.
  // BTP 10Y: no secondary market BTP rate found; only auction rates (non-daily).
  // BCU 5Y: BCU bonds stale (last auction 2011-2013); BUF 5Y already covers this.
  'btp-10': pending('btp10', 'DAILY', 'none',
    'No secondary market BTP series found. F022.BTP.TIN.AN10.NO.Z.D is an auction rate, not a continuous daily secondary market rate.'),
  'bcu-5': pending('bcu5', 'DAILY', 'none',
    'BCU bonds no longer actively issued. Last licitación 2011-2013. BUF 5Y (btu-5) covers combined BCU/BTU secondary market at 5Y.'),

  // PDBC: 90d tenor discontinued. Active instrument is 14d (F022.PDBC.TIN.D014.NO.Z.D).
  // Mapping 14d to "PDBC 90d" display label would be misleading. Needs UI label update first.
  'pdbc-90d': pending('pdbc90', 'DAILY', 'none',
    'BCCh no longer issues PDBC at 90d. Active PDBC is 14d (F022.PDBC.TIN.D014.NO.Z.D = 4.5%). UI label needs update before mapping.'),

  // TPM TNA: BCCh TPM (F022.TPM.TIN.D001.NO.Z.D) IS the nominal annual rate.
  // No separate TNA series found. Verify whether tpm-tna should share the TPM series.
  'tpm-tna': pending('tpm', 'DAILY', 'none',
    'TPM is already expressed as nominal annual rate. No distinct TNA series found. May share the TPM seriesId — investigate before enabling.'),
}

/** A mapping is live-eligible only when verified AND it has a seriesId. */
export function isManualSeriesLive(entry: BcchManualEntry | undefined): boolean {
  return Boolean(entry && entry.verified && entry.seriesId)
}

/** Count of verified entries — used by scripts/tests/docs. */
export function verifiedCount(): number {
  return Object.values(bcchSeriesManualMap).filter(isManualSeriesLive).length
}
