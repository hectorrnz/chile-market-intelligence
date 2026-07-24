'use client'

import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'

export type ActionPriority = 'high' | 'medium' | 'low'

export interface CurrentAction {
  id: string
  title: string
  priority: ActionPriority
  /** Short status/stage word shown next to the priority dot (e.g. "Pending approval"). Falls back to the priority word. */
  status?: string
  owner?: string
  dueDate?: string
  href?: string
  onAction?: () => void
  actionLabel?: string
}

interface CurrentActionsProps {
  /** Real actions only — an empty array renders the honest empty state, never a placeholder decision. */
  actions: CurrentAction[]
  viewAllHref?: string
  className?: string
}

const PRIORITY_COLOR: Record<ActionPriority, string> = {
  high: 'var(--critical-fill)',
  medium: 'var(--warning)',
  low: 'var(--nv-onnav)',
}

/**
 * The one solid deep-teal card in the Fable language (design_principles
 * §5.2 exception — fixed light-on-teal in both themes). Renders only actions
 * passed via props; never contains sample investment decisions.
 */
export function CurrentActions({ actions, viewAllHref, className = '' }: CurrentActionsProps) {
  const { t } = useLang()

  return (
    <section className={`nv-action-card p-4 flex flex-col gap-3 ${className}`} aria-label={t.fable.currentActions.title}>
      <div className="flex items-center justify-between">
        <span className="ui-label" style={{ color: 'var(--nv-onnav)' }}>
          {t.fable.currentActions.title}
        </span>
        <span
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: 'rgba(255,255,255,.16)', color: 'var(--nv-onnav)' }}
        >
          {actions.length}
        </span>
      </div>

      {actions.length === 0 ? (
        <p className="text-xs" style={{ color: 'rgba(255,255,255,.7)' }}>
          {t.fable.currentActions.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {actions.map((action) => (
            <li
              key={action.id}
              className="flex items-start justify-between gap-3 rounded-[var(--radius-menu)] p-2.5"
              style={{ backgroundColor: 'rgba(255,255,255,.06)' }}
            >
              <div className="min-w-0 flex flex-col gap-0.5">
                <span className="text-sm font-medium truncate" style={{ color: 'var(--nv-onnav)' }}>
                  {action.title}
                </span>
                {(action.owner || action.dueDate) && (
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,.68)' }}>
                    {[action.owner, action.dueDate].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--nv-onnav)' }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: PRIORITY_COLOR[action.priority] }} aria-hidden="true" />
                  {action.status ?? action.priority}
                </span>
                {action.onAction ? (
                  <button
                    type="button"
                    onClick={action.onAction}
                    aria-label={action.actionLabel ?? t.fable.currentActions.approve}
                    title={action.actionLabel ?? t.fable.currentActions.approve}
                    className="w-7 h-7 flex items-center justify-center rounded-full nv-transition"
                    style={{ backgroundColor: 'rgba(255,255,255,.14)', color: 'var(--nv-onnav)' }}
                  >
                    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
                      <polyline points="2,8.5 6,12.5 14,4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : action.href ? (
                  <Link href={action.href} aria-label={action.actionLabel ?? action.title} className="text-xs underline nv-transition" style={{ color: 'var(--nv-onnav)' }}>
                    {action.actionLabel ?? t.fable.currentActions.view}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {viewAllHref && (
        <Link href={viewAllHref} className="text-xs mt-1 self-start underline nv-transition" style={{ color: 'var(--nv-onnav)' }}>
          {t.fable.currentActions.viewAll}
        </Link>
      )}
    </section>
  )
}
