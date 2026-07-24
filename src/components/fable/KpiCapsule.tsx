'use client'

import { GlassSurface } from './GlassSurface'
import { Sparkline, type SparklineTone } from './Sparkline'
import { ChangeIndicator } from './ChangeIndicator'
import { PrivacyValue } from './PrivacyValue'
import { useCountUp } from './useCountUp'
import { useLang } from '@/components/providers/LangProvider'

interface KpiCapsuleProps {
  label: string
  /** A numeric value is formatted via `formatValue`; a string is shown verbatim; `null` renders the "Unavailable" state — never a fabricated number. */
  value: number | string | null
  formatValue?: (v: number) => string
  sub?: string
  changeValue?: number | null
  changeLabel?: string
  sparklineData?: number[]
  sparklineTone?: SparklineTone
  sparklineSummary?: string
  source?: string
  asOf?: string
  privacyMasked?: boolean
  /** Animates the numeric value in on mount/update (Fable kpiCountUp). Off by default — opt in per call site. Always respects reduced motion. */
  countUp?: boolean
  className?: string
}

/**
 * Compact KPI capsule (Fable `KpiCapsule` — 18px-radius capsule, label +
 * value + optional sub/delta/sparkline). Every value comes through props;
 * this component holds no sample data of its own.
 */
export function KpiCapsule({
  label, value, formatValue, sub, changeValue, changeLabel,
  sparklineData, sparklineTone = 'neutral', sparklineSummary,
  source, asOf, privacyMasked = false, countUp = false, className = '',
}: KpiCapsuleProps) {
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
    <GlassSurface variant="kpi" className={`p-3 flex flex-col gap-1 ${className}`}>
      <span className="ui-label text-muted-fg">{label}</span>
      <div className="flex items-baseline gap-2 flex-wrap">
        <PrivacyValue masked={privacyMasked}>
          <span className="ui-capsule-value text-foreground">{display}</span>
        </PrivacyValue>
        {changeValue !== undefined && <ChangeIndicator value={changeValue} label={changeLabel} />}
      </div>
      {sub && <span className="ui-meta text-muted-fg">{sub}</span>}
      {sparklineData && sparklineData.length > 1 && (
        <Sparkline data={sparklineData} tone={sparklineTone} summary={sparklineSummary ?? `${label}${sub ? ` ${sub}` : ''}`} width={80} height={22} />
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
