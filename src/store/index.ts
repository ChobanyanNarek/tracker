import { create } from 'zustand'
import type { AppState, Developer, Project, Sprint, Task, Note, JiraIssue, JiraConfig, GitLabConfig, GitHubConfig, View, EmploymentPeriod, PrEntry, ReleaseNoteColumn, ReleaseNoteIssueData } from '../types'
import { loadCloudState, saveCloudState } from '../utils/cloud-api'
import { todayStr, nextWorkDay, prevWorkDay, latestWorkday } from '../utils/dates'
import { getJiras, jiraDedupeKey } from '../utils/format'
import { fetchJiraIssues, fetchJiraBoardIssues, fetchBoardIssueKeys, fetchJiraTimeTracking, rawToJiraItem, mergeStatusHistory, buildJqlStatusFilter } from '../utils/jira-api'
import type { JiraIssueRaw } from '../utils/jira-api'
import { fetchGroupMRs, fetchUserMRs, extractJiraKeys } from '../utils/gitlab-api'
import { fetchUserPRs, fetchOrgPRs, normalizeGithubPath, extractJiraKeys as extractGithubJiraKeys } from '../utils/github-api'
import { resolveTrackerTz } from '../utils/working-hours'
import { isClosedGroup, legacyStatusToGroupId } from '../utils/status-groups'

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
  return {
    selectedDev: 'ALL',
    selectedProject: 'ALL',
    selectedDate: latestWorkday(),
    view: 'daily',
    highlightedTaskId: null,
    highlightedNoteId: null,
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
    notes: [],
    releaseNoteColumns: [],
    releaseNoteData: {},
  }
}

function buildPersistPayload(state: AppState): Record<string, unknown> {
  return {
    _v: 2,
    developers: state.developers,
    projects: state.projects,
    sprints: state.sprints,
    tasks: state.tasks,
    notes: state.notes,
    schedule: state.schedule,
    scheduleHours: state.scheduleHours,
    notifsEnabled: state.notifsEnabled,
    jiraConnections: state.jiraConnections,
    gitlabConnections: state.gitlabConnections,
    githubConnections: state.githubConnections,
    trackerTimezone: state.trackerTimezone,
    selectedProject: state.selectedProject,
    selectedDev: state.selectedDev,
    selectedDate: state.selectedDate,
    releaseNoteColumns: state.releaseNoteColumns,
    releaseNoteData: state.releaseNoteData,
  }
}

// Debounced cloud save: rapid mutations (e.g. typing) collapse into one PUT of the latest
// state instead of one request per keystroke — cutting network + backend memory pressure.
let pendingPayload: Record<string, unknown> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 800
const SAVE_RETRY_MS = 5000

function flushPersist(): void {
  if (!pendingPayload) return
  const payload = pendingPayload
  pendingPayload = null
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  useStore.setState({ saveStatus: 'saving' })
  void saveCloudState(payload).then((ok) => {
    if (ok) {
      useStore.setState({ saveStatus: 'saved' })
    } else {
      useStore.setState({ saveStatus: 'error' })
      // retry with the same payload unless a newer save has since superseded it
      if (!pendingPayload) {
        pendingPayload = payload
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(flushPersist, SAVE_RETRY_MS)
      }
    }
  })
}

function persistState(state: AppState): void {
  pendingPayload = buildPersistPayload(state)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushPersist, SAVE_DEBOUNCE_MS)
}

// Don't lose a pending debounced save when the tab is hidden or closed.
if (typeof window !== 'undefined') {
  const flushIfHidden = () => { if (document.visibilityState === 'hidden') flushPersist() }
  window.addEventListener('visibilitychange', flushIfHidden)
  window.addEventListener('pagehide', flushPersist)
  // Retry immediately once connectivity returns, instead of waiting out SAVE_RETRY_MS.
  window.addEventListener('online', () => { if (pendingPayload) flushPersist() })
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

  addNote: () => string
  updateNote: (id: string, changes: Partial<Omit<Note, 'id' | 'createdAt'>>) => void
  deleteNote: (id: string) => void

  addTask: (t: Omit<Task, 'id'>) => void
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  duplicateTask: (id: string, targetDate: string) => void
  carryOver: (id: string) => string | null
  autoCarryOverdue: () => boolean
  migrateIssueIds: () => void
  deduplicateJiras: () => void
  mergeSameDayTasks: () => void
  pruneOldTaskData: () => void

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
  refreshBoardIssueKeys: (projectId: string) => Promise<void>
  setGitlabConnections: (connections: GitLabConfig[]) => void
  syncGitlab: () => Promise<{ linked: number; updated: number; noKey: number; noIssue: number; noKeyList: string[]; noIssueList: string[] }>
  setGithubConnections: (connections: GitHubConfig[]) => void
  syncGithub: () => Promise<{ linked: number; updated: number }>
  exportJSON: () => void
  importJSON: (json: string) => Promise<boolean>
  setHighlightedTaskId: (id: string | null) => void
  setHighlightedNoteId: (id: string | null) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  cloudSyncing: boolean
  saveStatus: 'saved' | 'saving' | 'error'

  setReleaseNoteColumns: (cols: ReleaseNoteColumn[]) => void
  setReleaseNoteData: (data: Record<string, ReleaseNoteIssueData>) => void
  updateReleaseNoteIssue: (key: string, patch: Partial<ReleaseNoteIssueData>) => void
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
    saveStatus: 'saved',
    searchQuery: '',

    setView: (view) => set({ view }),
    setSelectedDate: (selectedDate) => set((s) => withSave({ ...s, selectedDate })),
    setSelectedDev: (selectedDev) => set((s) => withSave({ ...s, selectedDev })),
    setSelectedProject: (selectedProject) => set((s) => withSave({ ...s, selectedProject, selectedDev: 'ALL' })),
    setHighlightedTaskId: (highlightedTaskId) => set({ highlightedTaskId }),
    setHighlightedNoteId: (highlightedNoteId) => set({ highlightedNoteId }),
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

    addNote: () => {
      const id = makeId('note')
      const now = new Date().toISOString()
      const proj = get().selectedProject
      const note: Note = {
        id,
        title: '',
        body: '',
        color: 'var(--accent)',
        projectId: proj !== 'ALL' ? proj : undefined,
        createdAt: now,
        updatedAt: now,
      }
      set((s) => withSave({ ...s, notes: [note, ...(s.notes ?? [])] }))
      return id
    },

    updateNote: (id, changes) =>
      set((s) => withSave({
        ...s,
        notes: (s.notes ?? []).map((n) => {
          if (n.id !== id) return n
          // Changing the reminder time re-arms the one-shot notification guard.
          const reminderChanged = 'reminderAt' in changes && changes.reminderAt !== n.reminderAt
          return {
            ...n,
            ...changes,
            reminderFired: reminderChanged ? false : (changes.reminderFired ?? n.reminderFired),
            updatedAt: new Date().toISOString(),
          }
        }),
      })),

    deleteNote: (id) =>
      set((s) => withSave({ ...s, notes: (s.notes ?? []).filter((n) => n.id !== id) })),

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
      const todayRaw = todayStr()
      const lastWorkday = latestWorkday()
      // On weekends/holidays, carry forward to next workday so issues appear on Monday
      const today = todayRaw === lastWorkday ? todayRaw : nextWorkDay(lastWorkday)

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

    // Retention: for tasks older than 3 months, strip the heavy per-issue arrays that no
    // historical dashboard reads — `prs` and `comment` on each jira, plus the task-level
    // `comment`/`deletedJiraUrls`. Keeps the whole task record AND `statusHistory` so
    // Performance "all time" stays exactly correct. Never touches tasks within the retention
    // window (carry-over safety), notes, schedule, or any other slice.
    pruneOldTaskData: () => {
      // Cutoff = 90 days ago as a YYYY-MM-DD string (well past the ~40d carry-over window).
      const cut = new Date()
      cut.setDate(cut.getDate() - 90)
      const cutoff = cut.toISOString().slice(0, 10)

      const { tasks } = get()
      let changed = false
      // Safety: capture the exact fields we strip, so a mistaken prune is recoverable.
      const rescued: Array<{ id: string; comment?: string; deletedJiraUrls?: string[]; jiras: Array<{ issueId?: string; url: string; prs?: PrEntry[]; comment?: string }> }> = []
      const pruned = tasks.map((t) => {
        if (!t.date || t.date >= cutoff) return t
        // Already pruned? (no heavy fields left) → skip to avoid churn.
        const hasHeavy = (t.comment && t.comment.length > 0)
          || (t.deletedJiraUrls && t.deletedJiraUrls.length > 0)
          || (t.jiras ?? []).some((j) => (j.prs && j.prs.length > 0) || (j.comment && j.comment.length > 0))
        if (!hasHeavy) return t
        changed = true
        rescued.push({
          id: t.id,
          comment: t.comment || undefined,
          deletedJiraUrls: t.deletedJiraUrls,
          jiras: (t.jiras ?? [])
            .filter((j) => (j.prs && j.prs.length) || j.comment)
            .map((j) => ({ issueId: j.issueId, url: j.url, prs: j.prs, comment: j.comment })),
        })
        return {
          ...t,
          comment: '',
          deletedJiraUrls: undefined,
          jiras: (t.jiras ?? []).map((j) => ({ ...j, prs: [], comment: '' })),
        }
      })
      if (changed) {
        // Keep a rolling local backup of stripped fields (best-effort; ignore quota errors).
        // Recoverable from this browser if the prune ever removed something wanted.
        try {
          if (typeof localStorage !== 'undefined' && rescued.length) {
            const prev = JSON.parse(localStorage.getItem('pm_prune_backup') ?? '[]') as unknown[]
            const merged = [...prev, { at: new Date().toISOString(), cutoff, items: rescued }]
            // Cap the backup log so it can't itself grow unbounded (keep last 3 prune batches).
            localStorage.setItem('pm_prune_backup', JSON.stringify(merged.slice(-3)))
          }
        } catch { /* storage full / unavailable — proceed with the prune anyway */ }
        set((s) => withSave({ ...s, tasks: pruned }))
      }
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

    setReleaseNoteColumns: (cols) => set((s) => withSave({ ...s, releaseNoteColumns: cols })),
    setReleaseNoteData: (data) => set((s) => withSave({ ...s, releaseNoteData: data })),
    updateReleaseNoteIssue: (key, patch) => set((s) => withSave({ ...s, releaseNoteData: { ...(s.releaseNoteData ?? {}), [key]: { ...(s.releaseNoteData?.[key] ?? {}), ...patch } } })),

    setTrackerTimezone: (trackerTimezone) => set((s) => withSave({ ...s, trackerTimezone })),

    setJiraConnections: (jiraConnections) => set((s) => withSave({ ...s, jiraConnections })),

    // Resolve a single scrum project's exact board issue keys from Jira, on demand
    // (e.g. right after selecting a board). Keeps board-scoped views accurate without a sync.
    refreshBoardIssueKeys: async (projectId: string) => {
      const { projects, jiraConnections, developers } = get()
      const proj = projects.find((p) => p.id === projectId)
      if (!proj || proj.mode !== 'scrum' || !proj.jiraBoardId) return
      const conn = (proj.jiraConnectionId ? jiraConnections.find((c) => c.id === proj.jiraConnectionId && c.enabled) : undefined)
        ?? jiraConnections.find((c) => c.projectId === proj.id && c.enabled)
        ?? jiraConnections.find((c) => c.enabled && c.token)
      if (!conn) return
      const members = proj.members ?? []
      const emails = [...new Set(developers
        .filter((d) => members.length === 0 || members.includes(d.id))
        .map((d) => conn.developerEmails?.[d.id] ?? d.jiraEmail ?? '')
        .filter(Boolean))]
      try {
        const keys = await fetchBoardIssueKeys(conn, proj.jiraBoardId, emails)
        set((s) => ({ ...s, projects: s.projects.map((p) => p.id === projectId ? { ...p, boardIssueKeys: keys } : p) }))
      } catch { /* keep existing on failure */ }
    },

    syncJira: async () => {
      const { jiraConnections, developers, tasks, projects } = get()
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

        // Resolve effective board ID: project's jiraBoardId takes priority over conn.boardId
        const linkedProj = conn.projectId ? projects.find((p) => p.id === conn.projectId) : null
        const effectiveBoardId = linkedProj?.jiraBoardId ?? conn.boardId

        const byDev = new Map<string, JiraIssueRaw[]>()
        // Track devs whose fetch succeeded, and the full set of issue keys Jira returned
        // for each. Used to prune issues that were deleted/reassigned away in Jira.
        const fetchedDevs = new Set<string>()
        const returnedKeysByDev = new Map<string, Set<string>>()
        // Devs whose fetch was cut short by a backend memory-safety cap — pruning MUST skip
        // these, since an issue's absence here doesn't mean it's no longer assigned, only
        // that it didn't fit within the cap. Treating a truncated response as complete would
        // wrongly delete issues that are still genuinely assigned (this happened in
        // production — see the commit that added this comment).
        const truncatedDevs = new Set<string>()
        for (const { dev, email } of connDevs) {
          let devIssues: JiraIssueRaw[]
          let truncated = false
          try {
          if (effectiveBoardId) {
            // Board mode: single board, active sprint only
            const r = await fetchJiraBoardIssues(conn, effectiveBoardId, email)
            devIssues = r.issues
            truncated = r.truncated
          } else if (conn.allowedBoardIds?.length) {
            // Project mode with board filter: fetch from each allowed board and union
            const perBoard = await Promise.all(
              conn.allowedBoardIds.map((bid) =>
                fetchJiraBoardIssues(conn, bid, email).catch(() => ({ issues: [] as JiraIssueRaw[], truncated: false }))
              )
            )
            truncated = perBoard.some((r) => r.truncated)
            const seen = new Set<string>()
            devIssues = perBoard.flatMap((r) => r.issues).filter((issue) => {
              if (seen.has(issue.key)) return false
              seen.add(issue.key)
              return true
            })
          } else {
            const statusFilter = buildJqlStatusFilter(conn.statusMappings)
            // Match assignee by both the full email AND the username (local-part before @).
            // Some Jira instances identify users by username, not email, so `assignee = "email"`
            // alone silently misses those issues.
            const localPart = email.includes('@') ? email.slice(0, email.indexOf('@')) : email
            const assigneeVals = [...new Set([email, localPart])].map((v) => `"${v}"`).join(', ')
            const assigneeClause = `assignee in (${assigneeVals})`
            const projClause = projList ? `project in (${projList})` : ''
            const buildJql = (withStatus: boolean) =>
              [projClause, assigneeClause, withStatus ? statusFilter : '']
                .filter(Boolean)
                .join(' AND ') + ' ORDER BY updated DESC'
            let r: { issues: JiraIssueRaw[]; truncated: boolean }
            try {
              r = await fetchJiraIssues(conn, buildJql(true))
            } catch (e) {
              // The status filter (built from status-group mappings) can reference a status
              // name that no longer exists in Jira, which makes the whole query 500 and
              // silently drops that developer's issues. Retry WITHOUT the status filter so
              // the issues still sync.
              console.warn('[sync] status-filtered search failed, retrying without status filter:', e)
              r = await fetchJiraIssues(conn, buildJql(false))
            }
            devIssues = r.issues
            truncated = r.truncated
          }
          } catch {
            // Fetch failed for this dev — skip pruning to avoid wiping issues on a transient error.
            continue
          }
          fetchedDevs.add(dev.id)
          if (truncated) truncatedDevs.add(dev.id)
          returnedKeysByDev.set(dev.id, new Set(devIssues.map((i) => i.key)))
          if (devIssues.length) byDev.set(dev.id, devIssues)
        }

        let connAdded = 0
        let connUpdated = 0
        let connRemoved = 0

        byDev.forEach((devIssues, devId) => {
          const syncTask =
            dedupedTasks.find((t) => t.devId === devId && t.date === today && t.jiraSync) ??
            dedupedTasks.find((t) => t.devId === devId && t.date === today)

          const incoming = devIssues.map((i) => rawToJiraItem(i, conn.baseUrl, conn.statusMappings, effectiveBoardId))
          const todayTasks = dedupedTasks.filter((t) => t.devId === devId && t.date === today)

          const keyToTask = new Map<string, { task: typeof dedupedTasks[number]; idx: number }>()
          todayTasks.forEach((t) => {
            ;(t.jiras ?? []).forEach((j, idx) => {
              const k = jiraDedupeKey(j.url, j.name)
              if (k && k !== 'name:') keyToTask.set(k, { task: t, idx })
            })
          })

          const trulyNew: typeof incoming = []
          // If Jira returns an issue that was previously removed, it's genuinely assigned
          // and active again — clear it from the deleted list so it comes back. (deletedJiraUrls
          // must not be a permanent blocklist against Jira re-adding an active issue.)
          const incomingUrls = new Set(incoming.map((nj) => nj.url))
          dedupedTasks.forEach((t) => {
            if (t.devId !== devId || !t.deletedJiraUrls?.length) return
            const kept = t.deletedJiraUrls.filter((u) => !incomingUrls.has(u))
            if (kept.length !== t.deletedJiraUrls.length) t.deletedJiraUrls = kept
          })

          incoming.forEach((nj) => {
            const njKey = jiraDedupeKey(nj.url, nj.name)

            if (syncTask) {
              const existIdx = syncTask.jiras.findIndex((ej) => {
                const ejKey = jiraDedupeKey(ej.url, ej.name)
                return (njKey && njKey !== 'name:' && ejKey === njKey) || ej.url === nj.url
              })
              if (existIdx >= 0) {
                const ex = syncTask.jiras[existIdx]
                // Jira is the source of truth on sync: take the fresh Jira status and
                // clear any manual override (manualStatus is only an optimistic hint
                // between syncs — it must never permanently mask the real Jira status).
                syncTask.jiras[existIdx] = { ...ex, boardId: nj.boardId ?? ex.boardId, status: nj.status, groupId: nj.groupId, manualStatus: undefined, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory), storyPoints: nj.storyPoints ?? ex.storyPoints, timeOriginalEstimate: nj.timeOriginalEstimate ?? ex.timeOriginalEstimate, timeSpent: nj.timeSpent ?? ex.timeSpent, jiraCreatedAt: nj.jiraCreatedAt ?? ex.jiraCreatedAt, issueTypeName: nj.issueTypeName ?? ex.issueTypeName, issueTypeIconUrl: nj.issueTypeIconUrl ?? ex.issueTypeIconUrl }
                connUpdated++
                return
              }
            }

            if (njKey && njKey !== 'name:' && keyToTask.has(njKey)) {
              const { task, idx } = keyToTask.get(njKey)!
              const ex = task.jiras[idx]
              // Jira is the source of truth on sync — take fresh status, clear manual override.
              task.jiras[idx] = { ...ex, boardId: nj.boardId ?? ex.boardId, status: nj.status, groupId: nj.groupId, manualStatus: undefined, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory), storyPoints: nj.storyPoints ?? ex.storyPoints, timeOriginalEstimate: nj.timeOriginalEstimate ?? ex.timeOriginalEstimate, timeSpent: nj.timeSpent ?? ex.timeSpent, issueTypeName: nj.issueTypeName ?? ex.issueTypeName, issueTypeIconUrl: nj.issueTypeIconUrl ?? ex.issueTypeIconUrl }
              connUpdated++
              return
            }

            // Add all fresh issues, including Done/closed — the tracker mirrors Jira.
            trulyNew.push(nj)
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
                projectId: conn.projectId ?? '',
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

        // Prune issues Jira no longer returns (deleted in Jira, or reassigned away).
        // Runs across ALL tasks (every date) for devs whose fetch succeeded, so a deleted
        // issue disappears from every dashboard — not just today's board.
        const connKeys = conn.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean)
        const keyPrefix = (j: JiraIssue): string | undefined => {
          const dk = jiraDedupeKey(j.url, j.name)
          const m = dk.match(/^([A-Z][A-Z0-9]+)-\d+$/)
          return m ? m[1]!.toUpperCase() : undefined
        }
        const jiraTicket = (j: JiraIssue): string | undefined => {
          const dk = jiraDedupeKey(j.url, j.name)
          return /^[A-Z][A-Z0-9]+-\d+$/.test(dk) ? dk : undefined
        }
        if (fetchedDevs.size) {
          dedupedTasks.forEach((t) => {
            // A truncated fetch didn't see this dev's full assigned-issue set, so an issue
            // missing from it may simply not have fit the cap, not have been unassigned —
            // pruning here would silently delete issues that are still genuinely assigned.
            if (!fetchedDevs.has(t.devId) || truncatedDevs.has(t.devId) || !t.jiras?.length) return
            // Prune against THIS dev's own returned keys, not the connection-wide union —
            // otherwise a reassigned issue (still returned for the new assignee) never gets
            // pruned from the old assignee's tasks, duplicating it across both.
            const devReturnedKeys = returnedKeysByDev.get(t.devId) ?? new Set<string>()
            const keep = t.jiras.filter((j) => {
              const ticket = jiraTicket(j)
              if (!ticket) return true                  // manual / non-key issue — never prune
              // In board mode: prune any issue (including done) not returned to this dev by this board.
              // The board API returns exact per-assignee membership — absent = moved/deleted/reassigned.
              if (effectiveBoardId) {
                return devReturnedKeys.has(ticket)
              }
              const pfx = keyPrefix(j)
              // Only prune issues whose prefix belongs to this connection's project keys.
              // Issues from other projects are not our responsibility to prune.
              if (connKeys.length && (!pfx || !connKeys.includes(pfx))) return true
              // For active issues: prune if Jira no longer returns them to this dev (moved/deleted/reassigned).
              // For done issues: also prune if absent — done issues from a moved key should not persist.
              return devReturnedKeys.has(ticket)
            })
            if (keep.length !== t.jiras.length) {
              connRemoved += t.jiras.length - keep.length
              t.jiras = keep
            }
          })
        }

        added += connAdded
        updated += connUpdated
        removed += connRemoved
        // Only fetch working-hours config once (it rarely changes). Avoids hitting
        // jira-time-tracking on every sync, which was producing repeated 403 noise.
        const hoursPerDay = conn.hoursPerDay != null
          ? conn.hoursPerDay
          : await fetchJiraTimeTracking(conn).catch(() => 8)
        syncedConns.push({
          ...conn,
          hoursPerDay,
          lastSync: new Date().toISOString(),
          lastSyncResult: `+${connAdded} added, ${connUpdated} updated${connRemoved ? `, ${connRemoved} closed removed` : ''}`,
        })
      }

      const finalConns = get().jiraConnections.map((c) => syncedConns.find((s) => s.id === c.id) ?? c)

      // Build a map of issueId → boardId from all synced incoming issues, for backfilling old tasks
      const issueIdToBoardId = new Map<string, number>()
      for (const conn of syncedConns) {
        const linkedProj2 = conn.projectId ? get().projects.find((p) => p.id === conn.projectId) : null
        const bId = (linkedProj2?.jiraBoardId ?? conn.boardId)
        if (!bId) continue
        // We already have incoming stamped — collect from dedupedTasks that now have boardId
        for (const t of dedupedTasks) {
          for (const j of t.jiras ?? []) {
            if (j.boardId === bId && j.issueId) issueIdToBoardId.set(j.issueId, bId)
          }
        }
        for (const t of newTasks) {
          for (const j of t.jiras ?? []) {
            if (j.boardId === bId && j.issueId) issueIdToBoardId.set(j.issueId, bId)
          }
        }
      }

      // Refresh each scrum project's exact board issue keys, so board-scoped display stays
      // current (issues added/moved to a board appear without re-saving the project).
      const boardKeyUpdates = new Map<string, string[]>()
      for (const proj of projects) {
        if (proj.mode !== 'scrum' || !proj.jiraBoardId) continue
        const conn = (proj.jiraConnectionId ? enabledConns.find((c) => c.id === proj.jiraConnectionId) : undefined)
          ?? enabledConns.find((c) => c.projectId === proj.id)
          ?? enabledConns[0]
        if (!conn) continue
        const members = proj.members ?? []
        const emails = [...new Set(developers
          .filter((d) => members.length === 0 || members.includes(d.id))
          .map((d) => conn.developerEmails?.[d.id] ?? d.jiraEmail ?? '')
          .filter(Boolean))]
        try {
          const keys = await fetchBoardIssueKeys(conn, proj.jiraBoardId, emails)
          boardKeyUpdates.set(proj.id, keys)
          if (!keys.length) console.warn(`[board-keys] ${proj.name} (board ${proj.jiraBoardId}) resolved 0 keys`)
        } catch (e) {
          console.warn(`[board-keys] ${proj.name} (board ${proj.jiraBoardId}) resolve FAILED — board scope will fall back to boardId/prefix:`, e)
        }
      }

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
          // Backfill boardId on any jira whose issueId we now know the board for
          const stamped = jiras.map((j) => {
            if (j.boardId != null || !j.issueId) return j
            const bId = issueIdToBoardId.get(j.issueId)
            return bId != null ? { ...j, boardId: bId } : j
          })
          return { ...t, jiras: sortJiraIssues(stamped) }
        })
        // Also backfill tasks NOT in dedupedTasks (i.e. tasks from other dates not touched by this sync)
        const mergedIds = new Set(merged.map((t) => t.id))
        const untouched = s.tasks.filter((t) => !mergedIds.has(t.id) && !newTasks.some((n) => n.id === t.id))
        const untouchedStamped = untouched.map((t) => {
          if (!issueIdToBoardId.size) return t
          const jiras = (t.jiras ?? []).map((j) => {
            if (j.boardId != null || !j.issueId) return j
            const bId = issueIdToBoardId.get(j.issueId)
            return bId != null ? { ...j, boardId: bId } : j
          })
          return { ...t, jiras }
        })
        const projectsUpdated = boardKeyUpdates.size
          ? s.projects.map((p) => boardKeyUpdates.has(p.id) ? { ...p, boardIssueKeys: boardKeyUpdates.get(p.id) } : p)
          : s.projects
        return withSave({ ...s, tasks: [...merged, ...untouchedStamped, ...newTasks], jiraConnections: finalConns, projects: projectsUpdated })
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
        const isDraft = !!(mr.draft ?? mr.work_in_progress ?? /^(Draft|WIP):/i.test(mr.title))
        const mrPrState: import('../types').PrState =
          mr.state === 'merged' ? 'merged'
          : mr.state === 'closed' ? 'closed'
          : isDraft ? 'draft'
          : 'open'
        const mrStateHistory: import('../types').PrStateEvent[] = [
          { state: isDraft ? 'draft' : 'open', at: mr.created_at },
          ...(mr.merged_at ? [{ state: 'merged' as const, at: mr.merged_at }] : []),
          ...(mr.closed_at && !mr.merged_at ? [{ state: 'closed' as const, at: mr.closed_at }] : []),
        ]
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
            const identity = jira.issueId ?? (jira.url || null)
            if (!identity) continue
            if (!prPatches.has(task.id)) prPatches.set(task.id, new Map())
            const taskPatch = prPatches.get(task.id)!
            const existing = taskPatch.get(identity) ?? []
            if (!existing.some((p) => p.url === mr.web_url)) {
              const alreadyInJira = (jira.prs ?? []).some((p) => p.url === mr.web_url)
              taskPatch.set(identity, [...existing, { url: mr.web_url, date: pushDate, time: pushTime, state: mrPrState, stateHistory: mrStateHistory }])
              if (!alreadyInJira) addedSomewhere = true
            } else {
              taskPatch.set(identity, existing.map((p) => p.url === mr.web_url ? { ...p, state: mrPrState, stateHistory: mrStateHistory } : p))
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
            const existingUrls = new Set((j.prs ?? []).map((p) => p.url))
            const toAdd = (newPrs ?? []).filter((p) => !existingUrls.has(p.url))
            // Update state + stateHistory on existing PRs even if no new ones added
            const updatedExisting = (j.prs ?? []).map((p) => {
              const patch = (newPrs ?? []).find((np) => np.url === p.url)
              if (!patch) return p
              return { ...p, ...(patch.state ? { state: patch.state } : {}), ...(patch.stateHistory ? { stateHistory: patch.stateHistory } : {}) }
            })
            const stateChanged = updatedExisting.some((p, i) => {
              const orig = (j.prs ?? [])[i]
              return p.state !== orig?.state || JSON.stringify(p.stateHistory) !== JSON.stringify(orig?.stateHistory)
            })
            if (!toAdd.length && !stateChanged) return j
            changed = true
            let newStatus = j.status
            for (const p of toAdd) {
              const st = mrUrlToStatus.get(p.url)
              if (st === 'done') { newStatus = 'done'; break }
              if (st === 'review' && newStatus !== 'done' && newStatus !== 'blocked') newStatus = 'review'
            }
            return { ...j, prs: [...updatedExisting, ...toAdd], status: newStatus }
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

      const prById = new Map<number, Awaited<ReturnType<typeof fetchOrgPRs>>[number]>()
      const syncedConns: GitHubConfig[] = []

      for (const conn of enabledConns) {
        const devUsernames = developers
          .filter((d) => !d.archivedAt)
          .map((d) => (conn.developerUsernames?.[d.id] ?? '').trim())
          .filter(Boolean)

        if (conn.orgOrUser.trim()) {
          try {
            const orgPRs = await fetchOrgPRs(conn.orgOrUser, conn.token)
            for (const p of orgPRs) prById.set(p.id, p)
          } catch (err) {
            const msg = (err as Error).message
            const isPermission = msg.includes('403') || msg.includes('Forbidden') || msg.includes('401')
            if (!isPermission || devUsernames.length === 0) throw err
          }
        }

        if (devUsernames.length > 0) {
          const ownerScope = conn.orgOrUser.trim() ? normalizeGithubPath(conn.orgOrUser).owner : ''
          const userPRs = await Promise.all(devUsernames.map((u) => fetchUserPRs(u, conn.token, ownerScope)))
          for (const prs of userPRs) for (const p of prs) prById.set(p.id, p)
        }

        syncedConns.push({ ...conn, lastSync: new Date().toISOString() })
      }

      const allPRs = [...prById.values()]

      const prPatches = new Map<string, Map<string, PrEntry[]>>()
      const prUrlToStatus = new Map<string, JiraIssue['status']>()
      const prUrlToKeys = new Map<string, Set<string>>()  // url → matched issue keys (uppercase)
      const prUrlToState = new Map<string, import('../types').PrState>()
      const prUrlToHistory = new Map<string, import('../types').PrStateEvent[]>()
      let linked = 0
      let updated = 0

      for (const pr of allPRs) {
        const keys = extractGithubJiraKeys(pr, projectKeys)
        console.info('[GitHub sync] PR:', pr.html_url, 'title:', pr.title, 'branch:', pr.head?.ref, 'keys:', keys)
        prUrlToKeys.set(pr.html_url, new Set(keys.map((k) => k.toUpperCase())))
        if (!keys.length) continue
        const { date: pushDate, time: pushTime } = toLocalParts(new Date(pr.created_at))
        const isMerged = !!(pr.merged_at ?? pr.pull_request?.merged_at)
        prUrlToStatus.set(pr.html_url, isMerged ? 'done' : 'review')
        const ghPrState: import('../types').PrState =
          isMerged ? 'merged'
          : pr.state === 'closed' ? 'closed'
          : pr.draft ? 'draft'
          : 'open'
        prUrlToState.set(pr.html_url, ghPrState)
        const mergedAt = pr.merged_at ?? pr.pull_request?.merged_at ?? null
        const closedAt = pr.closed_at ?? null
        prUrlToHistory.set(pr.html_url, [
          { state: pr.draft ? 'draft' as const : 'open' as const, at: pr.created_at },
          ...(mergedAt ? [{ state: 'merged' as const, at: mergedAt }] : []),
          ...(closedAt && !mergedAt ? [{ state: 'closed' as const, at: closedAt }] : []),
        ])

        const keySet = new Set(keys)
        const matchesIssue = (jira: JiraIssue) => {
          if (jira.issueId && keySet.has(jira.issueId.toUpperCase())) return true
          const k = jiraDedupeKey(jira.url, jira.name)
          return !!(k && k !== 'name:' && keySet.has(k.toUpperCase()))
        }

        let matched = false
        let addedSomewhere = false

        for (const task of tasks) {
          for (const jira of (task.jiras ?? [])) {
            if (!matchesIssue(jira)) continue
            matched = true
            const identity = jira.issueId ?? (jira.url || null)
            if (!identity) continue
            if (!prPatches.has(task.id)) prPatches.set(task.id, new Map())
            const taskPatch = prPatches.get(task.id)!
            const existing = taskPatch.get(identity) ?? []
            const ghState = prUrlToState.get(pr.html_url)
            const ghHistory = prUrlToHistory.get(pr.html_url)
            if (!existing.some((p) => p.url === pr.html_url)) {
              const alreadyInJira = (jira.prs ?? []).some((p) => p.url === pr.html_url)
              taskPatch.set(identity, [...existing, { url: pr.html_url, date: pushDate, time: pushTime, state: ghState, stateHistory: ghHistory }])
              if (!alreadyInJira) addedSomewhere = true
            } else {
              taskPatch.set(identity, existing.map((p) => p.url === pr.html_url ? { ...p, state: ghState, stateHistory: ghHistory } : p))
            }
          }
        }

        if (matched) {
          if (addedSomewhere) linked++
          else updated++
        }
      }

      // All GitHub PR urls fetched this sync
      const fetchedGithubUrls = new Set(allPRs.map((p) => p.html_url))

      set((s) => withSave({
        ...s,
        tasks: s.tasks.map((t) => {
          const taskPatch = prPatches.get(t.id)
          let changed = false
          const jiras = (t.jiras ?? []).map((j) => {
            const identity = j.issueId ?? (j.url || null)
            const issueKey = (() => {
              if (j.issueId) return j.issueId.toUpperCase()
              const k = jiraDedupeKey(j.url, j.name)
              return k && k !== 'name:' ? k.toUpperCase() : null
            })()

            // Remove stale GitHub PR links: fetched this sync but key doesn't match this issue
            const filteredPrs = (j.prs ?? []).filter((p) => {
              if (!p.url.includes('github.com')) return true  // keep non-GitHub links always
              if (!fetchedGithubUrls.has(p.url)) return true  // not fetched = keep (might be from outside org)
              if (!issueKey) return true  // no key to check against = keep
              const prKeys = prUrlToKeys.get(p.url)
              return !prKeys || prKeys.has(issueKey)  // keep only if PR actually mentions this issue
            })
            if (filteredPrs.length !== (j.prs ?? []).length) changed = true

            if (!identity) return changed ? { ...j, prs: filteredPrs } : j
            const newPrs = taskPatch?.get(identity)
            // Update state + stateHistory on existing PRs
            const updatedFiltered = filteredPrs.map((p) => {
              const patch = (newPrs ?? []).find((np) => np.url === p.url)
              if (!patch) return p
              return { ...p, ...(patch.state ? { state: patch.state } : {}), ...(patch.stateHistory ? { stateHistory: patch.stateHistory } : {}) }
            })
            const stateUpdated = updatedFiltered.some((p, i) => {
              const orig = filteredPrs[i]
              return p.state !== orig?.state || JSON.stringify(p.stateHistory) !== JSON.stringify(orig?.stateHistory)
            })
            if (stateUpdated) changed = true
            if (!newPrs?.length) return changed ? { ...j, prs: updatedFiltered } : j
            const existingUrls = new Set(updatedFiltered.map((p) => p.url))
            const toAdd = newPrs.filter((p) => !existingUrls.has(p.url))
            if (!toAdd.length) return changed ? { ...j, prs: updatedFiltered } : j
            changed = true
            let newStatus = j.status
            for (const p of toAdd) {
              const st = prUrlToStatus.get(p.url)
              if (st === 'done') { newStatus = 'done'; break }
              if (st === 'review' && newStatus !== 'done' && newStatus !== 'blocked') newStatus = 'review'
            }
            return { ...j, prs: [...updatedFiltered, ...toAdd], status: newStatus }
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
  // Only mark ready when we actually received data. A null response means the user is
  // unauthenticated — setting cloudSyncReady here would allow withSave to overwrite real
  // cloud data with an empty freshState() after a token-clear + reload.
  if (cloud !== null) cloudSyncReady = true
  useStore.setState((s) => ({
    ...s,
    cloudSyncing: false,
    ...(cloud
      ? {
          ...(cloud.developers ? { developers: (cloud.developers as AppState['developers']).map((d) => ({ periods: [], ...d })) } : {}),
          ...(cloud.projects ? { projects: (cloud.projects as AppState['projects']).map((p) => ({ nonWorkingDays: [0, 6] as number[], ...p, members: (p as { members?: string[] }).members ?? [] })) } : {}),
          ...(cloud.sprints ? { sprints: cloud.sprints as AppState['sprints'] } : {}),
          ...(cloud.tasks ? { tasks: (cloud.tasks as AppState['tasks']).map(normalizeTask) } : {}),
          ...(cloud.notes ? { notes: cloud.notes as AppState['notes'] } : {}),
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
          ...(cloud.selectedProject ? { selectedProject: cloud.selectedProject as string } : {}),
          ...(cloud.selectedDev ? { selectedDev: cloud.selectedDev as string } : {}),
          ...(cloud.releaseNoteColumns ? { releaseNoteColumns: cloud.releaseNoteColumns as ReleaseNoteColumn[] } : {}),
          ...(cloud.releaseNoteData ? { releaseNoteData: cloud.releaseNoteData as Record<string, ReleaseNoteIssueData> } : {}),
        }
      : {}),
  }))
}

export async function syncCloudToStore(): Promise<void> {
  useStore.setState({ cloudSyncing: true })
  try {
    const cloud = await loadCloudState()
    // After login the user is authenticated — safe to enable saves even if cloud is empty.
    cloudSyncReady = true
    applyCloudState(cloud)
  } catch {
    cloudSyncReady = true
    useStore.setState({ cloudSyncing: false })
  }
}

loadCloudState().then(applyCloudState).catch(() => {
  useStore.setState({ cloudSyncing: false })
})

// Debug helper: expose the store + a one-shot issue tracer on window so issue-visibility
// problems can be diagnosed without reaching into React internals. Safe, read-only.
if (typeof window !== 'undefined') {
  ;(window as any).pmStore = useStore
  ;(window as any).pmWhy = (needle: string) => {
    const s = useStore.getState() as AppState
    const conn = getActiveJiraConn(s)
    const scope = getBoardScope(s)
    const proj = s.projects.find((p) => p.id === s.selectedProject)
    const rows: any[] = []
    for (const t of s.tasks) {
      for (const j of t.jiras ?? []) {
        const blob = `${j.url ?? ''} ${j.name ?? ''} ${j.issueId ?? ''}`
        if (!blob.toLowerCase().includes(needle.toLowerCase())) continue
        rows.push({
          key: jiraFullKey(j) ?? j.issueId,
          taskDate: t.date, dev: t.devId, taskProj: t.projectId,
          groupId: j.groupId, status: j.status, hidden: j.hidden, boardId: j.boardId,
          failsBoard: !jiraOnBoard(j, scope),
          failsShows: !issueShowsOnBoard(j, conn),
          isClosedGrp: isClosedGroup(j.groupId, conn),
          dateMatchesSelected: t.date === s.selectedDate,
          devIsVisible: getVisibleDevIds(s).includes(t.devId),
          projMatches: s.selectedProject === 'ALL' || t.projectId === s.selectedProject,
        })
      }
    }
    console.log('selectedProject', proj?.name, '| mode', proj?.mode, '| selectedDate', s.selectedDate,
      '| boardScope.active', scope.active)
    console.table(rows)
    return rows
  }
}

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

export function getActiveBoardId(state: AppState): number | undefined {
  if (state.selectedProject === 'ALL') return undefined
  const proj = state.projects.find((p) => p.id === state.selectedProject)
  return proj?.mode === 'scrum' && proj.jiraBoardId ? proj.jiraBoardId : undefined
}

// The Jira project-key prefixes the selected board covers, resolved & stored on the
// project when the board was saved. undefined = no board selected (no filtering).
// [] = board resolved but has zero issues (show nothing jira-related).
export function getActiveBoardProjectKeys(state: AppState): string[] | undefined {
  if (state.selectedProject === 'ALL') return undefined
  const proj = state.projects.find((p) => p.id === state.selectedProject)
  if (!proj?.jiraBoardId) return undefined
  if (proj.boardProjectKeys === undefined) return undefined  // not resolved yet
  return proj.boardProjectKeys.map((k) => k.trim().toUpperCase())  // may be [] (resolved, empty)
}

// The EXACT set of Jira issue keys on the selected scrum board — the accurate
// board-membership signal. undefined = no board selected OR not yet resolved (no filtering
// by exact key). A resolved-but-empty board yields an empty set (show nothing).
export function getActiveBoardIssueKeys(state: AppState): Set<string> | undefined {
  if (state.selectedProject === 'ALL') return undefined
  const proj = state.projects.find((p) => p.id === state.selectedProject)
  if (!proj?.jiraBoardId) return undefined
  if (proj.boardIssueKeys === undefined) return undefined  // not resolved yet
  return new Set(proj.boardIssueKeys.map((k) => k.trim().toUpperCase()))
}

export function taskMatchesBoard(t: Task, boardId: number): boolean {
  return (t.jiras ?? []).some((j) => j.boardId === boardId)
}

// The Jira connection that owns the status-group mappings used for display.
export function getActiveJiraConn(state: AppState): JiraConfig | undefined {
  return state.jiraConnections.find((c) => c.enabled && c.statusMappings?.length)
}

// Single source of truth for board visibility, shared by Daily AND Deadlines.
// An issue shows on the board unless its status group is 'hidden' or marked isClosed
// (per the integration settings). Falls back to legacy status for issues with no group.
export function issueShowsOnBoard(j: JiraIssue, conn: JiraConfig | undefined): boolean {
  const gid = j.groupId
  if (gid === 'hidden') return false
  if (gid ? isClosedGroup(gid, conn) : j.status === 'done') return false
  return true
}

// A sprint belongs to the selected project & board. When a board is selected:
//  - Jira-synced sprints (jiraSprintId set) must match that exact board.
//  - Manual sprints (no jiraSprintId) are project-scoped and always shown.
export function sprintMatchesBoard(s: Sprint, selectedProject: string, boardId: number | undefined): boolean {
  if (s.projectId !== selectedProject) return false
  if (!boardId) return true
  if (s.jiraSprintId == null) return true  // manual sprint — not board-specific
  return s.jiraBoardId === boardId
}

// A task passes the board filter when at least one of its Jira issues belongs to the
// board. Board membership is determined by the issue key prefix matching the board's
// resolved project keys. When a board is selected but has no known keys ([]), no
// jira-bearing task passes. Tasks with no jira issues always pass (manual tasks).
// The full Jira key (e.g. "COM-826") of an issue. The real key lives in the URL/name;
// issueId can be a synthetic id, so try it last.
export function jiraFullKey(j: JiraIssue): string | undefined {
  const dk = jiraDedupeKey(j.url, j.name)
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(dk)) return dk.toUpperCase()
  if (j.issueId && /^[A-Z][A-Z0-9]+-\d+$/.test(j.issueId)) return j.issueId.toUpperCase()
  return undefined
}

// The project-key prefix (e.g. "CS") of an issue.
export function jiraKeyPrefix(j: JiraIssue): string | undefined {
  const full = jiraFullKey(j)
  return full ? full.split('-')[0] : undefined
}

// Board scope for the current selection. issueKeys = exact keys on the board (accurate);
// prefixes = coarse fallback. `active` is false in kanban / ALL / no-board (no filtering).
export interface BoardScope {
  active: boolean
  boardId?: number              // the selected board's id (issues stamped with it are on-board)
  issueKeys?: Set<string>       // exact keys, when resolved
  prefixes?: string[]           // prefix fallback, when exact keys unavailable
}

export function getBoardScope(state: AppState): BoardScope {
  const activeBoardId = getActiveBoardId(state)
  if (!activeBoardId) return { active: false }
  return {
    active: true,
    boardId: activeBoardId,
    issueKeys: getActiveBoardIssueKeys(state),
    prefixes: getActiveBoardProjectKeys(state),
  }
}

// Is a single jira issue on the selected board?
//  - Board not active (kanban / ALL) → always true.
//  - Exact issue keys resolved → the issue's key must be in that set (precise).
//  - Only prefixes available → prefix must match (coarse fallback).
//  - Neither resolved → the issue must at least be stamped with THIS board's id, or (if it
//    carries no boardId) share the board's key prefix. Never fall back to "show everything",
//    which would leak issues from other projects (e.g. MONE-* on the CS board).
export function jiraOnBoard(j: JiraIssue, scope: BoardScope): boolean {
  if (!scope.active) return true

  const full = jiraFullKey(j)
  const pfx = full ? full.split('-')[0] : undefined

  // 1) Exact key set is the authority when resolved. A derivable key MUST be in the set.
  //    An issue with a foreign key (e.g. MONE-777 on a CS board) is excluded here even if
  //    it was wrongly stamped with this board's id by an earlier sync.
  if (scope.issueKeys) {
    if (full) return scope.issueKeys.has(full)
    // No derivable key: only keep it if it's stamped with THIS board's id.
    return scope.boardId != null && j.boardId === scope.boardId
  }

  // 2) Prefix set (coarse) when exact keys aren't resolved.
  if (scope.prefixes && scope.prefixes.length) {
    if (full) return scope.prefixes.includes(pfx!)
    return scope.boardId != null && j.boardId === scope.boardId
  }

  // 3) Nothing resolved: trust the boardId stamped at sync time.
  if (scope.boardId != null && j.boardId != null) {
    return j.boardId === scope.boardId
  }

  // 4) Truly nothing to compare: keep only manual items (no derivable key); hide any issue
  //    that has a real key so foreign-project issues never leak onto the board.
  return full == null
}

// A task passes the board filter when at least one of its jiras is on the board.
// Tasks with no jiras always pass (manual tasks).
export function taskPassesBoardFilter(t: Task, scope: BoardScope): boolean {
  if (!scope.active) return true
  const jiras = t.jiras ?? []
  if (jiras.length === 0) return true
  return jiras.some((j) => jiraOnBoard(j, scope))
}

export function getVisibleTasks(state: AppState, devId?: string): Task[] {
  const selectedDayOfWeek = new Date(state.selectedDate + 'T12:00:00').getDay()
  const boardScope = getBoardScope(state)
  const base = state.tasks.filter((t) => {
    const dv = devId ? t.devId === devId : state.selectedDev === 'ALL' || t.devId === state.selectedDev
    const pj = state.selectedProject === 'ALL' || t.projectId === state.selectedProject
    if (!dv || !pj || t.date !== state.selectedDate) return false
    const proj = state.projects.find((p) => p.id === t.projectId)
    const nwd = proj?.nonWorkingDays ?? [0, 6]
    if (nwd.includes(selectedDayOfWeek)) return false
    if (!taskPassesBoardFilter(t, boardScope)) return false
    return true
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

  // Keep only jiras belonging to the selected board.
  const jiraBelongsToBoard = (j: JiraIssue): boolean => jiraOnBoard(j, boardScope)

  // Integration settings are the source of truth for board visibility (shared by Daily
  // and Deadlines): hide any issue whose status group is 'hidden' OR marked isClosed.
  const jiraConn = getActiveJiraConn(state)
  const showsOnBoard = (j: JiraIssue): boolean => {
    return issueShowsOnBoard(j, jiraConn)
  }

  // Optional diagnostics: set window.__debugSync = true in the console, then re-render.
  const dbg = typeof window !== 'undefined' && (window as any).__debugSync
  const dbgCount = { raw: 0, afterBoard: 0, afterShows: 0, afterDedup: 0, droppedBoard: [] as string[], droppedShows: [] as string[] }

  for (const t of ordered) {
    if (Array.isArray(t.jiras) && t.jiras.length > 0) {
      if (dbg) {
        dbgCount.raw += t.jiras.length
        t.jiras.forEach((j) => {
          if (!jiraBelongsToBoard(j)) dbgCount.droppedBoard.push(jiraFullKey(j) ?? j.issueId ?? j.name ?? '?')
          else if (!showsOnBoard(j)) dbgCount.droppedShows.push(`${jiraFullKey(j) ?? j.name}[grp=${j.groupId ?? j.status}]`)
        })
      }
      const freshJiras = t.jiras
        .filter(jiraBelongsToBoard)
        .filter(showsOnBoard)
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
      if (dbg) { dbgCount.afterDedup += freshJiras.length }
      if (freshJiras.length > 0) {
        result.push({ ...t, jiras: freshJiras })
      } else if (!t.carriedOver && (t.deadline || t.comment || t.pr || (t.prs?.length ?? 0) > 0)) {
        result.push({ ...t, jiras: [] })
      }
    } else {
      if (t.jira) {
        // Legacy single-jira string. Apply the SAME board filter as the jiras[] path,
        // otherwise old-style issues (e.g. a MONE-* url) bypass board scoping entirely.
        const legacyIssue = { url: t.jira, name: '' } as unknown as JiraIssue
        if (!jiraOnBoard(legacyIssue, boardScope)) {
          // not on the selected board — keep the task only if it has non-jira content
          if (!t.carriedOver && (t.deadline || t.comment)) result.push({ ...t, jira: '' } as Task)
          continue
        }
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

  if (dbg) {
    console.log('[debugSync] dev', devId ?? state.selectedDev, 'date', state.selectedDate,
      '| boardScope.active', boardScope.active,
      '| raw jiras', dbgCount.raw, '→ afterDedup', dbgCount.afterDedup,
      '| dropped by BOARD filter:', dbgCount.droppedBoard.length, dbgCount.droppedBoard.slice(0, 40),
      '| dropped by SHOWS(done/hidden):', dbgCount.droppedShows.length, dbgCount.droppedShows.slice(0, 40))
  }

  return result
}

export function countUrgentDeadlines(
  tasks: AppState['tasks'],
  developers: AppState['developers'],
  boardScope?: BoardScope,
): number {
  const today = todayStr()
  const archivedIds = new Set(developers.filter((d) => d.archivedAt).map((d) => d.id))
  const scope = boardScope ?? { active: false }

  // Count OVERDUE live issues: on today's synced board, In Progress/Blocked, with a
  // deadline in the past. Mirrors the Deadlines dashboard's live set so the badge is
  // always accurate. Deduped by dev+issue-key.
  const isOverdue = (deadline: string, time: string): boolean => {
    if (!deadline) return false
    const due = new Date(deadline + 'T' + (time || '23:59')).getTime()
    return due < Date.now()
  }
  const seen = new Set<string>()
  let count = 0
  tasks.forEach((t) => {
    if (archivedIds.has(t.devId)) return
    if (t.date !== today) return
    const jiras = getJiras(t).filter((j) => jiraOnBoard(j, scope))
    if (jiras.length) {
      jiras.forEach((j, ji) => {
        // Same set as the Deadlines dashboard: only the In Progress / Blocked groups.
        const gid = j.groupId ?? legacyStatusToGroupId(j.status)
        if (gid !== 'inprogress' && gid !== 'blocked') return
        if (!isOverdue(j.deadline, j.deadlineTime ?? '')) return
        const k = `${t.devId}|${jiraDedupeKey(j.url, j.name) || `_anon${ji}`}`
        if (seen.has(k)) return
        seen.add(k)
        count++
      })
    } else if (t.deadline && (t.status === 'inprogress' || t.status === 'blocked')) {
      if (!isOverdue(t.deadline, t.deadlineTime ?? '')) return
      const k = `${t.devId}|task-title:${t.title}`
      if (seen.has(k)) return
      seen.add(k)
      count++
    }
  })
  return count
}
