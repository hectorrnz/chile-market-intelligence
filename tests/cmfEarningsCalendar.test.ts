import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCmfDate,
  parseCmfEarningsTable,
} from '../src/lib/providers/earnings/cmfEarningsClient.ts'
import {
  buildEarningsEvents,
  upcomingEvents,
} from '../src/lib/providers/earnings/earningsCalendarProvider.ts'
import {
  CMF_EARNINGS_CALENDAR_MAP,
  RUT_TO_TICKER,
  UNLISTED_EARNINGS_TICKERS,
} from '../src/config/cmfEarningsCalendarMap.ts'
import { recentlyReported } from '../src/lib/data/earningsCalendar.ts'

describe('CMF earnings calendar — date parsing', () => {
  test('DD/MM/YYYY → YYYY-MM-DD', () => {
    assert.equal(parseCmfDate('24/07/2026'), '2026-07-24')
    assert.equal(parseCmfDate('28/01/2027'), '2027-01-28')
  })
  test('dash / blank / invalid → null (never fabricated)', () => {
    assert.equal(parseCmfDate('-'), null)
    assert.equal(parseCmfDate(''), null)
    assert.equal(parseCmfDate('99/99/2026'), null)
    assert.equal(parseCmfDate('2026-07-24'), null) // wrong format
  })
})

describe('CMF earnings calendar — table parsing', () => {
  const html = `
    <table><thead><tr><th>Razón Social</th><th>RUT</th><th>Intermedio (Marzo)</th><th>Intermedio (Junio)</th><th>Intermedio (Septiembre)</th><th>Anual (Diciembre)</th></tr></thead>
    <tbody>
      <tr><td>BANCO DE CHILE &nbsp;</td><td>97004000-5 &nbsp;</td><td>30/04/2026 &nbsp;</td><td>31/07/2026 &nbsp;</td><td>29/10/2026 &nbsp;</td><td>- &nbsp;</td></tr>
      <tr><td>SONDA S.A. &nbsp;</td><td>83628100-4 &nbsp;</td><td>24/04/2026 &nbsp;</td><td>24/07/2026 &nbsp;</td><td>- &nbsp;</td><td>- &nbsp;</td></tr>
      <tr><td>garbage row</td><td>not-a-rut</td><td>x</td><td>y</td><td>z</td><td>w</td></tr>
    </tbody></table>`

  test('parses valid rows and skips garbage', () => {
    const rows = parseCmfEarningsTable(html)
    assert.equal(rows.length, 2)
    const chile = rows.find((r) => r.rutPrefix === '97004000')!
    assert.ok(chile)
    assert.equal(chile.rut, '97004000-5')
    assert.equal(chile.q1Mar, '2026-04-30')
    assert.equal(chile.q2Jun, '2026-07-31')
    assert.equal(chile.q3Sep, '2026-10-29')
    assert.equal(chile.annualDec, null)
  })

  test('returns [] when no tbody present (unavailable, not fabricated)', () => {
    assert.deepEqual(parseCmfEarningsTable('<html><body>no table</body></html>'), [])
  })
})

describe('CMF earnings calendar — event building', () => {
  const rows = parseCmfEarningsTable(`
    <tbody>
      <tr><td>SONDA S.A.</td><td>83628100-4</td><td>-</td><td>24/07/2026</td><td>-</td><td>-</td></tr>
      <tr><td>BANCO DE CHILE</td><td>97004000-5</td><td>-</td><td>31/07/2026</td><td>-</td><td>-</td></tr>
      <tr><td>UNKNOWN CO</td><td>11111111-1</td><td>01/06/2026</td><td>-</td><td>-</td><td>-</td></tr>
    </tbody>`)

  test('maps only tracked tickers, sorted ascending, deduped', () => {
    const events = buildEarningsEvents(rows)
    // UNKNOWN CO (11111111) is not in the app universe → excluded.
    assert.equal(events.length, 2)
    assert.deepEqual(events.map((e) => e.ticker), ['SONDA', 'CHILE'])
    assert.equal(events[0].reportDate, '2026-07-24')
    assert.equal(events[0].period, 'Q2')
  })

  test('deduplicates identical (ticker, date) across duplicate rows', () => {
    const dup = [...rows, ...rows]
    assert.equal(buildEarningsEvents(dup).length, 2)
  })

  test('upcomingEvents filters to the [today, today+days] window', () => {
    const events = buildEarningsEvents(rows)
    const near = upcomingEvents(events, new Date('2026-07-20T12:00:00Z'), 7)
    assert.equal(near.length, 1)
    assert.equal(near[0].ticker, 'SONDA') // 07-24 is within 7 days; 07-31 is not
  })
})

describe('CMF earnings calendar — RUT map integrity', () => {
  test('23 covered tickers have a verified RUT', () => {
    assert.equal(Object.keys(RUT_TO_TICKER).length, 23)
  })
  test('bank RUTs read from CMF are correct', () => {
    assert.equal(CMF_EARNINGS_CALENDAR_MAP.CHILE.rut, '97004000')
    assert.equal(CMF_EARNINGS_CALENDAR_MAP.BCI.rut, '97006000')
    assert.equal(CMF_EARNINGS_CALENDAR_MAP['SQM-B'].rut, '93007000')
  })
  test('Santander & Itaú are documented as absent (honest gap, never fabricated)', () => {
    assert.equal(CMF_EARNINGS_CALENDAR_MAP.BSANTANDER.rut, null)
    assert.equal(CMF_EARNINGS_CALENDAR_MAP.ITAUCL.rut, null)
    assert.deepEqual(UNLISTED_EARNINGS_TICKERS.sort(), ['BSANTANDER', 'ITAUCL'])
  })
  test('all 25 tickers are accounted for (23 mapped + 2 unlisted)', () => {
    assert.equal(Object.keys(CMF_EARNINGS_CALENDAR_MAP).length, 25)
  })
})

describe('CMF earnings calendar — recentlyReported (Home real recent results)', () => {
  const events = [
    { ticker: 'SONDA', reportDate: '2026-07-24', period: 'Q2' as const },
    { ticker: 'SQM-B', reportDate: '2026-05-26', period: 'Q1' as const },
    { ticker: 'CAP',   reportDate: '2026-05-08', period: 'Q1' as const },
    { ticker: 'CCU',   reportDate: '2026-05-07', period: 'Q1' as const },
  ]

  test('returns the N most recent PAST report dates, most-recent first', () => {
    const now = new Date('2026-07-21T12:00:00Z')
    const recent = recentlyReported(events, 2, now)
    assert.deepEqual(recent.map((e) => e.ticker), ['SQM-B', 'CAP'])
  })

  test('excludes future dates (never shows a not-yet-reported company as reported)', () => {
    const now = new Date('2026-07-21T12:00:00Z')
    const recent = recentlyReported(events, 5, now)
    assert.ok(recent.every((e) => e.reportDate < '2026-07-21'))
    assert.ok(!recent.some((e) => e.ticker === 'SONDA'))
  })

  test('empty when no past events (no fabricated fallback)', () => {
    const now = new Date('2026-01-01T12:00:00Z')
    assert.deepEqual(recentlyReported(events, 5, now), [])
  })
})
