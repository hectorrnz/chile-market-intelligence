import companiesData from '@/data/companies.json'
import type { Company } from '@/types'

const companies = companiesData as Company[]

export function getAllCompanies(): Company[] { return companies }
export function getCompanyByTicker(ticker: string): Company | undefined {
  return companies.find(c => c.ticker === ticker)
}
export function getTrackedCompanies(): Company[] { return companies.filter(c => c.isTracked) }
export function getSectors(): string[] { return [...new Set(companies.map(c => c.sector))].sort() }
