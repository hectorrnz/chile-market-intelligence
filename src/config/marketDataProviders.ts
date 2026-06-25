// Phase 4C — Market data provider configuration.
//
// This is the single source of truth for which Brain Data endpoints back each
// market data type. Entries stay status:'pending' until confirmed against the
// official Brain Data OpenAPI specification with valid credentials.
// Do NOT guess endpoint paths. Do NOT set status:'confirmed' without running
// the official API discovery (Phase 4C.1).

export type EndpointStatus = 'confirmed' | 'pending' | 'unavailable'

export interface ProviderEndpoint {
  /** Human-readable description of what this endpoint returns. */
  description: string
  /** Endpoint path concept — null until confirmed from official docs. */
  path: string | null
  status: EndpointStatus
  notes: string
}

export interface MarketDataProviderConfig {
  name: string
  displayName: string
  baseUrl: string | null
  authMode: 'api-key' | 'oauth2-client-credentials' | 'unknown'
  documentsUrl: string | null
  registrationUrl: string | null
  confirmedEndpoints: Record<string, ProviderEndpoint>
  notes: string
}

export const BRAIN_DATA_CONFIG: MarketDataProviderConfig = {
  name: 'brain-data',
  displayName: 'Brain Data / Bolsa de Santiago',
  baseUrl: null,   // Set after official confirmation — do not guess
  authMode: 'unknown',  // Must be confirmed with Brain Data
  documentsUrl: null,   // Obtain from Brain Data registration
  registrationUrl: 'https://www.braindata.cl',
  confirmedEndpoints: {
    // All endpoints are pending until confirmed with official credentials.
    stockSnapshot: {
      description: 'Last trade / price snapshot for one or more securities',
      path: null,
      status: 'pending',
      notes: 'Unknown path. Typical conventions: /v1/prices/last, /v1/quotes, /v1/instruments/{ticker}/last. Confirm from official docs.',
    },
    stockHistory: {
      description: 'OHLCV historical prices for a security',
      path: null,
      status: 'pending',
      notes: 'Unknown path. Typical: /v1/prices/history, /v1/historical. Need date range and frequency params.',
    },
    allSnapshots: {
      description: 'Batch snapshot of all tracked securities',
      path: null,
      status: 'pending',
      notes: 'Unknown if batch endpoint exists. May need individual calls per ticker.',
    },
    indices: {
      description: 'Index levels (IPSA and other BCS indices)',
      path: null,
      status: 'pending',
      notes: 'Unknown path. May be separate from equity prices.',
    },
    sectors: {
      description: 'Sector-level performance aggregates',
      path: null,
      status: 'pending',
      notes: 'Unknown if Brain Data publishes sector aggregates. May need to compute from constituent data.',
    },
    securitiesMaster: {
      description: 'Official list of all tradeable instruments with symbol, ISIN, currency',
      path: null,
      status: 'pending',
      notes: 'Needed to confirm tickerMap.ts providerSymbol values. Typical: /v1/instruments or /v1/securities.',
    },
  },
  notes: [
    'Brain Data is the official market data platform of Bolsa de Santiago.',
    'Access requires registration and an approved account.',
    'No official OpenAPI spec has been obtained yet (Phase 4C.1 task).',
    'All endpoint paths in this file are placeholders — do not use in production.',
  ].join(' '),
}

/** Returns true only when Brain Data credentials are present in server env. */
export function isBrainDataConfigured(): boolean {
  return Boolean(process.env.BRAIN_DATA_API_KEY?.trim())
}
