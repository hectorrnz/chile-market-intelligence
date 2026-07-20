// FX Integrity Task — GET /api/macro/fx/us
//
// Public, read-only. Serves the Macro / US forex table from Frankfurter (free,
// no API key, real 1D/YTD change), cached server-side (see
// frankfurterFxProvider.ts). Never returns a raw provider payload — only the
// sanitized, derived row list. Chile FX is untouched (BCCh-only, served
// elsewhere via the macro indicators API). The prior unofficial third-party
// provider is no longer used by this route (see docs/macro_market_source_coverage.md §14).

import { NextResponse } from 'next/server'
import { resolveUsForexTable } from '@/lib/providers/frankfurterFxProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    // ?force=1 comes only from an explicit Update Data click — see
    // resolveUsForexTable's note on why the 6h cache must be bypassed there.
    const force = new URL(req.url).searchParams.get('force') === '1'
    const result = await resolveUsForexTable({ force })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        source: 'Frankfurter FX reference',
        sourceType: 'free_third_party_fx_reference',
        base: 'USD',
        providerAttribution: null,
        currentDate: null,
        previousDate: null,
        ytdBaseDate: null,
        rows: [],
        reason: 'Internal error',
      },
      { status: 200 },
    )
  }
}
