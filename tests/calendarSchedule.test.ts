// Regression tests for the synthetic schedule-driven calendar
// (src/lib/data/calendar.ts). Caught via real user report: the FOMC and US
// CPI rules used a fixed day-of-month with no weekend guard, so in some
// months they landed on a Saturday/Sunday — economic releases never publish
// on weekends. Also verifies the corrected FOMC/CPI day values.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getCalendarForWeek, weekStartOf, addDays } from '../src/lib/data/calendar.ts'

describe('synthetic calendar — no event ever falls on a weekend', () => {
  it('across 3 years of weekly windows, every generated event lands on Mon-Fri', () => {
    const start = weekStartOf(new Date(Date.UTC(2025, 0, 1)))
    for (let i = 0; i < 156; i++) { // ~3 years of weeks
      const weekStart = addDays(start, i * 7)
      const events = getCalendarForWeek(weekStart)
      for (const e of events) {
        const wd = new Date(`${e.date}T00:00:00Z`).getUTCDay()
        assert.ok(wd >= 1 && wd <= 5, `${e.name} on ${e.date} falls on a weekend (day ${wd})`)
      }
    }
  })
})

describe('synthetic calendar — corrected FOMC/CPI dates (regression for a real user-reported bug)', () => {
  it('July 2026 FOMC Rate Decision falls on the 29th (not the 18th, which is a Saturday)', () => {
    const events = getCalendarForWeek(weekStartOf(new Date(Date.UTC(2026, 6, 27))), e => e.name === 'FOMC Rate Decision' && e.country === 'US')
    assert.equal(events.length, 1)
    assert.equal(events[0].date, '2026-07-29')
  })
  it('July 2026 CPI releases fall on the 14th (not the 12th, which is a Sunday)', () => {
    const events = getCalendarForWeek(weekStartOf(new Date(Date.UTC(2026, 6, 13))), e => e.category === 'Inflation' && e.country === 'US')
    const dates = new Set(events.map(e => e.date))
    assert.ok(dates.has('2026-07-14'))
  })
})
