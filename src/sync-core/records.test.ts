import { beforeEach, describe, expect, it } from 'vitest'
import type { AppState, JiraIssue, Task } from '../types'
import type { CommitBody, CommitResponse, RecordsResponse } from './records-types'
import { cloudToState, DOC_KEYS, RecordTracker, recordsToCloud, type PersistedState } from './records'

/*
 * An in-memory server with the backend's rules (progressor-backend ADR-0018): each write
 * lands only from the record's current revision, revisions come from one counter, deletes
 * leave tombstones. The same rules the Postgres integration test checks on the real thing.
 */
class FakeServer {
  rev = 0
  docs = new Map<string, { data: unknown; revision: number }>()
  tasks = new Map<string, { data: Record<string, unknown>; revision: number }>()
  tombs = new Map<string, number>()

  seed(docs: Record<string, unknown>, tasks: Task[]): void {
    for (const [k, v] of Object.entries(docs)) this.docs.set(k, { data: v, revision: ++this.rev })
    for (const t of tasks) this.tasks.set(t.id, { data: JSON.parse(JSON.stringify(t)), revision: ++this.rev })
  }

  load(since?: number): RecordsResponse {
    const after = since ?? -1
    return {
      full: since === undefined,
      cursor: this.rev,
      docs: [...this.docs].filter(([, d]) => d.revision > after).map(([key, d]) => ({ key, data: clone(d.data), revision: d.revision })),
      tasks: [...this.tasks].filter(([, t]) => t.revision > after).map(([id, t]) => ({ id, data: clone(t.data), revision: t.revision })),
      deleted: since === undefined ? [] : [...this.tombs].filter(([, r]) => r > after).map(([id, revision]) => ({ id, revision })),
    }
  }

  commit(raw: CommitBody): CommitResponse {
    const body = clone(raw) // what actually crosses the wire
    const out: CommitResponse = { applied: [], conflicts: [], rejected: [] }
    for (const d of body.docs) {
      const cur = this.docs.get(d.key)
      if ((cur?.revision ?? null) !== d.baseRevision) {
        out.conflicts.push(cur ? { kind: 'doc', id: d.key, data: clone(cur.data), revision: cur.revision } : { kind: 'doc', id: d.key })
        continue
      }
      this.docs.set(d.key, { data: d.data, revision: ++this.rev })
      out.applied.push({ kind: 'doc', id: d.key, revision: this.rev })
    }
    for (const t of body.tasks) {
      const cur = this.tasks.get(t.id)
      if (!(t.data as Task).date) { out.rejected.push({ kind: 'task', id: t.id, reason: 'error.invalidRecord' }); continue }
      if ((cur?.revision ?? null) !== t.baseRevision) {
        out.conflicts.push(cur ? { kind: 'task', id: t.id, data: clone(cur.data), revision: cur.revision } : { kind: 'task', id: t.id })
        continue
      }
      this.tasks.set(t.id, { data: t.data as Record<string, unknown>, revision: ++this.rev })
      this.tombs.delete(t.id)
      out.applied.push({ kind: 'task', id: t.id, revision: this.rev })
    }
    for (const d of body.deletes) {
      const cur = this.tasks.get(d.id)
      if (cur && cur.revision !== d.baseRevision) {
        out.conflicts.push({ kind: 'delete', id: d.id, data: clone(cur.data), revision: cur.revision })
        continue
      }
      this.tasks.delete(d.id)
      this.tombs.set(d.id, ++this.rev)
      out.applied.push({ kind: 'delete', id: d.id, revision: this.rev })
    }
    return out
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v))
}

function issue(key: string, patch: Record<string, unknown> = {}): JiraIssue {
  return { issueId: key, url: `https://x.atlassian.net/browse/${key}`, name: key, status: 'todo', priority: 'low', deadline: '', deadlineTime: '', prs: [], comment: '', ...patch } as JiraIssue
}

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id, devId: 'd1', projectId: 'p1', title: 'Jira Issues', status: 'inprogress', jira: '', pr: '', prs: [],
    deadline: '', deadlineTime: '', reviewDate: '', reviewTime: '', comment: '', date: '2026-09-22',
    jiras: [issue('COM-1')], ...patch,
  } as Task
}

/*
 * One browser tab: its store state and its tracker, loading from and saving to the server
 * the way the store does (save until nothing differs, apply merges as they come back).
 */
class Tab {
  records = new RecordTracker()
  state = {} as PersistedState

  constructor(private server: FakeServer) {}

  load(): void {
    const res = this.server.load()
    const next = cloudToState(recordsToCloud(res))
    this.records.reset(res, next)
    this.state = { ...blankState(), ...next } as PersistedState
    this.records.adoptView(this.state)
  }

  edit(patch: Partial<PersistedState>): void {
    this.state = { ...this.state, ...patch }
  }

  editTask(id: string, change: (t: Task) => Task): void {
    this.edit({ tasks: this.state.tasks.map((t) => (t.id === id ? change(t) : t)) })
  }

  // Returns how many requests it took.
  save(): number {
    let requests = 0
    for (;;) {
      const batch = this.records.collect(this.state)
      if (!batch) return requests
      requests++
      const out = this.records.apply(batch, this.server.commit(batch.body), this.state)
      if (out.patch) this.edit(out.patch)
      if (requests > 20) throw new Error('save never settled')
    }
  }

  pull(): void {
    const patch = this.records.pull(this.server.load(this.records.cursor), this.state)
    if (patch) this.edit(patch)
  }

  task(id: string): Task | undefined {
    return this.state.tasks.find((t) => t.id === id)
  }
}

function blankState(): Partial<AppState> {
  const s: Record<string, unknown> = { tasks: [] }
  for (const k of DOC_KEYS) s[k] = undefined
  return { ...s, developers: [], projects: [], selectedDate: '2026-09-22', selectedDev: 'ALL', selectedProject: 'ALL' } as Partial<AppState>
}

let server: FakeServer
let a: Tab
let b: Tab

beforeEach(() => {
  server = new FakeServer()
  server.seed(
    {
      developers: [{ id: 'd1', name: 'Dev', periods: [] }],
      projects: [{ id: 'p1', name: 'Mabrook', members: ['d1'], nonWorkingDays: [0, 6] }],
      selectedDate: '2026-09-01', selectedDev: 'ALL', selectedProject: 'ALL',
    },
    [task('t1'), task('t2', { date: '2026-09-23' })],
  )
  a = new Tab(server)
  b = new Tab(server)
  a.load()
  b.load()
})

describe('what a save sends', () => {
  it('sends nothing right after loading', () => {
    expect(a.records.collect(a.state)).toBeNull()
  })

  it('does not treat defaults filled in on load as changes', () => {
    // Saved before `prs` existed: the load adds it, which must not rewrite every task.
    const old = new FakeServer()
    const bare = task('t9') as unknown as Record<string, unknown>
    delete bare.prs
    old.seed({}, [bare as unknown as Task])
    const tab = new Tab(old)
    tab.load()
    expect(tab.task('t9')!.prs).toEqual([])
    expect(tab.records.collect(tab.state)?.body.tasks ?? []).toEqual([])
  })

  it('sends only the task that changed, from its current revision', () => {
    const rev = server.tasks.get('t1')!.revision
    a.editTask('t1', (t) => ({ ...t, comment: 'hi' }))
    const batch = a.records.collect(a.state)!
    expect(batch.body.tasks).toEqual([{ id: 't1', data: a.task('t1'), baseRevision: rev }])
    expect(batch.body.docs).toEqual([])
    expect(batch.body.deletes).toEqual([])
  })

  it('treats a rebuilt but identical task as unchanged', () => {
    a.editTask('t1', (t) => ({ ...t }))
    expect(a.records.collect(a.state)).toBeNull()
  })

  it('creates new tasks and deletes removed ones', () => {
    const rev = server.tasks.get('t2')!.revision
    a.edit({ tasks: [a.task('t1')!, task('t3')] })
    const batch = a.records.collect(a.state)!
    expect(batch.body.tasks).toEqual([{ id: 't3', data: task('t3'), baseRevision: null }])
    expect(batch.body.deletes).toEqual([{ id: 't2', baseRevision: rev }])
  })

  it('sends a changed settings section on its own', () => {
    a.edit({ developers: [...a.state.developers, { id: 'd2', name: 'New', color: '#000', role: 'dev', periods: [] }] })
    const batch = a.records.collect(a.state)!
    expect(batch.body.docs.map((d) => d.key)).toEqual(['developers'])
    expect(batch.body.tasks).toEqual([])
  })

  it('splits a large save into several requests', () => {
    const many = Array.from({ length: 350 }, (_, i) => task(`n${i}`))
    a.edit({ tasks: [...a.state.tasks, ...many] })
    expect(a.save()).toBe(4) // 100 records per request
    expect(server.tasks.size).toBe(352)
  })

  it('stops once the server has everything', () => {
    a.editTask('t1', (t) => ({ ...t, comment: 'hi' }))
    expect(a.save()).toBe(1)
    expect(a.records.collect(a.state)).toBeNull()
    expect(server.tasks.get('t1')!.data.comment).toBe('hi')
  })

  it('does not resend a task the server refused, until it changes', () => {
    a.edit({ tasks: [...a.state.tasks, task('bad', { date: '' })] })
    a.save()
    expect(a.records.collect(a.state)).toBeNull()
    a.editTask('bad', (t) => ({ ...t, date: '2026-09-24' }))
    a.save()
    expect(server.tasks.has('bad')).toBe(true)
  })
})

describe('two tabs saving the same records', () => {
  it('a stale tab no longer overwrites a sync: both changes survive', () => {
    // Tab A syncs Jira: COM-1 moves to review and COM-2 arrives.
    a.editTask('t1', (t) => ({ ...t, jiras: [issue('COM-1', { status: 'review' }), issue('COM-2')] }))
    a.save()
    // Tab B, still holding the old copy, comments on COM-1 and saves.
    b.editTask('t1', (t) => ({ ...t, jiras: [issue('COM-1', { comment: 'looks good' })] }))
    b.save()

    const saved = server.tasks.get('t1')!.data as unknown as Task
    expect(saved.jiras).toEqual([issue('COM-1', { status: 'review', comment: 'looks good' }), issue('COM-2')])
    // ...and tab B now shows the merged result too.
    expect(b.task('t1')!.jiras).toEqual(saved.jiras)
  })

  it('keeps edits to different tasks from both tabs without conflict', () => {
    a.editTask('t1', (t) => ({ ...t, comment: 'A' }))
    b.editTask('t2', (t) => ({ ...t, comment: 'B' }))
    a.save()
    b.save()
    expect(server.tasks.get('t1')!.data.comment).toBe('A')
    expect(server.tasks.get('t2')!.data.comment).toBe('B')
  })

  it('does not delete a task another tab changed after this tab last saw it', () => {
    a.editTask('t2', (t) => ({ ...t, comment: 'still needed' }))
    a.save()
    b.edit({ tasks: b.state.tasks.filter((t) => t.id !== 't2') })
    b.save()
    expect(server.tasks.get('t2')!.data.comment).toBe('still needed')
    expect(b.task('t2')!.comment).toBe('still needed') // restored in the stale tab
  })

  it('recreates a task this tab edited after another tab deleted it', () => {
    a.edit({ tasks: a.state.tasks.filter((t) => t.id !== 't2') })
    a.save()
    b.editTask('t2', (t) => ({ ...t, comment: 'edited meanwhile' }))
    b.save()
    expect(server.tasks.get('t2')!.data.comment).toBe('edited meanwhile')
  })

  it('merges settings item by item: a developer added in each tab', () => {
    const dev = (id: string) => ({ id, name: id, color: '#000', role: 'dev' as const, periods: [] })
    a.edit({ developers: [...a.state.developers, dev('dA')] })
    b.edit({ developers: [...b.state.developers, dev('dB')] })
    a.save()
    b.save()
    // Tab B merged last: its own order, then what tab A added.
    expect((server.docs.get('developers')!.data as Array<{ id: string }>).map((d) => d.id)).toEqual(['d1', 'dB', 'dA'])
  })

  it("never moves one tab's screen because another tab changed its view", () => {
    a.edit({ selectedDate: '2026-09-20' })
    a.save()
    b.pull()
    expect(b.state.selectedDate).toBe('2026-09-22')
    // ...and B's own later view change still saves cleanly.
    b.edit({ selectedDate: '2026-09-21' })
    b.save()
    expect(server.docs.get('selectedDate')!.data).toBe('2026-09-21')
  })
})

describe('pulling what other tabs saved', () => {
  it('replaces records this tab has not touched', () => {
    a.editTask('t1', (t) => ({ ...t, comment: 'from A' }))
    a.edit({ tasks: [...a.state.tasks, task('t3')] })
    a.save()
    b.pull()
    expect(b.task('t1')!.comment).toBe('from A')
    expect(b.task('t3')).toBeDefined()
    expect(b.records.collect(b.state)).toBeNull() // nothing to send back
  })

  it('merges into a record this tab has edited, and saves the merge', () => {
    a.editTask('t1', (t) => ({ ...t, status: 'done' }))
    a.save()
    b.editTask('t1', (t) => ({ ...t, comment: 'mine' }))
    b.pull()
    expect(b.task('t1')).toMatchObject({ status: 'done', comment: 'mine' })
    b.save()
    expect(server.tasks.get('t1')!.data).toMatchObject({ status: 'done', comment: 'mine' })
  })

  it('removes a task deleted elsewhere, unless edited here', () => {
    a.edit({ tasks: [] })
    a.save()
    b.editTask('t2', (t) => ({ ...t, comment: 'keep me' }))
    b.pull()
    expect(b.task('t1')).toBeUndefined()
    expect(b.task('t2')!.comment).toBe('keep me')
  })

  it("ignores its own saves coming back", () => {
    a.editTask('t1', (t) => ({ ...t, comment: 'x' }))
    a.save()
    const before = a.state
    a.pull()
    expect(a.state).toBe(before)
  })
})

describe('a load that finished after local changes', () => {
  it('adds what it brought and deletes nothing', () => {
    const tab = new Tab(server)
    tab.state = { ...blankState(), tasks: [task('local-only')] } as PersistedState
    const res = server.load()
    const next = cloudToState(recordsToCloud(res))
    tab.records.reset(res, next)
    const patch = tab.records.adoptStale(next, tab.state)
    tab.edit(patch ?? {})
    expect(tab.state.tasks.map((t) => t.id).sort()).toEqual(['local-only', 't1', 't2'])
    tab.save()
    expect([...server.tasks.keys()].sort()).toEqual(['local-only', 't1', 't2'])
  })
})
