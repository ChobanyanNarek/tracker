import { describe, expect, it, vi, afterEach } from 'vitest'
import { computeGithubSync, isRateLimited } from './pr-sync'
import type { SyncState } from './jira-sync'
import type { Transport } from './transport'
import type { GitHubConfig } from '../types'

/*
 * Carrying on asking while GitHub is refusing keeps the budget empty, and for a secondary
 * limit it lengthens the penalty. This is what stops the app doing that to itself.
 */

afterEach(() => vi.useRealTimers())

const conn = (id: string): GitHubConfig => ({
  id, name: 'Mabrook', enabled: true, token: 'tok', orgOrUser: 'https://github.com/acme',
  syncInterval: 2, developerUsernames: {},
})

const state = (id: string): SyncState => ({
  developers: [], projects: [], tasks: [], jiraConnections: [], gitlabConnections: [],
  githubConnections: [conn(id)], deployments: [],
})

/** Answers every repo listing with GitHub's rate-limit refusal. */
const throttling: Transport = {
  post: () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ status: 403, data: { message: 'API rate limit exceeded for user ID 1.' } }),
    text: () => Promise.resolve(''),
  }),
}

const run = (background: boolean) => ({ background, today: '2026-09-27', tz: 'Asia/Yerevan' })

describe('a rate-limited connection', () => {
  it('stops being asked on background syncs until the cooldown passes', async () => {
    vi.useFakeTimers()
    const s = state('gh_1')

    await expect(computeGithubSync(s, throttling, run(false))).rejects.toThrow(/rate-limiting/i)
    expect(isRateLimited('gh_1')).toBe(true)

    // The next background sync leaves it alone rather than asking again.
    const plan = await computeGithubSync(s, throttling, run(true))
    expect(plan.counts).toEqual({ linked: 0, updated: 0 })

    vi.advanceTimersByTime(16 * 60_000)
    expect(isRateLimited('gh_1')).toBe(false)
  })

  it('still goes when the user asks for it, since they may have waited', async () => {
    vi.useFakeTimers()
    const s = state('gh_2')
    await expect(computeGithubSync(s, throttling, run(false))).rejects.toThrow(/rate-limiting/i)

    // A manual sync tries again and reports honestly rather than silently doing nothing.
    await expect(computeGithubSync(s, throttling, run(false))).rejects.toThrow(/rate-limiting/i)
  })
})
