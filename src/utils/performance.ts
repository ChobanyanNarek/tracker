import type { Developer, JiraIssue, Status, StatusHistoryEntry, Task } from '../types'
import { jiraDedupeKey } from './format'
import { getSchedule, effectiveDailyHours, resolveTrackerTz, tzDateStr, tzDow, tzMidnightUtcMs, tzWallClockToUtcMs } from './working-hours'

/**
 * Performance engine.
 *
 * Everything is computed in each DEVELOPER'S OWN TIMEZONE (their work-schedule
 * override, falling back to the browser's zone) — external timestamps (Jira
 * status history ISO instants, PR push date/time) are converted to that
 * developer's wall-clock before any comparison. This matches working-hours.ts,
 * which already resolves per-developer timezone the same way — previously this
 * file always used the viewer's browser zone regardless of the developer's own
 * configured timezone, so a remote developer's working-hours math and their
 * Performance-tab verdicts could silently disagree about which calendar day
 * a status change or deadline fell on.
 *
 * Effort model (per the agreed spec):
 * - Actual work = time in "In Progress" status, clipped to the developer's
 *   daily work window, capped at the developer's productive hours per day.
 * - Blocked time is tracked separately and NEVER counted as work, and it does
 *   NOT extend the deadline.
 * - Delivery = the LAST MR/PR push; fallback = last transition into
 *   Review/Done. Jira status alone never overrides a pushed MR.
 * - On-time check has a ±5 minute tolerance around the deadline.
 * - A deadline without a time uses the developer's end-of-day.
 */

export type Timing = 'early' | 'onTime' | 'late'

export type Verdict =
  | 'great'        // delivered on time, mostly productive time
  | 'onTimeBlocky' // delivered on time, but a large share was blocked
  | 'lateSolid'    // delivered late, but working time was productive
  | 'lateBlocky'   // delivered late with a large share blocked
  | 'ongoing'      // no delivery signal yet, deadline not passed
  | 'overdue'      // no delivery signal, deadline passed
  | 'insufficient' // never In Progress — cannot measure

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
  startMs: number | null
  deliveryMs: number | null
  deliverySource: 'pr' | 'status' | null
  effortH: number
  blockedH: number
  flowEffPct: number | null // effort / (effort + blocked) — productive share
  cycleH: number | null // working hours start → delivery (or → now while ongoing)
  reworkCount: number // times it went back to In Progress after Review/Done
  timing: Timing | null
  deliveryDeltaH: number | null // signed working hours vs deadline: + late, − early, 0 on time
  verdict: Verdict
  suspect: boolean // PR pushed before the first In Progress
  intervals: StatusInterval[]
}

export interface DevPerf {
  dev: Developer
  issues: IssuePerf[]
  deliveredCount: number
  onTimeCount: number
  onTimePct: number | null
  ongoingCount: number
  overdueCount: number
  insufficientCount: number
  effortTotalH: number
  blockedTotalH: number
  flowEffPct: number | null
  avgEffortH: number | null
  avgBlockedH: number | null
  avgCycleH: number | null
  avgDeliveryDeltaH: number | null
  throughputWk: number | null // delivered issues per week in range
  reworkIssues: number
  reworkRatePct: number | null
  profile: string
}

export interface TeamPerf {
  devs: DevPerf[]
  deliveredCount: number
  onTimePct: number | null
  flowEffPct: number | null
  avgCycleH: number | null
  avgDeliveryDeltaH: number | null
  throughputWk: number | null
  reworkRatePct: number | null
  ongoingCount: number
  overdueCount: number
  weeks: number
}

export interface PerfRange {
  from?: string // YYYY-MM-DD inclusive
  to?: string // YYYY-MM-DD inclusive
}

/** The store slices the engine needs — keeps the useMemo dependency narrow. */
export interface PerfInput {
  developers: Developer[]
  tasks: Task[]
  schedule: Record<string, Record<string, string>>
  scheduleHours: Record<string, Record<string, number>>
}

const DELIVERED: Verdict[] = ['great', 'onTimeBlocky', 'lateSolid', 'lateBlocky']
// Display priority within each developer section — most urgent first
const VERDICT_ORDER: Record<Verdict, number> = {
  lateBlocky: 0, overdue: 1, lateSolid: 2, onTimeBlocky: 3, ongoing: 4, great: 5, insufficient: 6,
}
const ON_TIME_TOLERANCE_MS = 5 * 60_000
const BLOCKY_THRESHOLD_PCT = 70

const atMs = (e: StatusHistoryEntry) => new Date(e.at).getTime()
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Instant for a wall-clock date + time ("YYYY-MM-DD", "HH:MM"), in the given IANA timezone. */
function tzWallClockMs(dateStr: string, timeStr: string, tz: string): number {
  return tzWallClockToUtcMs(dateStr, timeStr || '00:00', tz)
}

function inRange(dateStr: string, range: PerfRange): boolean {
  if (range.from && dateStr < range.from) return false
  if (range.to && dateStr > range.to) return false
  return true
}

/**
 * Working hours contained in a set of absolute-time segments, in the
 * developer's own timezone (schedule override, else the browser's zone).
 *
 * Per calendar day: raw overlap of the segments with the developer's work
 * window (startTime–endTime), then capped at the developer's productive hours
 * for that day. This matches the agreed arithmetic: partial-day work counts as
 * real clock time, a full work-window day counts as `dailyHours`.
 * Non-work days, vacation/sick/holiday days contribute nothing.
 */
function cappedWorkHours(
  segments: Array<[number, number]>,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
): number {
  const valid = segments.filter(([s, e]) => e > s)
  if (!valid.length) return 0

  const sched = getSchedule(dev)
  const tz = resolveTrackerTz(sched.timezone)
  const winStartMin = timeToMinutes(sched.startTime)
  const winEndMin = timeToMinutes(sched.endTime)

  const minMs = Math.min(...valid.map(([s]) => s))
  const maxMs = Math.max(...valid.map(([, e]) => e))

  let total = 0
  const startDateStr = tzDateStr(minMs, tz)
  const endDateStr = tzDateStr(maxMs, tz)
  const [sy, sm, sd] = startDateStr.split('-').map(Number)
  const [ey, em, ed] = endDateStr.split('-').map(Number)
  const cursorUtc = new Date(Date.UTC(sy!, (sm ?? 1) - 1, sd!))
  const endUtc = new Date(Date.UTC(ey!, (em ?? 1) - 1, ed!))

  // Safety bound: ~10 years of calendar days
  for (let i = 0; i < 3700 && cursorUtc <= endUtc; i++) {
    const dateStr = `${cursorUtc.getUTCFullYear()}-${String(cursorUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(cursorUtc.getUTCDate()).padStart(2, '0')}`
    const midnightMs = tzMidnightUtcMs(dateStr, tz)
    const dow = tzDow(midnightMs + 12 * 3_600_000, tz)

    if (sched.workDays.includes(dow)) {
      const dayOff = schedule[dev.id]?.[dateStr]
      if (!dayOff || dayOff === 'work') {
        const winStart = midnightMs + winStartMin * 60_000
        const winEnd = midnightMs + winEndMin * 60_000
        if (winEnd > winStart) {
          let rawH = 0
          for (const [s, e] of valid) {
            const overlap = Math.min(e, winEnd) - Math.max(s, winStart)
            if (overlap > 0) rawH += overlap / 3_600_000
          }
          if (rawH > 0) {
            total += Math.min(rawH, effectiveDailyHours(dev, dateStr, scheduleHours, sched))
          }
        }
      }
    }

    cursorUtc.setUTCDate(cursorUtc.getUTCDate() + 1)
  }

  return total
}

function buildIntervals(
  sortedHistory: StatusHistoryEntry[],
  nowMs: number,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
): StatusInterval[] {
  const out: StatusInterval[] = []
  for (let i = 0; i < sortedHistory.length; i++) {
    const startMs = atMs(sortedHistory[i]!)
    const endMs = i + 1 < sortedHistory.length ? atMs(sortedHistory[i + 1]!) : nowMs
    if (endMs <= startMs) continue
    out.push({
      status: sortedHistory[i]!.status,
      startMs,
      endMs,
      workH: cappedWorkHours([[startMs, endMs]], dev, schedule, scheduleHours),
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
  nowMs: number,
): IssuePerf {
  const sched = getSchedule(dev)
  const tz = resolveTrackerTz(sched.timezone)
  const sortedHistory = [...(issue.statusHistory ?? [])].sort((a, b) => atMs(a) - atMs(b))
  const hasInProgress = sortedHistory.some((e) => e.status === 'inprogress')
  const intervals = buildIntervals(sortedHistory, nowMs, dev, schedule, scheduleHours)

  const firstIp = sortedHistory.find((e) => e.status === 'inprogress')
  const startMs = firstIp ? atMs(firstIp) : null

  const seg = (status: Status): Array<[number, number]> =>
    intervals.filter((iv) => iv.status === status).map((iv) => [iv.startMs, iv.endMs])
  const effortH = cappedWorkHours(seg('inprogress'), dev, schedule, scheduleHours)
  const blockedH = cappedWorkHours(seg('blocked'), dev, schedule, scheduleHours)
  const trackedH = effortH + blockedH
  const flowEffPct = trackedH > 1e-9 ? (effortH / trackedH) * 100 : null

  // Rework: In Progress again after having reached Review/Done
  let reworkCount = 0
  let seenDelivered = false
  for (const e of sortedHistory) {
    if (e.status === 'review' || e.status === 'done') seenDelivered = true
    else if (e.status === 'inprogress' && seenDelivered) {
      reworkCount++
      seenDelivered = false
    }
  }

  const deadlineAssumed = !issue.deadlineTime
  const deadlineMs = tzWallClockMs(issue.deadline, issue.deadlineTime || sched.endTime, tz)

  // Delivery: LAST MR/PR push wins; fallback — last transition INTO review/done.
  const prInstants = (issue.prs ?? [])
    .filter((p) => p.date)
    .map((p) => tzWallClockMs(p.date, p.time || sched.endTime, tz))
  let deliveryMs: number | null = null
  let deliverySource: IssuePerf['deliverySource'] = null
  if (prInstants.length) {
    deliveryMs = Math.max(...prInstants)
    deliverySource = 'pr'
  } else {
    let lastEntry: StatusHistoryEntry | null = null
    let prevDelivered = false
    for (const e of sortedHistory) {
      const isDelivered = e.status === 'review' || e.status === 'done'
      if (isDelivered && !prevDelivered) lastEntry = e
      prevDelivered = isDelivered
    }
    if (lastEntry) {
      deliveryMs = atMs(lastEntry)
      deliverySource = 'status'
    }
  }

  const suspect = startMs != null && prInstants.length > 0 && Math.min(...prInstants) < startMs

  let timing: Timing | null = null
  let deliveryDeltaH: number | null = null
  let cycleH: number | null = null
  let verdict: Verdict

  if (!hasInProgress || startMs == null) {
    verdict = 'insufficient'
  } else if (deliveryMs != null) {
    cycleH = cappedWorkHours([[startMs, Math.max(deliveryMs, startMs)]], dev, schedule, scheduleHours)
    if (Math.abs(deliveryMs - deadlineMs) <= ON_TIME_TOLERANCE_MS) {
      timing = 'onTime'
      deliveryDeltaH = 0
    } else if (deliveryMs < deadlineMs) {
      timing = 'early'
      deliveryDeltaH = -cappedWorkHours([[deliveryMs, deadlineMs]], dev, schedule, scheduleHours)
    } else {
      timing = 'late'
      deliveryDeltaH = cappedWorkHours([[deadlineMs, deliveryMs]], dev, schedule, scheduleHours)
    }
    const blocky = flowEffPct != null && flowEffPct < BLOCKY_THRESHOLD_PCT
    verdict = timing === 'late'
      ? (blocky ? 'lateBlocky' : 'lateSolid')
      : (blocky ? 'onTimeBlocky' : 'great')
  } else {
    cycleH = cappedWorkHours([[startMs, Math.max(nowMs, startMs)]], dev, schedule, scheduleHours)
    verdict = nowMs > deadlineMs + ON_TIME_TOLERANCE_MS ? 'overdue' : 'ongoing'
  }

  return {
    taskId,
    issueId: issue.issueId,
    name: issue.name || issue.url || 'Issue',
    url: issue.url,
    prUrls: (issue.prs ?? []).map((p) => p.url).filter(Boolean),
    deadlineMs,
    deadlineAssumed,
    startMs,
    deliveryMs,
    deliverySource,
    effortH,
    blockedH,
    flowEffPct,
    cycleH,
    reworkCount,
    timing,
    deliveryDeltaH,
    verdict,
    suspect,
    intervals,
  }
}

function profileOf(d: Pick<DevPerf, 'deliveredCount' | 'onTimePct' | 'flowEffPct' | 'avgDeliveryDeltaH'>): string {
  if (!d.deliveredCount) return 'No delivered issues in range'
  const timeWord = d.onTimePct! >= 75 ? 'usually on time' : d.onTimePct! >= 40 ? 'sometimes late' : 'often late'
  const blockWord = d.flowEffPct == null || d.flowEffPct >= BLOCKY_THRESHOLD_PCT ? 'few blocks' : 'frequently blocked'
  const early = d.avgDeliveryDeltaH != null && d.avgDeliveryDeltaH < -0.5 ? ' · typically delivers early' : ''
  return `${timeWord[0]!.toUpperCase()}${timeWord.slice(1)} · ${blockWord}${early}`
}

/**
 * Weeks covered by the range (for throughput); clamped to a minimum of 1.
 * Not tied to any one developer — range.from/to are the viewer's date-filter
 * selection, so this uses the browser's own zone (resolveTrackerTz with no
 * override), same as the app's other viewport-level "what date is selected"
 * logic in dates.ts.
 */
function rangeWeeks(range: PerfRange, issues: IssuePerf[], nowMs: number): number {
  const tz = resolveTrackerTz()
  let fromMs: number | null = null
  if (range.from) {
    fromMs = tzWallClockMs(range.from, '00:00', tz)
  } else {
    const anchors = issues
      .map((i) => i.startMs ?? i.deliveryMs ?? i.deadlineMs)
      .filter((x): x is number => x != null)
    if (anchors.length) fromMs = Math.min(...anchors)
  }
  if (fromMs == null) return 1
  const toMs = range.to ? tzWallClockMs(range.to, '23:59', tz) : nowMs
  return Math.max(1, (toMs - fromMs) / (7 * 86_400_000))
}

export function computeTeamPerformance(input: PerfInput, range: PerfRange = {}): TeamPerf {
  const nowMs = Date.now()
  const devById = new Map(input.developers.map((d) => [d.id, d]))

  // Dedupe the same issue across carry-over/daily copies per developer; keep the
  // instance with the richest record (most status history, then most PRs).
  const best = new Map<string, { taskId: string; issue: JiraIssue; devId: string; rank: number }>()
  for (const task of input.tasks) {
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
    const ip = computeIssue(taskId, issue, dev, input.schedule, input.scheduleHours, nowMs)
    if (!perDev.has(devId)) perDev.set(devId, [])
    perDev.get(devId)!.push(ip)
  }

  const allIssues = [...perDev.values()].flat()
  const weeks = rangeWeeks(range, allIssues, nowMs)

  const devs: DevPerf[] = input.developers
    .filter((d) => !d.archivedAt)
    .map((dev) => {
      const issues = (perDev.get(dev.id) ?? []).sort((a, b) => {
        const od = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
        return od !== 0 ? od : b.deadlineMs - a.deadlineMs
      })
      const delivered = issues.filter((i) => DELIVERED.includes(i.verdict))
      const measured = issues.filter((i) => i.verdict !== 'insufficient')
      const n = delivered.length
      const onTimeCount = delivered.filter((i) => i.timing !== 'late').length
      const effortTotalH = measured.reduce((s, i) => s + i.effortH, 0)
      const blockedTotalH = measured.reduce((s, i) => s + i.blockedH, 0)
      const trackedH = effortTotalH + blockedTotalH
      const reworkIssues = measured.filter((i) => i.reworkCount > 0).length
      const base = {
        deliveredCount: n,
        onTimePct: n ? (onTimeCount / n) * 100 : null,
        flowEffPct: trackedH > 1e-9 ? (effortTotalH / trackedH) * 100 : null,
        avgDeliveryDeltaH: mean(delivered.filter((i) => i.deliveryDeltaH != null).map((i) => i.deliveryDeltaH!)),
      }
      return {
        dev,
        issues,
        ...base,
        onTimeCount,
        ongoingCount: issues.filter((i) => i.verdict === 'ongoing').length,
        overdueCount: issues.filter((i) => i.verdict === 'overdue').length,
        insufficientCount: issues.filter((i) => i.verdict === 'insufficient').length,
        effortTotalH,
        blockedTotalH,
        avgEffortH: mean(delivered.map((i) => i.effortH)),
        avgBlockedH: mean(delivered.map((i) => i.blockedH)),
        avgCycleH: mean(delivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!)),
        throughputWk: n ? n / weeks : null,
        reworkIssues,
        reworkRatePct: measured.length ? (reworkIssues / measured.length) * 100 : null,
        profile: profileOf(base),
      }
    })
    .sort((a, b) => (b.onTimePct ?? -1) - (a.onTimePct ?? -1))

  const allDelivered = devs.flatMap((d) => d.issues.filter((i) => DELIVERED.includes(i.verdict)))
  const teamEffort = devs.reduce((s, d) => s + d.effortTotalH, 0)
  const teamBlocked = devs.reduce((s, d) => s + d.blockedTotalH, 0)
  const teamTracked = teamEffort + teamBlocked
  const teamMeasured = devs.reduce((s, d) => s + (d.issues.length - d.insufficientCount), 0)
  const teamRework = devs.reduce((s, d) => s + d.reworkIssues, 0)
  const n = allDelivered.length

  return {
    devs,
    deliveredCount: n,
    onTimePct: n ? (allDelivered.filter((i) => i.timing !== 'late').length / n) * 100 : null,
    flowEffPct: teamTracked > 1e-9 ? (teamEffort / teamTracked) * 100 : null,
    avgCycleH: mean(allDelivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!)),
    avgDeliveryDeltaH: mean(allDelivered.filter((i) => i.deliveryDeltaH != null).map((i) => i.deliveryDeltaH!)),
    throughputWk: n ? n / weeks : null,
    reworkRatePct: teamMeasured ? (teamRework / teamMeasured) * 100 : null,
    ongoingCount: devs.reduce((s, d) => s + d.ongoingCount, 0),
    overdueCount: devs.reduce((s, d) => s + d.overdueCount, 0),
    weeks,
  }
}
