interface SectionHeaderProps {
  title: string
  subtitle?: string
  tag?: string
  actions?: React.ReactNode
}

export function SectionHeader({ title, subtitle, tag, actions }: SectionHeaderProps) {
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
      {actions && (
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {actions}
        </div>
      )}
    </div>
  )
}
