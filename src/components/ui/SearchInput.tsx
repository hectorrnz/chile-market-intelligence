'use client'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /**
   * Preferred (maximum) width. The field grows to fill the space its toolbar
   * gives it and shrinks below this at narrow widths (Fable spec:
   * `flex:1 1 200px; max-width:…`) rather than holding a fixed pixel width
   * that would push the toolbar past the viewport.
   */
  width?: number
  /** Accessible name. Falls back to `placeholder` — a placeholder alone is not a label. */
  ariaLabel?: string
}

/**
 * Fable search pill (999px capsule, chip fill/border, inline search glyph).
 * Controlled-input semantics are unchanged from the pre-Fable rectangular
 * field: same `value`/`onChange` contract, same `type="text"` behavior.
 */
export function SearchInput({ value, onChange, placeholder, width = 200, ariaLabel }: SearchInputProps) {
  return (
    <div className="relative min-w-0 flex-1" style={{ maxWidth: width }}>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-fg"
      >
        <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.5" />
        <line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="w-full h-8 rounded-full border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] pl-8 pr-3 text-xs text-foreground placeholder:text-muted-fg outline-none focus:border-accent nv-transition"
      />
    </div>
  )
}
