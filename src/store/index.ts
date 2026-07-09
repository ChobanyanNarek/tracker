import { create } from 'zustand'
import type { AppState, Developer, Project, Task, JiraIssue, JiraConfig, GitLabConfig, View, EmploymentPeriod, PrEntry } from '../types'
import { loadCloudState, saveCloudState } from '../utils/cloud-api'
import { todayStr, offsetDate, nextWorkDay, prevWorkDay, latestWorkday } from '../utils/dates'
import { getJiras, jiraDedupeKey } from '../utils/format'
import { fetchJiraIssues, rawToJiraItem, mergeStatusHistory } from '../utils/jira-api'
import type { JiraIssueRaw } from '../utils/jira-api'
import { fetchGroupMRs, fetchUserMRs, extractJiraKeys } from '../utils/gitlab-api'
import { resolveTrackerTz } from '../utils/working-hours'

const LS_KEY = 'pmtracker_v4'

function makeId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6)
}

// Match a jira by its stable issueId; fall back to URL only when the URL is
// non-empty. Without the non-empty guard, a URL-less issue (issueId undefined,
// url '') would match every other URL-less issue in the task, so a single
// delete/hide/update would hit them all.
function makeJiraMatcher(issueId: string | undefined, url: string) {
  return (j: JiraIssue) => (issueId ? j.issueId === issueId : !!url && j.url === url)
}

// Keeps a checkpoint's issue list tidy: active work on top, finished work
// beneath it, hidden issues always last. A stable 3-way partition — relative
// order within each tier (including manual drag order) is never disturbed.
function sortJiraIssues(jiras: JiraIssue[]): JiraIssue[] {
  const active = jiras.filter((j) => !j.hidden && j.status !== 'done')
  const done = jiras.filter((j) => !j.hidden && j.status === 'done')
  const hidden = jiras.filter((j) => j.hidden)
  return [...active, ...done, ...hidden]
}

// Ensure a persisted/imported task has the array fields every consumer assumes.
// Old-format tasks (jira string, no jiras[]) and pre-`prs` jiras otherwise force
// defensive `?? []` everywhere and can crash code paths that don't guard.
function normalizeTask(t: Task): Task {
  return {
    ...t,
    jiras: (t.jiras ?? []).map((j) => ({ ...j, prs: j.prs ?? [] })),
    prs: t.prs ?? [],
  }
}

function freshState(): AppState {
  const today = todayStr()
  return {
    selectedDev: 'ALL',
    selectedProject: 'ALL',
    selectedDate: today,
    view: 'daily',
    highlightedTaskId: null,
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
  const payload = {
    _v: 2,
    developers: state.developers,
    projects: state.projects,
    tasks: state.tasks,
    schedule: state.schedule,
    scheduleHours: state.scheduleHours,
    notifsEnabled: state.notifsEnabled,
    jiraConfig: state.jiraConfig,
    gitlabConfig: state.gitlabConfig,
    trackerTimezone: state.trackerTimezone,
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload))
  } catch {}
  void saveCloudState(payload as Record<string, unknown>)
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
      tasks: d.tasks?.map(normalizeTask),
      schedule: sched,
      scheduleHours: (d as AppState & { scheduleHours?: Record<string, Record<string, number>> }).scheduleHours ?? {},
      notifsEnabled: (d as AppState).notifsEnabled ?? false,
      ...((d as AppState).jiraConfig ? { jiraConfig: (d as AppState).jiraConfig } : {}),
      ...((d as AppState).gitlabConfig ? { gitlabConfig: (d as AppState).gitlabConfig } : {}),
      ...((d as AppState).trackerTimezone ? { trackerTimezone: (d as AppState).trackerTimezone } : {}),
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
  addPrToJira: (taskId: string, issueId: string | undefined, url: string, mrUrl: string) => void

  addDeveloper: (dev: Omit<Developer, 'id'>) => void
  removeDeveloper: (id: string) => void
  updateDeveloperPeriods: (devId: string, periods: EmploymentPeriod[]) => void
  updateDeveloperSchedule: (devId: string, workSchedule: import('../types').WorkSchedule) => void
  reorderDeveloper: (fromId: string, toId: string) => void
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
  mergeSameDayTasks: () => void

  updateJiraStatus: (taskId: string, issueId: string | undefined, url: string, status: JiraIssue['status']) => void
  updateJiraPriority: (taskId: string, issueId: string | undefined, url: string, priority: JiraIssue['priority']) => void
  updateJira: (taskId: string, issueId: string | undefined, url: string, patch: Partial<JiraIssue>) => void
  reorderJiras: (taskId: string, fromId: string, toId: string) => void
  deleteJira: (taskId: string, issueId: string | undefined, url: string) => void
  toggleJiraHidden: (taskId: string, issueId: string | undefined, url: string) => void

  setScheduleDay: (devId: string, date: string, type: string | null) => void
  setScheduleHours: (devId: string, date: string, hours: number) => void

  setNotifsEnabled: (v: boolean) => void
  setTrackerTimezone: (tz: string | undefined) => void
  setJiraConfig: (cfg: JiraConfig) => void
  syncJira: () => Promise<{ added: number; updated: number; removed: number }>
  setGitlabConfig: (cfg: GitLabConfig) => void
  syncGitlab: () => Promise<{ linked: number; updated: number; noKey: number; noIssue: number; noKeyList: string[]; noIssueList: string[] }>
  debugGitlab: () => Promise<void>
  exportJSON: () => void
  importJSON: (json: string) => void
  setHighlightedTaskId: (id: string | null) => void
}

type Store = AppState & StoreActions

function withSave(state: AppState): AppState {
  persistState(state)
  return state
}

// Load cloud state once on startup and merge into store
loadCloudState().then((cloud) => {
  if (!cloud) return
  useStore.setState((s) => ({
    ...s,
    ...(cloud.developers ? { developers: (cloud.developers as AppState['developers']).map((d) => ({ periods: [], ...d })) } : {}),
    ...(cloud.projects ? { projects: (cloud.projects as AppState['projects']).map((p) => ({ ...p, members: (p as { members?: string[] }).members ?? [] })) } : {}),
    ...(cloud.tasks ? { tasks: (cloud.tasks as AppState['tasks']).map(normalizeTask) } : {}),
    ...(cloud.schedule ? { schedule: cloud.schedule as AppState['schedule'] } : {}),
    ...(cloud.scheduleHours ? { scheduleHours: cloud.scheduleHours as AppState['scheduleHours'] } : {}),
    ...(cloud.jiraConfig ? { jiraConfig: cloud.jiraConfig as AppState['jiraConfig'] } : {}),
    ...(cloud.gitlabConfig ? { gitlabConfig: cloud.gitlabConfig as AppState['gitlabConfig'] } : {}),
    ...(cloud.trackerTimezone !== undefined ? { trackerTimezone: cloud.trackerTimezone as string | undefined } : {}),
  }))
}).catch(() => {})

export const useStore = create<Store>((set, get) => {
  const base = { ...freshState(), ...loadState() }

  return {
    ...base,

    setView: (view) => set({ view }),
    setSelectedDate: (selectedDate) => set({ selectedDate }),
    setSelectedDev: (selectedDev) => set({ selectedDev }),
    setSelectedProject: (selectedProject) => set({ selectedProject, selectedDev: 'ALL' }),
    setHighlightedTaskId: (highlightedTaskId) => set({ highlightedTaskId }),

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

    updateDeveloperSchedule: (devId, workSchedule) =>
      set((s) =>
        withSave({
          ...s,
          developers: s.developers.map((d) => (d.id === devId ? { ...d, workSchedule } : d)),
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

    reorderDeveloper: (fromId, toId) =>
      set((s) => {
        const arr = [...s.developers]
        const fromIdx = arr.findIndex((d) => d.id === fromId)
        const toIdx = arr.findIndex((d) => d.id === toId)
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return s
        const [moved] = arr.splice(fromIdx, 1)
        arr.splice(toIdx, 0, moved!)
        return withSave({ ...s, developers: arr })
      }),

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
          manualStatus: undefined,
          statusHistory: undefined,
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
        // De-dup by stable identity (issueId / dedupeKey), consistent with
        // autoCarryOverdue. _srcIdx is positional and breaks when the source
        // list changes order or length between two carry-overs.
        const existingIds = new Set<string>()
        ;(existing.jiras ?? []).forEach((j) => {
          if (j.issueId) existingIds.add(j.issueId)
          const dk = jiraDedupeKey(j.url, j.name)
          if (dk && dk !== 'name:') existingIds.add(dk)
        })
        const toAdd = pending.filter((j) => {
          if (j.issueId && existingIds.has(j.issueId)) return false
          const dk = jiraDedupeKey(j.url, j.name)
          return !(dk && dk !== 'name:' && existingIds.has(dk))
        })
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

      // Build set of URLs explicitly deleted from today's tasks per dev — don't re-carry these
      const deletedTodayUrls = new Map<string, Set<string>>()
      tasks
        .filter((x) => x.date === today && x.deletedJiraUrls?.length)
        .forEach((x) => {
          if (!deletedTodayUrls.has(x.devId)) deletedTodayUrls.set(x.devId, new Set())
          x.deletedJiraUrls!.forEach((u) => deletedTodayUrls.get(x.devId)!.add(u))
        })

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
              // Don't re-carry issues the user explicitly deleted — either from
              // today's tasks or from this source task itself (deleted on its own day).
              if (deletedTodayUrls.get(t.devId)?.has(j.url)) return false
              if (t.deletedJiraUrls?.includes(j.url)) return false
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

    mergeSameDayTasks: () => {
      const { tasks } = get()

      // A developer has ONE card per day. Multiple records for the same dev+date
      // (e.g. a manual checkpoint plus a carried-over one) render seamlessly but
      // keep issues in separate arrays, which breaks drag-reordering across them.
      // Merge each group into a single record so all issues live in one list.
      const groups = new Map<string, Task[]>()
      tasks.forEach((t) => {
        const k = `${t.devId}|${t.date}`
        const g = groups.get(k)
        if (g) g.push(t)
        else groups.set(k, [t])
      })

      if (![...groups.values()].some((g) => g.length > 1)) return

      const merged: Task[] = []
      let changed = false

      groups.forEach((group) => {
        if (group.length === 1) { merged.push(group[0]); return }
        // Only merge records that all use the jiras array — legacy string-format
        // tasks (no jiras) are left untouched.
        if (group.some((t) => !Array.isArray(t.jiras))) { merged.push(...group); return }

        changed = true
        // Originals first, carried copies after — same convention as deduplicateJiras.
        const ordered = [...group].sort((a, b) => {
          if (!!a.carriedOver !== !!b.carriedOver) return a.carriedOver ? 1 : -1
          return a.id < b.id ? -1 : 1
        })
        const base = ordered[0]
        const jiras = sortJiraIssues(ordered.flatMap((t) => t.jiras!)).map((j, i) => ({ ...j, _srcIdx: i }))
        const comments = [...new Set(ordered.map((t) => t.comment?.trim()).filter(Boolean))]
        const deletedJiraUrls = [...new Set(ordered.flatMap((t) => t.deletedJiraUrls ?? []))]
        // Keep carry provenance if any record was carried — deleteTask uses it to
        // mark source-day issues done so they don't get re-carried.
        const carried = ordered.find((t) => t.carriedOver && t.carriedFrom)
        const allDone = jiras.length > 0 && jiras.every((j) => j.status === 'done')
        const hasBlocked = jiras.some((j) => j.status === 'blocked')

        merged.push({
          ...base,
          jiras,
          title: jiras[0]?.name || jiras[0]?.url || base.title,
          status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo',
          jira: jiras[0]?.url ?? '',
          deadline: jiras[0]?.deadline ?? '',
          deadlineTime: jiras[0]?.deadlineTime ?? '',
          comment: comments.join('\n'),
          ...(deletedJiraUrls.length ? { deletedJiraUrls } : {}),
          ...(carried ? { carriedOver: true, carriedFrom: carried.carriedFrom } : {}),
        })
      })

      if (changed) set((s) => withSave({ ...s, tasks: merged }))
    },

    updateJiraStatus: (taskId, issueId, url, status) =>
      set((s) => {
        const targetTask = s.tasks.find((t) => t.id === taskId)
        const matchJira = makeJiraMatcher(issueId, url)

        return withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (!t.jiras) return t
            if (t.id === taskId) {
              const now = new Date().toISOString()
              const updated = t.jiras.map((j) => {
                if (!matchJira(j)) return j
                const history = j.statusHistory ?? [{ status: j.status, at: now }]
                return { ...j, status, manualStatus: status, statusHistory: [...history, { status, at: now }] }
              })
              // Status just changed — re-tier so a freshly-done issue sinks below
              // active work (and a re-opened one rejoins it) at the moment it flips.
              const jiras = sortJiraIssues(updated)
              const allDone = jiras.every((j) => j.status === 'done')
              const hasBlocked = jiras.some((j) => j.status === 'blocked')
              return { ...t, jiras, status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo' }
            }
            // Propagate by issueId to every other task for the same dev
            if (issueId && targetTask && t.devId === targetTask.devId) {
              const now = new Date().toISOString()
              const updated = t.jiras.map((j) => {
                if (j.issueId !== issueId) return j
                const history = j.statusHistory ?? [{ status: j.status, at: now }]
                return { ...j, status, manualStatus: status, statusHistory: [...history, { status, at: now }] }
              })
              if (updated.every((j, i) => j === t.jiras![i])) return t
              const jiras = sortJiraIssues(updated)
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
            const matchJira = makeJiraMatcher(issueId, url)
            return { ...t, jiras: t.jiras.map((j) => matchJira(j) ? { ...j, priority } : j) }
          }),
        }),
      ),

    updateJira: (taskId, issueId, url, patch) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            const matchJira = makeJiraMatcher(issueId, url)
            const now = new Date().toISOString()
            const updated = t.jiras.map((j) => {
              if (!matchJira(j)) return j
              const next = { ...j, ...patch }
              // A status change through direct edit is a manual override — record
              // history and pin it so Jira sync doesn't silently revert it.
              if (patch.status && patch.status !== j.status) {
                const history = j.statusHistory ?? [{ status: j.status, at: now }]
                next.manualStatus = patch.status
                next.statusHistory = [...history, { status: patch.status, at: now }]
              }
              return next
            })
            // Re-tier only when the edit actually touched status — otherwise a
            // plain rename/comment edit shouldn't reshuffle the list.
            const jiras = patch.status ? sortJiraIssues(updated) : updated
            const allDone = jiras.length > 0 && jiras.every((j) => j.status === 'done')
            const hasBlocked = jiras.some((j) => j.status === 'blocked')
            return {
              ...t,
              jiras,
              title: jiras[0]?.name || jiras[0]?.url || t.title,
              status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo',
              jira: jiras[0]?.url ?? '',
              deadline: jiras[0]?.deadline ?? '',
              deadlineTime: jiras[0]?.deadlineTime ?? '',
            }
          }),
        }),
      ),

    reorderJiras: (taskId, fromId, toId) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            // Reorder by stable identity, not display index — the displayed list
            // can be a deduped subset of the stored jiras, so positional indices
            // would move the wrong issue.
            const idOf = (j: JiraIssue) => j.issueId ?? j.url ?? ''
            const jiras = [...t.jiras]
            const fromIdx = jiras.findIndex((j) => idOf(j) === fromId)
            const toIdx = jiras.findIndex((j) => idOf(j) === toId)
            if (fromIdx < 0 || toIdx < 0) return t
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
            const matchJira = makeJiraMatcher(issueId, url)
            const deletedUrls = t.jiras.filter((j) => matchJira(j)).map((j) => j.url).filter(Boolean)
            const jiras = t.jiras.filter((j) => !matchJira(j))
            const deletedJiraUrls = [...new Set([...(t.deletedJiraUrls ?? []), ...deletedUrls])]
            return { ...t, jiras, deletedJiraUrls, ...(jiras.length === 0 ? { jira: '' } : {}) }
          }),
        }),
      ),

    toggleJiraHidden: (taskId, issueId, url) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            const matchJira = makeJiraMatcher(issueId, url)
            const toggled = t.jiras.map((j) => (matchJira(j) ? { ...j, hidden: !j.hidden } : j))
            return { ...t, jiras: sortJiraIssues(toggled) }
          }),
        }),
      ),

    addPrToJira: (taskId, issueId, url, mrUrl) =>
      set((s) =>
        withSave({
          ...s,
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId || !t.jiras) return t
            const matchJira = makeJiraMatcher(issueId, url)
            const now = new Date().toISOString()
            const updated = t.jiras.map((j) => {
              if (!matchJira(j)) return j
              if ((j.prs ?? []).some((p) => p.url === mrUrl)) return j
              const history = j.statusHistory ?? [{ status: j.status, at: now }]
              return {
                ...j,
                prs: [...(j.prs ?? []), { url: mrUrl, date: todayStr(), time: '' }],
                status: 'done' as JiraIssue['status'],
                manualStatus: 'done' as JiraIssue['status'],
                statusHistory: [...history, { status: 'done' as JiraIssue['status'], at: now }],
              }
            })
            const jiras = sortJiraIssues(updated)
            const allDone = jiras.every((j) => j.status === 'done')
            const hasBlocked = jiras.some((j) => j.status === 'blocked')
            return { ...t, jiras, status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo' }
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

    setTrackerTimezone: (trackerTimezone) => set((s) => withSave({ ...s, trackerTimezone })),

    setJiraConfig: (jiraConfig) => set((s) => withSave({ ...s, jiraConfig })),

    syncJira: async () => {
      const { jiraConfig, developers, tasks } = get()
      if (!jiraConfig.enabled || !jiraConfig.baseUrl || !jiraConfig.token) {
        throw new Error('Jira not configured')
      }
      const jiraDevs = developers.filter((d) => d.jiraEmail)
      if (!jiraDevs.length) throw new Error('No developers have a Jira email set')

      const projList = jiraConfig.projectKeys.map((k) => `"${k.trim()}"`).join(',')

      // Query one dev at a time — Jira Cloud hides emailAddress in API responses,
      // so we can't match by email after the fact. Querying per-dev sidesteps this.
      const byDev = new Map<string, JiraIssueRaw[]>()
      for (const dev of jiraDevs) {
        // Recently-closed issues are fetched too so they can be REMOVED from the
        // tracker (see closedKeys below) — the open-status list alone would never
        // return them and closed issues would linger on the board forever.
        const statusFilter = `(status in ("To Do", "In Progress", "Code Review", "Blocked", "Backlog") OR (status = "Closed" AND updated >= -7d))`
        const devJql = projList
          ? `project in (${projList}) AND assignee = "${dev.jiraEmail}" AND ${statusFilter} ORDER BY updated DESC`
          : `assignee = "${dev.jiraEmail}" AND ${statusFilter} ORDER BY updated DESC`
        const devIssues = await fetchJiraIssues(jiraConfig, devJql)
        if (devIssues.length) byDev.set(dev.id, devIssues)
      }

      const today = latestWorkday()
      let added = 0
      let updated = 0
      let removed = 0

      // Normalize: mark any 'Jira Issues' titled task as jiraSync (catches legacy tasks without the flag)
      const tasksCopy = tasks.map((t) => ({
        ...t,
        jiras: [...(t.jiras ?? [])],
        jiraSync: t.jiraSync || t.title === 'Jira Issues' || undefined,
      }))

      // Pre-merge: collapse all jiraSync tasks for the same dev+date into one card
      const mergedIds = new Set<string>()
      const primarySyncTask = new Map<string, typeof tasksCopy[number]>()
      tasksCopy.forEach((t) => {
        if (!t.jiraSync) return
        const key = `${t.devId}_${t.date}`
        const primary = primarySyncTask.get(key)
        if (!primary) {
          primarySyncTask.set(key, t)
        } else {
          ;(t.jiras ?? []).forEach((j) => {
            const k = jiraDedupeKey(j.url, j.name)
            const alreadyIn = primary.jiras.some((ej) => {
              const ek = jiraDedupeKey(ej.url, ej.name)
              return (k && k !== 'name:' && ek === k) || ej.url === j.url
            })
            if (!alreadyIn) primary.jiras.push(j)
          })
          // Merge deleted URLs so the primary task remembers all deletions
          if (t.deletedJiraUrls?.length) {
            primary.deletedJiraUrls = [...new Set([...(primary.deletedJiraUrls ?? []), ...t.deletedJiraUrls])]
          }
          mergedIds.add(t.id)
        }
      })
      const dedupedTasks = tasksCopy.filter((t) => !mergedIds.has(t.id))

      const newTasks: Task[] = []

      byDev.forEach((devIssues, devId) => {
        const syncTask =
          dedupedTasks.find((t) => t.devId === devId && t.date === today && t.jiraSync) ??
          dedupedTasks.find((t) => t.devId === devId && t.date === today)

        // Issues that came back "Closed" from Jira are removed from the tracker
        // instead of updated — closed work must disappear from the board.
        const isClosed = (raw: JiraIssueRaw) => raw.fields.status.name.toLowerCase() === 'closed'
        const closedKeys = new Set<string>()
        devIssues.forEach((raw) => {
          if (!isClosed(raw)) return
          const url = `${jiraConfig.baseUrl.replace(/\/$/, '')}/browse/${raw.key}`
          const k = jiraDedupeKey(url, raw.fields.summary)
          if (k && k !== 'name:') closedKeys.add(k)
        })
        const incoming = devIssues.filter((raw) => !isClosed(raw)).map((i) => rawToJiraItem(i, jiraConfig.baseUrl))

        const todayTasks = dedupedTasks.filter((t) => t.devId === devId && t.date === today)

        // Drop closed issues from every one of today's tasks for this dev, and
        // remember their URLs so auto-carry doesn't resurrect them from yesterday.
        // Must run before keyToTask is built — it relies on stable jira indexes.
        if (closedKeys.size) {
          todayTasks.forEach((t) => {
            if (!t.jiras?.length) return
            const hit = (j: JiraIssue) => {
              const k = jiraDedupeKey(j.url, j.name)
              return !!(k && k !== 'name:' && closedKeys.has(k))
            }
            const keep = t.jiras.filter((j) => !hit(j))
            if (keep.length === t.jiras.length) return
            const removedUrls = t.jiras.filter(hit).map((j) => j.url).filter(Boolean)
            removed += t.jiras.length - keep.length
            t.jiras = keep
            t.deletedJiraUrls = [...new Set([...(t.deletedJiraUrls ?? []), ...removedUrls])]
          })
        }

        // Build a key→task map of every issue already in today's tasks for this dev (across all tasks)
        const keyToTask = new Map<string, { task: typeof dedupedTasks[number]; idx: number }>()
        todayTasks.forEach((t) => {
          ;(t.jiras ?? []).forEach((j, idx) => {
            const k = jiraDedupeKey(j.url, j.name)
            if (k && k !== 'name:') keyToTask.set(k, { task: t, idx })
          })
        })

        const trulyNew: typeof incoming = []

        const deletedUrls = new Set(syncTask?.deletedJiraUrls ?? [])

        incoming.forEach((nj) => {
          // Skip issues the user explicitly deleted from this task
          if (deletedUrls.has(nj.url)) return

          const njKey = jiraDedupeKey(nj.url, nj.name)

          // Check existing in the jiraSync task first (by key or URL)
          if (syncTask) {
            const existIdx = syncTask.jiras.findIndex((ej) => {
              const ejKey = jiraDedupeKey(ej.url, ej.name)
              return (njKey && njKey !== 'name:' && ejKey === njKey) || ej.url === nj.url
            })
            if (existIdx >= 0) {
              const ex = syncTask.jiras[existIdx]
              // Respect manually set status; 'done' from Jira always wins
              const resolvedStatus = nj.status === 'done' ? 'done' : (ex.manualStatus ?? nj.status)
              const resolvedManual = nj.status === 'done' ? undefined : ex.manualStatus
              syncTask.jiras[existIdx] = { ...ex, status: resolvedStatus, manualStatus: resolvedManual, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory) }
              updated++
              return
            }
          }

          // Check if the same key exists in any other task today
          if (njKey && njKey !== 'name:' && keyToTask.has(njKey)) {
            const { task, idx } = keyToTask.get(njKey)!
            const ex = task.jiras[idx]
            const resolvedStatus2 = nj.status === 'done' ? 'done' : (ex.manualStatus ?? nj.status)
            const resolvedManual2 = nj.status === 'done' ? undefined : ex.manualStatus
            task.jiras[idx] = { ...ex, status: resolvedStatus2, manualStatus: resolvedManual2, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory) }
            updated++
            return
          }

          // Only add brand-new issues if they are To Do or In Progress —
          // Code Review (mapped to 'done') only updates existing tracked issues.
          if (nj.status !== 'done') trulyNew.push(nj)
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
        lastSyncResult: `+${added} added, ${updated} updated${removed ? `, ${removed} closed removed` : ''}`,
      }
      // Merge PR links from the LIVE state (s.tasks) into dedupedTasks before saving.
      // syncJira's snapshot may be stale if a concurrent syncGitlab added PRs while
      // the Jira network request was in flight — without this, those PR links are lost.
      // IMPORTANT: preserve PRs per task-id only, never copy PRs across tasks that
      // share the same Jira URL — that would spread one day's carry-over PRs to every
      // other daily copy of the same issue.
      set((s) => {
        // Collect PR entries keyed by taskId → (jira identity → PrEntry[])
        const livePrsByTask = new Map<string, Map<string, PrEntry[]>>()
        for (const t of s.tasks) {
          for (const j of t.jiras ?? []) {
            if (!(j.prs ?? []).length) continue
            const identity = j.issueId ?? (j.url || null)
            if (!identity) continue
            if (!livePrsByTask.has(t.id)) livePrsByTask.set(t.id, new Map())
            const taskMap = livePrsByTask.get(t.id)!
            const arr = taskMap.get(identity) ?? []
            for (const p of j.prs ?? []) if (p.url && !arr.some((x) => x.url === p.url)) arr.push(p)
            taskMap.set(identity, arr)
          }
        }
        const merged = dedupedTasks.map((t) => {
          const taskLivePrs = livePrsByTask.get(t.id)
          const jiras = taskLivePrs?.size
            ? (t.jiras ?? []).map((j) => {
                const identity = j.issueId ?? (j.url || null)
                if (!identity) return j
                const live = taskLivePrs.get(identity)
                if (!live?.length) return j
                const existingUrls = new Set((j.prs ?? []).map((p) => p.url))
                const toAdd = live.filter((p) => !existingUrls.has(p.url))
                return toAdd.length ? { ...j, prs: [...(j.prs ?? []), ...toAdd] } : j
              })
            : (t.jiras ?? [])
          // Jira may have flipped some of these issues to done during this sync —
          // re-tier so they settle below active work.
          return { ...t, jiras: sortJiraIssues(jiras) }
        })
        return withSave({ ...s, tasks: [...merged, ...newTasks], jiraConfig: newConfig })
      })
      return { added, updated, removed }
    },

    setGitlabConfig: (gitlabConfig) => set((s) => withSave({ ...s, gitlabConfig })),

    syncGitlab: async () => {
      const { gitlabConfig, jiraConfig, tasks, trackerTimezone, developers } = get()
      if (!gitlabConfig.enabled || !gitlabConfig.token || !gitlabConfig.groupPath) {
        throw new Error('GitLab not configured — open GitLab settings and save')
      }

      // Convert GitLab's UTC created_at to the tracker timezone.
      const tz = resolveTrackerTz(trackerTimezone)
      const toLocalParts = (d: Date) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(d)
        const g = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
        return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` }
      }

      // Collect developer GitLab usernames for supplemental per-developer fetch.
      const devUsernames = developers
        .filter((d) => !d.archivedAt && d.gitlabUsername?.trim())
        .map((d) => d.gitlabUsername!.trim())

      // Fetch MRs in two passes and merge by id:
      //   Pass 1: group/project endpoint (works for Reporter+ roles).
      //   Pass 2: per-developer /users/:username/merge_requests (works at any role level).
      // Both passes are always attempted when usernames are configured. This covers the
      // common case where the token is Developer in some projects and Planner in others:
      // the group endpoint silently omits Planner-role projects, so pass 2 fills the gap.
      const mrById = new Map<number, Awaited<ReturnType<typeof fetchGroupMRs>>[number]>()

      try {
        const groupMrs = await fetchGroupMRs(gitlabConfig)
        for (const m of groupMrs) mrById.set(m.id, m)
      } catch (err) {
        const msg = (err as Error).message
        const isPermission = msg.includes('403') || msg.includes('Forbidden') || msg.includes('401')
        // Re-throw non-permission errors (bad token, network, etc.)
        // Permission errors with no usernames also re-throw — nothing we can do.
        if (!isPermission || devUsernames.length === 0) throw err
        // Otherwise fall through — pass 2 below will populate mrById.
      }

      if (devUsernames.length > 0) {
        const userMrs = await fetchUserMRs(devUsernames, gitlabConfig.token)
        for (const m of userMrs) mrById.set(m.id, m) // dedup by MR id
      }

      const mrs = [...mrById.values()]

      let linked = 0
      let updated = 0
      const skippedNoKey: string[] = []
      const skippedNoIssue: string[] = []

      // Anchor MR→issue matching on project keys: the ones configured for Jira,
      // PLUS prefixes derived from issues already tracked (e.g. MONE from MONE-957).
      const projectKeys = [
        ...new Set([
          ...jiraConfig.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean),
          ...tasks
            .flatMap((t) => t.jiras ?? [])
            .map((j) => jiraDedupeKey(j.url, j.name).match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toUpperCase() ?? '')
            .filter(Boolean),
        ]),
      ]

      // Build PR patches: taskId → (jiraIdentity → new PrEntry[]).
      // We never mutate a stale snapshot of tasks — instead we collect what needs
      // to be added and apply it surgically inside the set() callback below. This
      // avoids a race condition where a concurrent syncJira or autoCarryOverdue
      // could have modified the store while we were waiting on the network fetch.
      const prPatches = new Map<string, Map<string, PrEntry[]>>()
      // Maps each MR web_url to the jira status it should set (merged→done, open→review).
      // Stored separately because the set() callback runs after the loop ends.
      const mrUrlToStatus = new Map<string, JiraIssue['status']>()

      for (const mr of mrs) {
        const keys = extractJiraKeys(mr, projectKeys)
        if (!keys.length) {
          skippedNoKey.push(`!${mr.iid} "${mr.title}" [${mr.source_branch}]`)
          continue
        }

        const { date: pushDate, time: pushTime } = toLocalParts(new Date(mr.created_at))
        // Any linked MR — whether open or merged — marks the issue done,
        // mirroring the manual behaviour in IssueEditForm.
        mrUrlToStatus.set(mr.web_url, 'done')

        // Link the PR to every tracked issue whose key appears in the MR title OR
        // branch (covers stacked branches) — matched by dedupe key or by substring
        // — and to EVERY copy across all dates (carry-over handling).
        const keySet = new Set(keys) // already uppercase
        const keyRes = keys.map((key) => new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`, 'i'))
        const matchesIssue = (jira: JiraIssue) => {
          // Most reliable: the stored Jira issue ID (e.g. MONE-123)
          if (jira.issueId && keySet.has(jira.issueId.toUpperCase())) return true
          // Fallback: key extracted from the issue URL (covers manually-added issues)
          const k = jiraDedupeKey(jira.url, jira.name)
          if (k && k !== 'name:' && keySet.has(k.toUpperCase())) return true
          // URL-only regex check — deliberately excludes jira.name: the issue summary
          // may reference other ticket numbers (e.g. "Follow-up to MONE-1007") causing
          // false-positive links to the wrong MR.
          return keyRes.some((re) => re.test(jira.url ?? ''))
        }

        let matched = false
        let addedSomewhere = false

        for (const task of tasks) {
          for (const jira of (task.jiras ?? [])) {
            if (!matchesIssue(jira)) continue
            matched = true
            // Already stored — count as "already tracked" but don't re-add
            if ((jira.prs ?? []).some((p) => p.url === mr.web_url)) continue
            // Use issueId as the stable identity key, falling back to url
            const identity = jira.issueId ?? (jira.url || null)
            if (!identity) continue
            if (!prPatches.has(task.id)) prPatches.set(task.id, new Map())
            const taskPatch = prPatches.get(task.id)!
            const existing = taskPatch.get(identity) ?? []
            // Guard against the same MR appearing twice in this sync run
            if (!existing.some((p) => p.url === mr.web_url)) {
              taskPatch.set(identity, [...existing, { url: mr.web_url, date: pushDate, time: pushTime }])
              addedSomewhere = true
            }
          }
        }

        if (!matched) {
          skippedNoIssue.push(`!${mr.iid} [${keys.join(',')}]`)
          continue
        }
        if (addedSomewhere) linked++
        else updated++
      }

      if (skippedNoKey.length) console.info('[GitLab sync] no Jira key in branch/title:', skippedNoKey)
      if (skippedNoIssue.length) console.info('[GitLab sync] Jira key found but not tracked in any task:', skippedNoIssue)

      const parts = [`+${linked} linked`, `${updated} already`]
      if (skippedNoKey.length) parts.push(`${skippedNoKey.length} no-key`)
      if (skippedNoIssue.length) parts.push(`${skippedNoIssue.length} untracked`)
      const newGitlabConfig: GitLabConfig = {
        ...gitlabConfig,
        lastSync: new Date().toISOString(),
        lastSyncResult: parts.join(', '),
      }

      // Apply patches surgically to the CURRENT state — s.tasks reflects any
      // concurrent mutations that happened during the network fetch.
      set((s) => withSave({
        ...s,
        tasks: s.tasks.map((t) => {
          const taskPatch = prPatches.get(t.id)
          if (!taskPatch) return t
          let changed = false
          const jiras = (t.jiras ?? []).map((j) => {
            const identity = j.issueId ?? (j.url || null)
            if (!identity) return j
            const newPrs = taskPatch.get(identity)
            if (!newPrs?.length) return j
            const existingUrls = new Set((j.prs ?? []).map((p) => p.url))
            const toAdd = newPrs.filter((p) => !existingUrls.has(p.url))
            if (!toAdd.length) return j
            changed = true
            // Pick the strongest status implied by the added PRs:
            // merged MR → done; open MR → review (but don't demote from done/blocked)
            let newStatus = j.status
            for (const p of toAdd) {
              const s = mrUrlToStatus.get(p.url)
              if (s === 'done') { newStatus = 'done'; break }
              if (s === 'review' && newStatus !== 'done' && newStatus !== 'blocked') newStatus = 'review'
            }
            return { ...j, prs: [...(j.prs ?? []), ...toAdd], status: newStatus }
          })
          return changed ? { ...t, jiras } : t
        }),
        gitlabConfig: newGitlabConfig,
      }))

      return { linked, updated, noKey: skippedNoKey.length, noIssue: skippedNoIssue.length, noKeyList: skippedNoKey, noIssueList: skippedNoIssue }
    },

    debugGitlab: async () => {
      const { gitlabConfig, jiraConfig, tasks, developers } = get()
      const projectKeys = [
        ...new Set([
          ...jiraConfig.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean),
          ...tasks
            .flatMap((t) => t.jiras ?? [])
            .map((j) => jiraDedupeKey(j.url, j.name).match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toUpperCase() ?? '')
            .filter(Boolean),
        ]),
      ]
      // Every tracked issue key, with the tasks/dates it appears on.
      const tracked = new Map<string, Array<{ date: string; url: string; name: string; prs: number }>>()
      for (const t of tasks) {
        for (const j of t.jiras ?? []) {
          const k = jiraDedupeKey(j.url, j.name).toUpperCase()
          if (!/-\d+$/.test(k)) continue
          if (!tracked.has(k)) tracked.set(k, [])
          tracked.get(k)!.push({ date: t.date, url: j.url, name: j.name, prs: (j.prs ?? []).length })
        }
      }
      console.info('[debug] projectKeys:', projectKeys)
      console.info(`[debug] tracked issue keys (${tracked.size}):`, [...tracked.keys()].sort())

      const devUsernames = developers
        .filter((d) => !d.archivedAt && d.gitlabUsername?.trim())
        .map((d) => d.gitlabUsername!.trim())
      const mrById = new Map<number, Awaited<ReturnType<typeof fetchGroupMRs>>[number]>()
      try {
        const groupMrs = await fetchGroupMRs(gitlabConfig)
        for (const m of groupMrs) mrById.set(m.id, m)
      } catch (err) {
        const msg = (err as Error).message
        const isPermission = msg.includes('403') || msg.includes('Forbidden') || msg.includes('401')
        if (!isPermission || devUsernames.length === 0) throw err
      }
      if (devUsernames.length > 0) {
        const userMrs = await fetchUserMRs(devUsernames, gitlabConfig.token)
        for (const m of userMrs) mrById.set(m.id, m)
      }
      const rows = [...mrById.values()].map((mr) => {
        const ks = extractJiraKeys(mr, projectKeys)
        return {
          iid: mr.iid,
          key: ks.join(',') || '—',
          tracked: ks.some((k) => tracked.has(k)),
          title: mr.title.slice(0, 48),
          branch: mr.source_branch.slice(0, 32),
        }
      })
      console.info(`[debug] fetched ${rows.length} MRs:`)
      console.table(rows)
      const trackedMatches = rows.filter((r) => r.tracked)
      console.info(`[debug] MRs whose key IS tracked (${trackedMatches.length}):`, trackedMatches.map((r) => `!${r.iid} ${r.key}`))
      console.info('[debug] tracked-issue detail (key → where it lives):', Object.fromEntries(tracked))
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
          tasks: d.tasks!.map(normalizeTask),
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

  // Union of PRs per (devId, real Jira key) across ALL tasks/dates, so a PR
  // linked to any copy of an issue shows on whichever copy is displayed.
  // ONLY applies to issues with a real Jira key (PROJ-123 format) or a stable
  // issueId. Name-only issues (dk = 'name:...') are intentionally excluded: a
  // generic task like "Code Review" recurs daily and each day's PRs are
  // independent — merging them across all dates would flood the task card.
  const isRealJiraKey = (dk: string | null | undefined): boolean =>
    !!dk && /^[A-Z][A-Z0-9]+-\d+$/.test(dk)
  const prUnion = new Map<string, PrEntry[]>()
  for (const t of state.tasks) {
    for (const j of t.jiras ?? []) {
      const dk = jiraDedupeKey(j.url, j.name)
      const identity = isRealJiraKey(dk) ? dk! : j.issueId
      if (!identity) continue
      const key = `${t.devId}:${identity}`
      let arr = prUnion.get(key)
      if (!arr) { arr = []; prUnion.set(key, arr) }
      for (const p of j.prs ?? []) if (p.url && !arr.some((x) => x.url === p.url)) arr.push(p)
    }
  }
  const withUnionPrs = (devIdKey: string, j: JiraIssue): JiraIssue => {
    const dk = jiraDedupeKey(j.url, j.name)
    const identity = isRealJiraKey(dk) ? dk! : j.issueId
    const union = identity ? prUnion.get(`${devIdKey}:${identity}`) : undefined
    return union && union.length > (j.prs?.length ?? 0) ? { ...j, prs: union } : j
  }

  const seenJira = new Set<string>()
  const result: Task[] = []

  for (const t of ordered) {
    if (Array.isArray(t.jiras) && t.jiras.length > 0) {
      const freshJiras = t.jiras
        .filter((j) => {
          const dk = jiraDedupeKey(j.url, j.name)
          const identity = dk && dk !== 'name:' ? dk : j.issueId
          if (!identity) return true
          const k = `${t.devId}:${identity}`
          if (seenJira.has(k)) return false
          seenJira.add(k)
          return true
        })
        .map((j) => withUnionPrs(t.devId, j))
      if (freshJiras.length > 0) {
        result.push({ ...t, jiras: freshJiras })
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
