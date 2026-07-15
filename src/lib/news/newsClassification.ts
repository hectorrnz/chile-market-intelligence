// Deterministic category + impact classification for the News module.
// Every decision is a plain keyword/context rule, never a vague sentiment
// score — each item carries an explainable impactReason string.

import type { NewsCategory, NewsImpactLevel, NewsSourceType } from '@/types'
import type { AffectedMapping } from './tickerMapping'

const MACRO_KEYWORDS = /\b(tpm|tasa de pol[ií]tica monetaria|ipc|inflaci[oó]n|imacec|pib|banco central|bcch)\b/i
const REGULATION_KEYWORDS = /\b(cmf|normativa|sanciona|sanci[oó]n|multa|norma de car[aá]cter general|ncg)\b/i
const EARNINGS_KEYWORDS = /\b(resultados|utilidades|ebitda|utilidad neta|ingresos trimestrales|trimestre|reporta(ron)?)\b/i
const CORPORATE_ACTION_KEYWORDS = /\b(adquisici[oó]n|oferta p[uú]blica|opa|dividendo|recompra de acciones|aumento de capital|guidance|fusi[oó]n)\b/i
const COMMODITY_SHOCK_KEYWORDS = /\b(cae|sube|se dispara|colapsa|retrocede|se desploma|repunta)\b/i
const BANK_REGULATORY_KEYWORDS = /\b(capital|solvencia|emisi[oó]n de bonos|clasificaci[oó]n de riesgo|downgrade|rebaja de clasificaci[oó]n)\b/i

/** Infers a taxonomy category from headline+summary text. Falls back to 'Market'. */
export function classifyCategory(text: string, hasTickers: boolean): NewsCategory {
  if (MACRO_KEYWORDS.test(text)) return 'Macro'
  if (REGULATION_KEYWORDS.test(text)) return 'Regulation'
  if (EARNINGS_KEYWORDS.test(text)) return 'Earnings'
  if (hasTickers) return 'Company'
  return 'Market'
}

export interface ImpactClassification {
  impactLevel: NewsImpactLevel
  impactReason: string
}

/**
 * Deterministic impact rules, evaluated in priority order — the first rule
 * that matches wins. Never defaults everything to High: absent a specific
 * matched criterion, impact is Medium (ticker/sector match) or Low (neither).
 */
export function classifyImpact(params: {
  text: string
  category: NewsCategory
  sourceType: NewsSourceType
  mapping: AffectedMapping
}): ImpactClassification {
  const { text, category, sourceType, mapping } = params
  const hasTicker = mapping.tickers.length > 0
  const hasSector = mapping.tags.length > 0
  const hasCommodity = mapping.assets.includes('Copper') || mapping.assets.includes('Lithium')

  // Regulation/Macro categories are already keyword-gated (see
  // classifyCategory) to genuine CMF regulatory actions / BCCh-relevant macro
  // releases — a real regulatory sanction or TPM decision is high-impact
  // whether we read it from CMF/BCCh directly (sourceType 'official') or from
  // a media outlet reporting on it. The distinction only changes the reason text.
  if (category === 'Regulation') {
    return {
      impactLevel: 'High',
      impactReason: sourceType === 'official' ? 'Official regulatory disclosure (CMF)' : 'Regulatory action reported (CMF sanction/normativa)',
    }
  }
  if (category === 'Macro' && MACRO_KEYWORDS.test(text)) {
    return {
      impactLevel: 'High',
      impactReason: sourceType === 'official' ? 'Official BCCh macroeconomic release' : 'Major macro release reported (TPM/IPC/IMACEC/PIB)',
    }
  }
  if (hasCommodity && COMMODITY_SHOCK_KEYWORDS.test(text)) {
    return { impactLevel: 'High', impactReason: 'Commodity price shock (copper/lithium) relevant to Chile equities' }
  }
  if (mapping.tags.includes('Banking') && BANK_REGULATORY_KEYWORDS.test(text)) {
    return { impactLevel: 'High', impactReason: 'Bank capital/solvency/bond issuance or regulatory event' }
  }
  if (hasTicker && CORPORATE_ACTION_KEYWORDS.test(text)) {
    return { impactLevel: 'High', impactReason: 'Corporate action (acquisition/dividend/buyback/capital increase) on a tracked company' }
  }
  if (hasTicker && category === 'Earnings') {
    return { impactLevel: 'High', impactReason: 'Earnings/results release for a tracked company' }
  }
  if (hasTicker) {
    return { impactLevel: 'Medium', impactReason: 'Direct mention of a tracked company' }
  }
  if (hasSector) {
    return { impactLevel: 'Medium', impactReason: 'Sector-wide event affecting a tracked sector' }
  }
  if (category === 'Macro') {
    return { impactLevel: 'Medium', impactReason: 'General macroeconomic news' }
  }
  return { impactLevel: 'Low', impactReason: 'No tracked company, sector, or major macro release matched' }
}
