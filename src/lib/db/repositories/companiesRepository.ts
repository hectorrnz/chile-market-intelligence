// Phase 5B — Companies repository.
// Static source: src/data/companies.json
// Supabase source: companies table
// Falls back to static when DB_MODE=static or Supabase is not configured.

import type { DbListResult, DbResult } from '../types'
import type { CompanyRow } from '../../supabase/database.types'
import { decideDbSource } from '../dbMode'

// Static data types (matches companies.json shape used by existing UI)
export interface CompanyRecord {
  ticker: string
  name: string
  legalName?: string
  shortName?: string
  sector?: string
  industry?: string
  exchange?: string
  currency?: string
  country: string
  marketCapCLP?: number
  description?: string
  businessSummary?: string
  businessModel?: string
  keyRevenueDrivers?: string[]
  keyRisks?: string[]
  sourceStatus?: string
  active: boolean
  isTracked?: boolean
  updatedAt?: string
}

function loadStatic(): CompanyRecord[] {
  // Import is resolved at build time; no dynamic requires.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../data/companies.json') as CompanyRecord[]
}

export async function getCompanies(): Promise<DbListResult<CompanyRecord>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStatic(), source: 'static' }
      const res = await db.from('companies').select('*').order('ticker')
      const rows = res.data as unknown as CompanyRow[] | null
      if (res.error || !rows) {
        return { data: loadStatic(), source: 'static', error: res.error?.message }
      }
      const records: CompanyRecord[] = rows.map((r) => ({
        ticker: r.ticker,
        name: r.name,
        legalName: r.legal_name ?? undefined,
        sector: r.sector ?? undefined,
        industry: r.industry ?? undefined,
        exchange: r.exchange ?? undefined,
        currency: r.currency ?? undefined,
        country: r.country,
        active: r.active,
        sourceStatus: (r.metadata as Record<string, unknown>)?.sourceStatus as string | undefined,
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStatic(), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStatic(), source: 'static' }
}

export async function getCompanyByTicker(ticker: string): Promise<DbResult<CompanyRecord | null>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: findStatic(ticker), source: 'static' }
      const res = await db.from('companies').select('*').eq('ticker', ticker).single()
      const row = res.data as unknown as CompanyRow | null
      if (res.error || !row) {
        return { data: findStatic(ticker), source: 'static', error: res.error?.message }
      }
      const record: CompanyRecord = {
        ticker: row.ticker,
        name: row.name,
        legalName: row.legal_name ?? undefined,
        sector: row.sector ?? undefined,
        country: row.country,
        active: row.active,
      }
      return { data: record, source: 'supabase' }
    } catch {
      return { data: findStatic(ticker), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: findStatic(ticker), source: 'static' }
}

function findStatic(ticker: string): CompanyRecord | null {
  return loadStatic().find((c) => c.ticker === ticker) ?? null
}
