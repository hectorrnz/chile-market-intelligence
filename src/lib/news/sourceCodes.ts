// Short source codes + identity colors for the compact NH/Bloomberg-terminal
// News row style — a 2-3 letter code shown to the left of the timestamp
// instead of spelling out the full source name inline (the full name is
// still available via the element's `title` tooltip), and a distinct color
// per outlet so multiple sources are distinguishable at a glance.
//
// A manual map is used rather than an auto-abbreviation algorithm, since the
// News source universe is small and curated (see docs/data_source_status.md)
// — a hand-picked code reads better than a mechanically-derived one (e.g.
// "Diario Financiero" -> "DF", not "DIA").
//
// Colors are CSS variables defined in globals.css (`--news-src-*`, light +
// dark), NOT hardcoded hex — this keeps them theme-aware and inside the
// design token system. They are institutional identity colors from the GS
// palette, deliberately NOT the positive/negative/warning signal tokens
// (those carry meaning elsewhere).

interface NewsSourceMeta {
  code: string
  /** CSS custom property name (defined in globals.css) for this source's code color. */
  colorVar: string
}

const NEWS_SOURCE_META: Record<string, NewsSourceMeta> = {
  'Diario Financiero':  { code: 'DF',  colorVar: '--news-src-df' },
  'La Tercera':         { code: 'LT',  colorVar: '--news-src-lt' },
  'Emol':               { code: 'EM',  colorVar: '--news-src-em' },
  'Diario Estrategia':  { code: 'DE',  colorVar: '--news-src-de' },
  'CMF':                { code: 'CMF', colorVar: '--news-src-cmf' },
  'BCCh':               { code: 'BC',  colorVar: '--news-src-bc' },
}

/** Falls back to the first 2-3 letters (uppercased) for any source not yet in the manual map — never blank, never throws. */
export function getNewsSourceCode(source: string): string {
  const known = NEWS_SOURCE_META[source]
  if (known) return known.code
  const letters = source.replace(/[^a-zA-Z]/g, '')
  return (letters.slice(0, 3) || '??').toUpperCase()
}

/** Returns a `var(--news-src-*)` color string for the source code, or the muted-fg token for any unmapped source. */
export function getNewsSourceColor(source: string): string {
  const known = NEWS_SOURCE_META[source]
  return `var(${known ? known.colorVar : '--muted-fg'})`
}
