// Dependency-free RSS 2.0 parser (mirrors the project's existing hand-written
// parser precedent — src/lib/financials/xbrl/parseXbrl.ts, unzip.ts — rather
// than adding a new XML/RSS package). Regex-based, but bounded and
// failure-aware: a malformed or unexpected feed yields zero items rather than
// throwing, so the caller can degrade to 'unavailable' instead of crashing.

export interface RawRssItem {
  title: string
  link: string
  pubDate: string | null
  description: string | null
}

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = re.exec(block)
  if (!m) return null
  return decodeXmlText(m[1])
}

/** Strips CDATA wrappers, decodes common XML/HTML entities, collapses whitespace. */
function decodeXmlText(raw: string): string {
  let text = raw.trim()
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text)
  if (cdata) text = cdata[1]
  text = text
    .replace(/<[^>]+>/g, ' ') // strip any inline HTML tags (e.g. <p> in description)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    // Numeric character references (decimal &#38; and hex &#x26;) — real feeds
    // use these for '&' and accented characters; decode before the named-&amp;
    // pass so a literal "&amp;" is never double-decoded into "&".
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text
}

/**
 * Parses an RSS 2.0 document into raw items. Never throws — a document with
 * no <item> elements (wrong URL, HTML error page, empty feed) returns [].
 */
export function parseRssItems(xml: string): RawRssItem[] {
  if (!xml || typeof xml !== 'string') return []
  const items: RawRssItem[] = []
  let match: RegExpExecArray | null
  ITEM_RE.lastIndex = 0
  while ((match = ITEM_RE.exec(xml)) !== null) {
    const block = match[1]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    if (!title || !link) continue // an item without a title+link is not usable
    items.push({
      title,
      link,
      pubDate: extractTag(block, 'pubDate'),
      description: extractTag(block, 'description'),
    })
  }
  return items
}
