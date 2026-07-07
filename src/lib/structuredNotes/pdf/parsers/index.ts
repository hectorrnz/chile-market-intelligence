// Phase 9C — Structured Notes multi-issuer parser router.
//
// Detects the issuer from keywords in the document and dispatches to the
// matching parser. An issuer that isn't recognized falls back to the
// generic Citi/HSBC parser, which is safe because it already requires every
// critical field to be present before it reports `ok: true` — an unrecognized,
// unsupported format will fail its critical-field checks and correctly
// surface as "review required" rather than being silently mis-parsed by
// the wrong issuer's field aliases.

import type { StructuredNoteExtractionResult } from '../../types.ts'
import { toLines } from './shared.ts'
import { parseCitiHsbc, CITI_HSBC_PARSER_VERSION } from './citiHsbcParser.ts'
import { parseCreditAgricole, CREDIT_AGRICOLE_PARSER_VERSION } from './creditAgricoleParser.ts'
import { parseBnpParibas, BNP_PARIBAS_PARSER_VERSION } from './bnpParibasParser.ts'
import { parseBarclays, BARCLAYS_PARSER_VERSION } from './barclaysParser.ts'
import { parseBbva, BBVA_PARSER_VERSION } from './bbvaParser.ts'
import type { DetectedIssuer, IssuerParseContext } from './types.ts'

export const ROUTER_VERSION = '9C.router.1'
export {
  CITI_HSBC_PARSER_VERSION,
  CREDIT_AGRICOLE_PARSER_VERSION,
  BNP_PARIBAS_PARSER_VERSION,
  BARCLAYS_PARSER_VERSION,
  BBVA_PARSER_VERSION,
}

/**
 * Detects the issuer from keyword matches. Order matters only in that each
 * check is specific enough not to collide with another issuer's name — this
 * never guesses between two plausible issuers.
 */
export function detectIssuer(joined: string): DetectedIssuer {
  if (/cr[ée]dit\s+agricole/i.test(joined)) return 'credit_agricole'
  if (/bnp\s+paribas/i.test(joined)) return 'bnp_paribas'
  if (/barclays/i.test(joined)) return 'barclays'
  if (/\bbbva\b/i.test(joined)) return 'bbva'
  return 'generic'
}

export function extractWithRouter(pages: string[], opts: { fileName?: string } = {}): { detectedIssuer: DetectedIssuer; result: StructuredNoteExtractionResult } {
  const lines = toLines(pages)
  const joined = lines.map((l) => l.text).join('\n')
  const ctx: IssuerParseContext = { lines, joined, fileName: opts.fileName }

  const detectedIssuer = detectIssuer(joined)
  const parser = {
    credit_agricole: parseCreditAgricole,
    bnp_paribas: parseBnpParibas,
    barclays: parseBarclays,
    bbva: parseBbva,
    generic: parseCitiHsbc,
  }[detectedIssuer]

  const result = parser(ctx)

  // An unrecognized issuer that ALSO fails to extract even an issuer display
  // name from the generic parser is genuinely unsupported, not just a
  // low-confidence extraction of a known format — surfaced as a distinct
  // error string so the UI can show "Unsupported issuer format" rather than
  // a generic "Review required".
  if (detectedIssuer === 'generic' && !result.note?.issuerDisplayName && !result.ok) {
    result.errors.push('unsupported issuer format — issuer could not be identified, manual entry required')
  }

  return { detectedIssuer, result }
}
