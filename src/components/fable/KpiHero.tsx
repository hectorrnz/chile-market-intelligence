'use client'

import type { ReactNode } from 'react'
import { GlassSurface } from './GlassSurface'
import { Sparkline, type SparklineTone } from './Sparkline'
import { ChangeIndicator } from './ChangeIndicator'
import { PrivacyValue } from './PrivacyValue'
import { useCountUp } from './useCountUp'
import { useLang } from '@/components/providers/LangProvider'

interface KpiHeroMini {
  label: string
  value: string
  /**
   * True when the mini carries a MONETARY value rather than a percentage. It is
   * then masked by the hero's OWN `privacyMasked` state — deliberately not a
   * second flag the caller could set inconsistently, so a hero cannot end up
   * hiding its headline amount while printing another amount underneath it.
   */
  sensitive?: boolean
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
  /**
   * R13.R3C.4 — render WITHOUT the card surface, as a plain block.
   *
   * For a hero that is one half of a larger card rather than a card of its own:
   * a nested `GlassSurface` would stack two blurs, which the material rules
   * forbid outright. Everything else about the hero is identical, so the two
   * placements can never drift into two different heroes.
   */
  bare?: boolean
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
  source, asOf, privacyMasked = false, countUp = false, minis, bare = false, className = '',
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

  const Surface = bare ? BareSurface : GlassSurface

  return (
    <Surface variant="card" className={`${bare ? '' : 'p-5 '}flex flex-col gap-2 ${className}`}>
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
              <span className="ui-number text-sm text-foreground">
                {m.sensitive ? <PrivacyValue masked={privacyMasked}>{m.value}</PrivacyValue> : m.value}
              </span>
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
    </Surface>
  )
}

/**
 * The `bare` stand-in for `GlassSurface`: same call signature, no material.
 * Declared at module scope, never inside render — the project's React-Compiler
 * rule, and it also keeps the element identity stable across re-renders so the
 * count-up animation is not restarted by a remount.
 */
function BareSurface({ className, children }: { variant?: string; className?: string; children: ReactNode }) {
  return <div className={className}>{children}</div>
}
