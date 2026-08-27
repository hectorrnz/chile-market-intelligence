// R13.9 — Alternatives event PRESENTATION mapping (doc 07 §§ 7.4, 8).
//
// Pure and client-safe. The UI consumes the parser's persisted classification
// verbatim (doc 03 § 3.4) — this module maps each event type to its semantic
// colour TOKEN and nothing else. It never re-runs colour matching, never reads
// a resolved hex off an event row, and never infers a type from an amount.
//
// SOURCE COLOUR vs PRESENTATION — two distinct concepts, both explicit:
//
//   * ALT_EVENT_SOURCE_HEX below is the CANONICAL record of each type's
//     documented source-legend colour (doc 03 § 3.2). It is the semantic
//     identity — classification already happened at parse time against the
//     workbook's own legend, and this constant preserves what those colours
//     ARE, independent of any theme.
//
//   * The `--alt-event-*` CSS variable pairs in `globals.css` are the
//     PRESENTATION. The LIGHT theme renders the literal source colours ("
//     colours drawn from the source legend", doc 07 § 7.4); the DARK theme
//     renders documented derivative tints of the same hues for contrast on a
//     dark surface (doc 07 § 8 requires both values per token). A tinted dark
//     rendering is never claimed to be the raw source fill — meaning always
//     travels in the TEXT label beside the chip, so the theme can adapt the
//     pigment without ever touching the classification.
//
// `unclassified` deliberately maps to a hollow warning treatment: it is an
// explicit, actionable state, not a fourth event colour.

/** The persisted event-type vocabulary (alternatives_events CHECK). */
export const ALT_EVENT_TYPES = ['aporte', 'dividendo', 'distribucion', 'unclassified'] as const

/**
 * The documented source-legend colours (doc 03 § 3.2), verbatim: Aporte
 * `DC1` navy, Dividendo `DC2` green, Distribución `DC3` theme-3/dk2 base
 * (rendered in the sheet at tint 0.4). Canonical semantic identity —
 * presentation tokens derive from these, never the other way around.
 * `unclassified` has NO source colour by definition.
 */
export const ALT_EVENT_SOURCE_HEX: Readonly<Record<string, string>> = {
  aporte: '#002060',
  dividendo: '#92D050',
  distribucion: '#1F497D',
}

export type AltEventType = (typeof ALT_EVENT_TYPES)[number]

export function isAltEventType(value: string): value is AltEventType {
  return (ALT_EVENT_TYPES as readonly string[]).includes(value)
}

/** CSS variable carrying the event's semantic colour in BOTH themes. */
export function altEventColorVar(eventType: string): string {
  switch (eventType) {
    case 'aporte':
      return 'var(--alt-event-aporte)'
    case 'dividendo':
      return 'var(--alt-event-dividendo)'
    case 'distribucion':
      return 'var(--alt-event-distribucion)'
    default:
      // Unclassified — and any future unknown type — presents as the explicit
      // needs-attention state, never as one of the three semantic colours.
      return 'var(--alt-event-unclassified)'
  }
}

/**
 * Whether the chip renders FILLED (a classified semantic colour) or HOLLOW
 * (unclassified/unknown). The type is always ALSO named in text beside the
 * chip — never meaning by colour alone (doc 07 § 8).
 */
export function altEventChipStyle(eventType: string): 'filled' | 'hollow' {
  return isAltEventType(eventType) && eventType !== 'unclassified' ? 'filled' : 'hollow'
}
