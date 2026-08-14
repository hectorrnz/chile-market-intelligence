// R13.4 — fill resolution and legend colour matching (doc 03 §§ 3.2, 3.4).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// This is the part of Stage 4 where formatting IS semantic — the contract
// explicitly assigns meaning to the fill of a timeline cell via a legend
// declared in the workbook itself. Everywhere else in R13, formatting carries
// no meaning; here it does, and only because doc 03 § 3.2 says so.
//
// THE LEGEND IS RESOLVED FROM THE WORKBOOK, NEVER HARDCODED. The three legend
// colours are read from the cells the workbook labels `Aporte`, `Dividendo`,
// `Distribución`. A build-time colour table would silently misclassify the day
// the administrator recolours the legend.
//
// TWO TRAPS:
//
//   1. THEME INDEX. `clrScheme` is ordered `dk1, lt1, dk2, lt2, …` but the
//      `theme=` attribute indexes `0=lt1, 1=dk1, 2=lt2, 3=dk2, …`. So
//      `theme="3"` is dk2 (#1F497D), NOT lt2. Inverting this makes every
//      `Distribución` resolve to a near-white and misclassify. The remap lives
//      in `parseThemeColours` (readXlsx.ts) so it is applied exactly once.
//
//   2. NAVY vs MEDIUM BLUE. `Aporte` (#002060) and tinted `Distribución`
//      (#1F497D @ 0.4) are only ~7° apart in HUE — despite doc 03 § 3.4's
//      rationale claiming "20°+". The hue gate alone therefore CANNOT separate
//      them. What separates them is the second half of the same rule: nearest
//      by ΔE, which is dominated by lightness here. Both are implemented, and a
//      genuine ΔE tie yields `ambiguous`, never a guess.

import type { FillSpec } from '../xlsx/readXlsx.ts'

/** Doc 03 § 3.4: candidate legend colours must be within this hue distance. */
export const HUE_TOLERANCE_DEGREES = 12

/**
 * Two candidates whose ΔE differ by less than this are a genuine tie.
 *
 * Deliberately small: the navy/medium-blue pair differs by ~40 ΔE units, so a
 * tie means the fill really is equidistant and a guess would be arbitrary.
 */
export const DELTA_E_TIE_THRESHOLD = 2

export type EventType = 'aporte' | 'dividendo' | 'distribucion' | 'unclassified' | 'not_an_event'

export type ClassificationMethod = 'legend_exact' | 'legend_family' | 'administrator'

export interface Rgb { r: number; g: number; b: number }

/** `#1F497D` / `FF1F497D` / `1F497D` → rgb. ARGB's alpha is dropped. */
export function hexToRgb(hex: string): Rgb | null {
  const h = hex.replace('#', '').trim()
  const six = h.length === 8 ? h.slice(2) : h
  if (!/^[0-9a-fA-F]{6}$/.test(six)) return null
  return {
    r: parseInt(six.slice(0, 2), 16),
    g: parseInt(six.slice(2, 4), 16),
    b: parseInt(six.slice(4, 6), 16),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase()
  return `#${c(r)}${c(g)}${c(b)}`
}

export interface Hsl { h: number; s: number; l: number }

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0))
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h * 60, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hk = ((h % 360) + 360) % 360 / 360
  const t = [hk + 1 / 3, hk, hk - 1 / 3].map((x) => (x < 0 ? x + 1 : x > 1 ? x - 1 : x))
  const conv = (tc: number) =>
    tc < 1 / 6 ? p + (q - p) * 6 * tc
      : tc < 1 / 2 ? q
        : tc < 2 / 3 ? p + (q - p) * (2 / 3 - tc) * 6
          : p
  return { r: conv(t[0]) * 255, g: conv(t[1]) * 255, b: conv(t[2]) * 255 }
}

/**
 * Applies an OOXML tint to a colour (ECMA-376 §18.8.19).
 *
 * A NEGATIVE tint darkens (`L' = L × (1 + tint)`); a POSITIVE tint lightens
 * toward white (`L' = L × (1 − tint) + tint`). Hue and saturation are
 * unchanged — which is exactly why the hue gate alone cannot separate a colour
 * from a tinted version of a neighbouring hue.
 */
export function applyTint(hex: string, tint: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb || !Number.isFinite(tint) || tint === 0) return hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`
  const hsl = rgbToHsl(rgb)
  const l = tint < 0 ? hsl.l * (1 + tint) : hsl.l * (1 - tint) + tint
  return rgbToHex(hslToRgb({ ...hsl, l: Math.max(0, Math.min(1, l)) }))
}

/**
 * The 56-entry legacy indexed palette (ECMA-376 §18.8.27), abbreviated to the
 * entries a real workbook uses. An index outside this table resolves to null —
 * unresolved, never guessed.
 */
const INDEXED_PALETTE: Record<number, string> = {
  0: '#000000', 1: '#FFFFFF', 2: '#FF0000', 3: '#00FF00', 4: '#0000FF',
  5: '#FFFF00', 6: '#FF00FF', 7: '#00FFFF', 8: '#000000', 9: '#FFFFFF',
  10: '#FF0000', 11: '#00FF00', 12: '#0000FF', 13: '#FFFF00', 14: '#FF00FF',
  15: '#00FFFF', 64: '#000000', 65: '#FFFFFF',
}

export interface ResolvedFill {
  /** Resolved sRGB, or null when the fill cannot be resolved. */
  hex: string | null
  /** True when the cell carries no fill at all. */
  unfilled: boolean
  /** The raw representation, preserved verbatim for provenance. */
  raw: string | null
}

/**
 * Resolves a stored fill to sRGB.
 *
 * `themeColours` must already be in `theme=` index order — see trap 1.
 * An unresolvable theme index or palette index yields `hex: null` rather than a
 * fallback colour, so the caller can treat it as UNKNOWN instead of silently
 * classifying it as something.
 */
export function resolveFill(fill: FillSpec | null, themeColours: string[]): ResolvedFill {
  if (!fill || (fill.rgb === null && fill.theme === null && fill.indexed === null)) {
    return { hex: null, unfilled: true, raw: null }
  }

  if (fill.rgb) {
    const rgb = hexToRgb(fill.rgb)
    const base = rgb ? rgbToHex(rgb) : null
    const raw = `rgb:${fill.rgb.toUpperCase()}`
    if (!base) return { hex: null, unfilled: false, raw }
    return { hex: fill.tint ? applyTint(base, fill.tint) : base, unfilled: false, raw }
  }

  if (fill.theme !== null) {
    const raw = `theme:${fill.theme}${fill.tint ? `@${fill.tint}` : ''}`
    const base = themeColours[fill.theme]
    if (!base) return { hex: null, unfilled: false, raw }
    return { hex: fill.tint ? applyTint(base, fill.tint) : base, unfilled: false, raw }
  }

  const raw = `indexed:${fill.indexed}`
  const base = fill.indexed === null ? undefined : INDEXED_PALETTE[fill.indexed]
  if (!base) return { hex: null, unfilled: false, raw }
  return { hex: fill.tint ? applyTint(base, fill.tint) : base, unfilled: false, raw }
}

// ---------------------------------------------------------------------------
// Legend matching
// ---------------------------------------------------------------------------

export interface LegendEntry { event: EventType; hex: string; raw: string | null }

/** Euclidean distance in RGB — sufficient here, and monotone with perceived difference for these widely-separated colours. */
export function deltaE(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export interface FillClassification {
  event: EventType
  method: ClassificationMethod | null
  matchedHex: string | null
  ambiguous: boolean
}

/**
 * Classifies a resolved fill against the workbook's own legend.
 *
 * Order is EXACT → FAMILY → unclassified (doc 03 § 3.4):
 *   - exact sRGB equality is decisive and cheap, and covers every cell in the
 *     verified sample;
 *   - otherwise a candidate must be within the hue gate AND be the nearest by
 *     ΔE. Both halves are required — see trap 2, where the hue gate alone
 *     admits both navy and medium blue;
 *   - a genuine ΔE tie is `ambiguous`, requiring administrator classification
 *     rather than a coin flip.
 */
export function classifyFill(resolved: ResolvedFill, legend: LegendEntry[]): FillClassification {
  if (resolved.unfilled || resolved.hex === null) {
    return { event: 'unclassified', method: null, matchedHex: null, ambiguous: false }
  }

  const exact = legend.find((l) => l.hex.toUpperCase() === resolved.hex!.toUpperCase())
  if (exact) {
    return { event: exact.event, method: 'legend_exact', matchedHex: exact.hex, ambiguous: false }
  }

  const target = hexToRgb(resolved.hex)
  if (!target) return { event: 'unclassified', method: null, matchedHex: null, ambiguous: false }
  const targetHsl = rgbToHsl(target)

  const candidates = legend
    .map((l) => {
      const rgb = hexToRgb(l.hex)
      if (!rgb) return null
      return { entry: l, hue: hueDistance(rgbToHsl(rgb).h, targetHsl.h), de: deltaE(rgb, target) }
    })
    .filter((c): c is { entry: LegendEntry; hue: number; de: number } => c !== null)
    .filter((c) => c.hue <= HUE_TOLERANCE_DEGREES)

  if (candidates.length === 0) {
    return { event: 'unclassified', method: null, matchedHex: null, ambiguous: false }
  }

  candidates.sort((a, b) => a.de - b.de)
  const best = candidates[0]
  const runnerUp = candidates[1]
  if (runnerUp && Math.abs(runnerUp.de - best.de) < DELTA_E_TIE_THRESHOLD) {
    return { event: 'unclassified', method: null, matchedHex: null, ambiguous: true }
  }

  return { event: best.entry.event, method: 'legend_family', matchedHex: best.entry.hex, ambiguous: false }
}
