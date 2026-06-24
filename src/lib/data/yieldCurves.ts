import raw from '@/data/yieldCurves.json'

export interface YieldCurve {
  label: string
  unit: string
  tenors: string[]
  today: number[]
  weekAgo: number[]
  yearEnd: number[]
  source: string
}

const curves = raw as Record<string, YieldCurve>

export function getYieldCurve(region: 'CL' | 'US'): YieldCurve {
  return curves[region]
}
