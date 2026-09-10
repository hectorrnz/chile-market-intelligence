// POST-R13.8 FOLLOW-UP F — THE PUBLICATION-METADATA REPAIR PACKET.
//
// The pure half of the bounded anchor repair: it builds the packet, canonicalizes
// it, hashes it, and checks its shape. It reads nothing and writes nothing, so a
// dry run and the real apply construct the identical packet from the identical
// code, and the hash proves it.
//
// WHAT A PACKET IS. A list of publications, each naming the exact identity the
// plan reviewed — id, week, revision, currency of the `is_current` flag — the
// WRONG value that must still stand, and the value to write. The database
// re-checks every one of those against a locked row before it mutates anything;
// nothing here is the security boundary. This layer exists so a malformed packet
// fails with a readable message on this side of the wire, and so the review and
// the apply are provably the same packet.
//
// IT DECIDES NOTHING. It does not read a workbook, infer a predecessor week or
// choose a corrected date. Those are inputs. A second engine that could disagree
// with the planner about what the right anchor is would be worse than one.

import { createHash } from 'node:crypto'

/**
 * The only publication metadata keys this mechanism may write.
 *
 * Mirrors `nmi_portfolio_repairable_metadata_fields()` exactly. Both entries are
 * spine anchors carrying the same invariant — strictly earlier than the week
 * they describe — which is what makes a corrected value checkable rather than
 * merely accepted. A key without that invariant does not belong here.
 */
export const REPAIRABLE_METADATA_FIELDS = ['previousWeekDate', 'beginningOfYearDate'] as const

export type RepairableMetadataField = (typeof REPAIRABLE_METADATA_FIELDS)[number]

/** One publication's correction, as reviewed. */
export interface MetadataRepairEntry {
  publicationId: string
  asOfDate: string
  expectedRevision: number
  expectedIsCurrent: boolean
  expectedUploadKind: string
  /** The value that must STILL stand, or null when the key is legitimately absent. */
  expectedValue: string | null
  correctedValue: string
}

export interface MetadataRepairPacket {
  operationId: string
  packetHash: string
  actor: string
  reason: string
  field: RepairableMetadataField
  expectedCount: number
  entries: MetadataRepairEntry[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A deterministic string for a packet.
 *
 * Object keys are emitted in sorted order and arrays keep their own order, so
 * the same reviewed content canonicalizes identically regardless of how the JSON
 * happened to be constructed. `packetHash` is excluded — a value cannot
 * contribute to its own hash.
 */
export function canonicalizeMetadataRepairPacket(packet: MetadataRepairPacket): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(src).sort()) {
        if (src[k] === undefined) continue
        out[k] = canon(src[k])
      }
      return out
    }
    return v
  }
  const { packetHash: _ignored, ...rest } = packet
  void _ignored
  return JSON.stringify(canon(rest))
}

/** SHA-256 of the canonical form — the identity the audit record stores. */
export function hashMetadataRepairPacket(packet: MetadataRepairPacket): string {
  return createHash('sha256').update(canonicalizeMetadataRepairPacket(packet), 'utf8').digest('hex')
}

/**
 * Assemble a packet and stamp it with its own hash.
 *
 * Entries are sorted by week, so two runs that read the publications in a
 * different order still produce a byte-identical packet and therefore the same
 * hash. Without that, an idempotent retry could look like a different packet.
 */
export function buildMetadataRepairPacket(
  entries: MetadataRepairEntry[],
  meta: { operationId: string; actor: string; reason: string; field: RepairableMetadataField },
): MetadataRepairPacket {
  const sorted = [...entries].sort((a, b) =>
    a.asOfDate === b.asOfDate
      ? a.publicationId.localeCompare(b.publicationId)
      : a.asOfDate.localeCompare(b.asOfDate),
  )
  const packet: MetadataRepairPacket = {
    operationId: meta.operationId,
    packetHash: '',
    actor: meta.actor,
    reason: meta.reason,
    field: meta.field,
    expectedCount: sorted.length,
    entries: sorted,
  }
  return { ...packet, packetHash: hashMetadataRepairPacket(packet) }
}

/**
 * Local shape validation, run before the packet is ever sent.
 *
 * NOT the security boundary — `nmi_repair_portfolio_publication_metadata`
 * re-validates every one of these against locked rows regardless. This catches
 * an obviously malformed packet without a connection, so a dry run can report it.
 */
export function validateMetadataRepairPacket(packet: MetadataRepairPacket): string[] {
  const errors: string[] = []

  if (!packet.operationId?.trim()) errors.push('operationId is required')
  if (!packet.actor?.trim()) errors.push('actor is required')
  if (!packet.reason?.trim()) {
    errors.push('reason is required')
  } else if (packet.reason.trim().length < 20) {
    errors.push('reason must be at least 20 characters — a generic placeholder is not a reason')
  }
  if (!packet.packetHash?.trim()) errors.push('packetHash is required')

  if (!(REPAIRABLE_METADATA_FIELDS as readonly string[]).includes(packet.field)) {
    errors.push(
      `field "${packet.field}" is not repairable — only ${REPAIRABLE_METADATA_FIELDS.join(', ')}`,
    )
  }

  if (!Array.isArray(packet.entries) || packet.entries.length === 0) {
    errors.push('a packet must carry at least one entry')
  } else {
    if (packet.expectedCount !== packet.entries.length) {
      errors.push(
        `expectedCount ${packet.expectedCount} does not match ${packet.entries.length} entries`,
      )
    }

    const seen = new Set<string>()
    for (const e of packet.entries) {
      const at = e.publicationId ?? '<missing id>'
      if (!UUID.test(e.publicationId ?? '')) errors.push(`entry ${at}: publicationId is not a uuid`)
      if (seen.has(e.publicationId)) errors.push(`entry ${at}: publication appears more than once`)
      seen.add(e.publicationId)

      if (!ISO_DATE.test(e.asOfDate ?? '')) errors.push(`entry ${at}: asOfDate must be YYYY-MM-DD`)
      if (!ISO_DATE.test(e.correctedValue ?? '')) {
        errors.push(`entry ${at}: correctedValue must be YYYY-MM-DD`)
      }
      if (e.expectedValue !== null && !ISO_DATE.test(e.expectedValue ?? '')) {
        errors.push(`entry ${at}: expectedValue must be YYYY-MM-DD or null`)
      }
      if (!Number.isInteger(e.expectedRevision) || e.expectedRevision < 1) {
        errors.push(`entry ${at}: expectedRevision must be a positive integer`)
      }
      if (typeof e.expectedIsCurrent !== 'boolean') {
        errors.push(`entry ${at}: expectedIsCurrent must be a boolean`)
      }
      if (!e.expectedUploadKind?.trim()) errors.push(`entry ${at}: expectedUploadKind is required`)

      // THE INVARIANT. The whole point of the repair is that an anchor precedes
      // its own week; a packet that would write one that does not is refused
      // here as well as by the database CHECK and the apply function.
      if (ISO_DATE.test(e.correctedValue ?? '') && ISO_DATE.test(e.asOfDate ?? '')) {
        if (!(e.correctedValue < e.asOfDate)) {
          errors.push(
            `entry ${at}: correctedValue ${e.correctedValue} is not strictly before its own week ${e.asOfDate}`,
          )
        }
      }
      // A correction that corrects nothing is not a correction.
      if (e.expectedValue !== null && e.expectedValue === e.correctedValue) {
        errors.push(`entry ${at}: correctedValue equals the stored value — nothing to correct`)
      }
    }
  }

  const recomputed = hashMetadataRepairPacket(packet)
  if (packet.packetHash && packet.packetHash !== recomputed) {
    errors.push(`packetHash does not match the packet content (expected ${recomputed})`)
  }

  return errors
}

/**
 * The immediately preceding source-backed reporting date.
 *
 * THIS IS WHERE A CORRECTED ANCHOR COMES FROM. A week's real previous week is
 * the greatest frozen reporting date strictly before it — never the previous
 * PUBLICATION (many reporting dates are never published), never the nearest
 * date in either direction, and never a calendar offset.
 *
 * Pure, so the derivation is testable without a database, and returns null
 * rather than guessing when the week is the earliest the source carries.
 */
export function previousSourceReportingDate(spine: string[], asOfDate: string): string | null {
  let best: string | null = null
  for (const d of spine) {
    if (d < asOfDate && (best === null || d > best)) best = d
  }
  return best
}

/** The one RPC this packet may be sent to. */
export const METADATA_REPAIR_RPC = 'nmi_repair_portfolio_publication_metadata'
