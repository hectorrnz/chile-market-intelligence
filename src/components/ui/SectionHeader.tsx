import { AsOfBadge } from './AsOfBadge'

interface SectionHeaderProps {
  title: string
  subtitle?: string
  tag?: string
  actions?: React.ReactNode
  /** Show the "as of <date>" data-freshness chip in the header. */
  asOf?: boolean
}

export function SectionHeader({ title, subtitle, tag, actions, asOf }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        {tag && (
          <div className="ui-label text-muted-fg mb-1">
            {tag}
          </div>
        )}
        <h1 className="text-xl font-semibold text-foreground leading-snug">{title}</h1>
        {subtitle && (
          <p className="text-xs text-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      {(actions || asOf) && (
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {asOf && <AsOfBadge />}
          {actions}
        </div>
      )}
    </div>
  )
}
