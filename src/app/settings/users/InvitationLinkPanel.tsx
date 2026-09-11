'use client'

// D0B1 — the one-time invitation URL, shown once.
//
// PRESENTATION ONLY. It receives a URL that the server has already returned and
// renders it; it mints nothing, stores nothing and decides nothing about who may
// see it. Whether this panel appears at all was settled server-side by
// `guardAdministrator()` before the URL existed.
//
// THE VALUE THIS RENDERS IS A BEARER CREDENTIAL
// ─────────────────────────────────────────────
// Anyone holding it can activate that account until it expires. Three consequences
// are visible in the code below:
//
//   · the security note is VISIBLE TEXT, not a tooltip or a title attribute — the
//     administrator is about to paste this into some other application, and they
//     must know what they are pasting before they do;
//
//   · the URL is never logged, never re-fetched and never re-derived here. This
//     component is the only place it is rendered, the parent drops it on close,
//     and nothing in the application can produce it again. Losing it is recovered
//     by re-inviting, which mints a fresh token and supersedes this one;
//
//   · the copy control degrades honestly. `navigator.clipboard` is unavailable on
//     an insecure origin and can be refused by permission policy; rather than
//     report a copy that did not happen, the field is selected so the
//     administrator can copy it themselves, and the state says so.
//
// The field is a read-only <input> rather than a <p> or a <code> block for two
// reasons: a long URL scrolls INSIDE it instead of widening the dialog at 390px
// (§20), and selecting it is the manual-copy fallback above.

import { useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { ChipButton } from '@/components/fable/Chip'

type CopyState = 'idle' | 'copied' | 'manual'

interface InvitationLinkPanelProps {
  /** The one-time URL. Rendered verbatim — never rebuilt, never trimmed. */
  url: string
  /** Who it is for, so the administrator cannot send it to the wrong person. */
  recipient: string
}

export function InvitationLinkPanel({ url, recipient }: InvitationLinkPanelProps) {
  const { t } = useLang()
  const [copy, setCopy] = useState<CopyState>('idle')
  const [field, setField] = useState<HTMLInputElement | null>(null)

  async function copyLink() {
    // Select first, unconditionally: whichever branch follows, the administrator
    // ends up with the whole URL highlighted and Ctrl-C working.
    field?.select()
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        setCopy('copied')
        return
      }
    } catch {
      // Fall through — never claim a copy that did not happen.
    }
    setCopy('manual')
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <p className="text-sm text-foreground">
        {t.usersAccess.manualLinkBody} <span className="font-medium">{recipient}</span>
      </p>

      <div className="flex flex-col gap-1 min-w-0">
        <label htmlFor="invite-manual-url" className="ui-label text-muted-fg">
          {t.usersAccess.manualLinkLabel}
        </label>
        <input
          id="invite-manual-url"
          ref={setField}
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          autoComplete="off"
          className="h-8 w-full min-w-0 rounded-[var(--radius-input)] border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] px-3 font-mono text-xs text-foreground nv-transition"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ChipButton onClick={() => void copyLink()}>{t.usersAccess.copyInviteLink}</ChipButton>
        {copy === 'copied' && (
          <span role="status" className="ui-meta text-positive">
            {t.usersAccess.inviteLinkCopied}
          </span>
        )}
        {copy === 'manual' && (
          <span role="status" className="ui-meta text-muted-fg">
            {t.usersAccess.inviteLinkCopyManually}
          </span>
        )}
      </div>

      {/* Visible, not hover-only: this is what the administrator is about to hand over. */}
      <p
        className="ui-meta rounded-[var(--radius-input)] border px-3 py-2.5"
        style={{
          borderColor: 'color-mix(in oklab, var(--warning) 34%, transparent)',
          backgroundColor: 'color-mix(in oklab, var(--warning) 10%, var(--surface))',
          color: 'var(--foreground)',
        }}
      >
        {t.usersAccess.manualLinkSecurityNote}
      </p>
    </div>
  )
}
