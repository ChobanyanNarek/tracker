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

  it('ignores issues with no deadline, which it cannot judge', () => {
    expect(computeTeamPerformance(input([issue('COM-6', '', '2026-09-10T17:00:00+04:00')])).devs[0]!.issues).toEqual([])
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
