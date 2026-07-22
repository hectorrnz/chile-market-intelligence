'use client'

import { useState } from 'react'

/**
 * NevadaMark — the authoritative Inversiones Nevada logo.
 *
 * Asset: `/public/nevada-logo.svg`, copied byte-identical from the approved
 * Fable export (`brand-assets/download1.svg`, 435×348) — the transparent
 * blue (#1E5591) + cyan (#23BAE8) peaks monogram with the "INVERSIONES NEVADA"
 * wordmark.
 *
 * Rules (docs/design_principles.md §16 — do not relax any of these):
 *   - Never redraw, regenerate, recolor, or distort the mark. This component
 *     only positions and scales the untouched file.
 *   - Never add a shadow, glow, outline, or other effect.
 *   - Never place it inside a *visible* rectangular container. The `symbol`
 *     crop window below is transparent and unstyled — it is a viewport, not a
 *     box.
 *   - The mark is transparent, so it needs no light/dark swap; it must simply
 *     be verified legible against whatever backdrop it is placed on. If a
 *     backdrop compromises it, change the backdrop, not the mark.
 *   - Graceful degradation: if the asset fails to load, nothing renders — never
 *     a broken-image glyph.
 *
 * Two variants, matching the approved lockup rules:
 *   - `lockup` (default) — the full mark. Used on the login screen.
 *   - `symbol`           — a square crop of the peaks symbol alone, reproducing
 *                          the Fable header treatment (a 30px window over the
 *                          asset rendered at 92px wide, offset -29px / -6px).
 *                          Header usage pairs this with "Inversiones Nevada"
 *                          set as UI text.
 *
 * NOTE: this component is the Phase-1 *foundation*. Existing page branding
 * (`BrandLogo`) is intentionally left in place; the shell and login adopt this
 * mark in their own phases.
 */

/** Fable's header crop geometry, expressed at its native 30px window size. */
const SYMBOL_WINDOW = 30
const SYMBOL_IMAGE_WIDTH = 92
const SYMBOL_OFFSET_X = -29
const SYMBOL_OFFSET_Y = -6

export type NevadaMarkVariant = 'lockup' | 'symbol'

interface NevadaMarkProps {
  /** `lockup` renders the full mark; `symbol` crops to the peaks monogram. */
  variant?: NevadaMarkVariant
  /**
   * `lockup`: rendered width in px (height follows the SVG's aspect ratio).
   * `symbol`: side length of the square crop window in px.
   */
  size?: number
  /** Accessible name. Omit/blank when the mark is decorative beside brand text. */
  alt?: string
  className?: string
}

export function NevadaMark({
  variant = 'lockup',
  size,
  alt = 'Inversiones Nevada',
  className = '',
}: NevadaMarkProps) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  const decorative = alt === ''

  if (variant === 'symbol') {
    const side = size ?? SYMBOL_WINDOW
    const scale = side / SYMBOL_WINDOW
    return (
      <span
        className={`inline-block relative overflow-hidden ${className}`}
        style={{ width: side, height: side }}
        aria-hidden={decorative ? true : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/nevada-logo.svg"
          alt={alt}
          onError={() => setFailed(true)}
          className="absolute"
          style={{
            width: SYMBOL_IMAGE_WIDTH * scale,
            height: 'auto',
            maxWidth: 'none',
            left: SYMBOL_OFFSET_X * scale,
            top: SYMBOL_OFFSET_Y * scale,
          }}
        />
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/nevada-logo.svg"
      alt={alt}
      onError={() => setFailed(true)}
      className={`block ${className}`}
      style={size ? { width: size, height: 'auto' } : { height: 'auto' }}
      aria-hidden={decorative ? true : undefined}
    />
  )
}
