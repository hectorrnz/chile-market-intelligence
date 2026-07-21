// Refreshes the committed CMF earnings-calendar snapshot.
//
// CMF's site (cmfchile.cl) blocks Vercel's datacenter IPs, so the app can't
// fetch it at request time in production. Instead this script — run by a
// scheduled GitHub Action (and manually in local dev) from a network that CAN
// reach CMF — fetches + parses the calendar and writes it to
// src/data/earningsCalendar.json, which the /api/earnings/calendar route serves
// instantly. Same pattern as scripts/refresh/refreshMarketData.py for market
// data. "Updates automatically" = the daily Action commits a fresh snapshot,
// which triggers a Vercel redeploy.
//
// Refuses to overwrite the existing snapshot with an empty/failed result, so a
// transient CMF outage never blanks out the committed data.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveEarningsCalendar } from '../../src/lib/providers/earnings/earningsCalendarProvider.ts'

const OUT = fileURLToPath(new URL('../../src/data/earningsCalendar.json', import.meta.url))

const result = await resolveEarningsCalendar()

if (result.status !== 'live' || result.events.length === 0) {
  console.error(`CMF earnings calendar fetch failed or empty (status=${result.status}, events=${result.events.length}). Leaving the existing snapshot untouched.`)
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(`Wrote ${result.events.length} events (${result.missingTickers.length} unlisted tickers) to src/data/earningsCalendar.json`)
