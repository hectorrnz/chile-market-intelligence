'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { NevadaMark } from '@/components/ui/NevadaMark'
import { LangToggle } from '@/components/ui/LangToggle'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { ChipLabel } from './Chip'

/**
 * AuthShell — the full-bleed Fable "Private Access" gateway (spec §0),
 * rendered by `src/app/(auth)/layout.tsx` for every auth route. Purely
 * presentational: no fetching, no auth calls, no route strings.
 *
 * Layer stack, bottom → top:
 *   1. Santiago photograph (STATIC — see the performance note below)
 *   2. diagonal light-wash veil   (headline legibility)
 *   3. bottom navy-vignette veil  (notice legibility)
 *   4. content column — top utility row · centered middle slot ({children}) ·
 *      bottom confidentiality notice
 *
 * PERFORMANCE (R1 repair). The gateway is visually still once it has entered:
 * no Ken-Burns drift, no ambient pulse, no pointer-driven repaint. Five
 * backdrop-filter surfaces sit above the photograph (this shell's four utility
 * chips plus the AuthPanel), and a blurred surface can only keep its cached
 * result while the pixels behind it hold still — any continuous background
 * motion would force all five blurs to be recomputed every frame, forever.
 * The entrance itself uses `.nv-auth-reveal` / `.nv-auth-fade` — opacity and
 * transform only, but at exactly `.nv-reveal`'s timing (640ms `--dur-reveal`,
 * `--ease-primary`, 22px rise, `--stagger-reveal` tiers) so the gateway settles
 * at the same pace as Markets, Macro and every other page.
 *
 * Theme-independent by design (spec §Theming: "Login is theme-independent"):
 * every color here is an `--nv-auth-*` token defined once in `:root` and never
 * overridden under `.dark`, so the gateway reads identically in both themes
 * while ThemeToggle still switches the app behind it.
 *
 * The utility cluster reuses the EXISTING LangToggle / ThemeToggle untouched:
 * the wrapper rescopes the theme-varying chip tokens they consume to the
 * fixed white-glass login values (custom-property inheritance — no duplicate
 * toggle components, no edits to the originals).
 */

const CHIP_REMAP = {
  '--nv-chip': 'var(--nv-chip-fill)',
  '--nv-chipbd': 'var(--nv-chip-bd)',
  '--surface': 'var(--nv-auth-chip-active)',
  '--foreground': 'var(--nv-auth-chip-ink)',
  '--muted-fg': 'var(--nv-auth-chip-muted)',
  '--hover': 'var(--nv-auth-chip-hover)',
} as CSSProperties

/** Santiago wall clock (Fable utility chip) — minute resolution, local to the
 *  gateway. Rendered inside `suppressHydrationWarning` because the server
 *  snapshot can differ from the client's by a minute tick. */
function useSantiagoTime(): string {
  const [time, setTime] = useState(() => formatSantiago())
  useEffect(() => {
    const id = setInterval(() => setTime(formatSantiago()), 30_000)
    return () => clearInterval(id)
  }, [])
  return time
}

function formatSantiago(): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Santiago',
    }).format(new Date())
  } catch {
    return ''
  }
}

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useLang()
  const time = useSantiagoTime()

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: 'var(--nv-auth-bg)' }}>
      {/* 1 · Santiago photograph — full-bleed and static. object-position
          58% 30% keeps Gran Torre Santiago / Sky Costanera and the Andes
          composed against the panel (doc 02 — do not re-crop). Decorative:
          alt="". `decoding="async"` keeps the 1400×800 decode off the critical
          path so it cannot stall the entrance; `fetchPriority="high"` still
          starts the download immediately. The oversize the drift used to need
          is gone, so the rasterized area is exactly the viewport. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/login-santiago.webp"
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchPriority="high"
        className="absolute inset-0 w-full h-full"
        style={{ objectFit: 'cover', objectPosition: '58% 30%' }}
      />
      {/* 2 · diagonal light wash — text legibility over the sky */}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: 'var(--nv-auth-veil-wash)' }} />
      {/* 3 · bottom navy vignette — notice legibility */}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: 'var(--nv-auth-veil-vignette)' }} />

      {/* 4 · content column */}
      <div
        className="relative z-[1] min-h-screen flex flex-col"
        style={{ padding: 'clamp(18px, 3.2vw, 46px) clamp(18px, 3.6vw, 54px)' }}
      >
        {/* Top row — full lockup left, white-glass utility chips right */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div className="nv-auth-reveal">
            <NevadaMark variant="lockup" className="w-[clamp(98px,9vw,132px)]" />
          </div>
          {/* Fade only, never translate: every chip in this cluster carries a
              backdrop-filter, and moving a blurred surface re-samples its
              backdrop on every frame of the animation. */}
          <div
            className="flex items-center gap-2 flex-wrap nv-auth-fade"
            style={CHIP_REMAP}
          >
            <ChipLabel className="nv-auth-chip-glass font-semibold text-foreground">
              {/* Static dot — the ambient pulse loop was removed in the R1
                  performance repair; the gateway is visually still once it has
                  entered. Meaning never rested on the motion (the chip's own
                  label carries it). */}
              <span
                aria-hidden="true"
                className="w-[7px] h-[7px] rounded-full"
                style={{ background: 'var(--nv-auth-secure)' }}
              />
              {t.auth.secureConnection}
            </ChipLabel>
            <span className="nv-auth-chip-glass rounded-full inline-flex">
              <LangToggle />
            </span>
            <ChipLabel className="nv-auth-chip-glass font-semibold text-foreground">
              <span suppressHydrationWarning>
                {t.auth.santiago} {time}
              </span>
            </ChipLabel>
            <span className="nv-auth-chip-glass rounded-full inline-flex">
              <ThemeToggle />
            </span>
          </div>
        </header>

        {/* Middle — the route's own content (headline block, glass panel).
            Fable's wrapping row: side-by-side at desktop, a natural vertical
            stack once the panel's min-width no longer fits beside the copy. */}
        <div
          className="flex-1 flex items-center justify-between flex-wrap"
          style={{ gap: 'clamp(28px, 5vw, 72px)', padding: '34px 0' }}
        >
          {children}
        </div>

        {/* Bottom — confidentiality notice */}
        {/* Last stagger tier — the notice is the lowest element in the §0
            hierarchy, matching how app pages cascade their lower sections. */}
        <footer
          className="flex items-center justify-between gap-3.5 flex-wrap nv-auth-reveal"
          style={{ '--nv-auth-delay': 'calc(var(--stagger-reveal) * 2)' } as CSSProperties}
        >
          <p
            className="text-xs"
            style={{ color: 'var(--nv-auth-onphoto)', textShadow: 'var(--nv-auth-onphoto-shadow)', fontWeight: 550 }}
          >
            {t.auth.confidentialityNotice}
          </p>
        </footer>
      </div>
    </div>
  )
}
