import raw from '@/data/fundamentals.json'

export interface FundamentalRecord {
  ticker: string
  period: string
  reportDate: string
  revenue: number
  ebitda: number | null
  grossProfit: number
  operatingIncome: number
  netIncome: number
  rdExpense: number
  sgaExpense: number
  sbcExpense: number
  depAmort: number
  eps: number | null
  ebitdaMargin: number | null
  revenueYoY: number | null
  netIncomeYoY: number | null
  fcf: number
  ocf: number
  capex: number
  cash: number
  ltDebt: number
  sharesOut: number | null
  dividendsPaid: number
  buybacks: number
}

const data = raw as FundamentalRecord[]

export function getFundamentals(ticker: string): FundamentalRecord[] {
  return data.filter(d => d.ticker === ticker)
}
