// Schedule-driven economic calendar. Events are generated deterministically
// from recurring release rules, so any week (past or future) always has data.
// Static MVP sample — values are synthetic; replace with BCCh/BLS/Fed feeds in Phase 4.

export interface CalEvent {
  id: string
  date: string      // YYYY-MM-DD
  time: string      // HH:MM
  country: 'CL' | 'US'
  name: string
  category: string
  importance: 'High' | 'Medium' | 'Low'
  unit: string
  prior: number | null
  forecast: number | null
  actual: number | null
}

type Occ = (y: number, m: number) => number[] // days-of-month (1-based)

interface Sched {
  key: string
  country: 'CL' | 'US'
  name: string
  category: string
  importance: 'High' | 'Medium' | 'Low'
  unit: string
  time: string
  base: number
  vol: number
  dp: number
  occ: Occ
}

function daysInMonth(y: number, m: number) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate() }
function clampDay(y: number, m: number, d: number) { return Math.min(d, daysInMonth(y, m)) }
function nthWeekday(y: number, m: number, n: number, wd: number): number[] {
  const firstWd = new Date(Date.UTC(y, m, 1)).getUTCDay()
  const day = 1 + ((wd - firstWd + 7) % 7) + (n - 1) * 7
  return day <= daysInMonth(y, m) ? [day] : []
}
function everyWeekday(y: number, m: number, wd: number): number[] {
  const out: number[] = []
  const dim = daysInMonth(y, m)
  for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === wd) out.push(d)
  return out
}
const monthlyDay = (d: number): Occ => (y, m) => [clampDay(y, m, d)]
const inMonths = (months: number[], inner: Occ): Occ => (y, m) => (months.includes(m) ? inner(y, m) : [])

const SCHED: Sched[] = [
  // ── United States ──
  { key: 'us-cpi-yoy', country: 'US', name: 'CPI y/y', category: 'Inflation', importance: 'High', unit: '%', time: '08:30', base: 3.4, vol: 0.3, dp: 1, occ: monthlyDay(12) },
  { key: 'us-cpi-mom', country: 'US', name: 'CPI m/m', category: 'Inflation', importance: 'High', unit: '%', time: '08:30', base: 0.3, vol: 0.2, dp: 1, occ: monthlyDay(12) },
  { key: 'us-nfp', country: 'US', name: 'Nonfarm Payrolls', category: 'Labor', importance: 'High', unit: 'K', time: '08:30', base: 180, vol: 60, dp: 0, occ: (y, m) => nthWeekday(y, m, 1, 5) },
  { key: 'us-unemp', country: 'US', name: 'Unemployment Rate', category: 'Labor', importance: 'High', unit: '%', time: '08:30', base: 3.9, vol: 0.1, dp: 1, occ: (y, m) => nthWeekday(y, m, 1, 5) },
  { key: 'us-fomc', country: 'US', name: 'FOMC Rate Decision', category: 'Rates', importance: 'High', unit: '%', time: '14:00', base: 4.5, vol: 0, dp: 2, occ: inMonths([0, 2, 4, 5, 6, 8, 10, 11], monthlyDay(18)) },
  { key: 'us-retail', country: 'US', name: 'Retail Sales m/m', category: 'Activity', importance: 'Medium', unit: '%', time: '08:30', base: 0.4, vol: 0.4, dp: 1, occ: monthlyDay(15) },
  { key: 'us-gdp', country: 'US', name: 'GDP q/q (ann.)', category: 'Activity', importance: 'High', unit: '%', time: '08:30', base: 2.5, vol: 0.5, dp: 1, occ: inMonths([0, 3, 6, 9], monthlyDay(28)) },
  { key: 'us-pce', country: 'US', name: 'Core PCE y/y', category: 'Inflation', importance: 'Medium', unit: '%', time: '08:30', base: 2.8, vol: 0.2, dp: 1, occ: monthlyDay(28) },
  { key: 'us-ism', country: 'US', name: 'ISM Manufacturing PMI', category: 'Activity', importance: 'Medium', unit: '', time: '10:00', base: 49.5, vol: 1.5, dp: 1, occ: monthlyDay(1) },
  { key: 'us-claims', country: 'US', name: 'Initial Jobless Claims', category: 'Labor', importance: 'Low', unit: 'K', time: '08:30', base: 230, vol: 15, dp: 0, occ: (y, m) => everyWeekday(y, m, 4) },
  // ── Chile ──
  { key: 'cl-ipc-mom', country: 'CL', name: 'IPC m/m', category: 'Inflation', importance: 'High', unit: '%', time: '08:00', base: 0.3, vol: 0.2, dp: 1, occ: monthlyDay(8) },
  { key: 'cl-ipc-yoy', country: 'CL', name: 'IPC y/y', category: 'Inflation', importance: 'High', unit: '%', time: '08:00', base: 4.1, vol: 0.2, dp: 1, occ: monthlyDay(8) },
  { key: 'cl-tpm', country: 'CL', name: 'TPM Rate Decision (BCCh)', category: 'Rates', importance: 'High', unit: '%', time: '18:00', base: 5.0, vol: 0, dp: 2, occ: inMonths([0, 2, 4, 5, 7, 8, 9, 11], monthlyDay(17)) },
  { key: 'cl-imacec', country: 'CL', name: 'IMACEC y/y', category: 'Activity', importance: 'High', unit: '%', time: '08:30', base: 2.8, vol: 0.4, dp: 1, occ: monthlyDay(5) },
  { key: 'cl-unemp', country: 'CL', name: 'Unemployment Rate (INE)', category: 'Labor', importance: 'Medium', unit: '%', time: '08:00', base: 8.7, vol: 0.2, dp: 1, occ: monthlyDay(28) },
  { key: 'cl-gdp', country: 'CL', name: 'GDP (PIB) q/q', category: 'Activity', importance: 'High', unit: '%', time: '08:30', base: 2.3, vol: 0.5, dp: 1, occ: inMonths([2, 5, 8, 11], monthlyDay(18)) },
  { key: 'cl-trade', country: 'CL', name: 'Trade Balance', category: 'Activity', importance: 'Medium', unit: 'USD bn', time: '09:00', base: 1.2, vol: 0.6, dp: 1, occ: monthlyDay(7) },
]

function mulberry32(seed: number) {
  let a = seed
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
const r = (n: number, dp: number) => { const f = 10 ** dp; return Math.round(n * f) / f }
export function pad(n: number) { return String(n).padStart(2, '0') }
export function dateStr(d: Date) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }
export function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x }

/** Monday of the week containing `d`. */
export function weekStartOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const wd = x.getUTCDay() // 0 Sun..6 Sat
  return addDays(x, wd === 0 ? -6 : 1 - wd)
}
export function todayUTC(): Date { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) }

function makeEvent(s: Sched, date: Date): CalEvent {
  const ds = dateStr(date)
  const isPast = ds < dateStr(todayUTC())
  const rng = mulberry32(hash(s.key + ds))
  const forecast = r(s.base + s.vol * (rng() - 0.5), s.dp)
  const prior = r(s.base + s.vol * (rng() - 0.5), s.dp)
  const actual = isPast ? r(forecast + s.vol * 0.7 * (rng() - 0.5), s.dp) : null
  return { id: `${s.key}-${ds}`, date: ds, time: s.time, country: s.country, name: s.name, category: s.category, importance: s.importance, unit: s.unit, prior, forecast, actual }
}

function eventsInRange(from: Date, to: Date, filter?: (e: CalEvent) => boolean): CalEvent[] {
  const out: CalEvent[] = []
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), dom = d.getUTCDate()
    for (const s of SCHED) {
      if (s.occ(y, m).includes(dom)) {
        const e = makeEvent(s, d)
        if (!filter || filter(e)) out.push(e)
      }
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
}

export function getCalendarForWeek(weekStart: Date, filter?: (e: CalEvent) => boolean): CalEvent[] {
  return eventsInRange(weekStart, addDays(weekStart, 6), filter)
}
export function getEventsForDay(date: Date, filter?: (e: CalEvent) => boolean): CalEvent[] {
  return eventsInRange(date, date, filter)
}
export function searchUpcoming(query: string, from: Date, weeks = 8): CalEvent[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return eventsInRange(from, addDays(from, weeks * 7), e => `${e.name} ${e.category} ${e.country}`.toLowerCase().includes(q))
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function weekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6)
  const a = `${MON[weekStart.getUTCMonth()]} ${weekStart.getUTCDate()}`
  const b = weekStart.getUTCMonth() === end.getUTCMonth() ? `${end.getUTCDate()}` : `${MON[end.getUTCMonth()]} ${end.getUTCDate()}`
  return `${a} — ${b}`
}
export function dayLabel(ds: string): string {
  const d = new Date(`${ds}T00:00:00Z`)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`
}
