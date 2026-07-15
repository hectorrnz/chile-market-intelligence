// Cautious affected-ticker/asset/tag mapping for the News module.
//
// Rule (per the phase brief): only map a ticker when the match is
// high-confidence. Company full/legal/short names are matched as whole
// substrings (never a single generic word); the bare ticker symbol is
// matched only as an isolated, case-sensitive, all-caps token (Spanish prose
// essentially never contains a random all-caps 3-6 letter word that isn't an
// acronym/ticker). A small denylist excludes tickers/aliases that collide
// with common words or country names. Unmapped items still display — no
// ticker is ever guessed to "fill in" a row.

// Loaded via fs.readFileSync + import.meta.url (not a plain `@/data` or
// relative JSON import) — this module is imported directly by unit tests
// running under Node's native test runner, which requires an explicit
// `with { type: 'json' }` import attribute for a static JSON import that
// Next.js's own bundler doesn't need. Mirrors companiesRepository.ts's
// ticker-set loader, which hits the same constraint.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface CompanyAliasEntry {
  ticker: string
  name: string
  legalName?: string
  shortName: string
}

const companiesJsonPath = fileURLToPath(new URL('../../data/companies.json', import.meta.url))
const companies = JSON.parse(readFileSync(companiesJsonPath, 'utf8')) as CompanyAliasEntry[]

/** Aliases too generic or ambiguous to trust even though they appear in the static data. */
const ALIAS_DENYLIST = new Set(['Chile']) // "Chile" alone is a country name, not a company reference.

/** Tickers unsafe to match as a bare uppercase token (collide with common words/abbreviations). */
const BARE_TICKER_DENYLIST = new Set(['CHILE', 'CAP'])

interface TickerAliasSet {
  ticker: string
  aliases: string[]
  matchBareTicker: boolean
}

function buildAliasSets(): TickerAliasSet[] {
  return companies
    .map(c => {
      const ticker = c.ticker
      const candidates = [c.name, c.legalName, c.shortName].filter((v): v is string => Boolean(v))
      const aliases = [...new Set(candidates)].filter(a => a.length >= 5 && !ALIAS_DENYLIST.has(a))
      return { ticker, aliases, matchBareTicker: !BARE_TICKER_DENYLIST.has(ticker) }
    })
    .filter(s => s.aliases.length > 0 || s.matchBareTicker)
}

const ALIAS_SETS = buildAliasSets()

/** Asset/sector tag keyword dictionary — deliberately narrow, high-confidence phrases only. */
const ASSET_KEYWORDS: { tag: string; patterns: RegExp[] }[] = [
  { tag: 'Copper', patterns: [/\bcobre\b/i] },
  { tag: 'Lithium', patterns: [/\blitio\b/i] },
  { tag: 'USD/CLP', patterns: [/\bd[oó]lar\b/i, /\btipo de cambio\b/i, /\busd\/clp\b/i] },
  { tag: 'TPM', patterns: [/\btpm\b/i, /\btasa de pol[ií]tica monetaria\b/i] },
  { tag: 'CPI', patterns: [/\bipc\b/i, /\binflaci[oó]n\b/i] },
  { tag: 'IMACEC', patterns: [/\bimacec\b/i] },
  { tag: 'GDP', patterns: [/\bpib\b/i, /\bproducto interno bruto\b/i] },
]

const SECTOR_KEYWORDS: { tag: string; patterns: RegExp[] }[] = [
  { tag: 'Banking', patterns: [/\bbanc[oa]s?\b/i, /\bbancario\b/i] },
  { tag: 'Retail', patterns: [/\bretail\b/i, /\bcomercio minorista\b/i] },
  { tag: 'Utilities', patterns: [/\bel[eé]ctric[ao]s?\b/i, /\benerg[ií]a\b/i] },
  { tag: 'Mining / Lithium', patterns: [/\bminer[ií]a\b/i, /\bminero\b/i] },
]

export interface AffectedMapping {
  tickers: string[]
  assets: string[]
  tags: string[]
}

/** Maps free text (headline + summary) to high-confidence tickers/assets/tags. Never guesses. */
export function mapAffectedEntities(text: string): AffectedMapping {
  const tickers = new Set<string>()
  for (const set of ALIAS_SETS) {
    const nameHit = set.aliases.some(alias => text.includes(alias))
    const tickerHit = set.matchBareTicker && new RegExp(`\\b${escapeRegExp(set.ticker)}\\b`).test(text)
    if (nameHit || tickerHit) tickers.add(set.ticker)
  }

  const assets = new Set<string>()
  for (const { tag, patterns } of ASSET_KEYWORDS) {
    if (patterns.some(p => p.test(text))) assets.add(tag)
  }

  const tags = new Set<string>()
  for (const { tag, patterns } of SECTOR_KEYWORDS) {
    if (patterns.some(p => p.test(text))) tags.add(tag)
  }

  return { tickers: [...tickers], assets: [...assets], tags: [...tags] }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
