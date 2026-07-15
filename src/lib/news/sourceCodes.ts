// Short source codes for the compact NH/Bloomberg-terminal News row style —
// a 2-3 letter code shown to the left of the timestamp instead of spelling
// out the full source name inline (the full name is still available via
// the element's `title` tooltip). A manual map is used rather than an
// auto-abbreviation algorithm, since the News source universe is small and
// curated (see docs/data_source_status.md) — a hand-picked code reads better
// than a mechanically-derived one (e.g. "Diario Financiero" -> "DF", not "DIA").
const NEWS_SOURCE_CODES: Record<string, string> = {
  'Diario Financiero': 'DF',
  'Emol':              'EM',
  'Diario Estrategia':  'DE',
  'La Tercera':         'LT',
  'Pulso':              'PU',
  'CMF':                'CMF',
  'BCCh':               'BC',
}

/** Falls back to the first 2-3 letters (uppercased) for any source not yet in the manual map — never blank, never throws. */
export function getNewsSourceCode(source: string): string {
  const known = NEWS_SOURCE_CODES[source]
  if (known) return known
  const letters = source.replace(/[^a-zA-Z]/g, '')
  return (letters.slice(0, 3) || '??').toUpperCase()
}
