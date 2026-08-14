'use client'

// Owner design review § 7 — the ONE shared presentation-settings trigger for
// the Family Portfolio Summary: a conventional cog (hub, ring, and teeth
// growing out of the ring), used identically on Asset Allocation and
// Portfolio Evolution so the affordance is recognizable at a glance and
// visually consistent across both modules. The teeth TOUCH the ring — that is
// what separates a gear from the abstract sun/asterisk glyph it replaces.
//
// The caller decides WHETHER it exists: a non-administrator gets no button at
// all (never a disabled ghost — an affordance that can never work is a lie);
// the established `readOnlyNote` pattern explains the absence instead. This
// component therefore takes an unconditional `onClick` plus an accessible
// `label` (a dictionary string — never hardcoded here) and renders nothing
// else: no state, no permission logic, no persistence.
//
// Keyboard operability and the visible focus ring come from the native
// <button> and the app's global :focus-visible treatment; `nv-transition`
// keeps the hover tint on the approved motion tokens, which collapse under
// prefers-reduced-motion globally.

export interface SettingsGearButtonProps {
  onClick: () => void
  /** Accessible name AND hover title — e.g. o.settingsOpen / o.settingsEvolution. */
  label: string
  className?: string
}

export function SettingsGearButton({ onClick, label, className = '' }: SettingsGearButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      className={`inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-full text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition ${className}`}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        className="w-4 h-4"
        aria-hidden="true"
      >
        {/* Ring + hub. */}
        <circle cx="10" cy="10" r="5.1" strokeWidth={1.5} />
        <circle cx="10" cy="10" r="1.9" strokeWidth={1.5} />
        {/* Eight teeth, radial from the ring (r 5.1) to r 7.4 — attached, not
            floating ticks. */}
        <path
          strokeWidth={2}
          strokeLinecap="round"
          d="M10 2.6v2.3M10 15.1v2.3M17.4 10h-2.3M4.9 10H2.6M15.23 4.77 13.6 6.4M6.4 13.6l-1.63 1.63M15.23 15.23 13.6 13.6M6.4 6.4 4.77 4.77"
        />
      </svg>
    </button>
  )
}
