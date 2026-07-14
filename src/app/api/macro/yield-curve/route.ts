// GET /api/macro/yield-curve?region=CL|US
//
// Public, read-only. Serves the Macro page's live fixed-income yield curve
// (today / 1 week ago / prior year-end), built from already-verified BCCh
// (Chile) and FRED (US) series — see yieldCurveProvider.ts. Never returns a
// raw provider payload. On any failure or an unrecognized region, returns
// `ok:false` — the caller (macro/page.tsx) falls back to the static curve.

import { NextResponse } from 'next/server'
import { resolveLiveYieldCurve } from '@/lib/providers/yieldCurveProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const region = searchParams.get('region')
  if (region !== 'CL' && region !== 'US') {
    return NextResponse.json({ ok: false, tenors: [], today: [], weekAgo: [], yearEnd: [], todayDate: null, weekAgoDate: null, yearEndDate: null, source: '', reason: 'Invalid or missing region' }, { status: 200 })
  }

  try {
    const result = await resolveLiveYieldCurve(region)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      { ok: false, tenors: [], today: [], weekAgo: [], yearEnd: [], todayDate: null, weekAgoDate: null, yearEndDate: null, source: '', reason: 'Internal error' },
      { status: 200 },
    )
  }
}
