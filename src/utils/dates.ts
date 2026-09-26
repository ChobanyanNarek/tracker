import { AM_HOLIDAYS } from '../constants'

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayStr(): string {
  return localDate(new Date())
}

export function isAmHoliday(dateStr: string): string | null {
  const mmdd = dateStr.slice(5)
  return AM_HOLIDAYS[mmdd] ?? null
}

export function isWeekend(dateStr: string, nonWorkingDays: number[] = [0, 6]): boolean {
  const d = new Date(dateStr + 'T12:00:00')
  return nonWorkingDays.includes(d.getDay())
}

export function nextWorkDay(dateStr: string, nonWorkingDays: number[] = [0, 6]): string {
  const d = new Date(dateStr + 'T12:00:00')
  do {
    d.setDate(d.getDate() + 1)
  } while (nonWorkingDays.includes(d.getDay()) || isAmHoliday(localDate(d)))
  return localDate(d)
}

export function prevWorkDay(dateStr: string, nonWorkingDays: number[] = [0, 6]): string {
  const d = new Date(dateStr + 'T12:00:00')
  do {
    d.setDate(d.getDate() - 1)
  } while (nonWorkingDays.includes(d.getDay()) || isAmHoliday(localDate(d)))
  return localDate(d)
}

export interface DlInfo {
  cls: 'dl-none' | 'dl-over' | 'dl-warn' | 'dl-ok'
  text: string
  diff: number
}

/*
 * Working days strictly after `from`, up to and including `to` — i.e. how many working
 * days there are between the two. It used to count both ends, so a deadline two days out
 * was reported as "3d left" (and two days overdue as "3d ago"). Holidays are skipped here
 * for the same reason nextWorkDay skips them: nobody works through them.
 */
function workdaysBetween(from: string, to: string): number {
  const t = new Date(to + 'T12:00:00')
  const d = new Date(from + 'T12:00:00')
  if (d.getTime() > t.getTime()) return 0
  let count = 0
  d.setDate(d.getDate() + 1)
  while (d <= t) {
    const day = d.getDay()
    if (day !== 0 && day !== 6 && !isAmHoliday(isoDate(d))) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

export function dlInfo(deadline: string, time?: string): DlInfo {
  if (!deadline) return { cls: 'dl-none', text: '—', diff: 999 }
  const today = todayStr()
  const diff = Math.round(
    (new Date(deadline + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) /
      86_400_000,
  )
  const label = formatDate(deadline)
  const ts = time ? ' at ' + time : ''
  let text: string
  if (diff === 0) text = 'Today' + ts
  else if (diff === 1) text = 'Tomorrow' + ts
  else if (diff === -1) text = 'Yesterday' + ts
  else if (diff < 0) {
    const wd = workdaysBetween(deadline, today)
    text = label + ' (' + wd + 'd ago)'
  } else {
    const wd = workdaysBetween(today, deadline)
    text = label + ' (' + wd + 'd left' + ts + ')'
  }
  return { cls: diff < 0 ? 'dl-over' : diff <= 2 ? 'dl-warn' : 'dl-ok', text, diff }
}

/** Returns today if it is a workday; otherwise the nearest previous workday. */
export function latestWorkday(): string {
  const today = todayStr()
  if (!isWeekend(today) && !isAmHoliday(today)) return today
  return prevWorkDay(today)
}

/** Format a date as dd.mm.yyyy */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

/** Format a Date or timestamp as dd.mm.yyyy HH:MM */
export function formatDateTime(value: Date | number | string): string {
  const d = value instanceof Date ? value : new Date(value)
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${date} ${time}`
}

/** Format a Date object as dd.mm.yyyy */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export function padDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** A Date as the local YYYY-MM-DD. `toISOString().slice(0,10)` is UTC and gets this wrong. */
export function isoDate(d: Date): string {
  return padDate(d.getFullYear(), d.getMonth(), d.getDate())
}
