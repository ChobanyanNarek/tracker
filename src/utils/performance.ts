import type { Developer, JiraIssue, Status, StatusHistoryEntry, Task } from '../types'
import { jiraDedupeKey } from './format'
import { isAmHoliday } from './dates'
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
  /** Raw work-window hours per calendar day, before the developer's day is shared out. */
  effortByDay: Map<string, { raw: number; cap: number }>
  effortH: number
  blockedH: number
  flowEffPct: number | null // active work ÷ cycle time — the share of the span actually worked
  cycleH: number | null // working hours start → delivery (or → now while ongoing)
  /*
   * Working hours the issue was in flight: first In Progress until it was actually Done
   * (or until now). Wider than cycleH, which stops at delivery -- the wait in review and
   * QA belongs in the denominator of flow efficiency, and that is where it lives.
   */
  flowSpanH: number | null
  reworkCount: number // times it went back to In Progress after Review/Done
  timing: Timing | null
  deliveryDeltaH: number | null // signed working hours vs deadline: + late, − early, 0 on time
  verdict: Verdict
  suspect: boolean // PR pushed before the first In Progress
  stale: boolean // sat untouched past the stale cut-off; accrual stopped there
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
  /** Total working hours the developer's issues were in flight — the flow-efficiency base. */
  flowSpanTotalH: number
  flowEffPct: number | null
  medEffortH: number | null
  medBlockedH: number | null
  cycleP50H: number | null
  cycleP85H: number | null
  medDeliveryDeltaH: number | null
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
  cycleP50H: number | null
  cycleP85H: number | null
  medDeliveryDeltaH: number | null
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
/*
 * Flow efficiency below this reads as "mostly waiting". 40% is the figure Kanban practice
 * treats as good; teams that do not watch it at all sit nearer 15%. The old threshold of
 * 70% belonged to a different measure (share of tracked time not flagged Blocked), which
 * sat near 100% for everyone and so never told anyone anything.
 */
const LOW_FLOW_EFF_PCT = 40
/*
 * An issue nobody has touched for this many working days has stopped being work in
 * progress and started being forgotten. Its open interval stops accruing effort at that
 * point -- otherwise a ticket left In Progress in March is still booking eight hours a day
 * in September -- and it is flagged so the row can say so.
 */
const STALE_AFTER_WORKDAYS = 5

const atMs = (e: StatusHistoryEntry) => new Date(e.at).getTime()
/*
 * Cycle and effort distributions have a long right tail -- one issue left open over a
 * holiday used to drag a whole team's average and flip a developer's profile line. The
 * median says what a typical issue costs; the 85th percentile is what to promise someone.
 */
function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const sorted = [...xs].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}
const median = (xs: number[]) => percentile(xs, 0.5)

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Instant for a wall-clock date + time ("YYYY-MM-DD", "HH:MM"), in the given IANA timezone. */
function tzWallClockMs(dateStr: string, timeStr: string, tz: string): number {
  return tzWallClockToUtcMs(dateStr, timeStr || '00:00', tz)
}

/*
 * Could this issue have been delivered inside the range, judging by the dates it carries
 * (status history and PRs)? Used only to widen the cheap pre-filter; the real decision is
 * made on the computed delivery instant.
 */
function mightDeliverInRange(issue: JiraIssue, range: PerfRange): boolean {
  const dates = [
    ...(issue.statusHistory ?? []).map((h) => h.at.slice(0, 10)),
    ...(issue.prs ?? []).map((p) => p.date),
  ].filter(Boolean)

  return dates.some((d) => inRange(d, range))
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
function workHoursByDay(
  segments: Array<[number, number]>,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
): Map<string, { raw: number; cap: number }> {
  const out = new Map<string, { raw: number; cap: number }>()
  const valid = segments.filter(([s, e]) => e > s)
  if (!valid.length) return out

  const sched = getSchedule(dev)
  const tz = resolveTrackerTz(sched.timezone)
  const winStartMin = timeToMinutes(sched.startTime)
  const winEndMin = timeToMinutes(sched.endTime)

  const minMs = Math.min(...valid.map(([s]) => s))
  const maxMs = Math.max(...valid.map(([, e]) => e))

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
      // A public holiday counts as a day off unless the schedule explicitly says 'work'.
      // Without this, a deadline over the New Year break charged eight hours a day for a
      // week nobody worked, and the issue came out days late.
      const holiday = isAmHoliday(dateStr) && dayOff !== 'work'
      if ((!dayOff || dayOff === 'work') && !holiday) {
        const winStart = midnightMs + winStartMin * 60_000
        const winEnd = midnightMs + winEndMin * 60_000
        if (winEnd > winStart) {
          let rawH = 0
          for (const [s, e] of valid) {
            const overlap = Math.min(e, winEnd) - Math.max(s, winStart)
            if (overlap > 0) rawH += overlap / 3_600_000
          }
          if (rawH > 0) out.set(dateStr, { raw: rawH, cap: effectiveDailyHours(dev, dateStr, scheduleHours, sched) })
        }
      }
    }

    cursorUtc.setUTCDate(cursorUtc.getUTCDate() + 1)
  }

  return out
}

/** Sum of the per-day hours, each capped at that day's productive hours. */
function cappedWorkHours(
  segments: Array<[number, number]>,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
): number {
  let total = 0
  for (const { raw, cap } of workHoursByDay(segments, dev, schedule, scheduleHours).values()) {
    total += Math.min(raw, cap)
  }
  return total
}

/*
 * The last status interval runs to "now", so it grows without limit. Cut the accrual off
 * after STALE_AFTER_WORKDAYS of the developer's own working days and report it as stale.
 * Only the accrual is clamped: cycle time keeps running, because an ageing issue really is
 * still ageing.
 */
function clampStaleTail(
  segments: Array<[number, number]>,
  openEndMs: number,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
): { segments: Array<[number, number]>; stale: boolean } {
  const lastIdx = segments.findIndex(([, e]) => e === openEndMs)
  if (lastIdx < 0) return { segments, stale: false }
  const [openStart] = segments[lastIdx]!

  const days = [...workHoursByDay([[openStart, openEndMs]], dev, schedule, scheduleHours)].sort(
    (a, b) => (a[0] < b[0] ? -1 : 1),
  )
  let budget = 0
  let spent = 0
  for (const [, { cap }] of days.slice(0, STALE_AFTER_WORKDAYS)) budget += cap
  if (!budget) return { segments, stale: false }

  const sched = getSchedule(dev)
  const tz = resolveTrackerTz(sched.timezone)
  const winEndMin = timeToMinutes(sched.endTime)

  for (const [dateStr, { raw, cap }] of days) {
    spent += Math.min(raw, cap)
    if (spent >= budget) {
      const cutoff = tzMidnightUtcMs(dateStr, tz) + winEndMin * 60_000
      if (cutoff >= openEndMs) break
      const out = segments.slice()
      out[lastIdx] = [openStart, cutoff]
      return { segments: out, stale: true }
    }
  }
  return { segments, stale: false }
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
  const inProgress = clampStaleTail(seg('inprogress'), nowMs, dev, schedule, scheduleHours)
  const blocked = clampStaleTail(seg('blocked'), nowMs, dev, schedule, scheduleHours)
  const stale = inProgress.stale || blocked.stale
  // Raw per-day hours, not yet capped: the cap belongs to the developer's day as a whole,
  // and is applied across all of their issues together once they are all computed.
  const effortByDay = workHoursByDay(inProgress.segments, dev, schedule, scheduleHours)
  const blockedH = cappedWorkHours(blocked.segments, dev, schedule, scheduleHours)

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

  const lastEntry = sortedHistory[sortedHistory.length - 1]
  const flowEndMs = lastEntry?.status === 'done' ? atMs(lastEntry) : nowMs
  const flowSpanH = startMs != null
    ? cappedWorkHours([[startMs, Math.max(flowEndMs, startMs)]], dev, schedule, scheduleHours)
    : null

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
    // The flow-efficiency half of the verdict needs the capped effort, which is only known
    // once every issue of this developer has been computed. finalizeIssue fills it in.
    verdict = timing === 'late' ? 'lateSolid' : 'great'
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
    effortByDay,
    effortH: 0,
    blockedH,
    flowEffPct: null,
    cycleH,
    flowSpanH,
    reworkCount,
    timing,
    deliveryDeltaH,
    verdict,
    suspect,
    stale,
    intervals,
  }
}

/*
 * A developer has one day, however many issues they touch in it. Effort was capped per
 * issue, so three issues open on the same Tuesday each booked a full day -- 24 hours in an
 * 8-hour day, which inflated effort, flow efficiency and the productive/blocked split for
 * anyone who multitasks. Share each day out in proportion to the raw time on each issue.
 */
function finalizeDevIssues(issues: IssuePerf[]): void {
  const dayTotals = new Map<string, number>()
  for (const ip of issues) {
    for (const [date, { raw }] of ip.effortByDay) dayTotals.set(date, (dayTotals.get(date) ?? 0) + raw)
  }

  for (const ip of issues) {
    let effortH = 0
    for (const [date, { raw, cap }] of ip.effortByDay) {
      const claimed = dayTotals.get(date) ?? raw
      effortH += claimed > cap ? (raw / claimed) * cap : Math.min(raw, cap)
    }
    ip.effortH = effortH

    /*
     * Flow efficiency the way the rest of the industry means it: active work over the whole
     * span the issue was in flight, review and QA waiting included. The old number was
     * effort / (effort + blocked), which counted only two statuses and ignored every other
     * kind of waiting -- so it read near 100% for everyone, and it rewarded never using the
     * Blocked status at all.
     */
    ip.flowEffPct = ip.flowSpanH != null && ip.flowSpanH > 1e-9
      ? Math.min(100, (effortH / ip.flowSpanH) * 100)
      : null

    const lowFlow = ip.flowEffPct != null && ip.flowEffPct < LOW_FLOW_EFF_PCT
    if (ip.verdict === 'great' && lowFlow) ip.verdict = 'onTimeBlocky'
    else if (ip.verdict === 'lateSolid' && lowFlow) ip.verdict = 'lateBlocky'
  }
}

function profileOf(d: Pick<DevPerf, 'deliveredCount' | 'onTimePct' | 'flowEffPct' | 'medDeliveryDeltaH'>): string {
  if (!d.deliveredCount) return 'No delivered issues in range'
  const timeWord = d.onTimePct! >= 75 ? 'usually on time' : d.onTimePct! >= 40 ? 'sometimes late' : 'often late'
  const blockWord = d.flowEffPct == null || d.flowEffPct >= LOW_FLOW_EFF_PCT ? 'work flows' : 'mostly waiting'
  const early = d.medDeliveryDeltaH != null && d.medDeliveryDeltaH < -0.5 ? ' · typically delivers early' : ''
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
      // Keep anything that could fall in the range on EITHER date, and decide once
      // delivery is known (below). Filtering on the deadline alone here hid work that was
      // finished inside the range but was due after it -- "This month" ends today, so an
      // issue delivered today and due later this month counted for nobody.
      if (!issue.deadline) continue
      if (range.from && issue.deadline < range.from && !mightDeliverInRange(issue, range)) continue
      const key = `${task.devId}:${issue.issueId ?? jiraDedupeKey(issue.url, issue.name)}`
      const rank = (issue.statusHistory?.length ?? 0) * 100 + (issue.prs?.length ?? 0)
      const ex = best.get(key)
      if (!ex || rank > ex.rank) best.set(key, { taskId: task.id, issue, devId: task.devId, rank })
    }
  }

  const perDev = new Map<string, IssuePerf[]>()
  const tz = resolveTrackerTz()
  const fromMs = range.from ? tzWallClockMs(range.from, '00:00', tz) : null
  const toMs = range.to ? tzWallClockMs(range.to, '23:59', tz) : null
  for (const { taskId, issue, devId } of best.values()) {
    const dev = devById.get(devId)!
    const ip = computeIssue(taskId, issue, dev, input.schedule, input.scheduleHours, nowMs)
    /*
     * In range when the work landed in it, or -- for anything not delivered -- when it
     * was due in it. So a delivered issue is counted in the period it was delivered.
     */
    const anchorMs = ip.deliveryMs ?? ip.deadlineMs
    if (fromMs != null && anchorMs < fromMs) continue
    if (toMs != null && anchorMs > toMs) continue
    if (!perDev.has(devId)) perDev.set(devId, [])
    perDev.get(devId)!.push(ip)
  }

  // Effort, flow efficiency and the verdict need every issue of a developer at once.
  for (const issues of perDev.values()) finalizeDevIssues(issues)

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
      // Aggregate flow efficiency is total work over total time in flight, to match the
      // per-issue figure. Summing the spans, not averaging the percentages, so a one-hour
      // issue does not weigh the same as a three-week one.
      const flowSpanTotalH = measured.reduce((s, i) => s + (i.flowSpanH ?? 0), 0)
      const reworkIssues = measured.filter((i) => i.reworkCount > 0).length
      const base = {
        deliveredCount: n,
        onTimePct: n ? (onTimeCount / n) * 100 : null,
        flowEffPct: flowSpanTotalH > 1e-9 ? Math.min(100, (effortTotalH / flowSpanTotalH) * 100) : null,
        medDeliveryDeltaH: median(delivered.filter((i) => i.deliveryDeltaH != null).map((i) => i.deliveryDeltaH!)),
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
        flowSpanTotalH,
        medEffortH: median(delivered.map((i) => i.effortH)),
        medBlockedH: median(delivered.map((i) => i.blockedH)),
        cycleP50H: percentile(delivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.5),
        cycleP85H: percentile(delivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.85),
        throughputWk: n ? n / weeks : null,
        reworkIssues,
        reworkRatePct: measured.length ? (reworkIssues / measured.length) * 100 : null,
        profile: profileOf(base),
      }
    })
    .sort((a, b) => (b.onTimePct ?? -1) - (a.onTimePct ?? -1))

  const allDelivered = devs.flatMap((d) => d.issues.filter((i) => DELIVERED.includes(i.verdict)))
  const teamEffort = devs.reduce((s, d) => s + d.effortTotalH, 0)
  const teamSpan = devs.reduce((s, d) => s + d.flowSpanTotalH, 0)
  const teamMeasured = devs.reduce((s, d) => s + (d.issues.length - d.insufficientCount), 0)
  const teamRework = devs.reduce((s, d) => s + d.reworkIssues, 0)
  const n = allDelivered.length

  return {
    devs,
    deliveredCount: n,
    onTimePct: n ? (allDelivered.filter((i) => i.timing !== 'late').length / n) * 100 : null,
    flowEffPct: teamSpan > 1e-9 ? Math.min(100, (teamEffort / teamSpan) * 100) : null,
    cycleP50H: percentile(allDelivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.5),
    cycleP85H: percentile(allDelivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.85),
    medDeliveryDeltaH: median(allDelivered.filter((i) => i.deliveryDeltaH != null).map((i) => i.deliveryDeltaH!)),
    throughputWk: n ? n / weeks : null,
    reworkRatePct: teamMeasured ? (teamRework / teamMeasured) * 100 : null,
    ongoingCount: devs.reduce((s, d) => s + d.ongoingCount, 0),
    overdueCount: devs.reduce((s, d) => s + d.overdueCount, 0),
    weeks,
  }
}
