// R13.7 § 9 — SERVER-ONLY binding between the pure valuation-date close
// policy (`valuationClose.ts`) and the two real evidence sources.
//
// Never import from a client component: it reaches Supabase and Yahoo.
//
// ONE resolver, THREE consumers — the T0 observation cron, the T-1 potential
// autocall warning, and the reconciliation dry run all call this. That is the
// point: if any of them resolved closes its own way, they could disagree about
// whether a note was called, which is the class of divergence R13.7 exists to
// eliminate (§ 17).

import type { StructuredNote, StructuredNoteUnderlying } from './types.ts'
import { resolveValuationCloses, type DatedSnapshot, type DatedHistory, type ResolvedValuationClose } from './valuationClose.ts'
import { DEFAULT_EXCHANGE_TIMEZONE, addIsoDays } from './marketDate.ts'
import { getStructuredNotePriceSnapshotsForDates } from '../db/repositories/structuredNotesRepository'
import { getYahooDailyCloses } from '../providers/market/yahooHistoryProvider'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

/** How far either side of the requested window to fetch history, so a range of one date still returns a usable series. */
const HISTORY_PAD_DAYS = 7

/**
 * Fetches provider daily closes for every distinct symbol on a note, over the
 * span covering `dates`.
 *
 * Failures are non-fatal and per-symbol: an unreachable provider degrades that
 * underlying to "no history", which downstream becomes `unavailable` and then
 * `unknown` — never a fabricated or substituted level.
 */
export async function fetchNoteHistory(
  underlyings: StructuredNoteUnderlying[],
  dates: string[],
  timeZone: string = DEFAULT_EXCHANGE_TIMEZONE,
): Promise<DatedHistory[]> {
  if (dates.length === 0) return []
  const sorted = [...dates].sort()
  const from = addIsoDays(sorted[0], -HISTORY_PAD_DAYS)
  const to = addIsoDays(sorted[sorted.length - 1], HISTORY_PAD_DAYS)
  if (!from || !to) return []

  const bySymbol = new Map<string, Map<string, number>>()
  const symbols = [...new Set(underlyings.map((u) => u.yahooSymbol).filter((s): s is string => !!s))]
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const res = await getYahooDailyCloses(symbol, new Date(from + 'T00:00:00Z'), new Date(to + 'T00:00:00Z'), timeZone)
      if (!res.ok) return
      const m = new Map<string, number>()
      for (const c of res.data.closes) m.set(c.date, c.close)
      bySymbol.set(symbol, m)
    } catch {
      // Per-symbol isolation — one bad symbol never blocks the others.
    }
  }))

  return underlyings
    .filter((u) => u.yahooSymbol && bySymbol.has(u.yahooSymbol))
    .map((u) => ({ underlyingOrder: u.underlyingOrder, closesByDate: bySymbol.get(u.yahooSymbol!)! }))
}

/** Persisted snapshots for a note, keyed to market dates and mapped onto underlying order. */
export async function fetchNoteSnapshots(
  client: Client,
  note: Pick<StructuredNote, 'id' | 'underlyings'>,
  dates: string[],
): Promise<DatedSnapshot[]> {
  if (!note.id || dates.length === 0) return []
  const rows = await getStructuredNotePriceSnapshotsForDates(client, note.id, dates)
  const orderById = new Map<string, number>()
  for (const u of note.underlyings) if (u.id) orderById.set(u.id, u.underlyingOrder)
  return rows
    .filter((r) => orderById.has(r.underlyingId))
    .map((r) => ({ underlyingOrder: orderById.get(r.underlyingId)!, priceDate: r.priceDate, close: r.price, source: r.source }))
}

export interface NoteValuationCloses {
  /** valuationDate -> the resolved close for every underlying on that date. */
  byDate: Map<string, ResolvedValuationClose[]>
  /** Snapshots that were available, for audit/evidence recording. */
  snapshots: DatedSnapshot[]
  history: DatedHistory[]
}

/**
 * Resolves the official closes for a set of contractual valuation dates on one
 * note, from both evidence tiers.
 *
 * `extraSnapshots` lets a caller inject rows it has just computed but not yet
 * read back (the monitoring cron writes today's snapshot and evaluates today's
 * observation in the same pass). They are merged ahead of the database rows so
 * a same-run write is visible without a round trip.
 */
export async function resolveNoteValuationCloses(
  client: Client,
  note: Pick<StructuredNote, 'id' | 'underlyings'>,
  dates: string[],
  extraSnapshots: DatedSnapshot[] = [],
  timeZone: string = DEFAULT_EXCHANGE_TIMEZONE,
): Promise<NoteValuationCloses> {
  const unique = [...new Set(dates)].filter(Boolean).sort()
  if (unique.length === 0) return { byDate: new Map(), snapshots: [], history: [] }

  const [persisted, history] = await Promise.all([
    fetchNoteSnapshots(client, note, unique),
    fetchNoteHistory(note.underlyings, unique, timeZone),
  ])
  const snapshots = [...extraSnapshots, ...persisted]

  const byDate = new Map<string, ResolvedValuationClose[]>()
  for (const d of unique) byDate.set(d, resolveValuationCloses(note.underlyings, d, snapshots, history))
  return { byDate, snapshots, history }
}
