// R13.R2 owner review §§ 11-14 — perceptual validation of the chart palettes.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import.
//
// WHY THIS EXISTS. The owner's requirement is explicit: a palette is not
// acceptable merely because every colour in it is individually approved — two
// colours shown AT THE SAME TIME must be distinguishable BEFORE the reader
// interacts with the chart. "Looks fine to me" is not a way to establish that,
// so this module makes it measurable and the test suite makes it enforced.
//
// THE METRIC IS OKLab ΔE. Distance in sRGB is not perceptual — #004A64 and
// #0F6E6E are far apart in hex and nearly the same colour to the eye. OKLab is
// a perceptually-uniform space, so a Euclidean distance in it approximates
// "how different do these look". A second, independent check is the WCAG
// relative-luminance contrast against the surface the mark is drawn on: a
// colour can be perfectly distinct from its neighbours and still be invisible
// on the card (three of the R13.7 tokens were, at 1.45–1.54:1 on the light
// card).
//
// BOTH THEMES, ALWAYS. Every token carries a light AND a dark value, and a
// slot's separation is only as good as its WORSE theme — so `slotDistance`
// takes the minimum of the two. A palette that separates cleanly in dark and
// collapses in light is a failing palette, not a passing one.
//
// CYCLIC ADJACENCY. In a donut the last slice touches the first, so adjacency
// is evaluated round the ring, not along a list.

export interface ThemedColor {
  /** Light-theme hex, `#RRGGBB`. */
  light: string
  /** Dark-theme hex, `#RRGGBB`. */
  dark: string
}

const HEX = /^#[0-9A-Fa-f]{6}$/

function channels(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new Error(`not a #RRGGBB colour: ${hex}`)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
}

/** sRGB companding — the gamma curve, not a plain divide. */
function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Björn Ottosson's OKLab. Returns `[L, a, b]`. */
export function oklab(hex: string): [number, number, number] {
  const [R, G, B] = channels(hex).map(linearize)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Perceptual distance between two colours. ~0.02 is a just-noticeable step. */
export function deltaE(a: string, b: string): number {
  const x = oklab(a)
  const y = oklab(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/** Hue angle in degrees (0–360). Meaningless for a neutral, hence `chroma`. */
export function hueAngle(hex: string): number {
  const [, a, b] = oklab(hex)
  return (Math.atan2(b, a) * (180 / Math.PI) + 360) % 360
}

/** Smallest angle between two hues, 0–180. */
export function hueSeparation(a: string, b: string): number {
  return Math.abs(((hueAngle(a) - hueAngle(b)) + 540) % 360 - 180)
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const [R, G, B] = channels(hex).map(linearize)
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

/** WCAG contrast ratio, 1–21. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * A slot's separation from another slot is its WORSE theme — a palette is only
 * as distinguishable as the theme in which it collapses.
 */
export function slotDistance(a: ThemedColor, b: ThemedColor): number {
  return Math.min(deltaE(a.light, b.light), deltaE(a.dark, b.dark))
}

export interface PaletteAudit {
  /** Worst separation between ANY two slots (they meet in the legend). */
  minAllPairs: number
  /** Worst separation between slots that TOUCH, round the ring. */
  minAdjacent: number
  /** Worst contrast of any slot against its own theme's surface. */
  minContrastLight: number
  minContrastDark: number
  /** The offending pair for each floor, for a legible assertion message. */
  worstPair: [number, number]
  worstAdjacentPair: [number, number]
}

/**
 * Measures a complete palette. `surfaces` are the backgrounds the marks are
 * actually drawn on — the CARD surface, not the page background, because that
 * is where the donut and the chart live.
 */
export function auditPalette(
  slots: readonly ThemedColor[],
  surfaces: { light: string; dark: string },
): PaletteAudit {
  if (slots.length < 2) throw new Error('a palette needs at least two slots to audit')
  let minAllPairs = Infinity
  let worstPair: [number, number] = [0, 1]
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const d = slotDistance(slots[i], slots[j])
      if (d < minAllPairs) {
        minAllPairs = d
        worstPair = [i, j]
      }
    }
  }
  let minAdjacent = Infinity
  let worstAdjacentPair: [number, number] = [0, 1]
  for (let i = 0; i < slots.length; i++) {
    // Cyclic: the ring closes, so the last slot touches the first.
    const j = (i + 1) % slots.length
    const d = slotDistance(slots[i], slots[j])
    if (d < minAdjacent) {
      minAdjacent = d
      worstAdjacentPair = [i, j]
    }
  }
  return {
    minAllPairs,
    minAdjacent,
    minContrastLight: Math.min(...slots.map((s) => contrastRatio(s.light, surfaces.light))),
    minContrastDark: Math.min(...slots.map((s) => contrastRatio(s.dark, surfaces.dark))),
    worstPair,
    worstAdjacentPair,
  }
}

/**
 * The enforced floors, measured against the approved institutional palette and
 * set just under what it actually achieves — so a future edit that degrades
 * separation fails the suite, while today's validated palettes pass.
 *
 * These are NOT aspirational numbers. `MIN_ALL_PAIRS` is deliberately lower
 * than `MIN_ADJACENT`: the approved Goldman-derived palette is narrow by
 * design (cool-dominant, with red/green/amber reserved as signal tokens), and
 * it does not contain twelve mutually strongly-separated hues. Rather than
 * invent new hue families to hit a rounder number, the palettes maximise the
 * separation that matters most — slices that TOUCH, and the two series shown
 * together — and the measured all-pairs floor is recorded honestly here.
 */
export const MIN_ADJACENT = 0.13
export const MIN_ALL_PAIRS = 0.055
/** A filled slice / legend chip must be visible on its own card. */
export const MIN_SLICE_CONTRAST = 1.6
/** A 1.75px line needs real contrast, not merely visibility. */
export const MIN_SERIES_CONTRAST = 2.8
/** Two series drawn together must be separated far beyond adjacency. */
export const MIN_SERIES_DELTA_E = 0.2
export const MIN_SERIES_HUE_SEPARATION = 60

/** The card surfaces the Family Portfolio charts are drawn on. */
export const CARD_SURFACES = { light: '#FCFDFE', dark: '#151E25' } as const
