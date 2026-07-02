// Phase 6C — GET /api/portfolios  List current user's portfolios (auto-creates default).
//           — POST /api/portfolios Create a named portfolio.
// Middleware enforces auth: unauthenticated requests never reach this handler.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  getUserPortfolios,
  ensureDefaultPortfolio,
  createPortfolio,
} from '@/lib/db/repositories/portfolioRepository'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const portfolios = await getUserPortfolios(client)

  if (portfolios.length === 0) {
    const created = await ensureDefaultPortfolio(client)
    return NextResponse.json({ portfolios: created ? [created] : [] })
  }

  return NextResponse.json({ portfolios })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  let name = 'Default'
  try {
    const body = await request.json()
    if (typeof body.name === 'string' && body.name.trim()) {
      name = body.name.trim().slice(0, 80)
    }
  } catch {
    // name stays as 'Default'
  }

  const created = await createPortfolio(client, name)
  if (!created) {
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ portfolio: created }, { status: 201 })
}
