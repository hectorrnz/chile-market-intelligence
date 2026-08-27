'use client'

// R13.R4A — the shared Alternatives filter bar.
//
// Extracted from the pre-R4A single page so the Holdings and Cash Flows views
// drive the SAME filter state through the SAME controls. Two hand-rolled filter
// bars would be two chances to diverge on which dimensions exist, how "all" is
// spelled, or which value is currently active.
//
// R13.R4A.5 — EVERY DIMENSION IS NOW MULTI-SELECT, and the control changed
// shape to say so. A native `<select multiple>` was the cheap route and is
// rejected on its merits: it renders as a scrolling list box that is always
// open (so it cannot be compact), it selects by ctrl/cmd-click — a gesture that
// does not exist on touch, and that silently REPLACES the whole selection when
// a user forgets the modifier — and its closed state cannot summarise. So the
// control is a popover checklist over REAL `<input type="checkbox">` elements:
// Tab reaches every option, Space toggles it, a screen reader announces its
// checked state, and every target is a full-width `<label>` — all of it the
// platform's, none of it re-implemented. What IS implemented here is only what
// a popover owes: `aria-expanded`/`aria-haspopup` on the trigger, Escape to
// close, an outside pointer to close, focus leaving the control to close, and
// focus returned to the trigger whenever the user dismissed it deliberately.
//
// The pre-R4A.5 single-value `AlternativesSelect` (a `ChipSelect` over a native
// `<select>`) is gone; `AlternativesMultiSelect` replaces it at every call
// site, the Dashboard's per-card year selector included, so this module still
// has exactly ONE narrowing control.
//
// MATERIAL IS THE APP'S, NOT THIS FILE'S. The trigger is `ChipButton` (the
// shared pill recipe) and the panel is `GlassSurface variant="overlay"` — the
// documented material tier for a menu. No blur, fill, shadow or radius value
// is written here; those are tokens, and a popover is exactly the surface the
// overlay tier exists for.
//
// NO YEAR CONTROL IN THIS BAR (R13.R4A.4). Cash Flows — the only view that ever
// carried one — always reads the FULL recorded history: its subtotal tiles, its
// by-year chart and its ledger are three grains of one selection, and a year
// narrowing on top of a chart whose whole job is to show the years turned the
// block into a single column of itself. Per-year detail is still one click
// away, in the chart column's own drill-down. The Dashboard's per-card year
// selectors are a DIFFERENT control on different (local, per-currency) state
// and are untouched by that removal.
//
// PRESENTATION ONLY. The options come from `filterOptions` in the pure module,
// the "empty set means all" contract and the toggle arithmetic come from
// `toggleSelection` there, and applying the filter is
// `applyHoldingFilter`/`applyEventFilter` — this component only reads and
// writes the selection.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { ChipButton } from '@/components/fable/Chip'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { eventTypeLabel } from '@/components/familyPortfolio/AlternativesEventChrome'
import {
  currencyLabel,
  toggleSelection,
  type AlternativesFilter,
  type FilterOptions,
} from '@/lib/familyPortfolio/alternativesView'
import { clampPopoverLeft } from '@/lib/familyPortfolio/alternatives/popoverPosition'

// ── Panel row dress (R13.R4A.5 visual pass) ─────────────────────────────────
// One dress for every row in the panel — the "All" button and the option
// labels alike — so the two kinds of row differ in semantics only. A selected
// row is carried by fill AND weight (the tick adds a shape on top), matching
// the shared ChipButton contract: never state by colour alone. Hover is the
// app's own row-hover tint (`nv-row-hover` → var(--hover), a translucent tint
// that composites visibly on the overlay fill in BOTH themes, where a solid
// surface-2 fill sits within a shade of the dark overlay) rather than a
// text-colour nudge — a full-width row is a full-width target and must read
// as one. Cell radius: these are compact controls, and compact controls never
// take the large glass radii (design_principles §9).
const ROW_BASE =
  'w-full flex items-center gap-2 rounded-[var(--radius-cell)] px-2.5 py-1.5 text-left nv-transition'
const ROW_ON = 'bg-[var(--selected)] text-foreground font-medium'
const ROW_OFF = 'text-muted-fg nv-row-hover hover:text-foreground'
// The hidden checkbox owns keyboard focus, so its ROW repaints the global
// focus ring (2px var(--focus), offset 2 — the same ring every visible
// control gets); without this the ring lands on the clipped sr-only box and a
// keyboard user sees nothing. `:has(:focus-visible)` rather than
// `focus-within`, so the ring appears for keyboard focus only — exactly the
// contract of the global rule it mirrors.
const ROW_FOCUS =
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]'

/**
 * The trigger's caret — ChipSelect's own inline chevron glyph, stroke and
 * size, so the bar's popover triggers and the app's pill selects speak one
 * visual language. Flipped while open: a non-colour open cue beside
 * `aria-expanded`. The flip is a state swap, not an animation, so there is no
 * motion to reduce.
 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={`w-3 h-3 shrink-0 ${open ? 'rotate-180' : ''}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  )
}

/**
 * One labelled multi-select narrowing control.
 *
 * EXPORTED because the Dashboard's per-card year selector is the same control
 * in a different scope: it drives that card's own local period set rather than
 * the shared filter, but it must read and behave identically — one dress, one
 * "all" convention, one summary rule, one label association. Two hand-rolled
 * controls would be two chances to diverge.
 *
 * `selectedLabel` carries its own `{n}` because Spanish agrees the participle
 * with the noun the option stands for — `2 seleccionadas` for sociedades,
 * `2 seleccionados` for event types — exactly as `allLabel` already carries
 * `Todas` or `Todos`. One shared string would save a line and print a
 * grammatical error in half the bar.
 */
export function AlternativesMultiSelect({
  label,
  allLabel,
  selectedLabel,
  options,
  value,
  onChange,
  renderOption,
}: {
  label: string
  allLabel: string
  /** Summary template for 2+ selections; `{n}` is the count. */
  selectedLabel: string
  options: readonly string[]
  value: readonly string[]
  onChange: (next: string[]) => void
  renderOption?: (raw: string) => string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // ANCHORING (R13.R4A.5 visual pass). The panel opens on the wrapper's left
  // edge; for a control sitting near the viewport's right edge (the
  // Dashboard's right-aligned per-card year selector at phone widths) that
  // pushes it off screen — the width cap only bounds how WIDE the panel is,
  // not WHERE it lands. The arithmetic itself lives in `popoverPosition.ts`
  // and is unit-tested there — R13.R4A.4's rule, that the calculation deciding
  // whether a reader sees a whole floating box is checked by assertion rather
  // than by rendering at the one width someone happened to try. This effect
  // only feeds it the DOM's own measurements and applies the result: style
  // writes only, no setState, the accepted measurement-effect shape.
  // Deliberately no dependency list — it re-clamps on every render while open,
  // and the panel exists only while open.
  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const wrap = wrapRef.current
    if (panel === null || wrap === null) return
    // PLACEMENT ONLY — the width cap stays on the class. Writing a width here
    // would override it (an inline style wins) and let the panel grow to the
    // whole gutter-to-gutter span; measured at 1408px on a 1440 viewport when
    // this effect briefly did exactly that.
    panel.style.left = `${clampPopoverLeft({
      anchorLeft: wrap.getBoundingClientRect().left,
      panelWidth: panel.offsetWidth,
      viewportWidth: document.documentElement.clientWidth,
    })}px`
  })

  useEffect(() => {
    if (!open) return
    // The trigger is the first button in the wrapper — the label span
    // precedes it and the panel's own buttons follow it in document order.
    const trigger = () => wrapRef.current?.querySelector('button')
    const onKey = (e: KeyboardEvent) => {
      // Escape closes and hands focus back, so a keyboard user is never left
      // with focus on a panel that has just left the document.
      if (e.key === 'Escape') {
        setOpen(false)
        trigger()?.focus()
      }
    }
    // `pointerdown`, not `click`: a click that starts inside the panel and ends
    // outside it — an ordinary drag over a long option list, and the norm on
    // touch — would close the panel mid-gesture on `click`.
    const onPointer = (e: PointerEvent) => {
      const node = wrapRef.current
      if (node !== null && e.target instanceof Node && !node.contains(e.target)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  if (options.length === 0) return null

  const show = (raw: string) => (renderOption ? renderOption(raw) : raw)
  // The closed state, per the brief: `All`, the one selected label, or a count.
  // It never repeats the dimension's noun — the control's own label carries it.
  const summary =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? show(value[0])
        : selectedLabel.replace('{n}', String(value.length))

  return (
    <div
      ref={wrapRef}
      className="relative flex items-center gap-2 text-xs text-muted-fg min-w-0"
      // Tabbing past the last option leaves the control; a non-modal popover
      // that stayed open behind the user's focus would be a panel they can no
      // longer reach and did not ask to keep. `relatedTarget` is null when
      // focus leaves the document entirely (switching windows) — that is not a
      // dismissal, so the panel stays.
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <span className="ui-label shrink-0" id={`${id}-label`}>
        {label}
      </span>
      {/* `selected` marks an ACTIVE NARROWING, not the open state: a filter
          that is restricting the data reads as a filled, heavier pill (fill
          AND weight — the ChipButton contract, never colour alone), while
          "All" stays a quiet chip. `title` restores whatever the truncation
          hides. The chevron uses currentColor, so it follows the pill's own
          resting/hover/selected ink instead of sitting a shade behind it. */}
      <ChipButton
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-summary`}
        onClick={() => setOpen((o) => !o)}
        selected={value.length > 0}
        title={summary}
        className="min-w-0 max-w-[14rem]"
      >
        <span id={`${id}-summary`} className="min-w-0 truncate">
          {summary}
        </span>
        <Chevron open={open} />
      </ChipButton>
      {open && (
        <div
          ref={panelRef}
          // z-20 is the documented ceiling for page content and the tier the
          // layering scale in globals.css names for in-card affordances; the
          // drawer/dialog/palette tiers above it must always out-stack a filter.
          role="group"
          aria-labelledby={`${id}-label`}
          className="absolute left-0 top-full z-20 mt-1 min-w-[12rem] max-w-[min(18rem,calc(100vw-2rem))]"
        >
          <GlassSurface variant="overlay" className="max-h-72 overflow-y-auto p-1.5">
            {/* "All" is a BUTTON, not a checkbox: it is not a sibling option that
                can be combined with the others, it is the act of clearing them.
                A checked checkbox beside other checked options would state
                exactly the contradiction the empty-set contract makes
                impossible. It wears the same row dress as the options, and its
                global focus ring lands on the button itself — it is a real,
                visible control. */}
            <button
              type="button"
              onClick={() => onChange([])}
              aria-pressed={value.length === 0}
              className={`${ROW_BASE} ${value.length === 0 ? ROW_ON : ROW_OFF}`}
            >
              <Tick on={value.length === 0} />
              <span className="min-w-0 truncate">{allLabel}</span>
            </button>
            <div className="my-1.5 border-t border-border" />
            {options.map((o) => {
              const checked = value.includes(o)
              return (
                <label
                  key={o}
                  className={`${ROW_BASE} ${ROW_FOCUS} cursor-pointer ${checked ? ROW_ON : ROW_OFF}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange(toggleSelection(value, o, options))}
                    className="sr-only"
                  />
                  <Tick on={checked} />
                  <span className="min-w-0 truncate">{show(o)}</span>
                </label>
              )
            })}
          </GlassSurface>
        </div>
      )}
    </div>
  )
}

/**
 * The selected marker. A fixed-width box whether or not it is ticked, so the
 * option labels stay on one left edge and the list does not jitter as
 * selections change — and `aria-hidden`, because the checkbox beside it
 * already carries the state for assistive technology. An inline SVG stroke
 * (the Chevron's own viewBox, stroke and weight) rather than a `✓` text
 * glyph, whose shape and baseline drift across the font-stack fallbacks.
 */
function Tick({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={`w-3.5 h-3.5 shrink-0 ${on ? 'text-accent' : 'opacity-0'}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  )
}

interface Props {
  options: FilterOptions
  filter: AlternativesFilter
  onChange: (next: (prev: AlternativesFilter) => AlternativesFilter) => void
  /** Event type narrows EVENTS only, so the Holdings view omits it. */
  showEventType?: boolean
}

export function AlternativesFilters({
  options,
  filter,
  onChange,
  showEventType = false,
}: Props) {
  const { t } = useLang()
  const a = t.fp.alternatives
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0">
      <AlternativesMultiSelect
        label={a.filterSociedad}
        allLabel={a.allSociedades}
        selectedLabel={a.selectedSociedades}
        options={options.sociedades}
        value={filter.sociedad}
        onChange={(sociedad) => onChange((f) => ({ ...f, sociedad }))}
      />
      <AlternativesMultiSelect
        label={a.filterCategory}
        allLabel={a.allCategories}
        selectedLabel={a.selectedCategories}
        options={options.categories}
        value={filter.category}
        onChange={(category) => onChange((f) => ({ ...f, category }))}
      />
      <AlternativesMultiSelect
        label={a.filterCurrency}
        allLabel={a.allCurrencies}
        selectedLabel={a.selectedCurrencies}
        options={options.currencies}
        value={filter.currency}
        onChange={(currency) => onChange((f) => ({ ...f, currency }))}
        renderOption={currencyLabel}
      />
      {showEventType && (
        <AlternativesMultiSelect
          label={a.filterEventType}
          allLabel={a.allEventTypes}
          selectedLabel={a.selectedEventTypes}
          options={options.eventTypes}
          value={filter.eventType}
          onChange={(eventType) => onChange((f) => ({ ...f, eventType }))}
          renderOption={(type) => eventTypeLabel(type, a)}
        />
      )}
    </div>
  )
}
