import { create } from 'zustand'
import type { AppState, Developer, Project, Task, JiraIssue, JiraConfig, GitLabConfig, View, EmploymentPeriod } from '../types'
import { todayStr, offsetDate, nextWorkDay, prevWorkDay } from '../utils/dates'
import { getJiras, jiraDedupeKey } from '../utils/format'
import { fetchJiraIssues, rawToJiraItem } from '../utils/jira-api'
import { fetchGroupMRs, extractJiraKey } from '../utils/gitlab-api'

const LS_KEY = 'pmtracker_v4'

function makeId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6)
}

function freshState(): AppState {
  const today = todayStr()
  return {
    selectedDev: 'ALL',
    selectedProject: 'ALL',
    selectedDate: today,
    view: 'daily',
    schedule: {},
    scheduleHours: {},
    notifsEnabled: false,
    jiraConfig: {
      enabled: false,
      baseUrl: '',
      email: '',
      token: '',
      projectKeys: [],
      syncInterval: 5,
      proxyUrl: '',
    },
    gitlabConfig: {
      enabled: false,
      token: '',
      groupPath: '',
      syncInterval: 10,
    },
    developers: [
      { id: 'd1', name: 'Alex Morgan', role: 'Frontend', color: '#2563eb', periods: [] },
      { id: 'd2', name: 'Sam Rivera', role: 'Backend', color: '#16a34a', periods: [] },
      { id: 'd3', name: 'Jordan Lee', role: 'Full Stack', color: '#7c3aed', periods: [] },
    ],
    projects: [
      { id: 'p1', name: 'Auth Redesign', color: '#2563eb', desc: 'Login & permissions', members: ['d1', 'd2'] },
      { id: 'p2', name: 'Dashboard v2', color: '#16a34a', desc: 'Analytics dashboard', members: ['d1', 'd3'] },
      { id: 'p3', name: 'Mobile App', color: '#d97706', desc: 'React Native client', members: ['d2', 'd3'] },
    ],
    tasks: [
      {
        id: 't1', devId: 'd1', projectId: 'p1', title: 'Implement auth flow UI',
        status: 'inprogress', jira: '', jiras: [
          { url: 'https://jira.co/browse/AUTH-12', name: 'Implement auth flow UI', status: 'inprogress', priority: 'high', deadline: offsetDate(2), deadlineTime: '18:00', prs: [], comment: 'Pending design review' },
        ],
        pr: '', prs: [], deadline: offsetDate(2), deadlineTime: '18:00', reviewDate: '', reviewTime: '', comment: 'Pending design review', date: today,
      },
      {
        id: 't2', devId: 'd1', projectId: 'p2', title: 'Fix mobile nav overflow',
        status: 'done', jira: '', jiras: [
          { url: '', name: 'Fix mobile nav overflow', status: 'done', priority: 'medium', deadline: today, deadlineTime: '12:00', prs: [{ url: 'https://github.com/org/repo/pull/43', date: today, time: '11:00' }], comment: 'Merged ✓' },
        ],
        pr: '', prs: [], deadline: today, deadlineTime: '12:00', reviewDate: '', reviewTime: '', comment: 'Merged ✓', date: today,
      },
      {
        id: 't3', devId: 'd2', projectId: 'p1', title: 'Refactor permissions API',
        status: 'review', jira: '', jiras: [
          { url: 'https://jira.co/browse/AUTH-9', name: 'Refactor permissions API', status: 'review', priority: 'high', deadline: offsetDate(1), deadlineTime: '17:00', prs: [], comment: 'Waiting for QA sign-off' },
        ],
        pr: '', prs: [], deadline: offsetDate(1), deadlineTime: '17:00', reviewDate: '', reviewTime: '', comment: 'Waiting for QA sign-off', date: today,
      },
      {
        id: 't4', devId: 'd3', projectId: 'p2', title: 'Dashboard chart integration',
        status: 'blocked', jira: '', jiras: [
          { url: 'https://jira.co/browse/DASH-7', name: 'Dashboard chart integration', status: 'blocked', priority: 'critical', deadline: offsetDate(3), deadlineTime: '23:59', prs: [], comment: 'Blocked: API not ready' },
        ],
        pr: '', prs: [], deadline: offsetDate(3), deadlineTime: '23:59', reviewDate: '', reviewTime: '', comment: 'Blocked: API not ready', date: today,
      },
    ],
  }
}

function persistState(state: AppState): void {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        _v: 2,
        developers: state.developers,
        projects: state.projects,
        tasks: state.tasks,
        schedule: state.schedule,
        scheduleHours: state.scheduleHours,
        notifsEnabled: state.notifsEnabled,
        jiraConfig: state.jiraConfig,
        gitlabConfig: state.gitlabConfig,
      }),
    )
  } catch {}
}

function loadState(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const d = JSON.parse(raw) as Partial<AppState>
    // Migrate old schedule format (ScheduleEntry objects → plain strings)
    const sched: Record<string, Record<string, string>> = {}
    if (d.schedule) {
      Object.entries(d.schedule).forEach(([devId, days]) => {
        sched[devId] = {}
        Object.entries(days).forEach(([date, val]) => {
          if (typeof val === 'string') sched[devId][date] = val
          else if (val && typeof val === 'object' && 'type' in val) sched[devId][date] = (val as { type: string }).type
        })
      })
    }
    return {
      developers: d.developers?.map((dev) => ({ periods: [], ...dev })),
      projects: d.projects?.map((p) => ({ ...p, members: p.members ?? [] })),
      tasks: d.tasks,
      schedule: sched,
      scheduleHours: (d as AppState & { scheduleHours?: Record<string, Record<string, number>> }).scheduleHours ?? {},
      notifsEnabled: (d as AppState).notifsEnabled ?? false,
      ...((d as AppState).jiraConfig ? { jiraConfig: (d as AppState).jiraConfig } : {}),
      ...((d as AppState).gitlabConfig ? { gitlabConfig: (d as AppState).gitlabConfig } : {}),
    }
  } catch {
    return {}
  }
}

interface StoreActions {
  setView: (v: View) => void
  setSelectedDate: (d: string) => void
  setSelectedDev: (id: string) => void
  setSelectedProject: (id: string) => void

  addDeveloper: (dev: Omit<Developer, 'id'>) => void
  removeDeveloper: (id: string) => void
  updateDeveloperPeriods: (devId: string, periods: EmploymentPeriod[]) => void
  archiveDeveloper: (id: string, archivedAt: string) => void
  unarchiveDeveloper: (id: string) => void

  addProject: (p: Omit<Project, 'id'>) => void
  deleteProject: (id: string) => void
  toggleMember: (projId: string, devId: string) => void

  addTask: (t: Omit<Task, 'id'>) => void
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  duplicateTask: (id: string, targetDate: string) => void
  carryOver: (id: string) => string | null
  autoCarryOverdue: () => boolean
  migrateIssueIds: () => void
  deduplicateJiras: () => void

  updateJiraStatus: (taskId: string, issueId: string | undefined, url: string, status: JiraIssue['status']) => void
  updateJiraPriority: (taskId: string, issueId: string | undefined, url: string, priority: JiraIssue['priority']) => void
  reorderJiras: (taskId: string, fromIdx: number, toIdx: number) => void
  deleteJira: (taskId: string, issueId: string | undefined, url: string) => void
  toggleJiraHidden: (taskId: string, issueId: string | undefined, url: string) => void

  setScheduleDay: (devId: string, date: string, type: string | null) => void
  setScheduleHours: (devId: string, date: string, hours: number) => void

  setNotifsEnabled: (v: boolean) => void
  setJiraConfig: (cfg: JiraConfig) => void
  syncJira: () => Promise<{ added: number; updated: number }>
  setGitlabConfig: (cfg: GitLabConfig) => void
  syncGitlab: () => Promise<{ linked: number; updated: number }>
  exportJSON: () => void
  importJSON: (json: string) => void
}

type Store = AppState & StoreActions

function withSave(state: AppState): AppState {
  persistState(state)
  return state
}

export const useStore = create<Store>((set, get) => {
  const base = { ...freshState(), ...loadState() }

  return {
    ...base,

    setView: (view) => set({ view }),
    setSelectedDate: (selectedDate) => set({ selectedDate }),
    setSelectedDev: (selectedDev) => set({ selectedDev }),
    setSelectedProject: (selectedProject) => set({ selectedProject, selectedDev: 'ALL' }),

    addDeveloper: (dev) =>
      set((s) => withSave({ ...s, developers: [...s.developers, { id: makeId('d'), periods: [], ...dev }] })),

    removeDeveloper: (id) =>
      set((s) =>
        withSave({
          ...s,
          developers: s.developers.filter((d) => d.id !== id),
          tasks: s.tasks.filter((t) => t.devId !== id),
          selectedDev: s.selectedDev === id ? 'ALL' : s.selectedDev,
        }),
      ),

    updateDeveloperPeriods: (devId, periods) =>
      set((s) =>
        withSave({
          ...s,
          developers: s.developers.map((d) => (d.id === devId ? { ...d, periods } : d)),
        }),
      ),

    archiveDeveloper: (id, archivedAt) =>
      set((s) =>
        withSave({
          ...s,
          developers: s.developers.map((d) => (d.id === id ? { ...d, archivedAt } : d)),
          selectedDev: s.selectedDev === id ? 'ALL' : s.selectedDev,
        }),
      ),

    unarchiveDeveloper: (id) =>
      set((s) =>
        withSave({
          ...s,
          developers: s.developers.map((d) => {
            if (d.id !== id) return d
            const { archivedAt: _, ...rest } = d
            return rest
          }),
        }),
      ),

    addProject: (p) =>
      set((s) => withSave({ ...s, projects: [...s.projects, { id: makeId('p'), ...p }] })),

    deleteProject: (id) =>
      set((s) =>
        withSave({
          ...s,
          projects: s.projects.filter((p) => p.id !== id),
          tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: '' } : t)),
          selectedProject: s.selectedProject === id ? 'ALL' : s.selectedProject,
        }),
      ),

    toggleMember: (projId, devId) =>
      set((s) =>
        withSave({
          ...s,
          projects: s.projects.map((p) => {
            if (p.id !== projId) return p
            const members = p.members.includes(devId)
              ? p.members.filter((id) => id !== devId)
              : [...p.members, devId]
            return { ...p, members }
          }),
        }),
      ),

    addTask: (t) =>
      set((s) => {
        const jiras = t.jiras?.map((j) => j.issueId ? j : { ...j, issueId: makeId('i') })
        return withSave({ ...s, tasks: [...s.tasks, { id: makeId('t'), ...t, ...(jiras ? { jiras } : {}) }] })
      }),

    updateTask: (id, patch) =>
      set((s) => {
        const existing = s.tasks.find((t) => t.id === id)
        let jiras = patch.jiras
        if (jiras) {
          jiras = jiras.map((j) => {
            if (j.issueId) return j
            const key = jiraDedupeKey(j.url, j.name)
            const match = existing?.jiras?.find((ej) => ej.issueId && jiraDedupeKey(ej.url, ej.name) === key)
            return { ...j, issueId: match?.issueId ?? makeId('i') }
          })
        }
        return withSave({
          ...s,
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, ...(jiras ? { jiras } : {}) } : t)),
        })
      }),

    deleteTask: (id) =>
      set((s) => {
        const task = s.tasks.find((t) => t.id === id)
        // For carried tasks: mark their jiras as done on the source task so that
        // autoCarryOverdue won't re-create this checkpoint on the next page load.
        if (task?.carriedOver && task.jiras?.length) {
          const sourceDate = task.carriedFrom ?? prevWorkDay(task.date)
          const issueIds = new Set(task.jiras.map((j) => j.issueId).filter((x): x is string => !!x))
          const dedupeKeys = new Set(
            task.jiras.map((j) => jiraDedupeKey(j.url, j.name)).filter((k): k is string => !!(k && k !== 'name:')),
          )
          const tasks = s.tasks.filter((t) => t.id !== id).map((t) => {
            if (t.devId !== task.devId || t.date !== sourceDate || !t.jiras?.length) return t
            const jiras = t.jiras.map((j) => {
              const dk = jiraDedupeKey(j.url, j.name)
              const hit = (j.issueId && issueIds.has(j.issueId)) || (dk && dk !== 'name:' && dedupeKeys.has(dk))
              return hit ? { ...j, status: 'done' as JiraIssue['status'] } : j
            })
            if (jiras.every((j, i) => j === t.jiras![i])) return t
            const allDone = jiras.every((j) => j.status === 'done')
            const hasBlocked = jiras.some((j) => j.status === 'blocked')
            return { ...t, jiras, status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo' }
          })
          return withSave({ ...s, tasks })
        }
        return withSave({ ...s, tasks: s.tasks.filter((t) => t.id !== id) })
      }),

    duplicateTask: (id, targetDate) => {
      const task = get().tasks.find((t) => t.id === id)
      if (!task) return
      const copy: Task = {
        ...task,
        id: makeId('t'),
        date: targetDate,
        jiras: (task.jiras ?? []).map((j) => ({
          ...j,
          status: 'todo',
          deadline: '',
          deadlineTime: '',
          prs: (j.prs ?? []).map((p) => ({ url: p.url, date: '', time: '' })),
        })),
        prs: [],
        pr: '',
        reviewDate: '',
        reviewTime: '',
      }
      set((s) => withSave({ ...s, tasks: [...s.tasks, copy] }))
    },

    carryOver: (id) => {
      const { tasks } = get()
      const task = tasks.find((t) => t.id === id)
      if (!task) return null
      const nextDay = nextWorkDay(task.date)
      const pending = (task.jiras ?? [])
        .map((j, i) => ({ ...j, _srcIdx: j._srcIdx ?? i }))
        .filter((j) => j.status !== 'done')

      if (task.jiras?.length && !pending.length) return 'all-done'

      const existing = tasks.find(
        (t) => t.devId === task.devId && t.title === task.title && t.date === nextDay && t.carriedOver,
      )
      if (existing) {
        const existingIdxs = new Set((existing.jiras ?? []).map((j) => j._srcIdx))
        const toAdd = pending.filter((j) => !existingIdxs.has(j._srcIdx))
        if (toAdd.length) {
          set((s) =>
            withSave({
              ...s,
              tasks: s.tasks.map((t) =>
                t.id === existing.id ? { ...t, jiras: [...(t.jiras ?? []), ...toAdd] } : t,
              ),
            }),
          )
        }
        return nextDay
      }

      const carried: Task = {
        id: makeId('t'),
        devId: task.devId,
        projectId: task.projectId,
        title: task.title,
        status: 'inprogress',
        jira: task.jira,
        jiras: pending,
        pr: '',
        prs: [],
        deadline: task.deadline,
        deadlineTime: task.deadlineTime,
        reviewDate: '',
        reviewTime: '',
        comment: task.comment,
        date: nextDay,
        carriedOver: true,
        carriedFrom: task.date,
      }
      set((s) => withSave({ ...s, tasks: [...s.tasks, carried] }))
      return nextDay
    },

    autoCarryOverdue: () => {
      const { tasks } = get()
      const today = todayStr()
      const yesterday = prevWorkDay(today)

      // Returns true if a jira (by issueId, falling back to dedupeKey) is done in any task
      // for the same dev on any date after `afterDate`. Searches all tasks so that a user
      // marking a carried issue as "done" is always treated as completion evidence.
      function isDoneInLaterTask(devId: string, issueId: string | undefined, url: string, name: string, afterDate: string): boolean {
        if (issueId) {
          return tasks.some(
            (x) =>
              x.devId === devId &&
              x.date > afterDate &&
              (x.jiras ?? []).some((j) => j.issueId === issueId && j.status === 'done'),
          )
        }
        const key = jiraDedupeKey(url, name)
        if (!key || key === 'name:') return false
        return tasks.some(
          (x) =>
            x.devId === devId &&
            x.date > afterDate &&
            (x.jiras ?? []).some((j) => jiraDedupeKey(j.url, j.name) === key && j.status === 'done'),
        )
      }

      // Only look at yesterday's tasks.
      const unfinished = tasks.filter((t) => {
        if (t.date !== yesterday) return false
        if (t.jiras !== undefined) {
          return t.jiras.some(
            (j) => j.status !== 'done' && !isDoneInLaterTask(t.devId, j.issueId, j.url, j.name, t.date),
          )
        }
        return t.status !== 'done'
      })

      const newTasks: Task[] = []
      // Track issueIds (falling back to dedupeKey) already on today per dev
      const scheduledKeys = new Map<string, Set<string>>()

      function getScheduled(devId: string): Set<string> {
        if (!scheduledKeys.has(devId)) {
          const existing = new Set<string>()
          tasks
            .filter((x) => x.devId === devId && x.date === today)
            .forEach((x) =>
              (x.jiras ?? []).forEach((j) => {
                // Register both issueId and dedupeKey so mismatched ids don't slip through
                if (j.issueId) existing.add(j.issueId)
                const dk = jiraDedupeKey(j.url, j.name)
                if (dk && dk !== 'name:') existing.add(dk)
              }),
            )
          scheduledKeys.set(devId, existing)
        }
        return scheduledKeys.get(devId)!
      }

      unfinished.forEach((t) => {
        const targetDate = nextWorkDay(t.date)
        if (t.jiras !== undefined) {
          const scheduled = getScheduled(t.devId)
          const pendingJiras = t.jiras
            .map((j, i) => ({ ...j, _srcIdx: j._srcIdx ?? i }))
            .filter((j) => {
              if (j.status === 'done') return false
              if (isDoneInLaterTask(t.devId, j.issueId, j.url, j.name, t.date)) return false
              // Block if either issueId or dedupeKey is already scheduled
              if (j.issueId && scheduled.has(j.issueId)) return false
              const dk = jiraDedupeKey(j.url, j.name)
              if (dk && dk !== 'name:' && scheduled.has(dk)) return false
              return true
            })
          if (!pendingJiras.length) return
          pendingJiras.forEach((j) => {
            if (j.issueId) scheduled.add(j.issueId)
            const dk = jiraDedupeKey(j.url, j.name)
            if (dk && dk !== 'name:') scheduled.add(dk)
          })
          newTasks.push({
            ...t,
            id: makeId('t'),
            date: targetDate,
            carriedOver: true,
            carriedFrom: t.date,
            jiras: pendingJiras,
            prs: (t.prs ?? []).map((p) => ({ ...p })),
          })
        } else {
          const alreadyOnToday = tasks.some(
            (x) => x.devId === t.devId && x.jira === t.jira && x.date === today,
          )
          if (alreadyOnToday) return
          newTasks.push({
            ...t,
            id: makeId('t'),
            date: targetDate,
            carriedOver: true,
            carriedFrom: t.date,
            prs: (t.prs ?? []).map((p) => ({ ...p })),
          })
        }
      })

      if (newTasks.length > 0) {
        set((s) =>
          withSave({
            ...s,
            tasks: [...s.tasks, ...newTasks],
          }),
        )
      }
      return newTasks.length > 0
    },

    migrateIssueIds: () => {
      const { tasks } = get()
      if (!tasks.some((t) => t.jiras?.some((j) => !j.issueId))) return

      // Build a stable mapping: devId + normalized key → issueId
      // Jiras that are copies of the same ticket (same dev, same normalized key) share one issueId
      const idMap = new Map<string, string>()
      tasks.forEach((t) => {
        ;(t.jiras ?? []).forEach((j) => {
          if (j.issueId) return
          const mapKey = `${t.devId}:${jiraDedupeKey(j.url, j.name)}`
          if (!idMap.has(mapKey)) idMap.set(mapKey, makeId('i'))
        })
      })

      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (!t.jiras?.some((j) => !j.issueId)) return t
            const jiras = t.jiras.map((j) => {
              if (j.issueId) return j
              const mapKey = `${t.devId}:${jiraDedupeKey(j.url, j.name)}`
              return { ...j, issueId: idMap.get(mapKey) ?? makeId('i') }
            })
            return { ...t, jiras }
          }),
        }),
      )
    },

    deduplicateJiras: () => {
      const { tasks } = get()

      // For each (devId, date, issueId) only one jira should exist.
      // Sort so non-carried tasks claim their issueIds first (originals win over copies).
      const sorted = [...tasks].sort((a, b) => {
        if (a.carriedOver !== b.carriedOver) return a.carriedOver ? 1 : -1
        return a.id < b.id ? -1 : 1
      })

      const seen = new Set<string>()
      const patches = new Map<string, JiraIssue[]>()
      const toDelete = new Set<string>()

      sorted.forEach((t) => {
        if (!Array.isArray(t.jiras) || !t.jiras.length) return
        const kept: JiraIssue[] = []
        t.jiras.forEach((j) => {
          // Use dedupeKey (ticket key like NML-454747) as canonical identity.
          // issueIds can differ across carry-over copies due to historical migration gaps.
          const dk = jiraDedupeKey(j.url, j.name)
          const identity = (dk && dk !== 'name:') ? dk : j.issueId
          if (!identity) { kept.push(j); return }
          const k = `${t.devId}:${t.date}:${identity}`
          if (!seen.has(k)) { seen.add(k); kept.push(j) }
          // else: duplicate on same dev+date — drop it
        })
        if (kept.length !== t.jiras.length) {
          if (kept.length === 0) toDelete.add(t.id)
          else patches.set(t.id, kept)
        }
      })

      if (toDelete.size === 0 && patches.size === 0) return

      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks
            .filter((t) => !toDelete.has(t.id))
            .map((t) => (patches.has(t.id) ? { ...t, jiras: patches.get(t.id)! } : t)),
        }),
      )
    },

    updateJiraStatus: (taskId, issueId, url, status) =>
      set((s) => {
        const targetTask = s.tasks.find((t) => t.id === taskId)
        const matchJira = (j: JiraIssue) => issueId ? j.issueId === issueId : j.url === url

        return withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (!t.jiras) return t
            if (t.id === taskId) {
              const jiras = t.jiras.map((j) => matchJira(j) ? { ...j, status } : j)
              const allDone = jiras.every((j) => j.status === 'done')
              const hasBlocked = jiras.some((j) => j.status === 'blocked')
              return { ...t, jiras, status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo' }
            }
            // Propagate by issueId to every other task for the same dev
            if (issueId && targetTask && t.devId === targetTask.devId) {
              const jiras = t.jiras.map((j) => j.issueId === issueId ? { ...j, status } : j)
              if (jiras.every((j, i) => j === t.jiras![i])) return t
              const allDone = jiras.every((j) => j.status === 'done')
              const hasBlocked = jiras.some((j) => j.status === 'blocked')
              return { ...t, jiras, status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo' }
            }
            return t
          }),
        })
      }),

    updateJiraPriority: (taskId, issueId, url, priority) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            const matchJira = (j: JiraIssue) => issueId ? j.issueId === issueId : j.url === url
            return { ...t, jiras: t.jiras.map((j) => matchJira(j) ? { ...j, priority } : j) }
          }),
        }),
      ),

    reorderJiras: (taskId, fromIdx, toIdx) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            const jiras = [...t.jiras]
            const [moved] = jiras.splice(fromIdx, 1)
            jiras.splice(toIdx, 0, moved)
            return { ...t, jiras }
          }),
        }),
      ),

    deleteJira: (taskId, issueId, url) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            const matchJira = (j: JiraIssue) => issueId ? j.issueId === issueId : j.url === url
            const jiras = t.jiras.filter((j) => !matchJira(j))
            return { ...t, jiras, ...(jiras.length === 0 ? { jira: '' } : {}) }
          }),
        }),
      ),

    toggleJiraHidden: (taskId, issueId, url) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            const matchJira = (j: JiraIssue) => issueId ? j.issueId === issueId : j.url === url
            return { ...t, jiras: t.jiras.map((j) => matchJira(j) ? { ...j, hidden: !j.hidden } : j) }
          }),
        }),
      ),

    setScheduleDay: (devId, date, type) =>
      set((s) => {
        const schedule = { ...s.schedule }
        if (!schedule[devId]) schedule[devId] = {}
        if (!type) {
          const { [date]: _, ...rest } = schedule[devId]
          schedule[devId] = rest
        } else {
          schedule[devId] = { ...schedule[devId], [date]: type }
        }
        return withSave({ ...s, schedule })
      }),

    setScheduleHours: (devId, date, hours) =>
      set((s) => {
        const scheduleHours = { ...s.scheduleHours }
        if (!scheduleHours[devId]) scheduleHours[devId] = {}
        if (hours === 8) {
          const { [date]: _, ...rest } = scheduleHours[devId]
          scheduleHours[devId] = rest
        } else {
          scheduleHours[devId] = { ...scheduleHours[devId], [date]: hours }
        }
        return withSave({ ...s, scheduleHours })
      }),

    setNotifsEnabled: (notifsEnabled) => set((s) => withSave({ ...s, notifsEnabled })),

    setJiraConfig: (jiraConfig) => set((s) => withSave({ ...s, jiraConfig })),

    syncJira: async () => {
      const { jiraConfig, developers, tasks } = get()
      if (!jiraConfig.enabled || !jiraConfig.baseUrl || !jiraConfig.token) {
        throw new Error('Jira not configured')
      }
      const jiraDevs = developers.filter((d) => d.jiraEmail)
      if (!jiraDevs.length) throw new Error('No developers have a Jira email set')

      const emailList = jiraDevs.map((d) => `"${d.jiraEmail}"`).join(',')
      const projList = jiraConfig.projectKeys.map((k) => `"${k.trim()}"`).join(',')
      const jql = projList
        ? `project in (${projList}) AND assignee in (${emailList}) AND statusCategory != Done ORDER BY updated DESC`
        : `assignee in (${emailList}) AND statusCategory != Done ORDER BY updated DESC`

      const issues = await fetchJiraIssues(jiraConfig, jql)

      const today = todayStr()
      let added = 0
      let updated = 0

      const tasksCopy = tasks.map((t) => ({ ...t, jiras: [...(t.jiras ?? [])] }))
      const newTasks: Task[] = []

      // Group issues by developer
      const byDev = new Map<string, typeof issues>()
      issues.forEach((issue) => {
        const email = issue.fields.assignee?.emailAddress
        const dev = jiraDevs.find((d) => d.jiraEmail?.toLowerCase() === email?.toLowerCase())
        if (!dev) return
        const arr = byDev.get(dev.id) ?? []
        arr.push(issue)
        byDev.set(dev.id, arr)
      })

      byDev.forEach((devIssues, devId) => {
        const syncTask = tasksCopy.find((t) => t.devId === devId && t.date === today && t.jiraSync)
        const incoming = devIssues.map((i) => rawToJiraItem(i, jiraConfig.baseUrl))

        // Build a key→task map of every issue already in today's tasks for this dev (across all tasks)
        const todayTasks = tasksCopy.filter((t) => t.devId === devId && t.date === today)
        const keyToTask = new Map<string, { task: typeof tasksCopy[number]; idx: number }>()
        todayTasks.forEach((t) => {
          ;(t.jiras ?? []).forEach((j, idx) => {
            const k = jiraDedupeKey(j.url, j.name)
            if (k && k !== 'name:') keyToTask.set(k, { task: t, idx })
          })
        })

        const trulyNew: typeof incoming = []

        incoming.forEach((nj) => {
          const njKey = jiraDedupeKey(nj.url, nj.name)

          // Check existing in the jiraSync task first (by key or URL)
          if (syncTask) {
            const existIdx = syncTask.jiras.findIndex((ej) => {
              const ejKey = jiraDedupeKey(ej.url, ej.name)
              return (njKey && njKey !== 'name:' && ejKey === njKey) || ej.url === nj.url
            })
            if (existIdx >= 0) {
              const ex = syncTask.jiras[existIdx]
              syncTask.jiras[existIdx] = { ...ex, status: nj.status, priority: nj.priority, deadline: nj.deadline || ex.deadline }
              updated++
              return
            }
          }

          // Check if the same key exists in any other task today
          if (njKey && njKey !== 'name:' && keyToTask.has(njKey)) {
            const { task, idx } = keyToTask.get(njKey)!
            const ex = task.jiras[idx]
            task.jiras[idx] = { ...ex, status: nj.status, priority: nj.priority, deadline: nj.deadline || ex.deadline }
            updated++
            return
          }

          trulyNew.push(nj)
        })

        if (trulyNew.length > 0) {
          if (syncTask) {
            syncTask.jiras = [...syncTask.jiras, ...trulyNew]
            added += trulyNew.length
          } else {
            added += trulyNew.length
            newTasks.push({
              id: makeId('t'),
              devId,
              projectId: '',
              title: 'Jira Issues',
              status: 'inprogress',
              jira: '',
              jiras: trulyNew,
              pr: '',
              prs: [],
              deadline: '',
              deadlineTime: '',
              reviewDate: '',
              reviewTime: '',
              comment: '',
              date: today,
              jiraSync: true,
            })
          }
        }

        if (syncTask) {
          syncTask.status = syncTask.jiras.every((j) => j.status === 'done') ? 'done' : 'inprogress'
        }
      })

      const newConfig: JiraConfig = {
        ...jiraConfig,
        lastSync: new Date().toISOString(),
        lastSyncResult: `+${added} added, ${updated} updated`,
      }
      set((s) => withSave({ ...s, tasks: [...tasksCopy, ...newTasks], jiraConfig: newConfig }))
      return { added, updated }
    },

    setGitlabConfig: (gitlabConfig) => set((s) => withSave({ ...s, gitlabConfig })),

    syncGitlab: async () => {
      const { gitlabConfig, developers, tasks } = get()
      if (!gitlabConfig.enabled || !gitlabConfig.token || !gitlabConfig.groupPath) {
        throw new Error('GitLab not configured — open GitLab settings and save')
      }

      const mrs = await fetchGroupMRs(gitlabConfig)
      const glDevs = developers.filter((d) => d.gitlabUsername)

      let linked = 0
      let updated = 0
      const skippedNoKey: string[] = []
      const skippedNoIssue: string[] = []
      const tasksCopy = tasks.map((t) => ({ ...t, jiras: t.jiras.map((j) => ({ ...j, prs: [...(j.prs ?? [])] })) }))

      const findJiraInTasks = (searchTasks: typeof tasksCopy, jiraKey: string) => {
        const sorted = [...searchTasks].sort((a, b) => b.date.localeCompare(a.date))
        for (const task of sorted) {
          const idx = task.jiras.findIndex((j) => {
            const k = jiraDedupeKey(j.url, j.name)
            return k && k !== 'name:' && k.toUpperCase() === jiraKey
          })
          if (idx >= 0) return { task, idx }
        }
        return null
      }

      mrs.forEach((mr) => {
        const jiraKey = extractJiraKey(mr)
        if (!jiraKey) {
          skippedNoKey.push(`!${mr.iid} "${mr.title}"`)
          return
        }

        const createdAt = new Date(mr.created_at)
        const pushDate = createdAt.toISOString().slice(0, 10)
        const pushTime = createdAt.toTimeString().slice(0, 5)

        // Try dev-matched tasks first, then fall back to all tasks
        const matchedDev = glDevs.find((d) => d.gitlabUsername?.toLowerCase() === mr.author.username.toLowerCase())
        const devTasks = matchedDev ? tasksCopy.filter((t) => t.devId === matchedDev.id) : []
        const found = findJiraInTasks(devTasks, jiraKey) ?? findJiraInTasks(tasksCopy, jiraKey)

        if (!found) {
          skippedNoIssue.push(`!${mr.iid} [${jiraKey}]`)
          return
        }

        const { task, idx } = found
        const jira = task.jiras[idx]
        const alreadyLinked = jira.prs.some((p) => p.url === mr.web_url)
        if (alreadyLinked) {
          updated++
        } else {
          task.jiras[idx] = { ...jira, prs: [...jira.prs, { url: mr.web_url, date: pushDate, time: pushTime }] }
          linked++
        }
      })

      console.log(`[GitLab sync] done — linked=${linked} updated=${updated} noKey=${skippedNoKey.length} noIssue=${skippedNoIssue.length}`)
      if (skippedNoKey.length) console.log('[GitLab sync] no Jira key in branch/title:', skippedNoKey)
      if (skippedNoIssue.length) console.log('[GitLab sync] Jira key found but no matching issue in tracker:', skippedNoIssue)

      const newGitlabConfig: GitLabConfig = {
        ...gitlabConfig,
        lastSync: new Date().toISOString(),
        lastSyncResult: `+${linked} linked, ${updated} already tracked`,
      }
      set((s) => withSave({ ...s, tasks: tasksCopy, gitlabConfig: newGitlabConfig }))
      return { linked, updated }
    },

    exportJSON: () => {
      const { developers, projects, tasks, schedule, scheduleHours } = get()
      const blob = new Blob(
        [JSON.stringify({ _v: 2, exportedAt: new Date().toISOString(), developers, projects, tasks, schedule, scheduleHours }, null, 2)],
        { type: 'application/json' },
      )
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `pm-tracker-${todayStr()}.json`
      a.click()
    },

    importJSON: (json) => {
      const d = JSON.parse(json) as Partial<AppState> & { _v?: number; scheduleHours?: Record<string, Record<string, number>> }
      if (!d.developers || !d.tasks) throw new Error('Invalid backup file')
      set((s) =>
        withSave({
          ...s,
          developers: d.developers!.map((dev) => ({ periods: [], ...dev })),
          projects: (d.projects ?? []).map((p) => ({ ...p, members: p.members ?? [] })),
          tasks: d.tasks!,
          schedule: (d.schedule as Record<string, Record<string, string>>) ?? {},
          scheduleHours: d.scheduleHours ?? {},
          selectedDev: 'ALL',
          selectedProject: 'ALL',
        }),
      )
    },
  }
})

export function getVisibleDevIds(state: AppState): string[] {
  // An archived developer is only visible on dates up to and including their archive date.
  const activeOnDate = (d: AppState['developers'][number]) =>
    !d.archivedAt || state.selectedDate <= d.archivedAt

  if (state.selectedProject === 'ALL')
    return state.developers.filter(activeOnDate).map((d) => d.id)

  const proj = state.projects.find((p) => p.id === state.selectedProject)
  return proj?.members
    ? state.developers.filter((d) => proj.members.includes(d.id) && activeOnDate(d)).map((d) => d.id)
    : []
}

export function getVisibleTasks(state: AppState, devId?: string): Task[] {
  const base = state.tasks.filter((t) => {
    const dv = devId ? t.devId === devId : state.selectedDev === 'ALL' || t.devId === state.selectedDev
    const pj = state.selectedProject === 'ALL' || t.projectId === state.selectedProject
    return dv && pj && t.date === state.selectedDate
  })

  // Non-carried tasks claim their jira identities first so carry-over duplicates are hidden.
  const ordered = [...base].sort((a, b) => {
    if (a.carriedOver !== b.carriedOver) return a.carriedOver ? 1 : -1
    return a.id < b.id ? -1 : 1
  })

  const seenJira = new Set<string>()
  const result: Task[] = []

  for (const t of ordered) {
    if (Array.isArray(t.jiras) && t.jiras.length > 0) {
      const freshJiras = t.jiras.filter((j) => {
        const dk = jiraDedupeKey(j.url, j.name)
        const identity = dk && dk !== 'name:' ? dk : j.issueId
        if (!identity) return true
        const k = `${t.devId}:${identity}`
        if (seenJira.has(k)) return false
        seenJira.add(k)
        return true
      })
      if (freshJiras.length > 0) {
        result.push(freshJiras.length !== t.jiras.length ? { ...t, jiras: freshJiras } : t)
      } else if (!t.carriedOver && (t.deadline || t.comment || t.pr || (t.prs?.length ?? 0) > 0)) {
        // Non-carried task lost all its jiras to dedup but still has other content worth showing
        result.push({ ...t, jiras: [] })
      }
      // Carried task with no remaining jiras: silently drop — the surviving card already shows everything
    } else {
      // Task has no jiras array (old-format uses t.jira string)
      if (t.jira) {
        const dk = jiraDedupeKey(t.jira, '')
        if (dk && dk !== 'name:') {
          const k = `${t.devId}:${dk}`
          if (seenJira.has(k)) {
            // Only keep if non-carried with independent content
            if (!t.carriedOver && (t.deadline || t.comment)) result.push(t)
          } else {
            seenJira.add(k)
            result.push(t)
          }
        } else {
          result.push(t)
        }
      } else {
        // No jiras at all — hide carried shells, show non-carried only if they have content
        const hasContent = !!(t.deadline || t.comment || t.pr || (t.prs?.length ?? 0) > 0)
        if (!t.carriedOver || hasContent) result.push(t)
      }
    }
  }

  return result
}

export function countUrgentDeadlines(
  tasks: AppState['tasks'],
  developers: AppState['developers'],
): number {
  const today = todayStr()
  const yesterday = new Date(new Date(today + 'T12:00:00').getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10)
  const archivedIds = new Set(developers.filter((d) => d.archivedAt).map((d) => d.id))

  // Mirror DeadlinesView exactly: today + yesterday window, deduped, exclude archived
  const jiraMap = new Map<string, { status: string; taskDate: string }>()

  tasks.forEach((t) => {
    if (archivedIds.has(t.devId)) return
    if (t.date !== today && t.date !== yesterday) return
    const jiras = getJiras(t)
    if (jiras.length) {
      jiras.forEach((j, ji) => {
        const k = `${t.devId}|${jiraDedupeKey(j.url, j.name) || `_anon${ji}`}`
        const ex = jiraMap.get(k)
        if (!ex || t.date > ex.taskDate) jiraMap.set(k, { status: j.status, taskDate: t.date })
      })
    } else if (t.deadline) {
      const k = `${t.devId}|task-title:${t.title}`
      const ex = jiraMap.get(k)
      if (!ex || t.date > ex.taskDate) jiraMap.set(k, { status: t.status, taskDate: t.date })
    }
  })

  let count = 0
  jiraMap.forEach(({ status }) => { if (status !== 'done') count++ })
  return count
}
