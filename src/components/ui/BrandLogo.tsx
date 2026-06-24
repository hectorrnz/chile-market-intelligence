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
 * Files (PNG with transparent background) go in /public:
 *   - /nevada-logo-light.png  → shown in LIGHT mode
 *   - /nevada-logo-dark.png   → shown in DARK mode
 *
 * Each image starts hidden and only reveals once it has loaded successfully.
 * That means a missing file shows NOTHING (no broken-image glyph, no alt text) —
 * the logo simply appears the moment the file is added to /public.
 */
export function BrandLogo({ className = '', alt = 'Nevada Inversiones' }: { className?: string; alt?: string }) {
  const [lightOk, setLightOk] = useState(false)
  const [darkOk, setDarkOk] = useState(false)

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/nevada-logo-light.png"
        alt={alt}
        onLoad={() => setLightOk(true)}
        className={`${lightOk ? 'block dark:hidden' : 'hidden'} ${className}`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/nevada-logo-dark.png"
        alt={alt}
        onLoad={() => setDarkOk(true)}
        className={`${darkOk ? 'hidden dark:block' : 'hidden'} ${className}`}
      />
    </>
  )
}
