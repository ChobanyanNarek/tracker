import { describe, expect, it } from 'vitest'
import type { DeploymentRecord } from '../types'
import { changeFailBand, computeDora, deployFreqBand, isProduction, recoveryBand } from './dora'

const at = (iso: string) => new Date(iso).getTime()
const WINDOW = { fromMs: at('2026-09-01T00:00:00Z'), toMs: at('2026-09-29T00:00:00Z') } // 4 weeks

function dep(id: string, iso: string, status: DeploymentRecord['status'], environment = 'production'): DeploymentRecord {
  return { id, provider: 'gitlab', repo: 'acme/web', environment, status, createdAt: iso, finishedAt: iso }
}

describe('what counts as production', () => {
  it('accepts the names providers actually use', () => {
    for (const name of ['production', 'Production', 'prod', 'live', 'main', 'production-eu', 'eu prod'])
      expect(isProduction(name), name).toBe(true)
  })

  it('leaves out everything else rather than guessing', () => {
    for (const name of ['staging', 'qa', 'review/mr-12', 'preview', 'dev', 'test'])
      expect(isProduction(name), name).toBe(false)
  })
})

describe('the four measures', () => {
  const deployments = [
    dep('1', '2026-09-02T10:00:00Z', 'success'),
    dep('2', '2026-09-09T10:00:00Z', 'success'),
    dep('3', '2026-09-16T10:00:00Z', 'failed'),
    dep('4', '2026-09-16T13:00:00Z', 'success'), // the fix, three hours later
    dep('5', '2026-09-23T10:00:00Z', 'success'),
    dep('6', '2026-09-23T11:00:00Z', 'success', 'staging'), // not production
  ]

  it('counts frequency over the window, production only', () => {
    const d = computeDora({ deployments, mergeMs: [], ...WINDOW })
    expect(d.deployCount).toBe(4)          // the staging one is not a deployment to anybody
    expect(d.deployFreqWk).toBeCloseTo(1, 1) // four successes in four weeks
    expect(deployFreqBand(d.deployFreqWk)).toBe('high (weekly)')
  })

  it('reports the share that failed, and how long the failure lasted', () => {
    const d = computeDora({ deployments, mergeMs: [], ...WINDOW })
    expect(d.failedCount).toBe(1)
    expect(d.changeFailPct).toBeCloseTo(20, 1) // 1 of 5 settled production deployments
    expect(d.recoveryP50H).toBeCloseTo(3, 1)
    expect(changeFailBand(d.changeFailPct)).toBe('medium (≤30%)')
    expect(recoveryBand(d.recoveryP50H)).toBe('high (<1d)')
  })

  it('measures lead time from the merge to the deployment that followed it', () => {
    const d = computeDora({
      deployments,
      mergeMs: [at('2026-09-01T10:00:00Z'), at('2026-09-08T10:00:00Z')],
      ...WINDOW,
    })
    expect(d.leadTimeP50H).toBeCloseTo(24, 1) // each waited a day for the next deployment
  })

  it('says it has nothing rather than inventing a figure', () => {
    expect(computeDora({ deployments: [], mergeMs: [], ...WINDOW }).noData).toBe(true)
    // Records exist, but none of them went anywhere anyone would call production.
    const stagingOnly = [dep('s', '2026-09-02T10:00:00Z', 'success', 'staging')]
    const d = computeDora({ deployments: stagingOnly, mergeMs: [], ...WINDOW })
    expect(d.noData).toBe(true)
    expect(d.deployFreqWk).toBeNull()
  })

  it('leaves a deployment still running out of both counts', () => {
    const running = [...deployments, dep('7', '2026-09-24T10:00:00Z', 'running')]
    const d = computeDora({ deployments: running, mergeMs: [], ...WINDOW })
    expect(d.deployCount).toBe(4)
    expect(d.changeFailPct).toBeCloseTo(20, 1) // unchanged: it is neither a success nor a failure
  })

  it('finds the fix even when it lands after the window closes', () => {
    const lateFix = [
      dep('a', '2026-09-28T10:00:00Z', 'failed'),
      dep('b', '2026-10-02T10:00:00Z', 'success'), // outside the window
    ]
    const d = computeDora({ deployments: lateFix, mergeMs: [], ...WINDOW })
    expect(d.recoveryP50H).toBeCloseTo(96, 1)
  })
})
