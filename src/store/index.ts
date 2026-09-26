import { create } from 'zustand'
import type { AppState, Developer, Project, Sprint, Task, Note, JiraIssue, JiraConfig, GitLabConfig, GitHubConfig, View, EmploymentPeriod, PrEntry, ReleaseNoteColumn, ReleaseNoteIssueData } from '../types'
import { commitRecords, commitRecordsOnUnload, getServerSyncStatus, loadRecords, markRestored, markUnloading, runServerSync, type RecordsResponse, type ServerSyncStatus, type SyncKind } from '../utils/cloud-api'
import { cloudToState, DOC_KEYS, normalizeTask, RecordTracker, recordsToCloud, type PersistedState } from '../sync-core/records'
import { listVault, removeFromVault, storeInVault, type Credentialed } from '../utils/credentials'
import { reportError } from '../utils/error-reporter'
import { todayStr, nextWorkDay, prevWorkDay, latestWorkday } from '../utils/dates'
import { getJiras, identityList, jiraDedupeKey } from '../utils/format'
import { fetchBoardIssueKeys } from '../utils/jira-api'
import { browserTransport } from '../utils/browser-transport'
import { applyJiraSync, computeJiraSync } from '../sync-core/jira-sync'
import { makeId, sortJiraIssues } from '../sync-core/util'
import { applyGithubSync, applyGitlabSync, computeGithubSync, computeGitlabSync } from '../sync-core/pr-sync'
import { resolveTrackerTz } from '../utils/working-hours'
import { groupForJiraStatus, isClosedGroup, legacyStatusToGroupId, repointOrphanMappings } from '../sync-core/status-groups'


function makeJiraMatcher(issueId: string | undefined, url: string) {
  return (j: JiraIssue) => (issueId ? j.issueId === issueId : !!url && j.url === url)
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

function persistedSlice(state: AppState): PersistedState {
  const slice: Record<string, unknown> = { tasks: state.tasks }
  for (const key of DOC_KEYS) slice[key] = state[key]
  return slice as PersistedState
}

/*
 * Cloud saves (backend ADR-0018). The server stores each task and each settings section as
 * its own record with a revision; `records` remembers the revision and value this tab last
 * confirmed for each. A save sends only what differs, and the server refuses any write
 * made from an out-of-date revision, handing back its copy to merge. So a stale tab or a
 * second device can no longer overwrite newer data -- the cause of issues vanishing after
 * reloads -- and a save is the size of the change, not of everything.
 *
 * Rapid mutations (typing) still collapse into one save via the debounce.
 */
const records = new RecordTracker()
// Something changed since the last save was assembled.
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
// background: an automatic sync (startup or interval) rather than one the user asked for.
// Background syncs skip when another tab is already syncing and may be incremental;
// manual ones wait their turn and are always full.
export interface SyncOptions { background?: boolean }


/*
 * One sync at a time across ALL open tabs, not just within one. Each tab ran its own
 * autosync, so two tabs meant every sync twice: double the Jira traffic and two competing
 * saves. Uses the Web Locks API; background syncs skip if another tab holds the lock,
 * manual ones wait for it. Browsers without Web Locks just run.
 */
async function withTabLock<T>(name: string, background: boolean, run: () => Promise<T>, skipped: T): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return run()
  if (background) return locks.request(name, { ifAvailable: true }, (lock) => (lock ? run() : skipped))
  return locks.request(name, run)
}

// The Jira sync currently running, if any — see syncJira for why overlap is destructive.
let jiraSyncInFlight: Promise<{ added: number; updated: number; removed: number }> | null = null
let gitlabSyncInFlight: Promise<{ linked: number; updated: number; noKey: number; noIssue: number; noKeyList: string[]; noIssueList: string[] }> | null = null
let githubSyncInFlight: Promise<{ linked: number; updated: number }> | null = null
// One save request at a time: each is computed against the bases the previous one moved
// forward, and edits made meanwhile are picked up by the next.
let saveInFlight = false
let pullInFlight = false
let retryAttempt = 0
const SAVE_DEBOUNCE_MS = 800
const SAVE_RETRY_BASE_MS = 2000
const SAVE_RETRY_MAX_MS = 60_000

// Exponential backoff with jitter, so a struggling backend is not hammered.
function retryDelay(attempt: number): number {
  const exp = Math.min(SAVE_RETRY_BASE_MS * 2 ** attempt, SAVE_RETRY_MAX_MS)
  return exp / 2 + Math.random() * (exp / 2)
}

function scheduleFlush(ms: number): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; flushPersist() }, ms)
}

function flushPersist(): void {
  if (!dirty || !records.ready) return
  // Leave it marked dirty: whatever is pending when the current request ends goes next.
  if (saveInFlight || pullInFlight) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  dirty = false
  const batch = records.collect(persistedSlice(useStore.getState()))
  if (!batch) {
    useStore.setState({ saveStatus: 'saved', saveError: null })
    return
  }
  saveInFlight = true
  syncLog('save:start', { tasks: batch.body.tasks.length, note: `docs ${batch.body.docs.length}, deletes ${batch.body.deletes.length}` })
  useStore.setState({ saveStatus: 'saving' })
  void commitRecords(batch.body).then((res) => {
    saveInFlight = false
    if (res.ok) {
      const out = records.apply(batch, res.result, persistedSlice(useStore.getState()))
      // A reply that answered for none of the records would have this loop resend them
      // forever at full speed. Treat it as a failed save and back off instead.
      if (out.answered === 0) {
        dirty = true
        syncLog('save:FAIL', { note: 'empty reply' })
        useStore.setState({ saveStatus: 'error', saveError: 'server' })
        reportError({ kind: 'save', message: 'Cloud save answered for none of the records sent' })
        scheduleFlush(retryDelay(retryAttempt++))
        return
      }
      retryAttempt = 0
      if (out.patch) useStore.setState(out.patch)
      syncLog('save:ok', out.conflicts ? { note: `${out.conflicts} merged with newer saves` } : {})
      // The server refused these as unstorable; retrying cannot help, so record why.
      if (out.rejected.length) {
        reportError({ kind: 'save', message: `Records refused by the server: ${out.rejected.slice(0, 5).join(', ')}` })
      }
      // Another round: more records than one request holds, merges to send, or edits
      // made while this one was uploading. It ends with 'saved' once nothing differs.
      dirty = true
      scheduleFlush(0)
      return
    }
    dirty = true
    // Session expired: retrying is pointless and pretending to retry is how edits get lost.
    if (res.reason === 'unauthorized') {
      syncLog('save:FAIL', { note: 'unauthorized' })
      useStore.setState({ saveStatus: 'error', saveError: 'unauthorized' })
      return
    }
    syncLog('save:FAIL', { note: res.reason })
    useStore.setState({ saveStatus: 'error', saveError: res.reason })
    // A request refused as too large fails the same way every time: back off to the maximum.
    if (res.reason === 'tooLarge') retryAttempt = Math.max(retryAttempt, 10)
    // The server answered but refused the save: record it. A network failure is not
    // reported -- if the server is unreachable, the report could not arrive either.
    if (res.reason !== 'network') reportError({ kind: 'save', message: `Cloud save rejected: ${res.reason}` })
    scheduleFlush(retryDelay(retryAttempt++))
  })
}

/*
 * Bring in what other tabs and devices have saved since this tab last looked. Records this
 * tab has not touched are replaced; ones it has edited are merged and the result saved.
 * Runs when the tab regains focus, every minute while visible, and before each sync.
 */
export async function pullRemoteChanges(): Promise<void> {
  if (!cloudSyncReady || !records.ready || saveInFlight || pullInFlight) return
  pullInFlight = true
  let merged = false
  try {
    const res = await loadRecords(records.cursor)
    if (!res) return
    const patch = records.pull(res, persistedSlice(useStore.getState()))
    if (patch) {
      useStore.setState(patch)
      merged = true
      syncLog('pull', { tasks: res.tasks.length, note: `docs ${res.docs.length}, deleted ${res.deleted.length}` })
    }
  } catch {
    // Offline or a server hiccup: the next focus or minute tries again.
  } finally {
    pullInFlight = false
    // A merge may need saving, and a save held back while this ran must go now.
    if (merged || dirty) { dirty = true; scheduleFlush(0) }
  }
}

// Last chance to save as the document goes away: send whatever differs, as a keepalive
// request the browser delivers after the page is gone. The in-flight one dies anyway.
function forceFlushOnUnload(): void {
  const batch = records.ready ? records.collect(persistedSlice(useStore.getState())) : null
  syncLog('unload', { note: batch ? `sending ${batch.size} records` : 'nothing pending' })
  if (!batch) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  commitRecordsOnUnload(batch.body)
}

function persistState(immediate = false): void {
  dirty = true
  // Don't let a fresh edit reset an in-progress backoff timer into a tight loop; the
  // post-flight flush already picks up whatever is pending.
  if (saveInFlight) return
  scheduleFlush(immediate ? 0 : SAVE_DEBOUNCE_MS)
}

// A sync's result is expensive to reproduce -- it costs a full round of Jira calls -- and
// waiting out the debounce means a reload in the next 800ms loses all of it. Save at once.
export function persistNow(_state?: AppState): void {
  if (cloudSyncReady) persistState(true)
}

const PULL_EVERY_MS = 60_000

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    // Hidden: save now. Visible again: catch up with what other tabs saved meanwhile.
    if (document.visibilityState === 'hidden') flushPersist()
    else void pullRemoteChanges()
  })
  window.addEventListener('focus', () => { void pullRemoteChanges() })
  setInterval(() => {
    if (document.visibilityState === 'visible') void pullRemoteChanges()
  }, PULL_EVERY_MS)
  // On pagehide the document is going away, so a normal fetch is killed mid-flight.
  // A sync writes state repeatedly, so a save is usually still uploading when the page
  // closes; waiting for it would lose everything queued behind it. Send it now instead.
  window.addEventListener('pagehide', () => { markUnloading(); forceFlushOnUnload() })
  // Coming back from the back/forward cache (switching apps on a phone does this): the
  // page is alive again, so saves must behave normally rather than stay in unload mode.
  window.addEventListener('pageshow', (e) => { if (e.persisted) markRestored() })
  // Retry immediately once connectivity returns, instead of waiting out the backoff.
  window.addEventListener('online', () => {
    if (dirty) { retryAttempt = 0; scheduleFlush(0) }
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
  moveTokensToVault: () => Promise<number>
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
  syncJira: (opts?: SyncOptions) => Promise<{ added: number; updated: number; removed: number }>
  refreshBoardIssueKeys: (projectId: string) => Promise<void>
  setGitlabConnections: (connections: GitLabConfig[]) => void
  syncGitlab: (opts?: SyncOptions) => Promise<{ linked: number; updated: number; noKey: number; noIssue: number; noKeyList: string[]; noIssueList: string[] }>
  setGithubConnections: (connections: GitHubConfig[]) => void
  syncGithub: (opts?: SyncOptions) => Promise<{ linked: number; updated: number }>
  exportJSON: () => void
  importJSON: (json: string) => Promise<boolean>
  setHighlightedTaskId: (id: string | null) => void
  setHighlightedNoteId: (id: string | null) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  cloudSyncing: boolean
  // The initial load failed and is being retried.
  cloudLoadFailed: boolean
  // Set once the server reports it runs syncs itself (backend ADR-0019); null otherwise.
  serverSync: ServerSyncStatus | null
  saveStatus: 'saved' | 'saving' | 'error'
  // Distinguishes a transient network failure (genuinely retrying) from an expired session
  // (retrying is futile — the user must sign in again or their edits are never saved).
  saveError: 'unauthorized' | 'network' | 'tooLarge' | 'server' | null

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
  persistState()
  return state
}

export const useStore = create<Store>((set, get) => {
  const base = { ...freshState() }

  return {
    ...base,
    cloudSyncing: true,
    cloudLoadFailed: false,
    serverSync: null,
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

    /*
     * Move any integration token still held in the browser into the server's encrypted
     * vault. A token is cleared locally only after the server confirms it stored it, so a
     * failed upload never loses a credential; with the vault off (no key configured on the
     * server) nothing changes and this is retried on the next load. Returns how many moved.
     */
    moveTokensToVault: async () => {
      const listing = await listVault()
      if (!listing?.available) return 0

      const moved = new Map<string, string>() // connection id -> the token uploaded
      const upload = async (conns: Credentialed[], provider: 'jira' | 'github' | 'gitlab') => {
        for (const c of conns) {
          const token = c.token?.trim()
          if (!token) continue
          if (await storeInVault(c.id, provider, token)) moved.set(c.id, token)
        }
      }
      const { jiraConnections, githubConnections, gitlabConnections } = get()
      await upload(jiraConnections, 'jira')
      await upload(githubConnections, 'github')
      await upload(gitlabConnections, 'gitlab')
      if (!moved.size) return 0

      // Clear only what was uploaded, and only if it hasn't been edited meanwhile: a token
      // typed while the upload was in flight must survive to be uploaded next time.
      const clear = <T extends Credentialed>(conns: T[]): T[] =>
        conns.map((c) => (moved.get(c.id) === c.token?.trim() ? { ...c, token: '', tokenInVault: true } : c))
      set((s) => withSave({
        ...s,
        jiraConnections: clear(s.jiraConnections),
        githubConnections: clear(s.githubConnections),
        gitlabConnections: clear(s.gitlabConnections),
      }))
      return moved.size
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

    setJiraConnections: (jiraConnections) => set((s) => withSave({ ...s, jiraConnections: jiraConnections.map(repointOrphanMappings) })),

    // Resolve a single scrum project's exact board issue keys from Jira, on demand
    // (e.g. right after selecting a board). Keeps board-scoped views accurate without a sync.
    refreshBoardIssueKeys: async (projectId: string) => {
      const { projects, jiraConnections, developers } = get()
      const proj = projects.find((p) => p.id === projectId)
      if (!proj || proj.mode !== 'scrum' || !proj.jiraBoardId) return
      // Only this project's own connection -- never borrow another project's credentials.
      // Both lookups require the connection to belong to THIS project: a stale
      // jiraConnectionId could otherwise point at another project's connection.
      const conn = jiraConnectionForProject(jiraConnections, proj.id, proj.jiraConnectionId)
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

    syncJira: async (opts) => {
      // Only one Jira sync at a time. Autosync runs on a timer (startup + interval) with no
      // coordination with manual syncs, and a sync reads tasks up front but writes them
      // minutes later, after its network calls. Two overlapping runs therefore had the
      // slower one write its pre-sync snapshot over the fresher one's results -- issues
      // appeared, then vanished on the next sync or reload. Concurrent callers now await
      // the run already in progress instead of starting a competing one.
      if (jiraSyncInFlight) return jiraSyncInFlight
      const run = withTabLock('pm-sync-jira', !!opts?.background, async () => {
      // The server runs background syncs itself; asked-for ones run there when it can.
      if (opts?.background && get().serverSync?.serverSync) return { added: 0, updated: 0, removed: 0 }
      if (!opts?.background) {
        const onServer = await syncOnServer('jira', 'Jira')
        if (onServer) return { ...{ added: 0, updated: 0, removed: 0 }, ...onServer }
      }
      // Start from what other tabs have saved, so this sync builds on current data.
      await pullRemoteChanges()
      const plan = await computeJiraSync(get(), browserTransport, { background: !!opts?.background, today: latestWorkday(), tz: resolveTrackerTz() })
      const { added, updated, removed } = plan.counts
      set((s) => withSave({ ...s, ...applyJiraSync(s, plan) }))
      // Push the sync's result to the server straight away rather than waiting out the
      // 800ms debounce. A reload inside that window used to discard everything the sync had
      // just fetched, which is why issues appeared and then vanished on the next page load.
      syncLog('sync:done', { tasks: get().tasks.length, jiras: countJiras(get().tasks), note: `+${added} ~${updated} -${removed}` })
      persistNow(get())
      return { added, updated, removed }
      }, { added: 0, updated: 0, removed: 0 })
      jiraSyncInFlight = run
      try { return await run } finally { jiraSyncInFlight = null }
    },

    setGitlabConnections: (gitlabConnections) => set((s) => withSave({ ...s, gitlabConnections })),

    syncGitlab: async (opts) => {
      // Same overlap hazard as syncJira: reads tasks up front, writes them after its network
      // calls, and autosync runs on a timer alongside manual syncs.
      if (gitlabSyncInFlight) return gitlabSyncInFlight
      const run = withTabLock('pm-sync-gitlab', !!opts?.background, async () => {
      // The server runs background syncs itself; asked-for ones run there when it can.
      if (opts?.background && get().serverSync?.serverSync) return { linked: 0, updated: 0, noKey: 0, noIssue: 0, noKeyList: [], noIssueList: [] }
      if (!opts?.background) {
        const onServer = await syncOnServer('gitlab', 'GitLab')
        if (onServer) return { ...{ linked: 0, updated: 0, noKey: 0, noIssue: 0, noKeyList: [], noIssueList: [] }, ...onServer }
      }
      // Start from what other tabs have saved, so this sync builds on current data.
      await pullRemoteChanges()
      const plan = await computeGitlabSync(get(), browserTransport, { background: !!opts?.background, today: latestWorkday(), tz: resolveTrackerTz() })
      set((s) => withSave({ ...s, ...applyGitlabSync(s, plan) }))

      return plan.counts
      }, { linked: 0, updated: 0, noKey: 0, noIssue: 0, noKeyList: [], noIssueList: [] })
      gitlabSyncInFlight = run
      try { return await run } finally { gitlabSyncInFlight = null }
    },

    setGithubConnections: (githubConnections) => set((s) => withSave({ ...s, githubConnections })),

    syncGithub: async (opts) => {
      // Same overlap hazard as syncJira.
      if (githubSyncInFlight) return githubSyncInFlight
      const run = withTabLock('pm-sync-github', !!opts?.background, async () => {
      // The server runs background syncs itself; asked-for ones run there when it can.
      if (opts?.background && get().serverSync?.serverSync) return { linked: 0, updated: 0 }
      if (!opts?.background) {
        const onServer = await syncOnServer('github', 'GitHub')
        if (onServer) return { ...{ linked: 0, updated: 0 }, ...onServer }
      }
      // Start from what other tabs have saved, so this sync builds on current data.
      await pullRemoteChanges()
      const plan = await computeGithubSync(get(), browserTransport, { background: !!opts?.background, today: latestWorkday(), tz: resolveTrackerTz() })
      set((s) => withSave({ ...s, ...applyGithubSync(s, plan) }))

      return plan.counts
      }, { linked: 0, updated: 0 })
      githubSyncInFlight = run
      try { return await run } finally { githubSyncInFlight = null }
    },

    /*
     * The menu calls this "Backup -- download all data", and Restore replaces everything
     * with it, so it must carry everything that is saved. Notes and sprints used to be
     * left out, which meant restoring a backup silently deleted every note and sprint.
     * Integration tokens are deliberately NOT here: they live in the server's vault.
     */
    exportJSON: () => {
      const state = get()
      const payload: Record<string, unknown> = { _v: 3, exportedAt: new Date().toISOString() }
      for (const key of DOC_KEYS) payload[key] = state[key]
      payload.tasks = state.tasks
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `progressor-${todayStr()}.json`
      a.click()
    },

    importJSON: async (json) => {
      const d = JSON.parse(json) as Partial<AppState> & { _v?: number }
      if (!d.developers || !d.tasks) throw new Error('Invalid backup file')
      const s = get()
      const next: AppState = {
        ...s,
        // Everything the file carries, shaped the way a cloud load shapes it. A key the
        // file does not have keeps its current value rather than being blanked.
        ...cloudToState(d as Record<string, unknown>),
        developers: d.developers.map((dev) => ({ periods: [], ...dev })),
        tasks: d.tasks.map(normalizeTask),
        selectedDev: 'ALL',
        selectedProject: 'ALL',
      }
      set(next)
      // The import replaces everything: the next saves write each record and delete what
      // the backup does not contain. Wait until they have all gone through.
      return saveEverythingNow()
    },
  }
})

function applyRecords(res: RecordsResponse | null, startedAtRevision?: number) {
  syncLog('load', {
    tasks: res?.tasks.length,
    jiras: res ? countJiras(res.tasks.map((t) => t.data as unknown as Task)) : undefined,
    note: res === null ? 'null (unauthenticated / unreachable)' : undefined,
  })
  // Only mark ready when we actually received data. A null response means signed out or
  // unreachable -- saving then would treat the empty startup state as the user's data.
  if (res === null) {
    useStore.setState({ cloudSyncing: false, cloudLoadFailed: false })
    return
  }
  const next = cloudToState(recordsToCloud(res))
  records.reset(res, next)
  cloudSyncReady = true
  // Local work happened while this load was in flight. Applying the load as-is would
  // revert it, so merge instead: nothing from either side is lost or deleted.
  if (startedAtRevision !== undefined && localRevision !== startedAtRevision) {
    const patch = records.adoptStale(next, persistedSlice(useStore.getState()))
    useStore.setState({ ...(patch ?? {}), cloudSyncing: false, cloudLoadFailed: false })
    console.warn('[cloud] a load finished after local changes; merged rather than replaced')
    persistState(true)
    return
  }
  // The timezone this browser saved last: kept as the baseline so an unchanged zone is not re-saved.
  const savedZone = res.docs.find((d) => d.key === 'browserTimezone')?.data
  useStore.setState({ ...next, browserTimezone: typeof savedZone === 'string' ? savedZone : undefined, cloudSyncing: false, cloudLoadFailed: false })
  records.adoptView(persistedSlice(useStore.getState()))
  // The server-side sync needs the user's zone to know what "today" is (ADR-0019).
  if (savedZone !== browserZone()) {
    useStore.setState({ browserTimezone: browserZone() })
    persistState()
  }
  void getServerSyncStatus().then((serverSync) => {
    useStore.setState({ serverSync })
    markServerSyncKnown()
  })
}

let markServerSyncKnown: () => void = () => {}
// Resolves once the app knows whether the server runs syncs, so background syncs can wait for it.
export const serverSyncKnown = new Promise<void>((resolve) => { markServerSyncKnown = resolve })

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/*
 * A sync the user asked for runs on the server when the server runs syncs (ADR-0019), so
 * every device sees one result and the browser does no provider traffic. Returns null
 * when it could not run there -- the caller then syncs in the browser as before.
 */
async function syncOnServer(kind: SyncKind, label: string): Promise<Record<string, unknown> | null> {
  if (!useStore.getState().serverSync?.serverSync) return null
  // The server syncs from saved records: a connection added or edited a moment ago must
  // reach it first.
  if (!(await saveEverythingNow())) return null
  const outcome = await runServerSync([kind], browserZone())
  if (!outcome) return null
  await pullWhenIdle()
  syncLog('sync:server', { note: `${kind} ${JSON.stringify(outcome.results[kind] ?? outcome.errors)}` })
  const failure = outcome.errors.find((e) => e.kind === kind)
  if (failure) throw new Error(failure.message)
  const result = outcome.results[kind]
  if (!result) throw new Error(`No ${label} connections configured`)
  return result
}

// Pull as soon as no save or pull is running, so a server result shows at once.
async function pullWhenIdle(): Promise<void> {
  for (let i = 0; i < 100 && (saveInFlight || pullInFlight); i++) {
    await new Promise((r) => setTimeout(r, 100))
  }
  await pullRemoteChanges()
}

// Resolves once every change has reached the server (true), or a save failed (false).
async function saveEverythingNow(): Promise<boolean> {
  persistState(true)
  // Up to a minute: a large import can take several requests.
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const { saveStatus } = useStore.getState()
    if (saveStatus === 'error') return false
    if (!dirty && !saveInFlight && !saveTimer && saveStatus === 'saved') return true
  }
  return false
}

/*
 * After a connections modal saves: delete the vaulted token of any connection that was
 * removed, then move newly typed tokens into the vault. Best-effort and non-blocking --
 * an orphaned encrypted row is harmless, and a token that fails to move stays local.
 */
export function reconcileVault(previous: Credentialed[], next: Credentialed[]): void {
  const kept = new Set(next.map((c) => c.id))
  for (const c of previous) {
    if (c.tokenInVault && !kept.has(c.id)) void removeFromVault(c.id)
  }
  void useStore.getState().moveTokensToVault()
}

/*
 * Load everything. If the server can't be reached or fails, keep showing the loading
 * screen and try again -- showing an empty board instead would look like lost data.
 */
async function loadFromCloud(attempt = 0): Promise<void> {
  const startedAt = localRevision
  try {
    applyRecords(await loadRecords(), startedAt)
  } catch {
    syncLog('load:FAIL', { note: `attempt ${attempt + 1}` })
    useStore.setState({ cloudSyncing: true, cloudLoadFailed: true })
    setTimeout(() => { void loadFromCloud(attempt + 1) }, Math.min(2000 * 2 ** attempt, 30_000))
  }
}

export async function syncCloudToStore(): Promise<void> {
  useStore.setState({ cloudSyncing: true })
  await loadFromCloud()
}

void loadFromCloud()

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
/*
 * These two used to rebuild an array and a Set of every board key on every call, and
 * getBoardScope handed out a fresh object each time. Eight views call it on every render,
 * and each one feeds it to a useMemo that therefore never hit. The results are cached
 * against the stored arrays, so the identity only changes when the keys do.
 */
const normalizedKeys = new WeakMap<string[], string[]>()
const keySets = new WeakMap<string[], Set<string>>()

export function getActiveBoardProjectKeys(state: AppState): string[] | undefined {
  if (state.selectedProject === 'ALL') return undefined
  const proj = state.projects.find((p) => p.id === state.selectedProject)
  if (!proj?.jiraBoardId) return undefined
  const raw = proj.boardProjectKeys
  if (raw === undefined) return undefined  // not resolved yet
  let out = normalizedKeys.get(raw)
  if (!out) { out = raw.map((k) => k.trim().toUpperCase()); normalizedKeys.set(raw, out) }  // may be [] (resolved, empty)
  return out
}

// The EXACT set of Jira issue keys on the selected scrum board — the accurate
// board-membership signal. undefined = no board selected OR not yet resolved (no filtering
// by exact key). A resolved-but-empty board yields an empty set (show nothing).
export function getActiveBoardIssueKeys(state: AppState): Set<string> | undefined {
  if (state.selectedProject === 'ALL') return undefined
  const proj = state.projects.find((p) => p.id === state.selectedProject)
  if (!proj?.jiraBoardId) return undefined
  const raw = proj.boardIssueKeys
  if (raw === undefined) return undefined  // not resolved yet
  // An EMPTY key set means the board lookup came back with nothing -- a token that can't
  // read the board, a stale board id, a transient API failure. Treating that as the
  // authoritative membership list hides every issue in the project, which looked like the
  // tracker had lost them. Fall back to the coarser filters instead.
  if (raw.length === 0) return undefined
  let out = keySets.get(raw)
  if (!out) { out = new Set(raw.map((k) => k.trim().toUpperCase())); keySets.set(raw, out) }
  return out
}

// The Jira connection that owns the status-group mappings used for display.
/*
 * The ONE answer to "which Jira connection belongs to this project". Every screen used to
 * work this out for itself, slightly differently, and the variants drifted: some fell back
 * to another project's connection, some required status mappings, some ignored a stale
 * connection id pointing across projects. Each variant was a separate cross-project bug.
 *
 * Exact project match only -- there is no global connection and no borrowing. Prefers a
 * connection with display configuration (mappings or groups) when a project has several,
 * and honours a preferred id only when that connection also belongs to the project.
 */
export function jiraConnectionForProject(
  connections: JiraConfig[],
  projectId: string | undefined,
  preferredId?: string,
): JiraConfig | undefined {
  if (!projectId || projectId === 'ALL') return undefined
  const own = connections.filter((c) => c.enabled && c.projectId === projectId)
  if (preferredId) {
    const preferred = own.find((c) => c.id === preferredId)
    if (preferred) return preferred
  }
  return own.find((c) => !!c.statusMappings?.length || !!c.statusGroups?.length) ?? own[0]
}

// The connection for the selected project. On "All projects" no single connection owns
// the view, so this returns undefined -- callers resolve per task or per issue instead.
export function getActiveJiraConn(state: AppState): JiraConfig | undefined {
  return jiraConnectionForProject(state.jiraConnections, state.selectedProject)
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

// Board scope for the current selection. issueKeys = exact keys on the board (accurate);
// prefixes = coarse fallback. `active` is false in kanban / ALL / no-board (no filtering).
export interface BoardScope {
  active: boolean
  boardId?: number              // the selected board's id (issues stamped with it are on-board)
  issueKeys?: Set<string>       // exact keys, when resolved
  prefixes?: string[]           // prefix fallback, when exact keys unavailable
}

const INACTIVE_SCOPE: BoardScope = { active: false }
let lastScope: BoardScope | null = null

export function getBoardScope(state: AppState): BoardScope {
  const activeBoardId = getActiveBoardId(state)
  if (!activeBoardId) return INACTIVE_SCOPE
  const issueKeys = getActiveBoardIssueKeys(state)
  const prefixes = getActiveBoardProjectKeys(state)
  if (lastScope?.active && lastScope.boardId === activeBoardId
    && lastScope.issueKeys === issueKeys && lastScope.prefixes === prefixes) return lastScope
  lastScope = { active: true, boardId: activeBoardId, issueKeys, prefixes }
  return lastScope
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

/*
 * The Daily board calls this once per developer, and each call used to walk every task in
 * the store twice (the carried-over set, then the PR union). With ten developers and a
 * year of history that was a six-figure scan on every keystroke. Same inputs, same answer:
 * the results are cached per developer until one of the inputs actually changes.
 */
interface VisibleTasksCache {
  tasks: Task[]; projects: Project[]; conns: JiraConfig[]
  date: string; project: string; dev: string
  byDev: Map<string, Task[]>
}
let visibleTasksCache: VisibleTasksCache | null = null

export function getVisibleTasks(state: AppState, devId?: string): Task[] {
  const fresh = visibleTasksCache
    && visibleTasksCache.tasks === state.tasks
    && visibleTasksCache.projects === state.projects
    && visibleTasksCache.conns === state.jiraConnections
    && visibleTasksCache.date === state.selectedDate
    && visibleTasksCache.project === state.selectedProject
    && visibleTasksCache.dev === state.selectedDev
  if (!fresh) {
    visibleTasksCache = {
      tasks: state.tasks, projects: state.projects, conns: state.jiraConnections,
      date: state.selectedDate, project: state.selectedProject, dev: state.selectedDev,
      byDev: new Map(),
    }
  }
  const key = devId ?? ''
  const hit = visibleTasksCache!.byDev.get(key)
  if (hit) return hit
  const computed = computeVisibleTasks(state, devId)
  visibleTasksCache!.byDev.set(key, computed)
  return computed
}

function computeVisibleTasks(state: AppState, devId?: string): Task[] {
  const selectedDayOfWeek = new Date(state.selectedDate + 'T12:00:00').getDay()
  const boardScope = getBoardScope(state)

  /*
   * When a project marks a day non-working, the tasks already on that day are copied to
   * the next working day (carriedOverNwd, see updateProject). The originals stay behind,
   * and showing both would read as duplicated work -- so those superseded originals are
   * hidden here, keyed by the day they were carried from.
   *
   * Only those. Hiding EVERY task on a non-working day meant a checkpoint added on a
   * Saturday vanished the instant it was created (it still saved to the server), a
   * deadline falling at a weekend opened an empty board, and "Go to task" from Deadlines
   * jumped to a day that claimed to have nothing on it.
   */
  const supersededOn = new Set(
    state.tasks
      .filter((t) => t.carriedOverNwd && t.carriedFrom)
      .map((t) => `${t.devId}|${t.projectId ?? ''}|${t.carriedFrom}`),
  )

  const base = state.tasks.filter((t) => {
    const dv = devId ? t.devId === devId : state.selectedDev === 'ALL' || t.devId === state.selectedDev
    const pj = state.selectedProject === 'ALL' || t.projectId === state.selectedProject
    if (!dv || !pj || t.date !== state.selectedDate) return false
    const proj = state.projects.find((p) => p.id === t.projectId)
    const nwd = proj?.nonWorkingDays ?? [0, 6]
    if (nwd.includes(selectedDayOfWeek) && supersededOn.has(`${t.devId}|${t.projectId ?? ''}|${t.date}`)) return false
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
      // Exact match only: a task whose project has no connection uses the default groups
      // rather than borrowing another project's settings.
      connByProject.set(key, jiraConnectionForProject(state.jiraConnections, key))
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
