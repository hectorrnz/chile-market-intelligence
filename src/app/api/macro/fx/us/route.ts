// FX Data Task — GET /api/macro/fx/us
//
// Public, read-only. Serves the Macro / US forex table from CurrencyFreaks
// (unofficial third-party), cached server-side (see currencyFreaksFxProvider.ts).
// Never returns the CURRENCYFREAKS_API_KEY or any raw provider payload — only
// the sanitized, derived row list. Chile FX is untouched (BCCh-only, served
// elsewhere via the macro indicators API).

import { NextResponse } from 'next/server'
import { resolveUsForexTable } from '@/lib/providers/currencyFreaksFxProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const result = await resolveUsForexTable()
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        source: 'CurrencyFreaks',
        sourceType: 'unofficial_third_party_fx',
        base: 'USD',
        asOf: null,
        rows: [],
        reason: 'Internal error',
      },
      { status: 200 },
    )
  }
}
