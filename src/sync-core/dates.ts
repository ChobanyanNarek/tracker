/*
 * Calendar rules the sync needs, independent of where it runs. The browser's own clock and
 * zone are not assumed: the server runs in UTC, so "today" is always worked out for the
 * tracker's timezone and passed in.
 */

export const AM_HOLIDAYS: Record<string, string> = {
  '01-01': "New Year's Day",
  '01-02': 'New Year Holiday',
  '01-03': 'New Year Holiday',
  '01-04': 'New Year Holiday',
  '01-05': 'New Year Holiday',
  '01-06': 'Christmas Day',
  '01-07': 'Christmas Holiday',
  '01-13': 'Army Day',
  '02-21': 'Mother Language Day',
  '04-07': 'Motherhood & Beauty Day',
  '04-24': 'Genocide Remembrance Day',
  '05-01': 'Labour Day',
  '05-08': 'Yerkrapah Day',
  '05-09': 'Victory & Peace Day',
  '05-28': 'Republic Day',
  '07-05': 'Constitution Day',
  '09-21': 'Independence Day',
  '12-07': 'Earthquake Remembrance Day',
  '12-31': "New Year's Eve",
}

function isNonWorking(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6 || AM_HOLIDAYS[dateStr.slice(5)] !== undefined
}

function shift(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// The calendar date (YYYY-MM-DD) at `now` in `tz`.
export function dateInZone(now: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}`
}

// `dateStr` if it is a workday, otherwise the nearest earlier workday.
export function latestWorkdayOn(dateStr: string): string {
  let d = dateStr
  while (isNonWorking(d)) d = shift(d, -1)
  return d
}

// A usable IANA zone: `preferred` if valid, else `fallback`.
export function validZone(preferred: string | undefined, fallback: string): string {
  if (!preferred) return fallback
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: preferred })
    return preferred
  } catch {
    return fallback
  }
}

// Wall-clock date and HH:MM of an instant in `tz`.
// One formatter per zone: building one per PR was a measurable share of a sync.
const partsFormatters = new Map<string, Intl.DateTimeFormat>()

export function localParts(d: Date, tz: string): { date: string; time: string } {
  let formatter = partsFormatters.get(tz)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    partsFormatters.set(tz, formatter)
  }
  const parts = formatter.formatToParts(d)
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` }
}
