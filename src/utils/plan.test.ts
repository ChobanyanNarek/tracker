import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Developer, JiraIssue, Project, Task } from '../types'
import { computeTeamPerformance } from './performance'
import { computePlanStatus, lineForDeveloper } from './plan'

/*
 * The document sent to a partner before development starts: so many hours of each kind of
 * developer, by such a date. These pin what "still on track" is allowed to mean.
 */

const TZ = 'Asia/Yerevan'
const schedule = { workDays: [1, 2, 3, 4, 5], startTime: '10:00', endTime: '19:00', dailyHours: 8, timezone: TZ }

function dev(id: string, name: string, role: string): Developer {
  return { id, name, role, color: '#000', periods: [{ type: 'full', hours: 8, from: '2020-01-01', to: null }], workSchedule: schedule }
}

const anna = dev('d1', 'Anna', 'Frontend')
const vahe = dev('d2', 'Vahe', 'Backend')
const lilit = dev('d3', 'Lilit', 'QA')
const maria = dev('d4', 'Maria', 'Design')

function issue(key: string, patch: Partial<JiraIssue> = {}): JiraIssue {
  return {
    issueId: key, url: `https://x.atlassian.net/browse/${key}`, name: key,
    status: 'done', priority: 'medium', deadline: '2026-09-30', deadlineTime: '18:00',
    prs: [], comment: '',
    statusHistory: [
      { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
      { status: 'done', at: '2026-09-02T14:00:00+04:00' },
    ],
    ...patch,
  }
}

function task(id: string, devId: string, jiras: JiraIssue[]): Task {
  return {
    id, devId, projectId: 'p1', title: 'Work', status: 'done',
    jira: '', jiras, pr: '', prs: [], deadline: '', deadlineTime: '', reviewDate: '', reviewTime: '',
    comment: '', date: '2026-09-02',
  } as Task
}

const H = 3600 // seconds in an hour, for timeOriginalEstimate

/*
 * Pin "now" to just after the work. Otherwise the issues left open accrue weeks of effort
 * and the sums stop being about the plan and start being about how long the test data has
 * been sitting there.
 */
afterEach(() => { vi.useRealTimers() })
function atWork() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-02T15:00:00+04:00'))
}

function project(lines: NonNullable<Project['plan']>['lines'], targetEnd?: string): Project {
  return {
    id: 'p1', name: 'Mabrook', color: '#000', desc: '', members: ['d1', 'd2', 'd3', 'd4'],
    plan: { lines, ...(targetEnd ? { targetEnd } : {}) },
  }
}

function status(proj: Project, tasks: Task[], developers = [anna, vahe, lilit, maria]) {
  const team = computeTeamPerformance({ developers, tasks, schedule: {}, scheduleHours: {} })
  return computePlanStatus(proj, developers, tasks, team)
}

describe('which line a developer counts against', () => {
  const plan = {
    lines: [
      { id: 'dev', label: 'Development', target: { kind: 'roles' as const, roles: ['Backend', 'Frontend'] }, hours: 320 },
      { id: 'anna', label: 'Anna', target: { kind: 'developer' as const, devId: 'd1' }, hours: 120 },
      { id: 'qa', label: 'QA', target: { kind: 'roles' as const, roles: ['qa'] }, hours: 60 },
    ],
  }

  it('sends a person to their own line even when their role has one', () => {
    expect(lineForDeveloper(plan, anna)?.id).toBe('anna')
    expect(lineForDeveloper(plan, vahe)?.id).toBe('dev')
  })

  it('matches roles however they were typed', () => {
    expect(lineForDeveloper(plan, lilit)?.id).toBe('qa') // line says 'qa', the developer says 'QA'
  })

  it('leaves someone no line covers unmatched rather than guessing', () => {
    expect(lineForDeveloper(plan, maria)).toBeUndefined()
  })
})

describe('hours against the plan', () => {
  it('projects from the share delivered, not from hours burnt', () => {
    atWork()
    // 60 hours allocated. Four issues of 10 estimated hours; two are done and took
    // 20 hours between them, so the four will land near 40 — comfortably inside.
    const done = (k: string) => issue(k, { timeOriginalEstimate: 10 * H, timeSpent: 10 * H })
    const open = (k: string) => issue(k, {
      timeOriginalEstimate: 10 * H,
      status: 'inprogress',
      statusHistory: [{ status: 'inprogress', at: '2026-09-02T10:00:00+04:00' }],
    })
    const proj = project([{ id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 60 }])
    const st = status(proj, [task('t1', 'd1', [done('A-1'), done('A-2'), open('A-3'), open('A-4')])])!

    const line = st.lines[0]!
    expect(line.deliveredCount).toBe(2)
    expect(line.openCount).toBe(2)
    // Spent so far covers the open work too, not only what is finished.
    expect(line.actualH).toBeGreaterThan(20)
    // Each unfinished issue is expected to cost what a finished one did: 20 + 10 + 10.
    expect(line.projectedH).toBeCloseTo(40, 1)
    expect(line.health).toBe('onPlan')
  })

  it('reports a line that is heading over its hours', () => {
    atWork()
    // 20 allocated; one of two issues is done and already cost 25 on its own.
    const heavy = issue('B-1', { timeOriginalEstimate: 10 * H, timeSpent: 25 * H })
    const rest = issue('B-2', {
      timeOriginalEstimate: 10 * H,
      status: 'inprogress',
      statusHistory: [{ status: 'inprogress', at: '2026-09-02T10:00:00+04:00' }],
    })
    const proj = project([{ id: 'be', label: 'Backend', target: { kind: 'roles', roles: ['Backend'] }, hours: 20 }])
    const st = status(proj, [task('t1', 'd2', [heavy, rest])])!

    expect(st.lines[0]!.projectedH).toBeCloseTo(50, 1) // (25 / 1) * 2
    expect(st.lines[0]!.deviationPct).toBeCloseTo(150, 0)
    expect(st.lines[0]!.health).toBe('over')
  })

  it('keeps lines independent, so a person and their role do not share a pot', () => {
    const proj = project([
      { id: 'dev', label: 'Development', target: { kind: 'roles', roles: ['Frontend', 'Backend'] }, hours: 300 },
      { id: 'anna', label: 'Anna', target: { kind: 'developer', devId: 'd1' }, hours: 100 },
    ])
    const st = status(proj, [
      task('t1', 'd1', [issue('C-1', { timeOriginalEstimate: 5 * H, timeSpent: 5 * H })]),
      task('t2', 'd2', [issue('C-2', { timeOriginalEstimate: 7 * H, timeSpent: 7 * H })]),
    ])!

    expect(st.allocatedH).toBe(400) // they add up rather than nesting
    expect(st.lines.find((l) => l.line.id === 'anna')!.actualH).toBeCloseTo(5, 1)
    expect(st.lines.find((l) => l.line.id === 'dev')!.actualH).toBeCloseTo(7, 1)
  })
})

describe('what the check cannot see', () => {
  it('counts work belonging to nobody in the plan instead of hiding it', () => {
    // Maria is a designer and no line covers design.
    const proj = project([{ id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 40 }])
    const st = status(proj, [
      task('t1', 'd1', [issue('D-1', { timeOriginalEstimate: 4 * H })]),
      task('t2', 'd4', [issue('D-2', { timeOriginalEstimate: 4 * H })]),
    ])!

    expect(st.unplannedCount).toBe(1)
  })

  it('counts an issue no source could size', () => {
    // No estimate, no branch, and never started — nothing to measure it by.
    const bare = issue('E-1', { statusHistory: [], status: 'todo' })
    const proj = project([{ id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 40 }])
    const st = status(proj, [task('t1', 'd1', [bare])])!

    expect(st.unsizedCount).toBe(1)
    expect(st.sizedCount).toBe(0)
  })
})

describe('sizing an issue', () => {
  it('falls back to the branch when nobody estimated the work', () => {
    const viaBranch = issue('F-1', {
      prs: [{
        url: 'https://github.com/x/y/pull/1', date: '2026-09-02', time: '10:00',
        stateHistory: [
          { state: 'open', at: '2026-09-02T10:00:00+04:00' },
          { state: 'merged', at: '2026-09-02T13:00:00+04:00' },
        ],
      }],
    })
    const proj = project([{ id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 40 }])
    const st = status(proj, [task('t1', 'd1', [viaBranch])])!

    expect(st.unsizedCount).toBe(0)
    expect(st.lines[0]!.plannedH).toBeGreaterThan(0)
  })
})

describe('capacity — can these people even do it by that date', () => {
  function statusOn(proj: Project, tasks: Task[], now: string, devSchedule: Record<string, Record<string, string>> = {}) {
    const developers = [anna, vahe, lilit, maria]
    const team = computeTeamPerformance({ developers, tasks, schedule: devSchedule, scheduleHours: {} })
    return computePlanStatus(proj, developers, tasks, team, devSchedule, {}, new Date(now).getTime())
  }

  it('calls a promise impossible when the people do not have the hours', () => {
    // One frontend developer, 8h a day. From 1 Sep to 30 Sep there are 22 working days,
    // so about 176 hours exist — and the line promises 300.
    const proj = project([
      { id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 300, end: '2026-09-30' },
    ])
    proj.plan!.approvedAt = '2026-09-01'
    const st = statusOn(proj, [task('t1', 'd1', [issue('G-1', { timeOriginalEstimate: 4 * H })])], '2026-09-01T10:00:00+04:00')!

    expect(st.lines[0]!.capacityTotalH!).toBeLessThan(300)
    expect(st.lines[0]!.feasibility).toBe('impossible')
    expect(st.feasibility).toBe('impossible')
  })

  it('accepts a promise the calendar can hold', () => {
    const proj = project([
      { id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 80, end: '2026-09-30' },
    ])
    proj.plan!.approvedAt = '2026-09-01'
    const st = statusOn(proj, [task('t1', 'd1', [issue('G-2', { timeOriginalEstimate: 4 * H })])], '2026-09-01T10:00:00+04:00')!

    expect(st.lines[0]!.feasibility).toBe('fits')
  })

  it('takes vacation out of the hours somebody has', () => {
    const proj = project([
      { id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 80, end: '2026-09-30' },
    ])
    proj.plan!.approvedAt = '2026-09-01'
    const work = [task('t1', 'd1', [issue('G-3', { timeOriginalEstimate: 4 * H })])]

    const free = statusOn(proj, work, '2026-09-01T10:00:00+04:00')!.lines[0]!.capacityTotalH!
    // Two full weeks off in the middle of the month.
    const away: Record<string, Record<string, string>> = { d1: {} }
    for (const d of ['07', '08', '09', '10', '11', '14', '15', '16', '17', '18']) away.d1![`2026-09-${d}`] = 'vacation'
    const onLeave = statusOn(proj, work, '2026-09-01T10:00:00+04:00', away)!.lines[0]!.capacityTotalH!

    expect(onLeave).toBeCloseTo(free - 80, 0) // ten working days at eight hours
  })

  it('shrinks the hours left as the date approaches', () => {
    const proj = project([
      { id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 80, end: '2026-09-30' },
    ])
    proj.plan!.approvedAt = '2026-09-01'
    const work = [task('t1', 'd1', [issue('G-4', { timeOriginalEstimate: 4 * H })])]

    const early = statusOn(proj, work, '2026-09-02T10:00:00+04:00')!.lines[0]!
    const late = statusOn(proj, work, '2026-09-25T10:00:00+04:00')!.lines[0]!

    expect(late.capacityLeftH!).toBeLessThan(early.capacityLeftH!)
    expect(early.capacityTotalH).toBeCloseTo(late.capacityTotalH!, 0) // the window itself did not move
  })
})

describe('choosing which tasks the agreement covers', () => {
  const underEpic = (key: string, epic: string) => issue(key, { parentKey: epic, timeOriginalEstimate: 4 * H, timeSpent: 4 * H })
  const loose = (key: string) => issue(key, { timeOriginalEstimate: 4 * H, timeSpent: 4 * H })
  const line = { id: 'fe', label: 'Frontend', target: { kind: 'roles' as const, roles: ['Frontend'] }, hours: 40 }

  function scoped(scope: NonNullable<Project['plan']>['scope']) {
    const proj = project([line])
    proj.plan!.scope = scope
    return status(proj, [task('t1', 'd1', [underEpic('S-1', 'EPIC-1'), underEpic('S-2', 'EPIC-2'), loose('S-3')])])!
  }

  it('covers everything when nothing has been narrowed', () => {
    expect(scoped(undefined).lines[0]!.deliveredCount).toBe(3)
    expect(scoped({}).lines[0]!.deliveredCount).toBe(3) // an empty scope is not an empty list
  })

  it('narrows to an epic', () => {
    expect(scoped({ parentKeys: ['EPIC-1'] }).lines[0]!.deliveredCount).toBe(1)
  })

  it('takes an issue picked by hand even when its epic was not chosen', () => {
    expect(scoped({ parentKeys: ['EPIC-1'], issueKeys: ['S-3'] }).lines[0]!.deliveredCount).toBe(2)
  })

  it('lets an exclusion beat everything else', () => {
    expect(scoped({ parentKeys: ['EPIC-1'], excludeKeys: ['S-1'] }).lines[0]!.deliveredCount).toBe(0)
  })

  it('does not care how the keys were typed', () => {
    expect(scoped({ parentKeys: ['epic-1'] }).lines[0]!.deliveredCount).toBe(1)
  })
})

describe('each task against the agreement', () => {
  const line = { id: 'fe', label: 'Frontend', target: { kind: 'roles' as const, roles: ['Frontend'] }, hours: 200 }
  function tracks(jiras: JiraIssue[], now = '2026-09-22T12:00:00+04:00') {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    const developers = [anna]
    const tasks = [task('t1', 'd1', jiras)]
    const team = computeTeamPerformance({ developers, tasks, schedule: {}, scheduleHours: {} })
    const st = computePlanStatus(project([line]), developers, tasks, team, {}, {}, new Date(now).getTime())!
    vi.useRealTimers()
    return st
  }

  it('separates being late from falling behind', () => {
    // Past its date, still open.
    const overdue = issue('T-1', {
      deadline: '2026-09-10', status: 'inprogress',
      timeOriginalEstimate: 8 * H,
      statusHistory: [{ status: 'inprogress', at: '2026-09-08T10:00:00+04:00' }],
    })
    // Date still ahead, but it has already burnt more than it was sized for.
    const burnt = issue('T-2', {
      deadline: '2026-10-30', status: 'inprogress',
      timeOriginalEstimate: 2 * H, timeSpent: 20 * H,
      statusHistory: [{ status: 'inprogress', at: '2026-09-21T10:00:00+04:00' }],
    })

    const st = tracks([overdue, burnt])
    const byKey = new Map(st.issues.map((i) => [i.key, i]))
    expect(byKey.get('T-1')!.track).toBe('late')
    expect(byKey.get('T-2')!.track).toBe('behind')
    expect(byKey.get('T-2')!.overBySizePct).toBeCloseTo(900, 0)
  })

  it('judges a finished task against its date', () => {
    const early = issue('T-3', { deadline: '2026-09-20', timeOriginalEstimate: 4 * H })
    const overran = issue('T-4', {
      deadline: '2026-09-01', timeOriginalEstimate: 4 * H,
      statusHistory: [
        { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
        { status: 'done', at: '2026-09-10T14:00:00+04:00' },
      ],
    })
    const st = tracks([early, overran])
    const byKey = new Map(st.issues.map((i) => [i.key, i]))
    expect(byKey.get('T-3')!.track).toBe('doneOnTime')
    expect(byKey.get('T-4')!.track).toBe('doneLate')
  })

  it('says plainly when a task cannot be judged at all', () => {
    const bare = issue('T-5', { deadline: '', status: 'todo', statusHistory: [] })
    expect(tracks([bare]).issues[0]!.track).toBe('unmeasured')
  })

  it('counts the states so the answer fits in one line', () => {
    const st = tracks([
      issue('T-6', { deadline: '2026-09-10', status: 'inprogress', timeOriginalEstimate: 8 * H, statusHistory: [{ status: 'inprogress', at: '2026-09-08T10:00:00+04:00' }] }),
      issue('T-7', { deadline: '2026-09-20', timeOriginalEstimate: 4 * H }),
    ])
    expect(st.tracks.late).toBe(1)
    expect(st.tracks.doneOnTime).toBe(1)
    expect(st.issues[0]!.track).toBe('late') // worst first
  })
})

describe('sizing must not be circular', () => {
  it('refuses to size an unfinished task by how long it has been open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T12:00:00+04:00'))
    // No estimate, no branch, still running: its own span would just say "as long as it
    // has taken", which can never be over.
    const running = issue('U-1', {
      deadline: '2026-10-30', status: 'inprogress',
      statusHistory: [{ status: 'inprogress', at: '2026-09-02T10:00:00+04:00' }],
    })
    const proj = project([{ id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 40 }])
    const tasks = [task('t1', 'd1', [running])]
    const team = computeTeamPerformance({ developers: [anna], tasks, schedule: {}, scheduleHours: {} })
    const st = computePlanStatus(proj, [anna], tasks, team, {}, {}, Date.now())!
    vi.useRealTimers()

    expect(st.issues[0]!.plannedH).toBeNull()
    expect(st.issues[0]!.source).toBe('none')
    expect(st.unsizedCount).toBe(1)
  })

  it('still uses the span once the work is finished', () => {
    const finished = issue('U-2', {
      statusHistory: [
        { status: 'inprogress', at: '2026-09-02T10:00:00+04:00' },
        { status: 'done', at: '2026-09-02T14:00:00+04:00' },
      ],
    })
    const proj = project([{ id: 'fe', label: 'Frontend', target: { kind: 'roles', roles: ['Frontend'] }, hours: 40 }])
    const st = status(proj, [task('t1', 'd1', [finished])])!
    expect(st.issues[0]!.source).toBe('window')
    expect(st.issues[0]!.plannedH).toBeGreaterThan(0)
  })
})
