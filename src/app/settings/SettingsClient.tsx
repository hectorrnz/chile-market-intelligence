'use client'

// R9.2 — the Fable Administration composition, populated only with real NMI
// capabilities.
//
// Fable's screen 10 (standalone-html/nevada-frontend.html:985–1068) is six
// cards of fixture content: a four-person user directory, four invented data
// feeds, six security capabilities this platform does not have, five
// notification switches nothing consumes, four reporting policies with no
// concept behind them, and a user-action audit log with a seven-year
// immutability claim. The VISUAL composition is authoritative and reproduced
// here — page header above flowing cards, 22px glass, uppercase section labels,
// primary-label-over-muted-subline rows, right-aligned status chips, 14px gaps,
// Fable's flex proportions and min-width stacking. The CONTENT is NMI's.
//
// This component owns no account authority: every account value arrives
// pre-resolved and sanitized from the server component, which is the only place
// `supabase.auth.getUser()` and the `user_profiles` row are read.
//
// R9.3 — the Display card joins Security in the second Fable row, taking the
// slot Fable filled with its five inert notification switches. It is the only
// interactive card on the page. Both of its controls are VIEWS of preference
// state that already existed and still lives elsewhere: theme in the one shared
// store (`@/lib/useTheme`), language in `LangProvider`. Nothing here owns,
// copies, re-defaults, or re-persists either value — which is exactly why the
// TopBar controls and these stay in step in both directions, in this tab and
// across tabs, with no new key, provider, or storage format.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { ChipLabel } from '@/components/fable/Chip'
import { AsyncState } from '@/components/fable/AsyncState'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { Switch } from '@/components/fable/Switch'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { Reveal } from '@/components/fable/motion'
import { NotificationRecipientsCard } from './NotificationRecipientsCard'
import { formatSourceDate } from '@/lib/formatters'
import { useTheme, type Theme } from '@/lib/useTheme'
import type { Lang } from '@/lib/i18n'

/** Sanitized, serializable account facts resolved server-side. Never a token, never a role. */
export interface SettingsAccount {
  /** Presentation only — profile display_name, else user_metadata. Never an authority claim. */
  displayName: string | null
  /** From the authenticated user. */
  email: string | null
  /** From the authoritative `user_profiles` row ONLY — null when it could not be read. */
  username: string | null
  /** `unavailable` when the profile row could not be read — never silently rendered as a denial. */
  access: 'approved' | 'not_approved' | 'unavailable'
}

/** The exact sanitized shape `GET /api/health/ingestion` returns. */
type HealthStatus = 'healthy' | 'warning' | 'stale' | 'failed' | 'unknown'

interface IngestionHealth {
  overallStatus: HealthStatus
  generatedAt: string | null
  macro: {
    status: HealthStatus
    latestRunAt: string | null
    indicatorsHealthy: number | null
    indicatorsTotal: number | null
  } | null
  market: {
    status: HealthStatus
    latestRunAt: string | null
    latestSnapshotDate: string | null
    stockCount: number | null
    indexCount: number | null
    sectorCount: number | null
  } | null
}

const STATUS_TONE: Record<HealthStatus, string> = {
  healthy: 'text-positive',
  warning: 'text-warning',
  stale: 'text-warning',
  failed: 'text-negative',
  unknown: 'text-muted-fg',
}

const CARD = 'px-5 py-[18px]'
const ROW = 'flex items-center gap-3 py-2.5 border-b border-[var(--nv-line)] last:border-0'

/** Fable's `10.5px/700/.14em` section label — as a real subordinate heading. */
function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="ui-label text-muted-fg">{children}</h2>
}

/** Fable status-row anatomy: primary label over a muted subline, chip pinned right. */
function StatusRow({ name, detail, chip }: { name: string; detail?: string | null; chip: React.ReactNode }) {
  return (
    <div className={ROW}>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-foreground font-medium break-words">{name}</span>
        {detail && <span className="block ui-meta text-muted-fg mt-0.5 break-words">{detail}</span>}
      </span>
      {chip}
    </div>
  )
}

/**
 * R9.3 — the same Fable row anatomy as `StatusRow` (identical `ROW` padding,
 * rule and label-over-subline block), with a compact control pinned right
 * instead of a status chip.
 *
 * The one addition is `flex-wrap` + a real `basis`: at a narrow width the
 * selector drops to its own right-aligned line rather than squeezing the label
 * to a sliver. `StatusRow` keeps its own single-line behavior untouched, so the
 * Account/Data-sources/Security rows are byte-identical to R9.2.
 */
function PreferenceRow({ label, detail, control }: { label: string; detail: string; control: React.ReactNode }) {
  return (
    <div className={`${ROW} flex-wrap`}>
      <span className="grow shrink basis-[140px] min-w-0">
        <span className="block text-xs text-foreground font-medium break-words">{label}</span>
        <span className="block ui-meta text-muted-fg mt-0.5 break-words">{detail}</span>
      </span>
      {control}
    </div>
  )
}

export function SettingsClient({ account }: { account: SettingsAccount }) {
  // Both preferences are read from the systems that already own them — this
  // component adds no authoritative state of its own for either one.
  const { lang, setLang, t } = useLang()
  const { theme, setTheme } = useTheme()
  // R9.6 — the same `cmi.privacyMode` preference the Portfolio masking reads.
  // This is a VIEW of it, exactly like Theme and Language above: no second key,
  // no second store, no authoritative local copy.
  const [privacy, setPrivacy] = usePrivacyMode()
  const s = t.settings

  const [health, setHealth] = useState<IngestionHealth | null>(null)
  const [healthState, setHealthState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch('/api/health/ingestion', { cache: 'no-store', signal: controller.signal })
        if (!res.ok) throw new Error('unavailable')
        const json = (await res.json()) as IngestionHealth
        if (controller.signal.aborted) return
        setHealth(json)
        setHealthState('ready')
      } catch {
        // A failed or aborted request is never rendered as healthy or empty.
        if (!controller.signal.aborted) setHealthState('error')
      }
    })()
    return () => controller.abort()
  }, [])

  const statusWord = useCallback((status: HealthStatus) => s.sources.status[status] ?? s.sources.status.unknown, [s])

  // Only fields the endpoint genuinely returned are composed into a subline.
  const sourceRows: { key: string; name: string; detail: string | null; status: HealthStatus }[] = []
  if (health?.macro) {
    const parts: string[] = []
    if (health.macro.indicatorsTotal != null && health.macro.indicatorsHealthy != null) {
      parts.push(`${health.macro.indicatorsHealthy}/${health.macro.indicatorsTotal} ${s.sources.indicators}`)
    }
    if (health.macro.latestRunAt) parts.push(`${s.sources.lastRun} ${formatSourceDate(health.macro.latestRunAt)}`)
    sourceRows.push({ key: 'macro', name: s.sources.macro, detail: parts.join(' · ') || null, status: health.macro.status })
  }
  if (health?.market) {
    const parts: string[] = []
    const counts: string[] = []
    if (health.market.stockCount != null) counts.push(`${health.market.stockCount} ${s.sources.stocks}`)
    if (health.market.indexCount != null) counts.push(`${health.market.indexCount} ${s.sources.indices}`)
    if (health.market.sectorCount != null) counts.push(`${health.market.sectorCount} ${s.sources.sectors}`)
    if (counts.length) parts.push(counts.join(' · '))
    if (health.market.latestSnapshotDate) {
      parts.push(`${s.sources.latestSnapshot} ${formatSourceDate(health.market.latestSnapshotDate)}`)
    }
    if (health.market.latestRunAt) parts.push(`${s.sources.lastRun} ${formatSourceDate(health.market.latestRunAt)}`)
    sourceRows.push({ key: 'market', name: s.sources.market, detail: parts.join(' · ') || null, status: health.market.status })
  }

  const accessLabel =
    account.access === 'approved' ? s.account.approved
      : account.access === 'not_approved' ? s.account.notApproved
        : s.account.unavailable

  const accountFields: { key: string; label: string; value: string | null; mono?: boolean }[] = [
    { key: 'displayName', label: s.account.displayName, value: account.displayName },
    { key: 'email', label: s.account.email, value: account.email },
    { key: 'username', label: s.account.username, value: account.username, mono: true },
  ]

  return (
    <div className="w-full">
      <PageHeader eyebrow={s.tag} title={s.title} metadata={s.subtitle} />

      {/* Row 1 — Fable proportions: Users&roles (1.6) beside Data sources (1). */}
      <Reveal delayMs={70}>
        <div className="flex flex-wrap items-stretch gap-[14px]">
          <GlassSurface as="section" className={`${CARD} grow-[1.6] shrink basis-[420px] min-w-[min(100%,330px)]`}>
            <CardTitle>{s.account.title}</CardTitle>
            <dl className="mt-1">
              {accountFields.map((f) => (
                <div key={f.key} className={ROW}>
                  <dt className="flex-1 min-w-0 text-xs text-muted-fg">{f.label}</dt>
                  <dd
                    className={`min-w-0 text-xs text-right break-all ${f.value ? 'text-foreground' : 'text-muted-fg'} ${f.mono ? 'font-mono' : ''}`}
                  >
                    {f.value ?? s.account.unavailable}
                  </dd>
                </div>
              ))}
              <div className={ROW}>
                <dt className="flex-1 min-w-0 text-xs text-muted-fg">{s.account.access}</dt>
                <dd className="min-w-0">
                  <ChipLabel className={account.access === 'approved' ? 'text-positive' : 'text-muted-fg'}>
                    {accessLabel}
                  </ChipLabel>
                </dd>
              </div>
            </dl>
            <p className="mt-2.5 ui-meta text-muted-fg">{s.account.note}</p>
          </GlassSurface>

          <GlassSurface as="section" className={`${CARD} grow shrink basis-[300px] min-w-[min(100%,280px)]`}>
            <CardTitle>{s.sources.title}</CardTitle>
            {healthState === 'loading' ? (
              <AsyncState kind="loading" />
            ) : healthState === 'error' ? (
              <AsyncState kind="unavailable" message={s.sources.loadError} />
            ) : sourceRows.length === 0 ? (
              <AsyncState kind="empty" message={s.sources.empty} />
            ) : (
              <>
                <div className="mt-1">
                  {sourceRows.map((row) => (
                    <StatusRow
                      key={row.key}
                      name={row.name}
                      detail={row.detail}
                      chip={<ChipLabel className={STATUS_TONE[row.status]}>{statusWord(row.status)}</ChipLabel>}
                    />
                  ))}
                </div>
                <p className="mt-2.5 ui-meta text-muted-fg">
                  {s.sources.note}
                  {health?.generatedAt ? ` · ${t.common.asOf} ${formatSourceDate(health.generatedAt)}` : ''}
                </p>
              </>
            )}
          </GlassSurface>
        </div>
      </Reveal>

      {/* Row 2 — Fable's second Administration row: Security beside the card
          that in the prototype held five inert notification switches. R9.3
          gives that slot to Display, at the approved 1.2 / 1 proportions. */}
      <Reveal delayMs={130}>
        <div className="flex flex-wrap items-stretch gap-[14px] mt-[14px]">
          <GlassSurface as="section" className={`${CARD} grow-[1.2] shrink basis-[320px] min-w-[min(100%,290px)]`}>
            <CardTitle>{s.security.title}</CardTitle>
            <div className="mt-1">
              <StatusRow name={s.security.access} detail={s.security.accessDesc} chip={<ChipLabel>{s.security.accessState}</ChipLabel>} />
              <StatusRow name={s.security.signup} detail={s.security.signupDesc} chip={<ChipLabel>{s.security.signupState}</ChipLabel>} />
              <StatusRow name={s.security.rls} detail={s.security.rlsDesc} chip={<ChipLabel>{s.security.rlsState}</ChipLabel>} />
              <StatusRow name={s.security.password} detail={s.security.passwordDesc} chip={<ChipLabel>{s.security.passwordState}</ChipLabel>} />
            </div>
            {/* Both actions reuse the canonical existing routes — no second auth
                workflow, and no signed-in password-change flow is invented. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link href="/forgot-password" className="text-xs text-accent hover:underline nv-transition">
                {s.security.resetPassword}
              </Link>
              <a href="/logout" className="text-xs text-negative hover:underline nv-transition">
                {s.security.signOut}
              </a>
            </div>
          </GlassSurface>

          <GlassSurface as="section" className={`${CARD} grow shrink basis-[300px] min-w-[min(100%,280px)]`}>
            <CardTitle>{s.display.title}</CardTitle>
            <div className="mt-1">
              {/* Theme — a VIEW of the shared store. `theme` is the store's own
                  value and `setTheme` its own writer, so selecting here updates
                  the document class, storage, the TopBar toggle and every other
                  tab through exactly one code path. The option values ARE the
                  stored values, so nothing is mapped or re-encoded.
                  `remeasureToken` re-measures the sliding indicator when a
                  language change re-renders these labels at a new width. */}
              <PreferenceRow
                label={s.display.theme}
                detail={s.display.themeDesc}
                control={
                  <SegmentedControl<Theme>
                    options={[
                      { value: 'light', label: s.display.light },
                      { value: 'dark', label: s.display.dark },
                    ]}
                    value={theme}
                    onChange={setTheme}
                    ariaLabel={s.display.theme}
                    remeasureToken={lang}
                    className="shrink-0 ml-auto"
                  />
                }
              />
              {/* Language — a VIEW of LangProvider. Same shape: `lang` is the
                  provider's value, `setLang` its writer, and the option values
                  are the stored raw ones. Both labels are endonyms in both
                  dictionaries, so someone who lands in a language they do not
                  read can still find their own. */}
              <PreferenceRow
                label={s.display.language}
                detail={s.display.languageDesc}
                control={
                  <SegmentedControl<Lang>
                    options={[
                      { value: 'en', label: s.display.english },
                      { value: 'es', label: s.display.spanish },
                    ]}
                    value={lang}
                    onChange={setLang}
                    ariaLabel={s.display.language}
                    className="shrink-0 ml-auto"
                  />
                }
              />
              {/* Privacy Mode — third, after Theme and Language. Same row
                  anatomy; the trailing control is the shared R9.1 Switch
                  because this genuinely IS a two-state on/off preference,
                  where Theme and Language are multi-option choices. */}
              <PreferenceRow
                label={s.display.privacy}
                detail={s.display.privacyDesc}
                control={
                  <Switch
                    checked={privacy}
                    onCheckedChange={setPrivacy}
                    aria-label={s.display.privacy}
                    className="shrink-0 ml-auto"
                  />
                }
              />
            </div>
            {/* Factual, not a saved-state indicator: these are per-browser
                client preferences, not account settings, applied on selection. */}
            <p className="mt-2.5 ui-meta text-muted-fg">{s.display.note}</p>
          </GlassSurface>
        </div>
      </Reveal>

      {/* Row 3 — Fable's full-width Audit History slot. R9.4 gives it to the
          Notification Recipients workflow, which is the one mutation-heavy
          surface here and therefore owns its own component. */}
      <Reveal delayMs={190}>
        <NotificationRecipientsCard />
      </Reveal>
    </div>
  )
}
