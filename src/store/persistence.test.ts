import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../types'
import type { CommitBody, CommitResponse, RecordsResponse } from '../utils/cloud-api'
import { persistNow, pullRemoteChanges, syncCloudToStore, useStore } from './index'

/*
 * The store's save path end to end, with HTTP mocked: what is sent after an edit, how a
 * conflict answer is merged into what the user sees, and what happens when a save fails.
 */

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id, devId: 'd1', projectId: 'p1', title: 'Jira Issues', status: 'inprogress', jira: '', pr: '', prs: [],
    deadline: '', deadlineTime: '', reviewDate: '', reviewTime: '', comment: '', date: '2026-09-22',
    jiras: [{ issueId: 'COM-1', url: 'u/COM-1', name: 'COM-1', status: 'todo', priority: 'low', deadline: '', deadlineTime: '', prs: [], comment: '' }],
    ...patch,
  } as Task
}

const snapshot: RecordsResponse = {
  full: true,
  cursor: 10,
  docs: [
    { key: 'developers', data: [{ id: 'd1', name: 'Dev', color: '#000', role: 'dev', periods: [] }], revision: 1 },
    { key: 'projects', data: [{ id: 'p1', name: 'Mabrook', desc: '', color: '#000', members: ['d1'], nonWorkingDays: [0, 6] }], revision: 2 },
    { key: 'selectedProject', data: 'p1', revision: 3 },
    { key: 'selectedDev', data: 'ALL', revision: 4 },
    { key: 'browserTimezone', data: Intl.DateTimeFormat().resolvedOptions().timeZone, revision: 7 },
  ],
  tasks: [
    { id: 't1', data: task('t1') as unknown as Record<string, unknown>, revision: 5 },
    { id: 't2', data: task('t2') as unknown as Record<string, unknown>, revision: 6 },
  ],
  deleted: [],
}

const fetchMock = vi.fn()
const commits = () => fetchMock.mock.calls
  .filter((c) => String(c[0]).endsWith('/pm-tracker/records/commit'))
  .map((c) => c[1] as RequestInit)

// Commit bodies are gzipped when the runtime supports it; read them back either way.
async function bodyOf(init: RequestInit): Promise<CommitBody> {
  const raw = init.body as Blob | string
  if (typeof raw === 'string') return JSON.parse(raw)
  const text = await new Response(raw.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return JSON.parse(text)
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>
function serve(routes: { load?: Route; changes?: Route; commit?: Route; sync?: Route; syncStatus?: Route; jiraSearch?: Route }) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/pm-tracker/records/commit')) return Promise.resolve(routes.commit!(url, init))
    if (url.endsWith('/pm-tracker/sync')) {
      const route = init?.method === 'POST' ? routes.sync : routes.syncStatus
      return Promise.resolve(route ? route(url, init) : new Response('{}', { status: 404 }))
    }
    if (url.endsWith('/pm-tracker/jira-search')) return Promise.resolve(routes.jiraSearch ? routes.jiraSearch(url, init) : json({ issues: [], truncated: false }))
    if (url.includes('/pm-tracker/records?since=')) return Promise.resolve(routes.changes!(url, init))
    if (url.endsWith('/pm-tracker/records')) return Promise.resolve(routes.load!(url, init))
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

// Every write applied, revisions counting up from 100.
function acceptAll(): Route {
  let rev = 100
  return async (_url, init) => {
    const body = await bodyOf(init!)
    const result: CommitResponse = { conflicts: [], rejected: [], applied: [] }
    for (const d of body.docs) result.applied.push({ kind: 'doc', id: d.key, revision: ++rev })
    for (const t of body.tasks) result.applied.push({ kind: 'task', id: t.id, revision: ++rev })
    for (const d of body.deletes) result.applied.push({ kind: 'delete', id: d.id, revision: ++rev })
    return json(result)
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

beforeEach(async () => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.setItem('pm_tracker_token', 'session')
  serve({ load: () => json(snapshot), commit: acceptAll(), changes: () => json({ ...snapshot, full: false, docs: [], tasks: [] }) })
  await syncCloudToStore()
  await settle()
  fetchMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loading', () => {
  it('shows the records and sends nothing back on its own', async () => {
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(useStore.getState().selectedProject).toBe('p1')
    persistNow()
    await settle()
    expect(commits()).toHaveLength(0)
  })
})

describe('a failed load', () => {
  it('keeps the loading screen and retries, instead of showing an empty board', async () => {
    let calls = 0
    serve({ load: () => (++calls === 1 ? new Response('down', { status: 503 }) : json(snapshot)), commit: acceptAll() })
    useStore.setState({ tasks: [] })

    await syncCloudToStore()
    expect(useStore.getState().cloudSyncing).toBe(true)
    expect(useStore.getState().cloudLoadFailed).toBe(true)

    await new Promise((r) => setTimeout(r, 2300)) // first retry comes after ~2s
    expect(useStore.getState().cloudSyncing).toBe(false)
    expect(useStore.getState().cloudLoadFailed).toBe(false)
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['t1', 't2'])
  }, 5000)
})

describe('saving', () => {
  it('sends only the edited task, from the revision it was loaded at', async () => {
    useStore.getState().updateTask('t1', { comment: 'done for today' })
    persistNow()
    await settle()

    expect(commits()).toHaveLength(1)
    const body = await bodyOf(commits()[0]!)
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).toMatchObject({ id: 't1', baseRevision: 5, data: { comment: 'done for today' } })
    expect(body.docs).toEqual([])
    expect(body.deletes).toEqual([])
    expect(useStore.getState().saveStatus).toBe('saved')
  })

  it('sends a deleted task as a delete', async () => {
    useStore.getState().deleteTask('t2')
    persistNow()
    await settle()
    const body = await bodyOf(commits()[0]!)
    expect(body.deletes).toEqual([{ id: 't2', baseRevision: 6 }])
    expect(body.tasks).toEqual([])
  })

  it('merges a newer save from another tab into what is shown, then saves the merge', async () => {
    // Another tab moved COM-1 to review; this tab commented on the task.
    const theirs = task('t1', { jiras: [{ ...task('t1').jiras[0]!, status: 'review' }] })
    let calls = 0
    serve({
      commit: async (_url, init) => {
        const body = await bodyOf(init!)
        calls++
        if (calls === 1) {
          return json({ applied: [], rejected: [], conflicts: [{ kind: 'task', id: 't1', data: theirs, revision: 50 }] })
        }
        return json({ applied: body.tasks.map((t) => ({ kind: 'task', id: t.id, revision: 51 })), conflicts: [], rejected: [] })
      },
    })

    useStore.getState().updateTask('t1', { comment: 'mine' })
    persistNow()
    await settle()

    const shown = useStore.getState().tasks.find((t) => t.id === 't1')!
    expect(shown.comment).toBe('mine')
    expect(shown.jiras[0]!.status).toBe('review')
    const second = await bodyOf(commits()[1]!)
    expect(second.tasks[0]).toMatchObject({ id: 't1', baseRevision: 50, data: { comment: 'mine' } })
    expect(commits()).toHaveLength(2)
  })

  it('keeps the edit and reports the failure when the server errors', async () => {
    serve({ commit: () => new Response('boom', { status: 500 }) })
    useStore.getState().updateTask('t1', { comment: 'unsaved' })
    persistNow()
    await settle()

    expect(useStore.getState().saveStatus).toBe('error')
    expect(useStore.getState().saveError).toBe('server')
    expect(useStore.getState().tasks.find((t) => t.id === 't1')!.comment).toBe('unsaved')

    // Back online: the retry sends the same change from the same revision.
    serve({ commit: acceptAll() })
    window.dispatchEvent(new Event('online'))
    await settle()
    const retried = commits().at(-1)!
    expect((await bodyOf(retried)).tasks[0]).toMatchObject({ id: 't1', baseRevision: 5 })
    expect(useStore.getState().saveStatus).toBe('saved')
  })
})

describe('pulling', () => {
  it('shows what another tab saved', async () => {
    serve({
      changes: (url) => {
        expect(url).toContain('since=10')
        return json({ full: false, cursor: 12, docs: [], tasks: [{ id: 't3', data: task('t3'), revision: 12 }], deleted: [{ id: 't2', revision: 11 }] })
      },
      commit: acceptAll(),
    })
    await pullRemoteChanges()
    await settle()
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['t1', 't3'])
    // Nothing to send back: the tab just caught up.
    expect(commits()).toHaveLength(0)
  })
})

describe('syncing on the server', () => {
  const connection = {
    id: 'j1', name: 'Mabrook', enabled: true, baseUrl: 'https://mab.atlassian.net', email: 'a@b.c', token: '', tokenInVault: true,
    projectKeys: ['COM'], syncInterval: 5, projectId: 'p1', developerEmails: { d1: ['dev@mab.com'] },
  }
  const syncs = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/pm-tracker/sync') && (c[1] as RequestInit | undefined)?.method === 'POST')
  const jiraCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/pm-tracker/jira-search'))

  beforeEach(() => {
    useStore.setState({ jiraConnections: [connection as never], serverSync: { serverSync: true, running: false, hookPath: '/pm-tracker/hooks/x' } })
  })

  it("runs an asked-for sync on the server with this browser's timezone, then shows its result", async () => {
    serve({
      commit: acceptAll(),
      sync: () => json({ results: { jira: { added: 1, updated: 0, removed: 0 } }, errors: [] }),
      changes: () => json({ full: false, cursor: 20, docs: [], tasks: [{ id: 't9', data: task('t9'), revision: 20 }], deleted: [] }),
    })

    const result = await useStore.getState().syncJira()

    expect(result).toEqual({ added: 1, updated: 0, removed: 0 })
    const body = JSON.parse((syncs()[0]![1] as RequestInit).body as string)
    expect(body).toEqual({ kinds: ['jira'], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    expect(jiraCalls()).toHaveLength(0) // no provider traffic from the browser
    expect(useStore.getState().tasks.some((t) => t.id === 't9')).toBe(true)
  })

  it("shows the provider's error when the server's sync of it failed", async () => {
    serve({ commit: acceptAll(), sync: () => json({ results: {}, errors: [{ kind: 'jira', message: 'Jira 401: bad token' }] }), changes: () => json({ ...snapshot, full: false, docs: [], tasks: [] }) })
    await expect(useStore.getState().syncJira()).rejects.toThrow('Jira 401: bad token')
  })

  it('falls back to syncing in the browser when the server cannot be reached', async () => {
    serve({ commit: acceptAll(), sync: () => new Response('down', { status: 503 }), changes: () => json({ ...snapshot, full: false, docs: [], tasks: [] }) })
    await useStore.getState().syncJira()
    expect(syncs()).toHaveLength(1)
    expect(jiraCalls().length).toBeGreaterThan(0)
  })

  it('leaves background syncs to the server', async () => {
    serve({ commit: acceptAll() })
    await expect(useStore.getState().syncJira({ background: true })).resolves.toEqual({ added: 0, updated: 0, removed: 0 })
    expect(syncs()).toHaveLength(0)
    expect(jiraCalls()).toHaveLength(0)
  })
})

