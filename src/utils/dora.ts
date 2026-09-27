import type { DeploymentRecord } from '../types'

/*
 * The four DORA measures, computed from the deployment records the git host publishes.
 *
 * Three of them cannot be derived from anything else the tracker holds: Jira knows when
 * work was called done and the git host knows when it was merged, but neither says when a
 * change reached production. Where a project publishes no deployments, these are null and
 * the dashboard says so rather than inventing a figure from what it does have.
 *
 * Lead time here is the full one — merge to production — unlike the PR figure on the main
 * strip, which stops at the merge because that is all the PR data reaches.
 */

export interface DoraInput {
  deployments: DeploymentRecord[]
  /** Merge instants (ms) of the changes delivered in the window, for lead time. */
  mergeMs: number[]
  fromMs: number
  toMs: number
}

export interface DoraMetrics {
  /** Successful production deployments per week. */
  deployFreqWk: number | null
  /** Share of production deployments that failed. */
  changeFailPct: number | null
  /** Median hours from a failed deployment to the next successful one. */
  recoveryP50H: number | null
  /** Median calendar hours from a merge to the first production deployment after it. */
  leadTimeP50H: number | null
  deployCount: number
  failedCount: number
  /** Nothing to measure: no project in range publishes deployment records. */
  noData: boolean
}

/*
 * Providers let people name environments freely. Anything that looks like production
 * counts; a name nobody recognises is left out rather than silently treated as live.
 */
export function isProduction(environment: string): boolean {
  return /^(production|prod|live|master|main)$/i.test(environment.trim())
    || /\b(production|prod)\b/i.test(environment)
}

const ms = (iso: string | undefined): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const sorted = [...xs].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

export function computeDora(input: DoraInput): DoraMetrics {
  const { fromMs, toMs } = input
  const empty: DoraMetrics = {
    deployFreqWk: null, changeFailPct: null, recoveryP50H: null, leadTimeP50H: null,
    deployCount: 0, failedCount: 0, noData: true,
  }
  if (!input.deployments.length) return empty

  const prod = input.deployments
    .filter((d) => isProduction(d.environment))
    .map((d) => ({ ...d, at: ms(d.finishedAt) ?? ms(d.createdAt) }))
    .filter((d): d is typeof d & { at: number } => d.at != null)
    .sort((a, b) => a.at - b.at)

  if (!prod.length) return empty

  // Still-running deployments have not succeeded or failed yet, so they count for neither.
  const settled = prod.filter((d) => d.status === 'success' || d.status === 'failed')
  const inWindow = settled.filter((d) => d.at >= fromMs && d.at <= toMs)
  const succeeded = inWindow.filter((d) => d.status === 'success')
  const failed = inWindow.filter((d) => d.status === 'failed')

  const weeks = Math.max(1 / 7, (toMs - fromMs) / (7 * 86_400_000))

  /*
   * Recovery: a failure is over at the next successful production deployment, whenever it
   * lands. Looked up across every settled deployment, not only those inside the window,
   * so a failure late in the period still finds the fix that came after it.
   */
  const recoveries: number[] = []
  for (const f of failed) {
    const fix = settled.find((d) => d.status === 'success' && d.at > f.at)
    if (fix) recoveries.push((fix.at - f.at) / 3_600_000)
  }

  /*
   * Lead time: from the merge to the first production deployment that followed it. An
   * approximation — the provider does not say which commits a deployment carried — but the
   * right shape, and far closer than stopping at the merge.
   */
  const leadTimes: number[] = []
  for (const mergedAt of input.mergeMs) {
    const shipped = succeeded.find((d) => d.at >= mergedAt)
    if (shipped) leadTimes.push((shipped.at - mergedAt) / 3_600_000)
  }

  return {
    deployFreqWk: succeeded.length / weeks,
    changeFailPct: inWindow.length ? (failed.length / inWindow.length) * 100 : null,
    recoveryP50H: percentile(recoveries, 0.5),
    leadTimeP50H: percentile(leadTimes, 0.5),
    deployCount: succeeded.length,
    failedCount: failed.length,
    noData: false,
  }
}

/** The published DORA bands, so a number can say what it means. */
export function deployFreqBand(perWeek: number | null): string | null {
  if (perWeek == null) return null
  if (perWeek >= 7) return 'elite (daily or better)'
  if (perWeek >= 1) return 'high (weekly)'
  if (perWeek >= 1 / 4.3) return 'medium (monthly)'
  return 'low (rarer than monthly)'
}

export function changeFailBand(pct: number | null): string | null {
  if (pct == null) return null
  return pct <= 15 ? 'elite / high (≤15%)' : pct <= 30 ? 'medium (≤30%)' : 'low (>30%)'
}

export function recoveryBand(hours: number | null): string | null {
  if (hours == null) return null
  if (hours < 1) return 'elite (<1h)'
  if (hours < 24) return 'high (<1d)'
  if (hours < 24 * 7) return 'medium (<1wk)'
  return 'low (>1wk)'
}
