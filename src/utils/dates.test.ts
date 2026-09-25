import { afterEach, describe, expect, it, vi } from 'vitest'
import { latestWorkday, nextWorkDay, prevWorkDay, todayStr } from './dates'

/*
 * "Today" must be the user's own calendar day. Several screens used
 * `new Date().toISOString().slice(0, 10)`, which is UTC: east of Greenwich that is
 * yesterday from midnight until the zone's offset, so the sprint band, the active sprint
 * and the date picker all pointed at the wrong day every morning.
 */

afterEach(() => {
  vi.useRealTimers()
})

// 00:30 in Yerevan (UTC+4) on 25 Sep is still 20:30 UTC on 24 Sep.
const justAfterMidnightInYerevan = new Date('2026-09-24T20:30:00Z')

describe('todayStr', () => {
  it('is the local day, not the UTC one, just after midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(justAfterMidnightInYerevan)

    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-24') // what the bug used
    expect(todayStr()).toBe(new Intl.DateTimeFormat('en-CA').format(new Date()))
  })
})

describe('workday helpers', () => {
  it('skips weekends', () => {
    expect(nextWorkDay('2026-09-25')).toBe('2026-09-28') // Fri → Mon
    expect(prevWorkDay('2026-09-28')).toBe('2026-09-25') // Mon → Fri
  })

  it('skips Armenian public holidays', () => {
    // 1 Jan is a holiday, and so are the days after it.
    expect(nextWorkDay('2026-12-31')).toBe('2027-01-08')
  })

  it('latestWorkday returns today on a workday and the previous one at a weekend', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z')) // Friday
    expect(latestWorkday()).toBe(todayStr())

    vi.setSystemTime(new Date('2026-09-26T12:00:00Z')) // Saturday
    expect(latestWorkday()).toBe('2026-09-25')
  })
})
