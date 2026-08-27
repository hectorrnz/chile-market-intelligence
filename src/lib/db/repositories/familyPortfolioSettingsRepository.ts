// R13.R2 §§ 14-15 — read/write access to the GLOBAL presentation settings.
//
// Every call goes through the CALLER'S OWN session client, so PostgreSQL RLS
// re-derives the authority: any caller holding a Family Portfolio scope may
// read, and only `nmi_is_administrator()` may write. The route's own
// `canAdminister` check sits in front of this and is deliberately redundant —
// neither layer is trusted to be the only one.
//
// THE SERVICE-ROLE CLIENT IS NEVER USED HERE. It would bypass exactly the rule
// this module exists to enforce, and no scheduled job writes these settings.
//
// A FAILED READ IS NOT AN ERROR STATE FOR THE PAGE. Presentation settings are
// cosmetic: an unconfigured database, an RLS refusal, or a transport failure
// all resolve to the documented defaults so the Summary still renders exactly
// what it rendered before this feature existed. A failed WRITE, by contrast, is
// reported — an administrator must never believe a choice was saved when it was
// not.

import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  DEFAULT_ALLOCATION_SETTINGS,
  normalizeStoredSettings,
  type AllocationPresentationSettings,
} from '@/lib/familyPortfolio/allocationSettings'

/** The singleton key; the database CHECK admits no other value. */
const SETTINGS_KEY = 'allocation'

interface SettingsRow {
  label_position: string | null
  label_content: string | null
  legend_visible: boolean | null
  palette: string | null
  donut_thickness: string | null
  reference_line: string | null
  updated_at: string | null
  updated_by: string | null
}

type SettingsSelect = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: unknown) => {
        maybeSingle: () => Promise<{ data: SettingsRow | null; error: unknown }>
      }
    }
    update: (values: Record<string, unknown>) => {
      eq: (col: string, v: unknown) => {
        select: (c: string) => {
          maybeSingle: () => Promise<{ data: SettingsRow | null; error: unknown }>
        }
      }
    }
  }
}

function toSettings(row: SettingsRow | null): AllocationPresentationSettings {
  if (row === null) return { ...DEFAULT_ALLOCATION_SETTINGS }
  return normalizeStoredSettings({
    labelPosition: row.label_position,
    labelContent: row.label_content,
    legendVisible: row.legend_visible,
    palette: row.palette,
    donutThickness: row.donut_thickness,
    referenceLine: row.reference_line,
  })
}

export interface PresentationSettingsRead {
  settings: AllocationPresentationSettings
  /** ISO timestamp of the last administrator write, or null if never written. */
  updatedAt: string | null
  /**
   * True when the values came from the database; false when they are the
   * documented defaults because no row was readable. The surface can then be
   * honest about whether an administrator has configured anything.
   */
  persisted: boolean
}

/**
 * The current global settings. Always succeeds: an unreadable row yields the
 * documented defaults with `persisted: false` rather than an error, because a
 * cosmetic preference must never be able to break the Summary.
 */
export async function getPresentationSettings(): Promise<PresentationSettingsRead> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return { settings: { ...DEFAULT_ALLOCATION_SETTINGS }, updatedAt: null, persisted: false }
  }

  const { data, error } = await (client as never as SettingsSelect)
    .from('family_portfolio_presentation_settings')
    .select('label_position, label_content, legend_visible, palette, donut_thickness, reference_line, updated_at, updated_by')
    .eq('settings_key', SETTINGS_KEY)
    .maybeSingle()

  if (error || !data) {
    return { settings: { ...DEFAULT_ALLOCATION_SETTINGS }, updatedAt: null, persisted: false }
  }
  return { settings: toSettings(data), updatedAt: data.updated_at, persisted: true }
}

export type SettingsWriteResult =
  | { ok: true; settings: AllocationPresentationSettings; updatedAt: string | null }
  | { ok: false; code: 'not_configured' | 'not_authorized' | 'write_failed' }

/**
 * Writes the global settings. `actorId` is recorded as audit metadata; it is the
 * server-resolved session user, never a client-supplied value.
 *
 * An UPDATE that RLS refuses affects zero rows and returns no row rather than
 * raising — so a null result is treated as `not_authorized`, not as success.
 * That distinction is the whole point: a silently-dropped write would tell an
 * administrator their choice was saved when nothing changed.
 */
export async function updatePresentationSettings(
  settings: AllocationPresentationSettings,
  actorId: string,
): Promise<SettingsWriteResult> {
  const client = await getSupabaseUserClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await (client as never as SettingsSelect)
    .from('family_portfolio_presentation_settings')
    .update({
      label_position: settings.labelPosition,
      label_content: settings.labelContent,
      legend_visible: settings.legendVisible,
      palette: settings.palette,
      donut_thickness: settings.donutThickness,
      reference_line: settings.referenceLine,
      updated_by: actorId,
    })
    .eq('settings_key', SETTINGS_KEY)
    .select('label_position, label_content, legend_visible, palette, donut_thickness, reference_line, updated_at, updated_by')
    .maybeSingle()

  if (error) return { ok: false, code: 'write_failed' }
  if (!data) return { ok: false, code: 'not_authorized' }
  return { ok: true, settings: toSettings(data), updatedAt: data.updated_at }
}
