import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JiraConfig, Task } from '../types'
import { latestWorkday } from '../utils/dates'
import { useStore } from './index'

const TODAY = latestWorkday()
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

function conn(patch: Partial<JiraConfig> = {}): JiraConfig {
  return {
    id: 'j1', name: 'Mabrook', enabled: true, baseUrl: 'https://x.atlassian.net', email: 'a@b.c',
    token: '', tokenInVault: true, projectKeys: ['COM'], syncInterval: 5, projectId: 'p1', hoursPerDay: 8,
    developerEmails: { d1: ['dev@x.com'] },
    statusMappings: [{ jiraStatus: 'To Do', groupId: 'todo' }],
    ...patch,
  }
}

const raw = (key: string) => ({
  key,
  fields: { summary: key, status: { name: 'To Do', statusCategory: { key: 'new' } }, assignee: { emailAddress: 'dev@x.com', displayName: 'Dev' } },
})

function seed(connection: JiraConfig) {
  useStore.setState({
    developers: [{ id: 'd1', name: 'Dev', color: '#000', role: 'dev', periods: [] }],
    projects: [{ id: 'p1', name: 'Mabrook', desc: '', color: '#000', members: ['d1'], nonWorkingDays: [] }],
    jiraConnections: [connection],
    tasks: [{
      id: 't1', devId: 'd1', projectId: 'p1', date: TODAY, title: 'Jira Issues', status: 'inprogress', jiraSync: true, prs: [],
      jiras: [{ url: 'https://x.atlassian.net/browse/COM-1', issueId: 'COM-1', name: 'COM-1', status: 'todo', groupId: 'todo', jiraStatusName: 'To Do', prs: [], comment: '', priority: 'low', deadline: '', deadlineTime: '' }],
    }] as unknown as Task[],
  })
}

const fetchMock = vi.fn()
const jqls = () => fetchMock.mock.calls
  .filter((c) => String(c[0]).includes('/pm-tracker/jira-search'))
  .map((c) => JSON.parse((c[1] as RequestInit).body as string).jql as string)
const issueKeys = () => useStore.getState().tasks.flatMap((t) => (t.jiras ?? []).map((j) => j.issueId))

// Jira returns COM-2 only: COM-1 is absent from this fetch.
function jiraReturns(keys: string[]) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/pm-tracker/jira-search')) {
      return Promise.resolve(new Response(JSON.stringify({ issues: keys.map(raw), truncated: false }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.setItem('pm_tracker_token', 'session')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('incremental sync', () => {
  it('a background sync fetches only issues updated since the last one', async () => {
    seed(conn({ lastSync: minutesAgo(5), lastFullSync: minutesAgo(60) }))
    jiraReturns(['COM-2'])
    await useStore.getState().syncJira({ background: true })
    expect(jqls()[0]).toMatch(/updated >= -1[5-6]m/) // 5 minutes since + 10 minute margin
  })

  it('an incremental sync never deletes an issue Jira did not return', async () => {
    // Absence from an "updated since" fetch is not proof the issue is gone.
    const lastFull = minutesAgo(60)
    seed(conn({ lastSync: minutesAgo(5), lastFullSync: lastFull }))
    jiraReturns(['COM-2'])
    await useStore.getState().syncJira({ background: true })
    expect(issueKeys()).toContain('COM-1')
    expect(issueKeys()).toContain('COM-2')
    // ...and it does not count as a full sync.
    expect(useStore.getState().jiraConnections[0]!.lastFullSync).toBe(lastFull)
  })

  it('a manual sync is always full, and full syncs still prune', async () => {
    seed(conn({ lastSync: minutesAgo(5), lastFullSync: minutesAgo(60) }))
    jiraReturns(['COM-2'])
    await useStore.getState().syncJira()
    expect(jqls()[0]).not.toContain('updated >= -1')
    expect(issueKeys()).not.toContain('COM-1')
    expect(issueKeys()).toContain('COM-2')
    expect(Date.parse(useStore.getState().jiraConnections[0]!.lastFullSync!)).toBeGreaterThan(Date.now() - 60_000)
  })

  it('a background sync turns full once the last full sync is too old', async () => {
    seed(conn({ lastSync: minutesAgo(5), lastFullSync: minutesAgo(7 * 60) }))
    jiraReturns(['COM-2'])
    await useStore.getState().syncJira({ background: true })
    expect(jqls()[0]).not.toContain('updated >= -1')
    expect(issueKeys()).not.toContain('COM-1')
  })
})

describe('cross-tab sync lock', () => {
  it('a background sync skips while another tab is syncing', async () => {
    seed(conn({ lastSync: minutesAgo(5), lastFullSync: minutesAgo(60) }))
    jiraReturns(['COM-2'])
    // Another tab holds the lock: ifAvailable requests get no lock.
    vi.stubGlobal('navigator', { ...navigator, locks: {
      request: (_name: string, opts: unknown, cb?: (lock: unknown) => unknown) =>
        Promise.resolve((typeof opts === 'function' ? opts : cb!)(null)),
    } })
    const result = await useStore.getState().syncJira({ background: true })
    expect(result).toEqual({ added: 0, updated: 0, removed: 0 })
    expect(jqls()).toHaveLength(0)
  })

  it('a manual sync waits for the lock and then runs', async () => {
    seed(conn())
    jiraReturns(['COM-1'])
    const request = vi.fn((_name: string, cb: (lock: unknown) => unknown) => Promise.resolve(cb({ name: 'pm-sync-jira' })))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    await useStore.getState().syncJira()
    expect(request).toHaveBeenCalledWith('pm-sync-jira', expect.any(Function))
    expect(jqls()).toHaveLength(1)
  })
})
