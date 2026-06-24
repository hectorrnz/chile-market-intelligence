// Phase 4A — GET /api/macro
// Returns normalized macro indicators + source metadata, honoring DATA_MODE.
// Always returns 200 with a usable (static-fallback) payload so the UI never
// breaks. Never exposes credentials or raw provider errors.

import { NextResponse } from 'next/server'
import { resolveMacroIndicators } from '@/lib/providers/macroProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const regionParam = searchParams.get('region')
  const region = regionParam === 'CL' || regionParam === 'US' ? regionParam : undefined

  try {
    const result = await resolveMacroIndicators(region)
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
