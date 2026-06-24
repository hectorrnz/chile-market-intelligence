'use client'

import { useState } from 'react'

/**
 * Theme-aware brand logo.
 *
 * Renders BOTH the light- and dark-mode images and lets CSS show exactly one,
 * keyed off the `.dark` class on <html>. Because that class is applied before
 * paint (the inline script in layout.tsx), the swap on theme toggle is instant
 * with no flash — no JS state, no hydration flicker.
 *
 * Files go in /public (paths must match the actual filenames there):
 *   - /nevada-logo-light.jpg  → shown in LIGHT mode (navy logo on the white top bar)
 *   - /nevada-logo-dark.png   → shown in DARK mode (white/transparent logo on the dark top bar)
 *
 * Each image renders by default (so a cached image shows instantly) and removes
 * itself only if it fails to load (onError) — so a missing file degrades to
 * nothing instead of a broken-image glyph, while present files always show.
 */
export function BrandLogo({ className = '', alt = 'Nevada Inversiones' }: { className?: string; alt?: string }) {
  const [lightErr, setLightErr] = useState(false)
  const [darkErr, setDarkErr] = useState(false)

  return (
    <>
      {!lightErr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/nevada-logo-light.jpg"
          alt={alt}
          onError={() => setLightErr(true)}
          className={`brand-logo-light ${className}`}
        />
      )}
      {!darkErr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/nevada-logo-dark.png"
          alt={alt}
          onError={() => setDarkErr(true)}
          className={`brand-logo-dark ${className}`}
        />
      )}
    </>
  )
}
