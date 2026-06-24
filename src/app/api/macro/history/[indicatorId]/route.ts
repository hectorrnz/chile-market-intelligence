// Phase 4A — GET /api/macro/history/[indicatorId]?timeframe=1Y|3Y|5Y|10Y
// Returns normalized chart points + source metadata. Falls back to static
// macroHistory.json when no live series code is mapped. Always returns 200.

import { NextResponse } from 'next/server'
import { resolveMacroHistory } from '@/lib/providers/macroProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseYears(tf: string | null): 1 | 3 | 5 | 10 {
  switch (tf) {
    case '1Y': return 1
    case '3Y': return 3
    case '10Y': return 10
    default: return 5
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ indicatorId: string }> }) {
  const { indicatorId } = await params
  const { searchParams } = new URL(req.url)
  const years = parseYears(searchParams.get('timeframe'))

  try {
    const result = await resolveMacroHistory(indicatorId, years)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      {
        data: [],
        metadata: {
          dataModeRequested: 'static',
          dataModeUsed: 'static',
          liveAvailable: false,
          status: 'static',
          source: 'Static MVP',
          lastUpdated: '',
          fallbackReason: 'Unexpected server error',
        },
      },
      { status: 200 }
    )
  }
}
