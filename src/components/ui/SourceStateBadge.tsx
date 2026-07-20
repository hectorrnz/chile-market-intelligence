'use client'

// Phase 8A — Shared source/status chip covering all 7 canonical SourceStates.
// Subtle by design (small dot + label), mirrors the existing DataSourceBadge /
// MarketDataSourceBadge / CmfDataSourceBadge visual language so a new module
// never looks inconsistent with an established one. Prefer this component for
// any NEW source badge; the three domain-specific badges above remain in
// place for macro/market/CMF call sites already wired to their own i18n keys.

import { useLang } from '@/components/providers/LangProvider'
import { SOURCE_REGISTRY, getSourceLabel, getStateWord, type SourceKey, type SourceState } from '@/lib/dataSourceRegistry'

const DOT_STYLE: Record<SourceState, { background: string; border?: string }> = {
  live:             { background: 'var(--positive)' },
  persisted:        { background: 'var(--accent)' },
  hybrid:           { background: 'var(--accent)' },
  static_fallback:  { background: 'var(--muted-fg)' },
  // Hollow dot — visually distinguishes "always-static sample" from a
  // live-system fallback (static_fallback), without adding a new color.
  static_mvp:       { background: 'transparent', border: '1.5px solid var(--muted-fg)' },
  blocked:          { background: 'var(--negative)' },
  unavailable:      { background: 'var(--warning)' },
}

// Resolved once at module scope from the registry.
const SOURCE_STATE_LOOKUP: Record<SourceKey, SourceState> = Object.fromEntries(
  Object.entries(SOURCE_REGISTRY).map(([key, entry]) => [key, entry.state]),
) as Record<SourceKey, SourceState>

export function SourceStateBadge({
  sourceKey,
  className = '',
}: {
  sourceKey: SourceKey
  className?: string
}) {
  const { lang } = useLang()
  const state = SOURCE_STATE_LOOKUP[sourceKey]
  // Visible text is always the bare status word — never a source/provider
  // name (see getStateWord's doc comment). The full descriptive registry
  // label is still available on hover.
  const word = getStateWord(state, lang)
  const fullLabel = getSourceLabel(sourceKey, lang)
  const dot = DOT_STYLE[state]

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-fg whitespace-nowrap ${className}`}
      title={fullLabel}
    >
      <span
        className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
        style={{ backgroundColor: dot.background, border: dot.border }}
        aria-hidden
      />
      {word}
    </span>
  )
}
