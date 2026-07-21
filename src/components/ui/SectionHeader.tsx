interface SectionHeaderProps {
  title: string
  subtitle?: string
  tag?: string
  actions?: React.ReactNode
}

export function SectionHeader({ title, subtitle, tag, actions }: SectionHeaderProps) {
  // flex-wrap + min-w-0: at narrow widths a wide actions group drops to its
  // own line instead of pushing the header past the viewport.
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-5">
      <div className="min-w-0">
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
        <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
          {actions}
        </div>
      )}
    </div>
  )
}
