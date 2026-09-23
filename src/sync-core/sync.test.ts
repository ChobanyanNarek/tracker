import { describe, expect, it } from 'vitest'
import type { GitHubConfig, GitLabConfig, JiraConfig, JiraIssue, Task } from '../types'
import { applyJiraSync, computeJiraSync, type SyncState } from './jira-sync'
import { applyGithubSync, applyGitlabSync, computeGithubSync, computeGitlabSync } from './pr-sync'
import type { Transport } from './transport'

/*
 * The shared sync core on its own, with a fake transport standing in for the backend's
 * provider endpoints -- the same code path the server-side sync runs.
 */

const TODAY = '2026-09-23'
const run = { today: TODAY, tz: 'Asia/Yerevan' }

function jiraConn(patch: Partial<JiraConfig> = {}): JiraConfig {
  return {
    id: 'j1', name: 'Mabrook', enabled: true, baseUrl: 'https://mab.atlassian.net', email: 'a@b.c', token: 'tok',
    projectKeys: ['COM'], syncInterval: 5, projectId: 'p1', hoursPerDay: 8,
    developerEmails: { d1: ['dev@mab.com'] },
    statusMappings: [{ jiraStatus: 'To Do', groupId: 'todo' }, { jiraStatus: 'Code Review', groupId: 'review' }],
    ...patch,
  }
}

function issue(key: string, patch: Partial<JiraIssue> = {}): JiraIssue {
  return { issueId: key, url: `https://mab.atlassian.net/browse/${key}`, name: key, status: 'todo', priority: 'low', deadline: '', deadlineTime: '', prs: [], comment: '', ...patch }
}

function task(id: string, projectId: string, jiras: JiraIssue[], patch: Partial<Task> = {}): Task {
  return {
    id, devId: 'd1', projectId, title: 'Jira Issues', status: 'inprogress', jira: '', pr: '', prs: [],
    deadline: '', deadlineTime: '', reviewDate: '', reviewTime: '', comment: '', date: TODAY, jiraSync: true, jiras, ...patch,
  } as Task
}

function state(patch: Partial<SyncState> = {}): SyncState {
  return {
    developers: [{ id: 'd1', name: 'Dev', color: '#000', role: 'dev', periods: [] }],
    projects: [
      { id: 'p1', name: 'Mabrook', desc: '', color: '#000', members: ['d1'], nonWorkingDays: [0, 6] },
      { id: 'p2', name: 'Mindport', desc: '', color: '#000', members: ['d1'], nonWorkingDays: [0, 6] },
    ],
    tasks: [],
    jiraConnections: [],
    gitlabConnections: [],
    githubConnections: [],
    ...patch,
  } as SyncState
}

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
})

// Routes each backend path to a handler; records every call.
function fakeTransport(routes: Record<string, (body: Record<string, unknown>) => unknown>): Transport & { calls: Array<{ path: string; body: Record<string, unknown> }> } {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  return {
    calls,
    post: (path, body) => {
      calls.push({ path, body })
      const route = routes[path]
      return Promise.resolve(route ? json(route(body)) : json({ message: 'no route' }, 404))
    },
  }
}

const rawIssue = (key: string, status = 'To Do') => ({
  key,
  fields: { summary: `${key} summary`, status: { name: status, statusCategory: { key: 'indeterminate' } }, assignee: { emailAddress: 'dev@mab.com', displayName: 'Dev' } },
})

describe('Jira sync core', () => {
  it("adds fetched issues to today's task in the connection's own project only", async () => {
    const s = state({
      jiraConnections: [jiraConn()],
      tasks: [task('t1', 'p1', [issue('COM-1')]), task('t2', 'p2', [issue('MIN-9')])],
    })
    const t = fakeTransport({ '/pm-tracker/jira-search': () => ({ issues: [rawIssue('COM-1', 'Code Review'), rawIssue('COM-2')], truncated: false }) })

    const plan = await computeJiraSync(s, t, run)
    const next = applyJiraSync(s, plan)

    expect(plan.counts).toEqual({ added: 1, updated: 1, removed: 0 })
    const mab = next.tasks.find((x) => x.id === 't1')!
    expect(mab.jiras.map((j) => [j.issueId, j.groupId])).toEqual([['COM-1', 'review'], ['COM-2', 'todo']])
    // The other project's task is untouched.
    expect(next.tasks.find((x) => x.id === 't2')!.jiras.map((j) => j.issueId)).toEqual(['MIN-9'])
    expect(next.jiraConnections[0]!.lastSync).toBeDefined()
  })

  it('sends the connection’s credential with each call, never another connection’s', async () => {
    const s = state({ jiraConnections: [jiraConn({ token: '', tokenInVault: true })] })
    const t = fakeTransport({ '/pm-tracker/jira-search': () => ({ issues: [], truncated: false }) })
    await computeJiraSync(s, t, run)
    expect(t.calls[0]!.body).toMatchObject({ connectionId: 'j1', baseUrl: 'https://mab.atlassian.net' })
    expect(t.calls[0]!.body.token).toBeUndefined()
  })

  it('creates today’s task when the developer has none yet', async () => {
    const s = state({ jiraConnections: [jiraConn()] })
    const t = fakeTransport({ '/pm-tracker/jira-search': () => ({ issues: [rawIssue('COM-5')], truncated: false }) })
    const next = applyJiraSync(s, await computeJiraSync(s, t, run))
    expect(next.tasks).toHaveLength(1)
    expect(next.tasks[0]).toMatchObject({ devId: 'd1', projectId: 'p1', date: TODAY, jiraSync: true })
  })

  it('keeps edits made while the sync was running', async () => {
    const s = state({ jiraConnections: [jiraConn()], tasks: [task('t1', 'p1', [issue('COM-1')])] })
    const t = fakeTransport({ '/pm-tracker/jira-search': () => ({ issues: [rawIssue('COM-1')], truncated: false }) })
    const plan = await computeJiraSync(s, t, run)
    // Meanwhile the user commented on the task.
    const live = { ...s, tasks: [{ ...s.tasks[0]!, comment: 'typed during sync' }] }
    expect(applyJiraSync(live, plan).tasks[0]!.comment).toBe('typed during sync')
  })

  it('refuses to run with no usable connection', async () => {
    await expect(computeJiraSync(state({ jiraConnections: [jiraConn({ token: '' })] }), fakeTransport({}), run))
      .rejects.toThrow('No Jira connections configured')
  })
})

describe('GitLab sync core', () => {
  const gitlab = (patch: Partial<GitLabConfig> = {}): GitLabConfig => ({
    id: 'gl1', name: 'GL', enabled: true, token: 'tok', groupPath: 'acme', syncInterval: 5, projectId: 'p1', ...patch,
  } as GitLabConfig)
  const mr = (id: number, branch: string) => ({
    id, iid: id, title: 'work', source_branch: branch, web_url: `https://gitlab.com/acme/web/-/merge_requests/${id}`,
    created_at: '2026-09-22T08:30:00Z', merged_at: '2026-09-22T10:00:00Z', state: 'merged', author: { id: 1, username: 'dev', name: 'Dev' }, assignees: [],
  })

  it("links an MR to the issue its branch names, inside the connection's project only", async () => {
    const s = state({
      jiraConnections: [jiraConn()],
      gitlabConnections: [gitlab()],
      // The same key exists in both projects; only p1 belongs to this GitLab connection.
      tasks: [task('t1', 'p1', [issue('COM-7')]), task('t2', 'p2', [issue('COM-7')])],
    })
    const t = fakeTransport({
      '/pm-tracker/gitlab': (body) => ({ status: 200, data: String(body.path).includes('state=merged') && String(body.path).includes('/groups/') ? [mr(11, 'feature/COM-7-login')] : [] }),
    })

    const plan = await computeGitlabSync(s, t, run)
    const next = applyGitlabSync(s, plan)

    expect(plan.counts.linked).toBe(1)
    const linkedPr = next.tasks.find((x) => x.id === 't1')!.jiras[0]!.prs[0]!
    expect(linkedPr).toMatchObject({ url: 'https://gitlab.com/acme/web/-/merge_requests/11', state: 'merged' })
    // Recorded in the tracker's timezone (UTC+4), not the server's.
    expect(linkedPr.date).toBe('2026-09-22')
    expect(linkedPr.time).toBe('12:30')
    expect(next.tasks.find((x) => x.id === 't2')!.jiras[0]!.prs).toEqual([])
  })
})

describe('GitHub sync core', () => {
  const github = (patch: Partial<GitHubConfig> = {}): GitHubConfig => ({
    id: 'gh1', name: 'GH', enabled: true, token: 'tok', orgOrUser: 'acme/web', syncInterval: 5, projectId: 'p1', ...patch,
  } as GitHubConfig)

  it('links a PR by its title key and drops a link whose PR no longer mentions the issue', async () => {
    const stale = { url: 'https://github.com/acme/web/pull/3', date: '', time: '' }
    const s = state({
      jiraConnections: [jiraConn()],
      githubConnections: [github()],
      tasks: [task('t1', 'p1', [issue('COM-1'), issue('COM-2', { prs: [stale] })])],
    })
    const pulls = [
      { id: 1, number: 2, title: 'COM-1 fix login', html_url: 'https://github.com/acme/web/pull/2', created_at: '2026-09-22T08:00:00Z', state: 'open', user: { login: 'dev' } },
      { id: 2, number: 3, title: 'COM-1 follow-up', html_url: 'https://github.com/acme/web/pull/3', created_at: '2026-09-22T09:00:00Z', state: 'open', user: { login: 'dev' } },
    ]
    const t = fakeTransport({
      '/pm-tracker/github': (body) => ({ status: 200, data: String(body.path).includes('state=open') ? pulls : [] }),
    })

    const next = applyGithubSync(s, await computeGithubSync(s, t, run))
    const [com1, com2] = next.tasks[0]!.jiras
    expect(com1!.prs.map((p) => p.url).sort()).toEqual(['https://github.com/acme/web/pull/2', 'https://github.com/acme/web/pull/3'])
    expect(com1!.status).toBe('review')
    // PR 3 now names COM-1, not COM-2: the old link goes.
    expect(com2!.prs).toEqual([])
  })
})
