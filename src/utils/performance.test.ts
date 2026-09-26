import { describe, expect, it } from 'vitest'
import type { Developer, JiraIssue, Task } from '../types'
import { computeTeamPerformance } from './performance'

/*
 * Performance answers "what did each developer deliver, and was it on time". The range
 * picker is the part users touch most, so these pin which issues a range includes.
 */

const TZ = 'Asia/Yerevan' // the tests' own zone is irrelevant: dates are wall-clock here

const dev: Developer = {
  id: 'd1', name: 'Anna', role: 'Frontend', color: '#000',
  periods: [{ type: 'full', hours: 8, from: '2020-01-01', to: null }],
  workSchedule: { workDays: [1, 2, 3, 4, 5], startTime: '10:00', endTime: '19:00', dailyHours: 8, timezone: TZ },
}

function issue(key: string, deadline: string, doneAt: string | null, patch: Partial<JiraIssue> = {}): JiraIssue {
  return {
    issueId: key, url: `https://x.atlassian.net/browse/${key}`, name: key,
    status: doneAt ? 'done' : 'inprogress', priority: 'medium', deadline, deadlineTime: '18:00',
    prs: [], comment: '',
    statusHistory: [
      { status: 'todo', at: '2026-09-01T10:00:00+04:00' },
      { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
      ...(doneAt ? [{ status: 'done' as const, at: doneAt }] : []),
    ],
    ...patch,
  }
}

function task(id: string, jiras: JiraIssue[]): Task {
  return {
    id, devId: 'd1', projectId: 'p1', title: 'Jira Issues', status: 'inprogress',
    jira: '', jiras, pr: '', prs: [], deadline: '', deadlineTime: '', reviewDate: '', reviewTime: '',
    comment: '', date: '2026-09-10',
  } as Task
}

const input = (jiras: JiraIssue[]) => ({
  tasks: [task('t1', jiras)], developers: [dev], schedule: {}, scheduleHours: {},
})

describe('computeTeamPerformance ranges', () => {
  it('counts an issue delivered in the range even when it is due after it', () => {
    // The bug: "This month" ends today, so work finished today but due later this month
    // was dropped and the developer looked idle.
    const delivered = issue('COM-1', '2026-09-28', '2026-09-15T17:00:00+04:00')
    const team = computeTeamPerformance(input([delivered]), { from: '2026-09-01', to: '2026-09-15' })

    expect(team.deliveredCount).toBe(1)
    expect(team.devs[0]!.deliveredCount).toBe(1)
  })

  it('counts a delivered issue in the period it was delivered, not the one it was due', () => {
    const lateDelivery = issue('COM-2', '2026-08-30', '2026-09-10T17:00:00+04:00')

    const august = computeTeamPerformance(input([lateDelivery]), { from: '2026-08-01', to: '2026-08-31' })
    const september = computeTeamPerformance(input([lateDelivery]), { from: '2026-09-01', to: '2026-09-30' })

    expect(august.deliveredCount).toBe(0)
    expect(september.deliveredCount).toBe(1)
    expect(september.devs[0]!.issues[0]!.timing).toBe('late')
  })

  it('still places work that has not been delivered by its due date', () => {
    const ongoing = issue('COM-3', '2026-09-20', null)

    expect(computeTeamPerformance(input([ongoing]), { from: '2026-09-01', to: '2026-09-30' }).devs[0]!.issues).toHaveLength(1)
    expect(computeTeamPerformance(input([ongoing]), { from: '2026-10-01', to: '2026-10-31' }).devs[0]!.issues).toHaveLength(0)
  })

  it('keeps everything when no range is given', () => {
    const team = computeTeamPerformance(
      input([issue('COM-4', '2026-01-05', '2026-01-04T17:00:00+04:00'), issue('COM-5', '2026-12-31', null)]),
    )

    expect(team.devs[0]!.issues).toHaveLength(2)
  })

  it('counts work on an issue with no deadline, but not towards on-time', () => {
    // It used to drop these entirely, so a month of work on undated tickets read as
    // nothing delivered -- and leaving the deadline off was the cheapest way to score well.
    const team = computeTeamPerformance(input([issue('COM-6', '', '2026-09-10T17:00:00+04:00')]))
    const dev = team.devs[0]!

    expect(dev.issues).toHaveLength(1)
    expect(dev.issues[0]!.verdict).toBe('deliveredNoDue')
    expect(dev.deliveredCount).toBe(1)
    expect(dev.onTimePct).toBeNull()   // nothing to judge it against
    expect(team.onTimePct).toBeNull()
  })

  it('keeps on-time honest when only some issues have a deadline', () => {
    const team = computeTeamPerformance(input([
      issue('COM-7', '2026-09-20', '2026-09-18T17:00:00+04:00'), // on time
      issue('COM-8', '', '2026-09-18T17:00:00+04:00'),           // undated
    ]))
    expect(team.deliveredCount).toBe(2)
    expect(team.onTimePct).toBe(100) // 1 of 1 judged, not 1 of 2
  })

  it('counts one issue once, however many daily copies carry it', () => {
    const jira = issue('COM-7', '2026-09-20', '2026-09-18T17:00:00+04:00')
    const team = computeTeamPerformance(
      { tasks: [task('t1', [jira]), task('t2', [jira]), task('t3', [jira])], developers: [dev], schedule: {}, scheduleHours: {} },
      { from: '2026-09-01', to: '2026-09-30' },
    )

    expect(team.deliveredCount).toBe(1)
  })

  it('leaves out developers who have left', () => {
    const team = computeTeamPerformance(
      { tasks: [task('t1', [issue('COM-8', '2026-09-20', '2026-09-18T17:00:00+04:00')])], developers: [{ ...dev, archivedAt: '2026-09-01' }], schedule: {}, scheduleHours: {} },
      { from: '2026-09-01', to: '2026-09-30' },
    )

    expect(team.devs).toEqual([])
  })
})

/* A developer has one working day however many issues they touch in it. */
describe('effort is bounded by the day, not by the issue', () => {
  const inProgressAllWednesday = (key: string): JiraIssue => issue(key, '2026-09-02', '2026-09-02T19:00:00+04:00', {
    statusHistory: [
      { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
      { status: 'done', at: '2026-09-02T19:00:00+04:00' },
    ],
  })

  it('shares one day across the issues worked that day', () => {
    const one = computeTeamPerformance(input([inProgressAllWednesday('COM-10')]))
    expect(one.devs[0]!.effortTotalH).toBeCloseTo(8, 1) // the whole day on one issue

    // The same day, three issues. It is still one day of work, not three.
    const three = computeTeamPerformance(input([
      inProgressAllWednesday('COM-11'),
      inProgressAllWednesday('COM-12'),
      inProgressAllWednesday('COM-13'),
    ]))
    expect(three.devs[0]!.effortTotalH).toBeCloseTo(8, 1)
    // and it is split between them rather than given to one
    for (const i of three.devs[0]!.issues) expect(i.effortH).toBeCloseTo(8 / 3, 1)
  })
})

describe('an issue nobody touches stops accruing', () => {
  it('caps effort at the stale cut-off and says so', () => {
    // In Progress since early August, never moved again.
    const forgotten = issue('COM-20', '2026-09-30', null, {
      statusHistory: [{ status: 'inprogress', at: '2026-08-03T10:00:00+04:00' }],
    })
    const team = computeTeamPerformance(input([forgotten]), { from: '2026-08-01', to: '2026-09-30' })
    const ip = team.devs[0]!.issues[0]!

    expect(ip.stale).toBe(true)
    // Five working days of an eight-hour day — not the ~40 working days since August.
    expect(ip.effortH).toBeLessThanOrEqual(40.01)
    // Cycle time keeps running, because the issue really is still ageing.
    expect(ip.cycleH!).toBeGreaterThan(100)
  })
})

describe('flow efficiency', () => {
  it('is active work over the whole span, not the share that was not blocked', () => {
    // Two hours of work on Wednesday morning, delivered at the end of Thursday:
    // 2h worked inside a span of 8 + 9 working hours.
    const slow = issue('COM-30', '2026-09-03', '2026-09-03T19:00:00+04:00', {
      statusHistory: [
        { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
        { status: 'review', at: '2026-09-02T12:00:00+04:00' },
        { status: 'done', at: '2026-09-03T19:00:00+04:00' },
      ],
    })
    const ip = computeTeamPerformance(input([slow])).devs[0]!.issues[0]!

    expect(ip.effortH).toBeCloseTo(2, 1)
    // Nothing was ever flagged Blocked, so the old measure called this 100% productive.
    expect(ip.flowEffPct!).toBeLessThan(40)
  })
})

describe('percentiles instead of averages', () => {
  it('is not dragged by one issue left open over a holiday', () => {
    const quick = (key: string, done: string) => issue(key, '2026-09-02', done, {
      statusHistory: [
        { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
        { status: 'done', at: done },
      ],
    })
    const team = computeTeamPerformance(input([
      quick('COM-40', '2026-09-02T12:00:00+04:00'),
      quick('COM-41', '2026-09-02T12:00:00+04:00'),
      quick('COM-42', '2026-09-02T12:00:00+04:00'),
      quick('COM-43', '2026-09-25T18:00:00+04:00'), // the outlier
    ]))

    expect(team.cycleP50H!).toBeLessThan(6)   // a typical issue is a couple of hours
    expect(team.cycleP85H!).toBeGreaterThan(team.cycleP50H!) // the tail is still visible
  })
})

describe('the team figure matches the issues under it', () => {
  it('sums work and time-in-flight rather than averaging percentages', () => {
    // One quick issue and one that sat in review for two days. Averaging the two
    // percentages would flatter the team; weighting by time in flight does not.
    const quick = issue('COM-50', '2026-09-02', '2026-09-02T12:00:00+04:00', {
      statusHistory: [
        { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
        { status: 'done', at: '2026-09-02T12:00:00+04:00' },
      ],
    })
    const lingering = issue('COM-51', '2026-09-04', '2026-09-04T18:00:00+04:00', {
      statusHistory: [
        { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
        { status: 'review', at: '2026-09-02T11:00:00+04:00' },
        { status: 'done', at: '2026-09-04T18:00:00+04:00' },
      ],
    })
    const team = computeTeamPerformance(input([quick, lingering]))

    expect(team.flowEffPct!).toBeLessThan(40)
    expect(team.flowEffPct!).toBeCloseTo(team.devs[0]!.flowEffPct!, 5)
  })
})
