'use client'

// R13.R2 §§ 14-15 — the administrator's Allocation-display settings dialog,
// built on the one shared `ModalShell` (never a second modal system).
//
// Every control edits a CLOSED enum from `allocationSettings.ts` — there is
// deliberately no hex input, no colour picker, and no free-text field
// anywhere in this dialog; a palette is chosen by NAME, previewed as a swatch
// row of its eight design tokens, and resolves to token values declared once
// in `globals.css`. The dialog holds a local draft; Save hands the draft to
// the page (`onSave` — the page owns the network call and the global state)
// and reports the returned outcome; Cancel/Escape/scrim discard unsaved
// edits. While the save is in flight the shell's `dismissDisabled` locks
// every dismissal path, so the dialog cannot vanish mid-request.
//
// THE GLOBAL-SCOPE NOTE RENDERS FIRST AND ALWAYS (§ 15): these are product
// settings every authorized member sees, not a personal preference — the
// administrator must read that before touching anything.
//
// NO LIVE DONUT PREVIEW — a deliberate omission, not a shortcut: the dialog
// receives no allocation entries, so a preview would need fabricated sample
// slices, which the no-sample-financial-data rule forbids. The palette
// swatch rows and the named thickness steps carry the choice visibly.
//
// Draft reset uses the render-time previous-value pattern (the codebase
// standard — never a setState-in-effect) so reopening always starts from the
// currently approved settings.

import { useRef, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { ModalShell } from '@/components/fable/ModalShell'
import { ChipButton } from '@/components/fable/Chip'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import {
  ALLOCATION_PALETTES,
  PALETTE_TOKENS,
  type AllocationDonutThickness,
  type AllocationLabelContent,
  type AllocationLabelPosition,
  type AllocationPalette,
  type AllocationPresentationSettings,
  type ReferenceLineMode,
} from '@/lib/familyPortfolio/allocationSettings'

export interface AllocationSettingsDialogProps {
  open: boolean
  settings: AllocationPresentationSettings
  onClose: () => void
  /** Resolves 'saved' or 'error'. The page owns the network call. */
  onSave: (next: AllocationPresentationSettings) => Promise<'saved' | 'error'>
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Labelled control row — module scope, per the codebase's lint convention. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="ui-label text-muted-fg">{label}</span>
      {children}
    </div>
  )
}

export function AllocationSettingsDialog({
  open,
  settings,
  onClose,
  onSave,
}: AllocationSettingsDialogProps) {
  const { t, lang } = useLang()
  const o = t.fp.overview

  const [draft, setDraft] = useState<AllocationPresentationSettings>(settings)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const paletteRefs = useRef<Partial<Record<AllocationPalette, HTMLButtonElement | null>>>({})

  // Render-time reset on open: the draft always starts from the currently
  // approved settings, and a stale saved/error message never survives a
  // reopen.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setDraft(settings)
      setStatus('idle')
    }
  }

  function patch(partial: Partial<AllocationPresentationSettings>) {
    setDraft((d) => ({ ...d, ...partial }))
    // A new edit invalidates a previous outcome message.
    setStatus((s) => (s === 'saving' ? s : 'idle'))
  }

  async function handleSave() {
    if (status === 'saving') return
    setStatus('saving')
    const result = await onSave(draft)
    setStatus(result === 'saved' ? 'saved' : 'error')
  }

  const paletteName: Record<AllocationPalette, string> = {
    institutional: o.settingsPaletteInstitutional,
    spectrum: o.settingsPaletteSpectrum,
  }

  function movePalette(delta: number) {
    const i = ALLOCATION_PALETTES.indexOf(draft.palette)
    const next = ALLOCATION_PALETTES[(i + delta + ALLOCATION_PALETTES.length) % ALLOCATION_PALETTES.length]
    patch({ palette: next })
    requestAnimationFrame(() => paletteRefs.current[next]?.focus())
  }

  function onPaletteKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      movePalette(1)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      movePalette(-1)
    }
  }

  const showMaskNote = draft.labelContent !== 'percentage'

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={o.settingsTitle}
      size="md"
      dense
      dismissDisabled={status === 'saving'}
      footer={
        <>
          {/* Outcome message: words carry the meaning; colour only reinforces. */}
          <span
            role="status"
            aria-live="polite"
            className={`ui-meta mr-auto ${
              status === 'saved' ? 'text-positive' : status === 'error' ? 'text-negative' : 'text-muted-fg'
            }`}
          >
            {status === 'saved' ? o.settingsSaved : status === 'error' ? o.settingsError : ''}
          </span>
          <ChipButton onClick={onClose} disabled={status === 'saving'}>
            {o.settingsCancel}
          </ChipButton>
          <button
            type="button"
            onClick={handleSave}
            disabled={status === 'saving'}
            aria-busy={status === 'saving' || undefined}
            className="inline-flex items-center gap-2 h-8 px-4 rounded-full text-xs font-medium bg-accent text-accent-fg nv-transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {o.settingsSave}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p
          className="text-xs text-foreground bg-surface-2 rounded-[6px] px-3 py-2"
          style={{ borderLeft: '3px solid var(--accent)' }}
        >
          {o.settingsGlobalNote}
        </p>

        <Field label={o.settingsLabelPosition}>
          <SegmentedControl<AllocationLabelPosition>
            options={[
              { value: 'inside', label: o.settingsPosInside },
              { value: 'outside', label: o.settingsPosOutside },
              { value: 'legend_only', label: o.settingsPosLegend },
            ]}
            value={draft.labelPosition}
            onChange={(v) => patch({ labelPosition: v })}
            ariaLabel={o.settingsLabelPosition}
            remeasureToken={lang}
          />
        </Field>

        <Field label={o.settingsLabelContent}>
          <SegmentedControl<AllocationLabelContent>
            options={[
              { value: 'percentage', label: o.settingsContentPct },
              { value: 'value', label: o.settingsContentValue },
              { value: 'percentage_value', label: o.settingsContentBoth },
            ]}
            value={draft.labelContent}
            onChange={(v) => patch({ labelContent: v })}
            ariaLabel={o.settingsLabelContent}
            remeasureToken={lang}
          />
          {showMaskNote && <p className="ui-meta text-muted-fg">{o.settingsMaskNote}</p>}
        </Field>

        <Field label={o.settingsLegend}>
          <SegmentedControl<'show' | 'hide'>
            options={[
              { value: 'show', label: o.settingsLegendShow },
              { value: 'hide', label: o.settingsLegendHide },
            ]}
            value={draft.legendVisible ? 'show' : 'hide'}
            onChange={(v) => patch({ legendVisible: v === 'show' })}
            ariaLabel={o.settingsLegend}
            remeasureToken={lang}
          />
        </Field>

        <Field label={o.settingsPalette}>
          {/* Presets only — a name plus its eight tokens as swatches. Proper
              radiogroup semantics with a roving tabindex, mirroring
              SegmentedControl's keyboard contract. */}
          <div
            role="radiogroup"
            aria-label={o.settingsPalette}
            onKeyDown={onPaletteKeyDown}
            className="flex flex-col gap-1.5"
          >
            {ALLOCATION_PALETTES.map((p) => {
              const selected = draft.palette === p
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  ref={(el) => {
                    paletteRefs.current[p] = el
                  }}
                  onClick={() => patch({ palette: p })}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-[13px] border text-xs nv-transition ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--selected)] font-semibold text-foreground'
                      : 'border-[var(--nv-chipbd)] bg-[var(--nv-chip)] text-muted-fg hover:text-foreground'
                  }`}
                >
                  <span>{paletteName[p]}</span>
                  {/* Swatches are illustrative — the NAME carries the choice,
                      so meaning is never colour-alone. */}
                  <span className="flex items-center gap-1" aria-hidden="true">
                    {PALETTE_TOKENS[p].map((token) => (
                      <span
                        key={token}
                        className="w-3.5 h-3.5 rounded-[3px]"
                        style={{ backgroundColor: `var(${token})` }}
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>

        <Field label={o.settingsThickness}>
          <SegmentedControl<AllocationDonutThickness>
            options={[
              { value: 'thin', label: o.settingsThicknessThin },
              { value: 'medium', label: o.settingsThicknessMedium },
              { value: 'thick', label: o.settingsThicknessThick },
            ]}
            value={draft.donutThickness}
            onChange={(v) => patch({ donutThickness: v })}
            ariaLabel={o.settingsThickness}
            remeasureToken={lang}
          />
        </Field>

        {/* ── Chart display (owner review §§ 9-10, 18) ────────────────────────
            Presentation only. The DIRECT view interactions — period, Compare,
            Incl./Excl. — deliberately stay on the chart itself and out of this
            dialog: they are how a member reads the data, not configuration, and
            burying them behind an administrator-only control would take them
            away from everyone else. What lives here is the one thing that IS a
            durable presentation decision. */}
        <div className="pt-1" style={{ borderTop: '1px solid var(--nv-line)' }}>
          <h3 className="ui-label text-muted-fg pt-3 pb-1">{o.settingsEvolutionTitle}</h3>
          <Field label={o.hwmSetting}>
            <SegmentedControl<ReferenceLineMode>
              options={[
                { value: 'auto', label: o.hwmSettingAuto },
                { value: 'hidden', label: o.hwmSettingHidden },
              ]}
              value={draft.referenceLine}
              onChange={(v) => patch({ referenceLine: v })}
              ariaLabel={o.hwmSetting}
              remeasureToken={lang}
            />
            {/* The owner-required default is stated, so an administrator can
                see what "Automatic" commits to without changing it to find out. */}
            <p className="ui-meta text-muted-fg">{o.hwmSettingHelp}</p>
            <p className="ui-meta text-muted-fg">{o.hwmTooltip}</p>
          </Field>
        </div>
      </div>
    </ModalShell>
  )
}
