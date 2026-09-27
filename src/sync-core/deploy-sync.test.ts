import { describe, expect, it } from 'vitest'
import type { DeploymentRecord } from '../types'
import { mergeDeployments } from './deploy-sync'

const rec = (id: string, createdAt: string, status: DeploymentRecord['status'] = 'success'): DeploymentRecord => ({
  id, provider: 'gitlab', repo: 'acme/web', environment: 'production', status, createdAt,
})

describe('merging what a sync found with what is already held', () => {
  it('keeps one record per deployment and takes the fresher copy', () => {
    // A deployment that was running last sync and has since succeeded.
    const held = [rec('a', '2026-09-01T10:00:00Z', 'running'), rec('b', '2026-09-02T10:00:00Z')]
    const fresh = [rec('a', '2026-09-01T10:00:00Z', 'success'), rec('c', '2026-09-03T10:00:00Z')]

    const out = mergeDeployments(held, fresh)

    expect(out).toHaveLength(3)
    expect(out.find((d) => d.id === 'a')!.status).toBe('success')
  })

  it('returns them newest first', () => {
    const out = mergeDeployments([], [rec('old', '2026-09-01T10:00:00Z'), rec('new', '2026-09-09T10:00:00Z')])
    expect(out.map((d) => d.id)).toEqual(['new', 'old'])
  })

  it('leaves what is held alone when a sync finds nothing', () => {
    const held = [rec('a', '2026-09-01T10:00:00Z')]
    expect(mergeDeployments(held, [])).toEqual(held)
  })
})
