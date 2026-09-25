import type { Developer, WorkSchedule } from '../types'

export const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  workDays: [1, 2, 3, 4, 5],
  startTime: '10:00',
  endTime: '19:00',
  dailyHours: 8,
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function getSchedule(dev: Developer): WorkSchedule {
  return dev.workSchedule ?? DEFAULT_WORK_SCHEDULE
}

/**
 * The single tracker timezone: a valid explicit override, else this browser's
 * zone. Validates the override so a bad value (e.g. a half-typed "Asia/") can't
 * throw from Intl and break every consumer (Performance calc, GitLab sync).
 */
export function resolveTrackerTz(override?: string): string {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!override) return browser
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: override })
    return override
  } catch {
    return browser
  }
}

/**
 * Effective productive hours for a developer on a given date:
 *   per-day schedule override → active employment period hours → schedule default.
 * Lets part-time periods scale a developer's available time fairly.
 */
export function effectiveDailyHours(
  dev: Developer,
  dateStr: string,
  scheduleHours: Record<string, Record<string, number>>,
  sched: WorkSchedule,
): number {
  const custom = scheduleHours[dev.id]?.[dateStr]
  if (custom !== undefined) return custom
  const period = dev.periods?.find((p) => dateStr >= p.from && (p.to === null || dateStr <= p.to))
  if (period) return period.hours
  return sched.dailyHours
}

/**
 * Returns UTC milliseconds for midnight (00:00:00) of dateStr in the given IANA timezone.
 * Uses an iterative approach starting from UTC noon, which converges in ≤3 steps
 * and handles DST transitions correctly (unlike the naive noon-offset approximation).
 */
export function tzMidnightUtcMs(dateStr: string, tz: string): number {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })

  const getParts = (utcMs: number) => {
    const parts = fmt.formatToParts(utcMs)
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
    return {
      dateStr: `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`,
      secs: (get('hour') % 24) * 3600 + get('minute') * 60 + get('second'),
    }
  }

  let candidate = Date.UTC(Y!, (M ?? 1) - 1, D!, 12, 0, 0) // start at UTC noon

  for (let i = 0; i < 3; i++) {
    const { dateStr: localDate, secs } = getParts(candidate)
    if (localDate < dateStr) {
      candidate += (86_400 - secs) * 1000
    } else if (localDate > dateStr) {
      candidate -= (86_400 + secs) * 1000
    } else {
      if (secs === 0) break
      candidate -= secs * 1000
    }
  }

  return candidate
}

/** Absolute UTC ms for a wall-clock date+time interpreted in the given timezone. */
export function tzWallClockToUtcMs(dateStr: string, timeStr: string, tz: string): number {
  return tzMidnightUtcMs(dateStr, tz) + timeToMinutes(timeStr || '00:00') * 60_000
}

/** Returns YYYY-MM-DD for a UTC timestamp in the given IANA timezone. */
export function tzDateStr(utcMs: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(utcMs)
}

/** Returns "dd.mm.yyyy HH:MM" for a UTC timestamp in the given timezone. */
export function tzDateTimeLabel(utcMs: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(utcMs)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`
}

/** Returns day-of-week (0=Sun…6=Sat) for a UTC timestamp in the given IANA timezone. */
export function tzDow(utcMs: number, tz: string): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(utcMs)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Calculate working hours between two ISO timestamps for a specific developer.
 *
 * Rules:
 * - Only counts time inside the developer's work window (startTime–endTime),
 *   evaluated in the supplied timezone (the single tracker timezone).
 * - Skips non-work days, vacation/sick/holiday/day-off entries.
 * - Scales each day by effectiveDailyHours/windowDuration so part-time and
 *   custom-hour days count proportionally.
 */
export function calcWorkingHours(
  startIso: string,
  endIso: string,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
  tzOverride?: string,
): number {
  const sched = getSchedule(dev)
  const tz = resolveTrackerTz(tzOverride ?? sched.timezone)
  const startMs = new Date(startIso).getTime()
  const endMs = new Date(endIso).getTime()
  if (!(endMs > startMs)) return 0

  const winStartMin = timeToMinutes(sched.startTime)
  const winEndMin = timeToMinutes(sched.endTime)
  const winDurationH = (winEndMin - winStartMin) / 60
  if (winDurationH <= 0) return 0

  let total = 0
  const startDateStr = tzDateStr(startMs, tz)
  const endDateStr = tzDateStr(endMs, tz)
  const [sy, sm, sd] = startDateStr.split('-').map(Number)
  const [ey, em, ed] = endDateStr.split('-').map(Number)
  const cursorUtc = new Date(Date.UTC(sy!, (sm ?? 1) - 1, sd!))
  const endUtc = new Date(Date.UTC(ey!, (em ?? 1) - 1, ed!))

  while (cursorUtc <= endUtc) {
    const dateStr = `${cursorUtc.getUTCFullYear()}-${pad2(cursorUtc.getUTCMonth() + 1)}-${pad2(cursorUtc.getUTCDate())}`
    const midnightMs = tzMidnightUtcMs(dateStr, tz)
    const dow = tzDow(midnightMs + 12 * 3_600_000, tz)

    if (sched.workDays.includes(dow)) {
      const dayOff = schedule[dev.id]?.[dateStr]
      if (!dayOff || dayOff === 'work') {
        const dayWinStartMs = midnightMs + winStartMin * 60_000
        const dayWinEndMs = midnightMs + winEndMin * 60_000
        const overlapStart = Math.max(startMs, dayWinStartMs)
        const overlapEnd = Math.min(endMs, dayWinEndMs)
        if (overlapEnd > overlapStart) {
          const rawHours = (overlapEnd - overlapStart) / 3_600_000
          total += rawHours * (effectiveDailyHours(dev, dateStr, scheduleHours, sched) / winDurationH)
        }
      }
    }

    cursorUtc.setUTCDate(cursorUtc.getUTCDate() + 1)
  }

  return total
}

export function fmtWorkHours(hours: number): string {
  if (hours < 0.5) return Math.round(hours * 60) + 'm'
  if (hours < 8) return (Math.round(hours * 10) / 10) + 'h'
  return (hours / 8).toFixed(1) + 'd'
}
