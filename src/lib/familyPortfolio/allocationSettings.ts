// R13.R2 §§ 14-15 — Asset Allocation presentation settings.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import — the
// same discipline as `entitlements.ts`, so the enum vocabulary is shared
// verbatim by the API route, the repository, the database CHECK constraints
// and the client, and none of them can drift into a private dialect.
//
// THESE ARE GLOBAL PRODUCT SETTINGS, NOT ONE ADMINISTRATOR'S PREFERENCES
// (§ 15). An approved configuration is what every authorized member sees. The
// authority split is enforced in three independent places: this module's
// validation, the API route's `canAdminister` check, and the PostgreSQL RLS
// write policy. A member may read them and may change nothing.
//
// NO ARBITRARY STYLE PAYLOAD (§§ 14, 15). Every field is a CLOSED ENUM. There
// is no hex field, no RGB field, no CSS field and no free-text field anywhere
// in this contract — a palette is chosen by NAME and resolves to design tokens
// that are declared once in `globals.css` and carry both a light and a dark
// value. A colour outside the approved token set is therefore not merely
// discouraged, it is unrepresentable.
//
// PER-ASSET-CLASS COLOUR ASSIGNMENT IS DELIBERATELY NOT IMPLEMENTED. § 14 lists
// it as optional; it would require a caller-supplied `{ rowKey: token }` map,
// which is exactly the open-ended payload § 15 forbids, and the row keys it
// would be keyed by are private asset labels. Slice colour therefore stays a
// deterministic function of the chosen palette and the entry's own order.

// The reference-line vocabulary lives with the High Water Market semantics it
// governs; it is re-exported here so a settings consumer needs one import.
import {
  DEFAULT_REFERENCE_LINE_MODE,
  isReferenceLineMode,
  REFERENCE_LINE_MODES,
  type ReferenceLineMode,
} from './highWaterMarket.ts'

export { REFERENCE_LINE_MODES, isReferenceLineMode, type ReferenceLineMode }

// ---------------------------------------------------------------------------
// 1 · The closed vocabularies
// ---------------------------------------------------------------------------

/** Where a slice's own label is drawn (§ 14). */
export const LABEL_POSITIONS = ['inside', 'outside', 'legend_only'] as const
export type AllocationLabelPosition = (typeof LABEL_POSITIONS)[number]

/**
 * What a label states. `value` and `percentage_value` print a MONETARY amount,
 * so both are subject to the page's privacy mask exactly like every other
 * amount — a presentation setting can never widen what privacy mode reveals.
 */
export const LABEL_CONTENTS = ['percentage', 'value', 'percentage_value'] as const
export type AllocationLabelContent = (typeof LABEL_CONTENTS)[number]

/** Ring thickness, as named steps — never a caller-supplied pixel or ratio. */
export const DONUT_THICKNESSES = ['thin', 'medium', 'thick'] as const
export type AllocationDonutThickness = (typeof DONUT_THICKNESSES)[number]

/**
 * The curated palettes. A palette is a NAME; its colours are design tokens.
 *
 * TWO, NOT THREE (owner review § 12: "do not provide multiple palette presets
 * that are themselves practically indistinguishable"). The R13.7 `oceanic`
 * preset was eight shades of blue — measured worst pair ΔE 0.037, i.e. two
 * colours a reader cannot tell apart without hovering — and every attempt to
 * repair it inside the approved palette converged on the same set as
 * `spectrum`, because the approved Goldman-derived palette simply does not
 * contain three disjoint families of twelve. Shipping three near-identical
 * presets would satisfy the letter of "three choices" and fail the point of
 * them, so `oceanic` is withdrawn and the two survivors are genuinely
 * different in the leading slots — which is what a 6-to-8-slice donut shows.
 */
export const ALLOCATION_PALETTES = ['institutional', 'spectrum'] as const
export type AllocationPalette = (typeof ALLOCATION_PALETTES)[number]

/**
 * Palette → the ordered CSS custom properties a donut consumes, slot by slot.
 * Every token is declared in `globals.css` with BOTH a light and a dark value,
 * and every colour is drawn from the approved institutional palette.
 *
 * TWELVE SLOTS, NOT EIGHT — AND THAT IS A BUG FIX, NOT A FLOURISH.
 * `paletteTokenAt` wraps, and the live book's personal scopes carry up to 12
 * allocation constituents (measured: Pablo 12, Andrés 11, Jaime 10 on the
 * `total` basis). At eight tokens, slices 1 and 9, 2 and 10, 3 and 11, 4 and 12
 * rendered in the IDENTICAL colour — not merely similar, the same — so four
 * pairs of unlike asset classes were indistinguishable by construction. Twelve
 * slots cover the largest real scope, and the wrap remains only as a guard.
 *
 * ORDER IS PART OF THE DESIGN. Slots are sequenced so that colours which TOUCH
 * — round the ring, which closes — are as far apart as the approved palette
 * allows: cyclic adjacent ΔE 0.143 (institutional) and 0.133 (spectrum),
 * against 0.062 for the R13.7 sets. Validated by `paletteContrast.ts` and
 * enforced by the suite, in BOTH themes, so a future edit cannot quietly
 * reintroduce a pair of near-identical neighbours.
 *
 * PURPLE IS EXCLUDED FROM BOTH. The project's standing rule reserves purple for
 * the "Review" status token, where it carries meaning; giving it a second,
 * conflicting identity meaning here is not available. Signal tokens
 * (`--positive`, `--negative`, `--warning`) are excluded for the same reason.
 */
export const PALETTE_TOKENS: Readonly<Record<AllocationPalette, readonly string[]>> = {
  // Cool-anchored, opening on the R13.7 identity (deep teal → bronze → deep
  // green → institutional blue) so the default presentation stays recognisably
  // the one the family already reads.
  institutional: [
    '--fp-slice-1',
    '--fp-slice-2',
    '--fp-slice-3',
    '--fp-slice-4',
    '--fp-slice-5',
    '--fp-slice-6',
    '--fp-slice-7',
    '--fp-slice-8',
    '--fp-slice-9',
    '--fp-slice-10',
    '--fp-slice-11',
    '--fp-slice-12',
  ],
  // The same approved colours, deliberately re-sequenced so that EVERY slot
  // differs from its institutional counterpart by more than the adjacency floor
  // (worst slot ΔE 0.153) — switching palette visibly changes the whole chart
  // rather than nudging a few slices. The sequence was chosen by search under
  // that objective, subject to keeping its own cyclic adjacency at 0.139.
  spectrum: [
    '--fp-spectrum-1',
    '--fp-spectrum-2',
    '--fp-spectrum-3',
    '--fp-spectrum-4',
    '--fp-spectrum-5',
    '--fp-spectrum-6',
    '--fp-spectrum-7',
    '--fp-spectrum-8',
    '--fp-spectrum-9',
    '--fp-spectrum-10',
    '--fp-spectrum-11',
    '--fp-spectrum-12',
  ],
}

/** Inner-radius fraction per thickness step. Thicker ring = smaller hole. */
export const THICKNESS_INNER_RATIO: Readonly<Record<AllocationDonutThickness, number>> = {
  thin: 0.74,
  medium: 0.62,
  thick: 0.48,
}

// ---------------------------------------------------------------------------
// 2 · The settings record
// ---------------------------------------------------------------------------

export interface AllocationPresentationSettings {
  labelPosition: AllocationLabelPosition
  labelContent: AllocationLabelContent
  legendVisible: boolean
  palette: AllocationPalette
  donutThickness: AllocationDonutThickness
  /**
   * The Portfolio Evolution chart's High Water Market reference (§ 18).
   * `auto` = the owner-required behaviour (ALL + single series only);
   * `hidden` = never drawn. There is deliberately no 'always' — it could only
   * be used to contradict the owner's Compare rule.
   *
   * THE PALETTE SETTING DOES NOT REACH THE EVOLUTION SERIES, and that is a
   * decision, not an omission. `Incl.` and `Excl. Chilean Equities` are two
   * fixed CONCEPTS, not arbitrary categories; their colours are identity, so
   * they stay stable across presentation choices and are validated once as a
   * pair (§ 13). Letting a palette choice re-colour them would put the § 13
   * distinguishability guarantee at the mercy of a dropdown.
   */
  referenceLine: ReferenceLineMode
}

/**
 * The shipped default. Presentation is unchanged from what the family already
 * reads, except where the owner review required a change: the High Water
 * Market reference is `auto`, i.e. visible on the ALL single-series view.
 */
export const DEFAULT_ALLOCATION_SETTINGS: AllocationPresentationSettings = {
  labelPosition: 'legend_only',
  labelContent: 'percentage',
  legendVisible: true,
  palette: 'institutional',
  donutThickness: 'medium',
  referenceLine: DEFAULT_REFERENCE_LINE_MODE,
}

// ---------------------------------------------------------------------------
// 3 · Validation — the single gate every writer passes through
// ---------------------------------------------------------------------------

function isMember<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v)
}

export function isLabelPosition(v: unknown): v is AllocationLabelPosition {
  return isMember(LABEL_POSITIONS, v)
}
export function isLabelContent(v: unknown): v is AllocationLabelContent {
  return isMember(LABEL_CONTENTS, v)
}
export function isDonutThickness(v: unknown): v is AllocationDonutThickness {
  return isMember(DONUT_THICKNESSES, v)
}
export function isAllocationPalette(v: unknown): v is AllocationPalette {
  return isMember(ALLOCATION_PALETTES, v)
}

export type SettingsValidation =
  | { ok: true; settings: AllocationPresentationSettings }
  | { ok: false; invalidFields: string[] }

/**
 * Validates a caller-supplied settings payload. FAIL CLOSED AND EXPLICIT: an
 * unknown enum member is REJECTED and named, never silently coerced to the
 * default — a settings write that quietly stored something other than what was
 * sent would be worse than an error. Unknown extra properties are ignored
 * rather than persisted, so no arbitrary payload can reach the database.
 */
export function validateAllocationSettings(input: unknown): SettingsValidation {
  if (input === null || typeof input !== 'object') return { ok: false, invalidFields: ['body'] }
  const raw = input as Record<string, unknown>
  const invalidFields: string[] = []

  if (!isLabelPosition(raw.labelPosition)) invalidFields.push('labelPosition')
  if (!isLabelContent(raw.labelContent)) invalidFields.push('labelContent')
  if (typeof raw.legendVisible !== 'boolean') invalidFields.push('legendVisible')
  if (!isAllocationPalette(raw.palette)) invalidFields.push('palette')
  if (!isDonutThickness(raw.donutThickness)) invalidFields.push('donutThickness')
  if (!isReferenceLineMode(raw.referenceLine)) invalidFields.push('referenceLine')

  if (invalidFields.length > 0) return { ok: false, invalidFields }
  return {
    ok: true,
    settings: {
      labelPosition: raw.labelPosition as AllocationLabelPosition,
      labelContent: raw.labelContent as AllocationLabelContent,
      legendVisible: raw.legendVisible as boolean,
      palette: raw.palette as AllocationPalette,
      donutThickness: raw.donutThickness as AllocationDonutThickness,
      referenceLine: raw.referenceLine as ReferenceLineMode,
    },
  }
}

/**
 * Normalises a row READ BACK from the database. The CHECK constraints already
 * make an invalid value unstorable, so this only covers the residual cases —
 * a null column, or a row written before a future enum member was added. Here
 * (unlike a caller write) falling back to the documented default is right: a
 * presentation preference must never take the page down.
 */
export function normalizeStoredSettings(row: unknown): AllocationPresentationSettings {
  if (row === null || typeof row !== 'object') return { ...DEFAULT_ALLOCATION_SETTINGS }
  const r = row as Record<string, unknown>
  return {
    labelPosition: isLabelPosition(r.labelPosition)
      ? r.labelPosition
      : DEFAULT_ALLOCATION_SETTINGS.labelPosition,
    labelContent: isLabelContent(r.labelContent)
      ? r.labelContent
      : DEFAULT_ALLOCATION_SETTINGS.labelContent,
    legendVisible:
      typeof r.legendVisible === 'boolean'
        ? r.legendVisible
        : DEFAULT_ALLOCATION_SETTINGS.legendVisible,
    palette: isAllocationPalette(r.palette) ? r.palette : DEFAULT_ALLOCATION_SETTINGS.palette,
    donutThickness: isDonutThickness(r.donutThickness)
      ? r.donutThickness
      : DEFAULT_ALLOCATION_SETTINGS.donutThickness,
    referenceLine: isReferenceLineMode(r.referenceLine)
      ? r.referenceLine
      : DEFAULT_ALLOCATION_SETTINGS.referenceLine,
  }
}

/**
 * The token a slice at `index` uses under `palette`, wrapping past the eighth
 * slot. Returns a token NAME — the caller writes `var(<token>)`, so no
 * component ever holds a colour value.
 */
export function paletteTokenAt(palette: AllocationPalette, index: number): string {
  const tokens = PALETTE_TOKENS[palette] ?? PALETTE_TOKENS[DEFAULT_ALLOCATION_SETTINGS.palette]
  const i = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0
  return tokens[i % tokens.length]
}
