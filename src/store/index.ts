import { create } from 'zustand'
import type { AppState, Developer, Project, Sprint, Task, Note, JiraIssue, JiraConfig, GitLabConfig, GitHubConfig, View, EmploymentPeriod, PrEntry, ReleaseNoteColumn, ReleaseNoteIssueData } from '../types'
import { loadCloudState, saveCloudState, markUnloading } from '../utils/cloud-api'
import { todayStr, nextWorkDay, prevWorkDay, latestWorkday } from '../utils/dates'
import { getJiras, identityList, jiraDedupeKey } from '../utils/format'
import { fetchJiraIssues, fetchJiraBoardIssues, fetchBoardIssueKeys, fetchJiraTimeTracking, fetchConnectionProjectKeys, rawToJiraItem, mergeStatusHistory, buildJqlStatusFilter } from '../utils/jira-api'
import type { JiraIssueRaw } from '../utils/jira-api'
import { fetchGroupMRs, fetchUserMRs, extractJiraKeys } from '../utils/gitlab-api'
import { fetchUserPRs, fetchOrgPRs, normalizeGithubPath, extractJiraKeys as extractGithubJiraKeys } from '../utils/github-api'
import { resolveTrackerTz } from '../utils/working-hours'
import { groupForJiraStatus, isClosedGroup, legacyStatusToGroupId } from '../utils/status-groups'

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

// A short, persistent record of what the save/load layer actually did. It survives
// reloads, so when issues disappear the evidence of WHY is still there afterwards --
// rather than needing the problem reproduced with the console already open.
type SyncLogEntry = { t: string; ev: string; tasks?: number; jiras?: number; note?: string }
function syncLog(ev: string, extra: Omit<SyncLogEntry, 't' | 'ev'> = {}): void {
  if (typeof localStorage === 'undefined') return
  try {
    const prev = JSON.parse(localStorage.getItem('pm_sync_log') ?? '[]') as SyncLogEntry[]
    prev.push({ t: new Date().toISOString().slice(11, 23), ev, ...extra })
    localStorage.setItem('pm_sync_log', JSON.stringify(prev.slice(-40)))
  } catch { /* storage full or blocked — diagnostics must never break the app */ }
}

function countJiras(tasks: AppState['tasks']): number {
  let n = 0
  for (const t of tasks) n += (t.jiras ?? []).length
  return n
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
// The Jira sync currently running, if any — see syncJira for why overlap is destructive.
let jiraSyncInFlight: Promise<{ added: number; updated: number; removed: number }> | null = null
let gitlabSyncInFlight: Promise<{ linked: number; updated: number; noKey: number; noIssue: number; noKeyList: string[]; noIssueList: string[] }> | null = null
let githubSyncInFlight: Promise<{ linked: number; updated: number }> | null = null
// Only ever ONE state PUT in flight at a time. The payload is the entire state blob
// (multiple MB), so a save can take seconds; without this guard an edit made mid-upload
// would start a second concurrent full-blob PUT, and the two would race to overwrite each
// other while competing for the same connection and backend memory.
let saveInFlight = false
let retryAttempt = 0
const SAVE_DEBOUNCE_MS = 800
const SAVE_RETRY_BASE_MS = 2000
const SAVE_RETRY_MAX_MS = 60_000

// Exponential backoff with jitter — a fixed 5s retry against a struggling backend just
// keeps hammering it with multi-MB uploads, which is what turns a blip into an outage.
function retryDelay(attempt: number): number {
  const exp = Math.min(SAVE_RETRY_BASE_MS * 2 ** attempt, SAVE_RETRY_MAX_MS)
  return exp / 2 + Math.random() * (exp / 2)
}

function scheduleFlush(ms: number): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; flushPersist() }, ms)
}

function flushPersist(): void {
  if (!pendingPayload) return
  // A save is already uploading — leave the payload queued. Whatever is pending when that
  // one finishes gets flushed then, so the newest state still reaches the server.
  if (saveInFlight) return
  const payload = pendingPayload
  pendingPayload = null
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  saveInFlight = true
  syncLog('save:start', { tasks: (payload.tasks as AppState['tasks'])?.length, jiras: countJiras((payload.tasks as AppState['tasks']) ?? []) })
  useStore.setState({ saveStatus: 'saving' })
  void saveCloudState(payload).then((res) => {
    saveInFlight = false
    if (res.ok) {
      retryAttempt = 0
      syncLog('save:ok')
      useStore.setState({ saveStatus: pendingPayload ? 'saving' : 'saved', saveError: null })
      // A newer edit arrived while this was uploading — send it now.
      if (pendingPayload) scheduleFlush(0)
      return
    }
    // Session expired: retrying is pointless (every attempt fails instantly with no token)
    // and silently pretending to "retry automatically" is how edits get lost. Surface it.
    if (res.reason === 'unauthorized') {
      pendingPayload = payload
      syncLog('save:FAIL', { note: 'unauthorized' })
      useStore.setState({ saveStatus: 'error', saveError: 'unauthorized' })
      return
    }
    syncLog('save:FAIL', { note: 'network' })
    useStore.setState({ saveStatus: 'error', saveError: 'network' })
    // Keep the failed payload unless a newer one already superseded it — never drop edits.
    if (!pendingPayload) pendingPayload = payload
    scheduleFlush(retryDelay(retryAttempt++))
  })
}

// Last chance to persist as the document goes away. Ignores saveInFlight -- that request
// is about to be killed anyway -- and sends the queued payload with keepalive so the
// browser delivers it after the page is gone.
function forceFlushOnUnload(): void {
  syncLog('unload', { note: pendingPayload ? 'pending payload -> sending' : 'nothing pending' })
  if (!pendingPayload) return
  const payload = pendingPayload
  pendingPayload = null
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  void saveCloudState(payload)
}

function persistState(state: AppState, immediate = false): void {
  pendingPayload = buildPersistPayload(state)
  // Don't let a fresh edit reset an in-progress backoff timer into a tight loop; the
  // post-flight flush above already picks up whatever is pending.
  if (saveInFlight) return
  scheduleFlush(immediate ? 0 : SAVE_DEBOUNCE_MS)
}

// A sync's result is expensive to reproduce -- it costs a full round of Jira calls -- and
// waiting out the debounce means a reload in the next 800ms loses all of it. Flush at once.
export function persistNow(state: AppState): void {
  if (cloudSyncReady) persistState(state, true)
}

// Don't lose a pending debounced save when the tab is hidden or closed.
if (typeof window !== 'undefined') {
  const flushIfHidden = () => { if (document.visibilityState === 'hidden') flushPersist() }
  window.addEventListener('visibilitychange', flushIfHidden)
  // On pagehide the document is going away, so a normal fetch is killed mid-flight —
  // saveCloudState uses keepalive for this case so the request still completes.
  //
  // flushPersist() alone was not enough here. A sync writes state repeatedly, so a save is
  // usually still uploading when the page is closed; flushPersist() then returns early and
  // the queued payload -- containing everything the sync just produced -- was never sent.
  // The in-flight request dies with the document, so nothing reached the server and the
  // issues were gone on the next load. Force the pending payload out instead of deferring.
  window.addEventListener('pagehide', () => { markUnloading(); forceFlushOnUnload() })
  // Retry immediately once connectivity returns, instead of waiting out the backoff.
  window.addEventListener('online', () => {
    if (pendingPayload) { retryAttempt = 0; scheduleFlush(0) }
  })
}

interface StoreActions {
  setView: (v: View) => void
  setSelectedDate: (d: string) => void
  setSelectedDev: (id: string) => void
  setSelectedProject: (id: string) => void
  addPrToJira: (taskId: string, issueId: string | undefined, url: string, mrUrl: string) => void

  addDeveloper: (dev: Omit<Developer, 'id'>) => void
  removeDeveloper: (id: string) => void
  updateDeveloper: (id: string, changes: Partial<Omit<Developer, 'id'>>) => void
  setMemberJoinDate: (projId: string, devId: string, date: string | null) => void
  updateDeveloperPeriods: (devId: string, periods: EmploymentPeriod[]) => void
  updateDeveloperSchedule: (devId: string, workSchedule: import('../types').WorkSchedule) => void
  reorderDeveloper: (fromId: string, toId: string) => void
  archiveDeveloper: (id: string, archivedAt: string) => void
  unarchiveDeveloper: (id: string) => void

  addProject: (p: Omit<Project, 'id'>) => void
  updateProject: (id: string, changes: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (id: string) => void
  reorderProject: (fromId: string, toId: string) => void
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
  backfillJiraStatusNames: () => void
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
  // Distinguishes a transient network failure (genuinely retrying) from an expired session
  // (retrying is futile — the user must sign in again or their edits are never saved).
  saveError: 'unauthorized' | 'network' | null

  setReleaseNoteColumns: (cols: ReleaseNoteColumn[]) => void
  setReleaseNoteData: (data: Record<string, ReleaseNoteIssueData>) => void
  updateReleaseNoteIssue: (key: string, patch: Partial<ReleaseNoteIssueData>) => void
}

type Store = AppState & StoreActions

// Guard: don't persist until the initial cloud sync has completed.
// Without this, actions fired before cloud load (e.g. setNotifsEnabled in
// AuthedApp's useEffect) would overwrite cloud with an empty freshState().
let cloudSyncReady = false
// Bumped on every local mutation that gets persisted. A cloud load that started before a
// local change must not overwrite that change when it finally resolves -- the initial load
// of a multi-MB blob easily outlives the startup Jira sync, and applying it afterwards
// reverted everything the sync had just written.
let localRevision = 0

function withSave(state: AppState): AppState {
  // Only count as local work once saves are live. Before the cloud load lands, App runs
  // migrations (migrateIssueIds, deduplicateJiras, autoCarryOverdue, mergeSameDayTasks)
  // against the still-empty startup state; counting those made the staleness check below
  // fire on every single load, so the real cloud data was discarded and the app kept the
  // empty state -- which then got saved over the top of it.
  if (!cloudSyncReady) return state
  localRevision++
  persistState(state)
  return state
}

export const useStore = create<Store>((set, get) => {
  const base = { ...freshState() }

  return {
    ...base,
    cloudSyncing: true,
    saveStatus: 'saved',
    saveError: null,
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
          // Also scrub them from every project's membership and join dates — otherwise a
          // deleted developer lingers as a dangling id that member lookups can't resolve.
          projects: s.projects.map((p) => {
            if (!p.members.includes(id) && !p.joinDates?.[id]) return p
            const joinDates = { ...(p.joinDates ?? {}) }
            delete joinDates[id]
            return { ...p, members: p.members.filter((m) => m !== id), joinDates }
          }),
          selectedDev: s.selectedDev === id ? 'ALL' : s.selectedDev,
        }),
      ),

    updateDeveloper: (id, changes) =>
      set((s) =>
        withSave({
          ...s,
          developers: s.developers.map((d) => (d.id === id ? { ...d, ...changes } : d)),
        }),
      ),

    // date === null clears the join date (member is treated as always on the project).
    setMemberJoinDate: (projId, devId, date) =>
      set((s) =>
        withSave({
          ...s,
          projects: s.projects.map((p) => {
            if (p.id !== projId) return p
            const joinDates = { ...(p.joinDates ?? {}) }
            if (date) joinDates[devId] = date
            else delete joinDates[devId]
            return { ...p, joinDates }
          }),
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

    reorderProject: (fromId, toId) =>
      set((s) => {
        const arr = [...s.projects]
        const fromIdx = arr.findIndex((p) => p.id === fromId)
        const toIdx = arr.findIndex((p) => p.id === toId)
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return s
        const [moved] = arr.splice(fromIdx, 1)
        arr.splice(toIdx, 0, moved!)
        return withSave({ ...s, projects: arr })
      }),

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
            const wasMember = p.members.includes(devId)
            const members = wasMember
              ? p.members.filter((id) => id !== devId)
              : [...p.members, devId]
            // Drop the join date when removing, so re-adding later doesn't silently
            // resurrect a stale date the user never set for the new membership.
            if (wasMember && p.joinDates?.[devId]) {
              const joinDates = { ...p.joinDates }
              delete joinDates[devId]
              return { ...p, members, joinDates }
            }
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

    // Issues synced before jiraStatusName was stored carry only the groupId stamped at the
    // time. Visibility is re-derived from the status NAME, so those issues could never be
    // hidden: marking their status hidden in the integration settings did nothing and they
    // stayed on the board. Where a group has exactly one status mapped to it the name is
    // unambiguous, so fill it in; anything ambiguous is left alone rather than guessed.
    backfillJiraStatusNames: () => {
      const { tasks, jiraConnections } = get()
      if (!tasks.some((t) => t.jiras?.some((j) => !j.jiraStatusName && j.groupId))) return

      // One name per group, per project's connection — only when that group has exactly
      // one status mapped to it.
      const soleStatusByProject = new Map<string, Map<string, string>>()
      for (const c of jiraConnections) {
        const byGroup = new Map<string, string[]>()
        for (const m of c.statusMappings ?? []) {
          const arr = byGroup.get(m.groupId) ?? []
          arr.push(m.jiraStatus)
          byGroup.set(m.groupId, arr)
        }
        const sole = new Map<string, string>()
        byGroup.forEach((names, gid) => { if (names.length === 1) sole.set(gid, names[0]!) })
        soleStatusByProject.set(c.projectId ?? '', sole)
      }

      let changed = false
      const next = tasks.map((t) => {
        if (!t.jiras?.some((j) => !j.jiraStatusName && j.groupId)) return t
        const sole = soleStatusByProject.get(t.projectId ?? '')
        if (!sole?.size) return t
        const jiras = t.jiras.map((j) => {
          if (j.jiraStatusName || !j.groupId) return j
          const name = sole.get(j.groupId)
          if (!name) return j
          changed = true
          return { ...j, jiraStatusName: name }
        })
        return { ...t, jiras }
      })
      if (changed) set((s) => withSave({ ...s, tasks: next }))
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
          // Scope to the project: the same issue key can legitimately appear in two
          // projects, and deduping across them emptied the second project's task, which is
          // then deleted below.
          const k = `${t.projectId ?? ''}:${t.devId}:${t.date}:${identity}`
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
        // Group WITHIN a project. Keying on devId+date alone merged a developer's tasks
        // across projects into one task that kept only the first project's projectId, so
        // the other project's task was deleted and its issues were stranded under the wrong
        // project. This runs on every mount, which is why a developer on two projects lost
        // one of them on every page update while single-project developers were fine.
        const k = `${t.projectId ?? ''}|${t.devId}|${t.date}`
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
      // Only this project's own connection -- never borrow another project's credentials.
      // Both lookups require the connection to belong to THIS project: a stale
      // jiraConnectionId could otherwise point at another project's connection.
      const conn = (proj.jiraConnectionId
        ? jiraConnections.find((c) => c.id === proj.jiraConnectionId && c.enabled && c.projectId === proj.id)
        : undefined)
        ?? jiraConnections.find((c) => c.projectId === proj.id && c.enabled)
      if (!conn) return
      const members = proj.members ?? []
      const emails = [...new Set(developers
        .filter((d) => members.length === 0 || members.includes(d.id))
        .flatMap((d) => identityList(conn.developerEmails?.[d.id])))]
      try {
        const keys = await fetchBoardIssueKeys(conn, proj.jiraBoardId, emails)
        // Never overwrite a good key set with an empty one -- an empty result is far more
        // likely a permissions or API problem than a genuinely empty board.
        if (!keys.length) {
          console.warn('[board] key lookup returned 0 issues — keeping the previous set')
          return
        }
        set((s) => ({ ...s, projects: s.projects.map((p) => p.id === projectId ? { ...p, boardIssueKeys: keys } : p) }))
      } catch { /* keep existing on failure */ }
    },

    syncJira: async () => {
      // Only one Jira sync at a time. Autosync runs on a timer (startup + interval) with no
      // coordination with manual syncs, and a sync reads tasks up front but writes them
      // minutes later, after its network calls. Two overlapping runs therefore had the
      // slower one write its pre-sync snapshot over the fresher one's results -- issues
      // appeared, then vanished on the next sync or reload. Concurrent callers now await
      // the run already in progress instead of starting a competing one.
      if (jiraSyncInFlight) return jiraSyncInFlight
      const run = (async () => {
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

      // Collapse duplicate sync tasks for the same developer and day -- but only WITHIN a
      // project. Keying on devId+date alone merged a developer's tasks across projects and
      // deleted all but one, so a developer on two projects permanently lost one project's
      // issues on the next sync (and after a reload, since the merge is what gets saved).
      const mergedIds = new Set<string>()
      const primarySyncTask = new Map<string, typeof tasksCopy[number]>()
      tasksCopy.forEach((t) => {
        if (!t.jiraSync) return
        const key = `${t.projectId ?? ''}_${t.devId}_${t.date}`
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
        // A developer can hold several Jira identities (separate instances, a renamed
        // account). `emails` carries all of them; `email` is the primary, used where a
        // single value is required (the board API takes one assignee per call).
        const connDevs = developers
          .map((d) => {
            const emails = identityList(conn.developerEmails?.[d.id])
            return { dev: d, emails, email: emails[0] ?? '' }
          })
          .filter((x) => x.emails.length > 0)

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
        for (const { dev, emails } of connDevs) {
          let devIssues: JiraIssueRaw[]
          let truncated = false
          // Merge issues fetched across a developer's identities, keyed by issue key so
          // the same issue found under two accounts appears once.
          const dedupe = (lists: JiraIssueRaw[][]): JiraIssueRaw[] => {
            const seen = new Set<string>()
            return lists.flat().filter((issue) => {
              if (seen.has(issue.key)) return false
              seen.add(issue.key)
              return true
            })
          }
          try {
          if (effectiveBoardId) {
            // Board mode: one board, one assignee per call — so query each identity.
            const perEmail = await Promise.all(
              emails.map((e) =>
                fetchJiraBoardIssues(conn, effectiveBoardId, e).catch(() => ({ issues: [] as JiraIssueRaw[], truncated: false }))
              )
            )
            truncated = perEmail.some((r) => r.truncated)
            devIssues = dedupe(perEmail.map((r) => r.issues))
          } else if (conn.allowedBoardIds?.length) {
            // Project mode with board filter: every allowed board × every identity.
            const perBoard = await Promise.all(
              conn.allowedBoardIds.flatMap((bid) =>
                emails.map((e) =>
                  fetchJiraBoardIssues(conn, bid, e).catch(() => ({ issues: [] as JiraIssueRaw[], truncated: false }))
                )
              )
            )
            truncated = perBoard.some((r) => r.truncated)
            devIssues = dedupe(perBoard.map((r) => r.issues))
          } else {
            const statusFilter = buildJqlStatusFilter(conn.statusMappings)
            // Match every identity by both the full email AND the username (local-part
            // before @) — some Jira instances identify users by username, not email, so
            // `assignee = "email"` alone silently misses those issues.
            const assigneeVals = [...new Set(
              emails.flatMap((e) => [e, e.includes('@') ? e.slice(0, e.indexOf('@')) : e]),
            )].map((v) => `"${v}"`).join(', ')
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
          // Scope to this connection's project. Matching on devId+date alone meant a
          // developer who works on two projects had both projects' issues land on whichever
          // project's task synced first, so the other project showed nothing for them.
          const connProjectId = conn.projectId ?? ''
          const inProject = (t: typeof dedupedTasks[number]) => (t.projectId ?? '') === connProjectId
          const syncTask =
            dedupedTasks.find((t) => t.devId === devId && t.date === today && inProject(t) && t.jiraSync) ??
            dedupedTasks.find((t) => t.devId === devId && t.date === today && inProject(t))

          const incoming = devIssues.map((i) => rawToJiraItem(i, conn.baseUrl, conn.statusMappings, effectiveBoardId))
          const todayTasks = dedupedTasks.filter((t) => t.devId === devId && t.date === today && inProject(t))

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
                syncTask.jiras[existIdx] = { ...ex, boardId: nj.boardId ?? ex.boardId, status: nj.status, groupId: nj.groupId, manualStatus: undefined, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory), storyPoints: nj.storyPoints ?? ex.storyPoints, timeOriginalEstimate: nj.timeOriginalEstimate ?? ex.timeOriginalEstimate, timeSpent: nj.timeSpent ?? ex.timeSpent, jiraCreatedAt: nj.jiraCreatedAt ?? ex.jiraCreatedAt, issueTypeName: nj.issueTypeName ?? ex.issueTypeName, issueTypeIconUrl: nj.issueTypeIconUrl ?? ex.issueTypeIconUrl, parentKey: nj.parentKey ?? ex.parentKey }
                connUpdated++
                return
              }
            }

            if (njKey && njKey !== 'name:' && keyToTask.has(njKey)) {
              const { task, idx } = keyToTask.get(njKey)!
              const ex = task.jiras[idx]
              // Jira is the source of truth on sync — take fresh status, clear manual override.
              task.jiras[idx] = { ...ex, boardId: nj.boardId ?? ex.boardId, status: nj.status, groupId: nj.groupId, manualStatus: undefined, priority: nj.priority, deadline: nj.deadline || ex.deadline, statusHistory: mergeStatusHistory(ex.statusHistory, nj.statusHistory), storyPoints: nj.storyPoints ?? ex.storyPoints, timeOriginalEstimate: nj.timeOriginalEstimate ?? ex.timeOriginalEstimate, timeSpent: nj.timeSpent ?? ex.timeSpent, issueTypeName: nj.issueTypeName ?? ex.issueTypeName, issueTypeIconUrl: nj.issueTypeIconUrl ?? ex.issueTypeIconUrl, parentKey: nj.parentKey ?? ex.parentKey }
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
            // A fetch that SUCCEEDED but returned nothing is not authority to delete. Jira
            // answers with zero issues for all sorts of benign reasons -- a JQL that matched
            // nothing this time, an identity that stopped resolving, a status filter that
            // excluded everything -- and treating that as "the developer has no issues any
            // more" wiped every issue they had. Genuine removals still prune on any sync
            // that returns at least one issue for the developer.
            const returned = returnedKeysByDev.get(t.devId)
            if (!returned || returned.size === 0) return
            // Never prune another project's tasks. A developer on two projects has a task per
            // project, and this connection only knows about its own -- in board mode the check
            // below prunes anything the board didn't return, which would wipe the other
            // project's issues outright.
            if ((t.projectId ?? '') !== (conn.projectId ?? '')) return
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
          .flatMap((d) => identityList(conn.developerEmails?.[d.id])))]
        try {
          const keys = await fetchBoardIssueKeys(conn, proj.jiraBoardId, emails)
          // An empty result would hide every issue in the project on the next render, so
          // keep the previous set rather than trusting it.
          if (keys.length) boardKeyUpdates.set(proj.id, keys)
          else console.warn('[sync] board key lookup returned 0 issues — keeping the previous set')
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
        // dedupedTasks was built from the snapshot taken BEFORE this sync's network calls.
        // Another sync (autosync fires on a timer, with no mutual exclusion) can have
        // written newer tasks in the meantime, so rebuild each task from the CURRENT state
        // and fall back to the snapshot only for tasks that no longer exist. Writing the
        // snapshot verbatim silently reverted the other sync's work, which looked exactly
        // like issues appearing and then disappearing again.
        const liveById = new Map(s.tasks.map((t) => [t.id, t]))
        const merged = dedupedTasks.map((snapshot) => {
          const t = liveById.has(snapshot.id)
            ? { ...liveById.get(snapshot.id)!, jiras: snapshot.jiras, jiraSync: snapshot.jiraSync, deletedJiraUrls: snapshot.deletedJiraUrls }
            : snapshot
          return t
        }).map((t) => {
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
      // Push the sync's result to the server straight away rather than waiting out the
      // 800ms debounce. A reload inside that window used to discard everything the sync had
      // just fetched, which is why issues appeared and then vanished on the next page load.
      syncLog('sync:done', { tasks: get().tasks.length, jiras: countJiras(get().tasks), note: `+${added} ~${updated} -${removed}` })
      persistNow(get())
      return { added, updated, removed }
      })()
      jiraSyncInFlight = run
      try { return await run } finally { jiraSyncInFlight = null }
    },

    setGitlabConnections: (gitlabConnections) => set((s) => withSave({ ...s, gitlabConnections })),

    syncGitlab: async () => {
      // Same overlap hazard as syncJira: reads tasks up front, writes them after its network
      // calls, and autosync runs on a timer alongside manual syncs.
      if (gitlabSyncInFlight) return gitlabSyncInFlight
      const run = (async () => {
      const { gitlabConnections, jiraConnections, tasks, developers, projects } = get()
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

      // Issue-key prefixes PER PROJECT. Pooling every project's keys meant a connection
      // belonging to one project recognised another project's keys in PR/MR titles and
      // linked across the boundary. Each project sees only its own Jira keys and its own
      // tasks' keys.
      // Every Jira key prefix that belongs to THIS project, from three sources so the user
      // never has to maintain the list by hand: a Jira instance can hold many projects and
      // boards with unrelated keys, and a forgotten one would silently stop linking PRs.
      //   1. keys typed into the connection (if any)
      //   2. prefixes discovered from the linked board, straight from Jira
      //   3. prefixes of issues already synced into this project
      // Discovered from Jira, per project, at most once per sync. Covers the case the
      // three static sources miss: a new project with no board resolved and no issues yet.
      const discoveredKeys = new Map<string, string[]>()
      const discoverKeysFor = async (projectId: string): Promise<string[]> => {
        if (discoveredKeys.has(projectId)) return discoveredKeys.get(projectId)!
        const conn = jiraConnections.find(
          (c) => (c.projectId ?? '') === projectId && c.enabled && c.baseUrl && c.token,
        )
        const keys = conn ? await fetchConnectionProjectKeys(conn) : []
        discoveredKeys.set(projectId, keys)
        return keys
      }

      const projectKeysFor = (projectId: string): string[] => {
        const own = jiraConnections.filter((c) => (c.projectId ?? '') === projectId)
        const proj = projects.find((p) => p.id === projectId)
        return [
          ...new Set([
            ...own.flatMap((c) => c.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean)),
            ...(proj?.boardProjectKeys ?? []).map((k) => k.trim().toUpperCase()).filter(Boolean),
            ...tasks
              .filter((t) => (t.projectId ?? '') === projectId)
              .flatMap((t) => t.jiras ?? [])
              .map((j) => jiraDedupeKey(j.url, j.name).match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toUpperCase() ?? '')
              .filter(Boolean),
            ...(discoveredKeys.get(projectId) ?? []),
          ]),
        ]
      }

      const mrById = new Map<number, Awaited<ReturnType<typeof fetchGroupMRs>>[number]>()
      // Which project each MR's connection belongs to. MRs are pooled across connections
      // before they're linked, so without this a connection scoped to one project would
      // attach its MRs to another project's tasks whenever an issue key happened to match.
      const mrProjectId = new Map<number, string>()
      const syncedConns: GitLabConfig[] = []

      for (const conn of enabledConns) {
        // Every identity a developer has — these only widen which MRs get fetched into
        // the shared pool; linking to tasks happens by Jira key, not by username.
        const devUsernames = [...new Set(developers
          .filter((d) => !d.archivedAt)
          .flatMap((d) => identityList(conn.developerUsernames?.[d.id])))]

        try {
          const groupMrs = await fetchGroupMRs(conn)
          for (const m of groupMrs) { mrById.set(m.id, m); mrProjectId.set(m.id, conn.projectId ?? '') }
        } catch (err) {
          const msg = (err as Error).message
          const isPermission = msg.includes('403') || msg.includes('Forbidden') || msg.includes('401')
          if (!isPermission || devUsernames.length === 0) throw err
        }

        if (devUsernames.length > 0) {
          const userMrs = await fetchUserMRs(devUsernames, conn.token)
          for (const m of userMrs) { mrById.set(m.id, m); mrProjectId.set(m.id, conn.projectId ?? '') }
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
        // Only this MR's own project's issue keys — never another project's.
        const mrProj = mrProjectId.get(mr.id) ?? ''
        // Nothing known yet for this project (new, no board, no issues): ask Jira once.
        if (mrProj && !projectKeysFor(mrProj).length) await discoverKeysFor(mrProj)
        const keys = extractJiraKeys(mr, projectKeysFor(mrProj))
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

        // Only link into the project this MR's connection belongs to. Every connection
        // belongs to exactly one project, so an issue key that happens to match in another
        // project must never pull this MR across.
        // An unscoped connection links anywhere instead of matching nothing.
        for (const task of tasks) {
          if (mrProj && (task.projectId ?? '') !== mrProj) continue
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
      })()
      gitlabSyncInFlight = run
      try { return await run } finally { gitlabSyncInFlight = null }
    },

    setGithubConnections: (githubConnections) => set((s) => withSave({ ...s, githubConnections })),

    syncGithub: async () => {
      // Same overlap hazard as syncJira.
      if (githubSyncInFlight) return githubSyncInFlight
      const run = (async () => {
      const { githubConnections, jiraConnections, tasks, developers, projects } = get()
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

      // Issue-key prefixes PER PROJECT. Pooling every project's keys meant a connection
      // belonging to one project recognised another project's keys in PR/MR titles and
      // linked across the boundary. Each project sees only its own Jira keys and its own
      // tasks' keys.
      // Every Jira key prefix that belongs to THIS project, from three sources so the user
      // never has to maintain the list by hand: a Jira instance can hold many projects and
      // boards with unrelated keys, and a forgotten one would silently stop linking PRs.
      //   1. keys typed into the connection (if any)
      //   2. prefixes discovered from the linked board, straight from Jira
      //   3. prefixes of issues already synced into this project
      // Discovered from Jira, per project, at most once per sync. Covers the case the
      // three static sources miss: a new project with no board resolved and no issues yet.
      const discoveredKeys = new Map<string, string[]>()
      const discoverKeysFor = async (projectId: string): Promise<string[]> => {
        if (discoveredKeys.has(projectId)) return discoveredKeys.get(projectId)!
        const conn = jiraConnections.find(
          (c) => (c.projectId ?? '') === projectId && c.enabled && c.baseUrl && c.token,
        )
        const keys = conn ? await fetchConnectionProjectKeys(conn) : []
        discoveredKeys.set(projectId, keys)
        return keys
      }

      const projectKeysFor = (projectId: string): string[] => {
        const own = jiraConnections.filter((c) => (c.projectId ?? '') === projectId)
        const proj = projects.find((p) => p.id === projectId)
        return [
          ...new Set([
            ...own.flatMap((c) => c.projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean)),
            ...(proj?.boardProjectKeys ?? []).map((k) => k.trim().toUpperCase()).filter(Boolean),
            ...tasks
              .filter((t) => (t.projectId ?? '') === projectId)
              .flatMap((t) => t.jiras ?? [])
              .map((j) => jiraDedupeKey(j.url, j.name).match(/^([A-Za-z][A-Za-z0-9]+)-\d+$/)?.[1]?.toUpperCase() ?? '')
              .filter(Boolean),
            ...(discoveredKeys.get(projectId) ?? []),
          ]),
        ]
      }

      const prById = new Map<number, Awaited<ReturnType<typeof fetchOrgPRs>>[number]>()
      // Which project each PR's connection belongs to — PRs are pooled across connections
      // before linking, so this keeps one project's PRs off another project's tasks.
      const prProjectId = new Map<number, string>()
      const syncedConns: GitHubConfig[] = []

      for (const conn of enabledConns) {
        // Every identity a developer has — these only widen which PRs get fetched into
        // the shared pool; linking to tasks happens by Jira key, not by username.
        const devUsernames = [...new Set(developers
          .filter((d) => !d.archivedAt)
          .flatMap((d) => identityList(conn.developerUsernames?.[d.id])))]

        if (conn.orgOrUser.trim()) {
          try {
            const orgPRs = await fetchOrgPRs(conn.orgOrUser, conn.token)
            for (const p of orgPRs) { prById.set(p.id, p); prProjectId.set(p.id, conn.projectId ?? '') }
          } catch (err) {
            const msg = (err as Error).message
            const isPermission = msg.includes('403') || msg.includes('Forbidden') || msg.includes('401')
            if (!isPermission || devUsernames.length === 0) throw err
          }
        }

        if (devUsernames.length > 0) {
          const ownerScope = conn.orgOrUser.trim() ? normalizeGithubPath(conn.orgOrUser).owner : ''
          const userPRs = await Promise.all(devUsernames.map((u) => fetchUserPRs(u, conn.token, ownerScope)))
          for (const prs of userPRs) for (const p of prs) { prById.set(p.id, p); prProjectId.set(p.id, conn.projectId ?? '') }
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
        // Only this PR's own project's issue keys — never another project's.
        const prProj = prProjectId.get(pr.id) ?? ''
        // Nothing known yet for this project (new, no board, no issues): ask Jira once.
        if (prProj && !projectKeysFor(prProj).length) await discoverKeysFor(prProj)
        const keys = extractGithubJiraKeys(pr, projectKeysFor(prProj))
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

        // Only link into this PR's own project. Every connection belongs to one project.
        // A connection saved before projectId became mandatory has none. Treat that as
        // "not scoped" and let it link anywhere, rather than comparing against '' and
        // matching no task at all -- which made those connections' PRs vanish completely.
        for (const task of tasks) {
          if (prProj && (task.projectId ?? '') !== prProj) continue
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
      })()
      githubSyncInFlight = run
      try { return await run } finally { githubSyncInFlight = null }
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
      const res = await saveCloudState({
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
      return res.ok
    },
  }
})

function applyCloudState(cloud: Record<string, unknown> | null, startedAtRevision?: number) {
  const incoming = (cloud?.tasks as AppState['tasks'] | undefined)
  syncLog('load', {
    tasks: incoming?.length,
    jiras: incoming ? countJiras(incoming) : undefined,
    note: cloud === null ? 'null (unauthenticated / no data)' : undefined,
  })
  // Local work happened while this load was in flight (typically the startup Jira sync).
  // The response is already stale, so applying it would silently revert that work.
  if (startedAtRevision !== undefined && localRevision !== startedAtRevision) {
    if (cloud !== null) cloudSyncReady = true
    useStore.setState({ cloudSyncing: false })
    console.warn('[cloud] discarding a stale load — local changes happened while it was in flight')
    return
  }
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
    const startedAt = localRevision
    const cloud = await loadCloudState()
    // After login the user is authenticated — safe to enable saves even if cloud is empty.
    cloudSyncReady = true
    applyCloudState(cloud, startedAt)
  } catch {
    cloudSyncReady = true
    useStore.setState({ cloudSyncing: false })
  }
}

{
  const startedAt = localRevision
  loadCloudState().then((cloud) => applyCloudState(cloud, startedAt)).catch(() => {
    useStore.setState({ cloudSyncing: false })
  })
}

// Debug helper: expose the store + a one-shot issue tracer on window so issue-visibility
// problems can be diagnosed without reaching into React internals. Safe, read-only.
if (typeof window !== 'undefined') {
  ;(window as any).pmStore = useStore
  // Why is an issue still on the daily board? Shows the connection, the mapping it
  // resolved through, and whether its group counts as closed.
  ;(window as any).pmVisible = (needle?: string) => {
    const rows = ((window as never as Record<string, unknown[]>).__pmShown ?? []) as Array<Record<string, unknown>>
    const seen = new Map<string, Record<string, unknown>>()
    for (const r of rows) seen.set(String(r.key), r)
    const out = [...seen.values()].filter((r) => !needle || String(r.key).toLowerCase().includes(needle.toLowerCase()))
    console.table(out)
    return out
  }
  // Paste the output of pmLog() to see exactly what the save/load layer did, including
  // across reloads. pmLog(true) clears it.
  ;(window as any).pmLog = (clear?: boolean) => {
    if (clear) { localStorage.removeItem('pm_sync_log'); return 'cleared' }
    const rows = JSON.parse(localStorage.getItem('pm_sync_log') ?? '[]')
    console.table(rows)
    return rows
  }
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

/*
 * Had this developer joined the project by `dateStr`? A member with no recorded join date
 * counts as always having been on the project, so adding this feature can't retroactively
 * blank out history for anyone whose date hasn't been filled in yet.
 *
 * With no project selected ('ALL') the earliest join date across the dev's projects is
 * used — otherwise a dev on two projects would look un-joined whenever the view isn't
 * scoped to the project they started on first.
 */
export function joinedByDate(
  projects: Project[],
  selectedProject: string,
  devId: string,
  dateStr: string,
): boolean {
  const relevant = selectedProject === 'ALL'
    ? projects.filter((p) => p.members.includes(devId))
    : projects.filter((p) => p.id === selectedProject)

  if (relevant.length === 0) return true

  /*
   * Joined if ANY relevant project says so. A membership with no date counts as "always",
   * so a dev on one dated and one undated project is never hidden by the dated one.
   */
  return relevant.some((p) => {
    const d = p.joinDates?.[devId]
    return !d || dateStr >= d
  })
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
  // An EMPTY key set means the board lookup came back with nothing -- a token that can't
  // read the board, a stale board id, a transient API failure. Treating that as the
  // authoritative membership list hides every issue in the project, which looked like the
  // tracker had lost them. Fall back to the coarser filters instead.
  if (proj.boardIssueKeys.length === 0) return undefined
  return new Set(proj.boardIssueKeys.map((k) => k.trim().toUpperCase()))
}

export function taskMatchesBoard(t: Task, boardId: number): boolean {
  return (t.jiras ?? []).some((j) => j.boardId === boardId)
}

// The Jira connection that owns the status-group mappings used for display.
export function getActiveJiraConn(state: AppState): JiraConfig | undefined {
  // A connection is usable for display if it defines EITHER mappings or groups. Requiring
  // mappings meant a connection that only had groups configured was never found, so
  // issueShowsOnBoard received no connection at all and nothing could be hidden or closed
  // however the integration settings looked.
  const usable = (c: JiraConfig) => c.enabled && (!!c.statusMappings?.length || !!c.statusGroups?.length)
  // Scope to the selected project. Connections are per-project, so taking the first usable
  // one meant every project was rendered with whichever connection happened to sit first in
  // the array: its own project looked right, while the others had their issues resolved
  // against a different Jira's mappings. Statuses that other instance doesn't define matched
  // nothing and fell back to 'todo', so a whole project displayed as To Do.
  if (state.selectedProject && state.selectedProject !== 'ALL') {
    // A project uses its own connection or none at all. There is no global connection to
    // fall back to, and another project's must never be borrowed.
    return state.jiraConnections.find((c) => c.projectId === state.selectedProject && usable(c))
  }
  // "All projects" spans every project, so no single connection owns the view; use the
  // first usable one purely so status groups still render.
  return state.jiraConnections.find(usable)
}

// Single source of truth for board visibility, shared by Daily AND Deadlines.
// An issue shows on the board unless its status group is 'hidden' or marked isClosed
// (per the integration settings). Falls back to legacy status for issues with no group.
export function issueShowsOnBoard(j: JiraIssue, conn: JiraConfig | undefined): boolean {
  // Re-derive the group from the issue's raw Jira status instead of trusting the groupId
  // stamped at sync time. That snapshot freezes whatever the mappings said when the issue
  // was fetched, so an issue synced while a status was hidden stayed invisible for good --
  // changing the status back to visible had no effect until it was re-synced.
  const gid = (j.jiraStatusName && conn?.statusMappings?.length)
    ? (groupForJiraStatus(j.jiraStatusName, conn.statusMappings) ?? j.groupId)
    : j.groupId
  if (gid === 'hidden') return false
  // isClosedGroup resolves the id against the saved groups COMPLETED WITH THE DEFAULTS, so
  // an id the saved set happens not to contain still finds a real group. An earlier guard
  // here returned early for exactly that case and short-circuited the closed check, which
  // meant a group the user had marked closed kept showing its issues.
  if (gid ? isClosedGroup(gid, conn) : j.status === 'done') return false
  // No group at all: an issue synced before groups existed carries only the legacy status.
  // Map that to the group it corresponds to so the closed setting still applies -- without
  // this these issues could never be removed from the board by any configuration.
  if (!gid && conn?.statusGroups?.length) {
    const legacy = legacyStatusToGroupId(j.status)

    if (isClosedGroup(legacy, conn)) return false
  }
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
  //
  // The connection must be resolved per TASK's project, not once for the whole view. Daily
  // can show tasks from several projects at once (All projects, or a developer working on
  // more than one), and judging every issue against a single connection meant a status
  // hidden in its own project was not hidden here -- the other project's mappings simply
  // don't contain that status name, so nothing matched and the issue stayed visible.
  const connByProject = new Map<string, JiraConfig | undefined>()
  const connFor = (projectId: string | undefined): JiraConfig | undefined => {
    const key = projectId ?? ''
    if (!connByProject.has(key)) {
      connByProject.set(key, state.jiraConnections.find(
        (c) => c.enabled && (!!c.statusMappings?.length || !!c.statusGroups?.length) && (c.projectId ?? '') === key,
      ) ?? getActiveJiraConn(state))
    }
    return connByProject.get(key)
  }
  const showsOnBoard = (j: JiraIssue, projectId?: string): boolean => {
    const conn = connFor(projectId)
    const shown = issueShowsOnBoard(j, conn)
    // Record WHY each issue was kept, so a "this should be hidden" report can be answered
    // from the app instead of guessing. Read it with pmVisible() in the console.
    if (typeof window !== 'undefined' && shown) {
      const gid = (j.jiraStatusName && conn?.statusMappings?.length)
        ? groupForJiraStatus(j.jiraStatusName, conn.statusMappings)
        : undefined
      ;((window as never as Record<string, unknown[]>).__pmShown ??= []).push({
        key: j.issueId ?? j.name,
        jiraStatusName: j.jiraStatusName ?? '(none)',
        stampedGroupId: j.groupId ?? '(none)',
        resolvedGroupId: gid ?? '(unresolved)',
        connUsed: conn?.name ?? '(no connection)',
        connProjectId: conn?.projectId ?? '(none)',
        taskProjectId: projectId ?? '(none)',
        groupIsClosed: isClosedGroup(gid ?? j.groupId, conn),
        savedGroupIds: (conn?.statusGroups ?? []).map((g) => `${g.id}=${g.label}${g.isClosed ? '(CLOSED)' : ''}`).join(' | ') || '(none)',
        mappingFor: (conn?.statusMappings ?? []).find((m) => m.jiraStatus === j.jiraStatusName)?.groupId ?? '(no mapping)',
      })
    }
    return shown
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
          else if (!showsOnBoard(j, t.projectId)) dbgCount.droppedShows.push(`${jiraFullKey(j) ?? j.name}[grp=${j.groupId ?? j.status}]`)
        })
      }
      const freshJiras = t.jiras
        .filter(jiraBelongsToBoard)
        .filter((j) => showsOnBoard(j, t.projectId))
        .filter((j) => {
          const dk = jiraDedupeKey(j.url, j.name)
          const identity = dk && dk !== 'name:' ? dk : j.issueId
          if (!identity) return true
          // Key on project AND date as well. Without them the first task to carry an
          // issue won, and the same issue on a later date -- or in the other project --
          // was silently dropped from the board entirely.
          const k = `${t.projectId ?? ''}:${t.devId}:${t.date}:${identity}`
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
