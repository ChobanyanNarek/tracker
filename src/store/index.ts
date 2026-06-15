import { create } from 'zustand'
import type { AppState, Developer, Project, Task, JiraIssue, JiraConfig, View, EmploymentPeriod } from '../types'
import { todayStr, offsetDate, nextWorkDay } from '../utils/dates'
import { getJiras } from '../utils/format'
import { fetchJiraIssues, rawToJiraItem } from '../utils/jira-api'

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

  addProject: (p: Omit<Project, 'id'>) => void
  deleteProject: (id: string) => void
  toggleMember: (projId: string, devId: string) => void

  addTask: (t: Omit<Task, 'id'>) => void
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  duplicateTask: (id: string, targetDate: string) => void
  carryOver: (id: string) => string | null
  autoCarryOverdue: () => boolean

  updateJiraStatus: (taskId: string, jiraIdx: number, status: JiraIssue['status']) => void
  updateJiraPriority: (taskId: string, jiraIdx: number, priority: JiraIssue['priority']) => void
  reorderJiras: (taskId: string, fromIdx: number, toIdx: number) => void

  setScheduleDay: (devId: string, date: string, type: string | null) => void
  setScheduleHours: (devId: string, date: string, hours: number) => void

  setNotifsEnabled: (v: boolean) => void
  setJiraConfig: (cfg: JiraConfig) => void
  syncJira: () => Promise<{ added: number; updated: number }>
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
      set((s) => withSave({ ...s, tasks: [...s.tasks, { id: makeId('t'), ...t }] })),

    updateTask: (id, patch) =>
      set((s) =>
        withSave({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
      ),

    deleteTask: (id) =>
      set((s) => withSave({ ...s, tasks: s.tasks.filter((t) => t.id !== id) })),

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

      // Unique key for a jira item — prefer URL, fall back to name
      function jiraKey(url: string, name: string): string {
        return url || `name:${name}`
      }

      // Returns true if a jira is marked done in any later task for the same dev
      function isDoneInLaterTask(devId: string, url: string, name: string, afterDate: string): boolean {
        const key = jiraKey(url, name)
        if (!key) return false
        return tasks.some(
          (x) =>
            x.devId === devId &&
            x.date > afterDate &&
            (x.jiras ?? []).some(
              (j) => jiraKey(j.url, j.name) === key && j.status === 'done',
            ),
        )
      }

      const unfinished = tasks.filter((t) => {
        if (t.date >= today || t.carriedOver) return false
        const jiras = getJiras(t)
        if (jiras.length) {
          return jiras.some(
            (j) => j.status !== 'done' && !isDoneInLaterTask(t.devId, j.url, j.name, t.date),
          )
        }
        return t.status !== 'done'
      })
      if (!unfinished.length) return false

      let carried = 0
      const newTasks: Task[] = []
      // Track jira URLs already scheduled on a given dev+date to prevent cross-task duplicates
      const scheduledUrls = new Map<string, Set<string>>()

      function getScheduled(devId: string, date: string): Set<string> {
        const key = `${devId}|${date}`
        if (!scheduledUrls.has(key)) {
          const existing = new Set<string>()
          // Seed with jiras already present in existing tasks on that date
          tasks
            .filter((x) => x.devId === devId && x.date === date)
            .forEach((x) => (x.jiras ?? []).forEach((j) => {
              const k = jiraKey(j.url, j.name)
              if (k) existing.add(k)
            }))
          scheduledUrls.set(key, existing)
        }
        return scheduledUrls.get(key)!
      }

      unfinished.forEach((t) => {
        const targetDate = nextWorkDay(t.date)
        const exists = tasks.some(
          (x) => x.devId === t.devId && x.title === t.title && x.date === targetDate,
        )
        if (exists) return
        const scheduled = getScheduled(t.devId, targetDate)
        const pendingJiras = (t.jiras ?? [])
          .map((j, i) => ({ ...j, _srcIdx: j._srcIdx ?? i }))
          .filter((j) => {
            if (j.status === 'done') return false
            if (isDoneInLaterTask(t.devId, j.url, j.name, t.date)) return false
            const k = jiraKey(j.url, j.name)
            if (k && scheduled.has(k)) return false
            return true
          })
        if (t.jiras?.length && !pendingJiras.length) return
        // Register these jiras as scheduled so later tasks don't duplicate them
        pendingJiras.forEach((j) => { const k = jiraKey(j.url, j.name); if (k) scheduled.add(k) })
        newTasks.push({
          ...t,
          id: makeId('t'),
          date: targetDate,
          carriedOver: true,
          carriedFrom: t.date,
          jiras: pendingJiras.length ? pendingJiras : (t.jiras ?? []).map((j) => ({ ...j })),
          prs: (t.prs ?? []).map((p) => ({ ...p })),
        })
        carried++
      })
      if (carried > 0) set((s) => withSave({ ...s, tasks: [...s.tasks, ...newTasks] }))
      return carried > 0
    },

    updateJiraStatus: (taskId, jiraIdx, status) =>
      set((s) => {
        const targetTask = s.tasks.find((t) => t.id === taskId)
        const targetJira = targetTask?.jiras?.[jiraIdx]
        const targetKey = targetJira ? (targetJira.url || `name:${targetJira.name}`) : null

        return withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id === taskId) {
              if (!t.jiras) return t
              const jiras = t.jiras.map((j, i) => (i === jiraIdx ? { ...j, status } : j))
              const allDone = jiras.every((j) => j.status === 'done')
              const hasBlocked = jiras.some((j) => j.status === 'blocked')
              return { ...t, jiras, status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo' }
            }
            // Propagate done/undone to all copies of this jira for the same dev
            if (targetKey && targetTask && t.devId === targetTask.devId && t.jiras) {
              const jiras = t.jiras.map((j) => {
                const k = j.url || `name:${j.name}`
                return k === targetKey ? { ...j, status } : j
              })
              if (jiras.every((j, i) => j === t.jiras![i])) return t
              const allDone = jiras.every((j) => j.status === 'done')
              const hasBlocked = jiras.some((j) => j.status === 'blocked')
              return { ...t, jiras, status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo' }
            }
            return t
          }),
        })
      }),

    updateJiraPriority: (taskId, jiraIdx, priority) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            return { ...t, jiras: t.jiras.map((j, i) => (i === jiraIdx ? { ...j, priority } : j)) }
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

        if (syncTask) {
          const merged = incoming.map((nj) => {
            const existing = syncTask.jiras.find((ej) => ej.url === nj.url)
            if (existing) {
              updated++
              return { ...existing, status: nj.status, priority: nj.priority, deadline: nj.deadline || existing.deadline }
            }
            added++
            return nj
          })
          const manual = syncTask.jiras.filter((ej) => !incoming.some((nj) => nj.url === ej.url))
          syncTask.jiras = [...merged, ...manual]
          syncTask.status = syncTask.jiras.every((j) => j.status === 'done') ? 'done' : 'inprogress'
        } else {
          added += incoming.length
          newTasks.push({
            id: makeId('t'),
            devId,
            projectId: '',
            title: 'Jira Issues',
            status: 'inprogress',
            jira: '',
            jiras: incoming,
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
      })

      const newConfig: JiraConfig = {
        ...jiraConfig,
        lastSync: new Date().toISOString(),
        lastSyncResult: `+${added} added, ${updated} updated`,
      }
      set((s) => withSave({ ...s, tasks: [...tasksCopy, ...newTasks], jiraConfig: newConfig }))
      return { added, updated }
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
  if (state.selectedProject === 'ALL') return state.developers.map((d) => d.id)
  const proj = state.projects.find((p) => p.id === state.selectedProject)
  return proj?.members
    ? state.developers.filter((d) => proj.members.includes(d.id)).map((d) => d.id)
    : []
}

export function getVisibleTasks(state: AppState, devId?: string): Task[] {
  return state.tasks.filter((t) => {
    const dv = devId ? t.devId === devId : state.selectedDev === 'ALL' || t.devId === state.selectedDev
    const pj = state.selectedProject === 'ALL' || t.projectId === state.selectedProject
    const dt = t.date === state.selectedDate
    return dv && pj && dt
  })
}

export function countUrgentDeadlines(tasks: AppState['tasks']): number {
  const seen = new Set<string>()
  let count = 0
  tasks.forEach((t) => {
    const jiras = getJiras(t)
    if (jiras.length) {
      jiras.forEach((j) => {
        if (!j.deadline || j.status === 'done') return
        const dedupeKey = `${t.devId}|${j.name || j.url}|${j.deadline}`
        if (seen.has(dedupeKey)) return
        seen.add(dedupeKey)
        count++
      })
    } else if (t.deadline && t.status !== 'done') {
      const dedupeKey = `${t.devId}|${t.title}|${t.deadline}`
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      count++
    }
  })
  return count
}
