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

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { ChipLabel } from '@/components/fable/Chip'
import { AsyncState } from '@/components/fable/AsyncState'
import { Reveal } from '@/components/fable/motion'
import { formatSourceDate } from '@/lib/formatters'

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

export function SettingsClient({ account }: { account: SettingsAccount }) {
  const { t } = useLang()
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

      {/* Row 2 — Security. Full width in R9.2; R9.3 places the Display card beside it. */}
      <Reveal delayMs={130}>
        <GlassSurface as="section" className={`${CARD} mt-[14px] block`}>
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
      </Reveal>
    </div>
  )
}
