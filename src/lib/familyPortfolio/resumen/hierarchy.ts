// R13.3 — RESUMEN scope and row-hierarchy classification (doc 02 §§ 2, 5, 7).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// SCOPE ISOLATION IS THE HIGHEST-RISK PROPERTY IN THIS FILE (doc 05 risk A3).
// The Main portfolio's totals are computed from Main's own rows only; Jaime's,
// Andrés's and Pablo's sections live in disjoint ranges below and never feed
// them. Leaking a personal sociedad into Main would inflate the shared book
// that EVERY principal can see — so scope is assigned from the section anchor
// at parse time, and Main's range is bounded by the next scope anchor.
//
// ROW TYPE IS SEMANTIC, NOT POSITIONAL. Sociedad header rows carry NO values
// and sit INSIDE the summed range (doc 02 § 5.2). Treating one as a leaf leaves
// totals numerically unchanged (it adds zero) while silently misattributing the
// hierarchy — harmless arithmetic, harmful structure.

import { textAt, type XlsxSheet } from '../xlsx/readXlsx.ts'

export type ScopeId = 'main' | 'jaime' | 'andres' | 'pablo'

export const SCOPE_IDS: readonly ScopeId[] = ['main', 'jaime', 'andres', 'pablo'] as const

export type RowType =
  | 'group_header'
  | 'asset_class'
  | 'sub_asset_class'
  | 'sociedad_header'
  | 'individual_asset'
  | 'sociedad_subtotal'
  /** R13.8 D4 — a sociedad's TERMINAL aggregate (`TOTAL <SOC>`), distinct from
   *  its intermediate liquid aggregate (`SUBTOTAL <SOC>` / a bare `TOTAL`,
   *  Vanglor-form). One row type could not express both without the Stage-8
   *  tilings double-counting every sociedad (doc 02 § 5.4; doc 07 § 6e). */
  | 'sociedad_total'
  | 'portfolio_subtotal'
  | 'portfolio_total'
  | 'named_holding'
  | 'flow'
  | 'performance'

/** Doc 04 § 7 value-class taxonomy. Stored per field; drives the source badge. */
export type ValueClass =
  | 'source_value'
  | 'source_provided_return'
  | 'source_provided_flow'
  | 'nmi_calculated'
  | 'unavailable'
  | 'not_reproducible'

export interface ScopeRange {
  scope: ScopeId
  /** Row of the section anchor label. */
  anchorRow: number
  /** First and last data row, inclusive. */
  startRow: number
  endRow: number
  anchorLabel: string
}

// ---------------------------------------------------------------------------
// Scope detection
// ---------------------------------------------------------------------------

/** Accent- and case-insensitive comparison key. */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const MAIN_ANCHOR = /^resumen portfolio$|watermill \+ dubai/i
const TECHNICAL_ANCHOR = /^calculo de stocks/i

/** Personal anchors are the bare given name in column B (doc 02 § 2). */
const PERSONAL_ANCHORS: ReadonlyArray<{ scope: ScopeId; pattern: RegExp }> = [
  { scope: 'jaime', pattern: /^jaime$/ },
  { scope: 'andres', pattern: /^andres$/ },
  { scope: 'pablo', pattern: /^pablo$/ },
]

/**
 * Locates each portfolio section by its column-B anchor label.
 *
 * Ranges are derived from the anchors actually found — never from the sample's
 * row numbers, which shift the moment a row is inserted. The technical block
 * (`CÁLCULO DE STOCKS`, doc 02 § 7) terminates the last scope and is itself
 * excluded from ingestion entirely.
 */
export function detectScopes(sheet: XlsxSheet): ScopeRange[] {
  const found: Array<{ scope: ScopeId | 'technical'; row: number; label: string }> = []

  // The scan starts at ROW 1, not at the date header row: the real sheet
  // anchors Main at row 3, ABOVE its own header row (5), and a scan that
  // started at the header silently dropped the entire Main scope (R13.8 D4 —
  // verified against the private reference workbook).
  for (let row = 1; row <= sheet.maxRow; row++) {
    const raw = textAt(sheet, row, 2)
    if (!raw) continue
    const norm = normalizeLabel(raw)

    if (TECHNICAL_ANCHOR.test(norm)) {
      found.push({ scope: 'technical', row, label: raw })
      continue
    }
    if (!found.some((f) => f.scope === 'main') && MAIN_ANCHOR.test(norm)) {
      found.push({ scope: 'main', row, label: raw })
      continue
    }
    for (const p of PERSONAL_ANCHORS) {
      if (p.pattern.test(norm) && !found.some((f) => f.scope === p.scope)) {
        found.push({ scope: p.scope, row, label: raw })
      }
    }
  }

  found.sort((a, b) => a.row - b.row)

  const ranges: ScopeRange[] = []
  for (let i = 0; i < found.length; i++) {
    const cur = found[i]
    if (cur.scope === 'technical') continue
    const next = found[i + 1]
    const endRow = next ? next.row - 1 : sheet.maxRow
    ranges.push({
      scope: cur.scope,
      anchorRow: cur.row,
      startRow: cur.row,
      endRow,
      anchorLabel: cur.label,
    })
  }
  return ranges
}

/** True when a row lies inside the excluded technical block (doc 02 § 7). */
export function technicalBlockStart(sheet: XlsxSheet, headerRow: number): number | null {
  for (let row = headerRow; row <= sheet.maxRow; row++) {
    const raw = textAt(sheet, row, 2)
    if (raw && TECHNICAL_ANCHOR.test(normalizeLabel(raw))) return row
  }
  return null
}

// ---------------------------------------------------------------------------
// Row classification
// ---------------------------------------------------------------------------

const GROUP_HEADERS = /^(portafolio liquido|portfolio liquido|alternativos)$/
const ASSET_CLASSES = /^(caja y equivalentes|renta fija|renta variable|opciones|inmobiliario|venture capital ?\/ ?private equity)$/
const FLOW_LABEL = /^(retiros ?\/ ?aportes|aportes ?\/ ?retiros)/
// Metric ids ARE the persisted vocabulary: `portfolio_performance_rows.metric`
// is CHECK-constrained to ('flow','weekly_profit','weekly_return','ytd_profit',
// 'ytd_return') and every reader (Stage-7 Overview, Stage-8 Weekly Changes)
// queries those names. R13.8 audit finding: the original 'annual_profit'/
// 'annual_return' ids here never matched that enum, so a publish carrying the
// workbook's `Utilidad del Año`/`Retorno del Año` rows would have failed the
// CHECK outright. The year metrics are emitted under their persisted names.
const PERFORMANCE_LABELS: ReadonlyArray<{ metric: string; pattern: RegExp }> = [
  { metric: 'weekly_profit', pattern: /^utilidad de la semana$/ },
  { metric: 'weekly_return', pattern: /^retorno de la semana$/ },
  { metric: 'ytd_profit', pattern: /^utilidad del ano$/ },
  { metric: 'ytd_return', pattern: /^retorno del ano$/ },
]
/**
 * Main's spine lines (doc 02 § 5.3), which sit at the top level and carry
 * values without belonging to any container:
 *
 *   PORTFOLIO LÍQUIDO + ALTERNATIVOS   aggregate of the two subtotals
 *   INRETAIL PERU CORP                 single named holding
 *   SUBTOTAL                           = INRETAIL + (LÍQUIDO + ALTERNATIVOS)
 *   ACCIONES CHILENAS (USD)            derived from the technical block (§ 7)
 *   TOTAL                              = SUBTOTAL + ACCIONES CHILENAS
 *
 * They are enumerated because an unrecognised depth-0 value row now FAILS
 * CLOSED, and these are legitimate.
 */
const NAMED_HOLDING = /^inretail peru corp$|^acciones chilenas/
const SPINE_AGGREGATE = /^port(a)?folio liquido \+ alternativos$/

/**
 * The sociedades that carry their own `SUBTOTAL`/`TOTAL` lines (doc 02 § 2.1).
 *
 * Both forms are sociedad-level aggregates — `TOTAL <SOC>` the TERMINAL
 * `sociedad_total`, `SUBTOTAL <SOC>` the intermediate `sociedad_subtotal`
 * (R13.8 D4). Reading `TOTAL LA ESPERANZA` as a `portfolio_total` would put a
 * sociedad line in the same class as `TOTAL JAIME`, and the personal
 * performance block would then bind to the wrong row — precisely the "silent,
 * plausible-looking error" doc 02 § 2.1 warns about, where Andrés's rows 205
 * and 207 differ materially on the weekly figure (see doc 02 § 2.1).
 */
const SOCIEDAD_NAMES = 'la esperanza|naidelt|los sauzales|retboy|los laureles|vanglor'
const SOCIEDAD_AGGREGATE = new RegExp(`^(subtotal|total) (${SOCIEDAD_NAMES})`)

/**
 * Single named component lines that are NOT aggregates (doc 02 § 2.1).
 *
 * `Proporcional Otras Sociedades` and `Staten Capital (1/3)` are components
 * summed INTO the terminal total, not totals themselves. Classing them as
 * `portfolio_total` would both mislabel them and — because portfolio totals are
 * required cells (doc 02 § 6.3) — make them block publication when the contract
 * does not require them.
 */
const NAMED_COMPONENT = /^proporcional otras sociedades$|^staten capital/

/**
 * Presentation-only annotation rows the source repeats inside every scope —
 * VERIFIED against the reference workbook (R13.8 D4): the `valores en dólares`
 * currency note (whose OTHER columns carry the repeated date headers, so it
 * looks value-bearing and previously fabricated an `individual_asset` holding
 * a date serial), and Main's `Watermill + Dubai + 3 Uruguayas` subtitle. They
 * are never economic nodes; the parser skips them entirely. This recognition
 * is deliberately parser-boundary label matching over documented source
 * constructs — never Stage-8 analytics logic.
 */
const ANNOTATION_LABELS = /^valores en dolares$|watermill \+ dubai/

export function isAnnotationRow(label: string): boolean {
  return ANNOTATION_LABELS.test(normalizeLabel(label))
}

/**
 * Classifies a row from its label, whether it carries a value, and its PARENT.
 *
 * The parent is what distinguishes the two leaf kinds, and the distinction is
 * semantic — taken from the source contract, never from indentation or
 * formatting:
 *
 *   doc 02 § 5.1 (liquid)      asset class → SUB-ASSET CLASS
 *     `Renta Fija` = EMD USD + High Yield + Investment Grade + Preferred,
 *     and doc 04 § 4.1 names exactly those children "sub-asset class".
 *
 *   doc 02 § 5.2 (alternatives) asset class → sociedad header → INDIVIDUAL ASSET
 *     `Inmobiliario` = SUM(rows 27:53), whose members sit under sociedad
 *     sub-headers that carry no values.
 *
 * So a value row directly beneath an `asset_class` is a sub-asset class, and a
 * value row beneath a `sociedad_header` is an individual asset.
 */
export function classifyRow(
  label: string,
  hasValue: boolean,
  parentType: RowType | null = null,
  /**
   * R13.8 D4 — the label of the sociedad currently OPEN on the parse stack,
   * when there is one. It lets the sociedad's own aggregates resolve against
   * the sociedad they actually sit in: `TOTAL <that name>` is its TERMINAL
   * total; `SUBTOTAL <that name>` or a BARE `TOTAL`/`SUBTOTAL` (the verified
   * Vanglor form) is its INTERMEDIATE liquid aggregate. A new sociedad name
   * therefore classifies correctly with no list to maintain.
   */
  sociedadLabel: string | null = null,
): RowType {
  const n = normalizeLabel(label)

  // Main's `PORTAFOLIO LÍQUIDO`/`ALTERNATIVOS` section headers carry no value.
  // Inside a personal sociedad the SAME `Alternativos` word heads a
  // VALUE-BEARING line (doc 02 § 5.4) — an asset-class-grade amount, never a
  // container that could reset the hierarchy.
  if (GROUP_HEADERS.test(n)) return hasValue ? 'asset_class' : 'group_header'
  if (FLOW_LABEL.test(n)) return 'flow'
  if (PERFORMANCE_LABELS.some((p) => p.pattern.test(n))) return 'performance'
  if (NAMED_HOLDING.test(n) || NAMED_COMPONENT.test(n)) return 'named_holding'

  // Sociedad aggregates, resolved against the OPEN sociedad first, then the
  // known-name fallback — always before the generic subtotal/total forms.
  const soc = sociedadLabel !== null ? normalizeLabel(sociedadLabel) : null
  if (soc !== null) {
    if (n === `total ${soc}`) return 'sociedad_total'
    if (n === `subtotal ${soc}` || n === 'total' || n === 'subtotal') return 'sociedad_subtotal'
  }
  if (SOCIEDAD_AGGREGATE.test(n)) return /^total /.test(n) ? 'sociedad_total' : 'sociedad_subtotal'
  if (SPINE_AGGREGATE.test(n) || /^subtotal/.test(n)) return 'portfolio_subtotal'
  if (/^total/.test(n)) return 'portfolio_total'
  if (ASSET_CLASSES.test(n)) return 'asset_class'

  // A labelled row with no value is a grouping label, not a leaf (doc 02 § 5.2).
  if (!hasValue) return 'sociedad_header'

  if (parentType === 'asset_class') return 'sub_asset_class'
  return 'individual_asset'
}

/** The performance metric a `performance` row measures, or null. */
export function performanceMetricOf(label: string): string | null {
  const n = normalizeLabel(label)
  return PERFORMANCE_LABELS.find((p) => p.pattern.test(n))?.metric ?? null
}

/**
 * Row types whose publication-column cell is REQUIRED (doc 02 § 6.3).
 *
 * An error in one of these blocks publication. Leaves, group headers, sociedad
 * headers, flows and performance rows are not required — an error there is a
 * warning, because it cannot silently corrupt a total.
 */
export const REQUIRED_ROW_TYPES: ReadonlySet<RowType> = new Set<RowType>([
  'asset_class',
  'sub_asset_class',
  'sociedad_subtotal',
  'sociedad_total',
  'portfolio_subtotal',
  'portfolio_total',
])

/**
 * Builds a stable `row_key` from the normalized label path (doc 05 § 5.2).
 *
 * DERIVED FROM LABELS, NEVER FROM THE ROW NUMBER — risk A8. The workbook's own
 * weekly ritual inserts rows; a row-index key would re-key every sibling and
 * destroy week-over-week comparability.
 */
export function buildRowKey(scope: ScopeId, path: string[]): string {
  const parts = path.map(labelSlug).filter((p) => p.length > 0)
  return [scope, ...parts].join('.')
}

/** The single-segment slug for one label. */
export function labelSlug(label: string): string {
  return normalizeLabel(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** Appends one label to an existing parent key, keeping the label path stable. */
export function childRowKey(parentKey: string, label: string): string {
  const slug = labelSlug(label)
  return slug.length > 0 ? `${parentKey}.${slug}` : parentKey
}
