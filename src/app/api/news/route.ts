// News Module — GET /api/news
//
// Public, read-only. Serves source-backed market news (Diario Financiero RSS
// today; see docs/data_source_status.md for the full per-source discovery
// record). Never returns a raw RSS/HTML payload or a provider error string —
// only the normalized NewsItem list plus a sanitized per-source status.
// Server-side cached (see newsProvider.ts) so a burst of page loads never
// hammers the underlying feed.

import { NextResponse } from 'next/server'
import { fetchAllNews } from '@/lib/providers/news/newsProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const result = await fetchAllNews()
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      { status: 'unavailable', data: [], sourceStatuses: [], fetchedAt: new Date().toISOString() },
      { status: 200 },
    )
  }
}
