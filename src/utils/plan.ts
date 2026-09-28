import type { Developer, JiraIssue, PlanLine, PlanScope, Project, ProjectPlan, Task } from '../types'
import { availableHours, type IssuePerf, type TeamPerf } from './performance'
import { resolveTrackerTz, tzWallClockToUtcMs } from './working-hours'

/**
 * Plan vs actual.
 *
 * Before development starts a document goes to the partner: how many hours each kind of
 * developer will spend, and by when. This answers the two questions that document raises
 * once work is under way, and answers them separately because they fail separately:
 *
 *   - are we inside the hours?
 *   - are we going to make the date?
 *
 * Capacity answers a third, and it answers it on day one rather than in the last week:
 * do the people named in each line even have that many hours before the date? Three
 * hundred hours of frontend by the end of October is not a plan if the only frontend
 * developer has a hundred and twenty hours before then.
 *
 * You can be well inside the hours and still be late (the person is on another project),
 * and you can hit the date having spent half as much again as promised.
 *
 * Every figure here says how much of the work it could see. An issue nobody estimated, that
 * has no dates and no branch, is invisible to the check — and a check that quietly ignores
 * part of the work is worse than no check, so the uncovered count travels with the result.
 */

const SEC_PER_HOUR = 3600

/** How far off plan a line has to be before it is worth colouring. */
export const PLAN_TOLERANCE_PCT = 10

export type PlanHealth = 'onPlan' | 'atRisk' | 'over' | 'noData'

/*
 * Where one task stands against the agreement. This is the question the document actually
 * raises — is every task it covers running normally, neither late nor falling behind — so
 * it is answered per task and not only in the totals.
 */
export type IssueTrack =
  | 'notStarted'  // nobody has picked it up yet
  | 'onTrack'     // running, inside its size and its date
  | 'behind'      // running, but already past the time it was sized for
  | 'atRisk'      // running, and will not fit before its date at this rate
  | 'late'        // its date has passed and it is not delivered
  | 'doneOnTime'
  | 'doneLate'
  | 'done'        // delivered, but there was no date to judge it against
  | 'unmeasured'  // no estimate, no branch, no dates — outside the check

export interface PlanIssueStatus {
  key: string
  name: string
  devId: string
  lineId?: string
  /** Hours the task was sized at, and where that number came from. */
  plannedH: number | null
  source: PlanSource
  /** Hours gone into it so far. */
  actualH: number
  /** Its own due date, when it has one. */
  deadline?: string
  /** Working hours left before that date. */
  hoursToDeadline: number | null
  /** How far past its size it has run, as a percentage. Null when it was never sized. */
  overBySizePct: number | null
  stale: boolean
  track: IssueTrack
}

/** The tracks that mean something needs attention, worst first. */
export const TRACK_ORDER: Record<IssueTrack, number> = {
  late: 0, behind: 1, atRisk: 2, notStarted: 3, onTrack: 4,
  doneLate: 5, doneOnTime: 6, done: 7, unmeasured: 8,
}

export const NEEDS_ATTENTION: IssueTrack[] = ['late', 'behind', 'atRisk']

/** Whether the people on a line physically have the hours the line promises. */
export type Feasibility = 'fits' | 'tight' | 'impossible' | 'unknown'

/** Where an issue's hours figure came from — shown so nobody trusts a guess as a measurement. */
export type PlanSource = 'estimate' | 'branch' | 'window' | 'none'

export interface PlanLineStatus {
  line: PlanLine
  /** Developers whose work counts against this line. */
  devIds: string[]
  allocatedH: number
  /** Hours the opened issues are expected to take, by estimate or by their window. */
  plannedH: number
  /** How many of the line's issues that figure covers. */
  sizedCount: number
  /*
   * The opened work against the hours it was given, as a percentage. Positive means the
   * tasks on the board already add up to more than was agreed — which is knowable before
   * anybody starts, and is the cheapest problem there is to fix.
   */
  scopeOverPct: number | null
  /** Hours actually spent so far. */
  actualH: number
  deliveredCount: number
  openCount: number
  /** Issues matching this line that no source could size. */
  unsizedCount: number
  /**
   * What the line will have cost by the time it is finished, if the rest goes like the
   * part already done. Null until enough has been delivered to extrapolate from.
   */
  projectedH: number | null
  /** Projected hours against allocated, as a percentage. Positive is over. */
  deviationPct: number | null
  /** The date this line is judged against. */
  end?: string
  health: PlanHealth
  /** Working hours these people have in the whole plan window, after leave and holidays. */
  capacityTotalH: number | null
  /** Working hours they have left between now and the date. */
  capacityLeftH: number | null
  /** Hours still expected to be needed — projected minus what is already spent. */
  remainingH: number | null
  feasibility: Feasibility
}

export interface PlanStatus {
  lines: PlanLineStatus[]
  /** Every task the agreement covers, worst first. */
  issues: PlanIssueStatus[]
  /** How many tasks sit in each state, so the answer fits in one line. */
  tracks: Record<IssueTrack, number>
  allocatedH: number
  plannedH: number
  actualH: number
  projectedH: number | null
  deviationPct: number | null
  targetEnd?: string
  /** Issues in the project that matched no line at all — nobody's hours cover them. */
  unplannedCount: number
  /** Issues that matched a line but could not be sized by any source. */
  unsizedCount: number
  /** Issues the check could see and size. */
  sizedCount: number
  capacityTotalH: number | null
  capacityLeftH: number | null
  feasibility: Feasibility
  /** The opened work against the agreed hours, across every line. */
  scopeOverPct: number | null
}

/**
 * Hours an issue is expected to take, and where that number came from.
 *
 * Everything this function derives is in the developer's own working hours — their
 * schedule and timezone, part-time rate, leave and public holidays all taken out. The one
 * number it does not touch is a figure a person entered in Jira: an original estimate is
 * already an estimate of work, not of elapsed time, so converting it would be wrong.
 */
export function issueSize(
  issue: JiraIssue,
  perf?: IssuePerf,
  dev?: Developer,
  schedule: Record<string, Record<string, string>> = {},
  scheduleHours: Record<string, Record<string, number>> = {},
): { hours: number | null; source: PlanSource } {
  // A number someone actually committed to beats anything derived.
  if (issue.timeOriginalEstimate) return { hours: issue.timeOriginalEstimate / SEC_PER_HOUR, source: 'estimate' }

  /*
   * Otherwise the branch tells the truth about how long the work took: opened when someone
   * started writing code, merged when it landed. It only exists where code was written, so
   * it covers development and not design or QA.
   */
  const branch = branchWindowH(issue, dev, schedule, scheduleHours)
  if (branch != null) return { hours: branch, source: 'branch' }

  /*
   * Last resort, and only once the work is finished: how long it actually took. Using the
   * span of something still running would be circular — the task would be "sized at"
   * however long it has been open, so it could never be found to have run past its size.
   * An unfinished task with no estimate and no branch simply cannot be sized, and saying
   * so is more useful than a number that can never be wrong.
   */
  if (perf?.deliveryMs != null && perf.flowSpanH != null && perf.flowSpanH > 0) {
    return { hours: perf.flowSpanH, source: 'window' }
  }

  return { hours: null, source: 'none' }
}

/** Working hours between a branch being opened and merged or closed, when both are known. */
function branchWindowH(
  issue: JiraIssue,
  dev: Developer | undefined,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
): number | null {
  let earliestOpen: number | null = null
  let latestEnd: number | null = null
  for (const pr of issue.prs ?? []) {
    for (const ev of pr.stateHistory ?? []) {
      const at = new Date(ev.at).getTime()
      if (Number.isNaN(at)) continue
      if (ev.state === 'open' || ev.state === 'draft') {
        if (earliestOpen == null || at < earliestOpen) earliestOpen = at
      } else if (ev.state === 'merged' || ev.state === 'closed') {
        if (latestEnd == null || at > latestEnd) latestEnd = at
      }
    }
  }
  if (earliestOpen == null || latestEnd == null || latestEnd <= earliestOpen) return null
  /*
   * The developer's working hours between the two, not elapsed time: a branch opened on
   * Friday afternoon and merged on Monday morning is a couple of hours of work, not a
   * weekend of it. Without a developer to ask there is no schedule to apply, and elapsed
   * hours are the only thing left.
   */
  if (!dev) return (latestEnd - earliestOpen) / 3_600_000
  return availableHours(dev, earliestOpen, latestEnd, schedule, scheduleHours)
}

/** Hours actually spent on an issue: a logged figure if there is one, else measured effort. */
export function issueSpentH(issue: JiraIssue, perf?: IssuePerf): number {
  if (issue.timeSpent) return issue.timeSpent / SEC_PER_HOUR
  return perf?.effortH ?? 0
}

/**
 * Which line a developer's work counts against. A line naming the person wins over a line
 * naming their role, so nothing is counted twice; roles are matched case-insensitively
 * because they are typed by hand.
 */
export function lineForDeveloper(plan: ProjectPlan, dev: Developer): PlanLine | undefined {
  const byPerson = plan.lines.find((l) => l.target.kind === 'developer' && l.target.devId === dev.id)
  if (byPerson) return byPerson
  const role = dev.role.trim().toLowerCase()
  if (!role) return undefined
  return plan.lines.find((l) => l.target.kind === 'roles' && l.target.roles.some((r) => r.trim().toLowerCase() === role))
}

/** Working hours a line's people have between two dates, leave and holidays taken out. */
function capacityFor(
  devIds: string[],
  developers: Developer[],
  project: Project,
  fromMs: number,
  toMs: number,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
  tz: string,
): number {
  let total = 0
  for (const id of devIds) {
    const dev = developers.find((d) => d.id === id)
    if (!dev || dev.archivedAt) continue
    // Somebody who joined the project part-way through only has hours from then on.
    const joined = project.joinDates?.[id]
    const start = joined ? Math.max(fromMs, tzWallClockToUtcMs(joined, '00:00', tz)) : fromMs
    total += availableHours(dev, start, toMs, schedule, scheduleHours)
  }
  return total
}

/** An issue's Jira key, however it is recorded. */
function keyOf(issue: JiraIssue): string {
  const raw = issue.issueId ?? ''
  if (raw) return raw.trim().toUpperCase()
  const fromUrl = issue.url?.split('/').pop() ?? ''
  return fromUrl.trim().toUpperCase()
}

const has = (list: string[] | undefined, key: string) =>
  !!list?.some((k) => k.trim().toUpperCase() === key)

/*
 * Whether the agreement covers this issue. An empty list is not a filter — a scope with
 * nothing chosen covers everything, which is what someone who has not narrowed it expects.
 */
export function inScope(scope: PlanScope | undefined, issue: JiraIssue): boolean {
  const key = keyOf(issue)
  if (!scope) return true
  if (has(scope.excludeKeys, key)) return false

  const byParent = scope.parentKeys?.length
    ? !!issue.parentKey && has(scope.parentKeys, issue.parentKey.trim().toUpperCase())
    : null
  const byIssue = scope.issueKeys?.length ? has(scope.issueKeys, key) : null

  // Named either way is enough: an issue picked by hand belongs even if its epic was not.
  if (byParent == null && byIssue == null) return true
  return !!byParent || !!byIssue
}

/*
 * One task against the agreement. "Behind" and "late" are different failures and are kept
 * apart: behind means it has already used more time than it was sized for, late means its
 * date has gone by. A task can be either without being the other.
 */
function assessIssue(
  issue: JiraIssue,
  perf: IssuePerf | undefined,
  plannedH: number | null,
  source: PlanSource,
  actualH: number,
  done: boolean,
  lineId: string,
  devId: string,
  nowMs: number,
): PlanIssueStatus {
  const deadlineMs = perf?.deadlineMs ?? null
  const started = perf?.startMs != null
  const overBySizePct = plannedH != null && plannedH > 0 ? ((actualH - plannedH) / plannedH) * 100 : null

  let track: IssueTrack
  if (done) {
    track = deadlineMs == null ? 'done'
      : (perf?.timing === 'late' ? 'doneLate' : 'doneOnTime')
  } else if (plannedH == null && deadlineMs == null) {
    track = 'unmeasured'
  } else if (deadlineMs != null && nowMs > deadlineMs) {
    track = 'late'
  } else if (overBySizePct != null && overBySizePct > 0) {
    track = 'behind'
  } else if (perf?.atRisk) {
    track = 'atRisk'
  } else if (!started) {
    track = 'notStarted'
  } else {
    track = 'onTrack'
  }

  return {
    key: keyOf(issue),
    name: issue.name || keyOf(issue),
    devId,
    lineId,
    plannedH,
    source,
    actualH,
    ...(issue.deadline ? { deadline: issue.deadline } : {}),
    hoursToDeadline: perf?.hoursToDeadline ?? null,
    overBySizePct,
    stale: perf?.stale ?? false,
    track,
  }
}

export function computePlanStatus(
  project: Project,
  developers: Developer[],
  tasks: Task[],
  team: TeamPerf,
  schedule: Record<string, Record<string, string>> = {},
  scheduleHours: Record<string, Record<string, number>> = {},
  nowMs: number = Date.now(),
): PlanStatus | null {
  const plan = project.plan
  if (!plan?.lines.length) return null

  const tz = resolveTrackerTz()
  const planStartMs = plan.approvedAt ? tzWallClockToUtcMs(plan.approvedAt, '00:00', tz) : nowMs

  const devById = new Map(developers.map((d) => [d.id, d]))
  const perfByKey = new Map<string, IssuePerf>()
  for (const d of team.devs) {
    for (const ip of d.issues) perfByKey.set(`${d.dev.id}:${ip.issueId ?? ip.url}`, ip)
  }

  // One entry per issue per developer; daily copies of the same issue must not be counted
  // more than once, so the richest record wins, exactly as the performance engine does.
  const best = new Map<string, { issue: JiraIssue; devId: string; rank: number }>()
  for (const task of tasks) {
    if (task.projectId !== project.id) continue
    if (!devById.has(task.devId)) continue
    for (const issue of task.jiras ?? []) {
      // Work agreed before the document was signed is not what the document covers.
      if (plan.approvedAt && issue.deadline && issue.deadline < plan.approvedAt) continue
      if (!inScope(plan.scope, issue)) continue
      const key = `${task.devId}:${issue.issueId ?? issue.url}`
      const rank = (issue.statusHistory?.length ?? 0) * 100 + (issue.prs?.length ?? 0)
      const ex = best.get(key)
      if (!ex || rank > ex.rank) best.set(key, { issue, devId: task.devId, rank })
    }
  }

  const issueRows: PlanIssueStatus[] = []
  const acc = new Map<string, { plannedH: number; sized: number; deliveredH: number; openSpends: number[]; delivered: number; unsized: number }>()
  for (const l of plan.lines) acc.set(l.id, { plannedH: 0, sized: 0, deliveredH: 0, openSpends: [], delivered: 0, unsized: 0 })
  let unplannedCount = 0
  let sizedCount = 0
  let unsizedTotal = 0

  for (const [key, { issue, devId }] of best) {
    const dev = devById.get(devId)!
    const line = lineForDeveloper(plan, dev)
    if (!line) { unplannedCount++; continue }
    const bucket = acc.get(line.id)!
    const perf = perfByKey.get(key)
    const { hours, source } = issueSize(issue, perf, dev, schedule, scheduleHours)

    if (hours == null) { bucket.unsized++; unsizedTotal++ } else { bucket.plannedH += hours; bucket.sized++; sizedCount++ }

    const spent = issueSpentH(issue, perf)
    const done = perf ? perf.deliveryMs != null : issue.status === 'done'
    if (done) { bucket.delivered++; bucket.deliveredH += spent } else { bucket.openSpends.push(spent) }

    issueRows.push(assessIssue(issue, perf, hours, source, spent, done, line.id, devId, nowMs))
  }

  issueRows.sort((a, b) => TRACK_ORDER[a.track] - TRACK_ORDER[b.track] || (b.overBySizePct ?? -1) - (a.overBySizePct ?? -1))
  const tracks = Object.fromEntries(Object.keys(TRACK_ORDER).map((k) => [k, 0])) as Record<IssueTrack, number>
  for (const r of issueRows) tracks[r.track]++

  const lines: PlanLineStatus[] = plan.lines.map((line) => {
    const b = acc.get(line.id)!
    const devIds = developers.filter((d) => lineForDeveloper(plan, d)?.id === line.id).map((d) => d.id)
    const openCount = b.openSpends.length
    const actualH = b.deliveredH + b.openSpends.reduce((s, h) => s + h, 0)

    /*
     * What the line will cost by the end. Extrapolating from hours burnt alone says
     * nothing — 80% of the hours is fine at 80% done and alarming at 30% — so the rate is
     * taken from the issues that actually finished. An issue still open is expected to cost
     * that much, or what it has already cost if it has passed it: work does not get cheaper
     * by running long.
     */
    const perDelivered = b.delivered > 0 ? b.deliveredH / b.delivered : null
    const projectedH = perDelivered == null
      ? null
      : b.deliveredH + b.openSpends.reduce((s, spent) => s + Math.max(spent, perDelivered), 0)
    const deviationPct = projectedH != null && line.hours > 0
      ? ((projectedH - line.hours) / line.hours) * 100
      : null

    let health: PlanHealth = 'noData'
    if (deviationPct != null) {
      health = deviationPct > PLAN_TOLERANCE_PCT ? 'over'
        : deviationPct > 0 ? 'atRisk'
        : 'onPlan'
    }

    const end = line.end ?? plan.targetEnd
    const endMs = end ? tzWallClockToUtcMs(end, '23:59', tz) : null
    const capacityTotalH = endMs == null ? null
      : capacityFor(devIds, developers, project, planStartMs, endMs, schedule, scheduleHours, tz)
    const capacityLeftH = endMs == null ? null
      : capacityFor(devIds, developers, project, nowMs, endMs, schedule, scheduleHours, tz)
    const remainingH = projectedH != null ? Math.max(0, projectedH - actualH) : null

    /*
     * Feasibility is about people and the calendar, not about progress: it is answerable
     * before a single issue is opened, and it is the one failure that no amount of working
     * harder later will fix.
     */
    let feasibility: Feasibility = 'unknown'
    if (capacityTotalH != null && devIds.length) {
      feasibility = capacityTotalH < line.hours ? 'impossible'
        : capacityTotalH < line.hours * (1 + PLAN_TOLERANCE_PCT / 100) ? 'tight'
        : 'fits'
    }

    return {
      line,
      devIds,
      allocatedH: line.hours,
      plannedH: b.plannedH,
      sizedCount: b.sized,
      scopeOverPct: line.hours > 0 && b.sized > 0 ? ((b.plannedH - line.hours) / line.hours) * 100 : null,
      actualH,
      deliveredCount: b.delivered,
      openCount,
      unsizedCount: b.unsized,
      projectedH,
      deviationPct,
      end,
      health,
      capacityTotalH,
      capacityLeftH,
      remainingH,
      feasibility,
    }
  })

  const allocatedH = lines.reduce((s, l) => s + l.allocatedH, 0)
  const plannedTotalH = lines.reduce((s, l) => s + l.plannedH, 0)
  const projectedTotal = lines.some((l) => l.projectedH != null)
    ? lines.reduce((s, l) => s + (l.projectedH ?? l.actualH), 0)
    : null

  return {
    lines,
    issues: issueRows,
    tracks,
    allocatedH,
    plannedH: lines.reduce((s, l) => s + l.plannedH, 0),
    actualH: lines.reduce((s, l) => s + l.actualH, 0),
    projectedH: projectedTotal,
    deviationPct: projectedTotal != null && allocatedH > 0
      ? ((projectedTotal - allocatedH) / allocatedH) * 100
      : null,
    targetEnd: plan.targetEnd,
    unplannedCount,
    unsizedCount: unsizedTotal,
    sizedCount,
    scopeOverPct: allocatedH > 0 && sizedCount > 0 ? ((plannedTotalH - allocatedH) / allocatedH) * 100 : null,
    capacityTotalH: lines.every((l) => l.capacityTotalH == null) ? null : lines.reduce((s, l) => s + (l.capacityTotalH ?? 0), 0),
    capacityLeftH: lines.every((l) => l.capacityLeftH == null) ? null : lines.reduce((s, l) => s + (l.capacityLeftH ?? 0), 0),
    feasibility: lines.some((l) => l.feasibility === 'impossible') ? 'impossible'
      : lines.some((l) => l.feasibility === 'tight') ? 'tight'
      : lines.some((l) => l.feasibility === 'fits') ? 'fits'
      : 'unknown',
  }
}
