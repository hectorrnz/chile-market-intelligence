// GET /api/earnings/calendar
// Serves the committed CMF earnings-calendar snapshot
// (src/data/earningsCalendar.json), refreshed daily by a GitHub Action
// (scripts/refresh/refreshEarningsCalendar.ts).
//
// Why a committed snapshot rather than a live fetch: CMF's site (cmfchile.cl)
// blocks Vercel's datacenter IPs — verified live, the request fast-fails from
// production while Yahoo and the Atlanta Fed both succeed there — so the app
// cannot fetch it at request time. The Action runs from GitHub's network (and
// local dev runs from Chile), both of which CAN reach CMF, and commits the
// snapshot; a commit triggers a Vercel redeploy, so "updates automatically".
//
// Events carry ABSOLUTE report dates; the Home page computes the "within 7 days"
// window live at render time (upcomingWithinDays), so the snapshot stays correct
// between refreshes. Serving the JSON is instant and always available.

import { NextResponse } from 'next/server'
import earningsData from '@/data/earningsCalendar.json'
import type { EarningsCalendarResult } from '@/lib/providers/earnings/earningsCalendarProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(earningsData as EarningsCalendarResult)
}
