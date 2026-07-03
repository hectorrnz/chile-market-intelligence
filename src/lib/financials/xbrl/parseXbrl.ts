// Phase 8C.1 — minimal, dependency-free XBRL instance-document parser.
//
// Scope is deliberately narrow: this is NOT a general-purpose XBRL/XML
// validator. It targets the specific, simple, flat structure observed in
// real CMF-filed instance documents during discovery (see
// docs/cmf_xbrl_provider_discovery.md): a single <xbrli:xbrl> root with
// <xbrli:context>, <xbrli:unit>, and fact elements carrying a `contextRef`
// attribute. No external XML library is used (mirrors this project's
// "no dependency unless it solves a documented problem" convention, and the
// structure is simple enough that a careful regex-based extractor is
// sufficient and independently testable without a DOM).
//
// Rules enforced by design (do not weaken these):
//   - Never invents a fact that isn't in the source (no EBITDA, no derived
//     metrics here — that stays in csvFinancials.ts's deriveFinancialMetrics,
//     applied only to *actually present* statement items after normalization).
//   - Never assumes a currency — every fact's unit is read from its own
//     unitRef, never assumed to be CLP (Empresas Copec's real 2023 filing
//     reports entirely in USD — see the discovery doc).
//   - Preserves the raw concept name (e.g. "ifrs-full:Revenue") so an
//     unmapped concept is never silently dropped — see conceptMap.ts.

export interface XbrlContext {
  id: string
  entityIdentifier: string | null
  /** Instant date, or null if this is a duration context. */
  instant: string | null
  startDate: string | null
  endDate: string | null
  /** Dimensional members (xbrldi:explicitMember) — non-empty means this is a segment/breakdown context, not the plain consolidated figure. */
  dimensions: { dimension: string; member: string }[]
}

export interface XbrlUnit {
  id: string
  /** Normalized measure, e.g. "CLP", "USD", "shares", "pure". Null if unrecognized. */
  measure: string | null
}

export interface XbrlFact {
  /** Full concept name including namespace prefix, e.g. "ifrs-full:Revenue". */
  concept: string
  contextRef: string
  unitRef: string | null
  decimals: string | null
  /** Raw text content, unparsed — callers decide numeric vs. text. */
  rawValue: string
}

export interface XbrlInstance {
  contexts: XbrlContext[]
  units: XbrlUnit[]
  facts: XbrlFact[]
  /** Non-fatal issues encountered while parsing (never thrown away silently). */
  warnings: string[]
}

function stripCdata(text: string): string {
  return text.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function parseContexts(xml: string, warnings: string[]): XbrlContext[] {
  const contexts: XbrlContext[] = []
  const contextRe = /<xbrli:context\s+id="([^"]+)">([\s\S]*?)<\/xbrli:context>/g
  let m: RegExpExecArray | null
  while ((m = contextRe.exec(xml))) {
    const [, id, body] = m
    const identMatch = /<xbrli:identifier[^>]*>([^<]*)<\/xbrli:identifier>/.exec(body)
    const instantMatch = /<xbrli:instant>([^<]*)<\/xbrli:instant>/.exec(body)
    const startMatch = /<xbrli:startDate>([^<]*)<\/xbrli:startDate>/.exec(body)
    const endMatch = /<xbrli:endDate>([^<]*)<\/xbrli:endDate>/.exec(body)

    const dimensions: { dimension: string; member: string }[] = []
    const dimRe = /<xbrldi:explicitMember\s+dimension="([^"]+)">([^<]*)<\/xbrldi:explicitMember>/g
    let dm: RegExpExecArray | null
    while ((dm = dimRe.exec(body))) {
      dimensions.push({ dimension: dm[1], member: dm[2].trim() })
    }

    if (!identMatch && !instantMatch && !startMatch) {
      warnings.push(`context "${id}" has no recognizable entity/period — skipped`)
      continue
    }

    contexts.push({
      id,
      entityIdentifier: identMatch ? identMatch[1].trim() : null,
      instant: instantMatch ? instantMatch[1].trim() : null,
      startDate: startMatch ? startMatch[1].trim() : null,
      endDate: endMatch ? endMatch[1].trim() : null,
      dimensions,
    })
  }
  return contexts
}

const KNOWN_MEASURES: Record<string, string> = {
  'iso4217:clp': 'CLP',
  'iso4217:usd': 'USD',
  clp: 'CLP',
  usd: 'USD',
  'xbrli:shares': 'shares',
  shares: 'shares',
  sharesitem: 'shares',
  'xbrli:pure': 'pure',
  pure: 'pure',
}

function parseUnits(xml: string): XbrlUnit[] {
  const units: XbrlUnit[] = []
  const unitRe = /<xbrli:unit\s+id="([^"]+)">([\s\S]*?)<\/xbrli:unit>/g
  let m: RegExpExecArray | null
  while ((m = unitRe.exec(xml))) {
    const [, id, body] = m
    const measureMatch = /<xbrli:measure>([^<]*)<\/xbrli:measure>/.exec(body)
    const raw = measureMatch ? measureMatch[1].trim() : id
    const measure = KNOWN_MEASURES[raw.toLowerCase()] ?? KNOWN_MEASURES[id.toLowerCase()] ?? null
    units.push({ id, measure })
  }
  return units
}

/**
 * Extracts fact elements: any tag with a namespace prefix (not xbrli/xbrldi/
 * link/xlink/xsi, which are structural) carrying a contextRef attribute.
 * Self-closing facts (no content) are skipped — they carry no value.
 */
function parseFacts(xml: string, warnings: string[]): XbrlFact[] {
  const facts: XbrlFact[] = []
  const STRUCTURAL_PREFIXES = new Set(['xbrli', 'xbrldi', 'link', 'xlink', 'xsi'])

  // Content is matched as [^<]* (never [\s\S]*?): a real XBRL fact is always a
  // leaf text node (numeric or string), never a nested element. Using a
  // non-greedy "any character" class here would let the regex's backreference
  // search skip past sibling facts and match all the way out to the *last*
  // same-named closing tag in the whole document (or, worse, treat the
  // top-level <xbrli:xbrl> root as one giant single "fact" spanning the
  // entire file) — this was a real bug caught by this file's own test suite
  // against a realistic fixture, not by inspection.
  const factRe = /<([A-Za-z][\w-]*):([\w-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(?:\/>|>([^<]*)<\/\1:\2>)/g
  let m: RegExpExecArray | null
  while ((m = factRe.exec(xml))) {
    const [, prefix, localName, attrsRaw, content] = m
    if (STRUCTURAL_PREFIXES.has(prefix)) continue

    const contextRefMatch = /contextRef="([^"]*)"/.exec(attrsRaw)
    if (!contextRefMatch) continue // not a fact (e.g. a schemaRef or link element with an odd prefix)

    if (content === undefined) {
      warnings.push(`fact ${prefix}:${localName} (context ${contextRefMatch[1]}) is self-closing — no value, skipped`)
      continue
    }

    const unitRefMatch = /unitRef="([^"]*)"/.exec(attrsRaw)
    const decimalsMatch = /decimals="([^"]*)"/.exec(attrsRaw)

    facts.push({
      concept: `${prefix}:${localName}`,
      contextRef: contextRefMatch[1],
      unitRef: unitRefMatch ? unitRefMatch[1] : null,
      decimals: decimalsMatch ? decimalsMatch[1] : null,
      rawValue: decodeXmlEntities(stripCdata(content.trim())),
    })
  }
  return facts
}

/** Parses a raw XBRL instance document string into contexts, units, and facts. */
export function parseXbrlInstance(xml: string): XbrlInstance {
  const warnings: string[] = []
  const contexts = parseContexts(xml, warnings)
  const units = parseUnits(xml)
  const facts = parseFacts(xml, warnings)
  return { contexts, units, facts, warnings }
}

/** True if a context has no dimensional breakdown — i.e. it represents the plain consolidated figure. */
export function isPlainContext(context: XbrlContext): boolean {
  return context.dimensions.length === 0
}

/**
 * Returns only facts whose context is "plain" (no segment/dimension
 * breakdown) — the consolidated, top-level figures. Facts on dimensional
 * contexts (e.g. per-segment or per-related-party breakdowns) are excluded
 * here to avoid double-counting; they remain available in the full fact list
 * for callers that want them.
 */
export function plainFacts(instance: XbrlInstance): XbrlFact[] {
  const plainContextIds = new Set(instance.contexts.filter(isPlainContext).map((c) => c.id))
  return instance.facts.filter((f) => plainContextIds.has(f.contextRef))
}

export function findContext(instance: XbrlInstance, contextRef: string): XbrlContext | null {
  return instance.contexts.find((c) => c.id === contextRef) ?? null
}

export function findUnit(instance: XbrlInstance, unitRef: string | null): XbrlUnit | null {
  if (!unitRef) return null
  return instance.units.find((u) => u.id === unitRef) ?? null
}

/** Parses a fact's rawValue as a number, respecting `decimals` scaling is NOT applied here (left to the caller — decimals is metadata about precision, not a scale factor to multiply by). Returns null (never NaN) if unparsable. */
export function factNumericValue(fact: XbrlFact): number | null {
  const n = Number(fact.rawValue)
  return Number.isFinite(n) ? n : null
}
