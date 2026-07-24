'use client'

import { GlassSurface } from './GlassSurface'
import { Sparkline, type SparklineTone } from './Sparkline'
import { ChangeIndicator } from './ChangeIndicator'
import { PrivacyValue } from './PrivacyValue'
import { useCountUp } from './useCountUp'
import { useLang } from '@/components/providers/LangProvider'

interface KpiHeroMini {
  label: string
  value: string
}

interface KpiHeroProps {
  label: string
  value: number | string | null
  formatValue?: (v: number) => string
  changeValue?: number | null
  changeLabel?: string
  sparklineData?: number[]
  sparklineTone?: SparklineTone
  sparklineSummary?: string
  source?: string
  asOf?: string
  privacyMasked?: boolean
  countUp?: boolean
  /** Divider-separated mini stats under the hero value (e.g. MTD/YTD/Since inception). */
  minis?: KpiHeroMini[]
  className?: string
}

/**
 * Hero KPI card (Fable "Hero KPI card" — 40px value, day-change capsule,
 * inline sparkline, divider-separated minis). No embedded sample data —
 * every figure is a prop.
 */
export function KpiHero({
  label, value, formatValue, changeValue, changeLabel,
  sparklineData, sparklineTone = 'neutral', sparklineSummary,
  source, asOf, privacyMasked = false, countUp = false, minis, className = '',
}: KpiHeroProps) {
  const { t } = useLang()
  const numeric = typeof value === 'number' ? value : null
  const animated = useCountUp(numeric ?? 0, countUp && numeric !== null)

  const display =
    value === null
      ? t.fable.kpi.unavailable
      : typeof value === 'string'
        ? value
        : formatValue
          ? formatValue(countUp ? animated : numeric!)
          : String(countUp ? animated : numeric)

  return (
    <GlassSurface variant="card" className={`p-5 flex flex-col gap-2 ${className}`}>
      <span className="ui-label text-muted-fg">{label}</span>
      <div className="flex items-baseline gap-3 flex-wrap">
        <PrivacyValue masked={privacyMasked}>
          <span className="ui-kpi-hero text-foreground">{display}</span>
        </PrivacyValue>
        {changeValue !== undefined && <ChangeIndicator value={changeValue} label={changeLabel} />}
      </div>
      {sparklineData && sparklineData.length > 1 && (
        <Sparkline data={sparklineData} tone={sparklineTone} summary={sparklineSummary ?? label} width={140} height={32} />
      )}
      {minis && minis.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2" style={{ borderTop: '1px solid var(--nv-line)' }}>
          {minis.map((m) => (
            <div key={m.label} className="flex flex-col">
              <span className="ui-meta text-muted-fg">{m.label}</span>
              <span className="ui-number text-sm text-foreground">{m.value}</span>
            </div>
          ))}
        </div>
      )}
      {source && (
        <span className="ui-meta text-muted-fg">
          {t.common.source}: {source}
          {asOf ? ` ${t.common.asOf} ${asOf}` : ''}
        </span>
      )}
    </GlassSurface>
  )
}
