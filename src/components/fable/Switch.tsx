'use client'

/**
 * The Fable compact enterprise switch (Administration → NOTIFICATIONS rows).
 *
 * GEOMETRY — matched to the Fable reference, not reinterpreted:
 *   track  30 × 18px, 999px radius, 1px `--nv-chipbd` border
 *   thumb  13 × 13px, resting at top 1.5px / left 1.5px
 *   travel 12.5px, so the ON thumb sits at 14px — Fable's `left: 1.5px → 14px`
 *   motion `.nv-transition-state` (--dur-state 260ms, --ease-primary)
 *
 * The 1px border makes the padding box 28 × 16, so a 13px thumb inset 1.5px is
 * vertically centred and travels edge to edge. Position is animated with
 * `transform`, not `left`: it is the property the shared motion token already
 * covers, it cannot reflow, and it collapses to .01ms under the global
 * `prefers-reduced-motion` rule with no per-component escape hatch.
 *
 * PRESENTATION ONLY. The caller owns the value and every side effect; this
 * component just reports the next boolean. It has no state, no persistence, no
 * network, no dialog, no feedback, and no idea which preference it represents —
 * so the same primitive serves recipient activation and any other genuinely
 * wired boolean without knowing anything about either.
 *
 * ACCESSIBILITY: a real `<button type="button">` with `role="switch"` and
 * `aria-checked`, so Enter and Space activate through native semantics (no
 * custom key handler, no double activation) and `disabled` blocks activation at
 * the platform level. State is exposed semantically, never by colour alone, and
 * the thumb position is a second non-colour cue. The accessible name is a
 * REQUIRED prop — a bare track has no text to name it.
 *
 * TOKENS ONLY: `bg-muted` (off) / `bg-accent-2` (on — the registered semantic
 * alias of `--nv-acc2`, which IS Fable's switch fill and resolves to its
 * lighter dark-theme counterpart automatically) / `bg-surface` (thumb). All
 * three invert together, so thumb-against-track contrast holds in both themes.
 * Focus comes from the global `:focus-visible` ring.
 */

export interface SwitchProps {
  /** Controlled value. */
  checked: boolean
  /** Receives the NEXT value (`!checked`). The caller owns persistence and feedback. */
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** REQUIRED — the track carries no text, so the caller must supply the name. */
  'aria-label': string
  /** Optional, for `aria-labelledby`/`<label htmlFor>` association by the caller. */
  id?: string
  className?: string
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  'aria-label': ariaLabel,
  id,
  className = '',
}: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={[
        // The button IS the 30×18 track, so the global focus ring hugs the
        // control instead of a padded wrapper.
        'relative inline-flex shrink-0 align-middle w-[30px] h-[18px] rounded-full',
        'border border-[var(--nv-chipbd)] nv-transition-state',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        // Hit area only: a transparent pseudo-element extends the target to
        // 56 × 44px for touch WITHOUT changing the visible control or the
        // surrounding layout (a padded box + negative margin would move the
        // focus ring off the track).
        "before:absolute before:content-[''] before:-inset-[13px] before:rounded-full",
        checked ? 'bg-accent-2' : 'bg-muted',
        className,
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'absolute top-[1.5px] left-[1.5px] w-[13px] h-[13px] rounded-full bg-surface nv-transition-state',
          checked ? 'translate-x-[12.5px]' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}
