import { beforeEach, describe, expect, it } from 'vitest'
import type { JiraConfig, JiraIssue, StatusGroup, Task } from '../types'
import { useStore, getActiveJiraConn, getVisibleTasks, issueShowsOnBoard, jiraConnectionForProject } from './index'

type State = ReturnType<typeof useStore.getState>
const DATE = '2026-09-21'

const groups: StatusGroup[] = [
  { id: 'todo', label: 'To Do', color: 'blue', isClosed: false },
  { id: 'inprogress', label: 'In Progress', color: 'amber', isClosed: false },
  { id: 'group_cr', label: 'Code Review', color: 'purple', isClosed: true },
]

function conn(projectId: string, patch: Partial<JiraConfig> = {}): JiraConfig {
  return {
    id: `j_${projectId}`, name: projectId, enabled: true, baseUrl: 'https://x.atlassian.net',
    email: 'a@b.c', token: 't', projectKeys: [], syncInterval: 5, projectId,
    statusGroups: groups,
    statusMappings: [
      { jiraStatus: 'To Do', groupId: 'todo' },
      { jiraStatus: 'In Progress', groupId: 'inprogress' },
      { jiraStatus: 'Code Review', groupId: 'group_cr' },
    ],
    ...patch,
  }
}

function issue(key: string, jiraStatusName: string, groupId: string): JiraIssue {
  return {
    url: `https://x.atlassian.net/browse/${key}`, issueId: key, name: key,
    status: 'inprogress', groupId, jiraStatusName, prs: [], comment: '',
    priority: 'low', deadline: '', deadlineTime: '',
  } as JiraIssue
}

function task(id: string, projectId: string, jiras: JiraIssue[], date = DATE): Task {
  return { id, devId: 'd1', projectId, date, title: 'Jira Issues', status: 'inprogress', jiraSync: true, prs: [], jiras } as unknown as Task
}

function state(patch: Partial<State>): State {
  return {
    ...useStore.getState(),
    selectedProject: 'ALL', selectedDev: 'ALL', selectedDate: DATE, cloudSyncing: false,
    developers: [{ id: 'd1', name: 'Dev', color: '#000', role: 'dev', periods: [] }],
    projects: [
      { id: 'mab', name: 'Mabrook', color: '#000', members: ['d1'], nonWorkingDays: [] },
      { id: 'min', name: 'Mindport', color: '#000', members: ['d1'], nonWorkingDays: [] },
    ],
    ...patch,
  } as State
}

const visibleKeys = (s: State) => getVisibleTasks(s).flatMap((t) => (t.jiras ?? []).map((j) => j.issueId))

describe('issueShowsOnBoard', () => {
  it('hides a closed group and keeps open ones', () => {
    const c = conn('mab')
    expect(issueShowsOnBoard(issue('A', 'Code Review', 'group_cr'), c)).toBe(false)
    expect(issueShowsOnBoard(issue('B', 'In Progress', 'inprogress'), c)).toBe(true)
  })

  it('applies a mapping change without a re-sync', () => {
    // Regression: the group stamped at sync time used to win forever.
    const stale = issue('A', 'In Progress', 'inprogress')
    const hidden = conn('mab', { statusMappings: [{ jiraStatus: 'In Progress', groupId: 'hidden' }] })
    expect(issueShowsOnBoard(stale, hidden)).toBe(false)
  })
})

describe('getActiveJiraConn', () => {
  it("returns the selected project's own connection, never another project's", () => {
    const s = state({ jiraConnections: [conn('mab'), conn('min')], selectedProject: 'min' })
    expect(getActiveJiraConn(s)?.projectId).toBe('min')
  })

  it('returns nothing for a project without a connection', () => {
    const s = state({ jiraConnections: [conn('mab')], selectedProject: 'min' })
    expect(getActiveJiraConn(s)).toBeUndefined()
  })

  it('finds a connection that has groups but no mappings', () => {
    // Regression: requiring mappings meant such a connection was never found,
    // so nothing could be hidden or closed.
    const s = state({ jiraConnections: [conn('mab', { statusMappings: [] })], selectedProject: 'mab' })
    expect(getActiveJiraConn(s)?.projectId).toBe('mab')
  })
})

describe('getVisibleTasks', () => {
  it("judges each task by its own project's settings", () => {
    // Regression: one connection judged the whole view, so a status hidden in
    // one project still showed through another project's mappings.
    const s = state({
      jiraConnections: [
        conn('mab'),
        conn('min', { statusMappings: [{ jiraStatus: 'In Progress', groupId: 'hidden' }] }),
      ],
      tasks: [
        task('t1', 'mab', [issue('MAB-1', 'In Progress', 'inprogress')]),
        task('t2', 'min', [issue('MIN-1', 'In Progress', 'inprogress')]),
      ],
    })
    expect(visibleKeys(s)).toEqual(['MAB-1'])
  })

  it('does not serve a stale answer after the tasks change', () => {
    // The per-developer results are cached; a cache that outlived an edit would freeze
    // the board. Same date, same project, one more issue.
    const base = { jiraConnections: [conn('mab')] }
    expect(visibleKeys(state({ ...base, tasks: [task('t1', 'mab', [issue('MAB-1', 'To Do', 'todo')])] }))).toEqual(['MAB-1'])
    expect(visibleKeys(state({ ...base, tasks: [task('t1', 'mab', [issue('MAB-1', 'To Do', 'todo'), issue('MAB-2', 'To Do', 'todo')])] }))).toEqual(['MAB-1', 'MAB-2'])
  })

  it('shows the same issue on each of its dates', () => {
    // Regression: the de-dupe key lacked the date, so a carried-over issue vanished.
    const tasks = [task('old', 'mab', [issue('COM-1326', 'To Do', 'todo')], '2026-09-18'),
      task('new', 'mab', [issue('COM-1326', 'To Do', 'todo')])]
    expect(visibleKeys(state({ jiraConnections: [conn('mab')], tasks }))).toEqual(['COM-1326'])
    expect(visibleKeys(state({ jiraConnections: [conn('mab')], tasks, selectedDate: '2026-09-18' }))).toEqual(['COM-1326'])
  })
})

describe('startup migrations keep projects apart', () => {
  beforeEach(() => {
    useStore.setState({
      tasks: [
        task('tA', 'mab', [issue('SHARED-1', 'To Do', 'todo')]),
        task('tB', 'min', [issue('SHARED-1', 'To Do', 'todo')]),
      ],
    })
  })

  it('mergeSameDayTasks leaves one task per project', () => {
    // Regression: a developer on two projects had one project's task deleted on every load.
    useStore.getState().mergeSameDayTasks()
    expect(useStore.getState().tasks.map((t) => t.projectId).sort()).toEqual(['mab', 'min'])
  })

  it('deduplicateJiras keeps the same key in both projects', () => {
    useStore.getState().deduplicateJiras()
    expect(useStore.getState().tasks.flatMap((t) => t.jiras ?? []).length).toBe(2)
  })
})

describe('jiraConnectionForProject', () => {
  it('ignores a preferred id that belongs to another project', () => {
    // Regression: a stale jiraConnectionId let a project borrow another's credentials.
    const found = jiraConnectionForProject([conn('mab'), conn('min')], 'min', 'j_mab')
    expect(found?.projectId).toBe('min')
  })

  it('returns nothing on All projects instead of picking the first connection', () => {
    expect(getActiveJiraConn(state({ jiraConnections: [conn('mab')], selectedProject: 'ALL' }))).toBeUndefined()
  })

  it("never lends a project's settings to a project without a connection", () => {
    const s = state({
      jiraConnections: [conn('mab', { statusMappings: [{ jiraStatus: 'In Progress', groupId: 'hidden' }] })],
      tasks: [task('t1', 'min', [issue('MIN-1', 'In Progress', 'inprogress')])],
    })
    expect(visibleKeys(s)).toEqual(['MIN-1'])
  })
})

describe('backup and restore', () => {
  /*
   * The menu offers this as "download all data", and Restore replaces everything with it.
   * Notes and sprints were missing from the file, so restoring a backup deleted every
   * note and sprint the user had.
   */
  const note = { id: 'n1', title: 'Client call', body: 'branded invoice', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z' }
  const sprint = { id: 's1', projectId: 'p1', name: 'Sprint 3', startDate: '2026-09-01', endDate: '2026-09-14' }

  function exportedPayload(): Record<string, unknown> {
    let captured = ''
    const realBlob = globalThis.Blob
    const realCreate = URL.createObjectURL
    class CapturingBlob extends realBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        captured = String(parts[0])
        super(parts, options)
      }
    }
    globalThis.Blob = CapturingBlob as unknown as typeof Blob
    URL.createObjectURL = () => 'blob:stub'
    try {
      useStore.getState().exportJSON()
    } finally {
      globalThis.Blob = realBlob
      URL.createObjectURL = realCreate
    }
    return JSON.parse(captured) as Record<string, unknown>
  }

  beforeEach(() => {
    useStore.setState({
      developers: [{ id: 'd1', name: 'Dev', color: '#000', role: 'dev', periods: [] }],
      projects: [{ id: 'p1', name: 'Mabrook', desc: '', color: '#000', members: ['d1'], nonWorkingDays: [0, 6] }],
      tasks: [{ id: 't1', devId: 'd1', projectId: 'p1', date: DATE, title: 'Work', status: 'inprogress', jiras: [], prs: [] }] as unknown as Task[],
      notes: [note],
      sprints: [sprint],
      schedule: { d1: { [DATE]: 'vacation' } },
      scheduleHours: { d1: { [DATE]: 6 } },
      jiraConnections: [conn('p1')],
    } as Partial<State> as State)
  })

  it('writes every saved section into the backup file', () => {
    const payload = exportedPayload()

    expect(payload.notes).toEqual([note])
    expect(payload.sprints).toEqual([sprint])
    expect(payload.schedule).toEqual({ d1: { [DATE]: 'vacation' } })
    expect(payload.scheduleHours).toEqual({ d1: { [DATE]: 6 } })
    expect((payload.tasks as Task[])[0]!.id).toBe('t1')
    expect((payload.jiraConnections as JiraConfig[])[0]!.id).toBe('j_p1')
  })

  it('restores them again, instead of dropping what the file does not name', async () => {
    const payload = exportedPayload()

    useStore.setState({ notes: [], sprints: [], tasks: [], developers: [] } as Partial<State> as State)
    // importJSON also waits for the cloud save to finish, which has no server here; the
    // state is applied synchronously before that, which is what this checks.
    void useStore.getState().importJSON(JSON.stringify(payload))
    await Promise.resolve()

    const restored = useStore.getState()
    expect(restored.notes).toEqual([note])
    expect(restored.sprints).toEqual([sprint])
    expect(restored.tasks.map((t) => t.id)).toEqual(['t1'])
    expect(restored.jiraConnections.map((c) => c.id)).toEqual(['j_p1'])
  })
})

describe('deleting a project', () => {
  beforeEach(() => {
    useStore.setState({
      projects: [
        { id: 'p1', name: 'Mabrook', color: '#000', desc: '', members: ['d1'] },
        { id: 'p2', name: 'Mindport', color: '#111', desc: '', members: ['d1'] },
      ],
      tasks: [
        task('t1', 'mab', [issue('MAB-1', 'To Do', 'todo')]),
        task('t2', 'min', [issue('MIN-1', 'To Do', 'todo')]),
      ],
      sprints: [
        { id: 's1', projectId: 'p1', name: 'Sprint 1', startDate: '2026-09-01', endDate: '2026-09-14' },
        { id: 's2', projectId: 'p2', name: 'Sprint 1', startDate: '2026-09-01', endDate: '2026-09-14' },
      ],
      notes: [
        { id: 'n1', projectId: 'p1', title: 'Client call', body: '', createdAt: '', updatedAt: '' },
        { id: 'n2', title: 'Unscoped', body: '', createdAt: '', updatedAt: '' },
      ],
    })
    // The tasks above are keyed by their own project ids; point them at the real ones.
    useStore.setState({
      tasks: useStore.getState().tasks.map((t, i) => ({ ...t, projectId: i === 0 ? 'p1' : 'p2' })),
    })
  })

  it('takes the project\'s work with it rather than orphaning it', () => {
    // It used to blank the projectId, which left the work unreachable: invisible to every
    // project filter, and impossible to attach to anything again.
    useStore.getState().deleteProject('p1')
    const s = useStore.getState()

    expect(s.projects.map((p) => p.id)).toEqual(['p2'])
    expect(s.tasks.map((t) => t.projectId)).toEqual(['p2'])
    expect(s.sprints!.map((x) => x.id)).toEqual(['s2'])
    expect(s.notes!.map((n) => n.id)).toEqual(['n2']) // the unscoped note survives
  })

  it('counts what a delete would destroy, for the confirmation to name', () => {
    const c = useStore.getState().projectDataCounts('p1')
    expect(c).toEqual({ tasks: 1, issues: 1, sprints: 1, notes: 1 })
  })

  it('leaves the other projects alone', () => {
    useStore.getState().deleteProject('p1')
    expect(useStore.getState().projectDataCounts('p2')).toEqual({ tasks: 1, issues: 1, sprints: 1, notes: 0 })
  })
})

describe('archiving a project', () => {
  beforeEach(() => {
    useStore.setState({
      projects: [{ id: 'p1', name: 'Mabrook', color: '#000', desc: '', members: ['d1'] }],
      tasks: [{ ...task('t1', 'mab', [issue('MAB-1', 'To Do', 'todo')]), projectId: 'p1' }],
      selectedProject: 'p1',
    })
  })

  it('keeps every bit of the data and only puts the project away', () => {
    useStore.getState().archiveProject('p1', '2026-10-05T10:00:00Z')
    const s = useStore.getState()

    expect(s.projects[0]!.archivedAt).toBe('2026-10-05T10:00:00Z')
    expect(s.tasks).toHaveLength(1)
    expect(s.tasks[0]!.projectId).toBe('p1') // still attached
    expect(s.selectedProject).toBe('ALL')    // and no longer the one being looked at
  })

  it('comes back exactly as it was', () => {
    useStore.getState().archiveProject('p1', '2026-10-05T10:00:00Z')
    useStore.getState().unarchiveProject('p1')
    expect(useStore.getState().projects[0]!.archivedAt).toBeUndefined()
  })
})
