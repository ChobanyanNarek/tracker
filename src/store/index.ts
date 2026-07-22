import { create } from 'zustand'
import type { AppState, Developer, Project, Sprint, Task, JiraIssue, JiraConfig, GitLabConfig, GitHubConfig, View, EmploymentPeriod, PrEntry } from '../types'
import { loadCloudState, saveCloudState } from '../utils/cloud-api'
import { todayStr, nextWorkDay, prevWorkDay, latestWorkday } from '../utils/dates'
import { getJiras, jiraDedupeKey } from '../utils/format'
import { fetchJiraIssues, rawToJiraItem, mergeStatusHistory, buildJqlStatusFilter } from '../utils/jira-api'
import type { JiraIssueRaw } from '../utils/jira-api'
import { isClosedGroup } from '../utils/status-groups'
import { fetchGroupMRs, fetchUserMRs, extractJiraKeys } from '../utils/gitlab-api'
import { fetchUserPRs, extractJiraKeys as extractGithubJiraKeys } from '../utils/github-api'
import { resolveTrackerTz } from '../utils/working-hours'

function makeId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6)
}

function makeJiraMatcher(issueId: string | undefined, url: string) {
  return (j: JiraIssue) => (issueId ? j.issueId === issueId : !!url && j.url === url)
}

function isIssueDone(j: JiraIssue): boolean {
  return j.status === 'done'
}

function sortJiraIssues(jiras: JiraIssue[]): JiraIssue[] {
  const active = jiras.filter((j) => !j.hidden && !isIssueDone(j))
  const done = jiras.filter((j) => !j.hidden && isIssueDone(j))
  const hidden = jiras.filter((j) => j.hidden)
  return [...active, ...done, ...hidden]
}

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
    jiraConnections: [],
    gitlabConnections: [],
    githubConnections: [],
    developers: [],
    projects: [],
    sprints: [],
    tasks: [],
  }
}

function persistState(state: AppState): void {
  const payload = {
    _v: 2,
    developers: state.developers,
    projects: state.projects,
    sprints: state.sprints,
    tasks: state.tasks,
    schedule: state.schedule,
    scheduleHours: state.scheduleHours,
    notifsEnabled: state.notifsEnabled,
    jiraConnections: state.jiraConnections,
    gitlabConnections: state.gitlabConnections,
    githubConnections: state.githubConnections,
    trackerTimezone: state.trackerTimezone,
  }
  void saveCloudState(payload as Record<string, unknown>)
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
  updateProject: (id: string, changes: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (id: string) => void
  toggleMember: (projId: string, devId: string) => void

  addSprint: (s: Omit<Sprint, 'id'>) => void
  updateSprint: (id: string, changes: Partial<Omit<Sprint, 'id'>>) => void
  deleteSprint: (id: string) => void

  addTask: (t: Omit<Task, 'id'>) => void
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  duplicateTask: (id: string, targetDate: string) => void
  carryOver: (id: string) => string | null
  autoCarryOverdue: () => boolean
  migrateIssueIds: () => void
  deduplicateJiras: () => void
  mergeSameDayTasks: () => void

  updateJiraStatus: (taskId: string, issueId: string | undefined, url: string, status: JiraIssue['status'], groupId?: string) => void
  updateJiraPriority: (taskId: string, issueId: string | undefined, url: string, priority: JiraIssue['priority']) => void
  updateJira: (taskId: string, issueId: string | undefined, url: string, patch: Partial<JiraIssue>) => void
  reorderJiras: (taskId: string, fromId: string, toId: string) => void
  deleteJira: (taskId: string, issueId: string | undefined, url: string) => void
  toggleJiraHidden: (taskId: string, issueId: string | undefined, url: string) => void

  setScheduleDay: (devId: string, date: string, type: string | null) => void
  setScheduleHours: (devId: string, date: string, hours: number) => void

  setNotifsEnabled: (v: boolean) => void
  setTrackerTimezone: (tz: string | undefined) => void
  setJiraConnections: (connections: JiraConfig[]) => void
  syncJira: () => Promise<{ added: number; updated: number; removed: number }>
  setGitlabConnections: (connections: GitLabConfig[]) => void
  syncGitlab: () => Promise<{ linked: number; updated: number; noKey: number; noIssue: number; noKeyList: string[]; noIssueList: string[] }>
  setGithubConnections: (connections: GitHubConfig[]) => void
  syncGithub: () => Promise<{ linked: number; updated: number }>
  exportJSON: () => void
  importJSON: (json: string) => Promise<boolean>
  setHighlightedTaskId: (id: string | null) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  cloudSyncing: boolean
}

type Store = AppState & StoreActions

// Guard: don't persist until the initial cloud sync has completed.
// Without this, actions fired before cloud load (e.g. setNotifsEnabled in
// AuthedApp's useEffect) would overwrite cloud with an empty freshState().
let cloudSyncReady = false

function withSave(state: AppState): AppState {
  if (cloudSyncReady) persistState(state)
  return state
}

export const useStore = create<Store>((set, get) => {
  const base = { ...freshState() }

  return {
    ...base,
    cloudSyncing: true,
    searchQuery: '',

    setView: (view) => set({ view }),
    setSelectedDate: (selectedDate) => set({ selectedDate }),
    setSelectedDev: (selectedDev) => set({ selectedDev }),
    setSelectedProject: (selectedProject) => set({ selectedProject, selectedDev: 'ALL' }),
    setHighlightedTaskId: (highlightedTaskId) => set({ highlightedTaskId }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),

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

    addSprint: (s_) =>
      set((s) => withSave({ ...s, sprints: [...(s.sprints ?? []), { id: makeId('sp'), ...s_ }] })),

    updateSprint: (id, changes) =>
      set((s) => withSave({ ...s, sprints: (s.sprints ?? []).map((sp) => (sp.id === id ? { ...sp, ...changes } : sp)) })),

    deleteSprint: (id) =>
      set((s) => withSave({ ...s, sprints: (s.sprints ?? []).filter((sp) => sp.id !== id) })),

    addProject: (p) =>
      set((s) => withSave({ ...s, projects: [...s.projects, { id: makeId('p'), ...p }] })),

    updateProject: (id, changes) =>
      set((s) => {
        const newProjects = s.projects.map((p) => (p.id === id ? { ...p, ...changes } : p))
        let tasks = s.tasks
        let selectedDate = s.selectedDate

        if (changes.nonWorkingDays) {
          try {
            const oldProj = s.projects.find((p) => p.id === id)
            if (oldProj) {
              const oldNwd = oldProj.nonWorkingDays ?? [0, 6]
              const newNwd = changes.nonWorkingDays
              const today = todayStr()
              // Use the date the user is currently viewing (if not in the past)
              const refDate = s.selectedDate >= today ? s.selectedDate : today
              const refDow = new Date(refDate + 'T12:00:00').getDay()

              // --- forward pass: newly non-working day → push tasks forward ---
              if (newNwd.includes(refDow) && !oldNwd.includes(refDow)) {
                const targetDate = nextWorkDay(refDate, newNwd)

                const targetKeys = new Set<string>()
                tasks
                  .filter((t) => t.projectId === id && t.date === targetDate)
                  .forEach((t) =>
                    (t.jiras ?? []).forEach((j) => {
                      if (j.issueId) targetKeys.add(j.issueId)
                      const dk = jiraDedupeKey(j.url, j.name)
                      if (dk && dk !== 'name:') targetKeys.add(dk)
                    }),
                  )

                const toAdd: Task[] = []
                for (const t of tasks.filter((t) => t.projectId === id && t.date === refDate)) {
                  if (Array.isArray(t.jiras)) {
                    const pendingJiras = t.jiras
                      .map((j, i) => ({ ...j, _srcIdx: j._srcIdx ?? i }))
                      .filter((j) => {
                        if (j.status === 'done') return false
                        if (j.issueId && targetKeys.has(j.issueId)) return false
                        const dk = jiraDedupeKey(j.url, j.name)
                        return !(dk && dk !== 'name:' && targetKeys.has(dk))
                      })
                    if (!pendingJiras.length) continue
                    pendingJiras.forEach((j) => {
                      if (j.issueId) targetKeys.add(j.issueId)
                      const dk = jiraDedupeKey(j.url, j.name)
                      if (dk && dk !== 'name:') targetKeys.add(dk)
                    })
                    toAdd.push({
                      ...t,
                      id: makeId('t'),
                      date: targetDate,
                      carriedOver: true,
                      carriedFrom: refDate,
                      carriedOverNwd: true,
                      jiras: pendingJiras,
                      prs: (t.prs ?? []).map((pr) => ({ ...pr })),
                    })
                  } else if (t.status !== 'done') {
                    const alreadyOnTarget = tasks.some(
                      (x) => x.devId === t.devId && x.jira === t.jira && x.date === targetDate,
                    )
                    if (!alreadyOnTarget) {
                      toAdd.push({
                        ...t,
                        id: makeId('t'),
                        date: targetDate,
                        carriedOver: true,
                        carriedFrom: refDate,
                        carriedOverNwd: true,
                        prs: (t.prs ?? []).map((pr) => ({ ...pr })),
                      })
                    }
                  }
                }
                if (toAdd.length > 0) {
                  tasks = [...tasks, ...toAdd]
                  selectedDate = targetDate
                }
              }

              // --- reverse pass: newly working day → remove the nwd copies, restore originals ---
              const newlyWorkingDows = new Set(oldNwd.filter((dow) => !newNwd.includes(dow)))
              if (newlyWorkingDows.size > 0) {
                const toRemoveIds = new Set<string>()
                const restoredFromDates: string[] = []
                for (const t of tasks) {
                  if (t.projectId !== id || !t.carriedOverNwd || !t.carriedFrom) continue
                  const fromDow = new Date(t.carriedFrom + 'T12:00:00').getDay()
                  if (newlyWorkingDows.has(fromDow)) {
                    toRemoveIds.add(t.id)
                    restoredFromDates.push(t.carriedFrom)
                  }
                }
                if (toRemoveIds.size > 0) {
                  tasks = tasks.filter((t) => !toRemoveIds.has(t.id))
                  // Navigate back to the source date so the originals are visible
                  if (restoredFromDates.length > 0) {
                    selectedDate = restoredFromDates.sort()[0]!
                  }
                }
              }
            }
          } catch {
            // carry-over failed; nonWorkingDays change still saves
          }
        }

        return withSave({ ...s, projects: newProjects, tasks, selectedDate })
      }),

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
      const { tasks, projects } = get()
      const task = tasks.find((t) => t.id === id)
      if (!task) return null
      const taskProj = projects.find((p) => p.id === task.projectId)
      const nextDay = nextWorkDay(task.date, taskProj?.nonWorkingDays ?? [0, 6])
      const pending = (task.jiras ?? [])
        .map((j, i) => ({ ...j, _srcIdx: j._srcIdx ?? i }))
        .filter((j) => j.status !== 'done')

      if (task.jiras?.length && !pending.length) return 'all-done'

      const existing = tasks.find(
        (t) => t.devId === task.devId && t.title === task.title && t.date === nextDay && t.carriedOver,
      )
      if (existing) {
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
      let { tasks, projects } = get()
      const today = todayStr()

      // Find the most recent date with tasks before today (up to 30 days back)
      // so we can backfill gaps when the app wasn't opened for multiple days.
      let scanDate = prevWorkDay(today)
      let daysBack = 0
      while (daysBack < 30 && !tasks.some((t) => t.date === scanDate)) {
        scanDate = prevWorkDay(scanDate)
        daysBack++
      }
      if (!tasks.some((t) => t.date === scanDate)) return false

      // Build the chain of work days from scanDate up to (but not including) today
      const chain: string[] = []
      let d = scanDate
      while (d < today) {
        chain.push(d)
        d = nextWorkDay(d)
      }

      let anyAdded = false

      function isDoneInLaterTask(allTasks: Task[], devId: string, issueId: string | undefined, url: string, name: string, afterDate: string): boolean {
        if (issueId) {
          return allTasks.some(
            (x) =>
              x.devId === devId &&
              x.date > afterDate &&
              (x.jiras ?? []).some((j) => j.issueId === issueId && j.status === 'done'),
          )
        }
        const key = jiraDedupeKey(url, name)
        if (!key || key === 'name:') return false
        return allTasks.some(
          (x) =>
            x.devId === devId &&
            x.date > afterDate &&
            (x.jiras ?? []).some((j) => jiraDedupeKey(j.url, j.name) === key && j.status === 'done'),
        )
      }

      for (const fromDate of chain) {
        const targetDate = nextWorkDay(fromDate)
        if (targetDate > today) break

        const deletedUrls = new Map<string, Set<string>>()
        tasks
          .filter((x) => x.date === targetDate && x.deletedJiraUrls?.length)
          .forEach((x) => {
            if (!deletedUrls.has(x.devId)) deletedUrls.set(x.devId, new Set())
            x.deletedJiraUrls!.forEach((u) => deletedUrls.get(x.devId)!.add(u))
          })

        const scheduledKeys = new Map<string, Set<string>>()
        function getScheduled(devId: string): Set<string> {
          if (!scheduledKeys.has(devId)) {
            const existing = new Set<string>()
            tasks
              .filter((x) => x.devId === devId && x.date === targetDate)
              .forEach((x) =>
                (x.jiras ?? []).forEach((j) => {
                  if (j.issueId) existing.add(j.issueId)
                  const dk = jiraDedupeKey(j.url, j.name)
                  if (dk && dk !== 'name:') existing.add(dk)
                }),
              )
            scheduledKeys.set(devId, existing)
          }
          return scheduledKeys.get(devId)!
        }

        const unfinished = tasks.filter((t) => {
          if (t.date !== fromDate) return false
          if (t.jiras !== undefined) {
            return t.jiras.some(
              (j) => j.status !== 'done' && !isDoneInLaterTask(tasks, t.devId, j.issueId, j.url, j.name, t.date),
            )
          }
          return t.status !== 'done'
        })

        const newTasks: Task[] = []

        unfinished.forEach((t) => {
          const tProj = projects.find((p) => p.id === t.projectId)
          const tTargetDate = nextWorkDay(t.date, tProj?.nonWorkingDays ?? [0, 6])
          if (tTargetDate !== targetDate) return
          if (t.jiras !== undefined) {
            const scheduled = getScheduled(t.devId)
            const pendingJiras = t.jiras
              .map((j, i) => ({ ...j, _srcIdx: j._srcIdx ?? i }))
              .filter((j) => {
                if (j.status === 'done') return false
                if (isDoneInLaterTask(tasks, t.devId, j.issueId, j.url, j.name, t.date)) return false
                if (deletedUrls.get(t.devId)?.has(j.url)) return false
                if (t.deletedJiraUrls?.includes(j.url)) return false
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
              date: tTargetDate,
              carriedOver: true,
              carriedFrom: t.date,
              jiras: pendingJiras,
              prs: (t.prs ?? []).map((p) => ({ ...p })),
            })
          } else {
            const alreadyOnTarget = tasks.some(
              (x) => x.devId === t.devId && x.jira === t.jira && x.date === tTargetDate,
            )
            if (alreadyOnTarget) return
            newTasks.push({
              ...t,
              id: makeId('t'),
              date: tTargetDate,
              carriedOver: true,
              carriedFrom: t.date,
              prs: (t.prs ?? []).map((p) => ({ ...p })),
            })
          }
        })

        if (newTasks.length > 0) {
          tasks = [...tasks, ...newTasks]
          anyAdded = true
        }
      }

      if (anyAdded) {
        set((s) => withSave({ ...s, tasks }))
      }
      return anyAdded
    },

    migrateIssueIds: () => {
      const { tasks } = get()
      if (!tasks.some((t) => t.jiras?.some((j) => !j.issueId))) return

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
          const dk = jiraDedupeKey(j.url, j.name)
          const identity = (dk && dk !== 'name:') ? dk : j.issueId
          if (!identity) { kept.push(j); return }
          const k = `${t.devId}:${t.date}:${identity}`
          if (!seen.has(k)) { seen.add(k); kept.push(j) }
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
        if (group.some((t) => !Array.isArray(t.jiras))) { merged.push(...group); return }

        changed = true
        const ordered = [...group].sort((a, b) => {
          if (!!a.carriedOver !== !!b.carriedOver) return a.carriedOver ? 1 : -1
          return a.id < b.id ? -1 : 1
        })
        const base = ordered[0]
        const jiras = sortJiraIssues(ordered.flatMap((t) => t.jiras!)).map((j, i) => ({ ...j, _srcIdx: i }))
        const comments = [...new Set(ordered.map((t) => t.comment?.trim()).filter(Boolean))]
        const deletedJiraUrls = [...new Set(ordered.flatMap((t) => t.deletedJiraUrls ?? []))]
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

    updateJiraStatus: (taskId, issueId, url, status, groupId) =>
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
                return { ...j, status, groupId: groupId ?? j.groupId, manualStatus: status, statusHistory: [...history, { status, at: now }] }
              })
              const jiras = sortJiraIssues(updated)
              const allDone = jiras.every((j) => j.status === 'done')
              const hasBlocked = jiras.some((j) => j.status === 'blocked')
              return { ...t, jiras, status: allDone ? 'done' : hasBlocked ? 'blocked' : jiras[0]?.status ?? 'todo' }
            }
            if (issueId && targetTask && t.devId === targetTask.devId) {
              const now = new Date().toISOString()
              const updated = t.jiras.map((j) => {
                if (j.issueId !== issueId) return j
                const history = j.statusHistory ?? [{ status: j.status, at: now }]
                return { ...j, status, groupId: groupId ?? j.groupId, manualStatus: status, statusHistory: [...history, { status, at: now }] }
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
              if (patch.status && patch.status !== j.status) {
                const history = j.statusHistory ?? [{ status: j.status, at: now }]
                next.manualStatus = patch.status
                next.statusHistory = [...history, { status: patch.status, at: now }]
              }
              return next
            })
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

    setJiraConnections: (jiraConnections) => set((s) => withSave({ ...s, jiraConnections })),

    syncJira: async () => {
      const { jiraConnections, developers, tasks } = get()
      const enabledConns = jiraConnections.filter((c) => c.enabled && c.baseUrl && c.token)
      if (!enabledConns.length) throw new Error('No Jira connections configured')

      const today = latestWorkday()
      let added = 0
      let updated = 0
      let removed = 0

      const tasksCopy = tasks.map((t) => ({
        ...t,
        jiras: [...(t.jiras ?? [])],
        jiraSync: t.jiraSync || t.title === 'Jira Issues' || undefined,
      }))

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
          if (t.deletedJiraUrls?.length) {
            primary.deletedJiraUrls = [...new Set([...(primary.deletedJiraUrls ?? []), ...t.deletedJiraUrls])]
          }
          mergedIds.add(t.id)
        }
      })
      const dedupedTasks = tasksCopy.filter((t) => !mergedIds.has(t.id))
      const newTasks: Task[] = []

      const syncedConns: JiraConfig[] = []

      for (const conn of enabledConns) {
        const projList = conn.projectKeys.map((k) => `"${k.trim()}"`).join(',')
        const connDevs = developers
          .map((d) => ({ dev: d, email: conn.developerEmails?.[d.id] ?? d.jiraEmail ?? '' }))
          .filter((x) => x.email)

        const byDev = new Map<string, JiraIssueRaw[]>()
        for (const { dev, email } of connDevs) {
          const statusFilter = buildJqlStatusFilter(conn.statusMappings)
          const devJql = projList
            ? `project in (${projList}) AND assignee = "${email}" AND ${statusFilter} ORDER BY updated DESC`
            : `assignee = "${email}" AND ${statusFilter} ORDER BY updated DESC`
          const devIssues = await fetchJiraIssues(conn, devJql)
          console.debug(`[sync] dev=${dev.name} jql="${devJql}" → ${devIssues.length} issues: [${devIssues.map(i => i.key).join(', ')}]`)
          if (devIssues.length) byDev.set(dev.id, devIssues)
        }

        let connAdded = 0
        let connUpdated = 0
        let connRemoved = 0

        byDev.forEach((devIssues, devId) => {
          const syncTask =
            dedupedTasks.find((t) => t.devId === devId && t.date === today && t.jiraSync) ??
            dedupedTasks.find((t) => t.devId === devId && t.date === today)

          const isClosedRaw = (raw: JiraIssueRaw) => {
            const statusName = raw.fields.status.name
            // If mappings exist, check if the mapped group is marked isClosed
            if (conn.statusMappings?.length) {
              const m = conn.statusMappings.find((m) => m.jiraStatus.toLowerCase() === statusName.toLowerCase())
              if (m) return isClosedGroup(m.groupId, conn)
            }
            return statusName.toLowerCase() === 'closed' || statusName.toLowerCase() === 'done'
          }
          const closedKeys = new Set<string>()
          devIssues.forEach((raw) => {
            if (!isClosedRaw(raw)) return
            const url = `${conn.baseUrl.replace(/\/$/, '')}/browse/${raw.key}`
            const k = jiraDedupeKey(url, raw.fields.summary)
            if (k && k !== 'name:') closedKeys.add(k)
          })
          devIssues.forEach((raw) => { if (isClosedRaw(raw)) console.debug(`[sync] CLOSED→skipped: ${raw.key} status="${raw.fields.status.name}"`) })
          const incoming = devIssues.filter((raw) => !isClosedRaw(raw)).map((i) => rawToJiraItem(i, conn.baseUrl, conn.statusMappings))
          const todayTasks = dedupedTasks.filter((t) => t.devId === devId && t.date === today)

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
              connRemoved += t.jiras.length - keep.length
              t.jiras = keep
              t.deletedJiraUrls = [...new Set([...(t.deletedJiraUrls ?? []), ...removedUrls])]
            })
          }

          const keyToTask = new Map<string, { task: typeof dedupedTasks[number]; idx: number }>()
          todayTasks.forEach((t) => {
            ;(t.jiras ?? []).forEach((j, idx) => {
              const k = jiraDedupeKey(j.url, j.name)
              if (k && k !== 'name:') keyToTask.set(k, { task: t, idx })
            })
          })

          const trulyNew: typeof incoming = []
          const deletedUrls = new Set(syncTask?.deletedJiraUrls ?? [])

          console.debug(`[sync] incoming (non-closed): [${incoming.map(j => j.url.split('/browse/')[1]).join(', ')}]`)
          console.debug(`[sync] deletedUrls:`, [...deletedUrls])
          incoming.forEach((nj) => {
            if (deletedUrls.has(nj.url)) { console.debug(`[sync] DELETED→skipped: ${nj.url}`); return }
            const njKey = jiraDedupeKey(nj.url, nj.name)

            if (syncTask) {
              const existIdx = syncTask.jiras.findIndex((ej) => {
                const ejKey = jiraDedupeKey(ej.url, ej.name)
                return (njKey && njKey !== 'name:' && ejKey === njKey) || ej.url === nj.url
              })
              if (existIdx >= 0) {
                const ex = syncTask.jiras[existIdx]
                const usesManual = !!ex.manualStatus && nj.status !== 'done'
                const resolvedStatus = nj.status === 'done' ? 'done' : (ex.manualStatus ?? nj.status)
                const resolvedManual = nj.status === 'done' ? undefined : ex.manualStatus
                const resolvedGroupId = usesManual ? ex.groupId : nj.groupId
                syncTask.jiras[existIdx] = { ...ex, status: resolvedStatus, groupId: resolvedGroupId, manualStatus: resolvedManual, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory) }
                connUpdated++
                return
              }
            }

            if (njKey && njKey !== 'name:' && keyToTask.has(njKey)) {
              const { task, idx } = keyToTask.get(njKey)!
              const ex = task.jiras[idx]
              const usesManual2 = !!ex.manualStatus && nj.status !== 'done'
              const resolvedStatus2 = nj.status === 'done' ? 'done' : (ex.manualStatus ?? nj.status)
              const resolvedManual2 = nj.status === 'done' ? undefined : ex.manualStatus
              const resolvedGroupId2 = usesManual2 ? ex.groupId : nj.groupId
              task.jiras[idx] = { ...ex, status: resolvedStatus2, groupId: resolvedGroupId2, manualStatus: resolvedManual2, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory) }
              connUpdated++
              return
            }

            if (nj.status !== 'done') trulyNew.push(nj)
            else console.debug(`[sync] STATUS=done→skipped: ${nj.url.split('/browse/')[1]}`)
          })

          if (trulyNew.length > 0) {
            if (syncTask) {
              syncTask.jiras = [...syncTask.jiras, ...trulyNew]
              connAdded += trulyNew.length
            } else {
              connAdded += trulyNew.length
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

        added += connAdded
        updated += connUpdated
        removed += connRemoved
        syncedConns.push({
          ...conn,
          lastSync: new Date().toISOString(),
          lastSyncResult: `+${connAdded} added, ${connUpdated} updated${connRemoved ? `, ${connRemoved} closed removed` : ''}`,
        })
      }

      const finalConns = get().jiraConnections.map((c) => syncedConns.find((s) => s.id === c.id) ?? c)

      set((s) => {
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
          return { ...t, jiras: sortJiraIssues(jiras) }
        })
        return withSave({ ...s, tasks: [...merged, ...newTasks], jiraConnections: finalConns })
      })
      return { added, updated, removed }
    },

    setGitlabConnections: (gitlabConnections) => set((s) => withSave({ ...s, gitlabConnections })),

    syncGitlab: async () => {
      const { gitlabConnections, jiraConnections, tasks, developers } = get()
      const enabledConns = gitlabConnections.filter((c) => c.enabled && c.token && c.groupPath)
      if (!enabledConns.length) throw new Error('No GitLab connections configured')

      // All external timestamps are recorded in the user's local timezone.
      const tz = resolveTrackerTz()
      const toLocalParts = (d: Date) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(d)
        const g = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
        return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` }
      }

      const projectKeys = [
        ...new Set([
          ...jiraConnections.flatMap((c) => c.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean)),
          ...tasks
            .flatMap((t) => t.jiras ?? [])
            .map((j) => jiraDedupeKey(j.url, j.name).match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toUpperCase() ?? '')
            .filter(Boolean),
        ]),
      ]

      const mrById = new Map<number, Awaited<ReturnType<typeof fetchGroupMRs>>[number]>()
      const syncedConns: GitLabConfig[] = []

      for (const conn of enabledConns) {
        const devUsernames = developers
          .filter((d) => !d.archivedAt)
          .map((d) => (conn.developerUsernames?.[d.id] ?? d.gitlabUsername ?? '').trim())
          .filter(Boolean)

        try {
          const groupMrs = await fetchGroupMRs(conn)
          for (const m of groupMrs) mrById.set(m.id, m)
        } catch (err) {
          const msg = (err as Error).message
          const isPermission = msg.includes('403') || msg.includes('Forbidden') || msg.includes('401')
          if (!isPermission || devUsernames.length === 0) throw err
        }

        if (devUsernames.length > 0) {
          const userMrs = await fetchUserMRs(devUsernames, conn.token)
          for (const m of userMrs) mrById.set(m.id, m)
        }

        syncedConns.push({ ...conn, lastSync: new Date().toISOString() })
      }

      const mrs = [...mrById.values()]

      let linked = 0
      let updated = 0
      const skippedNoKey: string[] = []
      const skippedNoIssue: string[] = []

      const prPatches = new Map<string, Map<string, PrEntry[]>>()
      const mrUrlToStatus = new Map<string, JiraIssue['status']>()

      for (const mr of mrs) {
        const keys = extractJiraKeys(mr, projectKeys)
        if (!keys.length) {
          skippedNoKey.push(`!${mr.iid} "${mr.title}" [${mr.source_branch}]`)
          continue
        }

        const { date: pushDate, time: pushTime } = toLocalParts(new Date(mr.created_at))
        mrUrlToStatus.set(mr.web_url, 'done')

        const keySet = new Set(keys)
        const keyRes = keys.map((key) => new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`, 'i'))
        const matchesIssue = (jira: JiraIssue) => {
          if (jira.issueId && keySet.has(jira.issueId.toUpperCase())) return true
          const k = jiraDedupeKey(jira.url, jira.name)
          if (k && k !== 'name:' && keySet.has(k.toUpperCase())) return true
          return keyRes.some((re) => re.test(jira.url ?? ''))
        }

        let matched = false
        let addedSomewhere = false

        for (const task of tasks) {
          for (const jira of (task.jiras ?? [])) {
            if (!matchesIssue(jira)) continue
            matched = true
            if ((jira.prs ?? []).some((p) => p.url === mr.web_url)) continue
            const identity = jira.issueId ?? (jira.url || null)
            if (!identity) continue
            if (!prPatches.has(task.id)) prPatches.set(task.id, new Map())
            const taskPatch = prPatches.get(task.id)!
            const existing = taskPatch.get(identity) ?? []
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
      const resultStr = parts.join(', ')

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
            let newStatus = j.status
            for (const p of toAdd) {
              const st = mrUrlToStatus.get(p.url)
              if (st === 'done') { newStatus = 'done'; break }
              if (st === 'review' && newStatus !== 'done' && newStatus !== 'blocked') newStatus = 'review'
            }
            return { ...j, prs: [...(j.prs ?? []), ...toAdd], status: newStatus }
          })
          return changed ? { ...t, jiras } : t
        }),
        gitlabConnections: s.gitlabConnections.map((c) => {
          const synced = syncedConns.find((sc) => sc.id === c.id)
          if (!synced) return c
          return { ...synced, lastSyncResult: resultStr }
        }),
      }))

      return { linked, updated, noKey: skippedNoKey.length, noIssue: skippedNoIssue.length, noKeyList: skippedNoKey, noIssueList: skippedNoIssue }
    },

    setGithubConnections: (githubConnections) => set((s) => withSave({ ...s, githubConnections })),

    syncGithub: async () => {
      const { githubConnections, jiraConnections, tasks, developers } = get()
      const enabledConns = githubConnections.filter((c) => c.enabled && c.token)
      if (!enabledConns.length) throw new Error('No GitHub connections configured')

      // All external timestamps are recorded in the user's local timezone.
      const tz = resolveTrackerTz()
      const toLocalParts = (d: Date) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(d)
        const g = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
        return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` }
      }

      const projectKeys = [
        ...new Set([
          ...jiraConnections.flatMap((c) => c.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean)),
          ...tasks
            .flatMap((t) => t.jiras ?? [])
            .map((j) => jiraDedupeKey(j.url, j.name).match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toUpperCase() ?? '')
            .filter(Boolean),
        ]),
      ]

      const prPatches = new Map<string, Map<string, PrEntry[]>>()
      const prUrlToStatus = new Map<string, JiraIssue['status']>()
      let linked = 0
      let updated = 0
      const syncedConns: GitHubConfig[] = []

      for (const conn of enabledConns) {
        const connDevUsernames = developers
          .filter((d) => !d.archivedAt)
          .map((d) => (conn.developerUsernames?.[d.id] ?? '').trim())
          .filter(Boolean)

        for (const username of connDevUsernames) {
          const prs = await fetchUserPRs(username, conn.token, conn.orgOrUser)
          for (const pr of prs) {
            const keys = extractGithubJiraKeys(pr, projectKeys)
            if (!keys.length) continue
            const { date: pushDate, time: pushTime } = toLocalParts(new Date(pr.created_at))
            prUrlToStatus.set(pr.html_url, pr.pull_request?.merged_at ? 'done' : 'review')

            const keySet = new Set(keys)
            const keyRes = keys.map((key) => new RegExp(`(^|[^A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`, 'i'))
            const matchesIssue = (jira: JiraIssue) => {
              if (jira.issueId && keySet.has(jira.issueId.toUpperCase())) return true
              const k = jiraDedupeKey(jira.url, jira.name)
              if (k && k !== 'name:' && keySet.has(k.toUpperCase())) return true
              return keyRes.some((re) => re.test(jira.url ?? ''))
            }

            let matched = false
            let addedSomewhere = false

            for (const task of tasks) {
              for (const jira of (task.jiras ?? [])) {
                if (!matchesIssue(jira)) continue
                matched = true
                if ((jira.prs ?? []).some((p) => p.url === pr.html_url)) continue
                const identity = jira.issueId ?? (jira.url || null)
                if (!identity) continue
                if (!prPatches.has(task.id)) prPatches.set(task.id, new Map())
                const taskPatch = prPatches.get(task.id)!
                const existing = taskPatch.get(identity) ?? []
                if (!existing.some((p) => p.url === pr.html_url)) {
                  taskPatch.set(identity, [...existing, { url: pr.html_url, date: pushDate, time: pushTime }])
                  addedSomewhere = true
                }
              }
            }

            if (matched) {
              if (addedSomewhere) linked++
              else updated++
            }
          }
        }
        syncedConns.push({ ...conn, lastSync: new Date().toISOString() })
      }

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
            let newStatus = j.status
            for (const p of toAdd) {
              const st = prUrlToStatus.get(p.url)
              if (st === 'done') { newStatus = 'done'; break }
              if (st === 'review' && newStatus !== 'done' && newStatus !== 'blocked') newStatus = 'review'
            }
            return { ...j, prs: [...(j.prs ?? []), ...toAdd], status: newStatus }
          })
          return changed ? { ...t, jiras } : t
        }),
        githubConnections: s.githubConnections.map((c) => syncedConns.find((sc) => sc.id === c.id) ?? c),
      }))

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
      a.download = `progressor-${todayStr()}.json`
      a.click()
    },

    importJSON: async (json) => {
      const d = JSON.parse(json) as Partial<AppState> & { _v?: number; scheduleHours?: Record<string, Record<string, number>> }
      if (!d.developers || !d.tasks) throw new Error('Invalid backup file')
      const s = get()
      const next: AppState = {
        ...s,
        developers: d.developers.map((dev) => ({ periods: [], ...dev })),
        projects: (d.projects ?? []).map((p) => ({ nonWorkingDays: [0, 6], ...p, members: p.members ?? [] })),
        tasks: d.tasks.map(normalizeTask),
        schedule: (d.schedule as Record<string, Record<string, string>>) ?? {},
        scheduleHours: d.scheduleHours ?? {},
        selectedDev: 'ALL',
        selectedProject: 'ALL',
      }
      set(next)
      return saveCloudState({
        _v: 2,
        developers: next.developers,
        projects: next.projects,
        tasks: next.tasks,
        schedule: next.schedule,
        scheduleHours: next.scheduleHours,
        notifsEnabled: next.notifsEnabled,
        jiraConnections: next.jiraConnections,
        gitlabConnections: next.gitlabConnections,
        githubConnections: next.githubConnections,
        trackerTimezone: next.trackerTimezone,
      })
    },
  }
})

function applyCloudState(cloud: Record<string, unknown> | null) {
  cloudSyncReady = true
  useStore.setState((s) => ({
    ...s,
    cloudSyncing: false,
    ...(cloud
      ? {
          ...(cloud.developers ? { developers: (cloud.developers as AppState['developers']).map((d) => ({ periods: [], ...d })) } : {}),
          ...(cloud.projects ? { projects: (cloud.projects as AppState['projects']).map((p) => ({ nonWorkingDays: [0, 6] as number[], ...p, members: (p as { members?: string[] }).members ?? [] })) } : {}),
          ...(cloud.sprints ? { sprints: cloud.sprints as AppState['sprints'] } : {}),
          ...(cloud.tasks ? { tasks: (cloud.tasks as AppState['tasks']).map(normalizeTask) } : {}),
          ...(cloud.schedule ? { schedule: cloud.schedule as AppState['schedule'] } : {}),
          ...(cloud.scheduleHours ? { scheduleHours: cloud.scheduleHours as AppState['scheduleHours'] } : {}),
          ...(cloud.jiraConnections
            ? { jiraConnections: cloud.jiraConnections as AppState['jiraConnections'] }
            : cloud.jiraConfig
              ? { jiraConnections: [{ ...(cloud.jiraConfig as JiraConfig), id: 'j_legacy', name: 'Default' }] }
              : {}),
          ...(cloud.gitlabConnections
            ? { gitlabConnections: cloud.gitlabConnections as AppState['gitlabConnections'] }
            : cloud.gitlabConfig
              ? { gitlabConnections: [{ ...(cloud.gitlabConfig as GitLabConfig), id: 'gl_legacy', name: 'Default' }] }
              : {}),
          ...(cloud.githubConnections ? { githubConnections: cloud.githubConnections as AppState['githubConnections'] } : {}),
          ...(cloud.trackerTimezone !== undefined ? { trackerTimezone: cloud.trackerTimezone as string | undefined } : {}),
        }
      : {}),
  }))
}

export async function syncCloudToStore(): Promise<void> {
  useStore.setState({ cloudSyncing: true })
  try {
    const cloud = await loadCloudState()
    applyCloudState(cloud)
  } catch {
    useStore.setState({ cloudSyncing: false })
  }
}

loadCloudState().then(applyCloudState).catch(() => {
  useStore.setState({ cloudSyncing: false })
})

export function getVisibleDevIds(state: AppState): string[] {
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
  const selectedDayOfWeek = new Date(state.selectedDate + 'T12:00:00').getDay()
  const base = state.tasks.filter((t) => {
    const dv = devId ? t.devId === devId : state.selectedDev === 'ALL' || t.devId === state.selectedDev
    const pj = state.selectedProject === 'ALL' || t.projectId === state.selectedProject
    if (!dv || !pj || t.date !== state.selectedDate) return false
    const proj = state.projects.find((p) => p.id === t.projectId)
    const nwd = proj?.nonWorkingDays ?? [0, 6]
    return !nwd.includes(selectedDayOfWeek)
  })

  const ordered = [...base].sort((a, b) => {
    if (a.carriedOver !== b.carriedOver) return a.carriedOver ? 1 : -1
    return a.id < b.id ? -1 : 1
  })

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
        result.push({ ...t, jiras: [] })
      }
    } else {
      if (t.jira) {
        const dk = jiraDedupeKey(t.jira, '')
        if (dk && dk !== 'name:') {
          const k = `${t.devId}:${dk}`
          if (seenJira.has(k)) {
            if (!t.carriedOver && (t.deadline || t.comment)) result.push(t)
          } else {
            seenJira.add(k)
            result.push(t)
          }
        } else {
          result.push(t)
        }
      } else {
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
