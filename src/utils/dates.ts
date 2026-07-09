import { AM_HOLIDAYS } from '../constants'

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayStr(): string {
  return localDate(new Date())
}

export function offsetDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return localDate(d)
}

export function isAmHoliday(dateStr: string): string | null {
  const mmdd = dateStr.slice(5)
  return AM_HOLIDAYS[mmdd] ?? null
}

export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

export function nextWorkDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  do {
    d.setDate(d.getDate() + 1)
  } while (d.getDay() === 0 || d.getDay() === 6 || isAmHoliday(localDate(d)))
  return localDate(d)
}

export function prevWorkDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  do {
    d.setDate(d.getDate() - 1)
  } while (d.getDay() === 0 || d.getDay() === 6 || isAmHoliday(localDate(d)))
  return localDate(d)
}

export interface DlInfo {
  cls: 'dl-none' | 'dl-over' | 'dl-warn' | 'dl-ok'
  text: string
  diff: number
}

/** Count Mon–Fri days from `from` to `to`, both inclusive. */
function workdays(from: string, to: string): number {
  const f = new Date(from + 'T12:00:00')
  const t = new Date(to + 'T12:00:00')
  if (f.getTime() > t.getTime()) return 0
  let count = 0
  const d = new Date(f)
  while (d <= t) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) count++
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
  const label = new Date(deadline + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  const ts = time ? ' at ' + time : ''
  let text: string
  if (diff === 0) text = 'Today' + ts
  else if (diff === 1) text = 'Tomorrow' + ts
  else if (diff === -1) text = 'Yesterday' + ts
  else if (diff < 0) {
    const wd = workdays(deadline, today)
    text = label + ' (' + wd + 'd ago)'
  } else {
    const wd = workdays(today, deadline)
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

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export function padDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
