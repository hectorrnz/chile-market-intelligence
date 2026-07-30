import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

/**
 * AuthForm — the narrowly-scoped primitives shared by the three public
 * authentication routes (/login, /forgot-password, /auth/reset-password).
 *
 * R1 established the gateway (AuthShell) and the Tier-1 glass panel
 * (AuthPanel). R2 converts the two recovery pages into variants of that same
 * panel, which would otherwise mean copying the login's field, notice, button
 * and back-link JSX twice. These primitives exist so all three routes render
 * from ONE implementation of each concern: change the focus treatment, the
 * spinner, or the notice colouring here and every auth route follows.
 *
 * Scope is deliberately limited to those four concerns plus the two layout
 * slots the shell's middle row expects (headline column, panel column). No
 * behaviour lives here: every page owns its own state, validation, endpoint
 * and error mapping, so a reader can still see a route's complete contract in
 * the route file. Nothing here fetches, imports Supabase, or knows a URL.
 *
 * All colour comes from the theme-independent `--nv-auth-*` tokens; the field
 * recipe is the existing `.nv-auth-input` class. Motion is the R1 entrance
 * pair only (`.nv-auth-reveal` for ordinary content, `.nv-auth-fade` for the
 * backdrop-filtered panel column — translating a blurred surface re-samples
 * its backdrop every frame). Both collapse under `prefers-reduced-motion` via
 * the global rule in globals.css.
 */

const LABEL_STYLE: CSSProperties = { fontSize: 12, fontWeight: 650, color: 'var(--nv-auth-ink-2)' }
const HINT_STYLE: CSSProperties = { color: 'var(--nv-auth-ink-3)' }

/** Muted supporting copy inside a panel (sub-titles, hints, the session line). */
export function AuthHint({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs ${className}`} style={HINT_STYLE}>{children}</p>
}

interface AuthFieldProps {
  id: string
  label: string
  type: 'text' | 'password' | 'email'
  value: string
  onChange: (value: string) => void
  autoComplete: string
  placeholder?: string
  required?: boolean
  autoFocus?: boolean
  autoCapitalize?: 'none'
  spellCheck?: boolean
  /** Muted line under the field (e.g. the password-length rule). */
  hint?: string
  /** Right-aligned slot on the label row (e.g. the "Forgot password?" link). */
  action?: ReactNode
  /** id of the visible error notice, so the field announces it. */
  describedBy?: string
}

/**
 * A labelled field on the auth glass. The label is always a real `<label>`
 * bound by `htmlFor` — placeholder text is never the only label.
 */
export function AuthField({
  id, label, type, value, onChange, autoComplete, placeholder,
  required = false, autoFocus = false, autoCapitalize, spellCheck,
  hint, action, describedBy,
}: AuthFieldProps) {
  return (
    <div className="space-y-1.5">
      {action ? (
        <div className="flex items-center justify-between gap-2.5">
          <label htmlFor={id} className="block" style={LABEL_STYLE}>{label}</label>
          {action}
        </div>
      ) : (
        <label htmlFor={id} className="block" style={LABEL_STYLE}>{label}</label>
      )}
      <input
        id={id}
        type={type}
        required={required}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        aria-describedby={describedBy}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="nv-auth-input"
      />
      {hint && <p className="text-xs" style={HINT_STYLE}>{hint}</p>}
    </div>
  )
}

/**
 * The panel's status banner. `error` is an assertive `role="alert"` (it
 * interrupts — the user's submission failed); `success` is a polite
 * `role="status"` (it confirms, and must not talk over a screen reader).
 * Never colour alone: each variant carries its own text and is announced.
 */
export function AuthNotice({
  variant, id, children,
}: { variant: 'error' | 'success'; id?: string; children: ReactNode }) {
  const error = variant === 'error'
  return (
    <div
      id={id}
      role={error ? 'alert' : 'status'}
      className="nv-pop mt-3.5 px-3 py-2.5 text-xs font-medium"
      style={{
        background: error ? 'var(--nv-auth-err-bg)' : 'var(--nv-auth-ok-bg)',
        border: `1px solid ${error ? 'var(--nv-auth-err-bd)' : 'var(--nv-auth-ok-bd)'}`,
        color: error ? 'var(--nv-auth-err-fg)' : 'var(--nv-auth-ok-fg)',
        borderRadius: 'var(--radius-menu)',
      }}
    >
      {children}
    </div>
  )
}

/**
 * The navy capsule primary action. The label renders unconditionally so the
 * button still says what it is doing when `.nv-spin` is frozen by reduced
 * motion, and the spinner is `aria-hidden` because `disabled` already conveys
 * the busy state.
 */
export function AuthSubmitButton({
  label, loading, disabled,
}: { label: string; loading: boolean; disabled: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-full flex items-center justify-center gap-2 nv-transition disabled:opacity-50"
      style={{
        padding: '12px 18px',
        background: 'var(--brand-navy)',
        color: 'var(--primary-fg)',
        fontSize: 14.5,
        fontWeight: 650,
        letterSpacing: '.01em',
        boxShadow: 'var(--nv-sh-button)',
      }}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="inline-block w-[15px] h-[15px] rounded-full border-2 nv-spin"
          style={{ borderColor: 'var(--nv-chip-bd)', borderTopColor: 'var(--primary-fg)' }}
        />
      )}
      {label}
    </button>
  )
}

/** Secondary navigation inside the panel (e.g. "Back to sign in"). */
export function AuthSecondaryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block w-full text-center text-xs hover:underline"
      style={{ color: 'var(--nv-auth-link)' }}
    >
      {label}
    </Link>
  )
}

// R2 repair — there is deliberately NO on-photo "back" link primitive here.
// The pre-Fable pages and R1's /login each rendered a "← Back to dashboard"
// link below the panel, pointing at `/`. On a signed-out gateway that is a
// private destination: following it only bounces the visitor through the
// middleware and straight back to /login with a `next` parameter. It was
// removed from all three public auth routes. Route-specific navigation stays
// INSIDE the panel, where it is meaningful ("Forgot password?" on /login,
// "Back to sign in" on both recovery routes) — see AuthSecondaryLink.
// Do not reintroduce a dashboard or other external link below the panel.

/**
 * The gateway's identity column — the shell's middle row's left slot, and the
 * page's `<h1>`. Identical on all three auth routes: the brand statement does
 * not change because the user is recovering a password, and rendering it
 * everywhere is what makes the three routes read as one gateway.
 *
 * Largest element in the §0 hierarchy, so it leads the reveal with no delay.
 */
export function AuthHeadline({
  eyebrow, line1, line2, lede, note,
}: { eyebrow: string; line1: string; line2: string; lede: string; note?: string }) {
  return (
    <div className="nv-auth-reveal" style={{ flex: '1.1 1 340px', maxWidth: 640 } as CSSProperties}>
      <div className="ui-label mb-4" style={{ color: 'var(--nv-auth-eyebrow)' }}>{eyebrow}</div>
      <h1
        className="m-0"
        style={{
          fontSize: 'var(--fs-login-headline)',
          lineHeight: 1.06,
          letterSpacing: 'var(--tracking-hero)',
          fontWeight: 650,
          color: 'var(--brand-navy)',
          textWrap: 'balance',
        }}
      >
        {line1}
        <br />
        {line2}
      </h1>
      <p
        style={{
          margin: '20px 0 0',
          fontSize: 'clamp(14.5px, 1.25vw, 16.5px)',
          lineHeight: 1.5,
          color: 'var(--nv-auth-ink-2)',
          maxWidth: '46ch',
          fontWeight: 550,
        }}
      >
        {lede}
      </p>
      {note && (
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--nv-auth-ink-3)', maxWidth: '54ch' }}>
          {note}
        </p>
      )}
    </div>
  )
}

/**
 * The shell's middle-row right slot. Fable's 402px collapse basis, never
 * narrower than min(100%, 330px), so it stacks under the headline on narrow
 * widths rather than forcing horizontal overflow. Fades rather than
 * translates (it wraps backdrop-filtered glass) and trails the headline by one
 * stagger step — the cadence app pages use between their sections.
 *
 * Height is intentionally unconstrained: each route's panel is as tall as its
 * own content, which is why the recovery panels are shorter than the login's.
 */
export function AuthPanelColumn({ children }: { children: ReactNode }) {
  return (
    <div
      className="nv-auth-fade"
      style={{ flex: '0 1 402px', minWidth: 'min(100%, 330px)', '--nv-auth-delay': 'var(--stagger-reveal)' } as CSSProperties}
    >
      {children}
    </div>
  )
}
