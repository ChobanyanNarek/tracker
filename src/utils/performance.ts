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
  | 'deliveredNoDue' // delivered, but nobody set a deadline to judge it against
  | 'ongoing'      // no delivery signal yet, deadline not passed
  | 'overdue'      // no delivery signal, deadline passed
  | 'insufficient' // never In Progress — cannot measure

export interface StatusInterval {
  status: Status
  startMs: number
  endMs: number
  /** Working hours of this interval that counted as work — nothing past delivery does. */
  workH: number
}

export interface IssuePerf {
  taskId: string
  issueId?: string
  name: string
  url: string
  prUrls: string[]
  deadlineMs: number | null
  deadlineAssumed: boolean
  startMs: number | null
  deliveryMs: number | null
  deliverySource: 'merge' | 'pr' | 'status' | null
  /** Working hours spent in each status between first In Progress and done/now. */
  byStatus: Partial<Record<Status, number>>
  /*
   * Working hours the issue was in flight but not accounted for by any status — the run
   * past the stale cut-off, and the share of a day that went to the developer's other
   * issues. Naming it keeps the split adding up to the flow-efficiency figure instead of
   * quietly disagreeing with it.
   */
  untouchedH: number
  /** Working hours left before the deadline, for something still in flight. */
  hoursToDeadline: number | null
  /** Still in flight and unlikely to make its deadline, judged against the team's own p85. */
  atRisk: boolean
  /*
   * Per calendar day: the raw In Progress hours, that day's productive capacity, and the
   * total hours this issue held of that day across all its statuses. The last is what other
   * issues compete against when the day has to be shared.
   */
  effortByDay: Map<string, { raw: number; cap: number; dayTotal: number }>
  /** This issue's own In Progress working hours — what the status timeline adds up to. */
  effortH: number
  /*
   * The same work after a shared day is divided between the issues open in it. Used for a
   * developer's totals, where hours are a claim on a finite day. NOT used for flow
   * efficiency: dividing the work but not the span made an issue that never waited for
   * anything report 23% "flow efficiency" purely because other issues were open too.
   */
  effortShareH: number
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
  /** Against the FIRST deadline the issue ever had, when that differs from the current one. */
  timingVsOriginal: Timing | null
  deadlineMovedDays: number | null // how far the due date was pushed out (+) or pulled in (−)
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
  /** Same work without the shared-day division — the flow-efficiency numerator. */
  effortSoloTotalH: number
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
  /** Issues in flight right now — the cause of long cycle times more often than not. */
  wipCount: number
  atRiskCount: number
  byStatus: Partial<Record<Status, number>>
  untouchedH: number
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
  atRiskCount: number
  untouchedH: number
  /** On-time measured against each issue's FIRST deadline, when any were moved. */
  onTimeVsOriginalPct: number | null
  movedDeadlineCount: number
  byStatus: Partial<Record<Status, number>>
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

const DELIVERED: Verdict[] = ['great', 'onTimeBlocky', 'lateSolid', 'lateBlocky', 'deliveredNoDue']
// Display priority within each developer section — most urgent first
const VERDICT_ORDER: Record<Verdict, number> = {
  lateBlocky: 0, overdue: 1, lateSolid: 2, onTimeBlocky: 3, ongoing: 4, great: 5, deliveredNoDue: 6, insufficient: 7,
}
const ON_TIME_TOLERANCE_MS = 5 * 60_000
/*
 * Flow efficiency below this reads as "mostly waiting". 40% is the figure Kanban practice
 * treats as good; teams that do not watch it at all sit nearer 15%. The old threshold of
 * 70% belonged to a different measure (share of tracked time not flagged Blocked), which
 * sat near 100% for everyone and so never told anyone anything.
 */
const LOW_FLOW_EFF_PCT = 40
/** The statuses that represent time spent; 'done' is the end state, not a duration. */
const TRACKED_STATUSES = ['todo', 'inprogress', 'review', 'blocked'] as const
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
/*
 * One developer's calendar day resolved once per run: does it count as a working day, what
 * is the work window, how many productive hours does it hold. Every issue of a developer
 * walks the same days, so without this the same answer is recomputed hundreds of times.
 * Cleared at the top of each computeTeamPerformance, so a schedule edit is picked up.
 */
interface WorkDay { winStart: number; winEnd: number; cap: number }
const dayCache = new Map<string, WorkDay | null>()

function workDay(
  dateStr: string,
  dev: Developer,
  sched: ReturnType<typeof getSchedule>,
  tz: string,
  winStartMin: number,
  winEndMin: number,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
): WorkDay | null {
  const key = dev.id + '|' + dateStr
  const hit = dayCache.get(key)
  if (hit !== undefined) return hit

  let out: WorkDay | null = null
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
      if (winEnd > winStart) out = { winStart, winEnd, cap: effectiveDailyHours(dev, dateStr, scheduleHours, sched) }
    }
  }
  dayCache.set(key, out)
  return out
}

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
    const day = workDay(dateStr, dev, sched, tz, winStartMin, winEndMin, schedule, scheduleHours)

    if (day) {
      let rawH = 0
      for (const [s, e] of valid) {
        const overlap = Math.min(e, day.winEnd) - Math.max(s, day.winStart)
        if (overlap > 0) rawH += overlap / 3_600_000
      }
      if (rawH > 0) out.set(dateStr, { raw: rawH, cap: day.cap })
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
  accrualEndMs: number,
  dev: Developer,
  schedule: Record<string, Record<string, string>>,
  scheduleHours: Record<string, Record<string, number>>,
): StatusInterval[] {
  const out: StatusInterval[] = []
  for (let i = 0; i < sortedHistory.length; i++) {
    const startMs = atMs(sortedHistory[i]!)
    const endMs = i + 1 < sortedHistory.length ? atMs(sortedHistory[i + 1]!) : nowMs
    if (endMs <= startMs) continue
    // The row shows the whole span the status was held, but only the part that counted as
    // work carries hours -- otherwise a ticket left open read "11.1d" beside an "Actual
    // work" of a few hours, with nothing to explain the gap.
    const countedEnd = Math.min(endMs, accrualEndMs)
    out.push({
      status: sortedHistory[i]!.status,
      startMs,
      endMs,
      workH: countedEnd > startMs ? cappedWorkHours([[startMs, countedEnd]], dev, schedule, scheduleHours) : 0,
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

  const firstIp = sortedHistory.find((e) => e.status === 'inprogress')
  const startMs = firstIp ? atMs(firstIp) : null
  /*
   * When the issue arrived on the board, which is where lead time starts. Flow efficiency
   * is active work over the lead time -- the days an issue sits in To Do waiting for
   * someone to pick it up are exactly the waiting the measure is about, and leaving them
   * out is why this dashboard reported numbers far above the 15-40% the field works with.
   */
  const flightStartMs = sortedHistory.length ? atMs(sortedHistory[0]!) : null

  const deadlineAssumed = !!issue.deadline && !issue.deadlineTime
  // No deadline is not the same as no work: the issue still has effort, cycle time and
  // flow efficiency. It is only the on-time verdict that cannot be formed.
  const deadlineMs = issue.deadline
    ? tzWallClockMs(issue.deadline, issue.deadlineTime || sched.endTime, tz)
    : null

  /*
   * Delivery, best evidence first:
   *   1. the merge, where the provider recorded one -- the moment the work landed, and
   *      what every delivery-metrics tool measures to;
   *   2. otherwise the last push, a date somebody typed;
   *   3. otherwise the move into review or done.
   * A push is when work was offered, not when it arrived: taking it as delivery made a
   * follow-up commit during review look like a late delivery.
   */
  const mergeInstants = (issue.prs ?? [])
    .flatMap((p) => p.stateHistory ?? [])
    .filter((e) => e.state === 'merged')
    .map((e) => new Date(e.at).getTime())
    .filter((ms) => Number.isFinite(ms))
  const prInstants = (issue.prs ?? [])
    .filter((p) => p.date)
    .map((p) => tzWallClockMs(p.date, p.time || sched.endTime, tz))
  let deliveryMs: number | null = null
  let deliverySource: IssuePerf['deliverySource'] = null
  if (mergeInstants.length) {
    deliveryMs = Math.max(...mergeInstants)
    deliverySource = 'merge'
  } else if (prInstants.length) {
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

  /*
   * Work stops when the work is delivered. A ticket whose MR went up on the 10th but whose
   * Jira status was never moved off In Progress used to keep booking hours until today --
   * and, because a developer's day is shared out between the issues open in it, that
   * phantom work also ate the capacity of the issues they were genuinely working on.
   */
  const accrualEndMs = deliveryMs ?? nowMs

  /*
   * In flight until it was Done. Failing a Done entry, until it was delivered -- there is
   * no evidence of anything happening after that, and letting it run to "now" made the
   * flow efficiency of a delivered issue decay a little further every day.
   */
  const lastEntry = sortedHistory[sortedHistory.length - 1]
  const doneMs = lastEntry?.status === 'done' ? atMs(lastEntry) : null
  /*
   * The LATER of the two, not whichever happened to be checked first. A follow-up MR
   * pushed after the ticket was closed put delivery past the end of the span, so the
   * statuses were measured over a longer window than the span they are meant to divide
   * and the split came to more than the whole — which pushed the In Progress slice below
   * the flow-efficiency figure standing right beside it.
   */
  const flowEndMs = doneMs != null && deliveryMs != null ? Math.max(doneMs, deliveryMs)
    : doneMs ?? deliveryMs ?? nowMs

  /*
   * Both ends. The span being divided starts at the first In Progress, so anything before
   * that -- the days a ticket sat in To Do before anyone picked it up -- is outside it.
   * Counting that time in the split made the parts add up to more than the whole, which
   * dragged the In Progress slice below the flow-efficiency figure beside it.
   */
  const clipTo = (segments: Array<[number, number]>, end: number): Array<[number, number]> =>
    segments
      .map(([a, b]) => [Math.max(a, flightStartMs ?? a), Math.min(b, end)] as [number, number])
      .filter(([a, b]) => b > a)
  /*
   * Work stops at delivery; waiting does not. Clipping review at delivery erased the very
   * days an issue spent waiting to be reviewed -- which is the largest part of most spans,
   * and the thing flow efficiency exists to show.
   */
  const clip = (segments: Array<[number, number]>) => clipTo(segments, accrualEndMs)
  const clipSpan = (segments: Array<[number, number]>) => clipTo(segments, flowEndMs)

  const intervals = buildIntervals(sortedHistory, nowMs, accrualEndMs, dev, schedule, scheduleHours)

  const seg = (status: Status): Array<[number, number]> =>
    intervals.filter((iv) => iv.status === status).map((iv) => [iv.startMs, iv.endMs])
  // The stale cut-off only has to catch issues still running to "now"; anything delivered
  // is already bounded by its delivery.
  const inProgress = clampStaleTail(clip(seg('inprogress')), accrualEndMs, dev, schedule, scheduleHours)
  const blocked = clampStaleTail(clip(seg('blocked')), accrualEndMs, dev, schedule, scheduleHours)
  const stale = deliveryMs == null && (inProgress.stale || blocked.stale)

  /*
   * A day holds the developer's productive hours and no more, and the statuses of one issue
   * divide that day between them. Capping each status on its own let them overrun it: two
   * hours In Progress plus seven Blocked inside a nine-hour window both fitted under an
   * eight-hour cap, so the split came to nine hours of an eight-hour day and no longer
   * matched the span it is supposed to describe.
   */
  const dayRaw = new Map<string, { cap: number; total: number; byStatus: Map<Status, number> }>()
  for (const status of TRACKED_STATUSES) {
    const segments = status === 'inprogress' ? inProgress.segments
      : status === 'blocked' ? blocked.segments
      : clipSpan(seg(status))
    for (const [date, { raw, cap }] of workHoursByDay(segments, dev, schedule, scheduleHours)) {
      let d = dayRaw.get(date)
      if (!d) { d = { cap, total: 0, byStatus: new Map() }; dayRaw.set(date, d) }
      d.total += raw
      d.byStatus.set(status, (d.byStatus.get(status) ?? 0) + raw)
    }
  }
  /*
   * A nine-hour window holds eight productive hours, so a day's statuses can ask for more
   * than the day has. Work is served first and keeps the hours the timeline shows -- two
   * hours In Progress reads as two hours -- and the shortfall comes off the waiting, which
   * is where breaks actually fall. The parts still add up to exactly the day's capacity.
   */
  const dayByStatus = (d: { cap: number; total: number; byStatus: Map<Status, number> }) => {
    const out = new Map<Status, number>()
    const workRaw = d.byStatus.get('inprogress') ?? 0
    const workH = Math.min(workRaw, d.cap)
    if (workRaw > 0) out.set('inprogress', workH)

    const waitRaw = d.total - workRaw
    if (waitRaw > 1e-9) {
      const factor = Math.min(1, Math.max(0, d.cap - workH) / waitRaw)
      for (const [status, raw] of d.byStatus) {
        if (status !== 'inprogress') out.set(status, raw * factor)
      }
    }
    return out
  }

  const effortByDay = new Map<string, { raw: number; cap: number; dayTotal: number }>()
  let blockedH = 0
  for (const [date, d] of dayRaw) {
    const shared = dayByStatus(d)
    const ip = d.byStatus.get('inprogress')
    if (ip != null) effortByDay.set(date, { raw: ip, cap: d.cap, dayTotal: d.total })
    blockedH += shared.get('blocked') ?? 0
  }

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

  /*
   * The issue's original deadline, when it has been moved. Measuring against the current
   * one only says whether the last promise was kept; measuring against the first says
   * whether the work landed when it was first said it would.
   */
  const firstDue = issue.deadlineHistory?.[0]
  const originalMs = firstDue && firstDue.deadline !== issue.deadline
    ? tzWallClockMs(firstDue.deadline, firstDue.deadlineTime || sched.endTime, tz)
    : null

  const suspect = startMs != null && prInstants.length > 0 && Math.min(...prInstants) < startMs

  let timing: Timing | null = null
  let deliveryDeltaH: number | null = null
  let cycleH: number | null = null
  let verdict: Verdict

  if (!hasInProgress || startMs == null) {
    verdict = 'insufficient'
  } else if (deliveryMs != null && deadlineMs == null) {
    cycleH = cappedWorkHours([[startMs, Math.max(deliveryMs, startMs)]], dev, schedule, scheduleHours)
    verdict = 'deliveredNoDue'
  } else if (deliveryMs != null && deadlineMs != null) {
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
    verdict = deadlineMs != null && nowMs > deadlineMs + ON_TIME_TOLERANCE_MS ? 'overdue' : 'ongoing'
  }

  /*
   * Where the time went, by status, sharing each day between the statuses that claimed it
   * so the split adds up to the span rather than overrunning it. 'done' is left out: it is
   * the end state, not time spent.
   */
  const byStatus: Partial<Record<Status, number>> = {}
  if (flightStartMs != null) {
    for (const d of dayRaw.values()) {
      for (const [status, hours] of dayByStatus(d)) {
        if (hours > 1e-9) byStatus[status] = (byStatus[status] ?? 0) + hours
      }
    }
  }

  const flowSpanH = flightStartMs != null
    ? cappedWorkHours([[flightStartMs, Math.max(flowEndMs, flightStartMs)]], dev, schedule, scheduleHours)
    : null

  const hoursToDeadline = deliveryMs == null && deadlineMs != null && deadlineMs > nowMs
    ? cappedWorkHours([[nowMs, deadlineMs]], dev, schedule, scheduleHours)
    : null

  let timingVsOriginal: Timing | null = null
  let deadlineMovedDays: number | null = null
  if (originalMs != null && deadlineMs != null) {
    deadlineMovedDays = Math.round((deadlineMs - originalMs) / 86_400_000)
    if (deliveryMs != null) {
      timingVsOriginal = Math.abs(deliveryMs - originalMs) <= ON_TIME_TOLERANCE_MS
        ? 'onTime'
        : deliveryMs < originalMs ? 'early' : 'late'
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
    startMs,
    deliveryMs,
    deliverySource,
    effortByDay,
    effortH: 0,
    effortShareH: 0,
    blockedH,
    flowEffPct: null,
    cycleH,
    flowSpanH,
    reworkCount,
    timing,
    timingVsOriginal,
    deadlineMovedDays,
    byStatus,
    hoursToDeadline,
    untouchedH: 0, // filled once the developer's day has been shared out
    atRisk: false, // filled once the team's p85 is known
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
  // Claims on each day are the whole time an issue held the developer's attention, not
  // only its In Progress part — an issue blocked all afternoon still occupied that day.
  const dayTotals = new Map<string, number>()
  for (const ip of issues) {
    for (const [date, { dayTotal }] of ip.effortByDay) dayTotals.set(date, (dayTotals.get(date) ?? 0) + dayTotal)
  }

  for (const ip of issues) {
    let soloH = 0
    let shareH = 0
    for (const [date, { raw, cap, dayTotal }] of ip.effortByDay) {
      // Work first, as within the issue: In Progress keeps the hours its timeline shows.
      const own = Math.min(raw, cap)
      soloH += own
      // Across issues the day is divided by how much of it each one occupied; this issue's
      // work then shrinks by the same factor its day did.
      const claimed = dayTotals.get(date) ?? dayTotal
      const mine = Math.min(dayTotal, cap)
      const allotted = claimed > cap ? (dayTotal / claimed) * cap : mine
      shareH += mine > 1e-9 ? own * (allotted / mine) : 0
    }
    ip.effortH = soloH
    ip.effortShareH = shareH
    /*
     * The breakdown has to add up to the span the issue was in flight, so it uses the
     * issue's own hours. Putting the shared figure here invented waiting that never
     * happened: an issue that sat in In Progress from start to finish still showed hours
     * as "untouched", purely because other issues were open on the same days.
     */
    const accounted = Object.values(ip.byStatus).reduce((sum, h) => sum + h, 0)
    ip.untouchedH = Math.max(0, (ip.flowSpanH ?? 0) - accounted)

    /*
     * Flow efficiency the way the rest of the industry means it: active work over the whole
     * span the issue was in flight, review and QA waiting included. The old number was
     * effort / (effort + blocked), which counted only two statuses and ignored every other
     * kind of waiting -- so it read near 100% for everyone, and it rewarded never using the
     * Blocked status at all.
     */
    ip.flowEffPct = ip.flowSpanH != null && ip.flowSpanH > 1e-9
      ? Math.min(100, (soloH / ip.flowSpanH) * 100)
      : null

    const lowFlow = ip.flowEffPct != null && ip.flowEffPct < LOW_FLOW_EFF_PCT
    if (ip.verdict === 'great' && lowFlow) ip.verdict = 'onTimeBlocky'
    else if (ip.verdict === 'lateSolid' && lowFlow) ip.verdict = 'lateBlocky'
  }
}

/*
 * A line about the work, not a verdict on the person. It used to read "Often late ·
 * mostly waiting", which is a judgement drawn from ticket metadata: the lateness is
 * measured against a date somebody typed, and the waiting is usually a property of the
 * process rather than of whoever happens to be assigned. The facts are still all here --
 * on-time rate, flow efficiency, cycle time -- and mean more without a label on top.
 */
function profileOf(d: Pick<DevPerf, 'deliveredCount' | 'wipCount' | 'cycleP50H'>): string {
  const parts: string[] = []
  parts.push(d.deliveredCount === 1 ? '1 delivered' : `${d.deliveredCount} delivered`)
  if (d.wipCount) parts.push(`${d.wipCount} in progress`)
  if (d.cycleP50H != null) parts.push(`median cycle ${(d.cycleP50H / 8).toFixed(1)}d`)
  return parts.join(' · ')
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
  dayCache.clear()
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
      // An issue with no deadline used to be skipped outright, so a month of work on
      // tickets nobody dated showed up as nothing delivered -- and the cheapest way to
      // protect a score was to leave the deadline off.
      // Nothing that is still open is dropped here either, whatever its deadline says:
      // it is current work, and the range describes finished work. See the anchor test
      // below, which is the same rule applied once the issue has been measured.
      const stillOpen = !(issue.prs ?? []).some((p) => p.date)
        && !(issue.statusHistory ?? []).some((h) => h.status === 'done' || h.status === 'review')
      if (!stillOpen && issue.deadline && range.from && issue.deadline < range.from && !mightDeliverInRange(issue, range)) continue
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
    /*
     * The range picks a period of finished work; it does not pick a period of unfinished
     * work. Anything still in flight is open on someone's desk right now whatever window
     * is on screen -- filtering it by its deadline made "In progress" read 0 for "This
     * month" while eight issues sat open, and hid exactly the at-risk work the panel above
     * exists to surface.
     */
    const inFlight = ip.deliveryMs == null && ip.startMs != null
    if (!inFlight) {
      const anchorMs = ip.deliveryMs ?? ip.deadlineMs ?? ip.startMs
      if (anchorMs == null) continue
      if (fromMs != null && anchorMs < fromMs) continue
      if (toMs != null && anchorMs > toMs) continue
    }
    if (!perDev.has(devId)) perDev.set(devId, [])
    perDev.get(devId)!.push(ip)
  }

  // Effort, flow efficiency and the verdict need every issue of a developer at once.
  for (const issues of perDev.values()) finalizeDevIssues(issues)

  /*
   * Which unfinished issues are unlikely to make their date. Judged against the team's own
   * p85 cycle time -- the duration about six in seven issues finish within -- rather than
   * against a guess: if an issue has already been open that long, or there are not enough
   * working hours left before the deadline to cover what usually remains, it is at risk.
   */
  const everyIssue = [...perDev.values()].flat()
  const deliveredCycles = everyIssue
    .filter((i) => DELIVERED.includes(i.verdict) && i.cycleH != null)
    .map((i) => i.cycleH!)
  const p85 = percentile(deliveredCycles, 0.85)
  for (const ip of everyIssue) {
    if (ip.verdict === 'overdue') { ip.atRisk = true; continue }
    if (ip.verdict !== 'ongoing' || p85 == null) continue
    const age = ip.cycleH ?? 0
    // Already taken longer than about six in seven issues ever take: whatever is holding it
    // up is not the usual amount of work, so it is at risk whatever the deadline says.
    if (age > p85) { ip.atRisk = true; continue }
    // Otherwise: is there time left before the deadline for what usually remains?
    if (ip.deadlineMs == null) continue
    ip.atRisk = (ip.hoursToDeadline ?? 0) < p85 - age
  }

  const allIssues = [...perDev.values()].flat()
  const weeks = rangeWeeks(range, allIssues, nowMs)

  const devs: DevPerf[] = input.developers
    .filter((d) => !d.archivedAt)
    .map((dev) => {
      const issues = (perDev.get(dev.id) ?? []).sort((a, b) => {
        const od = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
        return od !== 0 ? od : (b.deadlineMs ?? 0) - (a.deadlineMs ?? 0)
      })
      const delivered = issues.filter((i) => DELIVERED.includes(i.verdict))
      const measured = issues.filter((i) => i.verdict !== 'insufficient')
      const n = delivered.length
      // Only issues that actually had a deadline can be on time or late.
      const judged = delivered.filter((i) => i.timing != null)
      const onTimeCount = judged.filter((i) => i.timing !== 'late').length
      const effortTotalH = measured.reduce((s, i) => s + i.effortShareH, 0)
      const effortSoloTotalH = measured.reduce((s, i) => s + i.effortH, 0)
      const blockedTotalH = measured.reduce((s, i) => s + i.blockedH, 0)
      // Aggregate flow efficiency is total work over total time in flight, to match the
      // per-issue figure. Summing the spans, not averaging the percentages, so a one-hour
      // issue does not weigh the same as a three-week one.
      const flowSpanTotalH = measured.reduce((s, i) => s + (i.flowSpanH ?? 0), 0)
      const reworkIssues = measured.filter((i) => i.reworkCount > 0).length
      const byStatus: Partial<Record<Status, number>> = {}
      for (const i of measured) {
        for (const [st, h] of Object.entries(i.byStatus)) {
          byStatus[st as Status] = (byStatus[st as Status] ?? 0) + h
        }
      }
      const base = {
        deliveredCount: n,
        onTimePct: judged.length ? (onTimeCount / judged.length) * 100 : null,
        flowEffPct: flowSpanTotalH > 1e-9 ? Math.min(100, (effortSoloTotalH / flowSpanTotalH) * 100) : null,
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
        effortSoloTotalH,
        blockedTotalH,
        flowSpanTotalH,
        medEffortH: median(delivered.map((i) => i.effortH)),
        medBlockedH: median(delivered.map((i) => i.blockedH)),
        cycleP50H: percentile(delivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.5),
        cycleP85H: percentile(delivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.85),
        throughputWk: n ? n / weeks : null,
        reworkIssues,
        reworkRatePct: measured.length ? (reworkIssues / measured.length) * 100 : null,
        wipCount: issues.filter((i) => i.verdict === 'ongoing' || i.verdict === 'overdue').length,
        atRiskCount: issues.filter((i) => i.atRisk).length,
        byStatus,
        untouchedH: measured.reduce((sum, i) => sum + i.untouchedH, 0),
        profile: profileOf({
          deliveredCount: n,
          wipCount: issues.filter((i) => i.verdict === 'ongoing' || i.verdict === 'overdue').length,
          cycleP50H: percentile(delivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.5),
        }),
      }
    })
    // By name, not by score. Sorting people by on-time percentage made the list read as a
    // league table, which is not what flow metrics can honestly support.
    .sort((a, b) => a.dev.name.localeCompare(b.dev.name))

  const allDelivered = devs.flatMap((d) => d.issues.filter((i) => DELIVERED.includes(i.verdict)))
  const allJudged = allDelivered.filter((i) => i.timing != null)
  const movedAndJudged = allDelivered.filter((i) => i.timingVsOriginal != null)
  const teamByStatus: Partial<Record<Status, number>> = {}
  for (const d of devs) {
    for (const [st, h] of Object.entries(d.byStatus)) {
      teamByStatus[st as Status] = (teamByStatus[st as Status] ?? 0) + h
    }
  }
  const teamEffort = devs.reduce((s, d) => s + d.effortSoloTotalH, 0)
  const teamSpan = devs.reduce((s, d) => s + d.flowSpanTotalH, 0)
  const teamMeasured = devs.reduce((s, d) => s + (d.issues.length - d.insufficientCount), 0)
  const teamRework = devs.reduce((s, d) => s + d.reworkIssues, 0)
  const n = allDelivered.length

  return {
    devs,
    deliveredCount: n,
    onTimePct: allJudged.length ? (allJudged.filter((i) => i.timing !== 'late').length / allJudged.length) * 100 : null,
    flowEffPct: teamSpan > 1e-9 ? Math.min(100, (teamEffort / teamSpan) * 100) : null,
    cycleP50H: percentile(allDelivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.5),
    cycleP85H: percentile(allDelivered.filter((i) => i.cycleH != null).map((i) => i.cycleH!), 0.85),
    medDeliveryDeltaH: median(allDelivered.filter((i) => i.deliveryDeltaH != null).map((i) => i.deliveryDeltaH!)),
    throughputWk: n ? n / weeks : null,
    reworkRatePct: teamMeasured ? (teamRework / teamMeasured) * 100 : null,
    ongoingCount: devs.reduce((s, d) => s + d.ongoingCount, 0),
    overdueCount: devs.reduce((s, d) => s + d.overdueCount, 0),
    atRiskCount: devs.reduce((s, d) => s + d.atRiskCount, 0),
    // Against the deadline each issue started with, where that is not the one it ended with.
    onTimeVsOriginalPct: movedAndJudged.length
      ? (movedAndJudged.filter((i) => i.timingVsOriginal !== 'late').length / movedAndJudged.length) * 100
      : null,
    movedDeadlineCount: everyIssue.filter((i) => i.deadlineMovedDays != null && i.deadlineMovedDays !== 0).length,
    byStatus: teamByStatus,
    untouchedH: devs.reduce((sum, d) => sum + d.untouchedH, 0),
    weeks,
  }
}
