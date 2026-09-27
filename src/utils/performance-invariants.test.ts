import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Developer, JiraIssue, StatusHistoryEntry, Task } from '../types'
import { computeTeamPerformance, type IssuePerf } from './performance'

/*
 * The dashboard's numbers are derived from one another: the status split should add up to
 * the span, work should fit inside it, a share should never exceed the whole. These check
 * the relationships hold across every shape of issue the app produces, which catches the
 * class of defect that shipped twice already — a ratio whose top and bottom were counted
 * by different rules.
 */

const TZ = 'Asia/Yerevan'
const dev: Developer = {
  id: 'd1', name: 'Dev', role: 'Frontend', color: '#000',
  periods: [{ type: 'full', hours: 8, from: '2020-01-01', to: null }],
  workSchedule: { workDays: [1, 2, 3, 4, 5], startTime: '10:00', endTime: '19:00', dailyHours: 8, timezone: TZ },
}

const NOW = '2026-09-26T22:23:00+04:00'
afterEach(() => vi.useRealTimers())

type Pr = { url: string; date: string; time: string }
function mk(key: string, history: StatusHistoryEntry[], opts: { deadline?: string; prs?: Pr[] } = {}): JiraIssue {
  return {
    issueId: key, url: `https://x/browse/${key}`, name: key,
    status: 'inprogress', priority: 'medium',
    deadline: opts.deadline ?? '', deadlineTime: '',
    prs: opts.prs ?? [], comment: '', statusHistory: history,
  } as JiraIssue
}

const h = (status: StatusHistoryEntry['status'], at: string): StatusHistoryEntry => ({ status, at })

const task = (jiras: JiraIssue[]): Task => ({
  id: 't1', devId: 'd1', projectId: 'p1', title: 'x', status: 'inprogress',
  jira: '', jiras, pr: '', prs: [], deadline: '', deadlineTime: '', reviewDate: '', reviewTime: '',
  comment: '', date: '2026-09-09',
} as Task)

/** Every shape the engine has a branch for. */
const SCENARIOS: Record<string, JiraIssue[]> = {
  'delivered on time': [mk('A', [h('inprogress', '2026-09-09T10:00:00+04:00'), h('done', '2026-09-09T15:00:00+04:00')], { deadline: '2026-09-10' })],
  'delivered late': [mk('B', [h('inprogress', '2026-09-08T10:00:00+04:00'), h('done', '2026-09-15T15:00:00+04:00')], { deadline: '2026-09-09' })],
  'no deadline': [mk('C', [h('inprogress', '2026-09-09T10:00:00+04:00'), h('done', '2026-09-09T14:00:00+04:00')])],
  'still ongoing': [mk('D', [h('inprogress', '2026-09-25T10:00:00+04:00')], { deadline: '2026-09-30' })],
  'overdue': [mk('E', [h('inprogress', '2026-09-20T10:00:00+04:00')], { deadline: '2026-09-22' })],
  'abandoned / stale': [mk('F', [h('inprogress', '2026-08-03T10:00:00+04:00')], { deadline: '2026-09-30' })],
  'never in progress': [mk('G', [h('todo', '2026-09-09T10:00:00+04:00'), h('done', '2026-09-10T10:00:00+04:00')], { deadline: '2026-09-10' })],
  'blocked half the time': [mk('H', [
    h('inprogress', '2026-09-09T10:00:00+04:00'), h('blocked', '2026-09-09T12:00:00+04:00'),
    h('inprogress', '2026-09-10T10:00:00+04:00'), h('done', '2026-09-10T12:00:00+04:00'),
  ], { deadline: '2026-09-11' })],
  'reworked twice': [mk('I', [
    h('inprogress', '2026-09-08T10:00:00+04:00'), h('review', '2026-09-08T12:00:00+04:00'),
    h('inprogress', '2026-09-09T10:00:00+04:00'), h('review', '2026-09-09T12:00:00+04:00'),
    h('inprogress', '2026-09-10T10:00:00+04:00'), h('done', '2026-09-10T12:00:00+04:00'),
  ], { deadline: '2026-09-11' })],
  // The gap that let the split outgrow the span: days in To Do before anyone picked it up
  // sit outside the span, which starts when work started.
  'queued in To Do for days first': [mk('Q', [
    h('todo', '2026-09-02T10:00:00+04:00'), h('inprogress', '2026-09-09T10:00:00+04:00'),
    h('done', '2026-09-09T14:00:00+04:00'),
  ], { deadline: '2026-09-10' })],
  'sat in todo, then review': [mk('J', [
    h('inprogress', '2026-09-08T10:00:00+04:00'), h('todo', '2026-09-08T11:00:00+04:00'),
    h('inprogress', '2026-09-09T14:00:00+04:00'), h('review', '2026-09-09T15:00:00+04:00'),
    h('done', '2026-09-11T15:00:00+04:00'),
  ], { deadline: '2026-09-12' })],
  'delivered by PR, status never closed': [mk('K', [h('inprogress', '2026-09-09T12:00:00+04:00')], {
    deadline: '2026-09-11', prs: [{ url: 'https://gl/1', date: '2026-09-10', time: '11:00' }],
  })],
  'spans a weekend': [mk('L', [h('inprogress', '2026-09-11T16:00:00+04:00'), h('done', '2026-09-14T11:00:00+04:00')], { deadline: '2026-09-14' })],
  'spans the new year holidays': [mk('M', [h('inprogress', '2026-12-30T10:00:00+04:00'), h('done', '2027-01-08T15:00:00+04:00')], { deadline: '2027-01-09' })],
  'PR pushed after the ticket was closed': [mk('O', [
    h('inprogress', '2026-09-08T10:00:00+04:00'), h('done', '2026-09-09T12:00:00+04:00'),
  ], { deadline: '2026-09-11', prs: [{ url: 'https://gl/3', date: '2026-09-11', time: '16:00' }] })],
  'PR pushed before work started': [mk('N', [h('inprogress', '2026-09-10T10:00:00+04:00')], {
    deadline: '2026-09-11', prs: [{ url: 'https://gl/2', date: '2026-09-08', time: '11:00' }],
  })],
  'four open at once': ['P1', 'P2', 'P3', 'P4'].map((k) => mk(k, [h('inprogress', '2026-09-09T10:00:00+04:00'), h('done', '2026-09-10T18:00:00+04:00')], { deadline: '2026-09-11' })),
}

const E = 0.02

function checkIssue(name: string, ip: IssuePerf) {
  const where = `${name} / ${ip.issueId}`
  const span = ip.flowSpanH ?? 0

  // Work happened inside the span it was in flight — it cannot exceed it.
  expect(ip.effortH, `${where}: effort ≤ span`).toBeLessThanOrEqual(span + E)
  expect(ip.blockedH, `${where}: blocked ≤ span`).toBeLessThanOrEqual(span + E)
  if (ip.cycleH != null) expect(ip.cycleH, `${where}: cycle ≤ span`).toBeLessThanOrEqual(span + E)

  // A share of the day is never more than the issue's own hours.
  expect(ip.effortShareH, `${where}: share ≤ own`).toBeLessThanOrEqual(ip.effortH + E)
  expect(ip.effortShareH, `${where}: share ≥ 0`).toBeGreaterThanOrEqual(0)

  // The status split plus the unaccounted remainder is exactly the span.
  const accounted = Object.values(ip.byStatus).reduce((s, x) => s + x, 0)
  expect(accounted + ip.untouchedH, `${where}: split adds up to the span`).toBeCloseTo(span, 1)

  // The headline percentage is the two numbers beside it.
  if (ip.flowEffPct != null) {
    expect(ip.flowEffPct, `${where}: flow = effort ÷ span`).toBeCloseTo(Math.min(100, (ip.effortH / span) * 100), 1)
    expect(ip.flowEffPct, `${where}: 0..100`).toBeGreaterThanOrEqual(0)
    expect(ip.flowEffPct, `${where}: 0..100`).toBeLessThanOrEqual(100)
  }

  // The In Progress slice of the split is the same work the headline uses.
  if (ip.byStatus.inprogress != null) {
    expect(ip.byStatus.inprogress, `${where}: split agrees with effort`).toBeCloseTo(ip.effortH, 1)
  }

  // No number is negative or NaN.
  for (const [k, v] of Object.entries({ effortH: ip.effortH, blockedH: ip.blockedH, untouchedH: ip.untouchedH, span })) {
    expect(Number.isFinite(v), `${where}: ${k} is finite`).toBe(true)
    expect(v, `${where}: ${k} ≥ 0`).toBeGreaterThanOrEqual(-E)
  }
}

const partTimer: Developer = {
  ...dev, id: 'd2', name: 'Part timer',
  periods: [{ type: 'part', hours: 4, from: '2020-01-01', to: null }],
  workSchedule: { ...dev.workSchedule!, dailyHours: 4 },
}

describe('the dashboard agrees with itself', () => {
  for (const [name, jiras] of Object.entries(SCENARIOS)) {
    it(name, () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(NOW))
      const team = computeTeamPerformance({ tasks: [task(jiras)], developers: [dev], schedule: {}, scheduleHours: {} })

      for (const d of team.devs) {
        for (const ip of d.issues) checkIssue(name, ip)

        expect(d.onTimeCount, `${name}: on-time ≤ delivered`).toBeLessThanOrEqual(d.deliveredCount)
        expect(d.effortTotalH, `${name}: dev total ≤ ungrouped total`).toBeLessThanOrEqual(d.effortSoloTotalH + E)
        if (d.cycleP50H != null && d.cycleP85H != null) {
          expect(d.cycleP50H, `${name}: p50 ≤ p85`).toBeLessThanOrEqual(d.cycleP85H + E)
        }
        if (d.flowEffPct != null) {
          expect(d.flowEffPct).toBeGreaterThanOrEqual(0)
          expect(d.flowEffPct).toBeLessThanOrEqual(100)
        }
        if (d.onTimePct != null) {
          expect(d.onTimePct).toBeGreaterThanOrEqual(0)
          expect(d.onTimePct).toBeLessThanOrEqual(100)
        }
        /*
         * The developer's split is the sum of their issues' splits — over the issues the
         * aggregates are built from. An issue that never reached In Progress has no
         * measurable work, so it stays out of the totals even though it has queue time.
         */
        const devAccounted = Object.values(d.byStatus).reduce((s, x) => s + x, 0)
        const issueAccounted = d.issues
          .filter((i) => i.verdict !== 'insufficient')
          .reduce((s, i) => s + Object.values(i.byStatus).reduce((a, b) => a + b, 0), 0)
        expect(devAccounted, `${name}: dev split = sum of issue splits`).toBeCloseTo(issueAccounted, 1)
      }

      expect(team.deliveredCount, `${name}: team delivered = sum of devs`)
        .toBe(team.devs.reduce((s, d) => s + d.deliveredCount, 0))
      if (team.cycleP50H != null && team.cycleP85H != null) {
        expect(team.cycleP50H, `${name}: team p50 ≤ p85`).toBeLessThanOrEqual(team.cycleP85H + E)
      }
      expect(team.weeks, `${name}: weeks ≥ 1`).toBeGreaterThanOrEqual(1)

      /*
       * The headline percentage and the "where the time goes" split describe the same
       * thing, so the In Progress slice of the split has to be the headline.
       */
      const split = Object.values(team.byStatus).reduce((s, x) => s + x, 0) + team.untouchedH
      if (split > 1e-9 && team.flowEffPct != null) {
        const inProgressPct = ((team.byStatus.inprogress ?? 0) / split) * 100
        expect(inProgressPct, `${name}: split's In Progress = flow efficiency`).toBeCloseTo(team.flowEffPct, 1)
      }
    })
  }
})

describe('and keeps agreeing in the awkward cases', () => {
  const run = (opts: {
    devs: Developer[]
    tasks: Task[]
    range?: { from?: string; to?: string }
    schedule?: Record<string, Record<string, string>>
  }) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    return computeTeamPerformance(
      { tasks: opts.tasks, developers: opts.devs, schedule: opts.schedule ?? {}, scheduleHours: {} },
      opts.range ?? {},
    )
  }

  const allIssues = Object.values(SCENARIOS).flat()

  it('a part-time developer', () => {
    const t = run({
      devs: [partTimer],
      tasks: [{ ...task(allIssues), devId: 'd2' } as Task],
    })
    for (const d of t.devs) for (const ip of d.issues) checkIssue('part time', ip)
  })

  it('a developer on holiday in the middle of the work', () => {
    const t = run({
      devs: [dev],
      tasks: [task(allIssues)],
      schedule: { d1: { '2026-09-09': 'vacation', '2026-09-10': 'sick' } },
    })
    for (const d of t.devs) for (const ip of d.issues) checkIssue('vacation', ip)
  })

  const splitMatchesHeadline = (label: string, t: ReturnType<typeof computeTeamPerformance>) => {
    const split = Object.values(t.byStatus).reduce((s, x) => s + x, 0) + t.untouchedH
    if (split > 1e-9 && t.flowEffPct != null) {
      expect(((t.byStatus.inprogress ?? 0) / split) * 100, `${label}: split = headline`).toBeCloseTo(t.flowEffPct, 1)
    }
    for (const d of t.devs) {
      const dSplit = Object.values(d.byStatus).reduce((s, x) => s + x, 0) + d.untouchedH
      if (dSplit > 1e-9 && d.flowEffPct != null) {
        expect(((d.byStatus.inprogress ?? 0) / dSplit) * 100, `${label}/${d.dev.name}: split = headline`).toBeCloseTo(d.flowEffPct, 1)
      }
    }
  }

  it('two developers, every scenario each', () => {
    const t = run({
      devs: [dev, partTimer],
      tasks: [task(allIssues), { ...task(allIssues), id: 't2', devId: 'd2' } as Task],
    })
    expect(t.devs).toHaveLength(2)
    for (const d of t.devs) for (const ip of d.issues) checkIssue('two devs', ip)
    expect(t.deliveredCount).toBe(t.devs.reduce((s, d) => s + d.deliveredCount, 0))
    splitMatchesHeadline('two devs', t)
  })

  it('the split matches the headline in every configuration', () => {
    splitMatchesHeadline('part time', run({ devs: [partTimer], tasks: [{ ...task(allIssues), devId: 'd2' } as Task] }))
    splitMatchesHeadline('vacation', run({ devs: [dev], tasks: [task(allIssues)], schedule: { d1: { '2026-09-09': 'vacation' } } }))
    splitMatchesHeadline('narrow range', run({ devs: [dev], tasks: [task(allIssues)], range: { from: '2026-09-09', to: '2026-09-11' } }))
    splitMatchesHeadline('wide range', run({ devs: [dev], tasks: [task(allIssues)], range: { from: '2026-01-01', to: '2027-12-31' } }))
  })

  it('a narrow date range', () => {
    const t = run({ devs: [dev], tasks: [task(allIssues)], range: { from: '2026-09-09', to: '2026-09-11' } })
    for (const d of t.devs) for (const ip of d.issues) checkIssue('narrow range', ip)
    expect(t.weeks).toBeGreaterThanOrEqual(1)
  })

  it('an empty board', () => {
    const t = run({ devs: [dev], tasks: [task([])] })
    expect(t.deliveredCount).toBe(0)
    expect(t.onTimePct).toBeNull()
    expect(t.flowEffPct).toBeNull()
    expect(t.cycleP50H).toBeNull()
    expect(Number.isFinite(t.weeks)).toBe(true)
  })
})

describe('the range picks a period of finished work, not of open work', () => {
  it('counts what is in flight the same however narrow the window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))

    const open = mk('OPEN', [h('inprogress', '2026-06-01T10:00:00+04:00')], { deadline: '2026-06-10' })
    const shipped = mk('SHIPPED', [h('inprogress', '2026-09-09T10:00:00+04:00'), h('done', '2026-09-09T15:00:00+04:00')], { deadline: '2026-09-10' })
    const run = (range: { from?: string; to?: string }) =>
      computeTeamPerformance({ tasks: [task([open, shipped])], developers: [dev], schedule: {}, scheduleHours: {} }, range)

    // June's issue is still open today, so it is in flight whatever window is on screen.
    for (const range of [{}, { from: '2026-09-01', to: '2026-09-30' }, { from: '2026-09-20', to: '2026-09-27' }]) {
      const t = run(range)
      expect(t.ongoingCount + t.overdueCount, `in flight for ${JSON.stringify(range)}`).toBe(1)
      expect(t.devs[0]!.wipCount).toBe(1)
    }

    // Delivered work, on the other hand, belongs to the period it was delivered in.
    expect(run({ from: '2026-09-01', to: '2026-09-30' }).deliveredCount).toBe(1)
    expect(run({ from: '2026-08-01', to: '2026-08-31' }).deliveredCount).toBe(0)
  })
})
