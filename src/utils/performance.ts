import type { AppState, Developer, JiraIssue, Status, StatusHistoryEntry } from '../types'
import { jiraDedupeKey } from './format'
import {
  calcWorkingHours,
  addWorkingHoursToInstant,
  tzWallClockToUtcMs,
  resolveTrackerTz,
  getSchedule,
} from './working-hours'

export type Verdict = 'good' | 'mixed' | 'bad' | 'ongoing' | 'overdue' | 'insufficient'

export interface StatusInterval {
  status: Status
  startMs: number
  endMs: number
  workH: number
}

export interface IssuePerf {
  taskId: string
  issueId?: string
  name: string
  url: string
  prUrls: string[]
  deadlineMs: number
  deadlineAssumed: boolean
  effectiveDeadlineMs: number
  startMs: number | null
  deliveryMs: number | null
  deliverySource: 'pr' | 'status' | null
  effortH: number
  blockedH: number
  cycleH: number | null
  budgetH: number | null
  onTime: boolean | null
  onBudget: boolean | null
  deliveryDeltaH: number | null // signed working hours vs effective deadline: + late, − early
  verdict: Verdict
  suspect: boolean
  confidence: 'reliable' | 'partial'
  intervals: StatusInterval[]
}

export interface DevPerf {
  dev: Developer
  issues: IssuePerf[]
  scoredCount: number
  goodCount: number
  mixedCount: number
  badCount: number
  ongoingCount: number
  overdueCount: number
  insufficientCount: number
  onTimeCount: number
  onBudgetCount: number
  scorePct: number | null
  onTimePct: number | null
  onBudgetPct: number | null
  avgEffortH: number | null
  avgBlockedH: number | null
  avgDeliveryDeltaH: number | null
  avgCycleH: number | null
  reliableCount: number
  profile: string
}

export interface TeamPerf {
  devs: DevPerf[]
  tz: string
  goodCount: number
  mixedCount: number
  badCount: number
  scoredCount: number
  ongoingCount: number
  overdueCount: number
  onTimePct: number | null
  onBudgetPct: number | null
}

export interface PerfRange {
  from?: string // YYYY-MM-DD inclusive
  to?: string // YYYY-MM-DD inclusive
}

const SCORED: Verdict[] = ['good', 'mixed', 'bad']
// Display priority within each developer section — most urgent first
const VERDICT_ORDER: Record<Verdict, number> = {
  bad: 0, overdue: 1, mixed: 2, ongoing: 3, good: 4, insufficient: 5,
}
const iso = (ms: number) => new Date(ms).toISOString()
const atMs = (e: StatusHistoryEntry) => new Date(e.at).getTime()
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function inRange(dateStr: string, range: PerfRange): boolean {
  if (range.from && dateStr < range.from) return false
  if (range.to && dateStr > range.to) return false
  return true
}

function buildIntervals(
  history: StatusHistoryEntry[],
  nowMs: number,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
  tz: string,
): StatusInterval[] {
  const sorted = [...history].sort((a, b) => atMs(a) - atMs(b))
  const out: StatusInterval[] = []
  for (let i = 0; i < sorted.length; i++) {
    const startMs = atMs(sorted[i]!)
    const endMs = i + 1 < sorted.length ? atMs(sorted[i + 1]!) : nowMs
    if (endMs <= startMs) continue
    out.push({
      status: sorted[i]!.status,
      startMs,
      endMs,
      workH: calcWorkingHours(iso(startMs), iso(endMs), dev, schedule, scheduleHours, tz),
    })
  }
  return out
}

function computeIssue(
  taskId: string,
  issue: JiraIssue,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
  tz: string,
  nowMs: number,
): IssuePerf {
  const sched = getSchedule(dev)
  const history = issue.statusHistory ?? []
  const sortedHistory = [...history].sort((a, b) => atMs(a) - atMs(b))
  const hasInProgress = history.some((e) => e.status === 'inprogress')
  const intervals = buildIntervals(history, nowMs, dev, schedule, scheduleHours, tz)

  const firstIp = sortedHistory.find((e) => e.status === 'inprogress')
  const startMs = firstIp ? atMs(firstIp) : null

  const effortH = intervals.filter((i) => i.status === 'inprogress').reduce((s, i) => s + i.workH, 0)
  const blockedH = intervals.filter((i) => i.status === 'blocked').reduce((s, i) => s + i.workH, 0)

  // Deadline (wall-clock in tracker tz). Missing time → developer's work-day end (flagged).
  const deadlineAssumed = !issue.deadlineTime
  const deadlineMs = tzWallClockToUtcMs(issue.deadline, issue.deadlineTime || sched.endTime, tz)
  const effectiveDeadlineMs =
    blockedH > 1e-9
      ? new Date(addWorkingHoursToInstant(iso(deadlineMs), blockedH, dev, schedule, scheduleHours, tz)).getTime()
      : deadlineMs

  // Delivery: latest PR push; else first transition into review/done.
  const prInstants = (issue.prs ?? [])
    .filter((p) => p.date)
    .map((p) => tzWallClockToUtcMs(p.date, p.time || sched.endTime, tz))
  let deliveryMs: number | null = null
  let deliverySource: IssuePerf['deliverySource'] = null
  if (prInstants.length) {
    deliveryMs = Math.max(...prInstants)
    deliverySource = 'pr'
  } else {
    const term = sortedHistory.find((e) => e.status === 'review' || e.status === 'done')
    if (term) {
      deliveryMs = atMs(term)
      deliverySource = 'status'
    }
  }

  const suspect = startMs != null && prInstants.length > 0 && Math.min(...prInstants) < startMs
  const confidence: IssuePerf['confidence'] = history.length >= 2 && hasInProgress ? 'reliable' : 'partial'

  let budgetH: number | null = null
  let cycleH: number | null = null
  let onTime: boolean | null = null
  let onBudget: boolean | null = null
  let deliveryDeltaH: number | null = null
  let verdict: Verdict

  if (!hasInProgress || startMs == null) {
    verdict = 'insufficient'
  } else {
    budgetH = calcWorkingHours(iso(startMs), iso(effectiveDeadlineMs), dev, schedule, scheduleHours, tz)
    if (deliveryMs != null) {
      cycleH = calcWorkingHours(iso(startMs), iso(Math.max(deliveryMs, startMs)), dev, schedule, scheduleHours, tz)
      onTime = deliveryMs <= effectiveDeadlineMs
      onBudget = effortH <= budgetH + 1e-9
      deliveryDeltaH = onTime
        ? -calcWorkingHours(iso(deliveryMs), iso(effectiveDeadlineMs), dev, schedule, scheduleHours, tz)
        : calcWorkingHours(iso(effectiveDeadlineMs), iso(deliveryMs), dev, schedule, scheduleHours, tz)
      verdict = onTime && onBudget ? 'good' : !onTime && !onBudget ? 'bad' : 'mixed'
    } else {
      cycleH = calcWorkingHours(iso(startMs), iso(Math.max(nowMs, startMs)), dev, schedule, scheduleHours, tz)
      verdict = nowMs > effectiveDeadlineMs ? 'overdue' : 'ongoing'
    }
  }

  return {
    taskId,
    issueId: issue.issueId,
    name: issue.name || issue.url || 'Issue',
    url: issue.url,
    prUrls: (issue.prs ?? []).map((p) => p.url).filter(Boolean),
    deadlineMs,
    deadlineAssumed,
    effectiveDeadlineMs,
    startMs,
    deliveryMs,
    deliverySource,
    effortH,
    blockedH,
    cycleH,
    budgetH,
    onTime,
    onBudget,
    deliveryDeltaH,
    verdict,
    suspect,
    confidence,
    intervals,
  }
}

function profileOf(d: Omit<DevPerf, 'profile'>): string {
  if (!d.scoredCount) return 'No delivered issues in range'
  const timeWord = d.onTimePct! >= 75 ? 'on time' : d.onTimePct! >= 40 ? 'sometimes late' : 'often late'
  const budgetWord = d.onBudgetPct! >= 75 ? 'within budget' : 'effort-heavy'
  const early = d.avgDeliveryDeltaH != null && d.avgDeliveryDeltaH < -0.5 ? ', usually early' : ''
  return `Usually ${timeWord}, ${budgetWord}${early}`
}

export function computeTeamPerformance(state: AppState, range: PerfRange = {}): TeamPerf {
  const tz = resolveTrackerTz(state.trackerTimezone)
  const nowMs = Date.now()
  const devById = new Map(state.developers.map((d) => [d.id, d]))

  // Dedupe the same issue across carry-over/daily copies per developer; keep the
  // instance with the richest record (most status history, then most PRs).
  const best = new Map<string, { taskId: string; issue: JiraIssue; devId: string; rank: number }>()
  for (const task of state.tasks) {
    if (!devById.has(task.devId)) continue
    for (const issue of task.jiras ?? []) {
      if (!issue.deadline || !inRange(issue.deadline, range)) continue
      const key = `${task.devId}:${issue.issueId ?? jiraDedupeKey(issue.url, issue.name)}`
      const rank = (issue.statusHistory?.length ?? 0) * 100 + (issue.prs?.length ?? 0)
      const ex = best.get(key)
      if (!ex || rank > ex.rank) best.set(key, { taskId: task.id, issue, devId: task.devId, rank })
    }
  }

  const perDev = new Map<string, IssuePerf[]>()
  for (const { taskId, issue, devId } of best.values()) {
    const dev = devById.get(devId)!
    const ip = computeIssue(taskId, issue, dev, state.schedule, state.scheduleHours, tz, nowMs)
    if (!perDev.has(devId)) perDev.set(devId, [])
    perDev.get(devId)!.push(ip)
  }

  const devs: DevPerf[] = state.developers
    .filter((d) => !d.archivedAt)
    .map((dev) => {
      const issues = (perDev.get(dev.id) ?? []).sort((a, b) => {
        const od = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
        return od !== 0 ? od : b.deadlineMs - a.deadlineMs
      })
      const scored = issues.filter((i) => SCORED.includes(i.verdict))
      const goodCount = scored.filter((i) => i.verdict === 'good').length
      const mixedCount = scored.filter((i) => i.verdict === 'mixed').length
      const badCount = scored.filter((i) => i.verdict === 'bad').length
      const ongoingCount = issues.filter((i) => i.verdict === 'ongoing').length
      const overdueCount = issues.filter((i) => i.verdict === 'overdue').length
      const insufficientCount = issues.filter((i) => i.verdict === 'insufficient').length
      const onTimeCount = scored.filter((i) => i.onTime).length
      const onBudgetCount = scored.filter((i) => i.onBudget).length
      const n = scored.length
      const base: Omit<DevPerf, 'profile'> = {
        dev,
        issues,
        scoredCount: n,
        goodCount,
        mixedCount,
        badCount,
        ongoingCount,
        overdueCount,
        insufficientCount,
        onTimeCount,
        onBudgetCount,
        scorePct: n ? (goodCount / n) * 100 : null,
        onTimePct: n ? (onTimeCount / n) * 100 : null,
        onBudgetPct: n ? (onBudgetCount / n) * 100 : null,
        avgEffortH: mean(scored.map((i) => i.effortH)),
        avgBlockedH: mean(scored.map((i) => i.blockedH)),
        avgDeliveryDeltaH: mean(scored.filter((i) => i.deliveryDeltaH != null).map((i) => i.deliveryDeltaH!)),
        avgCycleH: mean(scored.filter((i) => i.cycleH != null).map((i) => i.cycleH!)),
        reliableCount: scored.filter((i) => i.confidence === 'reliable').length,
      }
      return { ...base, profile: profileOf(base) }
    })
    .sort((a, b) => (b.scorePct ?? -1) - (a.scorePct ?? -1))

  const allScored = devs.flatMap((d) => d.issues.filter((i) => SCORED.includes(i.verdict)))
  const sc = allScored.length
  return {
    devs,
    tz,
    goodCount: allScored.filter((i) => i.verdict === 'good').length,
    mixedCount: allScored.filter((i) => i.verdict === 'mixed').length,
    badCount: allScored.filter((i) => i.verdict === 'bad').length,
    scoredCount: sc,
    ongoingCount: devs.reduce((s, d) => s + d.ongoingCount, 0),
    overdueCount: devs.reduce((s, d) => s + d.overdueCount, 0),
    onTimePct: sc ? (allScored.filter((i) => i.onTime).length / sc) * 100 : null,
    onBudgetPct: sc ? (allScored.filter((i) => i.onBudget).length / sc) * 100 : null,
  }
}
