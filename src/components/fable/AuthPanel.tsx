import type { CSSProperties, ReactNode } from 'react'

/**
 * AuthPanel — the Tier-1 glass authentication panel (spec §0 "panel anatomy"),
 * used by `/login` in R1 and by the R2 auth variants. Presentational only:
 * the caller supplies every string from i18n and composes the form below the
 * title. Anatomy, top → bottom: specular sheen · top hairline · eyebrow ·
 * title · {children}.
 *
 * Colors are the theme-independent `--nv-auth-*` tokens; the surface itself is
 * the `.nv-glass-auth` material tier (opaque fallback + blur under @supports,
 * flattened for print — all declared once in globals.css).
 *
 * PERFORMANCE (R1 repair). This component holds NO state and registers NO
 * pointer handler, so nothing here can re-render the form the user is typing
 * into. The specular highlight originally followed the cursor, which meant a
 * React state update per pointer event plus a repaint of a large radial
 * gradient layered over a backdrop-filtered surface. It is now a fixed sheen —
 * the glass still reads as glass, at zero runtime cost. Do not reintroduce
 * pointer tracking, a `will-change`, or an animated filter/shadow here: the
 * panel's entrance is a plain opacity fade owned by its parent.
 */
interface AuthPanelProps {
  /** Uppercase eyebrow above the title (rendered via `ui-label`). */
  eyebrow: string
  /** Panel heading — an `<h2>` (the page's `<h1>` is the gateway headline). */
  title: string
  children: ReactNode
  className?: string
  style?: CSSProperties
}

export function AuthPanel({ eyebrow, title, children, className = '', style }: AuthPanelProps) {
  return (
    <section
      aria-label={title}
      className={`nv-glass-auth relative overflow-hidden ${className}`}
      style={style}
    >
      {/* Static specular sheen */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'var(--nv-auth-specular)' }}
      />
      {/* Top hairline highlight */}
      <div
        aria-hidden="true"
        className="absolute top-0 h-px pointer-events-none"
        style={{ left: '8%', right: '8%', background: 'var(--nv-auth-hairline)' }}
      />

      <div className="relative" style={{ padding: 'clamp(22px, 2.4vw, 32px)' }}>
        <div className="ui-label" style={{ color: 'var(--nv-auth-eyebrow)' }}>{eyebrow}</div>
        <h2
          className="mt-2"
          style={{
            fontSize: 'var(--fs-chart-headline)',
            fontWeight: 'var(--fw-value)' as CSSProperties['fontWeight'],
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--nv-auth-ink)',
          }}
        >
          {title}
        </h2>
        {children}
      </div>
    </section>
  )
}
