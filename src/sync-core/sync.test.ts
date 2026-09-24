import { describe, expect, it } from 'vitest'
import type { GitHubConfig, GitLabConfig, JiraConfig, JiraIssue, PrEntry, Task } from '../types'
import { jiraDedupeKey } from './keys'
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

describe('PR linking finds exactly what a full scan would', () => {
  // The old rule, applied to every issue of every task: the index must agree with it.
  function scan(tasks: Task[], keys: string[], projectId: string, withUrl: boolean): string[] {
    const keySet = new Set(keys)
    const res = keys.map((key) => new RegExp(`(^|[^A-Za-z0-9])${key}([^0-9]|$)`, 'i'))
    const hits: string[] = []
    for (const t of tasks) {
      if (projectId && t.projectId !== projectId) continue
      for (const j of t.jiras) {
        const k = jiraDedupeKey(j.url, j.name)
        const ok = (j.issueId && keySet.has(j.issueId.toUpperCase()))
          || (k && k !== 'name:' && keySet.has(k.toUpperCase()))
          || (withUrl && res.some((re) => re.test(j.url ?? '')))
        const identity = j.issueId ?? (j.url || null)
        if (ok && identity) hits.push(`${t.id}|${identity}`)
      }
    }
    return hits.sort()
  }

  const odd: JiraIssue[] = [
    issue('COM-7'),
    { ...issue('X'), issueId: undefined, url: 'https://mab.atlassian.net/browse/com-7', name: 'lowercase key only in the URL' },
    { ...issue('X'), issueId: undefined, url: 'https://mab.atlassian.net/browse/COM-70', name: 'COM-70 not COM-7' },
    { ...issue('X'), issueId: undefined, url: 'https://mab.atlassian.net/browse/XCOM-7', name: 'prefix glued on' },
    { ...issue('X'), issueId: undefined, url: 'https://mab.atlassian.net/secure/ABC-COM-7x', name: 'key after a hyphen' },
    { ...issue('X'), issueId: undefined, url: '', name: 'COM-7 in the name only' },
    { ...issue('X'), issueId: 'com-7', url: 'https://elsewhere.example/7', name: 'lowercase issue id' },
  ]

  const tasksFor = (): Task[] => [task('a', 'p1', odd), task('b', 'p2', odd), task('c', 'p1', [issue('COM-8')])]

  const linked = (patches: Map<string, Map<string, PrEntry[]>>): string[] =>
    [...patches].flatMap(([taskId, byIssue]) => [...byIssue.keys()].map((identity) => `${taskId}|${identity}`)).sort()

  it('GitLab (which also matches keys inside issue URLs)', async () => {
    const s = state({
      jiraConnections: [jiraConn()],
      gitlabConnections: [{ id: 'gl1', name: 'GL', enabled: true, token: 't', groupPath: 'acme', syncInterval: 5, projectId: 'p1' } as GitLabConfig],
      tasks: tasksFor(),
    })
    const mr = { id: 1, iid: 1, title: 'x', source_branch: 'feature/COM-7', web_url: 'https://gitlab.com/acme/web/-/merge_requests/1', created_at: '2026-09-22T08:00:00Z', state: 'opened', author: { id: 1, username: 'd', name: 'D' }, assignees: [] }
    const t = fakeTransport({ '/pm-tracker/gitlab': (body) => ({ status: 200, data: String(body.path).includes('/groups/') && String(body.path).includes('opened') ? [mr] : [] }) })

    const plan = await computeGitlabSync(s, t, run)

    expect(linked(plan.prPatches)).toEqual(scan(s.tasks, ['COM-7'], 'p1', true))
    expect(linked(plan.prPatches).length).toBeGreaterThan(2)
  })

  it('GitHub', async () => {
    const s = state({
      jiraConnections: [jiraConn()],
      githubConnections: [{ id: 'gh1', name: 'GH', enabled: true, token: 't', orgOrUser: 'acme/web', syncInterval: 5, projectId: 'p1' } as GitHubConfig],
      tasks: tasksFor(),
    })
    const pulls = [{ id: 1, number: 2, title: 'COM-7 fix', html_url: 'https://github.com/acme/web/pull/2', created_at: '2026-09-22T08:00:00Z', state: 'open', user: { login: 'd' } }]
    const t = fakeTransport({ '/pm-tracker/github': (body) => ({ status: 200, data: String(body.path).includes('state=open') ? pulls : [] }) })

    const plan = await computeGithubSync(s, t, run)

    expect(linked(plan.prPatches)).toEqual(scan(s.tasks, ['COM-7'], 'p1', false))
  })
})
