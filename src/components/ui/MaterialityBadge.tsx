'use client'
import { useLang } from '@/components/providers/LangProvider'

type Materiality = 'Low' | 'Medium' | 'High'

const styleMap: Record<Materiality, React.CSSProperties> = {
  High:   { backgroundColor: 'color-mix(in oklab, var(--negative) 10%, var(--surface))', color: 'var(--negative)', borderColor: 'color-mix(in oklab, var(--negative) 22%, var(--surface))' },
  Medium: { backgroundColor: 'color-mix(in oklab, var(--warning) 12%, var(--surface))', color: 'var(--warning)', borderColor: 'color-mix(in oklab, var(--warning) 26%, var(--surface))' },
  Low:    { backgroundColor: 'color-mix(in oklab, var(--accent) 10%, var(--surface))', color: 'var(--accent)', borderColor: 'color-mix(in oklab, var(--accent) 22%, var(--surface))' },
}

export function MaterialityBadge({ materiality }: { materiality: Materiality }) {
  const { t } = useLang()
  const labels: Record<Materiality, string> = {
    High:   t.home.materialityHigh,
    Medium: t.home.materialityMedium,
    Low:    t.home.materialityLow,
  }
  return (
    <span className="text-xs px-1.5 py-0.5 border rounded whitespace-nowrap" style={styleMap[materiality]}>
      {labels[materiality]}
    </span>
  )
}
