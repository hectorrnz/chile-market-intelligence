'use client'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
}

export function SearchInput({ value, onChange, placeholder, width = 200 }: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-7 bg-surface border border-border rounded px-3 text-xs text-foreground placeholder:text-muted-fg outline-none focus:border-accent"
      style={{ width }}
    />
  )
}
