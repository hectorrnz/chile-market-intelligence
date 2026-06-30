// Phase 4C — Internal ticker ↔ provider symbol mapping.
//
// `bolsaSymbol` is our best estimate of the official BCS mnemonic.
// `providerSymbol` is the Brain Data API symbol — must be confirmed against the
// official securities-master endpoint before setting verified=true.
// ALL entries are verified=false until confirmed via official Brain Data API.

export interface TickerMapEntry {
  /** Internal app ticker (used in companies.json, stockPrices.json, etc.) */
  internalTicker: string
  /** Bolsa de Santiago exchange mnemonic — best estimate, unconfirmed. */
  bolsaSymbol: string
  /** Brain Data provider symbol — set to same as bolsaSymbol until confirmed otherwise. */
  providerSymbol: string | null
  /** Exchange MIC code. */
  exchange: 'XSGO'
  /** Trading currency. */
  currency: 'CLP'
  /** Short note about the mapping status or any quirks. */
  notes: string
  /** Only true when confirmed against official Brain Data securities master. */
  verified: boolean
}

export const tickerMap: TickerMapEntry[] = [
  {
    internalTicker: 'SQM-B',
    bolsaSymbol: 'SQM-B',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Serie B (ordinary shares). Two series exist: SQM-A (no vote) and SQM-B (full vote). Confirm correct series code with Brain Data.',
    verified: false,
  },
  {
    internalTicker: 'COPEC',
    bolsaSymbol: 'COPEC',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Empresas Copec — single series.',
    verified: false,
  },
  {
    internalTicker: 'FALABELLA',
    bolsaSymbol: 'FALABELLA',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'S.A.C.I. Falabella — single series.',
    verified: false,
  },
  {
    internalTicker: 'CENCOSUD',
    bolsaSymbol: 'CENCOSUD',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Cencosud — single series.',
    verified: false,
  },
  {
    internalTicker: 'BSANTANDER',
    bolsaSymbol: 'BSANTANDER',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Banco Santander Chile — confirm if BCS uses BSANTANDER or SANTAN.',
    verified: false,
  },
  {
    internalTicker: 'CHILE',
    bolsaSymbol: 'CHILE',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Banco de Chile.',
    verified: false,
  },
  {
    internalTicker: 'BCI',
    bolsaSymbol: 'BCI',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Banco de Crédito e Inversiones.',
    verified: false,
  },
  {
    internalTicker: 'ENELAM',
    bolsaSymbol: 'ENELAM',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Enel Américas — formerly Enersis.',
    verified: false,
  },
  {
    internalTicker: 'ENELCHILE',
    bolsaSymbol: 'ENELCHILE',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Enel Chile — energy generation.',
    verified: false,
  },
  {
    internalTicker: 'COLBUN',
    bolsaSymbol: 'COLBUN',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Colbún — hydro and gas generation.',
    verified: false,
  },
  {
    internalTicker: 'CMPC',
    bolsaSymbol: 'CMPC',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Empresas CMPC — pulp and paper.',
    verified: false,
  },
  {
    internalTicker: 'CAP',
    bolsaSymbol: 'CAP',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'CAP — iron ore, steel.',
    verified: false,
  },
  {
    internalTicker: 'VAPORES',
    bolsaSymbol: 'VAPORES',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Compañía Sud Americana de Vapores — shipping.',
    verified: false,
  },
  {
    internalTicker: 'LTM',
    bolsaSymbol: 'LTM',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'LATAM Airlines Group — confirm if still traded on BCS post-restructuring.',
    verified: false,
  },
  {
    internalTicker: 'PARAUCO',
    bolsaSymbol: 'PARAUCO',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Parque Arauco — mall REIT.',
    verified: false,
  },
  {
    internalTicker: 'MALLPLAZA',
    bolsaSymbol: 'MALLPLAZA',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Mall Plaza — mall operator, Falabella subsidiary.',
    verified: false,
  },
  {
    internalTicker: 'AGUAS-A',
    bolsaSymbol: 'AGUAS-A',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Aguas Andinas Serie A. Confirm hyphen handling with Brain Data.',
    verified: false,
  },
  {
    internalTicker: 'ANDINA-B',
    bolsaSymbol: 'ANDINA-B',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Embotelladora Andina Serie B. Confirm hyphen handling with Brain Data.',
    verified: false,
  },
  {
    internalTicker: 'CCU',
    bolsaSymbol: 'CCU',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Compañía de Cervecerías Unidas.',
    verified: false,
  },
  {
    internalTicker: 'CONCHATORO',
    bolsaSymbol: 'CONCHATORO',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Viña Concha y Toro — wine.',
    verified: false,
  },
  {
    internalTicker: 'ENTEL',
    bolsaSymbol: 'ENTEL',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Empresa Nacional de Telecomunicaciones.',
    verified: false,
  },
  {
    internalTicker: 'SONDA',
    bolsaSymbol: 'SONDA',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Sonda — IT services.',
    verified: false,
  },
  {
    internalTicker: 'RIPLEY',
    bolsaSymbol: 'RIPLEY',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Ripley Corp — retail and financial services.',
    verified: false,
  },
  {
    internalTicker: 'LAS-CONDES',
    bolsaSymbol: 'LAS-CONDES',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Clínica Las Condes — private hospital/clinic. Confirm hyphen handling with Brain Data.',
    verified: false,
  },
  {
    internalTicker: 'ITAUCL',
    bolsaSymbol: 'ITAUCL',
    providerSymbol: null,
    exchange: 'XSGO',
    currency: 'CLP',
    notes: 'Itaú Chile S.A.',
    verified: false,
  },
]

/** Look up a map entry by internal ticker. */
export function getTickerMapEntry(internalTicker: string): TickerMapEntry | undefined {
  return tickerMap.find(e => e.internalTicker === internalTicker)
}

/** Count of verified ticker mappings. */
export function verifiedTickerCount(): number {
  return tickerMap.filter(e => e.verified).length
}
