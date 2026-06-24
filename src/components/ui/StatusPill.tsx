// StatusPill uses inline styles with color-mix() so that all variants
// automatically adapt to both light and dark mode via CSS variables.

type PillVariant = 'positive' | 'negative' | 'neutral' | 'warning' | 'info' | 'soon'

function pillStyle(colorVar: string, alpha = 0.12): React.CSSProperties {
  return {
    backgroundColor: `color-mix(in oklab, var(${colorVar}) ${Math.round(alpha * 100)}%, var(--surface))`,
    color: `var(${colorVar})`,
    borderColor: `color-mix(in oklab, var(${colorVar}) ${Math.round(alpha * 100 * 2.2)}%, var(--surface))`,
  }
}

const VARIANT_STYLE: Record<PillVariant, React.CSSProperties> = {
  positive: pillStyle('--positive'),
  negative: pillStyle('--negative'),
  warning:  pillStyle('--warning'),
  info:     pillStyle('--accent', 0.12),
  neutral:  { backgroundColor: 'var(--surface-2)', color: 'var(--muted)', borderColor: 'var(--border)' },
  soon:     { backgroundColor: 'var(--surface-2)', color: 'var(--muted-fg)', borderColor: 'var(--border)' },
}

interface StatusPillProps {
  label: string
  variant?: PillVariant
}

export function StatusPill({ label, variant = 'neutral' }: StatusPillProps) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-xs rounded border"
      style={VARIANT_STYLE[variant]}
    >
      {label}
    </span>
  )
}
